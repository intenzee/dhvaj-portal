import type { PoolClient } from 'pg';
import type { AreaScopeStrategy, ScopeLinkedArea } from '@hsdg/contracts';
import { displayCode } from './planning-shared';
import { matchScopeArea, type MatchableArea } from './scope-approach-engine';

/**
 * 03.4 §23 — the Preliminary Audit Approach Map is carried into 03.5: every
 * included map area points at the 03.5 engagement area that will hold its
 * work (`audit_engagement_area.scope_map_item_id`). Matching is automatic for
 * the same 03.2 metric / library code / name; the Manager links by hand or
 * converts a map area into a 03.5 custom area when nothing matches. A manual
 * link (or unlink) is never overridden by the automatic matching. Runs in the
 * caller's transaction; RLS decides whether the caller may write the link.
 */

type Row = Record<string, unknown>;
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** The 03.5 areas of a file, as the matcher sees them. */
export async function readMatchableAreas(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<MatchableArea[]> {
  const { rows } = await client.query<Row>(
    `SELECT a.id, a.area_code, a.area_name, a.disposition, a.scope_map_item_id,
            l.aliases, l.metric_keys
       FROM hsdg.audit_engagement_area a
       JOIN hsdg.audit_area_review r ON r.id = a.review_id
       LEFT JOIN hsdg.audit_area_library l ON l.id = a.source_audit_area_id
      WHERE r.workflow_instance_id = $1
      ORDER BY a.seq`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    areaCode: r.area_code === null ? null : String(r.area_code),
    name: String(r.area_name),
    aliases: arr(r.aliases),
    metricKeys: arr(r.metric_keys),
    disposition: r.disposition as MatchableArea['disposition'],
    scopeMapItemId: r.scope_map_item_id === null ? null : String(r.scope_map_item_id),
  }));
}

/**
 * Link every included, unlinked, not-manually-handled map area to its 03.5
 * area. Returns how many links were made. No-op until both 03.4 and 03.5 exist.
 */
export async function linkScopeMap(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<number> {
  const { rows: items } = await client.query<{
    id: string;
    area_key: string | null;
    metric_key: string | null;
    name: string;
  }>(
    `SELECT m.id, m.area_key, m.metric_key, m.name
       FROM hsdg.audit_scope_map_item m
       JOIN hsdg.audit_scope_approach r ON r.id = m.scope_id
      WHERE r.workflow_instance_id = $1 AND m.included AND NOT m.area_link_manual
        AND NOT EXISTS (SELECT 1 FROM hsdg.audit_engagement_area a WHERE a.scope_map_item_id = m.id)
      ORDER BY m.seq`,
    [workflowInstanceId],
  );
  if (!items.length) return 0;
  const areas = await readMatchableAreas(client, workflowInstanceId);
  if (!areas.length) return 0;
  let linked = 0;
  for (const it of items) {
    const match = matchScopeArea(
      { id: it.id, areaKey: it.area_key, metricKey: it.metric_key, name: it.name },
      areas,
    );
    if (!match) continue;
    const { rowCount } = await client.query(
      `UPDATE hsdg.audit_engagement_area SET scope_map_item_id = $2
        WHERE id = $1 AND scope_map_item_id IS NULL`,
      [match.id, it.id],
    );
    if (rowCount) {
      match.scopeMapItemId = it.id;
      linked += 1;
    }
  }
  return linked;
}

/** The 03.5 area each map item is carried into (map item id → area). */
export async function readLinkedAreas(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<Map<string, ScopeLinkedArea>> {
  const { rows } = await client.query<Row>(
    `SELECT a.id, a.area_code, a.area_name, a.origin, a.disposition, a.scope_map_item_id
       FROM hsdg.audit_engagement_area a
       JOIN hsdg.audit_area_review r ON r.id = a.review_id
      WHERE r.workflow_instance_id = $1 AND a.scope_map_item_id IS NOT NULL`,
    [workflowInstanceId],
  );
  return new Map(
    rows.map((r) => [
      String(r.scope_map_item_id),
      {
        id: String(r.id),
        areaCode: r.area_code === null ? null : String(r.area_code),
        name: String(r.area_name),
        origin: String(r.origin),
        disposition: r.disposition as ScopeLinkedArea['disposition'],
      },
    ]),
  );
}

/** 03.5 — the 03.4 strategy of each linked map item (map item id → strategy). */
export async function readScopeStrategies(
  client: PoolClient,
  mapItemIds: string[],
): Promise<Map<string, AreaScopeStrategy>> {
  if (!mapItemIds.length) return new Map();
  const { rows } = await client.query<Row>(
    `SELECT id, seq, name, controls_strategy, timing, evidence_channels, special_considerations,
            reassessment_required
       FROM hsdg.audit_scope_map_item WHERE id = ANY($1::uuid[])`,
    [mapItemIds],
  );
  return new Map(
    rows.map((m) => [
      String(m.id),
      {
        mapItemId: String(m.id),
        code: displayCode('AM', Number(m.seq))!,
        name: String(m.name),
        controlsStrategy: m.controls_strategy === null ? null : String(m.controls_strategy),
        timing: m.timing === null ? null : String(m.timing),
        evidenceChannels: arr(m.evidence_channels),
        specialConsiderations: arr(m.special_considerations),
        reassessmentRequired: m.reassessment_required === true,
      },
    ]),
  );
}

/** 03.5 VAL-11 — included 03.4 map areas no 03.5 area carries (null: no 03.4 on this file). */
export async function readUnconvertedMapAreas(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<{ code: string; name: string }[] | null> {
  const { rows: rec } = await client.query(
    `SELECT 1 FROM hsdg.audit_scope_approach WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  if (!rec.length) return null;
  const { rows } = await client.query<{ seq: number; name: string }>(
    `SELECT m.seq, m.name FROM hsdg.audit_scope_map_item m
       JOIN hsdg.audit_scope_approach r ON r.id = m.scope_id
      WHERE r.workflow_instance_id = $1 AND m.included
        AND NOT EXISTS (SELECT 1 FROM hsdg.audit_engagement_area a WHERE a.scope_map_item_id = m.id)
      ORDER BY m.seq`,
    [workflowInstanceId],
  );
  return rows.map((r) => ({ code: displayCode('AM', Number(r.seq))!, name: r.name }));
}
