import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LIFECYCLE_ACTION, ROLE, type LifecycleAction } from '@hsdg/contracts';
import type { LifecycleGuard, LifecycleGuardContext } from './lifecycle.types';

/**
 * ACCEPT requires the accountable EP already be set. The database CHECK
 * (`engagements_ep_required_when_accepted`) is the authoritative floor — this
 * guard exists only to fail fast with a clear message before hitting SQL.
 * "More than one EP" (§7) cannot occur: the schema has exactly one
 * `engagement_partner_id` column, so uniqueness is structural, not a runtime
 * check.
 */
export const epRequiredGuard: LifecycleGuard = {
  name: 'ep-required',
  check({ engagement }: LifecycleGuardContext) {
    if (!engagement.engagementPartnerId) {
      throw new BadRequestException(
        'Cannot accept: the engagement has no accountable Engagement Partner assigned.',
      );
    }
  },
};

/**
 * Governance actions (currently: reopen) require the Managing Partner
 * specifically — never a generic "firm-wide" shortcut, and never satisfied by
 * the platform admin (who is deliberately not business-firm-wide; ADR-0009).
 * The engagements_update RLS floor alone would also let the EP/manager
 * through, so this is an explicit application-layer ceiling on top of it.
 */
export const managingPartnerOnlyGuard: LifecycleGuard = {
  name: 'managing-partner-only',
  check({ ctx }: LifecycleGuardContext) {
    if (ctx.role !== ROLE.managingPartner) {
      throw new ForbiddenException('Only the Managing Partner may perform this action.');
    }
  },
};

/** put_on_hold and reopen must record why (§11, §12). */
export const reasonRequiredGuard: LifecycleGuard = {
  name: 'reason-required',
  check({ input }: LifecycleGuardContext) {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new BadRequestException('A reason is required for this action.');
    }
  },
};

/**
 * COMPLETE requires the service workflow to have reached its terminal state
 * (§6, §20) — a shallow "did the operational workflow finish" check, not a
 * review/sign-off decision. Phase 7 extends or replaces this with the real
 * review engine; this is the extension point it plugs into.
 */
export const workflowTerminalGuard: LifecycleGuard = {
  name: 'workflow-terminal',
  check({ engagement }: LifecycleGuardContext) {
    if (!engagement.currentWorkflowState?.isTerminal) {
      throw new BadRequestException(
        `Cannot complete: the service workflow has not reached its terminal state ` +
          `(currently: ${engagement.currentWorkflowState?.name ?? 'not started'}).`,
      );
    }
  },
};

/**
 * The guard chain per lifecycle action. Exhaustive over {@link LifecycleAction}
 * so a new action added to the contract forces a decision here. This is where
 * business/security rules live (§5) — the DB transition table only says which
 * from/to shapes exist, never who may use them or under what conditions.
 */
export const LIFECYCLE_GUARDS: Record<LifecycleAction, LifecycleGuard[]> = {
  [LIFECYCLE_ACTION.submitForAcceptance]: [],
  [LIFECYCLE_ACTION.accept]: [epRequiredGuard],
  [LIFECYCLE_ACTION.start]: [],
  [LIFECYCLE_ACTION.putOnHold]: [reasonRequiredGuard],
  [LIFECYCLE_ACTION.resume]: [],
  [LIFECYCLE_ACTION.complete]: [workflowTerminalGuard],
  [LIFECYCLE_ACTION.close]: [],
  [LIFECYCLE_ACTION.decline]: [],
  [LIFECYCLE_ACTION.withdraw]: [],
  [LIFECYCLE_ACTION.cancel]: [],
  [LIFECYCLE_ACTION.reopen]: [managingPartnerOnlyGuard, reasonRequiredGuard],
};
