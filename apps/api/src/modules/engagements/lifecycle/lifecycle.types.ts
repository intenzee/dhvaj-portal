import type { EngagementStatus, LifecycleAction } from '@hsdg/contracts';
import type { RlsContext } from '../../../database/rls-context';
import type { EngagementDetail } from '../engagements.types';

/** Input common to every lifecycle transition endpoint. */
export interface LifecycleTransitionInput {
  reason?: string;
  version?: number;
  /** 'put_on_hold' only. */
  expectedResumeDate?: string | null;
}

export interface LifecycleGuardContext {
  ctx: RlsContext;
  /** The engagement as it was immediately before this transition. */
  engagement: EngagementDetail;
  action: LifecycleAction;
  /** Resolved destination status — never null, even for 'resume'. */
  toStatus: EngagementStatus;
  input: LifecycleTransitionInput;
}

/**
 * Extension point for later phases (review sign-off, compliance holds) to
 * plug additional checks into a specific transition without touching the
 * orchestrator. Phase 6 wires only the guards it needs today (§6, §27); a
 * ReviewGuard / ComplianceGuard is future work, not implemented here.
 */
export interface LifecycleGuard {
  readonly name: string;
  check(context: LifecycleGuardContext): void | Promise<void>;
}
