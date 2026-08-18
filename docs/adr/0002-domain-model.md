# ADR-0002 — Target Domain Model

- **Status:** Accepted (reference model; implemented incrementally per phase)
- **Date:** 2026-08-18
- **Phase:** 0 (documented now; **no domain tables created in Phase 0**)

## Context

This ADR captures the *target* conceptual domain model so that every later
phase builds toward a coherent whole. It is a reference, not a schema dump.
Tables, constraints, indexes and RLS policies are introduced phase-by-phase.

## Core shape

```
ORGANISATION
 ├── Offices
 ├── Users ── Roles ── Permissions
 ├── Employees (Partner / Manager / Senior / Article) ── Grades
 └── ENTITIES (clients)
      ├── Registrations (PAN, CIN/LLPIN, GST, others)
      ├── Contacts / Signatories
      ├── Related / Group entities
      └── SERVICES (catalogue: Service Line → Service, review rules, workflow family)
           └── ENGAGEMENT  ◄── the central transactional object
                ├── Engagement Partner (exactly one, accountable)
                ├── Engagement Manager
                ├── Team (shared resources, engagement-specific)
                ├── Review Plan (Manager / Key-Matter / Full EP review)
                ├── Workflow (service-specific states)
                ├── Tasks
                ├── Compliance instances (statutory deadline + internal SLA)
                ├── Client dependencies (waiting-for-client)
                ├── Documents (metadata → Azure Blob)
                └── Audit trail
```

## Key modelling rules (non-negotiable)

1. **One accountable EP per accepted engagement.** Enforced by schema (NOT NULL
   FK once accepted) and business rules. The EP is accountable end-to-end but
   need not personally perform every review.
2. **Shared resources.** A manager/senior/article can serve multiple partners.
   Assignment is *engagement-specific*; organisational reporting lines do **not**
   determine engagement access. Access is via explicit assignment + RLS.
3. **Engagement identity = Entity + Service + Financial Year + Period.** Office
   is **not** part of identity. A unique constraint prevents unintended
   duplicates. Recurring work creates a *successor* engagement with a
   predecessor link.
4. **Universal lifecycle vs service workflow are separate.** Lifecycle:
   `PROSPECT → PENDING_ACCEPTANCE → ACCEPTED → ACTIVE → COMPLETED → CLOSED`
   (+ `ON_HOLD, DECLINED, WITHDRAWN, CANCELLED`). Service workflow (e.g. audit
   planning→fieldwork→review→EP sign-off) is configurable and orthogonal.
5. **Review models are configuration.** A service declares permitted review
   models; the system must never allow a lower model than the service requires
   (e.g. cannot complete a statutory audit without EP sign-off when Full EP
   Review is required).
6. **Compliance is effective-dated and versioned.** Each compliance instance
   stores the rule version used; changing a future rule never rewrites history.
   Statutory deadline and HSDG internal SLA are two separate clocks.
7. **Audit is immutable.** Material events (creation, acceptance, EP change,
   assignment, review, sign-off, completion, closure, reopen, compliance
   override, master-data change, document download, config change) are recorded
   with actor, timestamp, action, object, before/after, reason and correlation
   id. Normal users cannot modify audit history.

## Conventions

- **UUID** public identifiers (`gen_random_uuid()` via pgcrypto).
- **Timestamps** `created_at` / `updated_at` (UTC) everywhere; optimistic
  concurrency where appropriate.
- **Soft delete / archive** for important master data; professional evidence is
  never hard-deleted.
- **Enums as configuration/lookup** rather than magic strings.
- Every protected table gets RLS with `FORCE ROW LEVEL SECURITY` and both
  positive and negative access tests.

## Phase mapping (where each part lands)

| Area | Phase |
| --- | --- |
| Users, Roles, Permissions, Offices, RLS context/policies | 1 |
| Partners, Managers, Seniors, Articles, Employees, Grades | 2 |
| Entities, Registrations, Contacts, Related entities | 3 |
| Service Line, Service, review rules, workflow family | 4 |
| Engagement, EP, Manager, Team, Review Plan, identity | 5 |
| Lifecycle state machine + guarded transitions | 6 |
| Review & sign-off engine | 7 |
| Compliance rules/instances/overrides | 8 |
| Tasks & client dependencies | 9 |
| Documents (Blob + audited access) | 10 |
| Notifications | 11 |

## Consequences

Building to this reference keeps the engagement as the stable center of gravity,
makes accountability and review controls first-class, and ensures compliance and
audit are correct-by-construction rather than bolted on.
