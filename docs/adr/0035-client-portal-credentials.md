# ADR-0035 · Client portal credentials and the firm's login workbook import

Status: accepted · 2026-10-15

## Context

The firm keeps every client's portal logins in one Excel workbook that is
passed around by e-mail and USB: a **GST Login** sheet (S.No, name with the
state in brackets, return frequency, GST ID, password, GSTIN, then per month
the GSTR-1 / GSTR-3B / GSTR-7 status, "filed" or "NA", and a Fees column) and a
**TDS Login** sheet (name, e-mail, the PAN's and the TAN's income-tax logins,
the TRACES deductor and taxpayer logins, DOI, return status, Ack. No). An ITR
sheet tracks returns, not logins. Staff need the login to
file returns; nobody else should ever see it. The portal already holds the
clients (`entities`) and their GSTINs (`entity_registrations`), scoped by office
and engagement through row-level security, but it stores no secrets anywhere.

Two needs:

1. **Store the logins in the portal**, encrypted, shown only when a person
   taps "Show", and only to people who work on that client.
2. **Read that workbook as it is** — the firm's own format, not a template —
   and bring its clients into the portal (client + GSTINs + TAN + contact +
   every login, the GSTIN's monthly / quarterly scheme and the months marked
   filed / NA) without anyone retyping it, and without the passwords passing
   through anything but the API that encrypts them.

## Decision

### 1. Storage — `hsdg.client_credentials`

A login belongs to the **client**, and points at the registration it is for
when there is one:

| portal       | account    | registration                                                   |
| ------------ | ---------- | -------------------------------------------------------------- |
| `gst`        | `main`     | the GSTIN — or none yet, with a `state_code` ("GSTIN to come") |
| `income_tax` | `main`     | none (the client's PAN)                                        |
| `income_tax` | `tan`      | the TAN                                                        |
| `traces`     | `deductor` | the TAN                                                        |
| `traces`     | `taxpayer` | none (the PAN)                                                 |

The portal check list also allows `mca`, `eway_bill` and `einvoice` for the
same shape later. One login per (client, portal, account, registration or
state).

| column                         | notes                                                           |
| ------------------------------ | --------------------------------------------------------------- |
| `id`, `entity_id`              | FK to `entities`, cascade on delete                             |
| `registration_id`              | FK to `entity_registrations`, set null on delete                |
| `portal`, `account`            | see above                                                       |
| `state_code`                   | the GST state, for a login whose GSTIN is not in yet            |
| `pending_gst_scheme`           | `regular` / `qrmp` from the sheet, applied when the GSTIN comes |
| `username_hint`                | `ab•••yz` — shown in lists so people can tell logins apart      |
| `ciphertext`, `iv`, `auth_tag` | AES-256-GCM of `{"u": username, "p": password}`                 |
| `key_version`                  | which key encrypted it (rotation)                               |
| `created_*`, `updated_*`       | who set it and when                                             |

**GSTIN later.** A GST row without a GSTIN is imported as a login waiting on
the client with its state ("Maharashtra · GSTIN to come"). When someone adds
that state's GSTIN to the client, the trigger
`hsdg.attach_pending_gst_login()` moves the login onto the new registration
and seeds its scheme (`regular` or `qrmp`, QRMP category X/Y from the state)
from the FY start. The ciphertext's AAD does not include the registration, so
the move needs no re-encryption.

- **Encryption happens in the API** (Node `crypto`, AES-256-GCM, a fresh
  12-byte IV per write). The additional authenticated data is
  `credential id | client id | portal | account`, so a ciphertext copied onto
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
   "engagements" setting). Writing one also needs `ctx_can_manage_credentials`:
   firm-wide, or a partner / manager of the client's home office.
