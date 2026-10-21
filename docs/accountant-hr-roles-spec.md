# Accountant and HR roles — design spec

- **Status:** Proposal, for partner sign-off (section 9 lists the decisions needed)
- **Date:** 2026-10-21
- **Written from two seats:** a senior partner (CA) — *what should this person do,
  see, and never see?* — and a senior engineer — *how does the portal enforce
  that, in the database and not just the menu?*
- **Builds on:** ADR-0003 (identity and RLS), ADR-0009 (security role
  separation), ADR-0018 (administration), ADR-0025 (billing and collections),
  ADR-0026 (resource management), ADR-0034 (time tracking), and portal
  passwords (1b63c73).

---

## 1. Summary

Two new roles join the six the portal has today (Managing Partner,
Administrator, Partner, Manager, Senior, Article):

| | **Accountant** | **HR** |
| --- | --- | --- |
| Purpose | Runs the firm's own money: invoices, receipts, collections, TDS credits, the firm's GST data. | Runs the firm's people: joiners, leavers, the employee master, articleship records, attendance and workload. |
| Lands on | **Accounts desk** | **People desk** |
| Sees | Every client's *billing profile* (name, PAN, GSTIN, address, billing contact), engagement *headers and fees*, billable hours, all invoices, receipts, credit notes, write-offs, receivables, TDS, finance reports. | Every employee's record, reporting lines, grades, joining/exit, articleship register, portal-login status, per-person daily hours and workload *without client names*. |
| Does | Drafts and issues invoices from agreed fees, records and allocates receipts, chases payment, imports and matches TDS credits, asks for credit notes and write-offs, exports the firm's GST and books data. | Adds and edits employees, creates portal logins for joiners (up to Manager), issues and resets their passwords, deactivates leavers, keeps the articleship register. |
| Asks a partner to approve | Credit notes, write-offs, fee waivers, voiding an invoice, reversing a receipt, changing billing settings, an invoice not backed by an agreed fee. | Any role above Manager, any change to a partner's or their own access, reassigning a leaver's engagements. |
| **Never** sees | Working papers, audit files, tasks, review notes, client documents, client portal logins, notices, engagement time *notes*. | Any client data, any engagement or client name, invoices or fees, client portal logins, working papers. |

Both roles are **firm-wide by default** (one accounts function, one HR function
for every office); section 9 asks whether to allow an office-scoped variant.

---

## 2. Why these two roles, and the rules they follow

### 2.1 The gap today

- **Billing** sits with partners and managers (`billing.manage`), and
  `ctx_can_bill` lets them see only clients of their own office; only the
  Managing Partner sees the whole firm. An accounts person would have to be
  made a Manager or Partner to work — which also opens every engagement they
  are put on, its working papers and the clients' portal logins.
- **HR** sits with the platform Administrator (`employee.manage`, ADR-0009).
  The Administrator also creates users and assigns *any* role, including
  Managing Partner. People-operations and platform-administration are
  different jobs and should not share one key.

### 2.2 Principles (agreed by both seats)

1. **Need to know.** A CA firm's first duty is confidentiality: disclosing
   information acquired in the course of a professional engagement is
   professional misconduct under the Chartered Accountants Act (Second
   Schedule, Part I, clause 1). Neither role needs working papers or client
   documents to do its job, so neither gets them — in the database, not only
   in the menu.
2. **Maker–checker.** The person who records money is not the person who
   forgives it. The Accountant *makes* (drafts, issues, records, asks); a
   Partner *checks* (approves credit notes, write-offs, waivers, voids,
   reversals). This is already how `billing.manage` / `billing.approve` split;
   the Accountant gets the first only.
3. **No self-promotion.** HR can give logins to joiners but cannot grant a role
   above Manager, cannot change Partner, Managing Partner, Administrator,
   Accountant or HR access, and cannot change its own roles.
4. **Least privilege by default.** The new roles get *no* access through the
   67 row-level-security policies keyed on a role name; each permission they
   need is added deliberately (section 7).
