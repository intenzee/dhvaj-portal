import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  ADD_ON_ROLES,
  DELETE_BLOCKER,
  isBusinessFirmwide,
  mainRoleOf,
  ROLE,
  type AddOnRole,
  type DeactivateInput,
  type DeleteBlocker,
  type DeletePersonCheck,
  type DeletePersonInput,
  type DeletePersonResult,
  type EmploymentStatus,
  type GradeSlug,
  type MoveWorkInput,
  type MoveWorkOptions,
  type MoveWorkResult,
  type PeopleRoster,
  type PeopleRosterRow,
  type RoleSlug,
  type StartExitResult,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../documents/storage/storage-provider';
import { istToday } from '../engagements/time/auto-time';
import { OPEN_TASK_SQL, moveOpenWork } from '../tasks/task-assignments';
import { PeopleService } from './people.service';
import { peopleChecks } from './people-admin';

/** Engagements still running: the ones a leader must hand over. */
const OPEN_ENGAGEMENT = `status NOT IN ('completed', 'closed', 'declined', 'withdrawn', 'cancelled', 'merged')`;
const OPEN_TASK = OPEN_TASK_SQL;

/** C-6: these move the work of someone below them, within their own tree. */
const TREE_MOVERS = new Set<string>([ROLE.partner, ROLE.manager, ROLE.senior]);
const MOVE_REFUSAL =
  'Only the Managing Partner, an administrator, or someone above them in the reporting line can move their work.';

interface RosterDbRow {
  id: string;
  employee_code: string;
  full_name: string;
  user_id: string | null;
  email: string | null;
  login_active: boolean | null;
  grade_slug: GradeSlug;
  roles: RoleSlug[];
  reports_to_id: string | null;
  reports_to_name: string | null;
  office_code: string;
  employment_status: EmploymentStatus;
  date_of_exit: string | null;
  open_tasks: number;
  led_engagements: number;
  version: number;
}

const addOnSet = new Set<string>(ADD_ON_ROLES);

/**
 * The People screen (B-2) and leaving the firm (B-3), for the Managing Partner
 * and the administrator. Edits to grade, office, reporting line and roles go
 * through the employee and user endpoints as before; this adds the one-table
 * read with its clean-up list, moving someone's open work, deactivating, and
 * the administrator's permanent delete.
 */
