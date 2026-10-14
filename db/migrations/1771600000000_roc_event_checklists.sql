-- Up Migration
-- ROC / MCA spec P2-1 (docs/roc-mca-filing-spec.md §7): each event-driven ROC
-- form gets its own "What's to be done" checklist (FILING_<RULE_CODE>, which
-- the resolver looks up before the generic FILING_ROC). Filings end with the
-- common tail (DSC, Review, Lodge (SRN)); the two meetings (first board
-- meeting, first AGM) close with "Record meeting" instead.
--
-- `onlyIf` may name an event detail as well as a profile attribute: the
-- seeder adds the event's context (`<event_type>_<detail>`), and `key=value`
-- matches a text detail — DIR-12 asks for DIR-2 / DIR-8 on an appointment and
-- the resignation letter on a cessation; PAS-3 asks for PAS-4 / PAS-5 only on
-- a private placement.

ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;

CREATE TEMP TABLE _roc_event_templates (code text, name text, body jsonb) ON COMMIT DROP;
INSERT INTO _roc_event_templates (code, name, body) VALUES
('FILING_ROC_FIRST_BOARD', 'ROC — first board meeting', '{"items":[
  {"code":"NOTICE","label":"Notice and agenda sent (7 days, s.173(3))","slotCode":"BM_NOTICE","required":true,"sequence":1,"autoTick":"document"},
  {"code":"FIRST_AUDITOR","label":"First auditor appointed (s.139(6))","required":true,"sequence":2,"note":"Within 30 days of incorporation; ADT-1 follows."},
  {"code":"MINUTES","label":"Signed minutes","slotCode":"BM_MINUTES","required":true,"sequence":3,"autoTick":"document"},
  {"code":"HELD","label":"Record meeting (held on)","slotCode":"BM_MINUTES","required":true,"sequence":4,"autoTick":"lodge"}
]}'),
('FILING_ROC_FIRST_ADT1', 'ROC — ADT-1 (first auditor)', '{"items":[
  {"code":"RESOLUTION","label":"Board resolution appointing the first auditor","slotCode":"ROC_RESOLUTION","required":true,"sequence":1,"autoTick":"document"},
  {"code":"CONSENT","label":"Auditor''s consent and eligibility certificate","slotCode":"AUDITOR_CONSENT","required":true,"sequence":2,"autoTick":"document"},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_INC20A', 'ROC — INC-20A (commencement of business)', '{"items":[
  {"code":"SUBSCRIPTION","label":"Subscription money received (bank statement)","slotCode":"BANK_STATEMENT","required":true,"sequence":1,"autoTick":"document"},
  {"code":"OFFICE_VERIFIED","label":"Registered office verified","required":true,"sequence":2},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_FIRST_AGM', 'ROC — first AGM', '{"items":[
  {"code":"FS_APPROVED","label":"Board approved the financial statements and board''s report","slotCode":"BOARD_MINUTES_FS","required":true,"sequence":1,"autoTick":"document"},
  {"code":"NOTICE","label":"AGM notice sent (21 clear days, s.101)","slotCode":"AGM_NOTICE","required":true,"sequence":2,"autoTick":"document"},
  {"code":"AUDITOR_AGENDA","label":"Auditor appointment on the agenda (s.139(1))","sequence":3},
  {"code":"MINUTES","label":"AGM minutes and attendance","slotCode":"AGM_MINUTES","required":true,"sequence":4,"autoTick":"document"},
  {"code":"REVIEW","label":"Review","required":true,"sequence":5,"autoTick":"review"},
  {"code":"HELD","label":"Record meeting (held on)","slotCode":"AGM_MINUTES","required":true,"sequence":6,"autoTick":"lodge","note":"The ROC cannot extend the first AGM."}
]}'),
('FILING_ROC_DIR12', 'ROC — DIR-12 (director change)', '{"items":[
  {"code":"CONSENT","label":"DIR-2 consent and DIR-8 declaration","slotCode":"DIR2_DIR8","required":true,"sequence":1,"autoTick":"document","onlyIf":"director_change_change=appointed"},
  {"code":"RESIGNATION","label":"Resignation letter and proof of delivery","slotCode":"RESIGNATION","required":true,"sequence":1,"autoTick":"document","onlyIf":"director_change_change=ceased"},
  {"code":"RESOLUTION","label":"Board resolution","slotCode":"ROC_RESOLUTION","required":true,"sequence":2,"autoTick":"document"},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_PAS3', 'ROC — PAS-3 (return of allotment)', '{"items":[
  {"code":"RESOLUTION","label":"Board resolution for the allotment","slotCode":"ROC_RESOLUTION","required":true,"sequence":1,"autoTick":"document"},
  {"code":"ALLOTTEES","label":"List of allottees","slotCode":"ALLOTTEE_LIST","required":true,"sequence":2,"autoTick":"document"},
  {"code":"VALUATION","label":"Valuation report (where needed)","slotCode":"VALUATION_REPORT","sequence":3,"autoTick":"document"},
  {"code":"BANK_PROOF","label":"Bank proof of the money received","slotCode":"BANK_STATEMENT","required":true,"sequence":4,"autoTick":"document"},
  {"code":"PAS4_PAS5","label":"PAS-4 offer letter and PAS-5 record","slotCode":"PAS4_PAS5","required":true,"sequence":5,"autoTick":"document","onlyIf":"allotment_private_placement"},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_INC22', 'ROC — INC-22 (registered office)', '{"items":[
  {"code":"RESOLUTION","label":"Board resolution","slotCode":"ROC_RESOLUTION","required":true,"sequence":1,"autoTick":"document"},
  {"code":"OFFICE_PROOF","label":"Proof of the office (rent agreement / ownership)","slotCode":"OFFICE_PROOF","required":true,"sequence":2,"autoTick":"document"},
  {"code":"NOC","label":"Owner''s NOC","slotCode":"OWNER_NOC","required":true,"sequence":3,"autoTick":"document"},
  {"code":"UTILITY_BILL","label":"Utility bill (not older than 2 months)","slotCode":"UTILITY_BILL","required":true,"sequence":4,"autoTick":"document"},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_MGT14', 'ROC — MGT-14 (resolutions)', '{"items":[
  {"code":"RESOLUTION","label":"Certified copy of the resolution","slotCode":"ROC_RESOLUTION","required":true,"sequence":1,"autoTick":"document","note":"A private company is exempt for some s.179(3) board resolutions — mark the filing Not applicable with the reason."},
  {"code":"EXPLANATORY","label":"Explanatory statement","slotCode":"EXPLANATORY_STATEMENT","sequence":2,"autoTick":"document"},
  {"code":"NOTICE","label":"Notice of the meeting","slotCode":"MEETING_NOTICE","sequence":3,"autoTick":"document"},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_CHG1', 'ROC — CHG-1 (charge)', '{"items":[
  {"code":"INSTRUMENT","label":"Charge instrument","slotCode":"CHARGE_INSTRUMENT","required":true,"sequence":1,"autoTick":"document"},
  {"code":"SANCTION","label":"Sanction letter","slotCode":"SANCTION_LETTER","required":true,"sequence":2,"autoTick":"document"},
  {"code":"HOLDER_SIGNED","label":"Signed by the charge holder","required":true,"sequence":3,"note":"Due in 30 days; a further 60 days with the additional fee."},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}'),
('FILING_ROC_SH7', 'ROC — SH-7 (capital altered)', '{"items":[
  {"code":"RESOLUTION","label":"Ordinary resolution","slotCode":"ROC_RESOLUTION","required":true,"sequence":1,"autoTick":"document"},
  {"code":"MOA","label":"Altered MoA","slotCode":"ALTERED_MOA","required":true,"sequence":2,"autoTick":"document"},
  {"code":"DSC","label":"Signed with DSC (director)","required":true,"sequence":10},
  {"code":"REVIEW","label":"Review","required":true,"sequence":11,"autoTick":"review"},
  {"code":"LODGE","label":"Lodge (SRN)","slotCode":"ACK_ROC","required":true,"sequence":12,"autoTick":"lodge"}
]}');

INSERT INTO hsdg.catalogue_templates (template_type, code, name, description)
SELECT 'checklist', code, name, 'ROC event-form checklist (roc-mca spec §7).' FROM _roc_event_templates
ON CONFLICT (code) DO NOTHING;
INSERT INTO hsdg.catalogue_template_versions (catalogue_template_id, version, effective_from, body, notes)
SELECT ct.id, 1, DATE '2017-04-01', t.body, 'Seeded by 1771600000000_roc_event_checklists'
  FROM _roc_event_templates t JOIN hsdg.catalogue_templates ct ON ct.code = t.code
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.catalogue_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_template_versions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.catalogue_template_versions v USING hsdg.catalogue_templates t
 WHERE v.catalogue_template_id = t.id
   AND v.notes = 'Seeded by 1771600000000_roc_event_checklists';
DELETE FROM hsdg.catalogue_templates t
 WHERE t.code IN ('FILING_ROC_FIRST_BOARD','FILING_ROC_FIRST_ADT1','FILING_ROC_INC20A',
                  'FILING_ROC_FIRST_AGM','FILING_ROC_DIR12','FILING_ROC_PAS3','FILING_ROC_INC22',
                  'FILING_ROC_MGT14','FILING_ROC_CHG1','FILING_ROC_SH7')
   AND NOT EXISTS (SELECT 1 FROM hsdg.catalogue_template_versions v WHERE v.catalogue_template_id = t.id);
ALTER TABLE hsdg.catalogue_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.catalogue_templates FORCE ROW LEVEL SECURITY;