5. **Everything is audited.** Every create, change, issue, receipt, reset and
   deactivation by these roles lands in the audit log with who, when and what.

---

## 3. Accountant

### 3.1 Who this is

The firm's accounts executive or office accountant. Usually not a CA (often a
B.Com / CA-Inter / CMA-Inter); reports to the Managing Partner or the partner
in charge of administration. In a smaller firm the same person may also keep
the firm's books in Tally — the portal is where fees, invoices and receipts
start; the books are kept elsewhere (section 3.7 covers the export).

### 3.2 What they do — the working calendar

| When | Task | Where in the portal |
| --- | --- | --- |
| Daily | Record receipts from the bank statement (NEFT/RTGS/UPI/cheque), with TDS deducted and the section (usually 194J), and allocate them to invoices. | Billing → Receipts → **Record receipt** |
| Daily | Issue invoices that partners have drafted or that fall due from agreed fees. | Accounts desk → **Ready to issue** |
| Daily | Send payment reminders for overdue invoices (e-mail, WhatsApp link, text). | Billing → Receivables → **Remind** |
| Weekly | Review receivables by age (0–30, 31–60, 61–90, 90+) and by engagement partner; send each partner their list. | Billing → Receivables |
| Monthly, first week | Bill retainers and milestone fees that fell due last month. | Billing → Unbilled → **Put on a draft** |
| Monthly | Hand the firm's outward-supply data (B2B/B2C, SAC 9982, CGST/SGST/IGST) to whoever files the firm's own GST returns; tally portal totals with the books. | Reports → **GST outward register** (new, phase 2) |
| Quarterly | Import TDS credits (Form 26AS / AIS) and match them to receipts; chase clients whose TDS is not showing. | Billing → TDS → **Import**, **Match**, **Remind** |
| Year end | Confirm the invoice series closes cleanly; export the year's invoices, receipts and credit notes for the books and the tax audit. | Billing → **Export** (new, phase 2) |

What they **do not** do: agree fees with clients, decide to waive or write off
fees, or change who the firm is on its invoices (GSTIN, prefix, terms) — those
are partner decisions (section 3.5).

### 3.3 Permissions

| Permission | Accountant | Why |
| --- | :---: | --- |
| `billing.manage` | ✅ | Draft, issue, remind, record receipts, import TDS. |
| `billing.approve` | ❌ | Credit notes, write-offs, waivers, voids, reversals, billing settings stay with partners. |
| `report.read` | ✅ (finance reports only — see 7.4) | Receivables, collections, billing MIS. |
| `entity.read` | ❌ → **`entity.read_billing`** (new) | Billing profile of every client only, not the full client master. |
| `engagement.read` | ❌ → **`engagement.read_commercial`** (new) | Engagement header, partner, fee schedule, billable hours — not tasks, documents or reviews. |
| `credential.reveal` / `credential.manage` | ❌ | Client portal logins are for the engagement team. |
| `notice.manage` | ❌ | Notices are professional work. |
| `employee.read` | ❌ | Not needed; partner names on invoices come with the engagement header. |
| `notification.read` | ✅ | Their own notifications (payment received, approval decided). |
| `user.*`, `office.manage`, `workflow.manage`, `service.manage` | ❌ | Not their job. |
| `fee.agree` (new, split out of `billing.manage`) | ❌ | Agreeing a fee on a milestone is a commercial decision for the engagement partner. |

### 3.4 What they see — screen by screen

**Sidebar**

```
┌─────────────────────────────┐
│  D  Dhvaj Portal            │
│                             │
│  ◉ Accounts desk            │  ← landing page
│  🔔 Notifications            │
│                             │
│  BILLING                    │
│  ▸ Invoices                 │
│  ▸ Receipts                 │
│  ▸ Receivables              │
│  ▸ Unbilled                 │
│  ▸ TDS credits              │
│  ▸ Approvals sent           │  ← credit notes / write-offs / waivers awaiting a partner
│                             │
│  CLIENTS                    │
│  ▸ Client statements        │  ← billing profile + ledger per client
│                             │
│  REPORTS                    │
│  ▸ Finance reports          │
└─────────────────────────────┘
  Header: "Asha Verma · Accountant · Firm-wide"   🔑  ⎋
```

