import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  PLANNING_ACTOR_ROLE,
  PLANNING_ACTOR_ROLE_LABEL,
  PLANNING_ATTENTION_LABEL,
  planningVersionLabel,
  type PlanningActorRole,
  type PlanningAttention,
  type PlanningCapabilities,
  type PlanningCapability,
  type PlanningSignalSource,
} from '@hsdg/contracts';

/**
 * 03.1 governance helpers (DHVAJ 03.1 §10, §19, §20, §23): who the acting user
 * is on THIS engagement and what they may do, whether 03.1 is frozen by the
 * Planning approval (03.12), and the Immediate Partner Attention / Manager
 * alert sync every signal and focus-area write runs. No service imports, so
 * `planning-shared.ts` can call into it without a cycle. Everything runs in
 * the caller's RLS transaction.
 */

// ── §23 roles and capabilities ───────────────────────────────────────────────

const NONE: PlanningCapabilities = {
  proposeSignals: false,
  addFacts: false,
  assess: false,
  focusAreas: false,
  discussion: false,
  partnerSignals: false,
  partnerReview: false,
  respondToChallenge: false,
  reopen: false,
};

const MANAGER: PlanningCapabilities = {
  ...NONE,
  proposeSignals: true,
  addFacts: true,
  assess: true,
  focusAreas: true,
  discussion: true,
  respondToChallenge: true,
  reopen: true,
};

/**
 * The §23 matrix. Article / Senior propose and record facts; the Manager
 * assesses and completes; the Partner views all, raises Partner signals /
 * focus areas and challenges IPA. With no Manager assigned the EP also acts
 * as Manager. Firm oversight and admins get no professional capability by
 * role alone.
 */
export function planningCapabilities(
  role: PlanningActorRole,
  actingAsManager = false,
): PlanningCapabilities {
  switch (role) {
    case PLANNING_ACTOR_ROLE.manager:
      return { ...MANAGER };
    case PLANNING_ACTOR_ROLE.partner:
      return {
        ...(actingAsManager ? MANAGER : NONE),
        proposeSignals: true,
        addFacts: true,
        focusAreas: true,
        discussion: true,
        partnerSignals: true,
        partnerReview: true,
        reopen: true,
      };
    case PLANNING_ACTOR_ROLE.team:
      return { ...NONE, proposeSignals: true, addFacts: true };
    default:
      return { ...NONE };
  }
}

const CAPABILITY_DENIED: Record<PlanningCapability, string> = {
  proposeSignals: 'Only the engagement team may propose Planning Signals.',
  addFacts: 'Only the engagement team may record 03.1 facts and evidence.',
  assess:
    'Only the Engagement Manager assesses signals, sets the preliminary strategy and completes 03.1.',
  focusAreas: 'Only the Engagement Manager or Partner may maintain Areas of Focus.',
  discussion: 'Only the Engagement Manager or Partner may record the team planning discussion.',
  partnerSignals: 'Only the Engagement Partner may raise Partner signals.',
  partnerReview:
    'Only the Engagement Partner may acknowledge, challenge or flag Immediate Partner Attention.',
  respondToChallenge: 'Only the Engagement Manager answers an Engagement Partner challenge.',
  reopen: 'Only the Engagement Manager or Partner may reopen 03.1 for revision.',
};

export interface PlanningActor {
  role: PlanningActorRole;
  actingAsManager: boolean;
  employeeId: string | null;
  partnerId: string | null;
  managerId: string | null;
  capabilities: PlanningCapabilities;
}

/** Resolve the acting user's 03.1 role from the engagement assignment (never a firm role alone). */
export async function resolvePlanningActor(
  client: PoolClient,
  engagementId: string,
): Promise<PlanningActor> {
  const { rows } = await client.query<{
    me: string | null;
    partner_id: string | null;
    manager_id: string | null;
    lead: boolean;
    member: boolean;
  }>(
    `SELECT hsdg.ctx_employee_id() AS me, e.engagement_partner_id AS partner_id,
            e.engagement_manager_id AS manager_id,
            hsdg.is_engagement_lead(e.id) AS lead, hsdg.is_engagement_member(e.id) AS member
       FROM hsdg.engagements e WHERE e.id = $1`,
    [engagementId],
  );
  const r = rows[0];
  const me = r?.me ?? null;
  let role: PlanningActorRole = PLANNING_ACTOR_ROLE.none;
  if (r && me) {
    if (me === r.partner_id) role = PLANNING_ACTOR_ROLE.partner;
    else if (me === r.manager_id) role = PLANNING_ACTOR_ROLE.manager;
    else if (r.lead) role = PLANNING_ACTOR_ROLE.oversight;
    else if (r.member) role = PLANNING_ACTOR_ROLE.team;
  }
  const actingAsManager = role === PLANNING_ACTOR_ROLE.partner && !r?.manager_id;
  return {
    role,
    actingAsManager,
    employeeId: me,
    partnerId: r?.partner_id ?? null,
    managerId: r?.manager_id ?? null,
    capabilities: planningCapabilities(role, actingAsManager),
  };
}

