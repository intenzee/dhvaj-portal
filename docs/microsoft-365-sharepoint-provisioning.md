# Microsoft 365 — SharePoint storage + Office editing: setup & cutover

This is the one-time setup that connects the portal to the firm's Microsoft 365
tenant (Dhvaj & Associates, `084db8e6-ad22-46e5-9410-a1083b6f6dde`, Business Basic) for two things:

1. **All document storage in SharePoint** — every uploaded version, client
   upload and template version is kept in one locked-down SharePoint site
   (`STORAGE_PROVIDER=sharepoint`), instead of the server's disk / Azure Blob.
2. **Office editing** — Word / Excel / PowerPoint open in **Microsoft's genuine
   Office-for-the-web editor** (with co-authoring) via short-lived anonymous
   links (`M365_ENABLED=true`). OnlyOffice, then the built-in editors, remain the
   automatic fallbacks.

Both are **inert until the values below are set**. No Azure subscription or
pay-as-you-go billing is needed — SharePoint storage comes with the Microsoft 365
licences (1 TB + 10 GB per licence).

Not in scope (decided 2026-10-12): Microsoft sign-in to the portal, Outlook
email and Teams messages — the portal's own login, notifications and reminders
cover those.

---

## How it's shaped

- **One dedicated SharePoint site** holds the files. **No staff member is a
  member of it** — nobody browses it; the portal is the only way in.
- Only the portal's **Entra app** can touch the site, through **`Sites.Selected`**
  scoped to *just that one site*. The app has no access to any other site,
  mailbox or OneDrive in the tenant.
- Library layout:
  - `vault/{engagementId}/{documentId}/{uuid}` — stored versions (immutable;
    every new version gets a new file). Templates live under `vault/templates/…`.
  - `portal/{engagementId}/{documentId}/v{n}/{filename}` — the live copy the
    Office editor co-authors. Edits come back into the portal as a **new audited
    version** when the editor closes — the stored versions are never edited in
    place.
- When someone opens a document, the **portal API checks their access first**
  (RLS), then mints a **short-lived anonymous link** (default 2 h,
  `M365_LINK_EXPIRY_MINUTES`) to that one file. It opens in real Office for the
  web with **no Microsoft sign-in**. Engagement managers get edit links; everyone
  else view links; approved/locked documents always open read-only.
- PostgreSQL stays the record of truth for metadata, checksums, versions and the
  audit trail.

---

## Checklist

`<tenant>` below is the first part of the tenant's SharePoint address — open
**SharePoint admin center** and read it from the browser's address bar
(`https://<tenant>-admin.sharepoint.com`).

