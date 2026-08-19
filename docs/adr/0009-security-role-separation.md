# ADR-0009 — Security Role Separation (business vs platform administration)

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase:** Post-Phase-5 checkpoint (before Phase 6)

## Context

The Phase 0–5 architecture & security checkpoint found that `ctx_is_firmwide()`
treated three roles identically:

```sql
ctx_is_firmwide() := ctx_role() IN ('system', 'managing_partner', 'admin')
```

`admin` is intended as a **technical/platform** administrator (user provisioning,
office/HR administration, service-catalogue configuration, audit review). But
because a single predicate gated every table, a platform admin had **automatic
firm-wide read *and write* over all professional/client/engagement data**. Probed
live: `role=admin` saw every engagement, every client entity, and could
create/modify/reassign them (it also held `entity.manage` + `engagement.manage`).

This conflated two different kinds of authority. The firm requires:

- **`managing_partner`** = **business firm-wide** authority (all client and
  engagement work).
- **`admin`** = **technical administration only** — never automatic access to
  client working papers or engagements.

## Decision

Introduce a **second predicate** for professional data and repoint only those
policies to it; leave administrative/identity/config/audit policies on the
existing predicate. This is a rule change, **not** an architecture change — RLS
still lives in the database and access is still assignment-based.

```sql
-- Professional data (clients + engagements): Managing Partner only.
ctx_is_business_firmwide() := ctx_role() = 'managing_partner'

-- Administrative surface (identity, HR, offices, catalogue config, audit read):
-- unchanged — still system / managing_partner / admin.
ctx_is_firmwide()          := ctx_role() IN ('system','managing_partner','admin')
```

**Repointed to `ctx_is_business_firmwide()`** (migration 0009):
`engagements_{select,insert,update,delete}`, the `is_engagement_lead` helper
(root of the `is_engagement_member` → `can_access_entity_via_engagement` /
`shares_engagement_with` chain), `entities_{select,insert,update,delete}`,
`entity_registrations_all`, `entity_contacts_all`.

**Left on `ctx_is_firmwide()`** (admin's legitimate surface): `users_*`,
`user_roles_*`, `offices_write`, `employees_*`, `partner_profiles_*`,
`services_write`, `service_lines_write`, `audit_select`.

**`system` is deliberately excluded from business-firm-wide.** It is the synthetic
auth-bootstrap context (`IdentityService.systemContext`) used only to load a
principal; it reads identity tables, never client/engagement data.

**Defence in depth.** The `admin` role also loses the `entity.read`,
`entity.manage`, `engagement.read`, `engagement.manage` permissions, so those
endpoints are refused at the API layer as well as the data layer.

### SECURITY DEFINER execute hardening (folded into the same migration)

The four `SECURITY DEFINER` helpers had a latent `EXECUTE` grant to `PUBLIC`
(unreachable only because `PUBLIC` lacks `USAGE` on schema `hsdg`). Migration 0009
`REVOKE`s `EXECUTE ... FROM PUBLIC` and `GRANT`s it explicitly to `hsdg_app`.

## Consequences

- A platform admin can administer users, HR, offices, the catalogue and read the
  audit trail, but sees **zero** engagements it is not assigned to and **no**
  client data firm-wide (at the DB layer it is reduced to its own office; at the
  API layer the endpoints are blocked outright). Verified live and in tests.
- The Managing Partner remains business firm-wide; EP/manager/team assignment
  access is unchanged; the cross-office shared-resource model still holds.
- Reversible: migration 0009 down→up verified in place. No existing test
  depended on admin's business access; new negative tests lock the boundary in
  (`rls.e2e` role-separation block, codified SECURITY DEFINER side-channel test,
  and API-layer 403s for admin on `/entities` and `/engagements`).

## Follow-ups (not in this change)

- If a client portal is ever introduced, `Client User` needs its **own** role and
  RLS lane designed deliberately — never retrofitted onto staff predicates.
- Phase 6 lifecycle-transition permissions must be defined on top of this
  separation (do not grant engagement state control to the platform admin).