No *Today, My Work, Engagements, Clients (full master), Compliance, Filing
runs, Notices, Documents, Services, Resource Management, Administration*.

**Accounts desk (home)**

```
┌──────────────────────────────────────────────────────────────────────┐
│ Accounts desk                                       FY 2026-27 ▾      │
├───────────────┬───────────────┬───────────────┬──────────────────────┤
│ Billed (Oct)  │ Collected     │ Outstanding   │ Over 90 days          │
│ ₹ 18.4 L      │ ₹ 12.1 L      │ ₹ 41.7 L      │ ₹ 6.2 L  (14 inv.)    │
├───────────────┴───────────────┴───────────────┴──────────────────────┤
│ Work queues                                                           │
│  • Ready to issue ................................ 7   [Open]        │
│  • Unbilled fees due ............................ 23   [Open]        │
│  • Receipts not fully allocated .................. 3   [Open]        │
│  • TDS not in 26AS ............................... 9   [Open]        │
│  • Reminders due today .......................... 11   [Open]        │
│  • Waiting for partner approval .................. 4   [Open]        │
├───────────────────────────────────────────────────────────────────────┤
│ Receivables by partner                 │ Collections, last 6 months   │
│  Partner A   ₹ 18.2 L   ███████        │  ▁▃▅▄▆▇                       │
│  Partner B   ₹ 14.9 L   █████          │                               │
│  MP          ₹  8.6 L   ███            │                               │
└───────────────────────────────────────────────────────────────────────┘
```

Every number opens the filtered list underneath it. Queues show counts only
when non-zero, so an empty day looks empty.

**Client statement (billing profile)** shows: legal name, PAN, GSTIN, state
(place of supply), billing address, billing contact (name, e-mail, phone),
credit terms; then invoices, receipts, credit notes, write-offs, TDS and the
running balance. It does **not** show the client's other contacts, KYC
documents, registrations unrelated to billing, engagement list beyond names
and partners, or portal logins.

**Engagement (commercial view)** — reached from an invoice or unbilled line,
not from a menu: engagement name, service, financial year, engagement partner
and manager, status, the fee schedule (milestones and their status), billable
hours by person and rate. **No** tasks, checklist, documents, review notes,
audit file, time-entry notes or activity feed.

### 3.5 Maker–checker

| Action | Accountant | Partner |
| --- | --- | --- |
| Agree a fee / add a milestone | — | Agrees it (`fee.agree`) |
| Draft invoice from an agreed fee or billable time | Drafts | — |
| Draft an *ad-hoc* invoice (no agreed fee behind it) | Drafts | **Approves before issue** (decision 9.3) |
| Issue an invoice | Issues | — |
| Record / allocate a receipt | Records | — |
| Reverse a receipt | Asks | **Approves** |
| Credit note | Asks | **Approves** (numbers it) |
| Write-off | Asks | **Approves** |
| Set an unbilled fee aside (waiver) | Asks | **Approves** |
| Void an invoice | Asks | **Approves** |
| Billing settings (GSTIN, prefix, terms) | Sees | **Changes** |
| Import / match TDS credits | Does | — |
| Payment reminders | Sends | — |

The Accountant can never approve their own request, even if they also hold a
partner role (the API already refuses a decision by the requester; this keeps
that rule).

### 3.6 Mobile app

Same scope, trimmed to what happens away from the desk: Accounts desk numbers,
**Record receipt** (photo of the cheque or UPI screenshot attached), invoice
look-up and status, **Remind** from the phone, and push notifications for
approvals decided and payments recorded.

### 3.7 Phase-2 additions for the Accountant

