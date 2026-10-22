# Accountant + HR roles — build plan (3 sessions)

Spec: `docs/accountant-hr-roles-spec.md` (on main 49ab82d). This plan splits
phases 0, 1 and 2 of that spec between three Claude sessions working in
parallel, and fixes the interfaces between them so nobody waits on anybody
more than once.

## Partner decisions (spec §9) — the defaults we build

The partners haven't answered §9 yet, so we build the **recommended** answers.
Each one sits behind a setting or a single code path, so a different answer
later is a small change.

| # | Built as |
| --- | --- |
| 1 | Firm-wide roles (no office-scoped variant). |
| 2 | Labels "Accountant" and "HR". |
| 3 | An ad-hoc invoice (no fee milestone, retainer period or billable time behind it) needs `billing.approve` to issue; the Accountant uses *request issue*. |
| 4 | `fee.agree` for Partner and Managing Partner only. |
| 5 | Administrator **keeps** `employee.manage` for now (removing it is a later one-line migration once HR is staffed). |
| 6 | Everyone sees their own attendance. |
| 7 | Managers don't see team attendance (phase 3). |
| 8 | Receivables scoping unchanged. |
| 9 | Payroll runs in the portal. |
| 10 | HR prepares statutory working, MP approves, Accountant pays and records the challan. |
| 11 | Pay visible to HR, MP and the person only. |
| 12 | MP approves payroll; one named alternate approver in pay settings. |
| 13 | Stipend: no PF/ESI/PT by default (setting). |
| 14 | Partners' remuneration stays out of payroll. |

## Who builds what

| Session | Track | Worktree / branch (base: `feat/roles-p0`) |
| --- | --- | --- |
| **dhvaj portal coordination** | **Phase 0** (foundation everyone builds on) → **Payroll 2a** → integration, dev DB, final checks | `deploy-blockers` · `feat/roles-p0`, then `feat/payroll-core` |
| **DHVAJ portal features assessment** | **Accountant track**: phase 1 + phase 2c (finance) → then **Payroll 2b** (tax + exit) | own worktree · `feat/accountant-desk` → `feat/payroll-tax-exit` |
| **office 365** | **HR track**: phase 1 + phase 2c (articleship, HR documents vault) | own worktree · `feat/hr-desk` |

Mobile parity (spec §3.6, §4.6, payslips) comes after the web is merged and is
coordinated separately.

### Phase 0 — coordination (do not duplicate; build on it)

- Migration `1772400000000_accountant_hr_roles.sql`:
  - `roles`: `accountant`, `hr`.
  - New permissions: `entity.read_billing`, `engagement.read_commercial`,
    `fee.agree`, `user.onboard`, `report.read_people`, `time.read_attendance`,
    `payroll.prepare`, `payroll.read`, `payroll.approve`,
    `payroll.read_summary`, `payroll.read_own`.
  - Grants: Accountant = `billing.manage`, `entity.read_billing`,
    `engagement.read_commercial`, `notification.read`, `payroll.read_summary`,
    `payroll.read_own`, `office.read`. HR = `employee.read`, `employee.manage`,
    `user.read`, `user.onboard`, `office.read`, `report.read_people`,
    `time.read_attendance`, `payroll.prepare`, `payroll.read`,
    `notification.read`, `payroll.read_own`. Partner + MP gain `fee.agree`; MP
    gains `entity.read_billing`, `engagement.read_commercial`,
    `report.read_people`, `time.read_attendance`, `payroll.read`,
    `payroll.approve`, `payroll.read_summary`; every role gains
    `payroll.read_own`.
  - `hsdg.ctx_roles()` (text[]), `hsdg.ctx_has_role(text)`,
    `hsdg.ctx_is_finance()` (= accountant), `hsdg.ctx_is_people_ops()` (= hr),
    `hsdg.ctx_is_desk_only()` (highest role is a desk role).
  - `hsdg.ctx_can_bill(entity)` and `ctx_may_bill_engagement` → also true for
    `ctx_is_finance()`; finance may read `engagement_fee_milestones` and the
    26AS import batches.
  - Employee master (`employees`, `partner_profiles`) and logins (`users`,
    `user_roles`) open to `ctx_is_people_ops()`; writes to a login only via
    `ctx_may_onboard_user()` (not self, nothing above Manager) and role grants
    only of Article / Senior / Manager.
  - RESTRICTIVE `<table>_no_desk` (TO hsdg_app) on the client master —
    `entities`, `clients`, `entity_groups` and the eight `entity_*` detail
    tables: a desk-only user reads and writes none of it. Billing reads client
    names through definer views (owner `hsdg_migrator`), which it does not reach.
