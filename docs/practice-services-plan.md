Contents

1. [Summary](#summary)
2. [Who this is for](#people)
3. [What the code shows](#findings)
4. [Design rules](#principles)
5. [Shared design](#shared)
6. [Phase 0 · Finish the mobile workflow](#phase0)
7. [Phase 1 · Notices and proceedings](#phase1)
8. [Phase 2 · Fees to cash](#phase2)
9. [Phase 3 · Partner control](#phase3)
10. [Phase 4 · Specialist desks](#phase4)
11. [Phase 5 · Client portal](#phase5)
12. [Phase 6 · Mobile for the new services](#phase6)
13. [Data model at a glance](#data)
14. [API changes at a glance](#apis)
15. [Testing and rollout](#testing)
16. [How we measure it](#metrics)
17. [Risks and open questions](#risks)
18. [Team split and order](#order)

Engineering plan · Dhvaj Portal

# Practice Services Plan

The Staff Workflow Plan made the portal bring each person to their next piece of work. This plan adds the services a CA firm still runs outside the portal: notices and proceedings, fees and collections, partner control over risk and profitability, the UDIN and DSC registers, the specialist desks (tax audit, certificates, individual returns, KYC, payroll) and a portal for clients. There are 31 tickets in seven phases. Each ticket lists the files to change, the API contract, when it is done, and its tests.

**Repos** intenzee/hsdg (`apps/web`, `apps/api`, `packages/contracts`, `db/migrations`) and the Dhvaj mobile app (`dhvaj app`, Expo SDK 57). **Based on** portal main at 2c4ab48 and mobile main at 5a2f700, 16 Oct 2026. **Sizes** are for one engineer: S ≤ 1 day, M 2–4 days, L 1–2 weeks.

## Summary

The portal already runs the firm's recurring compliance (GST, TDS, income tax, ROC, bookkeeping, MIS) and statutory audits end to end. Around that core, the work that carries the most risk and the most money is still tracked in spreadsheets, inboxes and memory:

- **Notices.** A GST or income-tax notice whose reply date is missed can end in an order passed without hearing the client. The catalogue has assessment and appeal services, but there is nowhere to record a notice, and the appeal-limitation rules are never triggered.
- **Fees.** An invoice goes draft → issued → paid. There are no part payments, no record of the TDS clients deduct from our fees, no ageing and no reminders. Invoices carry no GST details.
- **Partner view.** Time and fees are both stored, but nothing compares them, so realisation and profitability are unknown. The registers peer review asks for (UDIN, DSC custody) don't exist.
- **Clients** receive one-off upload links and nothing else.

**Goal:** every deadline that can hurt the firm sits in the portal with an owner and a date. Every rupee billed is followed to the bank. A partner can see risk and profitability on one screen.

| Phase | What changes | Tickets | Rough size |
| --- | --- | --- | --- |
| Phase 0 | The mobile app finishes the Staff Workflow plan: WhatsApp reminders from the phone, tested on simulators. | PS-001 to PS-002 | \~3 days |
| Phase 1 | A notices register for GST, income tax, TDS and ROC: intake from the PDF, owner, reply and hearing dates, and the order sets the appeal deadline. | PS-101 to PS-105 | \~3.5 weeks |
| Phase 2 | GST-correct invoices, receipts and part payments, TDS on our fees, ageing, reminders, credit notes and write-offs. | PS-201 to PS-206 | \~4 weeks |
| Phase 3 | The partner risk dashboard, cost rates, realisation and profitability, unbilled work, and the UDIN and DSC registers. | PS-301 to PS-305 | \~3.5 weeks |
| Phase 4 | Tax audit (3CD), the certificates desk, individual returns at volume, client KYC, and payroll and labour as a seventh stream. | PS-401 to PS-405 | \~6 weeks |
| Phase 5 | A client portal: clients sign in, see what they owe us (documents and fees), upload, download acknowledgements, and pay. | PS-501 to PS-505 | \~5 weeks |
| Phase 6 | Mobile parity for notices, receipts, approvals and DSC custody. | PS-601 to PS-603 | \~1.5 weeks |

**Order:** Phases 1 and 2 protect the firm and bring in cash, so ship them first. Phase 3's dashboard reads from both. Phase 5 is the largest and needs partner decisions first (see [open questions](#risks)). As with the Staff Workflow Plan, **finish each phase in the web portal (API and web) before the mobile app.**

## Who this is for

#### Managing partner and partners

They own the firm's exposure: notices, missed dates, fees outstanding, write-offs, peer review. They need one screen of "what can hurt us" and the numbers on which clients and services make money.

#### Manager (notices and billing)

Handles a notice from receipt to order: assigns it, drafts the reply, attends the hearing, files the appeal. Raises invoices, records receipts, chases payment.

#### Senior and article

Prepare replies, certificates, 3CD clauses and individual returns. They take DSCs out of and back into custody.

#### Accounts and admin

Records receipts and bank credits, reconciles TDS on fees against the firm's 26AS, keeps the DSC cupboard.

#### Client (Phase 5)

A director, accountant or individual taxpayer. They want to know what the firm needs from them, upload it once, and download what was filed.

Role slugs in the database: `article`, `senior`, `manager`, `partner`, `managing_partner`, `admin`. Phase 5 adds an external principal, not a new staff role (see PS-501).

## What the code shows

Each finding points to the code or table that causes it, on portal main at 2c4ab48.

| # | Finding | Where |
| --- | --- | --- |
| F1 | Assessment and appeal work exists only as catalogue services and workflow components. No table stores a notice, its reference (DIN), its reply date, hearings or the order. | Services `GST_ASSESSMENT`, `TAX_ASSESSMENT`, `GST_APPEAL`, `TAX_APPEAL`; components in `db/migrations/1758800000000_catalogue_expansion.sql:158–172` |
| F2 | The appeal-limitation rules are event-driven (`calculation_basis = 'event_date'`), but their `event_type` is empty, so nothing ever creates them. `GST_APPEAL_LIMITATION` counts 90 days, while CGST Act s.107 says three months from communication. | `hsdg.compliance_rule_versions` for `IT_APPEAL_LIMITATION`, `GST_APPEAL_LIMITATION`, `GST_AMENDMENT_LIMITATION`; seeded in `1760300000000_statutory_rules_completion.sql:44–45` |
| F3 | The event mechanism already works for ROC and should be reused: `compliance_events(event_type, event_date, details, source_instance_id)` creates event-driven filings. | `hsdg.compliance_events`; `apps/api/src/modules/compliance/` |
| F4 | Invoices hold `subtotal`, `tax_amount` and `total` only. They have no firm or client GSTIN, no SAC code, no place of supply and no CGST/SGST/IGST split. The status runs `draft → issued → paid → void`, with no part payment and no receipts table. | `hsdg.invoices`, `hsdg.invoice_line_items`; `packages/contracts/src/commercial.ts` (`INVOICE_STATUS`) |
| F5 | Invoice actions ride on `engagement.manage`, and the firm-wide invoice list needs `report.read`. There is no billing permission, so anyone who can manage an engagement can issue or void its invoices. | `apps/api/src/modules/commercial/commercial.controller.ts`, `invoices-list.controller.ts` |
| F6 | Time entries already carry `is_billable`, `category`, an approval state and `duration_seconds`. Employees and grades have no cost rate or charge-out rate, so realisation and profitability cannot be computed. | `hsdg.engagement_time_entries`, `hsdg.employees`, `hsdg.grades` |
| F7 | A utilisation report and a resource workload view already exist and are scoped by row-level security. Extend them; don't rebuild. | `apps/api/src/modules/reports/reports.service.ts:176` (`utilisation`), `:187` (`resourceWorkload`) |
| F8 | UDIN exists only as a column on the audit archive record (format check `^[0-9]{8}[A-Z0-9]{10}$`). Certificates, tax audit and GST audit reports have nowhere to record theirs. | `db/migrations/1765650000000_archive_record.sql:18` |
| F9 | DSC expiry lives only inside the ROC directors JSON (`dscExpiresOn`). There is no custody record of which tokens the office holds, who took one out, or when it comes back. | `apps/api/src/modules/compliance/compliance-profile.ts:24` |
| F10 | `entity_contacts` already has `is_portal_user` and `portal_role`, unused since they were added. One-off client upload links exist, with a token hash, an expiry and a use count. | `db/migrations/1761300000000_registration_contact_master_extend.sql:52`; `hsdg.client_upload_links` |
| F11 | Documents already store `ocr_status`, `extracted_text` and `extracted_fields`, with full-text search. Notice intake can reuse this for the PDF. | `hsdg.documents` |
| F12 | PF, ESI, PT and labour-return rules exist with no stream, so they appear on no tab. `STREAM` has six members. | Rules `PF_MONTHLY`, `ESI_MONTHLY`, `PT_MONTHLY`, `LABOUR_RETURNS_QTR`; `packages/contracts/src/engagement-restructure.ts` (`STREAM`) |
| F13 | Tax audit is a due date only (`TAX_AUDIT_44AB`, `IT_TAX_AUDIT`). It has no clause workspace, while CARO has a full clause programme to copy. | `packages/contracts/src/statutory-audit-caro*.ts`, `audit_caro_*` tables |
| F14 | Encrypted client logins (ADR-0035) already have a reveal function, an access log and a rate limit. Reuse them for DSC token PINs and income-tax e-filing logins rather than storing secrets again. | `hsdg.client_credentials`, `hsdg.reveal_client_credential` |
| F15 | Good foundations: `WorkItemRef`/`workItemHref` for links, actionable notifications with auto-resolve triggers, the client-chase reminder channels (e-mail, WhatsApp, copy), per-office rollout (Admin → Rollout), filing runs for bulk work, and the rule-verification flow (`compliance_rule_verifications`). | `packages/contracts/src/work-links.ts`, `1772300000000_actionable_notifications.sql`, `client-chase.ts`, `feature-rollout.ts` |

## Design rules

The Staff Workflow rules still apply: every row goes to the work itself, act where you are, one list in one place, order by internal due date, links are state, and no new permissions model beyond what is listed here. This plan adds five more.

1. **Law lives in data, verified by a CA.** Every statutory period (reply windows, appeal limits, UDIN windows, e-verification days) is a rule version or a library row, never a constant in code. Each one goes through the existing verification flow (`compliance_rule_verifications`) before it is switched on. The numbers in this document are starting points for the stream leads to confirm.
2. **Money is exact.** Amounts are `numeric(14,2)` in the database and decimal strings on the wire (as `InvoiceLineItem` does today). No floats, and no rounding outside one helper in contracts.
3. **Nothing financial is deleted.** Receipts, credit notes, write-offs and UDINs are reversed or voided with a reason, never edited after posting. Every change writes `audit_events`.
4. **Secrets go in the vault.** DSC PINs and portal passwords use ADR-0035 (`client_credentials`), never a new column.
5. **Clients see only what is published to them.** The client portal reads through dedicated definer functions that return client-safe shapes. Clients never receive the staff app's queries with a narrower filter.

## Shared design

### Work links for the new items

Extend `WorkItemRef` (in `packages/contracts/src/work-links.ts`) so notices, invoices and registers open in one click from Today, notifications, search and the risk dashboard.

```
export interface WorkItemRef {
  // …existing fields…
  noticeId?: string | null;     // PS-101
  invoiceId?: string | null;    // PS-201
  udinId?: string | null;       // PS-304
  dscId?: string | null;        // PS-305
}
```

| Item | URL |
| --- | --- |
| Notice | `/notices/:noticeId` (with `&hearing=:id` to scroll to a hearing) |
| Invoice | `/billing/invoices/:invoiceId` |
| Receipt | `/billing/receipts/:receiptId` |
| UDIN | `/registers/udin?u=:udinId` |
| DSC | `/registers/dsc?d=:dscId` |

`workItemHref` checks these before the engagement-tab rules. Add unit tests for each, as WF-101 did.

### New permissions

Add these to `PERMISSION` in `packages/contracts/src/identity.ts` and seed them with a migration. Wrap the seed in `NO FORCE … FORCE ROW LEVEL SECURITY` as the existing permission migrations do.

| Slug | Granted to | Used by |
| --- | --- | --- |
| `notice.manage` | managing_partner, partner, manager, senior | Create and update notices, hearings and replies |
| `billing.manage` | managing_partner, partner, manager, admin | Issue invoices, record receipts, send reminders |
| `billing.approve` | managing_partner, partner | Credit notes, write-offs, voiding an issued invoice |
| `practice.finance` | managing_partner, partner | Cost rates, realisation, profitability |
| `register.manage` | managing_partner, partner, manager, admin | UDIN and DSC registers |

Row-level security stays the source of truth for which rows a person sees: an office partner sees their office, and the managing partner sees the firm. Permissions only gate actions.

### Notifications

Add types to the `notifications_type_check` constraint and to `NOTIFICATION_KIND` (as actionable or informational), with auto-resolve triggers as in `1772300000000_actionable_notifications.sql`:

`notice_received`, `notice_reply_due`, `notice_hearing_due`, `notice_order_received`, `invoice_overdue`, `receipt_recorded`, `write_off_pending`, `udin_window_closing`, `dsc_expiring`, `dsc_overdue_return`, `client_upload_received` (Phase 5).

### Feature flags

Add to `FEATURE_FLAG` (in `packages/contracts/src/engagement-restructure.ts`): `ff_notices`, `ff_billing_v2`, `ff_partner_risk`, `ff_registers`, `ff_tax_audit`, `ff_certificates`, `ff_itr_desk`, `ff_client_kyc`, `ff_payroll_stream`, `ff_client_portal`. Each phase is piloted per office from Admin → Rollout, which is already built.

## Phase 0 · Finish the mobile workflow

\~3 days

PS-001

### WhatsApp the client from the phone

S

Why

Staff chase clients away from their desks. Today the mobile filing screen offers WhatsApp only when the firm's reminder channel is WhatsApp.

Build

- In `src/components/filing-view.tsx` (`ClientChaseCard`), add a secondary "WhatsApp" button whenever `chase.clientPhone` is set, whatever the firm's channel.
- It calls the same `POST /compliance-instances/:id/client-chase/remind`, so the reminder is recorded in the portal, then opens `wa.me` with the text filled in via `Linking.openURL`. If WhatsApp doesn't open, it falls back to the share sheet.
- The API needs a `channel` override on the remind DTO (`'whatsapp' | 'email' | 'copy'`). It is allowed only when the client can be reached on that channel. The API change goes first, then regenerate the mobile client.

Done when

A senior can send a WhatsApp reminder from the filing screen, and the filing's chase history shows it.

Tests

API e2e: the override is honoured, and refused when the client has no phone. Mobile component test: the button appears with a phone and is absent without one; it opens the URL; it falls back to the share sheet.

PS-002

### Native simulator pass

S

Why

The Staff Workflow plan's WF-306 asked for a manual pass on iOS and Android simulators, which hasn't been done.

Build

On a machine with Xcode and Android Studio, run Today, the review queue (approve and return), upload from the camera roll, the client-chase card and the audit-area deep link. Record any fixes as tickets.

Done when

A manager clears a review queue on both simulators, and each screen above has been exercised.

Tests

A written checklist in the PR, with screenshots.

## Phase 1 · Notices and proceedings

\~3.5 weeks

A notice is the firm's sharpest deadline. Phase 1 makes every notice a tracked item with an owner, dates, documents and an outcome, and makes the order set the appeal deadline automatically.

PS-101

### Notice register: data model and API

L

Why

Finding F1. Notices currently live in e-mail and personal trackers.

Build

Write a migration `17723006xxxxx_notices.sql` (FORCE row-level security on every table, policies scoped through the engagement, as `client_dependencies` does).

- `hsdg.notice_types`: library rows maintained by stream leads, not hardcoded. Columns: `id, code, stream ('gst'|'income_tax'|'tds'|'roc'|'other'), form, section, title, default_reply_days int null, appealable bool, appeal_rule_code text null, is_active, version`. Seed these as a starting list for the stream leads to confirm:
  - **GST:** ASMT-10 (scrutiny, s.61), DRC-01A (pre-notice intimation), DRC-01 (show cause, s.73/74; s.74A for FY 2024-25 onwards), GSTR-3A (default), REG-03/REG-17, ADT-01/ADT-02 (department audit), DRC-07 (order), CMP-05.
  - **Income tax:** 139(9) defective return, 143(1)(a) proposed adjustment, 143(2) scrutiny, 142(1), 148A/148 reassessment, 133(6), 245 refund adjustment, 156 demand, 270A/274 penalty.
  - **TDS:** 200A / TRACES default, 201 order, 154 rectification.
  - **ROC:** s.206 inspection or enquiry, s.454 adjudication, STK-1.
- `hsdg.notices`: `id, entity_id, engagement_id (the Compliance or Assignment engagement it is worked under), registration_id null, notice_type_id, reference_no (DIN or notice number), issued_on date, received_on date, served_via ('portal'|'email'|'post'|'in_person'), financial_year, assessment_year null, period_from/period_to null, amount_demanded numeric null, reply_due_on date, owner_employee_id, reviewer_employee_id null, status ('received'|'in_progress'|'reply_filed'|'hearing_scheduled'|'order_received'|'appealed'|'closed'|'withdrawn'), outcome ('dropped'|'demand_confirmed'|'demand_reduced'|'rectified'|null), outcome_amount null, closed_on null, version, audit columns`. Add a unique index on `(entity_id, notice_type_id, reference_no)`.
- `hsdg.notice_events`: one row per thing that happened. Columns: `notice_id, kind ('reply_filed'|'adjournment_sought'|'adjournment_granted'|'hearing'|'submission'|'order'|'rectification'|'note'), occurred_on, next_date null, ack_reference null, document_id null, body, created_by_employee_id`. Hearings are rows of kind `hearing` with `next_date`.
- `notices.reply_due_on` and the next hearing date form the internal clock. Add `internal_due_on`, which defaults to `reply_due_on` minus `firm_settings.notice_buffer_days` (a new column, default 3). Move it back to a working day with `hsdg.previous_working_day` (from WF-305/1772300310000).
- API: a new `NoticesModule` (`apps/api/src/modules/notices/`). Every query runs under `db.withRlsContext`.

```
GET    /notices?status=&stream=&ownerId=&dueBefore=&entityId=&cursor=
GET    /notices/:id                      → Notice with events, documents, linked filings
POST   /notices                          → create (notice.manage)
PATCH  /notices/:id                      → update fields, with version (409 on stale)
POST   /notices/:id/events               → add reply/hearing/adjournment/order/note
POST   /notices/:id/close                → outcome + amount
GET    /notice-types                     → library (any staff)
PUT    /notice-types/:code               → maintain library (workflow.manage)
```

- Contracts: add `packages/contracts/src/notices.ts` with the types, status and outcome labels, and `noticeClock(notice, today)` → `{ due: date, label: 'Reply due' | 'Hearing' | 'Appeal by', overdue: boolean }`, shared by the web and mobile apps.

Done when

A manager records a notice in under a minute. Its clock appears on Today (PS-102). Changes are audited. An article outside the engagement can't see it.

Tests

- Unit: `noticeClock` for each status.
- API e2e:
  - create, list, update with version, and the 409 on a stale version;
  - row-level security: another office's manager gets a 404, and a member of the engagement team can read it;
  - duplicate `reference_no` gets a 409;
  - closing requires an outcome.
- Migration up and down on a scratch database.

PS-102

### Notice workspace and its place in the day

M

Why

A notice must reach whoever owns it, the same way filings do.

Build

- Web: add a `/notices` list (filters: stream, status, owner, due in 7/30 days) and `/notices/[id]`, laid out with:
  - a header holding the clock, amount and owner;
  - a timeline of `notice_events`;
  - documents (reusing the document slots UI with `document_type = 'notice'`, `'reply'` or `'order'`);
  - actions: Record reply, Add hearing, Record order, Close.
  - The sidebar gets "Notices" (permission `notice.manage`, or `engagement.read` for reading).
- Today (`GET /work/today`, `packages/contracts/src/work-today.ts`): add a `notices` group, ordered by `internal_due_on`, with items carrying `WorkItemRef.noticeId`. My Work gets a Notices tab, and global search (`/search`) finds notices by reference number and client.
- Notifications: `notice_received` goes to the owner and reviewer. `notice_reply_due` fires 7, 3 and 1 days before `internal_due_on`, and `notice_hearing_due` 2 days before a hearing. Both auto-resolve when a reply or hearing event is recorded. The scan runs in `notifications-scan.service.ts` under the existing scheduler.
- The engagement Overview gets an "Open notices" widget.

Done when

The owner sees the notice on Today with the right date and opens it in one click. Recording the reply clears the reminder.

Tests

- Web unit: the list filters and the clock badge.
- API e2e: Today includes notices ordered by internal due date, and the notification auto-resolves.
- Playwright: record a notice, see it on Today, record the reply, and see it leave the due list.

PS-103

### The order sets the appeal deadline

M

Why

Finding F2. Appeal limitation rules exist, but nothing triggers them, and the GST period is wrong.

Build

- Migration:
  - Set `event_type = 'notice_order'` on the `IT_APPEAL_LIMITATION`, `GST_APPEAL_LIMITATION`, TDS (CIT(A)) and `GST_AMENDMENT_LIMITATION` rule versions.
  - Add a new rule version of `GST_APPEAL_LIMITATION` using `offset_months = 3, offset_days = 0`, for a CA to verify against s.107.
  - Add rules `IT_ITAT_LIMITATION` (Form 36, 60 days from receipt of the CIT(A) order) and `GST_TRIBUNAL_LIMITATION` (GSTAT), both pending verification.
- When a notice event of kind `order` is recorded and the notice type is `appealable`, create a `compliance_events` row (`event_type = 'notice_order'`, `event_date` = the date the order was communicated, `details = {noticeId, appealRuleCode}`). The existing event machinery then creates the limitation filing on the engagement. Link it back with `notices.appeal_instance_id`.
- Set notice status to `order_received`. If the partner chooses "Appeal", create an Assignment engagement (service `GST_APPEAL` or `TAX_APPEAL`) linked to the notice, with the limitation date as its internal due date. If they choose "Accept", close the notice with an outcome.
- Voiding an order event voids the compliance event, which removes the open limitation filing (existing `voided_at` behaviour).

Done when

Recording an order dated 1 Oct creates "Appeal by" on the notice and on the compliance calendar, with the date the verified rule gives. Voiding the order removes it.

Tests

- API e2e: an order creates the limitation filing with the right date for GST (months) and income tax (days); voiding removes it; a non-appealable type creates nothing.
- Unit: the month arithmetic at month ends (31 Jan + 3 months).

PS-104

### Notice intake from the PDF

M

Why

Typing a notice is where dates get mistyped.

Build

- "Add notice" accepts a PDF. It is stored as a document (`document_type = 'notice'`) and run through the existing OCR pipeline (`documents.ocr_status`, `extracted_text`).
- Add `apps/api/src/modules/notices/notice-extract.ts`. It runs pure regex and heuristic extraction over `extracted_text`: GSTIN or PAN, DIN or reference number, issue date, reply due date, section and form, and amount. It returns suggestions with confidence values. The form is pre-filled, and the person confirms each field. Nothing is saved unconfirmed.
- Match the GSTIN or PAN to `entity_registrations` and `entities.pan` to suggest the client and engagement.

Done when

For the 20 sample notices the stream leads provide (GST portal PDFs and income-tax e-proceeding PDFs), at least 80% of reference numbers and dates are pre-filled correctly.

Tests

Unit tests on `notice-extract.ts`, with the sample texts as fixtures and no client data committed (anonymise the samples first). API e2e: upload, then a suggestion, then confirm, then a notice exists.

PS-105

### Notices report for partners

S

Why

Partners need the firm's exposure in one place.

Build

`GET /reports/notices` returns, scoped by row-level security: open notices by stream and status; notices due in 7 days; the amount demanded against the outcome amount for closed notices; and average days from receipt to reply. The web page sits at `/reports/notices`, with CSV export.

Done when

The managing partner sees open exposure (count and ₹) by stream and office.

Tests

API e2e: totals match the seeded notices and are scoped by office.

## Phase 2 · Fees to cash

\~4 weeks

PS-201

### GST-correct invoices and a billing permission

M

Why

Findings F4 and F5. Our own invoices must be valid tax invoices, and issuing or voiding them must be controlled.

Build

- Migration:
  - `firm_settings` gains `gstin, state_code, sac_default ('998221' or as the firm confirms), invoice_prefix, invoice_terms_days`.
  - `invoices` gains `client_entity_id, client_gstin null, place_of_supply_state, is_reverse_charge bool, cgst, sgst, igst numeric(14,2), amount_in_words, financial_year, sequence_no int, issued_by_employee_id, issued_at, voided_reason, voided_by_employee_id, voided_at`.
  - `invoice_line_items` gains `sac_code, taxable_value, gst_rate numeric(5,2)`.
- Number invoices per financial year (`<prefix>/<FY>/<seq>`) through a definer function `hsdg.next_invoice_number(fy)` with a row lock, so numbers have no gaps and no duplicates. Draft invoices have no number, and the number is assigned at issue.
- Tax split: intra-state (firm state = place of supply) gives CGST + SGST; inter-state gives IGST. Put this in one contracts helper, `gstSplit(lines, firmState, placeOfSupply)`.
- Permissions: issuing requires `billing.manage`. Voiding an issued invoice requires `billing.approve` and a reason. The firm-wide invoice list becomes `/billing/invoices` (`billing.manage` or `report.read`).
- Issuing renders a PDF from a document template (reuse `document_templates`) and stores it as a document on the engagement.

Done when

An issued invoice has a gap-free number for its financial year, the correct CGST/SGST or IGST split, and a PDF. A manager without `billing.approve` cannot void it.

Tests

- Unit: `gstSplit` and rounding, and amount in words.
- API e2e: 50 concurrent issues produce 50 unique, consecutive numbers; voiding without the permission gets a 403; the split is correct for both intra-state and inter-state.

PS-202

### Receipts, part payments and TDS on our fees

L

Why

Most clients pay part, late, and net of TDS under s.194J. "Paid" as a single status hides all of that.

Build

- Migration:
  - `hsdg.receipts(id, client_entity_id, received_on, mode ('bank'|'upi'|'cheque'|'cash'|'adjustment'), reference, gross_amount, tds_amount, tds_section ('194J'|'194C'|'other'|null), net_amount, bank_account null, status ('posted'|'reversed'), reversed_reason, recorded_by_employee_id, version)`.
  - `hsdg.receipt_allocations(receipt_id, invoice_id, amount)`, so one receipt can pay several invoices and one invoice can have several receipts.
  - `invoices.status` gains `partially_paid`. An invoice is `paid` when its allocations plus approved credits equal the total. Keep this in a trigger or function so it can't drift.
  - Unallocated money stays on the receipt as an advance.
- API:

```
GET  /billing/receipts?clientId=&from=&to=
POST /billing/receipts                     (billing.manage) → with allocations
POST /billing/receipts/:id/reverse         (billing.approve) → reason required
GET  /billing/clients/:entityId/statement  → invoices, receipts, credits, balance
```

- Web: Record receipt (pick the client, see their open invoices oldest first, allocate automatically, then adjust), plus a client statement page.

Done when

Recording ₹90,000 net plus ₹10,000 TDS against a ₹1,00,000 invoice marks it paid and shows ₹10,000 TDS receivable from that client for that quarter.

Tests

API e2e: part payment then full payment; one receipt across two invoices; reversal reopens the invoices; over-allocation is refused; row-level security by office. Unit: the allocation helper.

PS-203

### Receivables ageing and payment reminders

M

Why

Partners need to know who owes what and for how long, and chasing should be one click.

Build

- `GET /reports/receivables` returns, per client and per engagement partner, the balance by age band (0–30, 31–60, 61–90, 91–180, over 180 days, counted from `due_date`), the oldest invoice and the last receipt.
- Payment reminders reuse the client-chase channels (`client-chase.ts`: e-mail, WhatsApp, copy) with an invoice-reminder text template. Add `POST /billing/invoices/:id/remind`, which logs the reminder.
- The scheduler raises `invoice_overdue` to the engagement partner and billing owner at 15, 30 and 60 days past due. It auto-resolves on full payment.
- Firm setting `invoice_reminder_days` (default `[7, 15, 30]` after due) for optional automatic e-mail reminders. They are off by default, and the partners decide (see questions).

Done when

The managing partner sees total outstanding over 90 days by partner, and a manager sends a WhatsApp payment reminder from the invoice.

Tests

API e2e: the age bands at their boundaries, a reminder is logged, and the notification auto-resolves on payment.

PS-204

### TDS on our fees against the firm's 26AS

M

Why

TDS clients deduct must appear in the firm's 26AS, or the firm loses the credit. Today nobody matches the two.

Build

- Import the firm's 26AS (the text export from TRACES) or Form 16A PDFs into `hsdg.firm_tds_credits(deductor_tan, deductor_name, section, transaction_date, amount_paid, tds_deposited, quarter, financial_year, import_batch_id)`. Spike the parser first: formats change, so put it behind a parser interface with fixtures.
- Match credits to receipts on TAN (from the client's `entity_registrations` of type `tan`), quarter and amount, with a tolerance setting. The screen shows Matched, In 26AS but not booked, and Booked but missing from 26AS. The last group produces a client reminder (PS-203 channel) asking them to file or correct their TDS return.

Done when

Accounts imports a quarter's 26AS and sees every mismatch by client.

Tests

Parser unit tests on anonymised fixtures. Matcher unit tests (exact, tolerance, split deposits). API e2e: import, then match, then the three groups.

PS-205

### Credit notes and write-offs with approval

M

Why

Reducing a bill is a partner decision and must leave a trail.

Build

- `hsdg.credit_notes(id, invoice_id, number (series per financial year, as for invoices), reason, taxable_value, cgst/sgst/igst, total, status ('pending'|'approved'|'rejected'|'void'), requested_by, approved_by, approved_at)`.
- `hsdg.write_offs(id, invoice_id, amount, reason, status, requested_by, approved_by)`.
- A request comes from `billing.manage`, and the decision from `billing.approve`. Requesters can't approve their own. Approval updates the invoice balance through the PS-202 function.
- Notification `write_off_pending` goes to the approvers and auto-resolves on decision. Partners see these on Today, and on mobile in PS-602.

Done when

A manager requests a ₹5,000 write-off, the partner approves it from Today, and the invoice shows it.

Tests

API e2e: self-approval is refused, the balance updates on approval only, and a rejected request leaves no trace on the balance. Credit-note GST split reuses `gstSplit`.

PS-206

### Unbilled work into a draft invoice

M

Why

Time is recorded but never turned into an invoice, so work done isn't billed.

Build

- `GET /billing/unbilled?partnerId=` lists, per engagement, approved billable time not yet billed, at charge-out rate (PS-302), plus fixed-fee components due under `engagement_commercial.billing_frequency`.
- "Draft invoice" creates a draft with lines grouped by service or component. It marks the time entries with `billed_invoice_id` (a new column), so they aren't billed twice. Voiding releases them.

Done when

A partner turns September's unbilled time into a draft invoice in two clicks.

Tests

API e2e: an entry can't be billed twice, voiding releases it, and the amounts use the rate in force on the date of the work.

## Phase 3 · Partner control

\~3.5 weeks

PS-301

### Partner risk dashboard

M

Why

One screen of "what can hurt us", each item opening the work itself.

Build

- `GET /dashboard/risk` (scoped by row-level security: office partner to their office, managing partner to the firm). It returns these tiles, each with a count, the top 10 items as `WorkItemRef`, and a link to the full list:
  1. Statutory dates missed (open filings past their statutory date)
  2. Filings due in 7 days with no reviewer, or still `not_started`
  3. Notices with reply or hearing due in 7 days (PS-101)
  4. Appeal limitations due in 15 days (PS-103)
  5. Receivables over 90 days, in ₹ (PS-203)
  6. Unbilled work over 60 days old, in ₹ (PS-206)
  7. DSCs expiring in 30 days, or out of custody past their return date (PS-305)
  8. UDINs not generated within the window (PS-304)
  9. Write-offs and credit notes awaiting approval (PS-205)
- Web: a "Risk" section on the partner Home, above the current cockpit. Each tile reads from its own query with its own index, so one slow tile can't block the others. Load each tile independently, and paginate every list.

Done when

A partner sees all nine tiles in under 1 second (p50) on demo-size data, and every item opens in one click.

Tests

- API e2e: each tile against seeded data; office scoping; a perf test like `work-today-perf` with 2,000 items under 500 ms, run through `test:e2e:perf`.
- Playwright: open a tile item and land on the work.

PS-302

### Cost rates, realisation and profitability

L

Why

Finding F6. The firm can't see which clients and services make money.

Build

- Migration: `hsdg.rate_cards(id, grade_id, financial_year, cost_rate_per_hour, charge_out_rate_per_hour, effective_from, created_by)`. It is readable only with `practice.finance`, with row-level security on role. Optional per-employee overrides go in `hsdg.employee_rates`.
- Measures, per client, engagement, service, partner and month:
  - **Time cost** = Σ hours × cost rate
  - **Standard value** = Σ hours × charge-out rate
  - **Billed** = Σ invoice taxable value, net of credits
  - **Collected** = Σ allocations
  - **Realisation %** = billed ÷ standard value
  - **Collection %** = collected ÷ billed
  - **Margin** = billed − time cost
- Extend `reports.service.ts` with `profitability(ctx, filters)`. Keep the existing `utilisation` and add a "chargeable hours ÷ available hours" column. Available hours come from a firm-setting working calendar (`compliance_holidays` already holds holidays) less approved leave, if leave is introduced later.
- Web: `/reports/profitability`, filterable by period, partner, office, service and client, with CSV export. Clients are ranked by margin, and the bottom 10 are highlighted.

Done when

A partner sees realisation and margin by client for last quarter. A manager without `practice.finance` cannot see rates or margins, in the API or the UI.

Tests

Unit: the measure maths with a rate change in the middle of the period. API e2e: permission gate (403), office scoping, and figures against a seeded fixture.

PS-303

### Partner monthly pack

S

Why

Partners review the month on paper today.

Build

A scheduled PDF on the 3rd of each month, per partner, built from PS-301 and PS-302 plus filings done, notices closed and fees collected. It is e-mailed through the notification outbox, and is also downloadable from `/reports`.

Done when

Each partner receives their pack, and it matches the screen figures.

Tests

API e2e: pack totals equal the report endpoints.

PS-304

### UDIN register

M

Why

Finding F8. Every attest report and certificate needs a UDIN, generated within ICAI's time limit. Peer review checks the register.

Build

- `hsdg.udin_register(id, udin (unique, same format check as the archive record), document_kind ('audit_report'|'tax_audit'|'gst_audit'|'certificate'|'other'), entity_id, engagement_id null, document_id null, signing_partner_employee_id (with membership no. from partner_profiles), signed_on, generated_on, financial_year, description, status ('active'|'revoked'), revoked_reason)`.
- Firm setting `udin_window_days` (default 60). The stream leads confirm the current ICAI limit through the verification flow.
- The audit archive record's `udin` is written through to the register, with a backfill migration for existing rows. Certificates (PS-402) and tax audit (PS-401) can't be marked final without a register entry.
- Notification `udin_window_closing` goes to the signing partner 7 days before the window ends, for documents signed without a UDIN.
- Web: `/registers/udin`, with search, filters and CSV export for peer review.

Done when

Every signed report and certificate has a UDIN, or shows as overdue on the risk dashboard.

Tests

API e2e: duplicate UDIN gets a 409; the format check; the backfill from archive records; the window notification; revoke requires a reason.

PS-305

### DSC register and custody

M

Why

Finding F9. Offices hold clients' and directors' DSC tokens. Expiry and custody are tracked on paper, and PINs are shared insecurely.

Build

- `hsdg.dsc_tokens(id, holder_name, holder_pan, din null, entity_id null, class ('class3'|'dgft'|'other'), usage ('sign'|'encrypt'|'both'), issuer, valid_from, valid_to, token_serial, in_office bool, location, status ('active'|'expired'|'returned_to_holder'|'lost'))`.
- `hsdg.dsc_movements(token_id, kind ('out'|'in'|'returned_to_holder'), at, by_employee_id, purpose, expected_back_at)`.
- The token PIN is stored as an ADR-0035 credential (`client_credentials` with a new portal value `dsc`). It is revealed with the existing checks and log, never kept in this table.
- Directors' `dscExpiresOn` in the ROC compliance profile is linked to the token (`dsc_tokens.din`). The profile reads from the register when a token exists.
- Notifications: `dsc_expiring` at 30 and 7 days, and `dsc_overdue_return` when a token is out past `expected_back_at`.
- Web: `/registers/dsc` (who holds what, expiring, out), with Check out and Check in.

Done when

Accounts can answer "where is Mr Sharma's DSC and when does it expire" in one search, and the PIN is never visible outside the vault's reveal.

Tests

API e2e: check out then in; the overdue notification; the expiry scan; PIN reveal goes through `reveal_client_credential` and is logged.

## Phase 4 · Specialist desks

\~6 weeks

PS-401

### Tax audit (Form 3CA/3CB and 3CD) workspace

L

Why

Finding F13. Tax audit season (due 30 September for most assessees) is the firm's peak, and it runs on Excel.

Build

- Copy the CARO pattern (`statutory-audit-caro*.ts`, `audit_caro_*`):
  - `tax_audit_clause_library` holds 3CD clauses as versioned library data, maintained like `caro_clause_library`, so amendments are a new version and not a code change.
  - `tax_audit_programmes(engagement_id, financial_year, form ('3CA'|'3CB'), library_version)`.
  - `tax_audit_clause_items(programme_id, clause_code, response jsonb, status ('not_started'|'prepared'|'reviewed'), preparer, reviewer, evidence links to documents)`.
- Prefill from data the portal already holds: the client's registrations (GSTIN, TAN), TDS filings and defaults from TDS stream records, GST turnover from `instance_figures` and `filing_records.figures`, and the prior year's responses (roll forward, as `statutory-audit-rollforward` does).
- Reviewer sign-off per clause, then partner sign-off, which requires a UDIN entry (PS-304).
- Export: a clause-wise Excel/CSV laid out to match the e-filing utility, for upload. The portal does not file.

Done when

A senior prepares all clauses with prefill, a manager reviews them, the partner signs with a UDIN, and next year's programme starts from this year's answers.

Tests

API e2e: programme creation from a library version, prefill sources, sign-off gates (no partner sign-off with unreviewed clauses, no final without a UDIN), and roll-forward. Unit: the export mapping.

PS-402

### Certificates desk

M

Why

Certificates (15CB, net worth, turnover, utilisation certificates, visa and bank certificates) are frequent, quick and risky: each needs a UDIN and a file.

Build

- Service `CERTIFICATION` work becomes a lightweight flow on an Assignment engagement: pick a template (from `document_templates`, one per certificate type), fill the variables, attach evidence, review, partner sign, UDIN (PS-304), then issue a PDF.
- `hsdg.certificates(id, engagement_id, template_code, purpose, addressee, figures jsonb, status ('draft'|'in_review'|'signed'|'issued'|'revoked'), udin_id, document_id)`.
- A 15CB template captures remittance details and records the Form 15CA acknowledgement number once filed.
- A firm-wide register at `/registers/certificates`.

Done when

A 15CB goes from request to signed PDF with UDIN in the portal, and appears in both registers.

Tests

API e2e: no issue without a UDIN, revoke requires a reason, and template variables are validated. Web unit: the template form.

PS-403

### Individual returns at volume

L

Why

Hundreds of salaried and small-business ITRs land in June and July. The work is matching AIS, TIS and 26AS against the client's documents, then chasing e-verification and refunds.

Build

- Spike (S) first: download formats for AIS (JSON from the AIS utility, or PDF), TIS and 26AS. Write parsers behind interfaces with anonymised fixtures.
- `hsdg.itr_returns(engagement_id, entity_id, assessment_year, itr_form, regime ('old'|'new'), status ('collecting'|'computing'|'in_review'|'filed'|'e_verified'|'processed'), filed_on, ack_no, e_verify_due_on, e_verified_on, refund_claimed, refund_status ('none'|'pending'|'issued'|'adjusted_245'|'failed'), refund_received_on)`.
- `hsdg.itr_income_lines(return_id, source ('ais'|'tis'|'26as'|'client'), head, description, amount, matched_line_id)` produces a matching view of what AIS says against what the client declared.
- `e_verify_due_on` comes from a rule version (30 days from filing at present, verified by the stream lead). Filings not e-verified appear on Today and in client chase.
- An ITR filing run (reusing filing runs, WF-301) covers one assessment year across all individual clients: assign, bulk-chase documents, see status.
- 143(1) intimations and 245 adjustments become notices (PS-101), linked to the return.

Done when

The income-tax lead runs the season from one grid. Nothing is left unverified past its date without a reminder, and refunds are tracked to receipt.

Tests

Parser unit tests. API e2e: e-verify reminder dates, the refund status flow, and the filing run over individual clients.

PS-404

### Client KYC and acceptance for non-audit clients

M

Why

Statutory audit has a full acceptance process. Other clients are taken on with no KYC on file, which ICAI's KYC norms for members in practice expect.

Build

- `hsdg.client_kyc(entity_id, status ('pending'|'complete'|'expired'), pan_verified, address_proof_doc_id, identity_proof_doc_ids, beneficial_owners jsonb, risk_rating ('low'|'medium'|'high'), reviewed_by, reviewed_on, next_review_on)`.
- A KYC checklist uses catalogue templates (`catalogue_templates` of type `document_requirement`). Creating a new non-audit engagement for a client with KYC `pending` shows a warning. A partner can override it with a reason, which is audited.
- Periodic review by risk rating: high every year, others every 3 years (a firm setting).

Done when

Every active client has a KYC status, and the risk dashboard counts clients without one.

Tests

API e2e: the warning and override audit, and review date calculation.

PS-405

### Payroll and labour compliance as a seventh stream

M

Why

Finding F12. PF, ESI and PT rules exist but don't appear on any tab, so their due dates are missed.

Build

- Add `payroll` to `STREAM` (label "Payroll & Labour"), the service `STREAM_PAYROLL` folding `PAYROLL` and `LABOUR_COMPLIANCE`, and `registration_type` values already present (`pf`, `esic`, `pt`).
- Assign `PF_MONTHLY`, `ESI_MONTHLY`, `PT_MONTHLY` and `LABOUR_RETURNS_QTR` to the stream. PT is state-specific, so the rule versions carry `registration_scope` by state; the stream lead verifies them per state.
- The stream tab, filing runs, Today and the calendar all work from the stream metadata. Check every `STREAMS` switch statement (search for `STREAM_LABEL` and `streamTab`).
- The mobile app's stream list comes from the regenerated client.

Done when

A client with a PF registration shows a Payroll & Labour tab with monthly PF/ESI returns, and they appear in Today and filing runs.

Tests

Contracts unit tests for stream ordering. API e2e: instances created for a PF registration, and filing runs for `PF_MONTHLY`. Playwright: the tab opens on the period needing action.

## Phase 5 · Client portal

\~5 weeks

Needs the partners' answers to questions Q5–Q7 (see [Risks and open questions](#risks)) before starting. Write an ADR first (ADR-0036 "Client principals"), because this adds a second kind of user.

PS-501

### Client sign-in and a client principal

L

Why

Finding F10. Clients need their own access. Staff auth (M365 or dev) must not be stretched to cover them.

Build

- A client user is an `entity_contacts` row with `is_portal_user = true`. Add `hsdg.client_users(id, contact_id, email, phone, status, last_login_at)` and `hsdg.client_user_entities(client_user_id, entity_id, portal_role ('owner'|'accountant'|'viewer'))`, so one accountant can serve several group companies.
- Sign-in uses a one-time code by e-mail, with optional WhatsApp or SMS later, through a provider behind an interface. Codes are rate-limited and expire in 10 minutes. The JWT carries audience `client` and claims `{clientUserId, entityIds}`.
- Add a new RLS context role `client`. Staff policies already deny it by default. Clients read only through `SECURITY DEFINER` functions (`hsdg.client_*`) that check `ctx_client_entity_ids()` and return client-safe shapes (Design rule 5).
- Staff invite clients from the client page ("Give portal access"), which is audited. Contacts can be revoked.

Done when

A client signs in with a code and can call only `/client/*` endpoints. Any staff endpoint returns 401 or 403 for a client token.

Tests

- API e2e: a client token is refused on every staff route (generated from the route table, so no route can be missed); the code expires; rate limits apply.
- Row-level security: client A can't read client B through any `client_*` function.

PS-502

### Client home: what we need, what we did

L

Why

Replace one-off upload links with one place for the client.

Build

- `/client` (web, responsive) shows:
  - **What we need:** open `client_dependencies` across their entities, grouped by filing, with an upload into the right slot (reusing slot upload; virus scan and size limits as for staff).
  - **What we filed:** filings with `filing_records` and the acknowledgement document, which the client downloads.
  - **Notices:** status only, when the firm marks a notice "visible to client". A per-notice switch defaults to off.
  - **Documents shared:** files staff publish with `documents.client_visible = true` (a new column, default false).
- An upload creates `client_upload_received` for the filing's preparer, and the request moves to received when every item is in. Existing `client_upload_links` keep working, and new links point clients to the portal.

Done when

A client sees their pending items, uploads a bank statement into September's GST slot, and the preparer is notified. Nothing internal (notes, review points, internal dates, staff names beyond the owner) is visible.

Tests

- API e2e: published documents only, the notice visibility switch, and upload into the slot.
- A contract test that client response shapes contain no internal fields (snapshot of keys).
- Playwright: the client journey.

PS-503

### Client invoices and payment

M

Why

Clients ask for copies of invoices and ledgers. Online payment shortens collection.

Build

- The client sees their invoices (issued, with PDF), receipts and a statement (PS-202).
- Pay online through a payment gateway behind an interface, if the partners approve (Q6). The gateway webhook records a receipt (`mode = 'upi'` or `'card'`), verified by signature and idempotent on the gateway payment id. Without a gateway, show the firm's bank and UPI details and a "Tell us you've paid" form that creates a pending receipt for accounts to confirm.

Done when

A client downloads an invoice and pays it, and the receipt posts with no manual entry (gateway path) or after accounts confirms it (manual path).

Tests

API e2e: webhook signature verification, an idempotent replay, and the amount check against the invoice balance. Unit: the gateway adapter, mocked.

PS-504

### Client reminders point to the portal

S

Why

Reminders should send clients to one place.

Build

Client-chase texts (e-mail, WhatsApp, copy) and payment reminders include a portal link to the specific request or invoice. The link uses the same pattern as `workItemHref`, applied to client routes.

Done when

Every reminder carries a working client link.

Tests

Unit: the client link builder. API e2e: the reminder text contains the link.

PS-505

### Client app (mobile)

L

Why

Most clients will use a phone.

Build

Decision Q7: a client mode in the Dhvaj app, or a separate client app. The recommended default is **a separate Expo app in the same repo as a second entry point**, so staff and client code never share a bundle at runtime. It covers sign-in by code, what we need (with camera upload into the slot), what we filed (with download and share), invoices, and pay. Deep links come from WhatsApp reminders.

Done when

A client uploads a document from the camera and pays an invoice on iOS and Android simulators.

Tests

Component tests for each screen, and the simulator pass checklist.

## Phase 6 · Mobile for the new services

\~1.5 weeks. Starts after each feature's web portal work is done.

PS-601

### Notices on the phone

M

Build

Notices join Today on the phone (they arrive from the regenerated `/work/today`). The notice screen shows the clock, the timeline and documents. Staff can record a hearing outcome or an adjournment, and photograph and upload a notice or order (camera into `document_type = 'notice'`).

Tests

Component tests: the clock badge, recording an event, and upload.

PS-602

### Approvals and receipts on the phone

M

Build

Partners approve or reject write-offs and credit notes from Today. Managers record a receipt against a client's open invoices (allocate automatically, then confirm) and send a payment reminder over WhatsApp.

Tests

Component tests: approval, refusal of self-approval (server error shown), and the receipt form.

PS-603

### DSC custody on the phone

S

Build

From the DSC register, staff check a token out or in, search by holder, and see expiry. They can scan a QR label on the token (`expo-camera`) to open it. Read the SDK 57 docs before using the camera API.

Tests

Component tests: check out, check in, and search.

## Data model at a glance

| Table | Phase | Key columns | Notes |
| --- | --- | --- | --- |
| `notice_types` | 1 | code, stream, form, section, default_reply_days, appealable, appeal_rule_code | Library, versioned |
| `notices` | 1 | entity_id, engagement_id, notice_type_id, reference_no, issued_on, reply_due_on, internal_due_on, owner, status, outcome | FORCE RLS via engagement |
| `notice_events` | 1 | notice_id, kind, occurred_on, next_date, document_id | Timeline, append-only |
| `receipts`, `receipt_allocations` | 2 | gross, tds, net, mode, allocations | Reversal only |
| `credit_notes`, `write_offs` | 2 | amount, reason, status, approver | Approval by another person |
| `firm_tds_credits` | 2 | deductor_tan, quarter, amounts | From the 26AS import |
| `rate_cards`, `employee_rates` | 3 | grade, FY, cost, charge-out | `practice.finance` only |
| `udin_register` | 3 | udin, kind, signer, signed_on, generated_on | Backfilled from the archive |
| `dsc_tokens`, `dsc_movements` | 3 | holder, validity, custody | PIN in `client_credentials` |
| `tax_audit_*` | 4 | library version, clause items | Mirrors CARO |
| `certificates` | 4 | template, figures, udin | Template-driven |
| `itr_returns`, `itr_income_lines` | 4 | AY, status, e-verify, refund | Parsers behind interfaces |
| `client_kyc` | 4 | status, risk, next review | |
| `client_users`, `client_user_entities` | 5 | contact, entities, role | Client principal |

Column additions: `firm_settings` (gstin, state_code, sac_default, invoice_prefix, invoice_terms_days, notice_buffer_days, udin_window_days, invoice_reminder_days); `invoices` (GST fields, numbering, void trail); `invoice_line_items` (sac_code, taxable_value, gst_rate); `engagement_time_entries.billed_invoice_id`; `documents.client_visible`; `notices.appeal_instance_id`.

## API changes at a glance

| Endpoint | Change | Ticket |
| --- | --- | --- |
| `POST …/client-chase/remind` | Optional `channel` override | PS-001 |
| `GET/POST/PATCH /notices`, `POST /notices/:id/events`, `/close` | New | PS-101 |
| `GET/PUT /notice-types` | New: library | PS-101 |
| `GET /work/today` | Add a `notices` group, and approvals for partners | PS-102, PS-205 |
| `POST /notices/intake` | New: PDF → suggestions | PS-104 |
| `GET /reports/notices` | New | PS-105 |
| `POST /engagements/:id/invoices/:invoiceId/status` | Issue assigns the number; void needs `billing.approve` | PS-201 |
| `GET/POST /billing/receipts`, `POST …/reverse`, `GET /billing/clients/:id/statement` | New | PS-202 |
| `GET /reports/receivables`, `POST /billing/invoices/:id/remind` | New | PS-203 |
| `POST /billing/tds-credits/import`, `GET /billing/tds-credits/match` | New | PS-204 |
| `POST/PATCH /billing/credit-notes`, `/billing/write-offs` | New | PS-205 |
| `GET /billing/unbilled`, `POST /billing/unbilled/draft` | New | PS-206 |
| `GET /dashboard/risk` | New: nine tiles | PS-301 |
| `GET/PUT /rate-cards`, `GET /reports/profitability` | New | PS-302 |
| `GET/POST /registers/udin`, `GET/POST /registers/dsc`, `POST /registers/dsc/:id/movements` | New | PS-304, PS-305 |
| `/tax-audit/*`, `/certificates/*`, `/itr/*`, `/client-kyc/*` | New | PS-401 to PS-404 |
| `POST /client/auth/code`, `/client/auth/verify`, `GET /client/*` | New: client audience | PS-501 to PS-503 |
| `POST /billing/gateway/webhook` | New: signed, idempotent | PS-503 |

Every new endpoint goes through `db.withRlsContext` and gets an e2e test proving an unassigned user can't see or change it. Migrations follow the existing rule: wrap data updates in `NO FORCE … FORCE ROW LEVEL SECURITY`, and test up and down on a scratch database, never the shared dev database. After each API change, regenerate the mobile client (`curl …/api/docs-json -o openapi/openapi.json && npm run api:gen`).

## Testing and rollout

### Tests per ticket

- **Unit:**
  - `noticeClock`, `gstSplit` and rounding;
  - allocation, realisation maths, the 26AS matcher, notice extraction, and the AIS/26AS parsers (anonymised fixtures only, never real client data in the repo).
  - Run with `npm test` at the repo root. It needs no environment since PR #6.
- **API e2e:** each new or changed endpoint, including row-level security and permission gates.
  - Run with `npm run test:e2e` in `apps/api`. Perf budgets go in `*-perf.e2e-spec.ts`, which runs in its own process.
- **Playwright:** one journey per phase:
  - Phase 1: record a notice, see it on Today, record the reply and the order, and see "Appeal by" on the calendar.
  - Phase 2: issue an invoice, record a part receipt with TDS, see ageing, approve a write-off.
  - Phase 3: open a risk tile item, then see profitability for the quarter.
  - Phase 5: a client signs in, uploads into a slot, the preparer is notified, and the client pays.
- **Mobile:** component tests for each screen, plus a simulator pass per phase (PS-002).
- **CI** must be green on the PR before merging to main. It runs lint, typecheck, build, unit tests, e2e and perf.

### Rollout

- Each phase ships behind its flag and is piloted in one office from Admin → Rollout for two weeks, then firm-wide.
- Statutory periods (notice reply windows, appeal limits, UDIN window, e-verification days, PT by state) are switched on only after a stream lead records a verification on the rule version.
- **Billing cut-over:** pick a date. Invoices issued before it stay as they are, with `paid` meaning fully paid. Load opening balances per client as an opening receipt or invoice, and have accounts confirm.
- **Before Phase 5:** a security review of the client principal by someone who didn't build it, then a pilot with five friendly clients.

## How we measure it

Record a baseline in the month before each phase ships. Use the existing `workflow_baselines` and `workflow_measure_targets` tables, adding measures.

| Measure | How | Target |
| --- | --- | --- |
| Notices replied after their reply date | `notice_events` reply against `reply_due_on` | 0 |
| Appeals filed after their limitation | Limitation filings completed late | 0 |
| Days sales outstanding | Receivables ÷ billing per day, monthly | −25% |
| Fees over 90 days old | `/reports/receivables` | −40% |
| TDS on fees missing from 26AS | Unmatched at quarter end + 45 days | 0 |
| Realisation % | PS-302, quarterly | Visible; target set by partners |
| UDINs generated late | `udin_register` | 0 |
| DSCs used after expiry, or not returned on time | `dsc_movements` | 0 |
| Client documents received via the portal | Portal uploads ÷ all client uploads | ≥ 60% six months after launch |

## Risks and open questions

### Risks

- **Getting the law wrong.** Every period is data with a verification step (Design rule 1). The seed values here are starting points. The stream leads sign them off, and changes are versioned, not overwritten.
- **Money bugs.** Use exact decimals everywhere and recompute balances in one database function. Include an e2e test that fails if the sum of allocations ever exceeds an invoice total. Accounts reconciles the first month in parallel with the current books.
- **Parsing government files.** The 26AS, AIS and notice PDF formats change without notice. Keep parsers behind interfaces with fixtures; a failed parse falls back to manual entry and never blocks work.
- **Client portal security.** It is the first external user type. Mitigations: separate token audience, definer-function reads only, a generated test that every staff route refuses client tokens, rate limits on codes, and a review by someone who didn't build it.
- **Query load on the risk dashboard.** Use one query per tile, each with its own index; load them in parallel and add a perf test, as Today has.
- **Sensitive rates.** Cost rates and margins are visible only with `practice.finance`. Enforce it in the database, not just the UI.

### Questions for the partners

1. **Notices:** who owns a new notice by default (the stream lead for that client, or the engagement manager)? How many buffer days before the reply date should the internal due date be (default 3)?
2. **Invoices:** confirm the firm's GSTIN, the invoice number format, payment terms (default 15 days), and whether automatic e-mail payment reminders should go out (default off).
3. **Write-offs:** is there an amount below which a manager may approve alone?
4. **Rates:** who sets cost and charge-out rates, and should managers see realisation without rates?
5. **Client portal:** which clients first (all, or a pilot list)? Should notices ever be visible to clients?
6. **Online payment:** use a payment gateway (with its fees), or bank and UPI details with manual confirmation?
7. **Client app:** a separate client app (recommended), or a client mode inside the staff app?
8. **KYC:** confirm the review cycle by risk rating, and which documents are required.

## Team split and order

The plan suits two squads working in parallel, the same 50/50 split that delivered the Staff Workflow Plan. **Each feature finishes in the web portal before its mobile ticket starts.**

| Weeks | Squad A | Squad B |
| --- | --- | --- |
| 1 | PS-001, PS-002 (mobile finish) | PS-201 (GST invoices, billing permission) |
| 2–4 | PS-101, PS-102, PS-103 (notices) | PS-202, PS-203 (receipts, ageing, reminders) |
| 5–6 | PS-104, PS-105 (intake, report) | PS-204, PS-205, PS-206 (26AS, approvals, unbilled) |
| 7–9 | PS-301, PS-304, PS-305 (risk dashboard, UDIN, DSC) | PS-302, PS-303 (rates, profitability, pack) |
| 10 | PS-601, PS-603 (mobile notices, DSC) | PS-602 (mobile approvals, receipts) |
| 11–15 | PS-401, PS-402 (tax audit, certificates) | PS-403, PS-404, PS-405 (ITR desk, KYC, payroll) |
| 16–20 | PS-501, PS-502 (client principal, client home) | PS-503, PS-504, PS-505 (payments, links, client app) |

Each phase ends the same way: merge both squads' branches, run the full suite (lint, typecheck, unit, e2e, perf, Playwright, mobile), open a PR so CI checks it, merge to main, regenerate the mobile client, and pilot it in one office.