/** `scope` names the Section 03 item the write belongs to (03.1 by default). */
export function assertPlanningCapability(
  actor: PlanningActor,
  capability: PlanningCapability,
  scope = '03.1',
) {
  if (!actor.capabilities[capability]) {
    throw new ForbiddenException(
      `${CAPABILITY_DENIED[capability].replace('03.1', scope)} (You are: ${PLANNING_ACTOR_ROLE_LABEL[actor.role]}.)`,
    );
  }
}

/**
 * §23 — who authors a hand-raised signal. A Partner signal needs the EP; a
 * signal from anyone who cannot assess is a PROPOSAL (returns the proposer's
 * employee id) the Manager assesses; otherwise null (a Manager signal).
 */
export function signalAuthorship(
  actor: PlanningActor,
  source: PlanningSignalSource,
): string | null {
  if (source === 'partner') {
    assertPlanningCapability(actor, 'partnerSignals');
    return null;
  }
  if (actor.capabilities.assess) return null;
  assertPlanningCapability(actor, 'proposeSignals');
  return actor.employeeId;
}

/**
 * §18/§23 — a Planning Matter action is progressed by its owner. Without the
 * `discussion` capability (Article / Senior) only one's OWN action may be
 * updated, and only its status / resolution.
 */
export async function assertMatterOwnerScope(
  client: PoolClient,
  engagementId: string,
  ownerEmployeeId: string | null,
  input: object,
): Promise<void> {
  const actor = await resolvePlanningActor(client, engagementId);
  if (actor.capabilities.discussion) return;
  if (!actor.employeeId || ownerEmployeeId !== actor.employeeId) {
    throw new ForbiddenException('Only the action owner or the Engagement Manager may update it.');
  }
  const allowed = new Set(['status', 'resolution', 'version']);
  const other = Object.entries(input)
    .filter(([k, v]) => v !== undefined && !allowed.has(k))
    .map(([k]) => k);
  if (other.length) {
    throw new ForbiddenException(
      'As the action owner you may update its status and resolution only.',
    );
  }
}

/** Record that the EP raised this signal / focus area (it then carries the EP's own acknowledgement). */
export async function markRaisedByPartner(
  client: PoolClient,
  target: { signalId?: string; focusId?: string },
): Promise<void> {
  await client.query(
    `UPDATE hsdg.audit_planning_attention SET raised_by_partner = true
      WHERE (signal_id = $1::uuid OR focus_id = $2::uuid) AND NOT raised_by_partner`,
    [target.signalId ?? null, target.focusId ?? null],
  );
}

/** Close the open controlled revision when 03.1 is completed again. True when one was closed. */
export async function closePlanningRevision(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE hsdg.audit_planning_intelligence_revision
        SET status = 'completed', completed_at = now(),
            completed_by_employee_id = hsdg.ctx_employee_id()
      WHERE workflow_instance_id = $1 AND status = 'open'`,
    [workflowInstanceId],
  );
  return (res.rowCount ?? 0) > 0;
}

// ── §19 controlled revision: the 03.12 lock ──────────────────────────────────

export interface PlanningLockState {
  approved: boolean;
  approvalId: string | null;
  openRevisionId: string | null;
  versionNo: number;
  locked: boolean;
  lockReason: string | null;
}

/** 03.1 is frozen once Planning is approved (03.12), until a controlled revision is opened. */
export async function readPlanningLock(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<PlanningLockState> {
  const { rows } = await client.query<{
    approval_id: string | null;
    approval_version: number | null;
    revision_id: string | null;
    version_no: number | null;
  }>(
    `SELECT (SELECT id FROM hsdg.audit_planning_approvals
              WHERE workflow_instance_id = $1 ORDER BY version DESC LIMIT 1) AS approval_id,
            (SELECT max(version) FROM hsdg.audit_planning_approvals
              WHERE workflow_instance_id = $1) AS approval_version,
            (SELECT id FROM hsdg.audit_planning_intelligence_revision
              WHERE workflow_instance_id = $1 AND status = 'open') AS revision_id,
            (SELECT version_no FROM hsdg.audit_planning_intelligence
              WHERE workflow_instance_id = $1) AS version_no`,
    [workflowInstanceId],
  );
  const r = rows[0]!;
  const versionNo = r.version_no ?? 1;
  const approved = r.approval_id !== null;
  const locked = approved && r.revision_id === null;
  return {
    approved,
    approvalId: r.approval_id,
    openRevisionId: r.revision_id,
    versionNo,
    locked,
    lockReason: locked
      ? `Planning was approved in 03.12 (approval v${r.approval_version}); 03.1 ${planningVersionLabel(versionNo)} is frozen — reopen it for a controlled revision to change it.`
      : null,
  };
}

export async function assertPlanningUnlocked(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<void> {
  const lock = await readPlanningLock(client, workflowInstanceId);
  if (lock.locked) throw new ConflictException(lock.lockReason);
}

// ── Notifications ────────────────────────────────────────────────────────────

/** Emit one notification per distinct recipient (SECURITY DEFINER; de-duplicated per recipient). */
export async function notifyPlanning(
  client: PoolClient,
  recipients: Array<string | null | undefined>,
  n: {
    type: string;
    title: string;
    body: string;
    engagementId: string;
    objectType: string;
    objectId: string;
    dedup: string;
    /** Never notify the person who caused the event. */
    except?: string | null;
  },
): Promise<number> {
  let sent = 0;
  for (const id of new Set(recipients.filter((r): r is string => !!r && r !== n.except))) {
    await client.query(`SELECT hsdg.emit_notification($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      id,
      n.type,
      n.title,
      n.body,
      n.engagementId,
      n.objectType,
      n.objectId,
      `${n.dedup}:${id}`,
      null,
    ]);
    sent += 1;
  }
  return sent;
}

