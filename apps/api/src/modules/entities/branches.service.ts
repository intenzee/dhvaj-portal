import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  GST_STATES,
  officeLabel,
  readGstin,
  stateCodeFromName,
  withCompanySuffix,
  type AddBranchInput,
  type BranchCandidate,
  type BranchCandidateClient,
  type BranchCandidateOffice,
  type CombineBranchesInput,
  type UpdateBranchInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { ClientMergeService } from './client-merge.service';
import { EntitiesService } from './entities.service';
import { parseClientName, splitPlaceFromName } from './client-names';
import type { EntityDetail } from './entities.types';

interface ClientRow {
  id: string;
  entity_code: string;
  legal_name: string;
  pan: string | null;
  type_slug: string;
  office_code: string;
  created_at: string;
  address_state: string | null;
  branch_count: number;
  gstins: { id: string; n: string; p: boolean }[] | null;
  counts: {
    registrations: number;
    logins: number;
    openEngagements: number;
    unpaidInvoices: number;
  };
}

interface Member {
  row: ClientRow;
  gstins: { id: string; gstin: string; stateCode: string | null; principal: boolean }[];
  place: string | null;
}

const ENDED = ['completed', 'closed', 'declined', 'withdrawn', 'cancelled', 'merged'];

/**
 * One client, several offices (CM-6): the clients that should be one client
 * with offices ("Drift Logistics Private Limited" and "… (Delhi", one PAN),
 * combining them, and the offices of a client.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly merges: ClientMergeService,
    private readonly entities: EntitiesService,
  ) {}

  /**
   * "Offices to combine": live clients of one PAN whose GSTINs are in different
   * states or whose names differ only by a place; and single clients with two
   * or more GSTINs but no offices yet. Never two PANs; never a dismissed pair.
   */
  async candidates(ctx: RlsContext): Promise<BranchCandidate[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<ClientRow>(
        `SELECT e.id, e.entity_code, e.legal_name, e.pan, et.slug AS type_slug, o.code AS office_code,
                e.created_at,
                (SELECT a.state FROM hsdg.entity_addresses a
                  WHERE a.entity_id = e.id AND a.address_type = 'registered'
                  ORDER BY a.is_primary DESC LIMIT 1) AS address_state,
                (SELECT count(*)::int FROM hsdg.entity_branches b
                  WHERE b.entity_id = e.id AND b.archived_at IS NULL) AS branch_count,
                (SELECT json_agg(json_build_object('id', r.id, 'n', r.registration_number, 'p', r.is_principal)
                                 ORDER BY r.is_principal DESC, r.created_at)
                   FROM hsdg.entity_registrations r
                  WHERE r.entity_id = e.id AND r.registration_type = 'gstin' AND r.status = 'active') AS gstins,
                json_build_object(
                  'registrations', (SELECT count(*)::int FROM hsdg.entity_registrations WHERE entity_id = e.id),
                  'logins', (SELECT count(*)::int FROM hsdg.client_credentials WHERE entity_id = e.id),
                  'openEngagements', (SELECT count(*)::int FROM hsdg.engagements
                                       WHERE entity_id = e.id AND status <> ALL($1::text[])),
                  'unpaidInvoices', (SELECT count(*)::int FROM hsdg.invoices
                                      WHERE client_entity_id = e.id AND status = 'issued')
                ) AS counts
           FROM hsdg.entities e
           JOIN hsdg.entity_types et ON et.id = e.entity_type_id
           JOIN hsdg.offices o ON o.id = e.home_office_id
          WHERE e.merged_into_id IS NULL AND e.status <> 'archived'
            AND (e.pan IS NOT NULL OR EXISTS (
                  SELECT 1 FROM hsdg.entity_registrations r
                   WHERE r.entity_id = e.id AND r.registration_type = 'gstin' AND r.status = 'active'))`,
        [ENDED],
      );
      const dismissed = await client.query<{ a: string; b: string }>(
        `SELECT entity_a_id AS a, entity_b_id AS b FROM hsdg.entity_duplicate_dismissals
          WHERE kind = 'branch'`,
      );
      const skip = new Set(dismissed.rows.map((d) => `${d.a}|${d.b}`));
      const isDismissed = (x: string, y: string): boolean =>
        skip.has(x < y ? `${x}|${y}` : `${y}|${x}`);

      const byPan = new Map<string, Member[]>();
      for (const row of rows) {
        const gstins = (row.gstins ?? []).map((g) => {
          const read = readGstin(g.n);
          return { id: g.id, gstin: read.gstin, stateCode: read.stateCode, principal: g.p };
        });
        const pan = row.pan ?? gstins.map((g) => readGstin(g.gstin).pan).find(Boolean) ?? null;
        if (!pan) continue;
        const member: Member = { row, gstins, place: placeOf(row.legal_name) };
        byPan.set(pan, [...(byPan.get(pan) ?? []), member]);
      }

      const out: BranchCandidate[] = [];
      for (const [pan, members] of byPan) {
        if (members.length === 1) {
          const m = members[0]!;
          if (m.gstins.length >= 2 && m.row.branch_count === 0)
            out.push(
              this.card(
                'setup',
                pan,
                [m],
                [`${m.gstins.length} GSTINs of PAN ${pan} and no offices set up yet.`],
              ),
            );
          continue;
        }
        const keeper = pickKeeper(members);
        const others = members.filter(
          (m) =>
            m !== keeper &&
            !isDismissed(keeper.row.id, m.row.id) &&
            (differentStates(keeper, m) || sameButPlace(keeper, m)),
        );
        if (others.length === 0) continue;
        const reasons = [
          `Same PAN ${pan}.`,
          ...others.map((m) =>
            sameButPlace(keeper, m)
              ? `"${m.row.legal_name}" is "${keeper.row.legal_name}" with a place added.`
              : `${m.row.entity_code} is registered in another state.`,
          ),
        ];
        out.push(this.card('combine', pan, [keeper, ...others], reasons));
      }
      return out
        .sort((a, b) =>
          a.kind === b.kind
            ? a.proposedName.localeCompare(b.proposedName)
            : a.kind === 'combine'
              ? -1
              : 1,
        )
        .slice(0, 300);
    });
  }

  private card(
    kind: BranchCandidate['kind'],
    pan: string,
    members: Member[],
    reasons: string[],
  ): BranchCandidate {
    const keeper = members[0]!;
    const base = splitPlaceFromName(keeper.row.legal_name).name;
    const offices: BranchCandidateOffice[] = [];
    const used = new Set<string>();
    const headId =
      keeper.gstins.find((g) => g.principal)?.id ??
      keeper.gstins.find((g) => g.stateCode === stateCodeFromName(keeper.row.address_state ?? ''))
        ?.id ??
      keeper.gstins[0]?.id ??
      members.flatMap((m) => m.gstins)[0]?.id;
    for (const m of members)
      for (const g of m.gstins) {
        const state = g.stateCode ? (GST_STATES[g.stateCode] ?? null) : null;
        let label =
          g.id === headId
            ? 'Head office'
            : officeLabel(m.gstins.length === 1 ? m.place : null, state);
        for (let n = 2; used.has(label.toLowerCase()); n += 1)
          label = `${officeLabel(null, state)} ${n}`;
        used.add(label.toLowerCase());
        offices.push({
          registrationId: g.id,
          gstin: g.gstin,
          stateCode: g.stateCode,
          entityId: m.row.id,
          label,
          isHeadOffice: g.id === headId,
        });
      }
    const clients: BranchCandidateClient[] = members.map((m) => ({
      id: m.row.id,
      entityCode: m.row.entity_code,
      legalName: m.row.legal_name,
      pan: m.row.pan,
      officeCode: m.row.office_code,
      counts: m.row.counts,
    }));
    return {
      kind,
      pan,
      clients,
      keepId: keeper.row.id,
      proposedName: withCompanySuffix(base, keeper.row.type_slug),
      offices,
      reasons,
    };
  }

  async dismiss(ctx: RlsContext, aId: string, bId: string): Promise<void> {
    await this.merges.dismiss(ctx, aId, bId, undefined, 'branch');
  }

  /**
   * Combine clients of one PAN into the kept one with offices, in one
   * transaction: each other client is merged in (merge_entities), an office is
   * made per GSTIN, the other clients' addresses and contacts go under their
   * office, and the kept client takes the name without the place.
   */
  async combine(
    ctx: RlsContext,
    keepId: string,
    input: CombineBranchesInput,
  ): Promise<EntityDetail> {
    if (input.offices.length === 0) throw new BadRequestException('Name at least one office.');
    const heads = input.offices.filter((o) => o.isHeadOffice).length;
    if (heads > 1) throw new BadRequestException('Only one office can be the head office.');
    const labels = input.offices.map((o) => o.label.trim().toLowerCase());
    if (labels.some((l) => !l)) throw new BadRequestException('Every office needs a name.');
    if (new Set(labels).size !== labels.length)
      throw new BadRequestException('Two offices have the same name; make them differ.');
    const otherIds = [...new Set(input.others.map((o) => o.entityId))].filter(
      (id) => id !== keepId,
    );

    return this.db.withRlsContext(ctx, async (client) => {
      // What each other client holds before the merge moves it.
      const held = new Map<string, { regs: string[]; addresses: string[]; contacts: string[] }>();
      for (const id of otherIds) {
        const { rows } = await client.query<{
          regs: string[] | null;
          addresses: string[] | null;
          contacts: string[] | null;
        }>(
          `SELECT (SELECT array_agg(id) FROM hsdg.entity_registrations
                    WHERE entity_id = $1 AND registration_type = 'gstin' AND status = 'active') AS regs,
                  (SELECT array_agg(id) FROM hsdg.entity_addresses WHERE entity_id = $1) AS addresses,
                  (SELECT array_agg(id) FROM hsdg.entity_contacts WHERE entity_id = $1) AS contacts`,
          [id],
        );
        held.set(id, {
          regs: rows[0]?.regs ?? [],
          addresses: rows[0]?.addresses ?? [],
          contacts: rows[0]?.contacts ?? [],
        });
      }

      const before = await this.entities.detailWith(client, keepId);
      if (!before) throw new NotFoundException('Client not found.');
      for (const id of otherIds) await this.merges.mergeWith(client, ctx, keepId, id, []);

      if (heads === 1)
        await client.query(
          `UPDATE hsdg.entity_branches SET is_head_office = false
            WHERE entity_id = $1 AND is_head_office AND archived_at IS NULL`,
          [keepId],
        );
      const officeOfReg = new Map<string, string>();
      for (const o of input.offices) {
        const reg = await client.query<{ registration_number: string }>(
          `SELECT registration_number FROM hsdg.entity_registrations WHERE id = $1 AND entity_id = $2`,
          [o.registrationId, keepId],
        );
        if (!reg.rows[0])
          throw new BadRequestException('A GSTIN in the offices is not this client’s.');
        const branchId = await this.insertBranch(client, ctx, keepId, {
          label: o.label.trim(),
          stateCode: readGstin(reg.rows[0].registration_number).stateCode,
          isHeadOffice: o.isHeadOffice,
        });
        await client.query(`UPDATE hsdg.entity_registrations SET branch_id = $1 WHERE id = $2`, [
          branchId,
          o.registrationId,
        ]);
        officeOfReg.set(o.registrationId, branchId);
      }
      // A client that came with one office brings its addresses and contacts to it.
      for (const h of held.values()) {
        const offices = h.regs.map((r) => officeOfReg.get(r)).filter(Boolean);
        if (offices.length !== 1) continue;
        if (h.addresses.length)
          await client.query(
            `UPDATE hsdg.entity_addresses SET branch_id = $1 WHERE id = ANY($2::uuid[])`,
            [offices[0], h.addresses],
          );
        if (h.contacts.length)
          await client.query(
            `UPDATE hsdg.entity_contacts SET branch_id = $1 WHERE id = ANY($2::uuid[])`,
            [offices[0], h.contacts],
          );
      }
      const name = input.legalName?.trim();
      if (name && name !== before.legalName)
        await client.query(
          `UPDATE hsdg.entities SET legal_name = $2, version = version + 1 WHERE id = $1`,
          [keepId, name],
        );

      const after = await this.entities.detailWith(client, keepId);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.branches_combined',
        objectType: 'entity',
        objectId: keepId,
        before: { legalName: before.legalName, others: otherIds },
        after: { legalName: after!.legalName, offices: after!.branches },
      });
      return after!;
    });
  }

  async add(ctx: RlsContext, entityId: string, input: AddBranchInput): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.entities.detailWith(client, entityId);
      if (!before) throw new NotFoundException('Client not found.');
      let stateCode = input.stateCode ?? null;
      if (input.registrationId) {
        const reg = before.registrations.find((r) => r.id === input.registrationId);
        if (!reg) throw new BadRequestException('That registration is not this client’s.');
        stateCode ??= readGstin(reg.registrationNumber).stateCode;
      }
      if (input.isHeadOffice)
        await client.query(
          `UPDATE hsdg.entity_branches SET is_head_office = false
            WHERE entity_id = $1 AND is_head_office AND archived_at IS NULL`,
          [entityId],
        );
      const branchId = await this.insertBranch(client, ctx, entityId, {
        label: input.label.trim(),
        stateCode,
        isHeadOffice: input.isHeadOffice ?? false,
      });
      if (input.registrationId)
        await client.query(`UPDATE hsdg.entity_registrations SET branch_id = $1 WHERE id = $2`, [
          branchId,
          input.registrationId,
        ]);
      const after = await this.entities.detailWith(client, entityId);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.branch_added',
        objectType: 'entity',
        objectId: entityId,
        after: after!.branches.find((b) => b.id === branchId),
      });
      return after!;
    });
  }

  async update(
    ctx: RlsContext,
    entityId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<EntityDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.entities.detailWith(client, entityId);
      const branch = before?.branches.find((b) => b.id === branchId);
      if (!before || !branch) throw new NotFoundException('Office not found.');
      if (input.version !== undefined && input.version !== branch.version)
        throw new ConflictException('The office was changed by someone else. Refresh and retry.');
      if (input.isHeadOffice)
        await client.query(
          `UPDATE hsdg.entity_branches SET is_head_office = false
            WHERE entity_id = $1 AND is_head_office AND archived_at IS NULL AND id <> $2`,
          [entityId, branchId],
        );
      try {
        await client.query(
          `UPDATE hsdg.entity_branches
              SET label = COALESCE($3, label),
                  is_head_office = CASE WHEN $5::boolean THEN false ELSE COALESCE($4, is_head_office) END,
                  archived_at = CASE WHEN $5::boolean THEN now()
                                     WHEN $5::boolean IS FALSE THEN NULL ELSE archived_at END,
                  version = version + 1
            WHERE id = $1 AND entity_id = $2`,
          [
            branchId,
            entityId,
            input.label?.trim() || null,
            input.isHeadOffice ?? null,
            input.archived ?? null,
          ],
        );
      } catch (err) {
        throw branchError(err);
      }
      const after = await this.entities.detailWith(client, entityId);
      await this.audit.recordWith(client, ctx, {
        action: 'entity.branch_updated',
        objectType: 'entity',
        objectId: entityId,
        before: branch,
        after: after!.branches.find((b) => b.id === branchId),
      });
      return after!;
    });
  }

  private async insertBranch(
    client: PoolClient,
    ctx: RlsContext,
    entityId: string,
    b: { label: string; stateCode: string | null; isHeadOffice: boolean },
  ): Promise<string> {
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.entity_branches (entity_id, label, state_code, is_head_office, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [entityId, b.label, b.stateCode, b.isHeadOffice, ctx.userId],
      );
      return rows[0]!.id;
    } catch (err) {
      throw branchError(err);
    }
  }
}

