/**
 * Change 5 — a filing's "What's to be done" checklist, created from its
 * checklist template (catalogue_templates, editable by partners without a
 * release). DI-free so both the generator (track A) and the workspace GET can
 * call it on their own transaction. Idempotent: ON CONFLICT DO NOTHING per item.
 *
 * Template resolution, first match wins:
 *   FILING_<RULE_CODE> → FILING_<STREAM>_<SECTION> → FILING_<STREAM> → FILING_GENERIC
 * using the version effective at the period end (else today).
 */
import type { PoolClient } from 'pg';
import { eventContext } from './compliance-events';

export interface TemplateItem {
  code: string;
  label: string;
  slotCode?: string;
  required?: boolean;
  sequence?: number;
  autoTick?: 'document' | 'figure' | 'review' | 'lodge' | 'event' | null;
  /**
   * A profile attribute (or event detail, `<event_type>_<detail>`) that must be
   * true for the item to apply; `key=value` matches a text value instead.
   */
  onlyIf?: string;
  note?: string;
}

/** Candidate template codes for a filing, most specific first. */
export function templateCandidates(
  ruleCode: string,
  stream: string | null,
  section: string | null,
): string[] {
  const out: string[] = [];
  const clean = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const rule = `FILING_${clean(ruleCode)}`;
  if (rule.length <= 50) out.push(rule);
  if (stream) {
    if (section) out.push(`FILING_${clean(stream)}_${clean(section)}`);
    out.push(`FILING_${clean(stream)}`);
  }
  out.push('FILING_GENERIC');
  return out;
}

/** The template items that apply to a registration with these attributes. */
export function applicableItems(
  items: TemplateItem[],
  attributes: Record<string, unknown>,
): TemplateItem[] {
  return items.filter((it) => {
    if (!it.onlyIf) return true;
    const eq = it.onlyIf.indexOf('=');
    if (eq < 0) return attributes[it.onlyIf] === true;
    return String(attributes[it.onlyIf.slice(0, eq)] ?? '') === it.onlyIf.slice(eq + 1);
  });
}

/**
 * Create the checklist for one filing if it has none. Returns the number of
 * items the filing has afterwards (0 when the instance is not visible).
 */