- API: `RLS_SETTINGS.roles = 'hsdg.roles'` (comma list) set on every
  transaction from `Principal.roles`; `RlsContext.roles?: string[]`.
- Contracts: `ROLE.accountant`, `ROLE.hr`, in `ASSIGNABLE_ROLES` and at the
  end of `ROLE_PRECEDENCE`; `PERMISSION.*` for every new slug;
  `ONBOARD_ASSIGNABLE_ROLES = [article, senior, manager]`.
- `fee.agree` split: fee-milestone create/cancel need `fee.agree`.
- `user.onboard` ceiling in `IdentityService` (spec §7.5) for create user,
  edit, roles, password set/reset/remove, deactivate.
- Web nav: sections and routes below (pages may be placeholders until the
  owning track fills them); `landingPath` → `/accounts` for accountant-only,
  `/people` for hr-only; Billing gated by `billing.manage` or `report.read`.
- e2e fixtures: personas `accounts@dhvaj.in` (accountant) and `hr@dhvaj.in`
  (hr) in the seed and in `seedIdentityFixtures`.

### Routes and API surface (owner in brackets)

Web routes (nav entries added in phase 0):

| Route | Owner |
| --- | --- |
| `/accounts` Accounts desk | assessment |
| `/billing/approvals` Approvals sent | assessment |
| `/billing/statements`, `/billing/statements/[clientId]` Client statements | assessment |
| `/reports/finance` (GST outward register, books export, bank match) | assessment |
| `/people` People desk | office 365 |
| `/people/employees`, `/people/employees/[id]` (tabs: Profile, Articleship, Portal login, Hours, Salary*, Bank & IDs*) | office 365 (*Salary/Bank tabs: coordination) |
| `/people/articles`, `/people/joiners-leavers`, `/people/attendance`, `/people/workload` | office 365 |
| `/people/documents` HR documents vault | office 365 |
| `/payroll`, `/payroll/runs/[id]`, `/payroll/structures`, `/payroll/statutory`, `/payroll/settings`, `/payroll/registers` | coordination |
| `/payroll/declarations`, `/payroll/exits` | assessment (2b) |
| `/me/pay` (payslips, structure, Form 16, bank change), `/me/attendance` | coordination (`/me/attendance`: office 365) |

API modules: assessment → `billing` (extend) + new `accounts`; office 365 →
new `people` (+ `identity` UI calls only); coordination → new `payroll`.
`GET /payroll/runs/totals` (`payroll.read_summary`) is the Accountant's
"Payroll to book" feed — coordination provides it.

## Rules that keep three sessions from colliding

- **Migration timestamps:** coordination `17724…`, assessment `17725…`,
  office 365 `17726…`. Never outside your range.
- **e2e scratch DBs** (each creates its own once:
  `docker exec hsdg-postgres psql -U postgres -c "CREATE DATABASE <name> OWNER hsdg_migrator"`):
  coordination `hsdg_e2e_coord`, assessment `hsdg_e2e_fin`, office 365
  `hsdg_e2e_hr`. Put all three URLs inline in every e2e command, plus
  `--runInBand`. **Never** run e2e against the dev DB `hsdg`.
- **Dev DB `hsdg`:** only coordination migrates it, at integration, after a
  backup.
- **Shared files:** `packages/contracts/src/identity.ts`, `apps/web/src/lib/nav.ts`,
  `database.service.ts`, `rls-context.ts` and the e2e identity fixtures belong
  to phase 0. Ask coordination for a change instead of editing them.
- **Branches are local** (all worktrees share one repo). Base on
  `feat/roles-p0` once coordination says it's ready; commit often; tell
  coordination the branch and SHA when a slice is green. Coordination merges
  into `feat/finance-hr-roles` and the user pushes it.
- **Done for a slice** = API + web + tests (unit, web, RLS e2e incl. negative
  cases from spec §7.9/§8) green, `npm run lint` + `npm run typecheck` clean.
- No `.env` reads, no secrets in code or chat, no force-push / rebase of shared
  branches / bare `git stash`.
