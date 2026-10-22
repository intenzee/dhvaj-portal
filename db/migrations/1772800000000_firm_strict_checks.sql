-- ─────────────────────────────────────────────────────────────────────────
-- The firm's checks: rules the portal enforced, now switchable
--
-- Staff found the portal hard to use: lodging, tasks and engagements were
-- held up by rules (the reviewer's approval, the acknowledgement, the
-- reference number, team membership …). Each such rule is now a check the
-- managing partner or the administrator switches on when the firm is ready;
-- until then the work goes ahead and the portal warns instead.
--
--   firm_settings.strict_checks  key → true: that check is on. A missing key
--                                is off, so the firm starts with every check
--                                off. Keys: @hsdg/contracts FIRM_CHECK.
--   hsdg.firm_check(key)         whether a check is on — for SQL, including
--                                row-level security (any role, no context).
--
-- Only the managing partner or the administrator may change strict_checks
-- (the other firm settings keep their rules).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN strict_checks jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT firm_settings_strict_checks_object CHECK (jsonb_typeof(strict_checks) = 'object');

COMMENT ON COLUMN hsdg.firm_settings.strict_checks IS
  'The firm''s checks switched on: key → true (@hsdg/contracts FIRM_CHECK). A missing key is off.';

/** Whether the firm has switched a check on. One firm per database (firm_settings has one row). */
CREATE OR REPLACE FUNCTION hsdg.firm_check(p_key text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT COALESCE((SELECT (f.strict_checks ->> p_key) = 'true' FROM hsdg.firm_settings f LIMIT 1),
                  false)
$$;
REVOKE ALL ON FUNCTION hsdg.firm_check(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.firm_check(text) TO hsdg_app;

-- Switching checks is the managing partner's or the administrator's call.
CREATE OR REPLACE FUNCTION hsdg.firm_settings_checks_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.strict_checks IS DISTINCT FROM OLD.strict_checks
     AND current_user = 'hsdg_app'
     AND COALESCE(hsdg.ctx_role(), '') NOT IN ('managing_partner', 'admin')
     AND NOT hsdg.ctx_has_role('managing_partner') AND NOT hsdg.ctx_has_role('admin') THEN
    RAISE EXCEPTION 'Only the managing partner or the administrator can change the firm''s checks.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER firm_settings_checks_guard
  BEFORE UPDATE OF strict_checks ON hsdg.firm_settings
  FOR EACH ROW EXECUTE FUNCTION hsdg.firm_settings_checks_guard();

-- Down Migration

DROP TRIGGER IF EXISTS firm_settings_checks_guard ON hsdg.firm_settings;
DROP FUNCTION IF EXISTS hsdg.firm_settings_checks_guard();
DROP FUNCTION IF EXISTS hsdg.firm_check(text);
ALTER TABLE hsdg.firm_settings DROP COLUMN IF EXISTS strict_checks;
