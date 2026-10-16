import type { FeatureFlag } from './engagement-restructure';

/**
 * Staff Workflow · Rollout (Admin → Rollout). The deploy's FEATURE_FLAGS is the
 * master switch; within it the firm turns each flag on for every office, for a
 * pilot list of offices, or pauses it — without a deploy.
 */
export const ROLLOUT_MODE = { firm: 'firm', offices: 'offices', off: 'off' } as const;
export type RolloutMode = (typeof ROLLOUT_MODE)[keyof typeof ROLLOUT_MODE];
export const ROLLOUT_MODES: RolloutMode[] = Object.values(ROLLOUT_MODE);
export const ROLLOUT_MODE_LABEL: Record<RolloutMode, string> = {
  firm: 'Every office',
  offices: 'Pilot offices only',
  off: 'Paused',
};

/** What each flag switches on, in the words of the plan. */
export const FEATURE_FLAG_LABEL: Record<FeatureFlag, string> = {
  ff_engagement_kinds: 'Engagement kinds',
  ff_calendar_v2: 'Compliance calendar v2',
  ff_gst_tab: 'GST tab',
  ff_compliance_tabs: 'Compliance stream tabs',
  ff_auto_time: 'Automatic time',
  ff_work_links: 'Staff Workflow 1 — rows open the work, review queue, trimmed sidebar',
  ff_today_view: 'Staff Workflow 2 — Today and the filing drawer',
  ff_filing_runs: 'Staff Workflow 3 — filing runs, client chasing, search',
  ff_notices: 'Practice Services 1 — notices, their clock on Today, appeal deadlines',
  ff_billing_v2: 'Practice Services 2 — GST invoices, receipts, receivables, 26AS',
};

/** One flag on Admin → Rollout. */
export interface FeatureRollout {
  flag: FeatureFlag;
  label: string;
  /** In the deploy's FEATURE_FLAGS — when false nothing here can turn it on. */
  deployed: boolean;
  /** The deploy's FEATURE_FLAG_OFFICES for it (null ⇒ firm-wide), used while `mode` is null. */
  deployOffices: string[] | null;
  /** The firm's choice; null ⇒ follow the deploy. */
  mode: RolloutMode | null;
  /** Upper-case office codes, for 'offices'. */
  officeCodes: string[];
  note: string | null;
  /** Where it is on right now: 'all', or the office codes (empty ⇒ nowhere). */
  liveIn: 'all' | string[];
  /** Optimistic lock (0 while there is no row). */
  version: number;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** GET /feature-rollouts */
export interface FeatureRolloutList {
  items: FeatureRollout[];
}

/** PUT /feature-rollouts/:flag — DELETE goes back to the deploy's setting. */
export interface UpdateFeatureRolloutInput {
  mode: RolloutMode;
  officeCodes?: string[];
  note?: string | null;
  /** The version read (0 when there was no row). */
  version: number;
}
