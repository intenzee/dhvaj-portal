-- Up Migration

-- Who hears that a client uploaded through a secure link. The upload is public
-- (no staff principal, so RLS shows the API nothing), hence a definer function,
-- like client_upload_link_info. It answers only for a client-uploaded document
-- (no staff uploader, filed against a request) and returns ids, nothing else:
--   the request's raiser, the person responsible for it and the link's maker;
--   failing those, the engagement manager and partner.
CREATE OR REPLACE FUNCTION hsdg.client_upload_recipients(p_document_id uuid)
RETURNS TABLE (engagement_id uuid, employee_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
DECLARE
  prior_role text := current_setting('hsdg.role', true);
BEGIN
  -- The tables force RLS for their owner too: read as the firm, as
  -- create_client_document does, and put the caller's role back after.
  PERFORM set_config('hsdg.role', 'managing_partner', true);
  RETURN QUERY
  WITH doc AS (
    SELECT d.engagement_id, d.client_dependency_id
      FROM hsdg.documents d
     WHERE d.id = p_document_id
       AND d.created_by_employee_id IS NULL
       AND d.client_dependency_id IS NOT NULL
  ),
  asked AS (
    SELECT doc.engagement_id, x.employee_id
      FROM doc
      JOIN hsdg.client_dependencies cd ON cd.id = doc.client_dependency_id
      CROSS JOIN LATERAL (
        VALUES (cd.created_by_employee_id), (cd.responsible_employee_id)
      ) AS x(employee_id)
     WHERE x.employee_id IS NOT NULL
    UNION
    SELECT doc.engagement_id, l.created_by_employee_id
      FROM doc
      JOIN hsdg.client_upload_links l ON l.client_dependency_id = doc.client_dependency_id
     WHERE l.created_by_employee_id IS NOT NULL
  ),
  leads AS (
    SELECT doc.engagement_id, x.employee_id
      FROM doc
      JOIN hsdg.engagements e ON e.id = doc.engagement_id
      CROSS JOIN LATERAL (
        VALUES (e.engagement_manager_id), (e.engagement_partner_id)
      ) AS x(employee_id)
     WHERE x.employee_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM asked)
  )
  SELECT DISTINCT r.engagement_id, r.employee_id FROM (
    SELECT * FROM asked UNION ALL SELECT * FROM leads
  ) r;
  PERFORM set_config('hsdg.role', coalesce(prior_role, ''), true);
END $$;

REVOKE EXECUTE ON FUNCTION hsdg.client_upload_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.client_upload_recipients(uuid) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.client_upload_recipients(uuid);
