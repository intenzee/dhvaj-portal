-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-101 · a notice's papers before the notice exists.
--
-- 1772300600000 lets the team (not only the leads) file documents under a
-- notice once documents.notice_id is set. Intake works the other way round: a
-- team member uploads the notice PDF first (document_type 'notice'), then
-- records the notice with that documentId, which sets notice_id. So a member may
-- also insert a document typed notice / reply / order, and re-file (set
-- notice_id on) one they uploaded themselves; its versions follow. Leads are unrestricted, as before.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DROP POLICY documents_insert ON hsdg.documents;
CREATE POLICY documents_insert ON hsdg.documents FOR INSERT WITH CHECK (
  hsdg.is_engagement_lead(engagement_id)
  OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL
       OR document_type IN ('notice', 'reply', 'order'))
      AND hsdg.is_engagement_member(engagement_id)));
DROP POLICY documents_update ON hsdg.documents;
CREATE POLICY documents_update ON hsdg.documents FOR UPDATE
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL
         OR document_type IN ('notice', 'reply', 'order'))
        AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL
         OR document_type IN ('notice', 'reply', 'order'))
        AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()));

DROP POLICY document_versions_insert ON hsdg.document_versions;
CREATE POLICY document_versions_insert ON hsdg.document_versions
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR EXISTS (SELECT 1 FROM hsdg.documents d
                WHERE d.id = document_id
                  AND (d.compliance_instance_id IS NOT NULL OR d.notice_id IS NOT NULL
                       OR d.document_type IN ('notice', 'reply', 'order'))
                  AND hsdg.is_engagement_member(d.engagement_id))
  );

-- Down Migration

DROP POLICY document_versions_insert ON hsdg.document_versions;
CREATE POLICY document_versions_insert ON hsdg.document_versions
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR EXISTS (SELECT 1 FROM hsdg.documents d
                WHERE d.id = document_id AND d.compliance_instance_id IS NOT NULL
                  AND hsdg.is_engagement_member(d.engagement_id))
  );

DROP POLICY documents_update ON hsdg.documents;
CREATE POLICY documents_update ON hsdg.documents FOR UPDATE
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL)
        AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()))
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL)
        AND hsdg.is_engagement_member(engagement_id)
        AND created_by_employee_id = hsdg.ctx_employee_id()));
DROP POLICY documents_insert ON hsdg.documents;
CREATE POLICY documents_insert ON hsdg.documents FOR INSERT WITH CHECK (
  hsdg.is_engagement_lead(engagement_id)
  OR ((compliance_instance_id IS NOT NULL OR notice_id IS NOT NULL)
      AND hsdg.is_engagement_member(engagement_id)));
