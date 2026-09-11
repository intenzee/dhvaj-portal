# Microsoft 365 document editing — SharePoint Online provisioning checklist

This is the one-time setup to make the portal's in-app document editor open
Word / Excel / PowerPoint in **Microsoft's genuine Office-for-the-web editor**
(with co-authoring), backed by your existing **SharePoint Online** (the same
thing that opens files in the browser when you use SharePoint today).

The application code is already built and is **inert until you complete these
steps and set the environment values** (`M365_ENABLED=true`). Until then the
portal keeps using OnlyOffice, then the built-in editors, exactly as before.

**Who does this:** a Microsoft 365 **Global/SharePoint admin** in your tenant.
Budget ~30–60 minutes plus tenant-admin consent. **No Azure subscription or
pay-as-you-go billing is required** — SharePoint storage is covered by your
Microsoft 365 Enterprise licences.

---

## Why it's shaped this way (context)

Microsoft only renders its real Office web editor/viewer for files that live
*inside* Microsoft, and it will only render to a browser that is **either signed
into a Microsoft account, or opening an anonymous ("Anyone with the link")
sharing link.** Because the portal must open files **without asking each user to
sign into their own Microsoft account** — the whole feature runs on **one
enterprise identity** — the portal mints **anonymous** links.

So the document **bytes are copied into a single, dedicated SharePoint site**
that the portal owns, and:

- **No end user is a member of that SharePoint site** — there is nothing for
  them to browse to, and they never see a Microsoft login.
- Only the portal's **Entra app** can touch the site, scoped with
  **`Sites.Selected`** to just that one site (the tight, recommended grant).
- When a user opens a document, the **portal API checks RLS first** (its own
  auth is the single gatekeeper), then mints a **short-lived anonymous sharing
  link** to just that one file. The link opens in genuine Office 365 for the web
  with no sign-in. Its short expiry (default 2 h, `M365_LINK_EXPIRY_MINUTES`)
  limits the value of a copied URL; the user just gets a fresh link next time.
- Users who may manage the engagement get **edit** links (co-authoring +
  commit); everyone else gets **view**. If the tenant/site refuses anonymous
  edit links, the bridge transparently falls back to a view link so the file
  still opens. Set `M365_ALLOW_ANON_EDIT=false` to force view-only everywhere.

PostgreSQL stays the record of truth for metadata, versions and the audit trail;
SharePoint holds only the live editing/viewing copy.

> **Tenant policy requirement:** the no-login model needs the provisioned site's
> external-sharing setting to allow **"Anyone" (anonymous) links**. If your
> tenant forbids anonymous sharing outright, this no-login model is not possible
> and users would have to sign into Microsoft instead.

---

## Checklist

### 1. Create a dedicated SharePoint site
- [ ] In the **SharePoint admin center**, create a new site (e.g.
      "Dhvaj Portal Documents"). Do **not** add end users as members — leave
      membership to admins/service only.
- [ ] Note the site's URL. You'll get its **site id** in step 4.

### 2. Register (or reuse) an Entra app registration
- [ ] In **Entra ID → App registrations**, register an app (or reuse the
      portal's existing API app). Note the **Directory (tenant) ID** and
      **Application (client) ID**.
- [ ] Add a **client secret** (or, preferred for production, a certificate).
      Record it securely — it goes into `M365_CLIENT_SECRET`.

### 3. Grant Graph permissions (site-scoped)
- [ ] Under **API permissions → Microsoft Graph → Application permissions**, add
      **`Sites.Selected`** and **grant admin consent**.
- [ ] Grant this app **write** access to *only* the site from step 1. Using
      Graph (as a SharePoint admin), POST to:
      `POST /sites/{siteId}/permissions`
      ```json
      {
        "roles": ["write"],
        "grantedToIdentities": [
          { "application": { "id": "<application (client) id>", "displayName": "Dhvaj Portal" } }
        ]
      }
      ```
      This is what makes `Sites.Selected` resolve to *this one site* and nothing
      else in the tenant.

### 4. Get the site id and drive id
- [ ] **Site id:** `GET /sites/{hostname}:/sites/{site-path}` — e.g.
      `GET /sites/contoso.sharepoint.com:/sites/DhvajPortalDocuments` → `id`.
- [ ] **Drive id (recommended to pin):** `GET /sites/{siteId}/drive` → `id`
      (the default document library). Record it → `M365_DRIVE_ID`.
  - You can instead set only `M365_SITE_ID` and let the portal resolve the
    default drive on first use; pinning `M365_DRIVE_ID` just skips that lookup.

### 5. Set environment values (portal API)
Set these in the API's deployment secret store (do **not** commit them; the repo
`.env` is treated as a secret and is not read by tooling):

