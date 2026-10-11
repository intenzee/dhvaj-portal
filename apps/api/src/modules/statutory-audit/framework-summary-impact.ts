import type { PoolClient } from 'pg';
import {
  FRAMEWORK_SOURCE_SECTION_LABEL,
  NOTIFICATION_TYPE,
  REPORTING_CARD,
  type FrameworkChangeType,
  type FrameworkImpactAnalysis,
  type FrameworkPriorYearChange,
  type FrameworkRevisionNotice,
  type FrameworkSnapshotFacts,
  type FrameworkSourceSection,
  type FrameworkWorkLink,
} from '@hsdg/contracts';
import type { RlsContext } from '../../database/rls-context';
import { readApprovedSnapshotOn } from './framework-approval-read';
import { readFrameworkEngagementOn, readFrameworkRecordInputsOn } from './framework-summary-inputs';
import { supersedeFrameworkMemoOn } from './framework-summary-memo';
import {
  WORK_AREAS_BY_CHANGE,
  diffSnapshotFacts,
  impactFingerprint,
  impactItemsFor,
  matterSourceOf,
  reportingImpactsOf,
  snapshotFactsOf,
  type DownstreamWorkItem,
} from './framework-summary-records';
import { readOtherReportingResultOn } from './other-reporting-read';

/** What A's reopen() hands Track B (§15–§17). */
export interface FrameworkReopenedEvent {
  workflowInstanceId: string;
  engagementId: string;
  fromBaselineId: string;
  toBaselineId: string;
  fromVersion: string;
  toVersion: string;
  reason: string;
  affectedSections: FrameworkSourceSection[];
}

/** What A's approve() hands Track B once a baseline is approved (§14, §17). */
export interface FrameworkApprovedEvent {
  workflowInstanceId: string;
  engagementId: string;
  baselineId: string;
  version: string;
  /** The approved baseline this one supersedes (a re-approval after reopen), else null. */
  supersededBaselineId: string | null;
}

// ── Downstream work (§14, §16, §17) ──────────────────────────────────────────

const CARD_CHANGES: Record<string, FrameworkChangeType[]> = {
  [REPORTING_CARD.r11gAuditTrail]: ['systems', 'statutory_reporting'],
  [REPORTING_CARD.s197Remuneration]: ['entity_classification', 'statutory_reporting'],
  [REPORTING_CARD.caro]: ['caro'],
  [REPORTING_CARD.s143Icfr]: ['icfr'],
  [REPORTING_CARD.branchReporting]: ['other_auditor'],
};

/**
 * Every live downstream work item of the audit file that a framework change can
 * touch: Audit Work areas, the CARO programme, the statutory ICFR workstream,
 * group components / branches and the 02.7 reporting workpapers. DI-free.
 */
