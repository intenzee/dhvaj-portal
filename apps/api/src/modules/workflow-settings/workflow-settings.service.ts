import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FIRM_CHECK_KEYS,
  suggestedInternalDueDays,
  toFirmChecks,
  type FirmChecks,
  type FormInternalDue,
  type FormInternalDueList,
  type FormInternalDueUpdate,
  type UpdateFirmChecksInput,
  type UpdateWorkflowSettingsInput,
  type WorkflowSettings,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { canSwitchChecks } from './firm-checks';

interface SettingsRow {
  default_reviewer: WorkflowSettings['defaultReviewer'];
  article_client_scope: WorkflowSettings['articleClientScope'];
  client_reminder_channel: WorkflowSettings['clientReminderChannel'];
  bulk_assign_scope: WorkflowSettings['bulkAssignScope'];
  client_reminder_days: number;
  client_escalation_days: number;
  strict_checks: Record<string, unknown> | null;
  version: number;
  updated_at: Date;
  updated_by_name: string | null;
}

interface FormRow {
  id: string;
  code: string;
  label: string;
  stream: string | null;
  days: number;
}

/** Column per settable field, in PATCH order. */
const COLUMNS = {
  defaultReviewer: 'default_reviewer',
  articleClientScope: 'article_client_scope',
  clientReminderChannel: 'client_reminder_channel',
  bulkAssignScope: 'bulk_assign_scope',
  clientReminderDays: 'client_reminder_days',
  clientEscalationDays: 'client_escalation_days',
} as const satisfies Record<Exclude<keyof UpdateWorkflowSettingsInput, 'version'>, string>;

/**
 * Staff Workflow · Questions for the partners, answered as firm settings
 * (Admin → Workflow). The policy columns live on the single firm_settings row;
 * the per-form internal due date is a firm override per compliance rule.
 */
