-- Up Migration
-- ROC / MCA spec §5.4: MGT-7's "Board and committee meetings and attendance
-- for the year" line fills from the FY's board-meeting items — auto_tick
-- 'meetings' ticks it once every board meeting of the FY (same CIN) is held
-- (syncAutoTicks). A hand tick still stands (committee meetings count too).
-- Patches the MGT-7 checklist that 1771100000000 seeded (roc-checklists.ts
-- now carries the key, so a regenerated seed matches) and the lines already
-- created from it.

-- Forced RLS would hide the rows from the migrator (and the CHECK then fails).
ALTER TABLE hsdg.instance_checklist_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.instance_checklist_items
  DROP CONSTRAINT instance_checklist_items_auto_tick_check,
  ADD CONSTRAINT instance_checklist_items_auto_tick_check
    CHECK (auto_tick IN ('document','figure','review','lodge','event','meetings'));

UPDATE hsdg.catalogue_template_versions v
   SET body = jsonb_set(v.body, '{items}', (
         SELECT jsonb_agg(CASE WHEN x.it->>'code' = 'MEETINGS' AND NOT x.it ? 'autoTick'
                               THEN x.it || '{"autoTick":"meetings"}'::jsonb ELSE x.it END
                          ORDER BY x.ord)
           FROM jsonb_array_elements(v.body->'items') WITH ORDINALITY AS x(it, ord)))
  FROM hsdg.catalogue_templates t
 WHERE t.id = v.catalogue_template_id AND t.code = 'FILING_ROC_MGT7'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.body->'items') it
                WHERE it->>'code' = 'MEETINGS' AND NOT it ? 'autoTick');

UPDATE hsdg.instance_checklist_items it
   SET auto_tick = 'meetings', version = it.version + 1
  FROM hsdg.compliance_instances ci
  JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id AND cr.code = 'ROC_MGT7'
 WHERE ci.id = it.compliance_instance_id AND it.item_code = 'MEETINGS' AND it.auto_tick IS NULL;

ALTER TABLE hsdg.instance_checklist_items FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.instance_checklist_items NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.instance_checklist_items SET auto_tick = NULL WHERE auto_tick = 'meetings';

UPDATE hsdg.catalogue_template_versions v
   SET body = jsonb_set(v.body, '{items}', (
         SELECT jsonb_agg(CASE WHEN x.it->>'autoTick' = 'meetings'
                               THEN x.it - 'autoTick' ELSE x.it END
                          ORDER BY x.ord)
           FROM jsonb_array_elements(v.body->'items') WITH ORDINALITY AS x(it, ord)))
  FROM hsdg.catalogue_templates t
 WHERE t.id = v.catalogue_template_id AND t.code = 'FILING_ROC_MGT7'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.body->'items') it
                WHERE it->>'autoTick' = 'meetings');

ALTER TABLE hsdg.instance_checklist_items
  DROP CONSTRAINT instance_checklist_items_auto_tick_check,
  ADD CONSTRAINT instance_checklist_items_auto_tick_check
    CHECK (auto_tick IN ('document','figure','review','lodge','event'));

ALTER TABLE hsdg.instance_checklist_items FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
