-- ─────────────────────────────────────────────────────────────────────────
-- Audit file — undo / redo
--
-- Every click that changes the audit file can be taken back (and put back).
-- The API stamps each mutating request with a change-set id
-- (`hsdg.change_set`) and a label (`hsdg.change_label`). A row trigger on
-- every audit-file table records the before / after image of each row the
-- request touched, grouped under that change set. Undo replays a change set
-- backwards, redo replays it forwards.
--
--   • audit_change_set — one per mutating request: who, which file, label.
--   • audit_change_log — the row images of a change set, in order.
--
-- Safety:
--   • A change is only undone / redone when every row it touched still looks
--     exactly as the change left it (ignoring version / updated_at). If anyone
--     — the same person or a colleague — has changed it since, nothing is
--     touched and the call fails with "changed since".
--   • Only the person who made a change can undo / redo it, and only while
--     they are still a member of the engagement.
--   • The log tables are not reachable by the app role; everything goes
--     through the SECURITY DEFINER functions below.
--   • The append-only audit_events trail is never captured or rewound.
--   • Partner sign-off and archiving are not undoable steps, and nothing is
--     replayed on a signed-off or archived file.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_change_set (
  id            uuid PRIMARY KEY,
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  label         text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  undone_at     timestamptz
);
CREATE INDEX audit_change_set_user_idx
  ON hsdg.audit_change_set (engagement_id, user_id, created_at DESC);

CREATE TABLE hsdg.audit_change_log (
  id            bigserial PRIMARY KEY,
  change_set_id uuid NOT NULL REFERENCES hsdg.audit_change_set (id) ON DELETE CASCADE,
  table_name    text NOT NULL,
  op            text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  pk            jsonb NOT NULL,
  before_row    jsonb,
  after_row     jsonb
);
CREATE INDEX audit_change_log_set_idx ON hsdg.audit_change_log (change_set_id, id);

-- Only the definer functions below touch these tables.
ALTER TABLE hsdg.audit_change_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_change_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hsdg.audit_change_set, hsdg.audit_change_log FROM hsdg_app;
REVOKE ALL ON SEQUENCE hsdg.audit_change_log_id_seq FROM hsdg_app;

-- Columns that move on every write and are ignored when checking whether a
-- row still looks as a change left it.
CREATE OR REPLACE FUNCTION hsdg.audit_undo_strip(r jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
  SELECT r - 'version' - 'updated_at'
$$;

-- The primary-key columns of an audit table.
CREATE OR REPLACE FUNCTION hsdg.audit_undo_pk_cols(tbl text) RETURNS text[]
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT array_agg(a.attname::text ORDER BY k.ord)
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indrelid = ('hsdg.' || quote_ident(tbl))::regclass AND i.indisprimary
$$;

-- ── Capture ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hsdg.audit_undo_capture() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  cs      uuid := NULLIF(current_setting('hsdg.change_set', true), '')::uuid;
  uid     uuid := hsdg.ctx_user_id();
  old_r   jsonb;
  new_r   jsonb;
  eng     uuid;
  pk_cols text[];
BEGIN
  IF cs IS NULL OR uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN old_r := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_r := to_jsonb(NEW); END IF;
  -- An update that only moved updated_at changed nothing anyone can see.
  IF TG_OP = 'UPDATE' AND old_r - 'updated_at' = new_r - 'updated_at' THEN
    RETURN NULL;
  END IF;
  eng := (COALESCE(new_r, old_r) ->> 'engagement_id')::uuid;
  IF eng IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO hsdg.audit_change_set (id, engagement_id, user_id, label)
  VALUES (cs, eng, uid, NULLIF(current_setting('hsdg.change_label', true), ''))
  ON CONFLICT (id) DO NOTHING;

  -- The table's primary-key columns are the trigger's arguments.
  pk_cols := TG_ARGV;
  INSERT INTO hsdg.audit_change_log (change_set_id, table_name, op, pk, before_row, after_row)
  SELECT cs, TG_TABLE_NAME, TG_OP,
         (SELECT jsonb_object_agg(c, COALESCE(new_r, old_r) -> c) FROM unnest(pk_cols) AS c),
         old_r, new_r;
  RETURN NULL;
END;
$$;

-- Attach to every audit-file table (those carrying engagement_id). The audit
-- trail itself is excluded. A future audit table needs the same trigger.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'hsdg' AND c.relkind = 'r'
       AND c.relname LIKE 'audit\_%'
       AND c.relname NOT IN ('audit_events', 'audit_change_set', 'audit_change_log')
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'engagement_id' AND NOT a.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON hsdg.%I
         FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture(%s)',
      t || '_undo_capture', t,
      (SELECT string_agg(quote_literal(c), ', ') FROM unnest(hsdg.audit_undo_pk_cols(t)) AS c));
  END LOOP;
