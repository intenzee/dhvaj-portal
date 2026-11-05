-- ─────────────────────────────────────────────────────────────────────────
-- Chat: direct messages between two people in the firm (WhatsApp-style)
--
--   · hsdg.chat_conversations: one per pair of employees (stored low id
--     first, so a pair has exactly one).
--   · hsdg.chat_messages: text, or a photo / voice note / document (the
--     bytes in the firm's document storage under "chat/…", as HR files are),
--     with the ticks: delivered_at (reached the other person's portal) and
--     read_at (they opened the chat). Only the recipient sets those two.
--   · hsdg.chat_presence: when each person's portal was last seen and until
--     when it counts as open (the live stream keeps it), for "online" and
--     "last seen".
--   · Only the two people in a chat see it — nobody firm-wide, not the
--     Managing Partner, not an administrator.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.chat_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_a_id    uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  employee_b_id    uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  CONSTRAINT chat_conversations_pair CHECK (employee_a_id < employee_b_id),
  CONSTRAINT chat_conversations_pair_key UNIQUE (employee_a_id, employee_b_id)
);
CREATE INDEX chat_conversations_b_idx ON hsdg.chat_conversations (employee_b_id);

CREATE TABLE hsdg.chat_messages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id        uuid NOT NULL REFERENCES hsdg.chat_conversations (id) ON DELETE CASCADE,
  sender_employee_id     uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  -- Denormalised for the policies (a direct chat has one recipient).
  recipient_employee_id  uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  body                   text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  client_ref             uuid,
  attachment_kind        text CHECK (attachment_kind IN ('image', 'voice', 'document')),
  file_name              text CHECK (file_name IS NULL OR length(file_name) BETWEEN 1 AND 255),
  content_type           text CHECK (content_type IS NULL OR length(content_type) <= 150),
  size_bytes             bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  duration_ms            integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  checksum_sha256        text,
  storage_reference      text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  delivered_at           timestamptz,
  read_at                timestamptz,
  CONSTRAINT chat_messages_parties CHECK (sender_employee_id <> recipient_employee_id),
  -- Text, or an attachment (with an optional caption).
  CONSTRAINT chat_messages_content CHECK (length(btrim(body)) > 0 OR attachment_kind IS NOT NULL),
  CONSTRAINT chat_messages_attachment CHECK (
    (attachment_kind IS NULL) = (storage_reference IS NULL)
    AND (attachment_kind IS NULL) = (file_name IS NULL)
    AND (attachment_kind IS NULL) = (content_type IS NULL)
    AND (attachment_kind IS NULL) = (size_bytes IS NULL)),
  -- Read implies delivered.
  CONSTRAINT chat_messages_ticks CHECK (read_at IS NULL OR delivered_at IS NOT NULL),
  CONSTRAINT chat_messages_client_ref_key UNIQUE (sender_employee_id, client_ref)
);
CREATE INDEX chat_messages_conversation_idx ON hsdg.chat_messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX chat_messages_unread_idx ON hsdg.chat_messages (recipient_employee_id, conversation_id)
  WHERE read_at IS NULL;
CREATE INDEX chat_messages_undelivered_idx ON hsdg.chat_messages (recipient_employee_id)
  WHERE delivered_at IS NULL;

CREATE TABLE hsdg.chat_presence (
  employee_id   uuid PRIMARY KEY REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- Online while this is in the future: each ping of an open portal pushes it
  -- a minute on; closing the portal sets it to now.
  online_until  timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON hsdg.chat_conversations, hsdg.chat_messages, hsdg.chat_presence FROM PUBLIC;
GRANT SELECT, INSERT ON hsdg.chat_conversations TO hsdg_app;
GRANT UPDATE (last_message_at) ON hsdg.chat_conversations TO hsdg_app;
GRANT SELECT, INSERT ON hsdg.chat_messages TO hsdg_app;
GRANT UPDATE (delivered_at, read_at) ON hsdg.chat_messages TO hsdg_app;
GRANT SELECT, INSERT ON hsdg.chat_presence TO hsdg_app;
GRANT UPDATE (last_seen_at, online_until) ON hsdg.chat_presence TO hsdg_app;

ALTER TABLE hsdg.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.chat_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.chat_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.chat_presence FORCE ROW LEVEL SECURITY;

-- The two people in it, and no one else.
CREATE POLICY chat_conversations_select ON hsdg.chat_conversations FOR SELECT TO hsdg_app
  USING (hsdg.ctx_employee_id() IN (employee_a_id, employee_b_id));
CREATE POLICY chat_conversations_insert ON hsdg.chat_conversations FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_employee_id() IN (employee_a_id, employee_b_id));
CREATE POLICY chat_conversations_update ON hsdg.chat_conversations FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_employee_id() IN (employee_a_id, employee_b_id))
  WITH CHECK (hsdg.ctx_employee_id() IN (employee_a_id, employee_b_id));

CREATE POLICY chat_messages_select ON hsdg.chat_messages FOR SELECT TO hsdg_app
  USING (hsdg.ctx_employee_id() IN (sender_employee_id, recipient_employee_id));
-- You send as yourself, to the other person in a chat you are in.
CREATE POLICY chat_messages_insert ON hsdg.chat_messages FOR INSERT TO hsdg_app
  WITH CHECK (
    sender_employee_id = hsdg.ctx_employee_id()
    AND EXISTS (SELECT 1 FROM hsdg.chat_conversations c
                 WHERE c.id = conversation_id
                   AND sender_employee_id IN (c.employee_a_id, c.employee_b_id)
                   AND recipient_employee_id IN (c.employee_a_id, c.employee_b_id)));
-- Only the recipient sets the ticks.
CREATE POLICY chat_messages_update ON hsdg.chat_messages FOR UPDATE TO hsdg_app
  USING (recipient_employee_id = hsdg.ctx_employee_id())
  WITH CHECK (recipient_employee_id = hsdg.ctx_employee_id());

-- Anyone signed in sees when anyone was last seen; each touches only their own.
CREATE POLICY chat_presence_select ON hsdg.chat_presence FOR SELECT TO hsdg_app
  USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY chat_presence_insert ON hsdg.chat_presence FOR INSERT TO hsdg_app
  WITH CHECK (employee_id = hsdg.ctx_employee_id());
CREATE POLICY chat_presence_update ON hsdg.chat_presence FOR UPDATE TO hsdg_app
  USING (employee_id = hsdg.ctx_employee_id())
  WITH CHECK (employee_id = hsdg.ctx_employee_id());

-- Down Migration

DROP TABLE IF EXISTS hsdg.chat_presence;
DROP TABLE IF EXISTS hsdg.chat_messages;
DROP TABLE IF EXISTS hsdg.chat_conversations;
