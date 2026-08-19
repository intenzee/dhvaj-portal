# ADR-0008 — Engagement Core & Assignment-Based Access

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase:** 5 (Engagement Core)

## Context

The engagement is the system's central transactional object. It also forces the
security model to evolve: until now access was office-scoped, but the brief is
explicit that access to engagement/client work is by **explicit assignment**
(EP, manager, team) and that people are **shared across partners and offices**,
not bound by reporting lines or office.

## Decisions

### 1. Engagement identity and accountability

Identity = **Entity + Service + Financial Year + Period** (a unique constraint;
office is deliberately not part of identity). Recurring work links to its
predecessor. Exactly one accountable **Engagement Partner** — enforced by a
`CHECK` that an accepted (or later) engagement must have an EP. The manager and a
per-engagement **team** (shared resources) round out the people.

### 2. The security context carries the acting employee

RLS previously knew the user, role and office. Engagement access needs the
acting person's **employee id**, so `hsdg.employee_id` is added to the
transaction context (loaded from `employees.user_id` at authentication). Users
without an employee record simply match no assignments.

### 3. Assignment-based RLS, and breaking policy recursion

An engagement is visible to firm-wide roles, or to its EP / manager / team
member — independent of office. Deciding this requires cross-referencing
`engagements` and `engagement_team`, which makes their policies mutually
recursive. We break the recursion with **`SECURITY DEFINER` helper functions**
(`is_engagement_lead`, `is_engagement_member`) owned by the migrator, over
engagement tables that run **`ENABLE` — not `FORCE`** RLS: the owner bypasses RLS
*inside the helper*, so there is no policy recursion. The app role is never the
owner, so it stays fully governed. (The migrator is used only for migrations,
never at runtime, so dropping `FORCE` on these two tables changes nothing at
runtime.)

Assignment also **grants access to the client entity and to co-workers** on the
engagement: `entities_select` and `employees_select` are extended with
`SECURITY DEFINER` helpers so a cross-office team member can see the client and
roster — otherwise the engagement's joins would drop for them.

### 4. Governance: EP reassignment needs firm-wide authority

`engagements_update` (USING/​WITH CHECK) requires the caller to remain the EP or
manager — so reassigning the EP *away from oneself* is only possible firm-wide
(MP/admin), a deliberate accountability control. It is a dedicated audited
command (`engagement.ep_changed`).

## Subtle bug found & fixed: SECURITY DEFINER + `INSERT … RETURNING`

`INSERT … RETURNING` applies the **SELECT** policy to the new row. Our first
`engagements_select` used only the STABLE `SECURITY DEFINER` `is_engagement_member`,
which evaluates against the statement-start snapshot — so it **could not see the
row being inserted**, and every create failed with an RLS violation (while raw
inserts *without* RETURNING passed, which is what made it baffling). Fix:
`engagements_select` checks the EP/manager via **inline column comparisons**
(which see the new row) alongside the team subquery. (This is also why Phase 3's
entity create worked: `entities_select` had an inline office-column check.)

## Post-phase review

- **Fixed:** `?mine=true` used `ctx.employeeId ?? ''`, and `''::uuid` throws — a
  user with no employee link would get a 500. Now coalesced to `null` (no
  matches, no error).
- **Deferred (scale):** the assignment `SECURITY DEFINER` policies add per-row
  cost for cross-office reads (they run only when the cheaper office check fails,
  thanks to `OR` short-circuiting). A materialized access table can optimise this
  later; correctness first.

## Consequences

- A senior can work under different partners on different engagements, across
  offices, seeing exactly the engagements they're assigned to — proven at the
  database layer, independent of the API.
- Later phases (lifecycle Phase 6, reviews Phase 7, …) attach to the engagement
  and inherit this access model.
