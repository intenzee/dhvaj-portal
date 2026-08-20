# ADR-0015 — Documents

- **Status:** Accepted
- **Date:** 2026-08-20
- **Phase:** 10 (Documents)

## Context

Phase 10 adds document management to the engagement (§12). The brief is specific:
actual files go to **Azure Blob Storage** (not PostgreSQL); the database stores
**metadata and a storage reference**; document access must **inherit engagement
permissions**; a user must **not be able to bypass RLS by obtaining a direct file
URL**; downloads must be **audited**; and completed/signed-off professional
evidence must **not be silently replaced** — use **controlled versioning**.

## Decisions

### 1. Two tables: a mutable logical document + an immutable version chain

`documents` is the logical record — engagement, title, `document_type`,
`classification`, `sensitivity`, `status` (active/archived), a pointer to the
current version, and an optional `retention_until`. Its metadata is mutable
(leads may re-classify, archive, restore). `document_versions` is the version
chain: one immutable row per uploaded file with `filename`, `content_type`,
`size_bytes`, a **SHA-256 checksum**, the opaque `storage_reference`, and who
uploaded it. Uploading again creates a **new** version and advances the pointer;
earlier versions and their blobs are **retained**. Version rows are **append-only
to the app role** (`REVOKE UPDATE, DELETE`) — evidence can never be silently
replaced. The logical `documents` row is likewise **never hard-deleted**
(`REVOKE DELETE`), so a delete can't cascade into the immutable chain; archive is
the only removal.

### 2. The bytes live behind a storage-provider abstraction

The database is the system of record for *metadata*; the bytes sit behind a
`StorageProvider` interface, selected by `STORAGE_PROVIDER` exactly as auth
selects its provider:

- `local` — a filesystem provider for dev/test (the default), so the whole
  pipeline runs in CI with no Azure account.
- `azure_blob` — Azure Blob Storage for production. Its SDK is an **optional**
  dependency, `require`d lazily only when selected, so dev/test never install it.

References are opaque, application-minted keys (`<engagement>/<document>/<uuid>`),
never client-supplied and never returned in any API response.

### 3. Downloads are RLS-mediated and audited — there is no bypass URL

There is no public/pre-signed URL. A download first reads the version row **under
the caller's RLS context**; a non-member's read returns zero rows → `404` (the
storage reference is never reached, existence not leaked). Only an RLS-passing
read yields the reference, after which the API streams the bytes and writes a
`document.downloaded` **audit event in the same transaction**. So possessing a
document id can never be turned into a fetch of the bytes, and every successful
download is on the immutable trail. Proven end-to-end and at the DB layer.

### 4. Access inherits the engagement (members read, leads write)

RLS mirrors reviews/compliance: `is_engagement_member` reads (list, detail,
download), `is_engagement_lead` writes (upload, re-version, re-classify, archive,
restore). No new permission — reads use `engagement.read`, writes
`engagement.manage`, so access genuinely *inherits* the engagement.

### 5. Uploads are base64-in-JSON with a size ceiling

Files are uploaded base64-encoded inside the JSON body, decoded and validated by
a pure `decodeUpload` helper (empty/invalid base64 → `400`; over
`DOCUMENT_MAX_BYTES` → `413`) that also computes the checksum. This keeps the
whole surface within the existing DTO-validation and transaction model with no
new multipart/streaming dependency. The JSON body ceiling is raised from the
100 kB default to clear the largest allowed file plus base64 overhead. The blob
is written first and the metadata committed atomically; a failed/denied metadata
transaction compensates by removing the orphan blob.

## Consequences

- Upload → download returns the exact bytes; a new version supersedes while the
  prior version stays downloadable by its id — proven end-to-end.
- An unassigned partner cannot list, read, or download another engagement's
  documents even with the real document id (`404`); a team member (senior) can
  download but cannot upload.
- Version rows and the logical document are immutable/undeletable to the app
  role at the database layer (proven independently of the API).
- Every create, version, metadata change, archive, restore, and **download** is
  audited.

## Known limitations / deferred (not gold-plated)

- **Base64-in-JSON, not multipart/streaming.** Simple and dependency-free, but
  the whole file is buffered in memory and capped at `DOCUMENT_MAX_BYTES`
  (default 10 MiB). Large-file multipart upload and direct-to-blob streaming
  (SAS-based, still authorised + audited by the API) are a future enhancement
  behind the same storage interface.
- **Uploads are lead-only.** A senior/article on the team can download but not
  upload working papers. A `document.upload` permission with an assignee-style
  RLS vector (as Phase 9 did for `task.update`) can be added when the firm wants
  members to contribute evidence directly.
- **Antivirus / content scanning and retention enforcement are not wired.**
  `retention_until` is recorded but no purge job acts on it; virus scanning on
  upload is deferred.
- **No de-duplication.** The checksum is stored for integrity and could later
  drive content de-dup, but identical bytes are currently stored per version.
