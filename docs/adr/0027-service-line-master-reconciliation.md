# ADR-0027 — Service-Line Master Reconciliation to the Frozen §3 (+ §17 Fallback)

- **Status:** Accepted
- **Date:** 2026-08-28
- **Phase:** 13 (Administration) — catalogue-fidelity follow-on

## Context

The FINAL_BALANCED **Service Catalogue Master** freezes the firm's catalogue
architecture. §3 defines **fourteen co-equal top-level Service Lines**, and §30
requires that "every Service Line receive the same structural treatment." §17
adds a fifteenth, governed line — **Other Professional Services (OTHER)** — a
controlled fallback whose defining rule is that "the developer must not allow
unrestricted creation of new Services" under it; "creation requires authorised
catalogue approval."

The build (seeded in 0007, grown in 0034) had diverged from the frozen master in
three ways:

1. Six advisory-family lines the master keeps distinct — Transaction Advisory,
   **FEMA**, **Valuation**, **Virtual CFO**, **Governance**, **Forensic** — were
   all folded into a single `ADVISORY` line. The master's uniform-treatment
   principle (§30) was therefore not honoured: valuation and forensic work could
   not be filtered, reported, or configured as their own service lines.
2. The build carried a `LITIGATION` service line the master does **not** have.
   The master models litigation as *services* under Direct Tax (Appeal &
   Litigation) and GST (Appeal / Litigation), not as a top-level line.
3. The §17 `OTHER` line and its creation control did not exist at all.

## Decision

Migration `0035_service_line_master_reconcile` reconciles the master **without
renaming existing line codes** (a deliberate choice — see below), plus the
application-layer control for §17.

### 1. Add the five missing lines; keep existing codes

`FEMA`, `VAL`, `CFO`, `GOV`, `FOR` become co-equal top-level service lines, and
the services that had been folded under `ADVISORY` (`FEMA`, `VALUATION`,
`VIRTUAL_CFO`, `GOVERNANCE`, `FORENSIC`) are re-parented to them. `ADVISORY` is
retained as the master's **ADV** (Transaction & Business Advisory) line.

Existing line codes (`AUDIT`, `ACCOUNTS`, `ROC`, `PAYROLL`, `REGISTRATIONS`) are
**not** renamed to the master's short forms (`AUD`, `ACC`, `CORP`, `PAY`, `REG`).
Codes are internal keys resolved by lookup, never shown to users; the
human-facing **names** already match the master. Renaming would churn test
fixtures and any stored references for a purely cosmetic gain, so the added lines
adopt the master's short codes while the incumbents keep theirs.

### 2. Litigation is a service, not a line

`ITAT_REP` is re-parented to the `TAX` line (alongside the existing `TAX_APPEAL`
service), and the now-empty `LITIGATION` line is dropped. The delete is guarded
(`NOT EXISTS` any service on the line) and is additionally protected by the
`ON DELETE RESTRICT` foreign key, so it is a clean no-op if a future service is
ever attached there. This matches the frozen 14.

### 3. §17 OTHER fallback + an authorised-creation control

A new `OTHER` line and its single `OTHER_PROF` ("Other Professional Assignment")
service are seeded. The control is enforced in two layers:

- A new permission **`service.manage_other`**, granted to the **Managing Partner
  only** (not `admin`, who holds the ordinary `service.manage`). Creating — or
  re-parenting — a service under `OTHER` requires it, enforced in
  `ServicesController`. Anyone else receives **403**.
- A recorded **approval reference**: creating a service under `OTHER` requires a
  non-empty `approvalReference`, persisted to a new nullable
  `services.approval_reference` column and surfaced on the service record. The
  requirement is enforced at the HTTP layer and again, defence-in-depth, in
  `CatalogueService.createService` (**400** when absent). This is the durable
  "authorised catalogue approval" §17 asks for; the create is audited as usual.

## Consequences

- The service-line master now matches the frozen §3 (14 lines) plus the §17
  `OTHER` fallback — fifteen lines, each configurable, filterable and reportable
  on equal footing. Valuation / FEMA / CFO / Governance / Forensic engagements
  can be scoped to their own line.
- No service **codes** changed and no engagement references a service line
  directly (they reference services), so the re-parenting is transparent to
  existing engagements, components, compliance instances and tasks.
- Unrestricted growth of the catalogue's fallback line is now impossible: only
  the Managing Partner may place a service under `OTHER`, and only with a
  recorded approval reference.
- **Not in scope (called out for later):** aligning the four generic workflow
  families to the master's fifteen named families (§19), and the reusable,
  versioned checklist / PBC / document-requirement template masters (§18/§25).
  These are the remaining catalogue-fidelity items after this reconciliation.