END;
$$;

-- ── Status ───────────────────────────────────────────────────────────────

-- The change the caller would undo next: their newest live change set.
CREATE OR REPLACE FUNCTION hsdg.audit_undo_candidate(eng uuid) RETURNS hsdg.audit_change_set
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT s.* FROM hsdg.audit_change_set s
   WHERE s.engagement_id = eng AND s.user_id = hsdg.ctx_user_id() AND s.undone_at IS NULL
   ORDER BY s.created_at DESC
   LIMIT 1
$$;

-- The change the caller would redo next: the most recently undone set, as long
-- as nothing new has been done since (a new change clears the redo stack).
CREATE OR REPLACE FUNCTION hsdg.audit_redo_candidate(eng uuid) RETURNS hsdg.audit_change_set
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT s.* FROM hsdg.audit_change_set s
   WHERE s.engagement_id = eng AND s.user_id = hsdg.ctx_user_id() AND s.undone_at IS NOT NULL
     AND s.created_at > COALESCE(
           (SELECT max(l.created_at) FROM hsdg.audit_change_set l
             WHERE l.engagement_id = eng AND l.user_id = hsdg.ctx_user_id()
               AND l.undone_at IS NULL),
           '-infinity')
   ORDER BY s.undone_at DESC
   LIMIT 1
$$;

-- What a change set did, for its label: [{table, op, count}].
CREATE OR REPLACE FUNCTION hsdg.audit_change_summary(cs uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('table', table_name, 'op', op, 'count', n)
                            ORDER BY first_id), '[]'::jsonb)
    FROM (SELECT table_name, op, count(*) AS n, min(id) AS first_id
            FROM hsdg.audit_change_log WHERE change_set_id = cs
           GROUP BY table_name, op) x
$$;

CREATE OR REPLACE FUNCTION hsdg.audit_undo_status(eng uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  u hsdg.audit_change_set;
  r hsdg.audit_change_set;
BEGIN
  IF NOT hsdg.is_engagement_member(eng) THEN
    RETURN jsonb_build_object('undo', NULL, 'redo', NULL);
  END IF;
  u := hsdg.audit_undo_candidate(eng);
  r := hsdg.audit_redo_candidate(eng);
  RETURN jsonb_build_object(
    'undo', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', u.id, 'label', u.label, 'at', u.created_at,
              'changes', hsdg.audit_change_summary(u.id)) END,
    'redo', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
              'id', r.id, 'label', r.label, 'at', r.created_at,
              'changes', hsdg.audit_change_summary(r.id)) END);
END;
$$;

-- ── Apply ────────────────────────────────────────────────────────────────