- **GST outward register** — the firm's own invoices and credit notes for a
  month in the GSTR-1 layout (B2B by GSTIN, B2C summary, credit/debit notes,
  SAC summary) as Excel/JSON, with a tie-out to the portal totals.
- **Books export** — invoices, receipts and credit notes as Tally-importable
  vouchers (or a plain journal CSV), per month, with a "last exported" marker
  so nothing goes twice.
- **Bank statement match** — upload the bank CSV; the portal proposes which
  invoices each credit pays.

---

## 4. HR

### 4.1 Who this is

The firm's HR / office administrator. In most CA firms this person handles
joining formalities, articleship paperwork with ICAI, attendance and leave,
and is the first stop for staff questions. Not a CA as a rule; reports to the
Managing Partner.

### 4.2 What they do — the working calendar

| When | Task | Where in the portal |
| --- | --- | --- |
| On joining | Create the employee (code, grade, office, reporting partner/manager, joining date); create their portal login and hand over the temporary password. | People desk → **New joiner** (one form creates both) |
| On joining (articles) | Record the articleship: principal (partner and membership no.), ICAI registration number and date, scheme (period), expected completion date. | People → *employee* → **Articleship** (new) |
| Daily | See who has signed in and their hours so far; follow up missing time. | People desk → **Today's attendance** (new) |
| Weekly | Check workload: who is overloaded or idle; tell the partners. | People → **Workload** (Resource Management, names only) |
| Monthly | Hours per person for the month (for payroll and stipend); export. | Reports → **Monthly hours** |
| On a status change | Mark on leave, notice period, or exited; update the reporting line. | People → *employee* → **Edit** |
| On exit | Set the exit date; the login is switched off on that date and its password removed; ask the partner to reassign open engagements and tasks. | People → *employee* → **Start exit** |
| Ongoing | Reset forgotten passwords and unlock locked accounts for staff up to Manager. | People → *employee* → **Portal login** |
| Ongoing (articles) | Track remaining training period and leave against the ICAI limit; flag completions due in 90 days. | People desk → **Articles** card |

What they **do not** do: decide who works on which client, see what anyone
worked on, see the firm's fees or invoices, or give anyone a partner,
administrator, accountant or HR role.

### 4.3 Permissions

| Permission | HR | Why |
| --- | :---: | --- |
| `employee.read`, `employee.manage` | ✅ | The employee master is theirs. |
| `user.read` | ✅ | Login status of each employee. |
| `user.manage` | ❌ → **`user.onboard`** (new) | Create logins, issue/reset passwords, deactivate — but only for roles up to Manager, never their own. |
| `office.read` | ✅ | Offices for the employee form. |
| `report.read` | ❌ → **`report.read_people`** (new) | Workload and hours reports only, not engagement or finance MIS. |
| **`time.read_attendance`** (new) | ✅ | Per person, per day: first start, last stop, total hours, split by kind (client work / review / internal / training / admin). **No engagement or client names, no notes.** |
| `engagement.*`, `entity.*`, `compliance.*`, `notice.*`, `credential.*` | ❌ | Client work. |
| `billing.*` | ❌ | Money. |
| `audit.read` | ❌ | The firm-wide audit trail stays with MP and Administrator; HR sees the history of each employee record on that record. |

### 4.4 What they see — screen by screen

**Sidebar**

```
┌─────────────────────────────┐
│  D  Dhvaj Portal            │
│                             │
│  ◉ People desk              │  ← landing page
│  🔔 Notifications            │
│                             │
│  PEOPLE                     │
│  ▸ Employees                │
│  ▸ Articles                 │
│  ▸ Joiners & leavers        │
│  ▸ Attendance               │
│  ▸ Workload                 │
│                             │
│  REPORTS                    │
│  ▸ People reports           │
└─────────────────────────────┘
  Header: "Neha Sharma · HR · Firm-wide"   🔑  ⎋
```

**People desk (home)**