export async function readDownstreamWorkOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<DownstreamWorkItem[]> {
  const out: DownstreamWorkItem[] = [];
  const { rows: areas } = await client.query<{
    id: string;
    title: string;
    origin_area_key: string | null;
    state: string;
    conclusion_state: string | null;
    owner_employee_id: string | null;
    owner_name: string | null;
  }>(
    `SELECT w.id, w.title, w.origin_area_key, w.state, w.conclusion_state, w.owner_employee_id,
            o.full_name AS owner_name
       FROM hsdg.audit_work_areas w
       LEFT JOIN hsdg.employees o ON o.id = w.owner_employee_id
      WHERE w.workflow_instance_id = $1 AND w.is_active
      ORDER BY w.sort_order, w.title`,
    [workflowInstanceId],
  );
  for (const a of areas) {
    const key = a.origin_area_key ?? '';
    const changeTypes = (Object.keys(WORK_AREAS_BY_CHANGE) as FrameworkChangeType[]).filter((c) =>
      WORK_AREAS_BY_CHANGE[c].includes(key),
    );
    if (!changeTypes.length) continue;
    out.push({
      kind: 'work_area',
      ref: a.id,
      label: a.title,
      section: matterSourceOf(`framework:${key}`),
      changeTypes,
      ownerEmployeeId: a.owner_employee_id,
      ownerName: a.owner_name,
      completed: a.state === 'complete' || a.conclusion_state === 'submitted',
      state: a.state,
    });
  }
  const { rows: caro } = await client.query<{ id: string; order_code: string | null }>(
    `SELECT id, order_code FROM hsdg.audit_caro_programme
      WHERE workflow_instance_id = $1 AND status = 'active' AND withdrawn_at IS NULL`,
    [workflowInstanceId],
  );
  for (const c of caro)
    out.push({
      kind: 'caro_programme',
      ref: c.id,
      label: 'CARO 2020 work programme',
      section: '02.4',
      changeTypes: ['caro'],
      ownerEmployeeId: null,
      ownerName: null,
      completed: false,
      state: 'active',
    });
  const { rows: icfr } = await client.query<{ id: string; conclusion: string | null }>(
    `SELECT id, conclusion FROM hsdg.audit_icfr_workstream
      WHERE workflow_instance_id = $1 AND status = 'active' AND withdrawn_at IS NULL`,
    [workflowInstanceId],
  );
  for (const w of icfr)
    out.push({
      kind: 'icfr_workstream',
      ref: w.id,
      label: 'Statutory ICFR workstream',
      section: '02.5',
      changeTypes: ['icfr'],
      ownerEmployeeId: null,
      ownerName: null,
      completed: w.conclusion != null,
      state: w.conclusion ?? 'active',
    });
  const { rows: comps } = await client.query<{
    id: string;
    component_name: string;
    auditor_type: string | null;
  }>(
    `SELECT id, component_name, auditor_type FROM hsdg.audit_group_component
      WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL ORDER BY sort_order`,
    [workflowInstanceId],
  );
  for (const c of comps)
    out.push({
      kind: 'group_component',
      ref: c.id,
      label: `Component: ${c.component_name}`,
      section: '02.6',
      changeTypes:
        c.auditor_type === 'other_auditor'
          ? ['group_structure', 'other_auditor']
          : ['group_structure'],
      ownerEmployeeId: null,
      ownerName: null,
      completed: false,
      state: c.auditor_type,
    });
  const { rows: branches } = await client.query<{
    id: string;
    branch_name: string;
    conclusion: string;
  }>(
    `SELECT id, branch_name, conclusion FROM hsdg.audit_group_branch
      WHERE workflow_instance_id = $1 AND withdrawn_at IS NULL ORDER BY sort_order`,
    [workflowInstanceId],
  );
  for (const b of branches)
    out.push({
      kind: 'group_branch',
      ref: b.id,
      label: `Branch: ${b.branch_name}`,
      section: '02.6',
      changeTypes: ['other_auditor'],
      ownerEmployeeId: null,
      ownerName: null,
      completed: b.conclusion !== 'pending',
      state: b.conclusion,
    });
  const other = await readOtherReportingResultOn(client, workflowInstanceId);
  for (const c of other?.cards ?? []) {
    const changeTypes =
      CARD_CHANGES[c.key] ??
      (c.key.startsWith('rule_11_') ? (['statutory_reporting'] as FrameworkChangeType[]) : null);
    if (!changeTypes) continue;
    if (c.state.workStatus === 'not_started' || c.state.workStatus === 'not_required') continue;
    out.push({
      kind: 'reporting_card',
      ref: c.key,
      label: `${c.clause} ${c.requirement}`.trim(),
      section: '02.7',
      changeTypes,
      ownerEmployeeId: null,
      ownerName: c.state.reviewedByName,
      completed: c.state.workStatus === 'complete',
      state: c.state.workStatus,
    });
  }
  return out;
}

