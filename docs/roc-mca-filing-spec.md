# ROC / MCA filings in the portal — build spec

> **For:** the portal engineering team. **From:** the firm's compliance side (senior CA review).
> **Source:** `Compliance_Calendar_Oct2026-Sep2027.xlsx` (prepared 12 Oct 2026), its ROC / MCA rows
> and Event-Based sheet, checked against the Companies Act, 2013, the LLP Act, 2008 and what the
> portal already does (rules in `apps/api/src/modules/compliance/calendar-v2-rules.ts`, checklists in
> `db/migrations/1770600000000_filing_workspace.sql`, filing rules in
> `apps/api/src/modules/filing-workspace/filing-rules.ts`).
>
> **Scope:** every ROC / MCA item in the calendar, built in two phases:
>
> - **Phase 1:** the recurring items, plus a way to record events (AGM, allotment, director change …).
> - **Phase 2:** the event-based forms.
>
> Each form gets its own checklist. Items marked **Verify** must be confirmed against the official
> notification before release (see §9).

---

## 1. What the ROC tab does today

A Compliance engagement with the **ROC** stream in scope generates one item per rule, per CIN
(or LLPIN, or DIN for KYC), per period:

- **The annual strip** holds the AGM, AOC-4, MGT-7, ADT-1, DPT-3, DIR-3 KYC, LLP Form 8 / 11 and
  any event items.
- **The periods** hold MSME-1 and PAS-6 (half-yearly) and board meetings (quarterly).

Each item opens the filing workspace: assign → prepare → review → lodge, with document slots, a
checklist and a reference number (SRN for ROC).

The engine already supports what ROC needs:

| Need                                | How the engine does it                                                |
| ----------------------------------- | --------------------------------------------------------------------- |
| Dates that run from the AGM         | `basis: 'event_date'`, `eventType: 'agm'`, `offsetDays: 30 / 60 / 15` |
| A date shown before the AGM is held | `provisionalEventRule` (assumed 30 Sep)                               |
| OPC dates and form names            | `variants`                                                            |
| Who a rule applies to               | `condition` on CIN profile facts                                      |
| Per-director items                  | `registrationScope: 'din'` with a triennial cycle                     |

Recording an event (`POST /engagements/:id/compliance-events`) creates the event items and moves
AGM-linked dates off the provisional date.

### Gaps this spec closes

| #   | Gap                                                                                                  | Effect today                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| G1  | There is no screen to record an event. The API exists; nothing in the web app calls it.              | AOC-4, MGT-7 and ADT-1 stay on the assumed 30 Sep AGM. DIR-12, PAS-3, CHG-1 … never appear.                             |
| G2  | One checklist (`FILING_ROC`) is used for every ROC item.                                             | An AOC-4 does not ask for the signed accounts, auditor's report or board's report. An AGM asks for an SRN.              |
| G3  | Meetings (AGM, board meeting) close like filings: SRN, and a filing date on or after the period end. | A board meeting held on 15 May cannot be recorded against Apr–Jun, because 15 May is before 30 Jun.                     |
| G4  | MGT-7A is shown only for an OPC.                                                                     | Small companies also file MGT-7A, but are shown MGT-7.                                                                  |
| G5  | ADT-1 runs off a static profile flag (`auditorAppointedAtAgm`).                                      | Set once, it creates an ADT-1 every year, although an auditor is appointed for five years.                              |
| G6  | Board meetings for small companies and OPCs use FY quarters Q2 / Q4 (due 30 Sep and 31 Mar).         | The law counts halves of the **calendar** year (Jan–Jun, Jul–Dec), so the due dates are wrong.                          |
| G7  | DPT-3 has no condition. The profile has `depositsOrExemptedLoans`, but nothing reads it.             | DPT-3 is created for every company, with no way to say it does not apply.                                               |
| G8  | Late fees are estimated only for GST.                                                                | ROC items show no additional fee.                                                                                       |
| G9  | Checklist `onlyIf` reads only GSTIN / TAN / PAN profile attributes.                                  | Items such as "CSR report (if s.135 applies)" cannot be shown or hidden per company.                                    |
| G10 | The OPC variant sets `form_label` MGT-7A, but the ROC tree label ignores it.                         | An OPC is shown "MGT-7" (found by a preview probe, Oct 2026).                                                           |
| G11 | LLP Form 11 uses `offsetMonths: 2` and LLP Form 8 uses `offsetMonths: 7`.                            | Due dates show **31 May** and **31 Oct**; the law gives **30 May** (60 days) and **30 Oct** (6 months + 30 days).       |
| G12 | Small-company status is not worked out; it comes only from `companySubtype` in the profile.          | A small private company is treated as an ordinary one (MGT-7, quarterly board meetings) until someone sets the subtype. |
| G13 | ROC items are generated only for a client with a CIN or LLPIN registration.                          | Ticking ROC / MCA for a company with no CIN on record creates nothing, without saying why.                              |

