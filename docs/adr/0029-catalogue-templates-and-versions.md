# ADR-0029 — Reusable, versioned catalogue templates + workflow versions

- **Status:** Accepted
- **Date:** 2026-08-29
- **Phase:** 13 (Administration) — catalogue-fidelity follow-on

## Context

The Service Catalogue Master §18/§25/§27 requires the configuration layers a
service loads to be **reusable, effective-dated/versioned masters**: Checklist,
PBC, Document-Requirement and Workflow — each with its own version, snapshotted
onto a configuration so "adding a form or step is configuration, not code"
(§29) and a configuration records the exact definition it used. Compliance rules
already worked this way (`compliance_rules` + append-only
`compliance_rule_versions`, snapshotted as `compliance_rule_version_id`); the
other four layers did not.

## Decision

Migration `0037_catalogue_templates` adds the masters and wires the snapshots,
mirroring the compliance rule/version pattern.

### 1. One typed template master, not three

§27 sketches three tables (`checklist_templates`, `pbc_templates`,
`document_requirement_templates`). All three are list-shaped "reusable/versioned
template" masters, so they are implemented as **one** `catalogue_templates` +
`catalogue_template_versions` pair discriminated by
`template_type ∈ {checklist, pbc, document_requirement}`. Each version carries
its item list as JSONB `body` (`{"items":[…]}`, shape-checked). This delivers the
same capability with a single RLS surface, one API, and one test suite instead of
three near-identical copies — the same naming-vs-concept call recorded for
`service_configurations → engagement_services` in ADR-0024. Versions are
**append-only** (UPDATE/DELETE revoked from `hsdg_app`; INSERT-only policy), so a
version a configuration already snapshotted can never be silently rewritten.

### 2. Workflow versions

`workflow_versions` gives each workflow family an effective-dated definition
pointer (§25 "Workflow Version"); `v1` is seeded for every family. An engagement
snapshots the family's active version into `engagements.workflow_version_id` at
`start` (surfaced on the engagement detail as `workflowVersion`). The state
machine still resolves states from the family (the active definition); versioning
the state/transition *sets* themselves is a larger future change and is
deliberately not attempted here.

### 3. Definition links + configuration snapshots

`service_components` gains nullable links to a checklist / PBC /
document-requirement template (the definition a component loads).
`engagement_components` gains the matching version-snapshot columns. When a
component is configured into an engagement (§28), the active version of each
linked template — latest `effective_from ≤ today`, still open — is snapshotted
onto the configuration, and re-snapshotted when a configuration is superseded.
The Book-keeping `BK_BANKREC` component is seeded with all three linked templates
so the path is exercised end to end.

### API & permissions

Templates are catalogue config, so the catalogue module gains a
`CatalogueTemplatesController` + service: read on `service.read` (everyone),
create-template / add-version on `service.manage` (MP/admin), both audited. The
legacy `service_components.checklist_template text[]` seeding is left untouched
(additive).

## Consequences

- Checklist, PBC and document-requirement templates are now reusable and
  versioned, editable via API without code changes; a configuration records the
  template version and workflow version it loaded.
- RLS is standard (read any authenticated context; write firm-wide), validated
  by e2e (a Senior is refused). Migration validated up → down → up.
- **Deferred:** versioning the workflow state/transition definitions themselves
  (multiple concurrent state sets per family), a UI to author templates and to
  attach them to catalogue components, and migrating the legacy checklist
  `text[]` seeding onto the new checklist templates. The schema is ready for all
  three.