/** Link (upsert) the live downstream work to a baseline (§14). */
async function linkDownstreamWorkOn(
  client: PoolClient,
  workflowInstanceId: string,
  engagementId: string,
  baselineId: string,
  relation: 'configured_by' | 'superseded',
): Promise<DownstreamWorkItem[]> {
  const work = await readDownstreamWorkOn(client, workflowInstanceId);
  for (const w of work)
    await client.query(
      `INSERT INTO hsdg.audit_framework_work_link
         (baseline_id, workflow_instance_id, engagement_id, work_kind, work_ref, label, section,
          owner_employee_id, state_at_link, completed, relation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (baseline_id, work_kind, work_ref) DO UPDATE
         SET label = EXCLUDED.label, owner_employee_id = EXCLUDED.owner_employee_id,
             state_at_link = EXCLUDED.state_at_link, completed = EXCLUDED.completed`,
      [
        baselineId,
        workflowInstanceId,
        engagementId,
        w.kind,
        w.ref,
        w.label,
        w.section,
        w.ownerEmployeeId,
        w.state,
        w.completed,
        relation,
      ],
    );
  return work;
}

/** The work preserved against a superseded baseline (§17). */
export async function readSupersededWorkOn(
  client: PoolClient,
  baselineId: string,
): Promise<FrameworkWorkLink[]> {
  const { rows } = await client.query<{
    work_kind: FrameworkWorkLink['workKind'];
    work_ref: string;
    label: string;
    section: string;
    owner_name: string | null;
    completed: boolean;
    relation: FrameworkWorkLink['relation'];
    reassessment_required: boolean;
    reassessment_reason: string | null;
  }>(
    `SELECT l.work_kind, l.work_ref, l.label, l.section, o.full_name AS owner_name, l.completed,
            l.relation, l.reassessment_required, l.reassessment_reason
       FROM hsdg.audit_framework_work_link l
       LEFT JOIN hsdg.employees o ON o.id = l.owner_employee_id
      WHERE l.baseline_id = $1
      ORDER BY l.reassessment_required DESC, l.section, l.label`,
    [baselineId],
  );
  return rows.map((r) => ({
    workKind: r.work_kind,
    workRef: r.work_ref,
    label: r.label,
    section: FRAMEWORK_SOURCE_SECTION_LABEL[r.section as FrameworkSourceSection] ?? r.section,
    ownerName: r.owner_name,
    completed: r.completed,
    relation: r.relation,
    reassessmentRequired: r.reassessment_required,
    reassessmentReason: r.reassessment_reason,
  }));
}

// ── Notifications (§17) ──────────────────────────────────────────────────────