export async function seedChecklistForInstance(
  client: PoolClient,
  instanceId: string,
): Promise<number> {
  const { rows } = await client.query<{
    engagement_id: string;
    rule_code: string;
    stream: string | null;
    section: string | null;
    as_of: string;
    attributes: Record<string, unknown> | null;
    event_type: string | null;
    event_details: Record<string, unknown> | null;
    has_items: boolean;
  }>(
    `SELECT ci.engagement_id, cr.code AS rule_code,
            COALESCE(rv.stream, sv.stream) AS stream, ci.section,
            COALESCE(ci.period_end, CURRENT_DATE)::text AS as_of,
            (SELECT p.attributes FROM hsdg.registration_compliance_profiles p
              WHERE p.registration_id = ci.registration_id
                AND p.effective_from <= COALESCE(ci.period_end, CURRENT_DATE)
                AND (p.effective_to IS NULL OR p.effective_to >= COALESCE(ci.period_start, CURRENT_DATE))
              ORDER BY p.effective_from DESC LIMIT 1) AS attributes,
            ev.event_type, ev.details AS event_details,
            EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                     WHERE it.compliance_instance_id = ci.id) AS has_items
       FROM hsdg.compliance_instances ci
       JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
       LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
       LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
       LEFT JOIN hsdg.services sv ON sv.id = es.service_id
       LEFT JOIN hsdg.compliance_events ev ON ev.id = ci.compliance_event_id
      WHERE ci.id = $1`,
    [instanceId],
  );
  const inst = rows[0];
  if (!inst) return 0;
  if (!inst.has_items) {
    const candidates = templateCandidates(inst.rule_code, inst.stream, inst.section);
    const tpl = await client.query<{ code: string; body: { items?: TemplateItem[] } }>(
      `SELECT t.code, v.body
         FROM hsdg.catalogue_templates t
         JOIN hsdg.catalogue_template_versions v ON v.catalogue_template_id = t.id
        WHERE t.code = ANY($1::text[]) AND t.template_type = 'checklist' AND t.is_active
          AND v.effective_from <= $2::date AND (v.effective_to IS NULL OR v.effective_to >= $2::date)
        ORDER BY array_position($1::text[], t.code), v.effective_from DESC
        LIMIT 1`,
      [candidates, inst.as_of],
    );
    const chosen = tpl.rows[0];
    // An event's items also read its details (DIR-12 appointed / ceased …).
    const facts = {
      ...(inst.attributes ?? {}),
      ...(inst.event_type
        ? eventContext({ event_type: inst.event_type, details: inst.event_details })
        : {}),
    };
    const items = applicableItems(chosen?.body.items ?? [], facts);
    if (chosen && items.length > 0) {
      await client.query(
        `INSERT INTO hsdg.instance_checklist_items
           (compliance_instance_id, engagement_id, item_code, label, slot_code, required,
            sequence, auto_tick, note, template_code)
         SELECT $1, $2, x.code, x.label, x."slotCode", COALESCE(x.required, false),
                COALESCE(x.sequence, 0), x."autoTick", x.note, $4
           FROM jsonb_to_recordset($3::jsonb)
                AS x(code text, label text, "slotCode" text, required boolean, sequence int,
                     "autoTick" text, note text)
         ON CONFLICT (compliance_instance_id, item_code) DO NOTHING`,
        [instanceId, inst.engagement_id, JSON.stringify(items), chosen.code],
      );
      await syncAutoTicks(client, instanceId);
    }
  }
  const count = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM hsdg.instance_checklist_items WHERE compliance_instance_id = $1`,
    [instanceId],
  );
  return count.rows[0]?.n ?? 0;
}

/**
 * Bring the self-ticking items in line with the facts: a document in the slot,
 * the task approved (review), a live filing (lodge), the year's AGM recorded
 * (event). Items ticked by hand and
 * items marked Not applicable are left alone; review / lodge items un-tick when
 * the fact goes away (task returned, lodge undone).
 */
export async function syncAutoTicks(client: PoolClient, instanceId: string): Promise<void> {
  await client.query(
    `UPDATE hsdg.instance_checklist_items it
        SET status = 'done', done_at = now(), version = it.version + 1,
            document_id = (SELECT d.id FROM hsdg.documents d
                            WHERE d.compliance_instance_id = it.compliance_instance_id
                              AND d.slot_code = it.slot_code AND d.status = 'active'
                            ORDER BY d.created_at DESC LIMIT 1)
      WHERE it.compliance_instance_id = $1 AND it.auto_tick = 'document' AND it.status = 'open'
        AND EXISTS (SELECT 1 FROM hsdg.documents d
                     WHERE d.compliance_instance_id = it.compliance_instance_id
                       AND d.slot_code = it.slot_code AND d.status = 'active')`,
    [instanceId],
  );
  await client.query(
    `WITH facts AS (
       SELECT EXISTS (SELECT 1 FROM hsdg.tasks t
                       WHERE t.source_compliance_instance_id = $1 AND t.status = 'done') AS reviewed,
              EXISTS (SELECT 1 FROM hsdg.filing_records fr
                       WHERE fr.compliance_instance_id = $1 AND fr.undone_at IS NULL) AS lodged,
              -- 'event': the year's AGM is recorded (and not voided) for this CIN.
              EXISTS (SELECT 1 FROM hsdg.compliance_instances ci
                        JOIN hsdg.compliance_events ev
                          ON ev.engagement_id = ci.engagement_id AND ev.event_type = 'agm'
                         AND ev.voided_at IS NULL AND ev.financial_year = ci.financial_year
                         AND (ev.registration_id IS NULL OR ev.registration_id = ci.registration_id)
                       WHERE ci.id = $1) AS agm_held
     )
     UPDATE hsdg.instance_checklist_items it
        SET status = CASE WHEN want THEN 'done' ELSE 'open' END,
            done_at = CASE WHEN want THEN now() END,
            done_by_employee_id = CASE WHEN want THEN it.done_by_employee_id END,
            version = it.version + 1
       FROM (SELECT i.id,
                    CASE i.auto_tick
                      WHEN 'review' THEN f.reviewed OR f.lodged
                      -- a person's own tick (an OPC's member adoption) stands without an event
                      WHEN 'event' THEN f.agm_held
                        OR (i.status = 'done' AND i.done_by_employee_id IS NOT NULL)
                      ELSE f.lodged END AS want
               FROM hsdg.instance_checklist_items i, facts f
              WHERE i.compliance_instance_id = $1 AND i.auto_tick IN ('review','lodge','event')
                AND i.status <> 'not_applicable') x
      WHERE it.id = x.id AND (it.status = 'done') IS DISTINCT FROM x.want`,
    [instanceId],
  );
}
