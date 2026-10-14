-- Up Migration
-- Staff Workflow WF-303: last period beside this one. A checklist line marked
-- carriesOver in its template starts from last period's answer — kept open,
-- with that answer in `carried`, so the preparer confirms it (the lodge gate
-- still waits). Any change of status clears `carried`.
--
-- The lines that carry over are the standing answers that repeat month to
-- month: exports, advances, HSN / documents issued, IRN and e-way bill reports
-- (Outward), imports, reverse charge and reversals (Inward), reverse charge on
-- CMP-08.

-- Forced RLS would hide the rows from the migrator.
ALTER TABLE hsdg.instance_checklist_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.instance_checklist_items
  ADD COLUMN carries_over boolean NOT NULL DEFAULT false,
  -- Last period's answer awaiting confirmation: {status, note, naReason, instanceId, periodKey}.
  ADD COLUMN carried jsonb;

CREATE TEMP TABLE wf303_carry (template_code text, item_code text) ON COMMIT DROP;
INSERT INTO wf303_carry VALUES
  ('FILING_GST_OUTWARD', 'EXPORT_DOCS'),
  ('FILING_GST_OUTWARD', 'ADVANCES'),
  ('FILING_GST_OUTWARD', 'HSN_DOCS'),
  ('FILING_GST_OUTWARD', 'IRN_REPORT'),
  ('FILING_GST_OUTWARD', 'EWB_REPORT'),
  ('FILING_GST_INWARD', 'IMPORTS'),
  ('FILING_GST_INWARD', 'RCM'),
  ('FILING_GST_INWARD', 'REVERSALS'),
  ('FILING_GST_CMP08', 'RCM');

UPDATE hsdg.catalogue_template_versions v
   SET body = jsonb_set(v.body, '{items}', (
         SELECT jsonb_agg(CASE WHEN EXISTS (SELECT 1 FROM wf303_carry c
                                             WHERE c.template_code = t.code
                                               AND c.item_code = x.it->>'code')
                               THEN x.it || '{"carriesOver":true}'::jsonb ELSE x.it END
                          ORDER BY x.ord)
           FROM jsonb_array_elements(v.body->'items') WITH ORDINALITY AS x(it, ord)))
  FROM hsdg.catalogue_templates t
 WHERE t.id = v.catalogue_template_id
   AND t.code IN (SELECT template_code FROM wf303_carry);

UPDATE hsdg.instance_checklist_items it
   SET carries_over = true
  FROM wf303_carry c
 WHERE c.template_code = it.template_code AND c.item_code = it.item_code;

ALTER TABLE hsdg.instance_checklist_items FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.instance_checklist_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.catalogue_template_versions v
   SET body = jsonb_set(v.body, '{items}', (
         SELECT jsonb_agg(x.it - 'carriesOver' ORDER BY x.ord)
           FROM jsonb_array_elements(v.body->'items') WITH ORDINALITY AS x(it, ord)))
  FROM hsdg.catalogue_templates t
 WHERE t.id = v.catalogue_template_id
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.body->'items') it WHERE it ? 'carriesOver');

ALTER TABLE hsdg.instance_checklist_items
  DROP COLUMN carried,
  DROP COLUMN carries_over;

ALTER TABLE hsdg.instance_checklist_items FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
