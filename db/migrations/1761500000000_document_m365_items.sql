-- ─────────────────────────────────────────────────────────────────────────
-- 0041 · Document ↔ Microsoft 365 (SharePoint Online) live-item mapping
--
-- Adds the two columns the Microsoft 365 editor bridge needs to remember WHERE a
-- document's live, co-authorable copy lives inside the firm's SharePoint Online
-- document library. The portal keeps PostgreSQL as the system of record for
-- metadata, RLS and the append-only version history; SharePoint is only the
-- *editing surface*.
--
-- When a user opens the Microsoft 365 editor for a document, the bridge uploads
-- the current version bytes into an app-owned SharePoint drive item and records
-- that drive/item id here so subsequent opens reuse the same live item (enabling
-- real co-authoring). On "Commit version" the bridge pulls the live item's bytes
-- back and writes a new audited version through the normal append-only path —
-- SharePoint never becomes the record of truth.
--
-- SECURITY — these are opaque Microsoft item identifiers, never returned to a
-- client except via an RLS-passing session build (same guarantee as the storage
-- reference). They ride the documents table's existing RLS unchanged; no policy
-- change is needed because access still inherits the engagement.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.documents
  ADD COLUMN m365_drive_id text,
  ADD COLUMN m365_live_item_id text;

COMMENT ON COLUMN hsdg.documents.m365_drive_id IS
  'SharePoint document-library drive holding this document''s live editable copy (null until first opened in the Microsoft 365 editor).';
COMMENT ON COLUMN hsdg.documents.m365_live_item_id IS
  'driveItem id of the live, co-authorable copy inside the SharePoint drive (null until first opened in the Microsoft 365 editor).';

-- Down Migration

ALTER TABLE hsdg.documents
  DROP COLUMN IF EXISTS m365_live_item_id,
  DROP COLUMN IF EXISTS m365_drive_id;