---

## 2. Design decisions

1. **Meetings and filings close differently.**
   - **Meetings** (AGM, board meeting, first board meeting, first AGM) close with **"Record meeting"**:
     a _held on_ date, which may fall anywhere in the period, the minutes as the closing document,
     and an internal reference. No SRN.
   - **Filings** close with **"Lodge (SRN)"**: the SRN, the challan, and the date filed (on or after
     the period end or event date).
2. **Closing the AGM records the AGM event.** Lodging the `ROC_AGM` item with a held-on date creates
   the `agm` compliance event for that FY, if none exists. AOC-4, MGT-7 / 7A and ADT-1 then move to
   their real dates. Nobody records the AGM twice.
3. **One checklist per form** (`FILING_<RULE_CODE>`, which the resolver already looks up first). The
   generic `FILING_ROC` stays as the fallback for anything without its own checklist.
4. **Events are recorded in the ROC tab**, next to the items they create, by the engagement lead.
5. **Client dependencies stay explicit.**
   - The director's DSC and external certificates (CS-only certificates such as MGT-8 and MR-3) are
     client dependencies, so the item shows _awaiting data_ while they are outstanding.
   - The firm's own certification is a checklist step ticked by a partner, with a UDIN.
6. **The law decides the dates; the firm decides the internal dates.** Statutory dates follow the
   rules below. The internal SLA (`internalSlaOffsetDays`) stays as configured.

---

## 3. Phase 1 build list (in order)