```
┌──────────────────────────────────────────────────────────────────────┐
│ People desk                                                           │
├──────────────┬──────────────┬──────────────┬─────────────────────────┤
│ Headcount    │ Articles     │ Joined (Oct) │ Leaving (notice period) │
│ 38           │ 14           │ 2            │ 1                        │
├──────────────┴──────────────┴──────────────┴─────────────────────────┤
│ Needs action                                                          │
│  • No portal login yet ........................... 2   [Create]      │
│  • Locked out (5 wrong passwords) ................ 1   [Reset]       │
│  • Still on temporary password > 3 days .......... 3   [Remind]      │
│  • Articleship completing in 90 days ............. 2   [Open]        │
│  • Exit date passed, login still on .............. 0                  │
│  • No hours logged yesterday ..................... 4   [Open]        │
├───────────────────────────────────────────────────────────────────────┤
│ Headcount by office and grade       │ Workload this week               │
│  NORTH  P2 M3 S6 A8                 │  Over 45 h  ██ 3                 │
│  SOUTH  P1 M2 S4 A6                 │  Under 20 h █  2                 │
└───────────────────────────────────────────────────────────────────────┘
```

**Employee page** — profile (code, name, grade, office, reporting to,
employment status, joining and exit dates), partner details for partners
(membership number, partner since), **Articleship** tab for articles,
**Portal login** box (email, sign-in method, locked/temporary state, Reset
password, Turn off password sign-in, Deactivate — the same controls built in
Users & Roles), **Hours** tab (daily totals by kind, no client names), and the
record's change history.

**Workload** — the Resource Management view with every engagement shown as a
count (*"4 active engagements, 11 open tasks, 3 overdue"*) and never a client
or engagement name.

### 4.5 The role ceiling on logins

| HR may assign | HR may not assign |
| --- | --- |
| Article, Senior, Manager | Partner, Managing Partner, Administrator, Accountant, HR |

HR may not edit, reset, deactivate or change the email of any user who holds a
role outside the left column — those stay with the Administrator / Managing
Partner. HR may not change their own roles. A joiner who will be a Partner or
the Accountant is created by HR as an employee and given the login by the
Administrator.

### 4.6 Mobile app

People desk numbers, look up an employee (phone, reporting line, status), and
**Reset password / Unlock** for staff up to Manager — the common "I'm locked
out" call answered from the phone.

### 4.7 Phase-2 and phase-3 additions for HR

- **Articleship register** (phase 2): principal, registration number and date,
  scheme and period, leave taken against the entitlement the firm enters (the
  ICAI limits are kept as settings, not hard-coded, because they differ by
  scheme), transfers and completion.
- **HR documents** (phase 2): offer and appointment letters, articleship deed,
  NDA/confidentiality undertaking, ID proofs — in a separate vault folder only
  HR and the Managing Partner can open.
- **Leave and holidays** (phase 3): leave requests approved by the reporting
  manager, office holiday calendar, exam leave for articles; leave days block
  the auto-time "no hours logged" flag.
- **Training / CPE log** (phase 3): internal training hours (already a time
  category) and members' CPE hours.

---

## 5. Changes to existing roles

| Role | Change | Reason |
| --- | --- | --- |
| Administrator | Keeps `employee.manage` until an HR user exists, then loses it (decision 9.5). Keeps `user.manage` (all roles). | Platform administration only, as ADR-0009 intended. |
| Partner, Managing Partner | Gain `fee.agree` (split from `billing.manage`); keep `billing.manage` and `billing.approve`. | Fees are agreed by partners; billing stays possible for small offices without an Accountant. |
| Manager | Keeps `billing.manage`; does **not** get `fee.agree` unless the firm decides otherwise (decision 9.4). | A manager drafts; a partner agrees fees. |
| Senior, Article | No change. | |

The Billing & Collections menu entry changes from "needs `report.read`" to
"needs `billing.manage` or `report.read`".

---

## 6. People holding more than one role