The portal was first set up in the HSDG tenant (2026-10-12); on 2026-10-21 it
moved to Dhvaj & Associates' own tenant. Files kept their paths, so moving them
is a copy of the `vault` folder between the two sites (see "Moving between
tenants" below).

### 0. App registration and site
- [ ] entra.microsoft.com → **App registrations → New registration**: name
      `DHVAJ Portal Storage`, "Accounts in this organizational directory only",
      no redirect URI. Copy the **Application (client) ID**.
- [ ] SharePoint admin center → **Sites → Active sites → Create → Team site**
      (or Communication site): name `DHVAJ Portal Files`, address
      `/sites/DHVAJPortalFiles`, owner the Global Admin. Add no members.

### 1. App permissions — only one is needed
- [ ] entra.microsoft.com → **App registrations → DHVAJ Portal Storage → API permissions**.
- [ ] **Add a permission → Microsoft Graph → Application permissions →
      `Sites.Selected`**, then click **Grant admin consent for Dhvaj & Associates**
      (status must show a green tick).
- [ ] Nothing else — email/Teams are out of scope, and least privilege matters.

### 2. Client secret
- [ ] **Certificates & secrets → New client secret** (e.g. 24 months). Copy the
      **Value** column (not the Secret ID) — it is shown only once.
- [ ] Put a calendar reminder a few weeks before it expires; when it does, files
      stop opening until a new secret is set.

### 3. Grant the app access to the one site (Graph Explorer, ~3 minutes)
`Sites.Selected` grants *nothing* until a site is explicitly granted:

1. Open <https://developer.microsoft.com/graph/graph-explorer> and sign in as the
   Global Admin.
2. **Modify permissions** tab → consent to **`Sites.FullControl.All`** (this is
   for *you* in Graph Explorer, not the portal app).
3. Run **GET**
   `https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/DHVAJPortalFiles?$select=id`
   → copy the `id` (looks like `<tenant>.sharepoint.com,xxxx,yyyy`).
4. Run **POST** `https://graph.microsoft.com/v1.0/sites/{that id}/permissions`
   with body:
   ```json
   {
     "roles": ["write"],
     "grantedToIdentities": [
       { "application": { "id": "<storage app client id>", "displayName": "DHVAJ Portal Storage" } }
     ]
   }
   ```
   A `201 Created` response means the portal can now read/write that site and
   nothing else. Keep the returned permission `id` (needed only for step 4b).

### 4. Allow anonymous ("Anyone") links — for Office editing only
Storage works without this; the Office editor needs it.

- [ ] **SharePoint admin center → Policies → Sharing**:
  - External sharing, **SharePoint** slider → **Anyone** (OneDrive can stay lower).
  - **File and folder links → Default link type → "Only people in your
    organization"** (or "Specific people") so staff's own everyday sharing does
    *not* default to anonymous.
  - **"Anyone" links → Files: View and edit** (needed for editing in Office).
    Expiry: any value ≥ 1 day is fine (the portal sets 2 h itself).
- [ ] **Sites → Active sites → DHVAJPortalFiles → Settings → External file
      sharing → Anyone**.
- [ ] Check your *other* sites (e.g. the main team site) are still at the level
      you want — set them to "Only people in your organization" if they should
      never allow anonymous links.

**4b. Only if `m365:check` says the link was refused even after the above:**
upgrade the grant from step 3 — **PATCH**
`https://graph.microsoft.com/v1.0/sites/{site id}/permissions/{permission id}`
with `{ "roles": ["fullcontrol"] }`.

### 5. Environment values (API)
Add to `apps/api/.env` locally, and to the hosting provider's secret settings in
production (never commit the secret):

```
M365_TENANT_ID=084db8e6-ad22-46e5-9410-a1083b6f6dde
M365_CLIENT_ID=<the storage app client id>
M365_CLIENT_SECRET=<the secret VALUE from step 2>
M365_SITE_URL=https://<tenant>.sharepoint.com/sites/DHVAJPortalFiles
# Optional: pin what `m365:check` prints to skip a lookup at boot
# M365_DRIVE_ID=b!...

# Office editing (step 4 must be done)
M365_ENABLED=true
# M365_LINK_EXPIRY_MINUTES=120
# M365_ALLOW_ANON_EDIT=true    # false = view-only everywhere

# All storage in SharePoint — set ONLY at cutover (section "Moving the files")
# STORAGE_PROVIDER=sharepoint
# STORAGE_SHAREPOINT_ROOT=vault
```

Web (`apps/web/.env.local`, and the web host's settings):

```
NEXT_PUBLIC_M365_ENABLED=true
```

### 6. Verify the connection
```
npm run m365:check --workspace @hsdg/api
```
It signs in as the app, finds the site and library, writes / reads back / deletes
a small test file, and mints an anonymous view + edit link — printing a ✓ per
step, or the exact fix (wrong secret, missing grant, sharing not "Anyone", …).

---

## Moving the files (cutover to `STORAGE_PROVIDER=sharepoint`)

The migration copies every stored file — document versions (including client
uploads) and template versions — into `vault/…` under **the same reference**, so
no database rows change. Each source file is checked against the SHA-256
recorded at upload before copying. It never modifies or deletes the source and is
safe to re-run (already-copied files are skipped).

```
# 0. See what would move (nothing is written)
npm run storage:migrate-sharepoint --workspace @hsdg/api -- --dry-run

# 1. Copy while the portal is still running (the bulk of the work)
npm run storage:migrate-sharepoint --workspace @hsdg/api -- --verify

# 2. Stop the API, then copy anything uploaded since step 1
npm run storage:migrate-sharepoint --workspace @hsdg/api -- --verify

# 3. Set STORAGE_PROVIDER=sharepoint, start the API
```

Flags: `--from=local|azure_blob` (defaults to the current `STORAGE_PROVIDER`),
`--concurrency=N` (default 4), `--db-url=…` (defaults to
`DATABASE_MIGRATE_URL`, the owner role, so RLS doesn't hide rows). The script
reads files from the same `STORAGE_LOCAL_DIR` / Azure settings the API uses, so
run it with the API's environment.

Only switch when the run ends with **"All files are in SharePoint"**. Anything
listed as `missing` or `corrupt` was already broken in the old store — the
summary names each one so it can be re-uploaded or written off.

**Keep the old store** (disk folder / Azure container) untouched for a few weeks
as a fallback.

---

## Moving between tenants (SharePoint → SharePoint)

Stored files are keyed by path inside the site's default **Documents** library
(`vault/{engagementId}/{documentId}/{uuid}`), and the database keeps only that
path — not the site or tenant. So the files move by copying the folder:

1. Set up the new tenant (steps 0–4 above) and run `m365:check` against it.
2. In the **old** site → Documents, select the `vault` folder → **Download**
   (a zip). Unzip it.
3. In the **new** site → Documents → **Upload → Folder** → choose the unzipped
   `vault` folder, so it sits at the library root with the same sub-folders.
4. Swap `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET` /
   `M365_SITE_URL` (and drop any `M365_DRIVE_ID`) and redeploy the API.
5. Open a few documents in the portal. Keep the old site for a few weeks before
   deleting it.

`portal/…` (the live Office-editing copies) need not move — they are recreated
on the next open.

## Verification (once live)
1. Upload a document, download it → identical bytes; it appears in the site under
   `vault/{engagement}/{document}/…` (visible to the admin in SharePoint).
2. Open an `.xlsx` **without** being signed into Microsoft → it opens in the real
   Excel for the web with no login prompt (embedded, or via **Open in Microsoft
   365** if SharePoint refuses the iframe).
3. As an engagement manager, edit a cell and close the editor → a new version
   appears with the note "Edited in Microsoft 365".
4. As a user **outside** the engagement → the document is not accessible (404).
5. After `M365_LINK_EXPIRY_MINUTES`, a copied link no longer opens.

## Rollback
- **Office editing:** set `M365_ENABLED=false` / `NEXT_PUBLIC_M365_ENABLED=false`
  → back to OnlyOffice / built-in editors. No data moves.
- **Storage:** set `STORAGE_PROVIDER` back to its old value. Files uploaded
  *while on SharePoint* exist only in SharePoint, so before rolling back copy them
  the other way (or leave SharePoint on and fix forward).