// ── §10 / §19 / §20 attention sync ──────────────────────────────────────────

/** Where a signal came from, as the Manager alert names it. */
const SOURCE_LABEL: Partial<Record<PlanningSignalSource, string>> = {
  section_01: 'Section 01',
  section_02: 'Section 02',
  prior_year: 'Prior year',
  current_year_change: 'Current-year change',
  analytics: '03.2 analytics',
  manager: 'Manager',
  partner: 'Partner',
};

interface AttentionCandidate {
  attention_id: string;
  kind: 'signal' | 'focus_area';
  target_id: string;
  seq: number;
  label: string;
  source: PlanningSignalSource | null;
  attention: PlanningAttention | null;
}

const code = (c: AttentionCandidate) =>
  `${c.kind === 'signal' ? 'PS' : 'FA'}-${String(c.seq).padStart(3, '0')}`;

/**
 * Keep the governance rows in step with the register, then:
 *   • §19 — tell the Manager once about every new Enhanced / Immediate signal
 *     (any source: 03.1, 03.2 analytics, 03.4, prior year, acceptance, changes);
 *   • §10/§20 — surface every Immediate Partner Attention signal and Partner
 *     focus area to the EP's queue and notify the EP (an item the EP raised is
 *     acknowledged on the spot); a downgraded item leaves the queue.
 * Idempotent; the actor is the RLS context's employee.
 */
