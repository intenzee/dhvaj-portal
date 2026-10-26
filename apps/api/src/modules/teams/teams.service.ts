import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CLIENT_TEAM_ROLE,
  type AddTeamMembersInput,
  type AssignTeamClientsResult,
  type ClientTeamRef,
  type CreateTeamInput,
  type SetClientTeamInput,
  type SetClientTeamResult,
  type TeamDetail,
  type TeamPerson,
  type TeamSummary,
  type UpdateTeamInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

/** Engagement statuses a team change may add people to (D7). */
const OPEN_ENGAGEMENT_STATUSES = [
  'prospect',
  'pending_acceptance',
  'accepted',
  'active',
  'on_hold',
];

interface PersonRow {
  id: string;
  full_name: string;
  grade_slug: string;
  grade_name: string;
  is_partner_grade: boolean;
  office_code: string;
  is_active: boolean;
}

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  office_id: string | null;
  office_code: string | null;
  archived_at: Date | null;
  version: number;
  client_count: string;
  members: { employee_id: string; team_role: string; added_at: string }[];
}

const TEAM_SELECT = `
  SELECT t.id, t.name::text AS name, t.description, t.office_id, o.code AS office_code,
         t.archived_at, t.version,
         (SELECT count(*) FROM hsdg.entities e
           WHERE e.team_id = t.id AND e.merged_into_id IS NULL) AS client_count,
         COALESCE((SELECT json_agg(json_build_object('employee_id', m.employee_id,
                                                     'team_role', m.team_role,
                                                     'added_at', m.added_at) ORDER BY m.added_at)
                     FROM hsdg.team_members m WHERE m.team_id = t.id), '[]'::json) AS members
    FROM hsdg.teams t
    LEFT JOIN hsdg.offices o ON o.id = t.office_id`;

function toPerson(r: PersonRow): TeamPerson {
  return {
    id: r.id,
    fullName: r.full_name,
    gradeSlug: r.grade_slug,
    gradeName: r.grade_name,
    isPartner: r.is_partner_grade,
    officeCode: r.office_code,
    active: r.is_active,
  };
}

/**
 * CM-8 · client teams: one overseeing partner (partner grade) and any number
 * of associates, assigned to clients — one team per client (D5). Writes are
 * gated on team.manage in the controller and audited here; a client's team
 * lets its people see the client (entities_select, D6).
 */