async function notifyOn(
  client: PoolClient,
  recipients: Array<string | null | undefined>,
  n: {
    type: string;
    title: string;
    body: string;
    engagementId: string;
    objectId: string;
    dedup: string;
    correlationId?: string | null;
  },
): Promise<void> {
  for (const id of new Set(recipients.filter((r): r is string => !!r)))
    await client.query(`SELECT hsdg.emit_notification($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      id,
      n.type,
      n.title,
      n.body,
      n.engagementId,
      'audit_framework_baseline',
      n.objectId,
      `${n.dedup}:${id}`,
      n.correlationId ?? null,
    ]);
}

// ── The change-impact analysis (§16) ─────────────────────────────────────────

interface RevisionRow {
  id: string;
  version: string;
  status: string;
  reopened_from_version: string | null;
  reopen_reason: string | null;
  reopened_at: Date | null;
  reopen_affected_sections: string[] | null;
}

async function readRevisionOn(client: PoolClient, baselineId: string): Promise<RevisionRow | null> {
  const { rows } = await client.query<RevisionRow>(
    `SELECT id, version, status, reopened_from_version, reopen_reason, reopened_at,
            reopen_affected_sections
       FROM hsdg.audit_framework_baseline WHERE id = $1`,
    [baselineId],
  );
  return rows[0] ?? null;
}

interface LiveImpact {
  revision: RevisionRow;
  comparedTo: { baselineId: string; version: string };
  changes: FrameworkPriorYearChange[];
  analysis: FrameworkImpactAnalysis;
  fingerprint: string;
}

async function computeImpactOn(
  client: PoolClient,
  workflowInstanceId: string,
  baselineId: string,
): Promise<LiveImpact | null> {
  const revision = await readRevisionOn(client, baselineId);
  if (!revision?.reopened_from_version) return null;
  const prior = await readApprovedSnapshotOn(
    client,
    workflowInstanceId,
    revision.reopened_from_version,
  );
  if (!prior) return null;
  let current: FrameworkSnapshotFacts;
  if (revision.status === 'approved') {
    const own = await readApprovedSnapshotOn(client, workflowInstanceId, revision.version);
    current =
      own?.snapshot.facts ??
      snapshotFactsOf(await readFrameworkRecordInputsOn(client, workflowInstanceId));
  } else {
    current = snapshotFactsOf(await readFrameworkRecordInputsOn(client, workflowInstanceId));
  }
  // The methodology is named by the Partner at approval, not a fact of the revision.
  const changes = diffSnapshotFacts(prior.snapshot.facts, {
    ...current,
    methodologyVersion: prior.snapshot.facts?.methodologyVersion ?? current.methodologyVersion,
  });
  const eng = await readFrameworkEngagementOn(client, workflowInstanceId);
  const work = await readDownstreamWorkOn(client, workflowInstanceId);
  const items = impactItemsFor(changes, work, eng?.managerName ?? null);
  const fingerprint = impactFingerprint(items);
  const { rows } = await client.query<{
    fingerprint: string | null;
    confirmed_at: Date | null;
    confirmation_note: string | null;
    confirmed_by_name: string | null;
  }>(
    `SELECT i.fingerprint, i.confirmed_at, i.confirmation_note, e.full_name AS confirmed_by_name
       FROM hsdg.audit_framework_impact i
       LEFT JOIN hsdg.employees e ON e.id = i.confirmed_by_employee_id
      WHERE i.baseline_id = $1`,
    [baselineId],
  );
  const c = rows[0];
  // A confirmation stands only while the first pass it confirmed is unchanged.
  const valid = c?.confirmed_at != null && c.fingerprint === fingerprint;
  return {
    revision,
    comparedTo: { baselineId: prior.baselineId, version: prior.version },
    changes,
    fingerprint,
    analysis: {
      baselineVersion: revision.version,
      comparedToVersion: prior.version,
      items,
      confirmedByName: valid ? c!.confirmed_by_name : null,
      confirmedAt: valid ? c!.confirmed_at!.toISOString() : null,
      confirmationNote: valid ? c!.confirmation_note : null,
    },
  };
}

/**
 * The change-impact analysis of the current revision vs the approved baseline it
 * supersedes (§16), or null when the current baseline is not a revision. The
 * first pass is computed live from the facts; the professional confirmation
 * counts only while the first pass it confirmed still stands. DI-free.
 */
export async function readImpactOn(
  client: PoolClient,
  workflowInstanceId: string,
  baselineId: string | null,
): Promise<FrameworkImpactAnalysis | null> {
  if (!baselineId) return null;
  return (await computeImpactOn(client, workflowInstanceId, baselineId))?.analysis ?? null;
}

/**
 * Professional confirmation of the system first pass (§15). Freezes the items
 * and their fingerprint, then notifies the owners of the downstream work that is
 * created, invalidated or requires reassessment (§17).
 */
export async function confirmImpactOn(
  client: PoolClient,
  ctx: RlsContext,
  workflowInstanceId: string,
  engagementId: string,
  baselineId: string,
  note: string | null,
): Promise<FrameworkImpactAnalysis | null> {
  const live = await computeImpactOn(client, workflowInstanceId, baselineId);
  if (!live) return null;
  await client.query(
    `INSERT INTO hsdg.audit_framework_impact
       (baseline_id, compared_to_baseline_id, workflow_instance_id, engagement_id, items,
        fingerprint, confirmed_by_employee_id, confirmed_at, confirmation_note, notified_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now(), $8, now())
     ON CONFLICT (baseline_id) DO UPDATE
       SET items = EXCLUDED.items, fingerprint = EXCLUDED.fingerprint,
           confirmed_by_employee_id = EXCLUDED.confirmed_by_employee_id,
           confirmed_at = now(), confirmation_note = EXCLUDED.confirmation_note, notified_at = now()`,
    [
      baselineId,
      live.comparedTo.baselineId,
      workflowInstanceId,
      engagementId,
      JSON.stringify(live.analysis.items),
      live.fingerprint,
      ctx.employeeId ?? null,
      note?.trim() || null,
    ],
  );
  // Flag the superseded-baseline work each confirmed change touches.
  const work = await readDownstreamWorkOn(client, workflowInstanceId);
  const touched = work.filter((w) =>
    live.changes.some((c) => w.changeTypes.includes(c.changeType)),
  );
  for (const w of touched)
    await client.query(
      `UPDATE hsdg.audit_framework_work_link
          SET reassessment_required = true,
              reassessment_reason = COALESCE(reassessment_reason, $4)
        WHERE baseline_id = $1 AND work_kind = $2 AND work_ref = $3`,
      [
        live.comparedTo.baselineId,
        w.kind,
        w.ref,
        `Framework v${live.revision.version} changes the conclusion this work was configured from.`,
      ],
    );
  const eng = await readFrameworkEngagementOn(client, workflowInstanceId);
  const newWork = live.analysis.items.flatMap((i) => i.newWorkRequired);
  if (live.analysis.items.length)
    await notifyOn(client, [...touched.map((w) => w.ownerEmployeeId), eng?.managerId], {
      type: NOTIFICATION_TYPE.frameworkWorkImpacted,
      title: `Audit Framework v${live.revision.version}: downstream work affected`,
      body: [
        `${live.analysis.items.length} framework change(s) confirmed against v${live.comparedTo.version}.`,
        touched.length ? `Reassess: ${touched.map((w) => w.label).join('; ')}.` : null,
        newWork.length ? `New work: ${[...new Set(newWork)].join('; ')}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      engagementId,
      objectId: baselineId,
      dedup: `framework_impact:${baselineId}:${live.fingerprint}`,
    });
  return live.analysis;
}