| #     | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Touches                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | **Record an event** panel on the ROC tab (§6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | web `stream-tab.tsx` (ROC only), new `roc-events.tsx`; API exists. Add `PATCH`/`DELETE` for corrections (§6.3).                                          |
| P1-2  | **Meetings close as meetings.** `filingEnd()` returns _Record meeting / Held / Ready to record_ for meeting rules. The reference kind defaults to `internal`. `checkFiledOn` accepts a held-on date ≥ **period start** for meetings.                                                                                                                                                                                                                                                                                                 | `filing-rules.ts`, `filing-status.tsx`, `filing-workspace.service.ts`. Add a `closes: 'meeting' \| 'filing'` field on the rule version (or a code list). |
| P1-3  | **Closing the AGM records the event** (decision 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `filing-workspace.service.ts` lodge path for `ROC_AGM` → `ComplianceCalendarV2Service.recordEvent`.                                                      |
| P1-4  | **Per-form checklists** for the 11 recurring items (§5), seeded as `catalogue_templates`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | new generated migration, from `scripts/gen-calendar-v2-rules.ts` (same NO FORCE…FORCE wrapper).                                                          |
| P1-5  | **Checklist `onlyIf` on CIN / LLPIN attributes**, plus a new `autoTick: 'event'` that ticks _AGM held_ once the FY's AGM event exists. Certification lines (`CERT`, marked _partner ticks_) carry a new `tickedBy: 'partner'` key: only a partner can tick them, and the tick requires a note (the UDIN).                                                                                                                                                                                                                            | `instance_checklist_items` seeding, `documents_tick_slot` sibling for events, the checklist tick path in `filing-workspace.service.ts`.                  |
| P1-6  | **Rule fixes G4–G7** (§5: AOC-4, MGT-7, ADT-1, DPT-3, board meeting).                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `calendar-v2-rules.ts` + generated migration; `compliance-periods.spec.ts`.                                                                              |
| P1-7  | **New CIN profile facts** (§4) in the client's compliance profile card.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `packages/contracts` `CinProfileAttributes`, `compliance-profile.ts`, `compliance-profiles-card.tsx`.                                                    |
| P1-8  | **Late-fee estimate** for AOC-4, MGT-7 / 7A and LLP Form 8 / 11: ₹100 per day late (G8). Other forms show the note only until P2-4.                                                                                                                                                                                                                                                                                                                                                                                                  | `filing-workspace.service.ts` `lateCharges`.                                                                                                             |
| P1-9  | **Tests:** unit tests for every date in §8, an e2e for record-event → dates move → lodge, and a Playwright flow for _AGM held → AOC-4 lodged with SRN_.                                                                                                                                                                                                                                                                                                                                                                              | `compliance-periods.spec.ts`, `compliance-calendar-v2.e2e-spec.ts`, `apps/web/e2e/`.                                                                     |
| P1-10 | **Fixes G10–G13:** apply the variant `form_label` in the tree; correct the LLP offsets (days, not months); default `companySubtype` to `small` when paid-up capital and turnover are within the limits (when those facts exist, else a prompt on the profile card); and on the ROC tab, when the client has no CIN / LLPIN, say "Add the CIN (or LLPIN) to the client to see its ROC filings" instead of an empty tab. A partnership firm or proprietorship gets the same message: they are not MCA entities, so ROC does not apply. | tree label in `stream-tree.service.ts`; `calendar-v2-rules.ts`; `compliance-profile.ts`; `stream-tab.tsx`.                                               |

## 4. Client facts the rules read (CIN / LLPIN profile)

| Attribute                                                                        | Status             | Used by                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companySubtype`: `private` \| `small` \| `opc` \| `unlisted_public` \| `listed` | exists             | AGM (not OPC), AOC-4 / MGT-7 variants, PAS-6, board meetings                                                                                            |
| `msmeDuesOver45Days`                                                             | exists             | MSME-1                                                                                                                                                  |
| `depositsOrExemptedLoans`                                                        | exists, **unused** | DPT-3 (G7)                                                                                                                                              |
| `directors[]` `{din, name, kycCycleStartFy}`                                     | exists             | DIR-3 KYC                                                                                                                                               |
| `auditorAppointedAtAgm`                                                          | exists, **retire** | Replaced by the AGM event flag (§6.2)                                                                                                                   |
| `xbrlRequired`                                                                   | **new**            | AOC-4 label _AOC-4 XBRL_: listed companies and their Indian subsidiaries, paid-up capital ≥ ₹5 cr or turnover ≥ ₹100 cr — **Verify** current thresholds |
| `hasSubsidiaries`                                                                | **new**            | Adds _AOC-4 CFS_ (consolidated) to the AOC-4 item                                                                                                       |
| `mgt8Required`                                                                   | **new**            | MGT-8 checklist line: listed, paid-up ≥ ₹10 cr or turnover ≥ ₹50 cr                                                                                     |
| `csrApplicable`                                                                  | **new**            | CSR report line on AOC-4 (s.135)                                                                                                                        |
| `secretarialAuditRequired`                                                       | **new**            | MR-3 line on AOC-4 (s.204)                                                                                                                              |
| `directors[].dscExpiresOn`                                                       | **new (Phase 2)**  | Warns before a DSC lapses on a due item                                                                                                                 |

The defaults follow today's rule: an attribute the profile lacks is treated as false.

---

## 5. Recurring items (Phase 1)

Each item lists who it applies to, its due date, what changes from today, and its checklist. In the
checklist tables:

- **Slot** is the document slot; with `autoTick: document` the line ticks when a file is uploaded.
- **Req** means the line must be ticked (or marked N/A with a reason) before the item can be closed.
- Every **filing** ends with the same last three lines. The tables show them as one row,
  _common tail_:

| Code     | Label                                           | Slot      | Req | autoTick |
| -------- | ----------------------------------------------- | --------- | --- | -------- |
| `DSC`    | Signed with DSC (director / designated partner) | —         | ✓   | —        |
| `REVIEW` | Review                                          | —         | ✓   | review   |
| `LODGE`  | Lodge (SRN)                                     | `ACK_ROC` | ✓   | lodge    |

The lodge form captures:

- the SRN, the date filed and the challan PDF;
- the **normal fee** and the **additional fee paid**, recorded as figures, so the late-fee estimate
  can be compared with what was actually paid.

### 5.1 AGM — `ROC_AGM` (meeting)

- **Applies to:** every company except an OPC (s.96).
- **Due:** within 6 months of the FY end, i.e. **30 Sep**. The gap from the last AGM must not exceed
  15 months. The ROC can extend the deadline by up to 3 months (not for the first AGM); that is
  Phase 2 (§7).
- **If no AGM is held**, AOC-4 and MGT-7 still run from the last date the AGM should have been held.
  The provisional date already does this, so keep it.
- **Change:** close as a meeting (P1-2). Closing it records the `agm` event (P1-3), with the flag
  _auditor appointed or re-appointed at this AGM_ (§6.2).

| Code             | Label                                                      | Slot               | Req | autoTick |
| ---------------- | ---------------------------------------------------------- | ------------------ | --- | -------- |
| `FS_APPROVED`    | Board approved the financial statements and board's report | `BOARD_MINUTES_FS` | ✓   | document |
| `NOTICE`         | AGM notice sent (21 clear days, s.101)                     | `AGM_NOTICE`       | ✓   | document |
| `AUDITOR_AGENDA` | Auditor appointment on the agenda (in a rotation year)     | —                  |     | —        |
| `MINUTES`        | AGM minutes and attendance                                 | `AGM_MINUTES`      | ✓   | document |
| `REVIEW`         | Review                                                     | —                  | ✓   | review   |
| `HELD`           | Record meeting (held on)                                   | `AGM_MINUTES`      | ✓   | lodge    |

### 5.2 Board meeting — `ROC_BOARD_MEETING` (meeting)

- **Applies to:** every company (s.173).
- **Due, general rule:** at least four meetings a year, no more than 120 days between two. Keep one
  item per FY quarter as the working reminder, due at the quarter end.
- **Due, small company / OPC (fix G6):** one meeting in each **half of the calendar year**, at least
  90 days apart. Replace the `period_filter: ['Q2','Q4']` variant with two calendar-half periods per
  FY: _Jul–Dec_ (due 31 Dec) and _Jan–Jun_ of the next year (due 30 Jun, `year_offset: 1`). FY 2026-27
  then holds _Jul–Dec 2026_ (due 31 Dec 2026) and _Jan–Jun 2027_ (due 30 Jun 2027).
  The engine's `half_yearly` periods are FY halves (Apr–Sep, Oct–Mar), so this needs a new
  calendar-half frequency with its own `period_start` / `period_end` and period keys (e.g. `CH2`,
  `CH1`). The held-on check (P1-2) depends on those period dates.
- **Phase 2:** show "next meeting due by" = last held-on date + 120 days (90-day minimum gap for
  small companies / OPCs), from the recorded meetings.

| Code         | Label                                     | Slot         | Req | autoTick |
| ------------ | ----------------------------------------- | ------------ | --- | -------- |
| `NOTICE`     | Notice and agenda sent (7 days, s.173(3)) | `BM_NOTICE`  | ✓   | document |
| `ATTENDANCE` | Quorum and attendance recorded            | —            |     | —        |
| `MINUTES`    | Signed minutes                            | `BM_MINUTES` | ✓   | document |
| `HELD`       | Record meeting (held on)                  | `BM_MINUTES` | ✓   | lodge    |

No review step; the minutes are the record.

### 5.3 AOC-4 — `ROC_AOC4` (financial statements)

- **Applies to:** every company (s.137).
- **Due:**
  - 30 days from the AGM;
  - OPC: 180 days from the FY end, i.e. 27 Sep (variant exists);
  - no AGM held: 30 days from the date it should have been held.
- **Form label:** _AOC-4_, or _AOC-4 XBRL_ when `xbrlRequired`. Add _+ CFS_ when `hasSubsidiaries`;
  the consolidated statements are filed on the same item, in their own slot.
- **Late fee:** ₹100 per day (P1-8).
- **Depends on:**
  - the AGM held (`AGM_HELD`, ticked from the event);
  - when the firm is also the statutory auditor, the audit report date in the Statutory Audit
    engagement. Show it read-only; do not block on it.

| Code           | Label                                                                              | Slot           | Req | autoTick |
| -------------- | ---------------------------------------------------------------------------------- | -------------- | --- | -------- |
| `FS_SIGNED`    | Signed financial statements (balance sheet, P&L, cash flow, notes)                 | `FS_SIGNED`    | ✓   | document |
| `AUDIT_REPORT` | Auditor's report, with CARO where it applies                                       | `AUDIT_REPORT` | ✓   | document |
| `BOARD_REPORT` | Board's report with annexures (AOC-1, AOC-2 …)                                     | `BOARD_REPORT` | ✓   | document |
| `CFS`          | Consolidated financial statements and auditor's report (`onlyIf: hasSubsidiaries`) | `CFS`          | ✓   | document |
| `CSR`          | CSR annual report (`onlyIf: csrApplicable`)                                        | `CSR_REPORT`   | ✓   | document |
| `MR3`          | Secretarial audit report MR-3 (`onlyIf: secretarialAuditRequired`)                 | `MR3`          | ✓   | document |
| `AGM_HELD`     | AGM held and accounts adopted (OPC: adopted by the member)                         | —              | ✓   | event    |
| `FORM`         | Form prepared, pre-scrutiny passed                                                 | `ROC_FORM`     | ✓   | document |
| `CERT`         | Certified by a practising CA (partner ticks; UDIN in the note)                     | —              | ✓   | —        |
| …              | _common tail_                                                                      |                |     |          |

### 5.4 MGT-7 / MGT-7A — `ROC_MGT7` (annual return)

- **Applies to:** every company (s.92).
- **Form label:** **MGT-7A for an OPC or a small company** (fix G4: add `eq('company_subtype','small')`
  to the variant's `when`, setting `form_label` only; the dates stay AGM-based for a small company).
  MGT-7 for all others.
- **Due:**
  - 60 days from the AGM;
  - OPC: 60 days from the date the AGM would have been held, i.e. 29 Nov (variant exists).
- **Late fee:** ₹100 per day.

| Code           | Label                                                                 | Slot       | Req | autoTick |
| -------------- | --------------------------------------------------------------------- | ---------- | --- | -------- |
| `AGM_HELD`     | AGM held (OPC: not applicable)                                        | —          | ✓   | event    |
| `SHAREHOLDERS` | Shareholder / debenture-holder list and transfers in the year         | `SH_LIST`  | ✓   | document |
| `MEETINGS`     | Board and committee meetings and attendance for the year              | —          |     | —        |
| `MGT8`         | MGT-8 by a CS in practice (`onlyIf: mgt8Required`; client dependency) | `MGT8`     | ✓   | document |
| `FORM`         | Form prepared, pre-scrutiny passed                                    | `ROC_FORM` | ✓   | document |
| …              | _common tail_                                                         |            |     |          |

`MEETINGS` can later be filled from the board-meeting items that were held in the FY.

### 5.5 ADT-1 — `ROC_ADT1` (auditor appointment)

- **Applies to:** a company that appoints or re-appoints its auditor at the AGM, normally once in
  five years (s.139). Also a casual vacancy, which is an event form (Phase 2).
- **Due:** 15 days from the AGM.
- **Change (fix G5):** drop the static `auditorAppointedAtAgm` condition. Create the item from the
  AGM event's flag _auditor appointed at this AGM_ (§6.2).
- **Late fee:** ₹100 per day (**Verify**: ADT-1 is a normal-fee form; the slab may apply instead).

| Code         | Label                                                           | Slot              | Req | autoTick |
| ------------ | --------------------------------------------------------------- | ----------------- | --- | -------- |
| `RESOLUTION` | Resolution appointing the auditor (term and remuneration)       | `RESOLUTION`      | ✓   | document |
| `CONSENT`    | Auditor's consent and eligibility certificate (s.139(1), s.141) | `AUDITOR_CONSENT` | ✓   | document |
| `INTIMATION` | Appointment letter to the auditor                               | —                 |     | —        |
| `FORM`       | Form prepared                                                   | `ROC_FORM`        | ✓   | document |
| …            | _common tail_                                                   |                   |     |          |

### 5.6 DPT-3 — `ROC_DPT3` (deposits and exempted loans)

- **Applies to:** companies with deposits, or with money received that is not a deposit and is still
  outstanding at 31 March (Rule 16, Acceptance of Deposits Rules). Not government companies, banks,
  NBFCs or housing finance companies.
- **Due:** **30 Jun**, with figures as at 31 March. FY 2025-26 was extended once to 31 Jul 2026 by
  MCA Circular 02/2026; record that as a `government_extensions` row, not in the rule.
- **Change (fix G7):** generate unless the profile says `depositsOrExemptedLoans === false`. An
  unknown value keeps the item, because many firms file nil out of caution. With the flag false, the
  item is not created; the lead can still add it.
  **Partner decision:** confirm that this is the firm's policy.

| Code           | Label                                                           | Slot               | Req | autoTick |
| -------------- | --------------------------------------------------------------- | ------------------ | --- | -------- |
| `SCHEDULE`     | Loans / receipts outstanding at 31 March (lender-wise schedule) | `DPT_DATA`         | ✓   | document |
| `AUDITOR_CERT` | Auditor's certificate (where deposits are held)                 | `DPT_AUDITOR_CERT` |     | document |
| `FORM`         | Form prepared                                                   | `ROC_FORM`         | ✓   | document |
| …              | _common tail_                                                   |                    |     |          |

### 5.7 MSME-1 — `ROC_MSME1` (dues to micro / small suppliers)

- **Applies to:** companies whose payment to a micro or small enterprise is more than 45 days late
  (`msmeDuesOver45Days`, s.405 order).
- **Due:** **31 Oct** for Apr–Sep and **30 Apr** for Oct–Mar (unchanged).

| Code        | Label                                                            | Slot        | Req | autoTick |
| ----------- | ---------------------------------------------------------------- | ----------- | --- | -------- |
| `MSME_LIST` | Supplier-wise dues over 45 days, with amounts, dates and reasons | `MSME_DATA` | ✓   | document |
| `FORM`      | Form prepared                                                    | `ROC_FORM`  | ✓   | document |
| …           | _common tail_                                                    |             |     |          |

### 5.8 PAS-6 — `ROC_PAS6` (share capital reconciliation)

- **Applies to:** unlisted public companies (Rule 9A(8)).
  **Verify** whether non-small private companies under Rule 9B must also file PAS-6; if so, extend
  the condition.
- **Due:** 60 days from each half-year end: **29 Nov** and **30 May** (unchanged).

| Code          | Label                                                | Slot        | Req | autoTick |
| ------------- | ---------------------------------------------------- | ----------- | --- | -------- |
| `RTA_DATA`    | Depository / RTA holding data for the half-year      | `PAS6_DATA` | ✓   | document |
| `CERT_REPORT` | Reconciliation report signed by a practising CA / CS | `PAS6_CERT` | ✓   | document |
| `FORM`        | Form prepared                                        | `ROC_FORM`  | ✓   | document |
| …             | _common tail_                                        |             |     |          |

### 5.9 DIR-3 KYC — `ROC_DIR3_KYC` (per DIN)

- **Applies to:** every DIN holder whose KYC cycle falls due.
- **Due:** **30 Jun**, once every three financial years. Per the calendar's read-me, MCA notified
  this on 31 Dec 2025 — **Verify**.
  - Example: a director whose cycle started in FY 2025-26 is next due **30 Jun 2028**. A unit test
    must confirm `isTriennialDue` gives exactly that.
- **If missed:** the DIN is deactivated, and a ₹5,000 fee is needed to reactivate it.
- **Closes:** with the SRN of DIR-3 KYC (e-form) or DIR-3 KYC-WEB (no change in details).

| Code       | Label                                                       | Slot       | Req | autoTick |
| ---------- | ----------------------------------------------------------- | ---------- | --- | -------- |
| `KYC_DOCS` | PAN, Aadhaar, address proof; mobile and e-mail OTP verified | `KYC_DOCS` | ✓   | document |
| `CERT`     | Certified by a practising professional (e-form only)        | —          |     | —        |
| …          | _common tail_ (DSC = the director's own DSC)                |            |     |          |

### 5.10 LLP Form 11 — `LLP_FORM11` (annual return)

- **Applies to:** every LLP.
- **Due:** within 60 days of the FY end, i.e. **30 May**.
- **Late fee:** ₹100 per day.
- **Certification:** **Verify** the current threshold for CS certification
  (contribution / turnover).

| Code       | Label                                           | Slot           | Req | autoTick |
| ---------- | ----------------------------------------------- | -------------- | --- | -------- |
| `PARTNERS` | Partners, contributions and changes in the year | `LLP_PARTNERS` | ✓   | document |
| `FORM`     | Form prepared                                   | `ROC_FORM`     | ✓   | document |
| …          | _common tail_ (DSC = designated partners)       |                |     |          |

### 5.11 LLP Form 8 — `LLP_FORM8` (statement of account and solvency)

- **Applies to:** every LLP.
- **Due:** within 30 days of six months from the FY end, i.e. **30 Oct**.
- **Late fee:** ₹100 per day.

| Code       | Label                                                                     | Slot           | Req | autoTick |
| ---------- | ------------------------------------------------------------------------- | -------------- | --- | -------- |
| `ACCOUNTS` | Signed statement of account; audit report where the LLP is audited        | `LLP_ACCOUNTS` | ✓   | document |
| `SOLVENCY` | Solvency declaration by the designated partners                           | —              | ✓   | —        |
| `CERT`     | Certified by a practising CA / CS / CMA (partner ticks; UDIN in the note) | —              | ✓   | —        |
| `FORM`     | Form prepared                                                             | `ROC_FORM`     | ✓   | document |
| …          | _common tail_                                                             |                |     |          |

---

## 6. Record an event (Phase 1)

### 6.1 Screen

- **Where:** a **Record event** button in the ROC tab header, shown to the engagement lead
  (`engagementManage`, which the API already requires).
- **The form:**
  - **Event** — ROC event types only (§7 list);
  - **Date** — not in the future;
  - **CIN / LLPIN** — defaults to the only one;
  - **FY** — defaults per the API: the event's FY, or the previous FY for an AGM;
  - **Notes**;
  - the event-specific details in §6.2.
- **On save:** show what changed, from the API's `RecordComplianceEventResult`. For example:
  _"3 items created: DIR-12 due 5 Dec 2026"_ or _"AOC-4 moved to 25 Oct 2026, MGT-7 to 24 Nov 2026"_.
- **Events list:** below the annual strip, list the FY's events (`GET …/compliance-events`) with
  their date, who recorded them, and the items they created.

### 6.2 Event details

| Event             | Extra fields                                            | Effect                                                           |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| `agm`             | _Auditor appointed / re-appointed at this AGM_ (yes/no) | Moves AOC-4 / MGT-7 / ADT-1. Yes → creates ADT-1 (fix G5).       |
| `allotment`       | _Private placement (s.42)_ (yes/no)                     | PAS-3 due in 15 days if yes, 30 days if not (**Verify**, §9).    |
| `director_change` | DIN, appointed / ceased                                 | DIR-12. Also updates `directors[]` on the CIN profile (Phase 2). |
| `charge_creation` | Charge holder, amount                                   | CHG-1.                                                           |
| others            | —                                                       | as listed in §7                                                  |

The API takes the extra fields in a new `details` JSON on `compliance_events`. The generator reads
them when it builds the event items.

### 6.3 Corrections

A wrong date has to be fixable. Add:

- `PATCH /engagements/:id/compliance-events/:eventId` (date, details);
- `DELETE /engagements/:id/compliance-events/:eventId` (reason required).

Both are audited and both re-run the generator:

- items that have not been started move, or become not applicable;
- items already started are flagged _Profile changed — check_, as the generator already does.

---

## 7. Event-based forms (Phase 2)

Each event form gets its own checklist (`FILING_<RULE_CODE>`). Every filing uses the common tail
from §5.

| Rule              | Event → form                                    | Due                                                                     | Checklist (before the common tail)                                                                                                                                      |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROC_FIRST_BOARD` | Incorporation → first board meeting _(meeting)_ | 30 days                                                                 | Notice; minutes; first auditor appointed (s.139(6))                                                                                                                     |
| `ROC_FIRST_ADT1`  | First auditor appointed → ADT-1                 | 15 days (**Verify** whether the firm files ADT-1 for the first auditor) | Board resolution; auditor's consent and eligibility                                                                                                                     |
| `ROC_INC20A`      | Incorporation → INC-20A                         | 180 days                                                                | Subscription money received (bank statement); registered office verified                                                                                                |
| `ROC_FIRST_AGM`   | First FY end → first AGM _(meeting)_            | 9 months                                                                | As the AGM in §5.1 (no ROC extension allowed)                                                                                                                           |
| `ROC_DIR12`       | Director appointed / ceased → DIR-12            | 30 days                                                                 | Appointment: DIR-2 consent, DIR-8, resolution. Cessation: resignation letter, proof of delivery, resolution.                                                            |
| `ROC_PAS3`        | Allotment → PAS-3                               | 15 days (private placement) / 30 days (other) — **Verify**              | Board resolution; list of allottees; valuation report (where needed); bank proof of money received; PAS-4 / PAS-5 (private placement)                                   |
| `ROC_INC22`       | Registered office changed → INC-22              | 30 days                                                                 | Board resolution; proof of the office (rent agreement / ownership); NOC; utility bill                                                                                   |
| `ROC_MGT14`       | Resolution passed → MGT-14                      | 30 days                                                                 | Certified copy of the resolution; explanatory statement; notice. Private companies are exempt for some s.179(3) board resolutions; let the lead mark N/A with a reason. |
| `ROC_CHG1`        | Charge created / modified → CHG-1               | 30 days; extendable by a further 60 days with additional fee            | Charge instrument; sanction letter; charge holder's signature                                                                                                           |
| `ROC_SH7`         | Capital altered → SH-7                          | 30 days                                                                 | Ordinary resolution; altered MoA                                                                                                                                        |

Also in Phase 2:

| #    | Work                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 | Event forms above, with their checklists.                                                                                                                                                              |
| P2-2 | **AGM extension** event (ROC approval, up to 3 months, not the first AGM): moves the AGM due date and the AGM-linked provisional dates.                                                                |
| P2-3 | **CHG-1 extension window:** show "late, within the fee window" between day 31 and day 90, and "beyond the window" after that.                                                                          |
| P2-4 | **Normal-fee table** by authorised capital, and the slab of multiples for late filing of normal-fee forms. Needs `authorisedCapital` on the CIN profile. **Verify** the current slabs before building. |
| P2-5 | DSC expiry per director (`directors[].dscExpiresOn`), warned on due items.                                                                                                                             |
| P2-6 | "Next board meeting due by" from the held-on dates (§5.2).                                                                                                                                             |

**Not in this spec:** CSR-2, BEN-2, CHG-4 (charge satisfaction), CRL-1, NFRA-2, INC-22A, MGT-15. They
are not in the calendar; add them later in the same pattern.

---

## 8. Worked examples (acceptance tests)

All examples are for a company with a 31 March year-end, inside the calendar's window
(Oct 2026 – Sep 2027).

| #   | Setup                                                                   | Expected                                                                                                           |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| E1  | Private company, FY 2025-26, nothing recorded                           | AOC-4 due **30 Oct 2026**, MGT-7 due **29 Nov 2026** (provisional AGM 30 Sep 2026). No ADT-1.                      |
| E2  | E1, then record AGM held **30 Sep 2026**, auditor appointed = yes       | ADT-1 created, due **15 Oct 2026**. AOC-4 and MGT-7 dates unchanged, now not provisional.                          |
| E3  | E1, then record AGM held **25 Sep 2026**                                | ADT-1 (if flagged) due **10 Oct 2026**, AOC-4 due **25 Oct 2026**, MGT-7 due **24 Nov 2026**.                      |
| E4  | OPC, FY 2025-26                                                         | No AGM item. AOC-4 due **27 Sep 2026** (180 days from 31 Mar). Form label **MGT-7A**, due **29 Nov 2026**.         |
| E5  | Small company, FY 2025-26, AGM 30 Sep 2026                              | Form label **MGT-7A**, due **29 Nov 2026**.                                                                        |
| E6  | Small company, FY 2026-27                                               | Board-meeting items _Jul–Dec 2026_ due **31 Dec 2026** and _Jan–Jun 2027_ due **30 Jun 2027**. No quarterly items. |
| E7  | Private company, board meeting held **15 May 2026**                     | Records against Apr–Jun 2026 (held-on date ≥ period start). Shows _Held_. No SRN asked.                            |
| E8  | `msmeDuesOver45Days` = true                                             | MSME-1 due **31 Oct 2026** (Apr–Sep) and **30 Apr 2027** (Oct–Mar).                                                |
| E9  | Unlisted public company                                                 | PAS-6 due **29 Nov 2026** and **30 May 2027**.                                                                     |
| E10 | FY 2026-27, `depositsOrExemptedLoans` unknown / false                   | DPT-3 due **30 Jun 2027** / not created.                                                                           |
| E11 | LLP                                                                     | Form 8 (FY 2025-26) due **30 Oct 2026**; Form 11 (FY 2026-27) due **30 May 2027**.                                 |
| E12 | Director with `kycCycleStartFy` 2025-26                                 | No DIR-3 KYC for FY 2026-27; next due **30 Jun 2028**.                                                             |
| E13 | Record a director appointed **5 Nov 2026**                              | DIR-12 due **5 Dec 2026**.                                                                                         |
| E14 | Record an allotment **10 Nov 2026**, private placement = yes / no       | PAS-3 due **25 Nov 2026** / **10 Dec 2026**.                                                                       |
| E15 | Record a charge created **1 Dec 2026**                                  | CHG-1 due **31 Dec 2026**.                                                                                         |
| E16 | AOC-4 for E1 lodged on **9 Nov 2026**                                   | Late by 10 days; estimate **₹1,000** additional fee.                                                               |
| E17 | Lodge the AGM item with held-on 30 Sep 2026                             | Creates the `agm` event. AOC-4's `AGM_HELD` line ticks itself.                                                     |
| E18 | Correct the AGM date in E3 to 28 Sep 2026; AOC-4 already in preparation | MGT-7 (not started) moves to **27 Nov 2026**. AOC-4 keeps its date and is flagged _Profile changed — check_.       |

---

## 9. Verify before release

These come from secondary sources or have changed recently. A partner confirms each against the
official text, and the rule is tagged `verification: 'verify'` until then.

| #   | Item                                                                                            | Why                                                               |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| V1  | PAS-3: 15 days (private placement, s.42(8)) vs 30 days (other allotments, s.39(4) / Rule 12)    | The calendar says 15 days for all allotments; the portal says 30. |
| V2  | DIR-3 KYC once every three years (MCA notification, 31 Dec 2025) and the exact cycle arithmetic | New rule.                                                         |
| V3  | Late-fee slabs for normal-fee forms (ADT-1, DIR-12, PAS-3, MGT-14, DPT-3 …)                     | Companies (Registration Offices and Fees) Rules, as amended.      |
| V4  | XBRL and MGT-8 thresholds                                                                       | Thresholds change by notification.                                |
| V5  | PAS-6 for non-small private companies under Rule 9B                                             | Unclear.                                                          |
| V6  | ADT-1 for the first auditor                                                                     | Practice varies.                                                  |
| V7  | CS-certification threshold for LLP Form 11                                                      | Threshold check.                                                  |
| V8  | DPT-3: nil filing policy (§5.6)                                                                 | Firm policy, not law.                                             |

---

## 10. Workflow recap for each item

- **Assign:** a lead assigns a preparer and a reviewer from the workspace. The task carries the
  clock, as today.
- **Prepare:** the preparer uploads into the slots and ticks the manual lines. Client-side items
  (director's DSC, MGT-8, MR-3, client documents) are raised as client dependencies, and the item
  shows _awaiting data_ until they arrive.
- **Review:** the reviewer approves; `REVIEW` ticks itself.
- **Certify:** where a line says _partner ticks_, only a partner can tick it, and the note must carry
  the UDIN.
- **Close:**
  - **Filings:** the preparer or the lead lodges with the SRN, the date filed, the challan and the
    fees paid.
  - **Meetings:** the preparer or the lead records the held-on date and the minutes.

  Undoing a close follows today's rule (the lead within 24 hours, a partner after that).

- **Activity:** the timeline shows events recorded, dates moved, and each lodge, with its SRN.
