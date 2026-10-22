-- ─────────────────────────────────────────────────────────────────────────
-- Accountant and HR roles · the desk roles see no client logins or GST marks
-- (docs/accountant-hr-roles-spec.md §8).
--
-- 1772400000000 put a RESTRICTIVE `<table>_no_desk` policy on the client
-- master: a user whose highest role is a desk role (accountant, hr) reads
-- and writes none of it. Three client tables sit outside that list:
--
--   client_credentials     the client's portal logins (GST, Income-tax, MCA)
--   credential_access_log  who revealed which of those logins, and when
--   client_return_marks    the GST returns the firm's login workbook marks
--                          filed / not applicable (1772700000000)
--
-- Today each is hidden from a desk role only because its SELECT policy looks
-- through hsdg.entities (or a professional role); this puts the rule on the
-- tables themselves, so a later policy that widens them cannot open them to
-- the Accountant or HR. A Senior + Accountant is ranked Senior and keeps the
-- Senior's access, as on the client master.
--
-- Ordering: on a database that ran 1772700000000 / 1772710000000 before the
-- roles migration (production), and on a fresh one where they run after it,
-- this file sorts after all three, so hsdg.ctx_is_desk_only() and the tables
-- both exist. Idempotent: it drops each policy before creating it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_credentials', 'credential_access_log', 'client_return_marks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_no_desk', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I AS RESTRICTIVE TO hsdg_app
                      USING (NOT hsdg.ctx_is_desk_only()) WITH CHECK (NOT hsdg.ctx_is_desk_only())',
                   t || '_no_desk', t);
  END LOOP;
END $$;

-- Down Migration

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_credentials', 'credential_access_log', 'client_return_marks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_no_desk', t);
  END LOOP;
END $$;