/**
 * Reopen hook (§15–§17): preserve the superseded memorandum, keep every
 * downstream work link (marked superseded, affected sections flagged for
 * reassessment — completed work is never deleted), open the impact record of
 * the new revision and notify the Engagement Manager / Partner and the owners
 * of the work that now needs reassessment.
 */
export async function onFrameworkReopenedOn(
  client: PoolClient,
  _ctx: RlsContext,
  event: FrameworkReopenedEvent,
): Promise<void> {
  await supersedeFrameworkMemoOn(client, event.fromBaselineId);
  // Baselines approved before Track B landed have no links yet — record them now.
  await linkDownstreamWorkOn(
    client,
    event.workflowInstanceId,
    event.engagementId,
    event.fromBaselineId,
    'superseded',
  );
  const reason = `Framework reopened v${event.fromVersion} → v${event.toVersion}: ${event.reason}`;
  await client.query(
    `UPDATE hsdg.audit_framework_work_link
        SET relation = 'superseded',
            reassessment_required = reassessment_required OR section = ANY($2::text[]),
            reassessment_reason = CASE WHEN section = ANY($2::text[]) THEN $3 ELSE reassessment_reason END
      WHERE baseline_id = $1`,
    [event.fromBaselineId, event.affectedSections, reason],
  );
  await client.query(
    `INSERT INTO hsdg.audit_framework_impact
       (baseline_id, compared_to_baseline_id, workflow_instance_id, engagement_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (baseline_id) DO NOTHING`,
    [event.toBaselineId, event.fromBaselineId, event.workflowInstanceId, event.engagementId],
  );
  const eng = await readFrameworkEngagementOn(client, event.workflowInstanceId);
  const sections = event.affectedSections.map((s) => FRAMEWORK_SOURCE_SECTION_LABEL[s]).join(', ');
  await notifyOn(client, [eng?.managerId, eng?.partnerId], {
    type: NOTIFICATION_TYPE.frameworkReopened,
    title: `Audit Framework reopened — v${event.toVersion} in progress`,
    body: `v${event.fromVersion} is preserved. Affected: ${sections}. Reason: ${event.reason}`,
    engagementId: event.engagementId,
    objectId: event.toBaselineId,
    dedup: `framework_reopened:${event.toBaselineId}`,
  });
  const { rows: reassess } = await client.query<{
    owner_employee_id: string | null;
    label: string;
  }>(
    `SELECT owner_employee_id, label FROM hsdg.audit_framework_work_link
      WHERE baseline_id = $1 AND reassessment_required`,
    [event.fromBaselineId],
  );
  if (reassess.length)
    await notifyOn(
      client,
      reassess.map((r) => r.owner_employee_id ?? eng?.managerId),
      {
        type: NOTIFICATION_TYPE.frameworkWorkImpacted,
        title: `Audit Framework v${event.toVersion}: work requires reassessment`,
        body: `Reassess against the revised framework: ${reassess.map((r) => r.label).join('; ')}. Completed work is preserved.`,
        engagementId: event.engagementId,
        objectId: event.toBaselineId,
        dedup: `framework_reassess:${event.toBaselineId}`,
      },
    );
}

