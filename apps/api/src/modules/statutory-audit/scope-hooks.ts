import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  SCOPE_REASSESSMENT_SOURCE_LABEL,
  scopeVersionLabel,
  type FlagScopeReassessmentInput,
} from '@hsdg/contracts';
import { notifyPlanning, syncScopeAttention } from './planning-governance';
import {
  controlResultUnsupported,
  cycleForProcess,
  materialityAffectedItems,
  type MaterialityLevels,
} from './scope-approach-engine';

/**
 * 03.4 reassessment hooks (DHVAJ 03.4 §24, §27) — DI-free so 03.1, 03.3 and
 * Section 05 can call them inside their own transaction. A hook never changes
 * a decision: a completed strategy becomes Reassessment Required, only the
 * affected Approach Map areas are flagged, the Engagement Manager is told and
 * the EP sees it in the Partner Planning View.
 */

/** Phase 03 checklist rows 03.4 rolls its state up into. */
export const SCOPE_ITEM_KEYS = ['audit_approach', 'overall_audit_plan'];

/** The map areas a controls cycle's evidence covers (Section 05 → §24). */
export const CYCLE_AREAS: Record<string, string[]> = {
  revenue: ['revenue', 'trade_receivables'],
  procurement: ['trade_payables'],
  payroll: ['employee_cost'],
  inventory: ['inventory'],
  treasury: ['cash_bank', 'total_borrowings', 'investments'],
  financial_close: ['financial_close'],
};

export interface FlagScopeOptions {
  /** Section 05 — the controls cycle whose results do not support reliance. */
  cycleKey?: string | null;
  /** Precomputed affected map areas (materiality revision); omitted → the source's default. */
  items?: { id: string; reason: string }[];
}

/**
 * Flag 03.4 for reassessment. Returns false when 03.4 has not been started on
 * the file. Used by 03.1 (Areas of Focus / orientation), 03.3 (materiality
 * revision), Section 05 (control results) and the Manager's endpoint.
 */
