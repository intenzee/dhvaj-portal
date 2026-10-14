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
import { defaultCompanySubtype, resolveCinFacts, type CinProfileAttributes } from '@hsdg/contracts';
import { eventContext } from './compliance-events';

export interface TemplateItem {
  code: string;
  label: string;
  slotCode?: string;
  required?: boolean;
  sequence?: number;
  /** 'event': ticks when the event it waits on is recorded (AGM held on AOC-4). */
  /** 'meetings': ticks when the FY's board meetings are all recorded (MGT-7). */
  autoTick?: 'document' | 'figure' | 'review' | 'lodge' | 'event' | 'meetings' | null;
  /** 'partner': only a partner ticks it by hand, with a note (the UDIN). */
  tickedBy?: 'partner' | null;
  /**
   * A profile attribute (or event detail, `<event_type>_<detail>`) that must be
   * true for the item to apply; `key=value` matches a text value instead.
   */
  onlyIf?: string;
  note?: string;
  /** WF-303: starts from last period's answer, for the preparer to confirm. */
  carriesOver?: boolean;
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
 * The attributes onlyIf reads for a CIN: the profile as the rules resolve it
 * (XBRL / MGT-8 defaults from the thresholds, the small-company test) plus
 * hasAgm / isOpc, so an OPC's AOC-4 asks for adoption by the member instead of
 * an AGM. Other registrations use their attributes as stored.
 */
export function checklistAttributes(
  registrationType: string | null,
  attributes: Record<string, unknown>,
  entity: { slug: string | null; turnover: number | null },
): Record<string, unknown> {
  if (registrationType !== 'cin') return attributes;
  const defaultSubtype = defaultCompanySubtype(entity.slug);
  const f = resolveCinFacts(attributes as CinProfileAttributes, {
    subtype: defaultSubtype,
    turnover: entity.turnover,
  });
  const subtype = f.companySubtype ?? defaultSubtype;
  return {
    ...attributes,
    xbrlRequired: f.xbrlRequired,
    mgt8Required: f.mgt8Required,
    hasSubsidiaries: f.hasSubsidiaries,
    csrApplicable: f.csrApplicable,
    secretarialAuditRequired: f.secretarialAuditRequired,
    isOpc: subtype === 'opc',
    hasAgm: subtype !== 'opc',
  };
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
    registration_type: string | null;
    entity_slug: string | null;
    annual_turnover: string | null;
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
            (SELECT r.registration_type FROM hsdg.compliance_registrations(ARRAY[ci.registration_id]) r)
              AS registration_type,
            et.slug AS entity_slug, ent.annual_turnover::text AS annual_turnover,
            EXISTS (SELECT 1 FROM hsdg.instance_checklist_items it
                     WHERE it.compliance_instance_id = ci.id) AS has_items
       FROM hsdg.compliance_instances ci
       JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
       JOIN hsdg.engagements e ON e.id = ci.engagement_id
       JOIN hsdg.entities ent ON ent.id = e.entity_id
       LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
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
    // The CIN facts, then an event's own details on top (DIR-12 appointed / ceased …).
    const facts = {
      ...checklistAttributes(inst.registration_type, inst.attributes ?? {}, {
        slug: inst.entity_slug,
        turnover: inst.annual_turnover === null ? null : Number(inst.annual_turnover),
      }),
      ...(inst.event_type
        ? eventContext({ event_type: inst.event_type, details: inst.event_details })
        : {}),
    };
    const items = applicableItems(chosen?.body.items ?? [], facts);
    if (chosen && items.length > 0) {
      await client.query(
        `INSERT INTO hsdg.instance_checklist_items
           (compliance_instance_id, engagement_id, item_code, label, slot_code, required,
            sequence, auto_tick, note, template_code, ticked_by, carries_over)
         SELECT $1, $2, x.code, x.label, x."slotCode", COALESCE(x.required, false),
                COALESCE(x.sequence, 0), x."autoTick", x.note, $4, x."tickedBy",
                COALESCE(x."carriesOver", false)
           FROM jsonb_to_recordset($3::jsonb)
                AS x(code text, label text, "slotCode" text, required boolean, sequence int,
                     "autoTick" text, note text, "tickedBy" text, "carriesOver" boolean)
         ON CONFLICT (compliance_instance_id, item_code) DO NOTHING`,
        [instanceId, inst.engagement_id, JSON.stringify(items), chosen.code],
      );
      await syncAutoTicks(client, instanceId);
      await carryOverAnswers(client, instanceId);
    }
  }
  await raiseClientDependencies(client, instanceId);
  const count = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM hsdg.instance_checklist_items WHERE compliance_instance_id = $1`,
    [instanceId],
  );
  return count.rows[0]?.n ?? 0;
}

/**
 * Staff Workflow WF-303 — the same return for the client's previous period:
 * same rule, registration and section, on the same client, ending before this
 * one. $1 is the filing. Runs under the caller's RLS, so a period the caller
 * cannot see is no previous period.
 */
export const PREVIOUS_INSTANCE_SQL = `
  SELECT p.id, p.period_key
    FROM hsdg.compliance_instances ci
    JOIN hsdg.engagements e ON e.id = ci.engagement_id
    JOIN hsdg.compliance_instances p
      ON p.compliance_rule_id = ci.compliance_rule_id
     AND p.registration_id IS NOT DISTINCT FROM ci.registration_id
     AND p.section IS NOT DISTINCT FROM ci.section
     AND p.id <> ci.id
    JOIN hsdg.engagements pe ON pe.id = p.engagement_id AND pe.entity_id = e.entity_id
   WHERE ci.id = $1
     AND COALESCE(p.period_end, p.statutory_deadline) < COALESCE(ci.period_end, ci.statutory_deadline)
   ORDER BY COALESCE(p.period_end, p.statutory_deadline) DESC, p.created_at DESC
   LIMIT 1`;

/**
 * WF-303: pre-fill the lines that carry over from last period's answer. The
 * line stays open with the answer in `carried`, so the preparer confirms it. A
 * Done carries only on a line ticked by hand (a document line needs this
 * period's document); Not applicable carries on any. Idempotent.
 */
export async function carryOverAnswers(client: PoolClient, instanceId: string): Promise<number> {
  const prev = await client.query<{ id: string; period_key: string | null }>(
    PREVIOUS_INSTANCE_SQL,
    [instanceId],
  );
  const p = prev.rows[0];
  if (!p) return 0;
  const res = await client.query(
    `UPDATE hsdg.instance_checklist_items it
        SET carried = jsonb_build_object('status', last.status, 'note', last.done_note,
                                         'naReason', last.na_reason, 'instanceId', $2::text,
                                         'periodKey', $3::text)
       FROM hsdg.instance_checklist_items last
      WHERE it.compliance_instance_id = $1 AND it.carries_over AND it.status = 'open'
        AND it.carried IS NULL
        AND last.compliance_instance_id = $2 AND last.item_code = it.item_code
        AND (last.status = 'not_applicable' OR (last.status = 'done' AND it.auto_tick IS NULL))`,
    [instanceId, p.id, p.period_key],
  );
  return res.rowCount ?? 0;
}

/**
 * Slots only the client can fill (roc-mca Decision 5): a CS in practice's
 * MGT-8 and MR-3. Their lines exist only where onlyIf applies.
 */
export const CLIENT_DEPENDENCY_SLOTS = ['MGT8', 'MR3'];

/**
 * Raise a client dependency for each open client-only slot on the filing, so it
 * shows Awaiting data until the certificate arrives. Idempotent: never a second
 * one for a slot that has ever had one (a cancelled request stays cancelled) or
 * already holds a document. Runs when the checklist is seeded (on generate) and
 * again when a member opens the filing, as only a member may raise one.
 */
export async function raiseClientDependencies(
  client: PoolClient,
  instanceId: string,
): Promise<void> {
  const { rows } = await client.query<{
    slot_code: string;
    label: string;
    engagement_id: string;
    form: string;
    financial_year: string | null;
  }>(
    `SELECT it.slot_code, it.label, ci.engagement_id, ci.financial_year,
            COALESCE(ci.form_label, rv.form_label, cr.name) AS form
       FROM hsdg.instance_checklist_items it
       JOIN hsdg.compliance_instances ci ON ci.id = it.compliance_instance_id
       JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
       LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
      WHERE it.compliance_instance_id = $1 AND it.slot_code = ANY($2::text[])
        AND it.status = 'open' AND it.client_dependency_id IS NULL
        AND ci.status = 'open' AND ci.workflow_status NOT IN ('filed','not_applicable')
        AND hsdg.is_engagement_member(ci.engagement_id)
        AND NOT EXISTS (SELECT 1 FROM hsdg.client_dependencies d
                         WHERE d.compliance_instance_id = ci.id AND d.slot_code = it.slot_code)
        AND NOT EXISTS (SELECT 1 FROM hsdg.documents d
                         WHERE d.compliance_instance_id = ci.id AND d.slot_code = it.slot_code
                           AND d.status = 'active')`,
    [instanceId, CLIENT_DEPENDENCY_SLOTS],
  );
  for (const r of rows) {
    const fy = r.financial_year ? ` FY ${r.financial_year}` : '';
    await client.query(
      `WITH dep AS (
         INSERT INTO hsdg.client_dependencies
           (engagement_id, requested_info, responsible_employee_id, created_by_employee_id,
            engagement_service_id, compliance_instance_id, task_id, period_section, slot_code)
         SELECT ci.engagement_id, $2, t.assigned_to_employee_id, hsdg.ctx_employee_id(),
                ci.engagement_service_id, ci.id, t.id, ci.section, $3
           FROM hsdg.compliance_instances ci
           LEFT JOIN LATERAL (
             SELECT tk.id, tk.assigned_to_employee_id FROM hsdg.tasks tk
              WHERE tk.source_compliance_instance_id = ci.id AND tk.status <> 'cancelled'
              ORDER BY tk.created_at DESC LIMIT 1
           ) t ON true
          WHERE ci.id = $1
         RETURNING id
       )
       UPDATE hsdg.instance_checklist_items it
          SET client_dependency_id = dep.id, version = it.version + 1
         FROM dep
        WHERE it.compliance_instance_id = $1 AND it.slot_code = $3 AND it.status = 'open'`,
      [instanceId, `${r.label} — ${r.form}${fy}`, r.slot_code],
    );
  }
}

/**
 * Bring the self-ticking items in line with the facts: a document in the slot,
 * the task approved (review), a live filing (lodge), the year's AGM recorded
 * (event), the year's board meetings all held (meetings). Items ticked by hand and
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
                       WHERE ci.id = $1) AS agm_held,
              -- 'meetings': the FY's board-meeting items (same CIN) exist and are all held.
              (SELECT count(*) > 0 AND bool_and(bm.held)
                 FROM hsdg.compliance_instances me,
                      LATERAL (SELECT bi.workflow_status = 'filed'
                                      OR EXISTS (SELECT 1 FROM hsdg.filing_records fr
                                                  WHERE fr.compliance_instance_id = bi.id
                                                    AND fr.undone_at IS NULL) AS held
                                 FROM hsdg.compliance_instances bi
                                 JOIN hsdg.compliance_rules br
                                   ON br.id = bi.compliance_rule_id AND br.code = 'ROC_BOARD_MEETING'
                                WHERE bi.engagement_id = me.engagement_id
                                  AND bi.financial_year = me.financial_year
                                  AND bi.registration_id IS NOT DISTINCT FROM me.registration_id
                                  AND bi.workflow_status <> 'not_applicable') bm
                WHERE me.id = $1) AS meetings_held
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
                      -- committee meetings too, so a hand tick stands as well
                      WHEN 'meetings' THEN f.meetings_held
                        OR (i.status = 'done' AND i.done_by_employee_id IS NOT NULL)
                      ELSE f.lodged END AS want
               FROM hsdg.instance_checklist_items i, facts f
              WHERE i.compliance_instance_id = $1
                AND i.auto_tick IN ('review','lodge','event','meetings')
                AND i.status <> 'not_applicable') x
      WHERE it.id = x.id AND (it.status = 'done') IS DISTINCT FROM x.want`,
    [instanceId],
  );
}