/**
 * Approval hook (§14, §17): link the downstream work to the approved baseline
 * that configured it and, on a re-approval, notify the owners of the work the
 * revision created.
 */
export async function onFrameworkApprovedOn(
  client: PoolClient,
  _ctx: RlsContext,
  event: FrameworkApprovedEvent,
): Promise<void> {
  const work = await linkDownstreamWorkOn(
    client,
    event.workflowInstanceId,
    event.engagementId,
    event.baselineId,
    'configured_by',
  );
  if (!event.supersededBaselineId) return;
  await supersedeFrameworkMemoOn(client, event.supersededBaselineId);
  const { rows: before } = await client.query<{ work_kind: string; work_ref: string }>(
    `SELECT work_kind, work_ref FROM hsdg.audit_framework_work_link WHERE baseline_id = $1`,
    [event.supersededBaselineId],
  );
  const had = new Set(before.map((b) => `${b.work_kind}|${b.work_ref}`));
  const created = work.filter((w) => !had.has(`${w.kind}|${w.ref}`));
  if (!created.length) return;
  const eng = await readFrameworkEngagementOn(client, event.workflowInstanceId);
  await notifyOn(
    client,
    created.map((w) => w.ownerEmployeeId ?? eng?.managerId),
    {
      type: NOTIFICATION_TYPE.frameworkWorkImpacted,
      title: `Audit Framework v${event.version} approved: new downstream work`,
      body: `Created by the revised framework: ${created.map((w) => w.label).join('; ')}.`,
      engagementId: event.engagementId,
      objectId: event.baselineId,
      dedup: `framework_created:${event.baselineId}`,
    },
  );
}

// ── Section 07 / 08 surfacing (§17) ──────────────────────────────────────────

/**
 * The reopened framework revision as Section 07 Completion / 08 Reporting see
 * it — null unless a revision is in progress (it then becomes history). DI-free.
 */
export async function readFrameworkRevisionOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkRevisionNotice | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM hsdg.audit_framework_baseline
      WHERE workflow_instance_id = $1 AND status <> 'superseded' AND status <> 'approved'
        AND reopened_from_version IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [workflowInstanceId],
  );
  if (!rows[0]) return null;
  const live = await computeImpactOn(client, workflowInstanceId, rows[0].id);
  if (!live) return null;
  return {
    baselineVersion: live.revision.version,
    comparedToVersion: live.comparedTo.version,
    reason: live.revision.reopen_reason,
    reopenedAt: live.revision.reopened_at ? live.revision.reopened_at.toISOString() : null,
    affectedSections: (live.revision.reopen_affected_sections ?? []) as FrameworkSourceSection[],
    reportingImpacts: reportingImpactsOf(live.changes),
    impactConfirmed: live.analysis.confirmedAt != null,
    reapproved: false,
  };
}
