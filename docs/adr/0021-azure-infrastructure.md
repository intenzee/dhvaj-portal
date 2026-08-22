# ADR-0021 — Azure Infrastructure (IaC + CD)

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** Production hardening — infrastructure

## Context

The portal is production-ready in code but has no cloud footprint. It needs a
repeatable, reviewable path to running infrastructure: compute for the API and
web, a managed system-of-record, secret storage, blob storage for documents,
observability, and a pipeline that builds, deploys and migrates. Data residency
matters (Indian CA firm, DPDP).

## Decisions

### 1. Bicep, deployed at subscription scope

IaC is **Bicep** (Azure-native; no state backend to manage, first-class support
for an all-Azure stack). `main.bicep` runs at subscription scope, creates the
per-environment resource group, and deploys `core.bicep` into it. Templates
compile clean (`bicep build`, zero warnings) and are validated with
`az deployment sub what-if` before any apply.

### 2. Azure Container Apps for compute

Both the API and the Next.js web app run as **Container Apps** on a shared
managed environment wired to Log Analytics. Chosen over AKS (too heavy for two
services) and App Service (Container Apps gives scale-to-zero for staging,
revisions, and a cleaner managed-identity story). Both apps have public ingress —
the browser calls the API directly (per ADR-0001), so the API's CORS is locked to
the web app's FQDN, resolved within the template.

### 3. Region: Central India

`centralindia` for data residency and latency. Postgres backups are local
(staging) / geo-redundant (prod).

### 4. Managed identity + Key Vault — no secrets in images or repo

A user-assigned managed identity holds **AcrPull**, **Key Vault Secrets User**
and **Storage Blob Data Contributor**. The API reads DB URLs, the JWT secret and
the storage connection string from Key Vault at runtime via that identity.
Deploy-time secrets are passed as environment variables (`readEnvironmentVariable`
in `.bicepparam`) and written to Key Vault — never committed. This carries the
codebase's fail-closed, least-privilege posture into the cloud: the API still
logs in to Postgres as `hsdg_app` (no BYPASSRLS), the migrator as `hsdg_migrator`.

### 5. Managed Postgres, SSL-enforced; roles bootstrapped once

Azure Database for PostgreSQL Flexible Server v16, SSL enforced, backups/PITR,
zone-redundant HA in prod. Bicep creates the server and the `hsdg` database; the
two least-privilege roles are created **once** by `postgres-roles.sql` (run as the
admin, passwords injected via psql variables), mirroring the local
`00-roles.sql`. Migrations then run as `hsdg_migrator`.

### 6. CD: manual, OIDC, two-phase, environment-gated

`.github/workflows/deploy.yml` is `workflow_dispatch` (staging/prod), logs in via
**OIDC** (no stored cloud credentials), and deploys in two phases because the web
image bakes the API base URL at build time: (1) ensure infra + read the API FQDN,
(2) build/push both images, redeploy pointing at them. Migrations run behind a
temporary, auto-removed firewall rule for the runner IP. The prod GitHub
environment carries a required-reviewer gate. The existing CI
(`ci.yml`: lint → typecheck → build → unit → migrate → e2e/RLS → docker build) is
unchanged and remains the merge gate.

### 7. Web image: Next.js standalone output

`next.config.mjs` emits `output: 'standalone'` with `outputFileTracingRoot` at the
monorepo root, so the web Dockerfile ships a minimal traced server
(`apps/web/server.js`) rather than the full workspace. A static `/api/health`
route backs the container probe.

## Consequences

- Two environments stand up from the same templates with different parameter
  files; sizing scales by environment.
- First deploy is a documented manual runbook (`infra/azure/README.md`); steady
  state is the CD workflow.
- **Deliberate follow-ups (noted in the runbook):** private networking for
  Postgres + Container Apps (currently public + Azure-services firewall),
  custom domains + managed certs, blob access via managed identity instead of a
  connection string, AV-scan on upload, Azure Monitor alerts, and a Container
  Apps Job for the scheduled notification sweep.