export async function flagScopeReassessment(
  client: PoolClient,
  workflowInstanceId: string,
  source: FlagScopeReassessmentInput['source'],
  reason: string,
  opts: FlagScopeOptions = {},
): Promise<boolean> {
  const { rows } = await client.query<{
    id: string;
    engagement_id: string;
    status: string;
    version_no: number;
  }>(
    `SELECT id, engagement_id, status, version_no FROM hsdg.audit_scope_approach
      WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const rec = rows[0];
  if (!rec) return false;

  if (opts.items) {
    if (opts.items.length) {
      await client.query(
        `UPDATE hsdg.audit_scope_map_item m
            SET reassessment_required = true, reassessment_reason = x.reason,
                version = m.version + 1
           FROM unnest($2::uuid[], $3::text[]) AS x(id, reason)
          WHERE m.id = x.id AND m.scope_id = $1`,
        [rec.id, opts.items.map((i) => i.id), opts.items.map((i) => i.reason)],
      );
    }
  } else if (source === 'materiality_revision') {
    await client.query(
      `UPDATE hsdg.audit_scope_map_item
          SET reassessment_required = true, reassessment_reason = $2, version = version + 1
        WHERE scope_id = $1 AND included AND (metric_key IS NOT NULL OR manual_amount IS NOT NULL)`,
      [rec.id, reason],
    );
  } else if (source === 'section_05' && opts.cycleKey) {
    await client.query(
      `UPDATE hsdg.audit_scope_map_item
          SET reassessment_required = true, reassessment_reason = $2, version = version + 1
        WHERE scope_id = $1 AND included AND area_key = ANY($3::text[])
          AND controls_strategy = 'reliance_contemplated'`,
      [rec.id, reason, CYCLE_AREAS[opts.cycleKey] ?? []],
    );
  }
  const { rows: upd } = await client.query<{ status: string }>(
    `UPDATE hsdg.audit_scope_approach
        SET status = CASE WHEN status = 'complete' THEN 'reassessment_required' ELSE status END,
            reassessment_reason = $2, reassessment_source = $3, version = version + 1
      WHERE id = $1
     RETURNING status`,
    [rec.id, reason, source],
  );
  await client.query(
    `UPDATE hsdg.audit_planning_items
        SET state = 'needs_attention', content_updated_at = now(), version = version + 1
      WHERE workflow_instance_id = $1 AND item_key = ANY($2::text[]) AND state = 'complete'`,
    [workflowInstanceId, SCOPE_ITEM_KEYS],
  );

  // Only a completed strategy needs re-performing; a draft simply carries the reason.
  if (upd[0]?.status === 'reassessment_required') {
    const scope = { id: rec.id, versionNo: rec.version_no };
    await syncScopeAttention(
      client,
      rec.engagement_id,
      workflowInstanceId,
      scope,
      [{ key: 'reassessment', label: 'Reassessment Required', detail: reason }],
      { additive: true },
    );
    const { rows: who } = await client.query<{
      me: string | null;
      partner_id: string | null;
      manager_id: string | null;
    }>(
      `SELECT hsdg.ctx_employee_id() AS me, engagement_partner_id AS partner_id,
              engagement_manager_id AS manager_id
         FROM hsdg.engagements WHERE id = $1`,
      [rec.engagement_id],
    );
    const w = who[0];
    await notifyPlanning(client, [w?.manager_id ?? w?.partner_id], {
      type: NOTIFICATION_TYPE.planningScopeReassessment,
      title: `03.4 Scope & Approach ${scopeVersionLabel(rec.version_no)} needs reassessment`,
      body: `${SCOPE_REASSESSMENT_SOURCE_LABEL[source] ?? source}: ${reason}`,
      engagementId: rec.engagement_id,
      objectType: 'audit_scope_approach',
      objectId: rec.id,
      dedup: `scope_reassessment:${rec.id}:${rec.version_no}:${source}:${opts.cycleKey ?? ''}`,
      except: w?.me ?? null,
    });
  }
  return true;
}

/**
 * 03.3 → 03.4 (§24): a completed materiality revision flags only the map
 * areas whose amount moves across OM / PM, or that a changed specific
 * materiality touches. `amountOf` resolves a map area's live amount (₹).
 */
export async function flagScopeForMaterialityRevision(
  client: PoolClient,
  workflowInstanceId: string,
  reason: string,
  amountOf: (item: { metricKey: string | null; manualAmount: number | null }) => number | null,
): Promise<boolean> {
  const { rows: dets } = await client.query<{
    id: string;
    selected_om: string | null;
    selected_pm: string | null;
  }>(
    `SELECT id, selected_om, selected_pm FROM hsdg.audit_materiality_determination
      WHERE workflow_instance_id = $1 AND status IN ('complete','superseded')
      ORDER BY version_no DESC LIMIT 2`,
    [workflowInstanceId],
  );
  if (!dets[0])
    return flagScopeReassessment(client, workflowInstanceId, 'materiality_revision', reason);
  const levels = async (d: (typeof dets)[number]): Promise<MaterialityLevels> => {
    const { rows } = await client.query<{ scope: string; amount: string | null }>(
      `SELECT scope, amount FROM hsdg.audit_materiality_specific WHERE determination_id = $1`,
      [d.id],
    );
    return {
      om: d.selected_om === null ? null : Number(d.selected_om),
      pm: d.selected_pm === null ? null : Number(d.selected_pm),
      specific: rows.map((r) => ({
        scope: r.scope,
        amount: r.amount === null ? null : Number(r.amount),
      })),
    };
  };
  const after = await levels(dets[0]);
  const before = dets[1] ? await levels(dets[1]) : null;
  const { rows: items } = await client.query<{
    id: string;
    name: string;
    metric_key: string | null;
    manual_amount: string | null;
    included: boolean;
  }>(
    `SELECT m.id, m.name, m.metric_key, m.manual_amount, m.included
       FROM hsdg.audit_scope_map_item m
       JOIN hsdg.audit_scope_approach r ON r.id = m.scope_id
      WHERE r.workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const affected = materialityAffectedItems(
    items.map((m) => ({
      id: m.id,
      name: m.name,
      included: m.included,
      amount: amountOf({
        metricKey: m.metric_key,
        manualAmount: m.manual_amount === null ? null : Number(m.manual_amount),
      }),
    })),
    before,
    after,
  );
  const summary = affected.length
    ? `${reason} ${affected.length} Approach Map area(s) affected.`
    : `${reason} No Approach Map area crosses the revised levels — confirm the strategy still holds.`;
  return flagScopeReassessment(client, workflowInstanceId, 'materiality_revision', summary, {
    items: affected,
  });
}

/**
 * Section 05 → 03.4 (§24): a financial-statement-audit control whose design,
 * implementation or operating-effectiveness result does not support the
 * reliance 03.4 planned for its cycle flags the strategy for reassessment.
 * No-op when 03.4 planned no reliance on that cycle.
 */
export async function onControlResult(
  client: PoolClient,
  workflowInstanceId: string,
  control: {
    ref: string;
    purposeFsAudit: boolean;
    process: string;
    processAreaId: string | null;
    design: string | null;
    implementation: string | null;
    operatingEffectiveness: string | null;
  },
): Promise<boolean> {
  if (!control.purposeFsAudit || !controlResultUnsupported(control)) return false;
  let text = control.process;
  if (control.processAreaId) {
    const { rows } = await client.query<{ title: string; area_key: string | null }>(
      `SELECT title, area_key FROM hsdg.audit_icfr_process_area WHERE id = $1`,
      [control.processAreaId],
    );
    if (rows[0]) text = `${rows[0].title} ${rows[0].area_key ?? ''} ${text}`;
  }
  const cycle = cycleForProcess(text);
  if (!cycle) return false;
  const { rows } = await client.query<{ relies: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM hsdg.audit_scope_decision d
               WHERE d.scope_id = r.id AND d.kind = 'controls_cycle' AND d.item_key = $2
                 AND d.status = 'reliance_contemplated')
            OR EXISTS (
              SELECT 1 FROM hsdg.audit_scope_map_item m
               WHERE m.scope_id = r.id AND m.included AND m.area_key = ANY($3::text[])
                 AND m.controls_strategy = 'reliance_contemplated') AS relies
       FROM hsdg.audit_scope_approach r WHERE r.workflow_instance_id = $1`,
    [workflowInstanceId, cycle, CYCLE_AREAS[cycle] ?? []],
  );
  if (!rows[0]?.relies) return false;
  const what =
    control.operatingEffectiveness === 'exception_identified'
      ? 'an operating-effectiveness exception'
      : control.design === 'deficiency'
        ? 'a design deficiency'
        : 'a control not implemented';
  return flagScopeReassessment(
    client,
    workflowInstanceId,
    'section_05',
    `Section 05 control ${control.ref} (${control.process}) shows ${what} — the reliance planned for the ${cycle.replace(/_/g, ' ')} cycle is not supported.`,
    { cycleKey: cycle },
  );
}