@Injectable()
export class WorkflowSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async get(ctx: RlsContext): Promise<WorkflowSettings> {
    return this.db.withRlsContext(ctx, (client) => this.read(client, ctx));
  }

  async update(ctx: RlsContext, input: UpdateWorkflowSettingsInput): Promise<WorkflowSettings> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.read(client, ctx);
      const next = {
        reminder: input.clientReminderDays ?? before.clientReminderDays,
        escalation: input.clientEscalationDays ?? before.clientEscalationDays,
      };
      if (next.escalation > next.reminder) {
        throw new BadRequestException(
          'Escalate on or after the reminder: escalation days cannot be more than reminder days.',
        );
      }
      const sets: string[] = [];
      const values: unknown[] = [input.version];
      for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
        if (input[key] === undefined) continue;
        values.push(input[key]);
        sets.push(`${column} = $${values.length}`);
      }
      values.push(ctx.employeeId ?? null);
      const res = await client.query(
        `UPDATE hsdg.firm_settings
            SET ${[...sets, 'version = version + 1', `updated_by_employee_id = $${values.length}`].join(', ')}
          WHERE version = $1`,
        values,
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'The workflow settings changed since you loaded them; refresh and retry.',
        );
      }
      const after = await this.read(client, ctx);
      await this.audit.recordWith(client, ctx, {
        action: 'workflow_settings.updated',
        objectType: 'firm_settings',
        objectId: null,
        before: pick(before, input),
        after: pick(after, input),
      });
      return after;
    });
  }

  /**
   * Switch the firm's checks on or off (the managing partner or the
   * administrator; audited). Checks not named keep their state.
   */
  async updateChecks(ctx: RlsContext, input: UpdateFirmChecksInput): Promise<WorkflowSettings> {
    if (!canSwitchChecks(ctx)) {
      throw new ForbiddenException(
        "Only the managing partner or the administrator can change the firm's checks.",
      );
    }
    const named = Object.entries(input.checks ?? {});
    if (named.length === 0) throw new BadRequestException('Name at least one check.');
    for (const [key, on] of named) {
      if (!(FIRM_CHECK_KEYS as string[]).includes(key)) {
        throw new BadRequestException(`Unknown check: ${key}.`);
      }
      if (typeof on !== 'boolean') {
        throw new BadRequestException(`Check ${key} must be on (true) or off (false).`);
      }
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.read(client, ctx);
      const checks: FirmChecks = { ...before.checks, ...input.checks };
      // Only the checks that are on are stored: a missing key is off.
      const stored = Object.fromEntries(Object.entries(checks).filter(([, on]) => on));
      let rowCount: number;
      try {
        const res = await client.query(
          `UPDATE hsdg.firm_settings
              SET strict_checks = $2::jsonb, version = version + 1, updated_by_employee_id = $3
            WHERE version = $1`,
          [input.version, JSON.stringify(stored), ctx.employeeId ?? null],
        );
        rowCount = res.rowCount ?? 0;
      } catch (err) {
        if ((err as { code?: string }).code === '42501') {
          throw new ForbiddenException((err as Error).message);
        }
        throw err;
      }
      if (rowCount === 0) {
        throw new ConflictException(
          'The workflow settings changed since you loaded them; refresh and retry.',
        );
      }
      const after = await this.read(client, ctx);
      const changed = named.map(([k]) => k as keyof FirmChecks);
      await this.audit.recordWith(client, ctx, {
        action: 'workflow_settings.checks_updated',
        objectType: 'firm_settings',
        objectId: null,
        before: Object.fromEntries(changed.map((k) => [k, before.checks[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after.checks[k]])),
      });
      return after;
    });
  }

  /** Every active form with the buffer in force today and the plan's suggestion. */
  async internalDue(ctx: RlsContext): Promise<FormInternalDueList> {
    return this.db.withRlsContext(ctx, async (client) => ({
      items: (await this.forms(client)).map(toForm),
    }));
  }

  async setInternalDue(
    ctx: RlsContext,
    ruleId: string,
    days: number,
  ): Promise<FormInternalDueUpdate> {
    return this.db.withRlsContext(ctx, async (client) => {
      const [before] = await this.forms(client, ruleId);
      if (!before) throw new NotFoundException('Form not found.');
      let moved: number;
      try {
        const { rows } = await client.query<{ moved: number }>(
          `SELECT hsdg.set_internal_due_days($1, $2) AS moved`,
          [ruleId, days],
        );
        moved = rows[0]!.moved;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '42501')
          throw new ForbiddenException('Only a partner may set internal due dates.');
        if (code === '22023') throw new BadRequestException((err as Error).message);
        throw err;
      }
      const [after] = await this.forms(client, ruleId);
      await this.audit.recordWith(client, ctx, {
        action: 'workflow_settings.internal_due_set',
        objectType: 'compliance_rule',
        objectId: ruleId,
        before: { internalSlaOffsetDays: before.days },
        after: { internalSlaOffsetDays: days, filingsRedated: moved },
      });
      return { item: toForm(after!), filingsRedated: moved };
    });
  }

  private async read(client: PoolClient, ctx: RlsContext): Promise<WorkflowSettings> {
    const { rows } = await client.query<SettingsRow>(
      `SELECT f.default_reviewer, f.article_client_scope, f.client_reminder_channel,
              f.bulk_assign_scope, f.client_reminder_days, f.client_escalation_days,
              f.strict_checks, f.version,
              f.updated_at, e.full_name AS updated_by_name
         FROM hsdg.firm_settings f
         LEFT JOIN hsdg.employees e ON e.id = f.updated_by_employee_id
        LIMIT 1`,
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('The firm has no settings row.');
    return {
      defaultReviewer: r.default_reviewer,
      articleClientScope: r.article_client_scope,
      clientReminderChannel: r.client_reminder_channel,
      bulkAssignScope: r.bulk_assign_scope,
      clientReminderDays: r.client_reminder_days,
      clientEscalationDays: r.client_escalation_days,
      checks: toFirmChecks(r.strict_checks),
      checksEditable: canSwitchChecks(ctx),
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
      updatedByName: r.updated_by_name,
    };
  }

  /** Active rules with the version in force today; one rule when `ruleId` is given. */
  private async forms(client: PoolClient, ruleId?: string): Promise<FormRow[]> {
    const { rows } = await client.query<FormRow>(
      `SELECT r.id, r.code, COALESCE(v.form_label, r.name) AS label, v.stream,
              hsdg.internal_due_days(r.id, v.internal_sla_offset_days) AS days
         FROM hsdg.compliance_rules r
         JOIN LATERAL (
           SELECT v.form_label, v.stream, v.internal_sla_offset_days
             FROM hsdg.compliance_rule_versions v
            WHERE v.compliance_rule_id = r.id AND v.effective_from <= current_date
            ORDER BY v.effective_from DESC LIMIT 1) v ON true
        WHERE r.is_active AND ($1::uuid IS NULL OR r.id = $1)
        ORDER BY v.stream NULLS LAST, label, r.code`,
      [ruleId ?? null],
    );
    return rows;
  }
}

function toForm(r: FormRow): FormInternalDue {
  return {
    ruleId: r.id,
    ruleCode: r.code,
    label: r.label,
    stream: r.stream,
    internalSlaOffsetDays: r.days,
    suggestedDays: suggestedInternalDueDays(r.label, r.stream),
  };
}

/** The fields a PATCH named, for the audit trail. */
function pick(s: WorkflowSettings, input: UpdateWorkflowSettingsInput): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[])
      .filter((k) => input[k] !== undefined)
      .map((k) => [k, s[k]]),
  );
}
