import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLE, type ServiceLineLeadResult } from '@hsdg/contracts';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AuditService } from '../../audit/audit.service';

export const STREAM_LEAD_ONLY =
  'Only an administrator or the Managing Partner changes a stream lead.';

/** Whether the caller may change a stream lead: an administrator or the Managing Partner. */
export function canChangeStreamLead(ctx: Pick<RlsContext, 'role' | 'roles'>): boolean {
  const roles = new Set<string>([ctx.role, ...(ctx.roles ?? [])]);
  return roles.has(ROLE.admin) || roles.has(ROLE.managingPartner);
}

/**
 * Change who leads a stream (an engagement service line) after set-up.
 * Administrator and Managing Partner only — checked here and again in the
 * database (hsdg.set_service_line_lead), which also lets them do it on an
 * engagement they are not on. Audited.
 */
@Injectable()
export class StreamLeadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async setLead(
    ctx: RlsContext,
    engagementId: string,
    lineId: string,
    employeeId: string | null,
  ): Promise<ServiceLineLeadResult> {
    if (!canChangeStreamLead(ctx)) throw new ForbiddenException(STREAM_LEAD_ONLY);
    return this.db.withRlsContext(ctx, async (client) => {
      let before: string | null;
      try {
        const { rows } = await client.query<{ before_lead: string | null }>(
          `SELECT before_lead FROM hsdg.set_service_line_lead($1, $2, $3)`,
          [engagementId, lineId, employeeId],
        );
        before = rows[0]?.before_lead ?? null;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '42501') throw new ForbiddenException(STREAM_LEAD_ONLY);
        if (code === 'P0002')
          throw new NotFoundException('That stream was not found on this engagement.');
        if (code === '22023')
          throw new BadRequestException('That stream is cancelled; its lead cannot change.');
        if (code === '23503') throw new BadRequestException('The lead must be a current employee.');
        throw err;
      }
      const { rows: names } = await client.query<{ id: string; full_name: string }>(
        `SELECT id, full_name FROM hsdg.employees WHERE id = ANY($1::uuid[])`,
        [[before, employeeId].filter((x): x is string => !!x)],
      );
      const name = (id: string | null) =>
        id ? (names.find((n) => n.id === id)?.full_name ?? null) : null;
      if (before !== employeeId) {
        await this.audit.recordWith(client, ctx, {
          action: 'engagement_service.lead_changed',
          objectType: 'engagement_service',
          objectId: lineId,
          before: { engagementId, leadEmployeeId: before, leadName: name(before) },
          after: { engagementId, leadEmployeeId: employeeId, leadName: name(employeeId) },
        });
      }
      return {
        engagementServiceId: lineId,
        leadEmployeeId: employeeId,
        leadName: name(employeeId),
        previousLeadEmployeeId: before,
      };
    });
  }
}