@Injectable()
export class PeopleAdminService {
  private readonly logger = new Logger(PeopleAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly people: PeopleService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async roster(ctx: RlsContext): Promise<PeopleRoster> {
    requireFirmwide(
      ctx,
      'Only the Managing Partner or an administrator can open the People screen.',
    );
    const rows = await this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<RosterDbRow>(
        `SELECT e.id, e.employee_code, e.full_name, e.user_id, u.email, u.is_active AS login_active,
                g.slug AS grade_slug, e.reports_to_id, m.full_name AS reports_to_name,
                o.code AS office_code, e.employment_status, e.date_of_exit, e.version,
                COALESCE((SELECT array_agg(r.slug ORDER BY r.slug)
                            FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
                           WHERE ur.user_id = e.user_id), '{}') AS roles,
                (SELECT count(*)::int FROM hsdg.tasks t
                  WHERE (t.assigned_to_employee_id = e.id OR t.reviewer_employee_id = e.id)
                    AND t.${OPEN_TASK}) AS open_tasks,
                (SELECT count(*)::int FROM hsdg.engagements x
                  WHERE x.engagement_partner_id = e.id AND x.${OPEN_ENGAGEMENT}) AS led_engagements
           FROM hsdg.employees e
           JOIN hsdg.grades g ON g.id = e.grade_id
           JOIN hsdg.offices o ON o.id = e.primary_office_id
           LEFT JOIN hsdg.users u ON u.id = e.user_id
           LEFT JOIN hsdg.employees m ON m.id = e.reports_to_id
          WHERE e.deleted_at IS NULL
          ORDER BY g.rank DESC, e.full_name`,
      );
      return rows;
    });
    const people = rows.map(toRosterRow);
    return { people, checks: peopleChecks(people) };
  }

  /**
   * Every open task of one person goes to another — as the doer and as the
   * reviewer — each move recorded in task_assignments with the reason. The new
   * person joins each engagement's team so they can see the work.
   */
  async moveWork(ctx: RlsContext, input: MoveWorkInput): Promise<MoveWorkResult> {
    const firmwide = isBusinessFirmwide(ctx.role, ctx.roles ?? []);
    if (!firmwide && !treeMover(ctx)) throw new ForbiddenException(MOVE_REFUSAL);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Say why the work is moving.');
    if (input.fromEmployeeId === input.toEmployeeId) {
      throw new BadRequestException('Pick someone else to take the work.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      if (!firmwide) {
        const tree = await inTree(client, [input.fromEmployeeId, input.toEmployeeId]);
        if (input.fromEmployeeId === ctx.employeeId || !tree[0]) {
          throw new ForbiddenException(MOVE_REFUSAL);
        }
        if (!tree[1]) {
          throw new ForbiddenException(
            'Pick someone in your own reporting line to take the work, or ask the Managing Partner.',
          );
        }
      }
      const { rows: people } = await client.query<{
        id: string;
        full_name: string;
        employment_status: EmploymentStatus;
        login_active: boolean | null;
      }>(
        `SELECT e.id, e.full_name, e.employment_status, u.is_active AS login_active
           FROM hsdg.employees e LEFT JOIN hsdg.users u ON u.id = e.user_id
          WHERE e.id = ANY ($1::uuid[]) AND e.deleted_at IS NULL`,
        [[input.fromEmployeeId, input.toEmployeeId]],
      );
      const from = people.find((p) => p.id === input.fromEmployeeId);
      const to = people.find((p) => p.id === input.toEmployeeId);
      if (!from || !to) throw new NotFoundException('Employee not found.');
      if (to.employment_status === 'exited' || to.login_active === false) {
        throw new BadRequestException(`${to.full_name} has left; pick someone who is here.`);
      }

      const { assigned, reviews } = await moveOpenWork(client, {
        from: input.fromEmployeeId,
        to: input.toEmployeeId,
        by: ctx.employeeId ?? null,
        reason,
      });

      await this.audit.recordWith(client, ctx, {
        action: 'employee.work_moved',
        objectType: 'employee',
        objectId: input.fromEmployeeId,
        after: { toEmployeeId: input.toEmployeeId, toName: to.full_name, assigned, reviews },
        reason,
      });
      return { assigned, reviews };
    });
  }

  /**
   * C-6: may the caller move this person's open work, and to whom. Firm-wide:
   * anyone's, to anyone here. A Partner / Manager / Senior: someone below them,
   * to someone in their own tree (themselves included).
   */
  async moveWorkOptions(ctx: RlsContext, id: string): Promise<MoveWorkOptions> {
    const firmwide = isBusinessFirmwide(ctx.role, ctx.roles ?? []);
    return this.db.withRlsContext(ctx, async (client) => {
      const person = await this.requireLive(client, id);
      const openTasks = await this.openTaskCount(client, id);
      const canMove =
        firmwide ||
        (treeMover(ctx) && id !== ctx.employeeId && (await inTree(client, [id]))[0] === true);
      if (!canMove) {
        return { employeeId: id, fullName: person.full_name, openTasks, canMove, takers: [] };
      }
      const { rows } = await client.query<{ id: string; full_name: string }>(
        `SELECT e.id, e.full_name
           FROM hsdg.employees e LEFT JOIN hsdg.users u ON u.id = e.user_id
          WHERE e.id <> $1 AND e.deleted_at IS NULL AND e.employment_status <> 'exited'
            -- Has a login, not turned off (another office's login row is out of sight).
            AND e.user_id IS NOT NULL AND u.is_active IS NOT FALSE
            ${firmwide ? '' : 'AND e.id = ANY (hsdg.ctx_subtree())'}
          ORDER BY e.full_name`,
        [id],
      );
      return {
        employeeId: id,
        fullName: person.full_name,
        openTasks,
        canMove,
        takers: rows.map((r) => ({ employeeId: r.id, fullName: r.full_name })),
      };
    });
  }

  /**
   * Turn someone's login off and set their exit date — only once their open
   * work has gone to someone else (moveWork), so nothing is left with a
   * person who can no longer sign in.
   */
  async deactivate(ctx: RlsContext, id: string, input: DeactivateInput): Promise<StartExitResult> {
    requireFirmwide(ctx, 'Only the Managing Partner or an administrator can deactivate someone.');
    const today = istToday();
    const dateOfExit = input.dateOfExit ?? today;
    if (dateOfExit > today) {
      throw new BadRequestException(
        'Deactivating is for today. For a later last day, start their exit instead.',
      );
    }
    const open = await this.db.withRlsContext(ctx, async (client) => {
      await this.requireLive(client, id);
      return this.openTaskCount(client, id);
    });
    if (open > 0) {
      throw new ConflictException(
        `Move their ${open} open task${open === 1 ? '' : 's'} to someone else first.`,
      );
    }
    return this.people.startExit(
      ctx,
      id,
      { dateOfExit, ...(input.reason ? { reason: input.reason } : {}) },
      'all',
    );
  }

  async deleteCheck(ctx: RlsContext, id: string): Promise<DeletePersonCheck> {
    requireAdministrator(ctx);
    return this.db.withRlsContext(ctx, async (client) => {
      const person = await this.requireLive(client, id);
      return { employeeId: id, fullName: person.full_name, ...(await check(client, id)) };
    });
  }

  /**
   * Delete someone permanently (administrator only), in one transaction:
   * blockers re-checked, the typed name matched, hsdg.erase_person, one audit
   * entry. Their HR files' bytes are removed once that has committed.
   */
  async deletePerson(
    ctx: RlsContext,
    id: string,
    input: DeletePersonInput,
  ): Promise<DeletePersonResult> {
    requireAdministrator(ctx);
    if (ctx.employeeId === id) throw new BadRequestException('You cannot delete yourself.');
    const { outcome, refs } = await this.db.withRlsContext(ctx, async (client) => {
      const person = await this.requireLive(client, id);
      if (norm(input.confirmName) !== norm(person.full_name)) {
        throw new BadRequestException(`Type ${person.full_name} exactly to delete them.`);
      }
      const before = await check(client, id);
      if (before.blockers.length) {
        throw new ConflictException(before.blockers.map((b) => b.message).join(' '));
      }
      const { rows } = await guard(() =>
        client.query<{ outcome: 'removed' | 'erased'; storage_refs: string[] }>(
          `SELECT * FROM hsdg.erase_person($1)`,
          [id],
        ),
      );
      if (!rows[0]) throw new NotFoundException('Employee not found.');
      await this.audit.recordWith(client, ctx, {
        action: 'employee.deleted',
        objectType: 'employee',
        objectId: id,
        before: {
          fullName: person.full_name,
          employeeCode: person.employee_code,
          userId: person.user_id,
          email: person.email,
        },
        after: { outcome: rows[0].outcome },
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      });
      return { outcome: rows[0].outcome, refs: rows[0].storage_refs };
    });
    for (const ref of refs) {
      try {
        await this.storage.remove(ref);
      } catch (err) {
        this.logger.warn(`Could not remove a deleted person's HR file: ${String(err)}`);
      }
    }
    return { employeeId: id, outcome };
  }

  private async requireLive(
    client: PoolClient,
    id: string,
  ): Promise<{
    full_name: string;
    employee_code: string;
    user_id: string | null;
    email: string | null;
  }> {
    const { rows } = await client.query<{
      full_name: string;
      employee_code: string;
      user_id: string | null;
      email: string | null;
    }>(
      `SELECT e.full_name, e.employee_code, e.user_id, u.email
         FROM hsdg.employees e LEFT JOIN hsdg.users u ON u.id = e.user_id
        WHERE e.id = $1 AND e.deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Employee not found.');
    return rows[0];
  }

  private async openTaskCount(client: PoolClient, id: string): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.tasks
        WHERE (assigned_to_employee_id = $1 OR reviewer_employee_id = $1) AND ${OPEN_TASK}`,
      [id],
    );
    return rows[0]?.n ?? 0;
  }
}