A person can hold e.g. **Senior + Accountant** (a CA-Inter who does audits and
the firm's billing) or **Manager + HR**. They must get the union: their
professional work through the Senior/Manager role *and* the desk through the
new role, without one cancelling the other. Today that is not possible —
see 7.2. After the change:

- The sidebar shows both: their client work, then the **Billing** or **People**
  section. Landing goes to their professional home (Today / Home); the desk is
  one click away.
- Maker–checker still holds: a Partner + Accountant can never approve a credit
  note they asked for.

---

## 7. Engineering design

### 7.1 Role catalogue

- Migration `…_accountant_hr_roles.sql`: insert `roles` rows `accountant` and
  `hr`; insert the new permissions (`entity.read_billing`,
  `engagement.read_commercial`, `fee.agree`, `user.onboard`,
  `report.read_people`, `time.read_attendance`); grant per sections 3.3 and
  4.3; grant `fee.agree` to Partner and Managing Partner. Down migration
  removes them (refusing if any user still holds the roles).
- `packages/contracts/src/identity.ts`: `ROLE.accountant`, `ROLE.hr`, add to
  `ASSIGNABLE_ROLES`, and to `ROLE_PRECEDENCE` **below Article**. They never
  outrank a professional role, so a Manager + HR still acts as a Manager on
  client work.
- `PERMISSION.*` constants for the new slugs; web/mobile role labels
  ("Accountant", "HR").

### 7.2 The one-effective-role problem (the main engineering change)

The request context carries **one** role (`hsdg.role`, the highest held), and
67 of the 711 RLS policies plus 8 helper functions decide on it. A Senior +
Accountant would run as *Senior* and never reach the invoices.

**Fix:** carry every held role as well.

1. `RLS_SETTINGS.roles = 'hsdg.roles'` — a comma-separated list set with
   `SET LOCAL` next to `hsdg.role` in `withRlsContext`.
2. `hsdg.ctx_has_role(text) RETURNS boolean` —
   `$1 = ANY (string_to_array(current_setting('hsdg.roles', true), ','))`.
3. Two named predicates so policies read as intent:
   `hsdg.ctx_is_finance()` = `ctx_has_role('accountant')`,
   `hsdg.ctx_is_people_ops()` = `ctx_has_role('hr')`.
4. **Nothing else changes for the existing 67 policies.** They keep using
   `ctx_role()`; the new roles are absent from them, so they get no access
   there by default (principle 4).

### 7.3 Database access, table by table

| Data | Accountant | HR | How |
| --- | --- | --- | --- |
| `invoices`, line items, `receipts`, `receipt_allocations`, `credit_notes`, `write_offs`, `fee_waivers`, `firm_tds_credits`, `firm_tds_import_batches`, `invoice_reminders`, `tds_reminders` | read + write (as `billing.manage` allows) | none | Repoint `ctx_can_bill(entity)` to `… OR hsdg.ctx_is_finance()`. One function; every billing policy already calls it. |
| `entities` (client master) | none directly | none | — |
| Client billing profile | read | none | New view `entity_billing_profiles` (name, PAN, GSTIN, state, billing address, billing contact, credit terms) owned by the migrator, `security_barrier`, filtered by `ctx_can_bill(id)`. |
| `engagements` | none directly | none | — |
| Engagement commercial header | read | none | New view `engagement_commercial` (name, service, FY, EP, EM, status, fee schedule) filtered by `ctx_can_bill(client_entity_id)`. |
| Engagement children (tasks, documents, reviews, audit file, notes, activity) | none | none | Unchanged: assignment-based RLS. |
| `engagement_time_entries` | billable seconds and rate only | none directly | Accountant: through the existing billing time endpoints (`time_billings`, the time-to-invoice draft) which return hours and rate, not `note`. |
| Attendance | none | read | `SECURITY DEFINER` function `hsdg.attendance_by_day(from, to)` returning employee, day, first start, last stop, seconds by `entry_kind`/`category`; refuses unless `ctx_is_people_ops()` or MP. No engagement id, no note. |
| `employees`, `partner_profiles`, `grades` | none (names arrive with engagement headers) | read + write | Add `OR hsdg.ctx_is_people_ops()` to the employee policies (today `ctx_is_firmwide()`). |
| `users`, `user_roles`, `user_passwords` | none | users read; write within the ceiling | API-level ceiling (7.5); `user_passwords` stays system-context only. |
| `client_credentials` | none | none | Unchanged (ADR-0035). |
| `audit_log` | none | none (record history via the employee endpoint) | Unchanged. |

### 7.4 API changes

- Billing reads (`requireBillingReader`) already accept `billing.manage`; no
  change. Writes are unchanged except: `POST /engagements/:id/fee-milestones`
  and `POST /fee-milestones/:id/cancel` move from `billing.manage` to
  `fee.agree`; `POST /unbilled/set-aside` becomes a *request* when the caller
  lacks `billing.approve` (it already files a fee waiver).
- Ad-hoc invoice approval (if decision 9.3 is yes): `POST /invoices/:id/issue`
  refuses an invoice with no fee milestone, retainer period or billable time
  behind it unless the caller holds `billing.approve`; a new
  `POST /invoices/:id/request-issue` notifies the engagement partner.
- New `GET /billing/clients/:id/profile` and `GET /billing/engagements/:id`
  (the two views), `billing.manage` or `report.read`.
- New `GET /people/attendance?from&to` (`time.read_attendance`) and
  `GET /people/workload` (Resource Management with names stripped),
  `report.read_people`.
- `POST /users`, `PATCH /users/:id`, `PUT /users/:id/roles`,
  `POST|DELETE /users/:id/password` accept `user.manage` **or**
  `user.onboard` with the ceiling (7.5).
- `report.read` today opens the engagement, compliance, notices and
  utilisation MIS. Finance reports (receivables, collections, billing MIS)
  accept `billing.manage` too; people reports accept `report.read_people`.
  The Accountant does **not** get plain `report.read`.

### 7.5 The onboarding ceiling (`user.onboard`)

Enforced in `IdentityService`, inside the same transaction as the write:

```
ONBOARD_ASSIGNABLE = ['article', 'senior', 'manager']

allow(actor, target, newRoles):
  if actor has user.manage            → allowed (Administrator / MP)
  if not actor has user.onboard       → 403
  if target.id == actor.userId        → 403 "You cannot change your own access."
  if target.roles ⊄ ONBOARD_ASSIGNABLE → 403 "Ask an administrator."
  if newRoles ⊄ ONBOARD_ASSIGNABLE    → 403 "HR can give Article, Senior or Manager."
```

The same check guards password set/reset/remove and deactivation. Audit
entries carry `via: 'user.onboard'`.

### 7.6 Web portal

- `lib/nav.ts`: a **Billing** section (Invoices, Receipts, Receivables,
  Unbilled, TDS credits, Approvals sent, Client statements) gated by
  `billing.manage`; a **People** section gated by `employee.manage`. Existing
  items are already permission-gated, so the new roles lose them without
  extra rules.
- `landingPath`: `/accounts` when the only roles held are `accountant`;
  `/people` when only `hr`; otherwise unchanged.
- New pages `/accounts` (Accounts desk) and `/people` (People desk) built from
  the existing billing and admin components; the Users & Roles role list
  shows only `ONBOARD_ASSIGNABLE` for an HR user.
- Header chip shows the role label ("Accountant", "HR").

### 7.7 Mobile app

`src/lib/nav.ts` gains the same two sections; Profile shows the role; the
Accounts desk and People desk become home screens for those roles. The
Expo client regenerates from the updated OpenAPI.

### 7.8 Tests

- **RLS e2e (the important ones):** as an Accountant — reads every client's
  invoices; gets 0 rows from `engagement_tasks`, `documents`,
  `client_credentials`, `audit_log`, `engagement_time_entries`; cannot see a
  time note through any billing endpoint. As HR — 0 invoices, 0 entities,
  0 engagements; attendance returns no engagement id.
- **Combined roles:** Senior + Accountant sees their own engagements *and*
  every invoice; Manager + HR keeps manager access to client work.
- **Ceiling:** HR creating a Partner → 403; HR resetting a Partner's password
  → 403; HR editing their own roles → 403; HR creating a Senior → 201.
- **Maker–checker:** Accountant approving a credit note → 403; Partner +
  Accountant approving their own request → refused.
- Web: nav per role (snapshot of visible items), landing per role, desks
  render their queues. Mobile: same nav assertions.

### 7.9 Rollout

| Phase | Scope | Size |
| --- | --- | --- |
| 1 | Roles, permissions, `hsdg.roles` + `ctx_has_role`, `ctx_can_bill` / employee policy changes, the two views, `fee.agree` split, `user.onboard` ceiling, nav + landing, Accounts desk and People desk on existing data, attendance function, tests. | Large (one migration, ~15 API endpoints touched, 2 new pages) |
| 2 | GST outward register, books export, bank match; articleship register, HR documents vault. | Medium each |
| 3 | Leave and holidays, CPE/training log. | Medium |

Phase 1 needs no new data from users and can ship behind a rollout flag
(`ff_finance_hr_roles`) so the two roles appear in Users & Roles only when the
firm turns it on.

---

## 8. What each role must never see — the checklist the tests prove

| | Accountant | HR |
| --- | :---: | :---: |
| Working papers, audit files, documents | never | never |
| Tasks, review notes, activity feed | never | never |
| Client portal logins (GST, Income-tax, MCA…) | never | never |
| Notices and replies | never | never |
| Time-entry notes | never | never |
| Client names or engagement names | billing view only | never |
| Fees, invoices, receipts | yes | never |
| Employee personal record | name only (on invoices) | yes |
| Other users' passwords | never | never (only issues temporary ones) |
| Firm-wide audit log | never | never |

---

## 9. Decisions needed from the partners

1. **Scope.** Firm-wide (recommended: one accounts and one HR function) or
   office-scoped variants (`accountant` sees only clients whose home office is
   theirs)?
2. **Names.** "Accountant" and "HR" as labels — or "Accounts" and "People &
   HR"?
3. **Ad-hoc invoices.** Should an invoice with no agreed fee or time behind it
   need a partner's approval before the Accountant issues it?
   *Recommended: yes.*
4. **Managers and fees.** May a Manager agree fees (`fee.agree`), or Partners
   only? *Recommended: Partners only.*
5. **Administrator and HR.** Once an HR user exists, remove `employee.manage`
   from the Administrator? *Recommended: yes, keep `user.manage`.*
6. **Attendance visibility.** Should a person see their own attendance page
   (same data HR sees)? *Recommended: yes — no surprises.*
7. **Reporting managers.** Should a Manager see attendance for people who
   report to them? *Recommended: phase 3, with leave.*
8. **Accountant and engagement partners.** Should the Accountant see the
   receivables list split by engagement partner (they need it to chase), and
   may partners see each other's receivables? *Today a partner sees their own
   office; recommended: no change.*

---

## 10. Acceptance — "done" means

- [ ] An Administrator can assign Accountant and HR in Users & Roles.
- [ ] An Accountant signs in (password or Microsoft), lands on the Accounts
      desk, sees every client's invoices and receipts, can issue and record,
      and gets a 403 or an empty list everywhere in section 8.
- [ ] An HR user lands on the People desk, creates a joiner with a login and
      temporary password, cannot give any role above Manager, and sees no
      client, engagement or invoice anywhere.
- [ ] A Senior + Accountant and a Manager + HR keep their professional access
      and gain the desk.
- [ ] Every action in sections 3.5 and 4.5 is in the audit log.
- [ ] Section 7.8 tests pass in CI; the mobile app shows the same menus.
