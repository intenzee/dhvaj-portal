# ADR-0035 · Client portal credentials (GST logins) and the GST client import

Status: accepted · 2026-10-15

## Context

The firm keeps every GST client's portal login (GSTIN, user name, password) in a
spreadsheet that is passed around by e-mail and USB. Staff need the login to
file returns; nobody else should ever see it. The portal already holds the
clients (`entities`) and their GSTINs (`entity_registrations`), scoped by office
and engagement through row-level security, but it stores no secrets anywhere.

Two needs:

1. **Store the logins in the portal**, encrypted, shown only when a person
   taps "Show", and only to people who work on that client.
2. **Bring the spreadsheet's clients into the portal** (client + GSTIN +
   contact + login) without anyone retyping it, and without the passwords
   passing through anything but the API that encrypts them.

## Decision

### 1. Storage — `hsdg.registration_credentials`

One row per (GSTIN registration, portal). `portal` is `gst` today; the check
list already allows `income_tax`, `traces`, `mca`, `eway_bill` and `einvoice`
for the same shape later.

| column                     | notes                                                    |
| -------------------------- | -------------------------------------------------------- |
| `id`, `registration_id`    | FK to `entity_registrations`, cascade on delete          |
| `portal`                   | `gst` …                                                  |
| `username_hint`            | `ab•••yz` — shown in lists so people can tell logins apart |
| `ciphertext`, `iv`, `auth_tag` | AES-256-GCM of `{"u": username, "p": password}`      |
| `key_version`              | which key encrypted it (rotation)                        |
| `created_*`, `updated_*`   | who set it and when                                      |

- **Encryption happens in the API** (Node `crypto`, AES-256-GCM, a fresh
  12-byte IV per write). The additional authenticated data is
  `credential id | registration id | portal`, so a ciphertext copied onto
  another row fails to decrypt.
- **The key never touches the database.** It comes from the
  `CREDENTIALS_KEYS` environment variable: `1:<base64 32 bytes>[,2:<…>]`. The
  highest version encrypts; any listed version decrypts, which is how a key is
  rotated (add version 2, re-save, later drop version 1). A database dump or
  backup alone reveals nothing.
- Without `CREDENTIALS_KEYS` the API still runs; the credential endpoints
  answer 503 and the web says the vault is not set up.

### 2. Who can see what

Three layers, each enough on its own to stop a leak:

1. **Row-level security** (FORCE) — a credential row is visible exactly when
   its client is visible (office / engagement scope, including the article
   "engagements" setting).
2. **Column privileges** — the application role `hsdg_app` cannot `SELECT`
   `ciphertext`, `iv` or `auth_tag` at all. The only way to read them is the
   `SECURITY DEFINER` function `hsdg.reveal_registration_credential(id)`, which
   - checks the person may reveal: the managing partner; a partner of the
     client's home office; or a member of the team on one of the client's
     engagements;
   - refuses after 60 reveals by one person in an hour (scraping guard);
   - writes `hsdg.credential_access_log` (who, role, when) before it returns.
   So every read of a password is logged by the database itself.
3. **Permissions** — `credential.reveal` (managing partner, partner, manager,
   senior, article) and `credential.manage` to add, change, remove or import
   (managing partner, partner, manager). The platform `admin` role gets
   neither.

### 3. Showing a login

- Lists only ever carry `username_hint` and whether a login is saved.
- API: `GET /credentials?entityId=|registrationId=` (masked list),
  `PUT /credentials` (save or replace), `DELETE /credentials/:id`, and
  "Show" — `POST /credentials/:id/reveal` with `Cache-Control: no-store`.
  The web keeps the answer in component state (never the React Query cache),
  offers "Copy" for each field, and hides it again after 30 seconds or on
  navigation.
- The client page lists recent reveals (who and when) to partners.
- Shown on the client's Registrations, and on the GST filing drawer next to the
  GSTIN, where the preparer actually needs it.

### 4. The GST client import

Clients → **Import GST clients** (needs `credential.manage` and
`entity.manage`):

1. The person picks the `.xlsx`/`.csv` and the office the clients belong to.
2. **Preview** — the API parses the file in memory (nothing is stored),
   finds the header row and maps columns by name (GSTIN, legal/client name,
   trade name, user name/login id, password, e-mail, mobile, constitution).
   Every mapping can be changed in the preview. For each row it validates the
   GSTIN (format and check digit), derives the PAN, state and — from the
   PAN's fourth letter — the entity type, and decides an action:
   - **new client** (GSTINs sharing a PAN become one client with several
     registrations),
   - **add GSTIN** to an existing client with that PAN,
   - **save login** on a GSTIN already in the portal (or **already here**
     when the row has no login),
   - **cannot import** (bad GSTIN or check digit, the same GSTIN twice,
     missing name, a PAN whose type cannot be told and no Constitution column).
   A GSTIN or PAN that belongs to a client in an office the importer cannot
   see is only found when importing; that client's rows are reported as
   failed.
   The preview returns no passwords, only "password ✓" and the hint.
3. **Import** — the same file is sent again with the confirmed mapping; each
   client (its GSTINs, contact and logins) is written in its own transaction,
   so one bad client does not stop the rest. The audit log records counts, never
   secrets. Re-importing the same file changes nothing but the logins.

Passwords therefore travel once from the browser to the API over HTTPS and
are encrypted before anything is written; request bodies are never logged
(pino logs no bodies; `authorization`/cookies are redacted).

## Consequences

- Production needs `CREDENTIALS_KEYS` set (Render → Environment) before logins
  can be saved. Losing the key loses the logins (the clients stay); keep a copy
  in the firm's password manager.
- The original spreadsheet should be deleted from laptops and mail once the
  import is checked.
- `xlsx` 0.18.5 (already used for the compliance calendar) parses the upload.
  Only people with `credential.manage` can upload, and the upload is capped by
  the JSON body limit.
- Mobile follows the web: the same reveal endpoint, behind the same
  permission.