export async function syncPlanningAttention(
  client: PoolClient,
  engagementId: string,
  workflowInstanceId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO hsdg.audit_planning_attention (workflow_instance_id, engagement_id, signal_id)
     SELECT s.workflow_instance_id, s.engagement_id, s.id
       FROM hsdg.audit_planning_signal s
      WHERE s.workflow_instance_id = $1 AND s.attention IN ('enhanced','immediate_partner')
     ON CONFLICT (signal_id) DO NOTHING`,
    [workflowInstanceId],
  );
  await client.query(
    `INSERT INTO hsdg.audit_planning_attention (workflow_instance_id, engagement_id, focus_id)
     SELECT f.workflow_instance_id, f.engagement_id, f.id
       FROM hsdg.audit_area_of_focus f
      WHERE f.workflow_instance_id = $1 AND f.partner_attention AND f.status <> 'superseded'
     ON CONFLICT (focus_id) DO NOTHING`,
    [workflowInstanceId],
  );

  const { rows: who } = await client.query<{
    me: string | null;
    partner_id: string | null;
    manager_id: string | null;
  }>(
    `SELECT hsdg.ctx_employee_id() AS me, engagement_partner_id AS partner_id,
            engagement_manager_id AS manager_id
       FROM hsdg.engagements WHERE id = $1`,
    [engagementId],
  );
  const me = who[0]?.me ?? null;
  const partnerId = who[0]?.partner_id ?? null;
  const managerId = who[0]?.manager_id ?? null;

  // A downgraded / closed / superseded item leaves the EP's queue.
  await client.query(
    `UPDATE hsdg.audit_planning_attention a
        SET partner_surfaced_at = NULL, partner_status = NULL, version = a.version + 1
      WHERE a.workflow_instance_id = $1 AND a.partner_surfaced_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM hsdg.audit_planning_signal s
           WHERE s.id = a.signal_id AND s.attention = 'immediate_partner' AND s.status <> 'closed'
          UNION ALL
          SELECT 1 FROM hsdg.audit_area_of_focus f
           WHERE f.id = a.focus_id AND f.partner_attention AND f.status <> 'superseded')`,
    [workflowInstanceId],
  );

  // §19 Manager alert — every new Enhanced / Immediate signal, once.
  const { rows: fresh } = await client.query<AttentionCandidate>(
    `UPDATE hsdg.audit_planning_attention a
        SET manager_alerted_at = now()
       FROM hsdg.audit_planning_signal s
      WHERE a.workflow_instance_id = $1 AND a.signal_id = s.id
        AND a.manager_alerted_at IS NULL
        AND s.attention IN ('enhanced','immediate_partner') AND s.status <> 'closed'
     RETURNING a.id AS attention_id, 'signal' AS kind, s.id AS target_id, s.seq,
               s.observation AS label, s.source, s.attention`,
    [workflowInstanceId],
  );
  const managerRecipient = managerId ?? partnerId;
  if (fresh.length) {
    fresh.sort((a, b) => a.seq - b.seq);
    const ipa = fresh.filter((f) => f.attention === 'immediate_partner').length;
    await notifyPlanning(client, [managerRecipient], {
      type: NOTIFICATION_TYPE.planningSignalAlert,
      title:
        fresh.length === 1
          ? `03.1: new ${PLANNING_ATTENTION_LABEL[fresh[0]!.attention!]} signal ${code(fresh[0]!)}`
          : `03.1: ${fresh.length} new Enhanced / Immediate signals${ipa ? ` (${ipa} Immediate Partner Attention)` : ''}`,
      body: fresh
        .slice(0, 8)
        .map(
          (f) =>
            `${code(f)} [${f.source ? (SOURCE_LABEL[f.source] ?? f.source) : 'Signal'}] ${truncate(f.label, 140)}`,
        )
        .concat(fresh.length > 8 ? [`… and ${fresh.length - 8} more.`] : [])
        .join('\n'),
      engagementId,
      objectType: 'audit_planning_signal',
      objectId: fresh[0]!.target_id,
      dedup: `planning_signal_alert:${fresh[0]!.attention_id}`,
      except: me,
    });
  }

  // §10 / §20 — surface to the EP (the EP's own items are acknowledged on the spot).
  const { rows: surfaced } = await client.query<AttentionCandidate>(
    `UPDATE hsdg.audit_planning_attention a
        SET partner_surfaced_at = now(),
            partner_status = CASE WHEN $2::uuid IS NOT NULL AND $2::uuid = $3::uuid
                                  THEN 'acknowledged' ELSE 'surfaced' END,
            reviewed_by_employee_id = CASE WHEN $2::uuid IS NOT NULL AND $2::uuid = $3::uuid
                                           THEN $2::uuid ELSE NULL END,
            reviewed_at = CASE WHEN $2::uuid IS NOT NULL AND $2::uuid = $3::uuid
                               THEN now() ELSE NULL END,
            version = a.version + 1
       FROM (SELECT a2.id,
                    CASE WHEN a2.signal_id IS NOT NULL THEN 'signal' ELSE 'focus_area' END AS kind,
                    COALESCE(s.id, f.id) AS target_id, COALESCE(s.seq, f.seq) AS seq,
                    COALESCE(s.observation, f.name) AS label, s.source, s.attention
               FROM hsdg.audit_planning_attention a2
               LEFT JOIN hsdg.audit_planning_signal s ON s.id = a2.signal_id
               LEFT JOIN hsdg.audit_area_of_focus f ON f.id = a2.focus_id
              WHERE a2.workflow_instance_id = $1 AND a2.partner_surfaced_at IS NULL
                AND ((s.attention = 'immediate_partner' AND s.status <> 'closed')
                     OR (f.partner_attention AND f.status <> 'superseded'))) t
      WHERE a.id = t.id
     RETURNING a.id AS attention_id, t.kind, t.target_id, t.seq, t.label, t.source, t.attention`,
    [workflowInstanceId, me, partnerId],
  );
  if (surfaced.length && partnerId && partnerId !== me) {
    surfaced.sort((a, b) => a.kind.localeCompare(b.kind) || a.seq - b.seq);
    await notifyPlanning(client, [partnerId], {
      type: NOTIFICATION_TYPE.planningPartnerAttention,
      title:
        surfaced.length === 1
          ? `Immediate Partner Attention: ${code(surfaced[0]!)} needs your review`
          : `Immediate Partner Attention: ${surfaced.length} items need your review`,
      body: surfaced
        .slice(0, 8)
        .map((s) => `${code(s)} ${truncate(s.label, 140)}`)
        .concat(surfaced.length > 8 ? [`… and ${surfaced.length - 8} more.`] : [])
        .join('\n'),
      engagementId,
      objectType: surfaced[0]!.kind === 'signal' ? 'audit_planning_signal' : 'audit_area_of_focus',
      objectId: surfaced[0]!.target_id,
      dedup: `planning_partner_attention:${surfaced[0]!.attention_id}:${Date.now()}`,
    });
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