async function check(
  client: PoolClient,
  id: string,
): Promise<{ hasHistory: boolean; blockers: DeleteBlocker[] }> {
  const { rows } = await guard(() =>
    client.query<{
      open_tasks: number;
      led_engagements: number;
      unpaid_payroll: number;
      has_history: boolean;
    }>(`SELECT * FROM hsdg.person_delete_check($1)`, [id]),
  );
  const r = rows[0]!;
  const blockers: DeleteBlocker[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (r.open_tasks > 0) {
    blockers.push({
      kind: DELETE_BLOCKER.openTasks,
      count: r.open_tasks,
      message: `${plural(r.open_tasks, 'open task is', 'open tasks are')} still theirs: move them to someone else.`,
    });
  }
  if (r.led_engagements > 0) {
    blockers.push({
      kind: DELETE_BLOCKER.ledEngagements,
      count: r.led_engagements,
      message: `They lead ${plural(r.led_engagements, 'open engagement', 'open engagements')}: change the Engagement Partner or Manager.`,
    });
  }
  if (r.unpaid_payroll > 0) {
    blockers.push({
      kind: DELETE_BLOCKER.unpaidPayroll,
      count: r.unpaid_payroll,
      message: `${plural(r.unpaid_payroll, 'pay item is', 'pay items are')} not yet paid: finish the run or the full and final.`,
    });
  }
  return { hasHistory: r.has_history, blockers };
}

function toRosterRow(r: RosterDbRow): PeopleRosterRow {
  return {
    employeeId: r.id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    userId: r.user_id,
    email: r.email,
    loginActive: r.login_active === true,
    gradeSlug: r.grade_slug,
    mainRole: mainRoleOf(r.roles),
    addOns: r.roles.filter((role): role is AddOnRole => addOnSet.has(role)),
    roles: r.roles,
    reportsToId: r.reports_to_id,
    reportsToName: r.reports_to_name,
    officeCode: r.office_code,
    employmentStatus: r.employment_status,
    dateOfExit: r.date_of_exit,
    openTasks: r.open_tasks,
    ledEngagements: r.led_engagements,
    version: r.version,
  };
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function requireFirmwide(ctx: RlsContext, message: string): void {
  if (!isBusinessFirmwide(ctx.role, ctx.roles ?? [])) throw new ForbiddenException(message);
}

function treeMover(ctx: RlsContext): boolean {
  return !!ctx.employeeId && TREE_MOVERS.has(ctx.role);
}

/** For each id, whether it is in the caller's reporting tree (hsdg.subtree). */
async function inTree(client: PoolClient, ids: string[]): Promise<boolean[]> {
  const { rows } = await client.query<{ inside: boolean }>(
    `SELECT x = ANY (hsdg.ctx_subtree()) AS inside
       FROM unnest($1::uuid[]) WITH ORDINALITY AS u(x, n) ORDER BY n`,
    [ids],
  );
  return rows.map((r) => r.inside);
}

function requireAdministrator(ctx: RlsContext): void {
  if (ctx.role !== ROLE.admin && !(ctx.roles ?? []).includes(ROLE.admin)) {
    throw new ForbiddenException('Only an administrator can delete a person permanently.');
  }
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const { code, message } = err as { code?: string; message?: string };
    if (code === '42501') throw new ForbiddenException(message);
    if (code === '55000') throw new ConflictException(message);
    if (code === '22023') throw new BadRequestException(message);
    throw err;
  }
}