function branchError(err: unknown): Error {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'entity_branches_label_unique')
    return new ConflictException('The client already has an office of that name.');
  if (e.code === '23505' && e.constraint === 'entity_branches_one_head_office')
    return new ConflictException('The client already has a head office.');
  return err as Error;
}

/** The place set apart in a name, as written: 'Drift Logistics (Delhi' → 'Delhi'. */
function placeOf(name: string): string | null {
  return parseClientName(name).place?.text ?? null;
}

/** The keeper: the name without a place; else the one whose GSTIN state is its address's; else the oldest. */
function pickKeeper(members: Member[]): Member {
  const score = (m: Member): number => {
    if (!m.place) return 0;
    const addr = stateCodeFromName(m.row.address_state ?? '');
    return addr && m.gstins.some((g) => g.stateCode === addr) ? 1 : 2;
  };
  return [...members].sort(
    (a, b) => score(a) - score(b) || a.row.created_at.localeCompare(b.row.created_at),
  )[0]!;
}

function differentStates(a: Member, b: Member): boolean {
  const sa = new Set(a.gstins.map((g) => g.stateCode));
  return b.gstins.some((g) => !sa.has(g.stateCode));
}

function sameButPlace(a: Member, b: Member): boolean {
  const pa = parseClientName(a.row.legal_name);
  const pb = parseClientName(b.row.legal_name);
  return pa.key === pb.key && Boolean(pa.place || pb.place);
}