-- Move one row from `expected` to `target` (either may be NULL = no row).
-- Raises 'HU409' when the row no longer looks like `expected`.
CREATE OR REPLACE FUNCTION hsdg.audit_undo_apply_row(
  tbl text, pk jsonb, expected jsonb, target jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  rel     text := 'hsdg.' || quote_ident(tbl);
  where_s text;
  cur     jsonb;
  cols    text;
  nxt     jsonb := target;
BEGIN
  SELECT string_agg(format('%I = (jsonb_populate_record(NULL::%s, $1)).%I', k, rel, k), ' AND ')
    INTO where_s FROM jsonb_object_keys(pk) AS k;
  EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE %s FOR UPDATE', rel, where_s)
    INTO cur USING pk;

  -- Already where it should be (e.g. a child row a cascade already removed).
  IF (cur IS NULL AND target IS NULL)
     OR (cur IS NOT NULL AND target IS NOT NULL
         AND hsdg.audit_undo_strip(cur) = hsdg.audit_undo_strip(target)) THEN
    RETURN;
  END IF;

  IF (cur IS NULL) <> (expected IS NULL)
     OR (cur IS NOT NULL AND hsdg.audit_undo_strip(cur) <> hsdg.audit_undo_strip(expected)) THEN
    RAISE EXCEPTION 'audit file changed since' USING ERRCODE = 'HU409';
  END IF;

  IF target IS NULL THEN
    EXECUTE format('DELETE FROM %s WHERE %s', rel, where_s) USING pk;
  ELSIF cur IS NULL THEN
    EXECUTE format('INSERT INTO %s SELECT * FROM jsonb_populate_record(NULL::%s, $1)', rel, rel)
      USING target;
  ELSE
    -- Keep optimistic-lock versions moving forwards so stale screens notice.
    IF cur ? 'version' AND jsonb_typeof(cur -> 'version') = 'number' THEN
      nxt := nxt || jsonb_build_object('version', (cur ->> 'version')::bigint + 1);
    END IF;
    SELECT string_agg(format('%I', k), ', ') INTO cols FROM jsonb_object_keys(nxt) AS k;
    EXECUTE format(
      'UPDATE %s SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%s, $2)) WHERE %s',
      rel, cols, cols, rel, where_s)
      USING pk, nxt;
  END IF;
END;
$$;

-- Undo ('undo') or redo ('redo') the caller's next change set on a file.
-- Returns what was replayed, or NULL when there is nothing to replay.
-- Rows are retried until parents exist before their children (FK order).
CREATE OR REPLACE FUNCTION hsdg.audit_undo_apply(eng uuid, direction text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  s        hsdg.audit_change_set;
  pending  bigint[];
  still    bigint[];
  lid      bigint;
  e        hsdg.audit_change_log;
  summary  jsonb;
BEGIN
  IF direction NOT IN ('undo', 'redo') THEN
    RAISE EXCEPTION 'direction must be undo or redo' USING ERRCODE = '22023';
  END IF;
  IF NOT hsdg.is_engagement_member(eng) THEN
    RAISE EXCEPTION 'not a member of this engagement' USING ERRCODE = '42501';
  END IF;

  s := CASE direction WHEN 'undo' THEN hsdg.audit_undo_candidate(eng)
                      ELSE hsdg.audit_redo_candidate(eng) END;
  IF s.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A signed-off or archived file is final: no step on it is replayed.
  IF EXISTS (SELECT 1 FROM hsdg.service_workflow_instances wi
              WHERE wi.engagement_id = eng
                AND (wi.signed_off_at IS NOT NULL OR wi.archived_at IS NOT NULL
                     OR wi.status IN ('archived', 'cancelled'))) THEN
    RAISE EXCEPTION 'audit file is signed off' USING ERRCODE = 'HU423';
  END IF;

  -- The replay itself is not a new change.
  PERFORM set_config('hsdg.change_set', '', true);

  SELECT array_agg(id ORDER BY CASE direction WHEN 'undo' THEN -id ELSE id END)
    INTO pending FROM hsdg.audit_change_log WHERE change_set_id = s.id;

  WHILE COALESCE(array_length(pending, 1), 0) > 0 LOOP
    still := '{}';
    FOREACH lid IN ARRAY pending LOOP
      SELECT * INTO e FROM hsdg.audit_change_log WHERE id = lid;
      BEGIN
        IF direction = 'undo' THEN
          PERFORM hsdg.audit_undo_apply_row(e.table_name, e.pk, e.after_row, e.before_row);
        ELSE
          PERFORM hsdg.audit_undo_apply_row(e.table_name, e.pk, e.before_row, e.after_row);
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        still := still || lid;
      END;
    END LOOP;
    IF array_length(still, 1) = array_length(pending, 1) THEN
      RAISE EXCEPTION 'audit file changed since' USING ERRCODE = 'HU409';
    END IF;
    pending := still;
  END LOOP;

  UPDATE hsdg.audit_change_set
     SET undone_at = CASE direction WHEN 'undo' THEN clock_timestamp() ELSE NULL END
   WHERE id = s.id;

  summary := hsdg.audit_change_summary(s.id);
  RETURN jsonb_build_object('id', s.id, 'label', s.label, 'at', s.created_at, 'changes', summary);
END;
$$;

REVOKE ALL ON FUNCTION hsdg.audit_undo_apply_row(text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION hsdg.audit_undo_capture() FROM PUBLIC;

-- Down Migration

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgname, tgrelid::regclass AS rel FROM pg_trigger
     WHERE tgname LIKE '%\_undo\_capture' AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', r.tgname, r.rel);
  END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS hsdg.audit_undo_apply(uuid, text);
DROP FUNCTION IF EXISTS hsdg.audit_undo_apply_row(text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS hsdg.audit_undo_status(uuid);
DROP FUNCTION IF EXISTS hsdg.audit_change_summary(uuid);
DROP FUNCTION IF EXISTS hsdg.audit_redo_candidate(uuid);
DROP FUNCTION IF EXISTS hsdg.audit_undo_candidate(uuid);
DROP FUNCTION IF EXISTS hsdg.audit_undo_capture();
DROP FUNCTION IF EXISTS hsdg.audit_undo_pk_cols(text);
DROP FUNCTION IF EXISTS hsdg.audit_undo_strip(jsonb);
DROP TABLE IF EXISTS hsdg.audit_change_log;
DROP TABLE IF EXISTS hsdg.audit_change_set;