```
M365_ENABLED=true
M365_TENANT_ID=<directory (tenant) id>
M365_CLIENT_ID=<application (client) id>
M365_CLIENT_SECRET=<client secret>       # or wire a certificate instead
M365_SITE_ID=<site id>                    # optional if M365_DRIVE_ID is set
M365_DRIVE_ID=<document library drive id> # recommended (pin it)
# Optional (defaults shown):
# M365_LINK_EXPIRY_MINUTES=120  # how long each no-login link stays valid
# M365_ALLOW_ANON_EDIT=true     # true = anonymous edit/co-author; auto-falls back to view if the tenant refuses
# M365_GRAPH_BASE_URL=https://graph.microsoft.com/v1.0   # override for national clouds
# M365_LOGIN_BASE_URL=https://login.microsoftonline.com  # override for national clouds
```

### 5a. Allow anonymous ("Anyone") links on the site
- [ ] In the **SharePoint admin center → the site's sharing settings**, set the
      site's external sharing to **"Anyone"** so the portal can mint no-login
      links. (Tenant-level external sharing must also permit "Anyone".) Without
      this, Graph rejects the link creation and the portal falls back to
      OnlyOffice. If your policy cannot allow anonymous links, the no-login goal
      is not achievable — see the note in "Why it's shaped this way".

### 6. Set environment values (portal web)
```
NEXT_PUBLIC_M365_ENABLED=true
```
(The file opens via the portal-minted anonymous link — **no Microsoft sign-in is
required of the user**. The portal's own login/RLS is the gatekeeper, so this
works regardless of which portal auth provider you run.)

---

## After provisioning — hand back to engineering

The sharing shape depends on your tenant's external-sharing policy, verified live
against the provisioned site (`apps/api/src/modules/documents/m365/graph-client.ts`,
`createShareLink`):

- The bridge mints a **short-lived anonymous link** via the `createLink` action
  (`scope: anonymous`, `type: view`, `expirationDateTime`) so files open with no
  user login. If the tenant/site does not allow anonymous links, this call is
  rejected and the portal falls back to OnlyOffice — set the site sharing to
  "Anyone" (step 5a). Anonymous **edit** links (`type: edit`, gated by
  `M365_ALLOW_ANON_EDIT`) are enabled only where the tenant permits them.

We also confirm the **embed vs. new-tab** behaviour: SharePoint may refuse to
render its editor inside the portal's iframe (frame-ancestors). The editor
component already shows an **"Open in Microsoft 365"** button that launches the
same URL in a new tab (never subject to that restriction), so viewing/editing
works either way; we tune which is the default once we see the tenant's headers.

## Verification (once live)
1. Open an `.xlsx` document in the portal **without** signing into Microsoft.
2. Confirm it opens in the **real Excel for the web** (not OnlyOffice), with no
   Microsoft login prompt — embedded, or via **Open in Microsoft 365**.
3. (If `M365_ALLOW_ANON_EDIT=true`) Edit a cell → click **Commit version** →
   confirm a new version appears in the document's history with note "Edited in
   Microsoft 365", and downloading it returns the edited bytes.
4. As a user who is **not** a member of the engagement, confirm the document is
   not accessible (404) — the portal's RLS is intact.
5. Copy a link, wait past `M365_LINK_EXPIRY_MINUTES`, and confirm it has expired.
6. Set `M365_ENABLED=false` → confirm the portal **falls back to OnlyOffice**,
   then to the built-in editors.

## Rollback
Set `M365_ENABLED=false` (API) and `NEXT_PUBLIC_M365_ENABLED=false` (web). The
portal reverts to OnlyOffice with no data migration — committed versions never
lived in SharePoint, only the live editing copies did.
