# ADR-0024 — Multi-Service Engagements (`engagement_services`)

- **Status:** Proposed (awaiting approval)
- **Date:** 2026-08-27
- **Phase:** Service Configuration spec — Multi-Service re-architecture (§2, §9–§10, §27, §30, §36, §38)

## Context

The engagement model to date is **one engagement = one service**: identity is
`entity + service_id + FY + period`, and every downstream object hangs off that
single `engagements.service_id`:

- `service_components.service_id` → the service that owns a component;
- `engagement_components` are guarded by `enforce_engagement_component_service`
  so a configured component's service must equal the engagement's `service_id`;
- `component_instances` → `engagement_component_id`;
- the engagement detail query `JOIN hsdg.services s ON s.id = eng.service_id`.

The spec (§9–§10, §38 "PictureTime") requires **one engagement to carry several
services** — e.g. *GST + TDS + Accounting* for the same client, FY and period,
each with its own components, owner, office and lifecycle. There is no
`engagement_services` table, so this is impossible today. §27 (per-service page)
and §30 (entity-level scope within a group) both depend on this table existing.

This is the **structural spine** the rest of the spec breadth hangs on. It must
be delivered **additively** — the ~600 existing single-service engagements, their
RLS, the component/compliance engines and the test suite must keep working
unchanged at every commit. ADR-0022 already pre-committed the path: *"When the
multi-service engagement lands, `engagement_components` gains an
`engagement_service_id` and the model generalises without a rewrite."*

## Decisions

### 1. New table `hsdg.engagement_services` — the service-line grain

One row per service carried by an engagement. This becomes the object §27's
per-service page renders and §36 names.

```
engagement_services (
  id                uuid pk,
  engagement_id     uuid  → engagements(id) ON DELETE CASCADE,
  service_id        uuid  → services(id)    ON DELETE RESTRICT,
  office_id         uuid  → offices(id)      -- servicing office, per service
  lead_employee_id  uuid  → employees(id)    -- service lead (optional; defaults to EP)
  status            text  -- prospect/active/on_hold/completed/cancelled  (mirrors engagement)
  -- Denormalised identity columns, kept in sync by trigger from the parent
  -- engagement, so uniqueness (§16/§35) can be a single unique index:
  entity_id         uuid  NOT NULL,
  financial_year    text  NOT NULL,
  period_label      text  NOT NULL,
  version, created_at, updated_at
)
```

- **Duplication prevention (§16/§35) at the service grain:** Postgres cannot
  build a unique index across a join, so `entity_id / financial_year /
  period_label` are **denormalised onto the row** and synced by a trigger from
  the parent engagement. Then a single partial unique index enforces the spec's
  identity — *no two live service rows for the same entity + service + FY +
  period* — across the whole firm:

  ```
  UNIQUE (entity_id, service_id, financial_year, period_label)
    WHERE status NOT IN ('cancelled')
  ```

- **RLS:** reuses the existing `is_engagement_member` / `is_engagement_lead`
  SECURITY DEFINER helpers keyed on `engagement_id` — members read, leads write.
  Zero new policy recursion; identical floor to `engagement_components`.

### 2. Additive migration — backfill from the current single service

The migration is **strictly additive** and self-consistent:

1. Create `engagement_services` (+ indexes, trigger, RLS).
2. **Backfill:** `INSERT … SELECT id, service_id, office_id, engagement_partner_id,
   mapped-status, entity_id, financial_year, period_label FROM engagements` — one
   `engagement_services` row per existing engagement, derived entirely from
   columns that already exist. After this step the new table is a faithful
   superset of today's reality; nothing else changes.
3. `engagements.service_id` is **kept, not dropped** — it becomes the
   *primary/legacy service pointer*. Existing reads keep working. A later
   cleanup phase can retire it once every reader moves to `engagement_services`.
   (Additive-safety: never drop a column in the phase that stops needing it.)

### 3. Re-point components to the service-line grain

`engagement_components` gains a nullable `engagement_service_id` →
`engagement_services(id)`:

1. Add the column (nullable).
2. Backfill it: for each `engagement_component`, set it to the single
   `engagement_services` row of its engagement (there is exactly one after §2's
   backfill).
3. Replace the guard trigger: `enforce_engagement_component_service` currently
   joins `engagements e ON e.service_id = sc.service_id`. The new guard joins
   `engagement_services es ON es.service_id = sc.service_id AND es.id =
   NEW.engagement_service_id AND es.engagement_id = NEW.engagement_id` — a
   component must belong to the service of *its* engagement-service row, and that
   row must belong to the stated engagement.
4. `engagement_id` stays on `engagement_components` as a denormalised convenience
   (RLS and existing queries key on it); a CHECK/trigger keeps it equal to
   `engagement_service.engagement_id`. The column becomes NOT NULL in a
   **follow-on** migration once all writers set it — not in this one.

`component_instances` is untouched — it already hangs off
`engagement_component_id`, which now transitively carries the service.

### 4. Engagement identity relaxes; service identity takes over

`engagements_identity_unique UNIQUE (entity_id, service_id, FY, period)` is
**dropped** and replaced by the `engagement_services` partial unique index in §1.
An engagement is now identified by `entity + FY + period`; each *service* under
it is unique by `entity + service + FY + period`. This preserves the exact §35
guarantee at the correct (service) grain while allowing GST + TDS + Accounting to
coexist. `translatePgError` gains the new constraint name so the API still
returns a clean 409 on duplicate.

### 5. Group / multi-entity (§5–§6, §30) is a **separate follow-on axis**

Group engagements (one engagement spanning several entities) change the *entity*
key, not the *service* key — an orthogonal change. This ADR deliberately scopes
to **multi-service only**. The denormalised `entity_id` on `engagement_services`
is the natural seam the group work will later generalise (entity moves from the
engagement to the service row). Called out here so the schema choices don't
foreclose it; not implemented in this phase.

## Rollout (one part at a time, reported after each)

- **A. Migration** `1757700000000_engagement_services.sql` — table + backfill +
  component re-point + identity swap, with a matching Down. Verified against a
  fresh migrate + the existing seed.
- **B. API read path** — engagement detail returns a `services[]` array
  (backward-compatible: `serviceId`/`serviceName` stay, sourced from the primary
  row). New `GET /engagements/:id/services`, `POST …/services`,
  `DELETE …/services/:id`.
- **C. Component discovery/config** switches from `engagement.service_id` to a
  chosen `engagement_service_id`.
- **D. Web** — engagement view lists services; discovery/config scoped per
  service; creation wizard can add >1 service.

Each part is its own commit; the suite stays green throughout. No PR is opened —
work stops and reports after each part.

## Consequences

- **+** Unblocks §9–§10, §27, §38 directly, and gives §30 its seam.
- **+** Zero disruption to existing rows, RLS, or tests — every step is additive
  or a like-for-like constraint swap with a backfill that makes it a no-op for
  current data.
- **−** Two columns (`engagements.service_id`, `engagement_components.engagement_id`)
  become transitional/denormalised, to be tidied in a later cleanup phase.
- **−** Identity enforcement moves from a plain table constraint to a
  trigger-synced denormalised index — slightly more machinery, documented here.
