import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { RlsContext } from '../../../database/rls-context';
import { AuditService } from '../../audit/audit.service';
import { selectEngagementDetail } from '../engagement-detail.query';
import { translatePgError } from '../engagements.service';
import type { EngagementDetail } from '../engagements.types';

export interface WorkflowTransitionInput {
  action: string;
  version?: number;
}

interface WorkflowTransitionRow {
  to_state_id: string;
  to_slug: string;
  to_name: string;
  is_active: boolean;
}

/**
 * Service-workflow transitions (§16-19) — how the professional work is
 * performed, tracked as an engagement-level workflow-state instance that is
 * independent of the engagement lifecycle (§17). Foundation only: one generic
 * 'advance' action moving to the next configured state; the review DAG
 * (branching, skip conditions, sign-off) is Phase 7.
 */
@Injectable()
export class EngagementWorkflowService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async advance(
    ctx: RlsContext,
    id: string,
    input: WorkflowTransitionInput,
  ): Promise<EngagementDetail> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await selectEngagementDetail(client, id);
      if (!before) throw new NotFoundException('Engagement not found.');

      // Operational floor: the service workflow only moves while the
      // engagement itself is actively being worked (mirrors the §16-17
      // examples, which always pair a workflow state with lifecycle ACTIVE).
      if (before.status !== 'active') {
        throw new BadRequestException(
          `Cannot advance the service workflow while the engagement is "${before.status}" (must be "active").`,
        );
      }
      if (!before.currentWorkflowState) {
        throw new BadRequestException(
          'The service workflow has not been started yet (call "start" on the engagement first).',
        );
      }

      const { rows } = await client.query<WorkflowTransitionRow>(
        `SELECT wt.to_state_id, ts.slug AS to_slug, ts.name AS to_name, wt.is_active
         FROM hsdg.workflow_transitions wt
         JOIN hsdg.workflow_states ts ON ts.id = wt.to_state_id
         WHERE wt.from_state_id = $1 AND wt.action = $2`,
        [before.currentWorkflowState.id, input.action],
      );
      const transition = rows[0];
      if (!transition || !transition.is_active) {
        throw new BadRequestException(
          `Invalid workflow transition: cannot "${input.action}" from state "${before.currentWorkflowState.slug}".`,
        );
      }

      const params: unknown[] = [transition.to_state_id, id, before.currentWorkflowState.id];
      let versionClause = '';
      if (input.version !== undefined) {
        params.push(input.version);
        versionClause = ` AND version = $${params.length}`;
      }

      let updated: number;
      try {
        const result = await client.query(
          `UPDATE hsdg.engagements
           SET current_workflow_state_id = $1, version = version + 1
           WHERE id = $2 AND current_workflow_state_id = $3${versionClause}`,
          params,
        );
        updated = result.rowCount ?? 0;
      } catch (err) {
        throw translatePgError(err);
      }
      if (updated === 0) {
        throw new ConflictException(
          'Engagement was modified by someone else. Refresh and retry (stale version).',
        );
      }

      const after = await selectEngagementDetail(client, id);
      await this.audit.recordWith(client, ctx, {
        action: 'engagement.workflow_state_changed',
        objectType: 'engagement',
        objectId: id,
        before: { workflowState: before.currentWorkflowState.slug },
        after: { workflowState: transition.to_slug },
      });

      return after!;
    });
  }
}