@Injectable()
export class TeamsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Everyone a team can hold, from every office (for the pickers). */
  async people(ctx: RlsContext): Promise<TeamPerson[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const map = await this.peopleMap(client);
      return [...map.values()].filter((p) => p.active);
    });
  }

  async list(
    ctx: RlsContext,
    filter: { q?: string; officeId?: string; archived?: boolean },
  ): Promise<TeamSummary[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const params: unknown[] = [];
      const where: string[] = [
        filter.archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL',
      ];
      if (filter.q?.trim()) {
        params.push(`%${filter.q.trim()}%`);
        where.push(`t.name ILIKE $${params.length}`);
      }
      if (filter.officeId) {
        params.push(filter.officeId);
        where.push(`t.office_id = $${params.length}`);
      }
      const { rows } = await client.query<TeamRow>(
        `${TEAM_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.name`,
        params,
      );
      const people = await this.peopleMap(client);
      return rows.map((r) => this.summary(r, people));
    });
  }

  async get(ctx: RlsContext, id: string): Promise<TeamDetail> {
    return this.db.withRlsContext(ctx, (client) => this.detail(client, id));
  }

  async create(ctx: RlsContext, input: CreateTeamInput): Promise<TeamDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const name = cleanName(input.name);
      const associates = [...new Set(input.associateIds ?? [])];
      if (associates.includes(input.overseeingPartnerId)) {
        throw new BadRequestException(
          'The overseeing partner cannot also be an associate of the team.',
        );
      }
      const people = await this.peopleMap(client);
      this.requirePartner(people, input.overseeingPartnerId);
      for (const id of associates) this.requireActive(people, id);

      let teamId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.teams (name, description, office_id, created_by)
           VALUES ($1, $2, $3, hsdg.ctx_employee_id()) RETURNING id`,
          [name, blank(input.description), input.officeId ?? null],
        );
        teamId = rows[0]!.id;
      } catch (err) {
        throw teamPgError(err, name);
      }
      await client.query(
        `INSERT INTO hsdg.team_members (team_id, employee_id, team_role, added_by)
         SELECT $1, x.id, x.role, hsdg.ctx_employee_id()
           FROM unnest($2::uuid[], $3::text[]) AS x(id, role)`,
        [
          teamId,
          [input.overseeingPartnerId, ...associates],
          [CLIENT_TEAM_ROLE.overseeingPartner, ...associates.map(() => CLIENT_TEAM_ROLE.associate)],
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'team.created',
        objectType: 'team',
        objectId: teamId,
        after: {
          name,
          overseeingPartnerId: input.overseeingPartnerId,
          associateIds: associates,
          officeId: input.officeId ?? null,
        },
      });
      if (input.entityIds?.length) await this.assign(client, ctx, teamId, input.entityIds);
      return this.detail(client, teamId);
    });
  }

  async update(ctx: RlsContext, id: string, input: UpdateTeamInput): Promise<TeamDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.detail(client, id);
      const sets: string[] = [];
      const params: unknown[] = [id, input.version];
      const set = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.name !== undefined) set('name', cleanName(input.name));
      if (input.description !== undefined) set('description', blank(input.description));
      if (input.officeId !== undefined) set('office_id', input.officeId);
      if (!sets.length) return before;
      let count: number;
      try {
        const r = await client.query(
          `UPDATE hsdg.teams SET ${sets.join(', ')}, updated_at = now(), version = version + 1
            WHERE id = $1 AND version = $2`,
          params,
        );
        count = r.rowCount ?? 0;
      } catch (err) {
        throw teamPgError(err, input.name ?? before.name);
      }
      if (count === 0) {
        throw new ConflictException('The team was changed by someone else. Refresh and retry.');
      }
      const after = await this.detail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'team.updated',
        objectType: 'team',
        objectId: id,
        before: { name: before.name, description: before.description, officeId: before.officeId },
        after: { name: after.name, description: after.description, officeId: after.officeId },
      });
      return after;
    });
  }

  /**
   * Add people. An overseeing partner (one id) must hold a partner grade and
   * replaces the current one, who stays on as an associate.
   */
  async addMembers(ctx: RlsContext, id: string, input: AddTeamMembersInput): Promise<TeamDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const team = await this.detail(client, id);
      this.requireLive(team);
      const ids = [...new Set(input.employeeIds)];
      if (!ids.length) throw new BadRequestException('Pick at least one person.');
      const people = await this.peopleMap(client);
      if (input.teamRole === CLIENT_TEAM_ROLE.overseeingPartner) {
        if (ids.length !== 1) {
          throw new BadRequestException('A team has one overseeing partner. Pick one person.');
        }
        this.requirePartner(people, ids[0]!);
        await client.query(
          `UPDATE hsdg.team_members SET team_role = 'associate'
            WHERE team_id = $1 AND team_role = 'overseeing_partner' AND employee_id <> $2`,
          [id, ids[0]],
        );
      } else {
        for (const e of ids) this.requireActive(people, e);
        const overseer = team.overseeingPartner?.id;
        if (overseer && ids.includes(overseer)) {
          throw new BadRequestException(
            'The overseeing partner cannot also be an associate. Make someone else the overseeing partner first.',
          );
        }
      }
      await client.query(
        `INSERT INTO hsdg.team_members (team_id, employee_id, team_role, added_by)
         SELECT $1, x, $3, hsdg.ctx_employee_id() FROM unnest($2::uuid[]) AS x
         ON CONFLICT (team_id, employee_id) DO UPDATE SET team_role = EXCLUDED.team_role`,
        [id, ids, input.teamRole],
      );
      await this.bump(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'team.members_added',
        objectType: 'team',
        objectId: id,
        after: { employeeIds: ids, teamRole: input.teamRole },
      });
      return this.detail(client, id);
    });
  }

  /** Remove someone. The last overseeing partner goes only with a replacement. */
  async removeMember(
    ctx: RlsContext,
    id: string,
    employeeId: string,
    replacementId?: string,
  ): Promise<TeamDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const team = await this.detail(client, id);
      const member = team.members.find((m) => m.id === employeeId);
      if (!member) throw new NotFoundException('That person is not on this team.');
      if (member.teamRole === CLIENT_TEAM_ROLE.overseeingPartner) {
        if (!replacementId) {
          throw new BadRequestException(
            `${member.fullName} is the overseeing partner. Name a replacement before removing them.`,
          );
        }
        if (replacementId === employeeId) {
          throw new BadRequestException('The replacement must be someone else.');
        }
        this.requirePartner(await this.peopleMap(client), replacementId);
      }
      await client.query(`DELETE FROM hsdg.team_members WHERE team_id = $1 AND employee_id = $2`, [
        id,
        employeeId,
      ]);
      if (member.teamRole === CLIENT_TEAM_ROLE.overseeingPartner && replacementId) {
        await client.query(
          `INSERT INTO hsdg.team_members (team_id, employee_id, team_role, added_by)
           VALUES ($1, $2, 'overseeing_partner', hsdg.ctx_employee_id())
           ON CONFLICT (team_id, employee_id) DO UPDATE SET team_role = 'overseeing_partner'`,
          [id, replacementId],
        );
      }
      await this.bump(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'team.member_removed',
        objectType: 'team',
        objectId: id,
        before: { employeeId, teamRole: member.teamRole },
        after: replacementId ? { overseeingPartnerId: replacementId } : undefined,
      });
      return this.detail(client, id);
    });
  }

  async assignClients(
    ctx: RlsContext,
    id: string,
    entityIds: string[],
  ): Promise<AssignTeamClientsResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      this.requireLive(await this.detail(client, id));
      return this.assign(client, ctx, id, entityIds);
    });
  }

  /** PUT /entities/:id/team — set or clear a client's team; optionally staff its open engagements. */
  async setClientTeam(
    ctx: RlsContext,
    entityId: string,
    input: SetClientTeamInput,
  ): Promise<SetClientTeamResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (input.teamId) this.requireLive(await this.detail(client, input.teamId));
      const { rows } = await client.query<{ team_id: string | null; legal_name: string }>(
        `SELECT team_id, legal_name FROM hsdg.entities WHERE id = $1 AND merged_into_id IS NULL`,
        [entityId],
      );
      if (!rows[0]) throw new NotFoundException('Client not found.');
      const before = rows[0].team_id;
      if (before !== input.teamId) {
        await this.writeTeam(client, entityId, input.teamId);
        await this.audit.recordWith(client, ctx, {
          action: 'entity.team_changed',
          objectType: 'entity',
          objectId: entityId,
          before: { teamId: before },
          after: { teamId: input.teamId },
        });
      }
      let engagementsUpdated = 0;
      if (input.teamId && input.applyToOpenEngagements) {
        engagementsUpdated = await this.staffOpenEngagements(client, ctx, entityId, input.teamId);
      }
      return { team: await this.teamRef(client, input.teamId), engagementsUpdated };
    });
  }

  /** Archive: only once no client is assigned. */
  async archive(ctx: RlsContext, id: string): Promise<TeamDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const team = await this.detail(client, id);
      this.requireLive(team);
      if (team.clientCount > 0) {
        throw new ConflictException(
          `${team.name} still serves ${team.clientCount} client${team.clientCount === 1 ? '' : 's'}. Move them to another team first.`,
        );
      }
      await client.query(
        `UPDATE hsdg.teams SET archived_at = now(), updated_at = now(), version = version + 1
          WHERE id = $1`,
        [id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'team.archived',
        objectType: 'team',
        objectId: id,
        before: { name: team.name },
      });
      return this.detail(client, id);
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async assign(
    client: PoolClient,
    ctx: RlsContext,
    teamId: string,
    entityIds: string[],
  ): Promise<AssignTeamClientsResult> {
    const ids = [...new Set(entityIds)];
    if (!ids.length) return { assigned: [] };
    const { rows } = await client.query<{
      id: string;
      legal_name: string;
      team_id: string | null;
      team_name: string | null;
    }>(
      `SELECT e.id, e.legal_name, e.team_id, t.name::text AS team_name
         FROM hsdg.entities e LEFT JOIN hsdg.teams t ON t.id = e.team_id
        WHERE e.id = ANY($1::uuid[]) AND e.merged_into_id IS NULL`,
      [ids],
    );
    const missing = ids.filter((i) => !rows.some((r) => r.id === i));
    if (missing.length) {
      throw new NotFoundException(
        `${missing.length} of the clients could not be found, or you cannot see them.`,
      );
    }
    const moving = rows.filter((r) => r.team_id !== teamId);
    for (const r of moving) await this.writeTeam(client, r.id, teamId);
    for (const r of moving) {
      await this.audit.recordWith(client, ctx, {
        action: 'entity.team_changed',
        objectType: 'entity',
        objectId: r.id,
        before: { teamId: r.team_id },
        after: { teamId },
      });
    }
    return {
      assigned: moving.map((r) => ({
        entityId: r.id,
        legalName: r.legal_name,
        fromTeam: r.team_id ? { id: r.team_id, name: r.team_name ?? '' } : null,
      })),
    };
  }

  private async writeTeam(
    client: PoolClient,
    entityId: string,
    teamId: string | null,
  ): Promise<void> {
    const r = await client.query(
      `UPDATE hsdg.entities SET team_id = $2, updated_at = now() WHERE id = $1`,
      [entityId, teamId],
    );
    if (!r.rowCount) {
      throw new NotFoundException('You cannot change this client’s team.');
    }
  }

  /**
   * D7: add the team's people to the client's open engagements — the
   * overseeing partner as a reviewer, associates as members. Never removes
   * anyone; an engagement the caller may not staff is skipped.
   */
  private async staffOpenEngagements(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    teamId: string,
  ): Promise<number> {
    const { rows: engagements } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.engagements WHERE entity_id = $1 AND status = ANY($2::text[])`,
      [entityId, OPEN_ENGAGEMENT_STATUSES],
    );
    let updated = 0;
    for (const e of engagements) {
      await client.query('SAVEPOINT team_staff');
      try {
        const r = await client.query(
          `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
           SELECT $1, m.employee_id,
                  CASE m.team_role WHEN 'overseeing_partner' THEN 'reviewer' ELSE 'member' END
             FROM hsdg.team_members m
             JOIN hsdg.engagements g ON g.id = $1
            WHERE m.team_id = $2
              AND m.employee_id IS DISTINCT FROM g.engagement_partner_id
              AND m.employee_id IS DISTINCT FROM g.engagement_manager_id
           ON CONFLICT (engagement_id, employee_id) DO NOTHING`,
          [e.id, teamId],
        );
        await client.query('RELEASE SAVEPOINT team_staff');
        if (r.rowCount) {
          updated += 1;
          await client.query(
            `UPDATE hsdg.engagements SET version = version + 1, updated_at = now() WHERE id = $1`,
            [e.id],
          );
          await this.audit.recordWith(client, ctx, {
            action: 'engagement.team_assigned',
            objectType: 'engagement',
            objectId: e.id,
            after: { fromClientTeam: teamId, added: r.rowCount },
          });
        }
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT team_staff');
      }
    }
    return updated;
  }

  private async teamRef(client: PoolClient, teamId: string | null): Promise<ClientTeamRef | null> {
    if (!teamId) return null;
    const { rows } = await client.query<{ ref: ClientTeamRef | null }>(
      `SELECT hsdg.client_team_ref($1) AS ref`,
      [teamId],
    );
    return rows[0]?.ref ?? null;
  }

  private async detail(client: PoolClient, id: string): Promise<TeamDetail> {
    const { rows } = await client.query<TeamRow>(`${TEAM_SELECT} WHERE t.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('Team not found.');
    const people = await this.peopleMap(client);
    const summary = this.summary(rows[0], people);
    const members = rows[0].members.map((m) => {
      const p = people.get(m.employee_id);
      return {
        id: m.employee_id,
        fullName: p?.fullName ?? 'Unknown person',
        gradeSlug: p?.gradeSlug ?? '',
        gradeName: p?.gradeName ?? '',
        isPartner: p?.isPartner ?? false,
        officeCode: p?.officeCode ?? '',
        active: p?.active ?? false,
        teamRole: m.team_role as TeamDetail['members'][number]['teamRole'],
        addedAt: m.added_at,
      };
    });
    const { rows: clients } = await client.query<{
      id: string;
      entity_code: string;
      legal_name: string;
    }>(
      `SELECT id, entity_code, legal_name FROM hsdg.entities
        WHERE team_id = $1 AND merged_into_id IS NULL ORDER BY legal_name`,
      [id],
    );
    const warnings: string[] = [];
    const overseer = members.find((m) => m.teamRole === CLIENT_TEAM_ROLE.overseeingPartner);
    if (!overseer || !overseer.active) warnings.push('Needs an overseeing partner');
    for (const m of members) if (!m.active) warnings.push(`${m.fullName} has left the firm`);
    return {
      ...summary,
      members,
      clients: clients.map((c) => ({
        id: c.id,
        entityCode: c.entity_code,
        legalName: c.legal_name,
      })),
      warnings,
    };
  }

  private summary(r: TeamRow, people: Map<string, TeamPerson>): TeamSummary {
    const overseer = r.members.find((m) => m.team_role === CLIENT_TEAM_ROLE.overseeingPartner);
    const name = (id: string): string => people.get(id)?.fullName ?? 'Unknown person';
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      officeId: r.office_id,
      officeCode: r.office_code,
      overseeingPartner: overseer
        ? { id: overseer.employee_id, fullName: name(overseer.employee_id) }
        : null,
      associates: r.members
        .filter((m) => m.team_role === CLIENT_TEAM_ROLE.associate)
        .map((m) => ({ id: m.employee_id, fullName: name(m.employee_id) })),
      clientCount: Number(r.client_count),
      archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
      version: r.version,
    };
  }

  private async peopleMap(client: PoolClient): Promise<Map<string, TeamPerson>> {
    const { rows } = await client.query<PersonRow>(`SELECT * FROM hsdg.team_people()`);
    return new Map(rows.map((r) => [r.id, toPerson(r)]));
  }

  private requirePartner(people: Map<string, TeamPerson>, id: string): void {
    const p = people.get(id);
    if (!p) throw new BadRequestException('That person was not found.');
    if (!p.active) throw new BadRequestException(`${p.fullName} has left the firm.`);
    if (!p.isPartner) {
      throw new BadRequestException(
        `${p.fullName} is ${p.gradeName}. The overseeing partner must be a Partner or Managing Partner.`,
      );
    }
  }

  private requireActive(people: Map<string, TeamPerson>, id: string): void {
    const p = people.get(id);
    if (!p) throw new BadRequestException('One of the people picked was not found.');
    if (!p.active) throw new BadRequestException(`${p.fullName} has left the firm.`);
  }

  private requireLive(team: TeamDetail): void {
    if (team.archivedAt) throw new ConflictException(`${team.name} is archived.`);
  }

  private async bump(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.teams SET updated_at = now(), version = version + 1 WHERE id = $1`,
      [id],
    );
  }
}

function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) throw new BadRequestException('Give the team a name.');
  if (name.length > 80) throw new BadRequestException('A team name is at most 80 characters.');
  return name;
}

function blank(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function teamPgError(err: unknown, name: string): Error {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'teams_name_live_key') {
    return new ConflictException(`A team named “${name}” already exists.`);
  }
  return err as Error;
}