2. **Column privileges** — the application role `hsdg_app` cannot `SELECT`
   `ciphertext`, `iv` or `auth_tag` at all. The only way to read them is the
   `SECURITY DEFINER` function `hsdg.reveal_client_credential(id)`, which
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
- Shown on the client's Registrations — the GST login under each GSTIN, the
  income-tax (TAN) and TRACES deductor logins under the TAN, then the PAN's
  income-tax and TRACES taxpayer logins and any GST login waiting for its
  GSTIN — and on the GST filing drawer next to the GSTIN, where the preparer
  actually needs it.

### 4. The login workbook import

Clients → **Import client logins** (needs `credential.manage` and
`entity.manage`). The person picks the workbook, the office new clients
belong to, and the type to assume when a new client's PAN and name do not say.

**Reading the workbook** (`client-workbook.ts`, pure, in memory, nothing
stored):

- Each sheet's heading row is found in its first 15 rows by recognising the
  firm's headings (S.No, Name, GSTIN, GST ID / Login ID, Password, Frequency,
  PAN, TAN, TRACES login, E-mail, GSTR-1 / 3B / 7). A sheet is a **GST** sheet
  if it has GSTIN / return / frequency columns, a **TDS** sheet if it has TAN or
  TRACES columns; anything else (the ITR sheet) is skipped and said so.
- Each password column pairs with the nearest ID / PAN / TAN column to its
  left. The months are read from the row above the headings (merged cells
  carried across: "Apr-26", "April 2026", dates…); a "filed" (or a date) marks
  the return filed, "NA" not applicable; anything else is counted and left.
- Fees, DOI, Return filing status and Ack. No are ignored (the firm's choice).
- "Name (Delhi)" / "Name - Mumbai" is the client plus the **state of that GST
  registration**; rows with the same name or PAN become one client with
  several registrations. TDS rows join their client by PAN, then by name.
- Frequency Monthly → `regular`, Quarterly → `qrmp`.
- Errors that stop a client: a GSTIN with a bad check digit, the same GSTIN
  twice, two rows of one state without GSTINs, a PAN that disagrees with the
  portal's client of that name.

**Preview** returns, per client: the rows it came from ("GST Login 5, 6 · TDS
Login 3"), name, PAN / TAN, type (and whether it was assumed), each GST
registration with its state, frequency and filed / NA counts, each login's
target and hint — **never a password** — and the action: **new client**,
**update client** (add the registrations and logins it lacks, refresh
logins), **already here** or **cannot import**.

**Import** sends the same file again; each client is written in its own
transaction, so one bad client does not stop the rest:

1. create or complete the client (GSTINs, TAN, a tax contact with the e-mail);
2. seal and save every login (a GSTIN-less GST login waits with its state);
3. set each new GSTIN's scheme (`hsdg.set_initial_gst_scheme` — only when it
   has none);
4. apply the month marks to the filings the client's GST engagement already
   has (GSTR-1 / 3B monthly or quarterly, GSTR-7): filed → completed, NA →
   waived "Marked NA in the firm's login workbook", then the workflow status
   is refreshed. A quarterly GSTIN takes only the quarter-end month's mark.
   Marks for months with no filing yet are counted, not lost: re-importing
   once the engagement exists applies them; filings already done are left;
   people who do not lead the engagement cannot mark them (counted).

The audit log records counts, never secrets. Re-importing the same workbook is
safe: it adds nothing twice.

Passwords therefore travel once from the browser to the API over HTTPS and
are encrypted before anything is written; request bodies are never logged
(pino logs no bodies; `authorization`/cookies are redacted).

## Consequences

- Production needs `CREDENTIALS_KEYS` set (Render → Environment) before logins
  can be saved. Losing the key loses the logins (the clients stay); keep a copy
  in the firm's password manager.
- The original workbook should be deleted from laptops and mail once the
  import is checked.
- The import follows the firm's headings, not exact cell positions; a
  renamed heading the parser does not know shows up in the preview as a
  sheet "skipped" or a missing column, before anything is written.
- `xlsx` 0.18.5 (already used for the compliance calendar) parses the upload.
  Only people with `credential.manage` can upload, and the upload is capped by
  the JSON body limit.
- Mobile follows the web: the same reveal endpoint, behind the same
  permission.
