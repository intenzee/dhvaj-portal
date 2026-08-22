# HSDG Portal — Azure Infrastructure

Infrastructure-as-code (Bicep) and the deploy runbook for the HSDG Portal.

- **Cloud:** Azure · **Region:** Central India (`centralindia`, India data residency)
- **Environments:** `staging` and `prod` (separate resource groups, `rg-hsdg-<env>`)
- **Subscription:** `518dda8a-a074-45ba-8928-755766eafb50`
- **Directory (tenant):** HSDG and Associates (hsdg.in)

## What gets provisioned (`main.bicep` → `core.bicep`)

| Resource | Purpose |
| --- | --- |
| Log Analytics + Application Insights | Traces/metrics/logs, correlation ids |
| Azure Container Registry (ACR) | API & web images |
| User-assigned managed identity | Pull images, read Key Vault secrets & blobs (no stored creds) |
| Key Vault (RBAC) | JWT secret, DB URLs, storage connection string |
| Storage account + `hsdg-documents` container | Document bytes (the `azure_blob` storage provider) |
| PostgreSQL Flexible Server v16 (+ `hsdg` db) | System of record; SSL enforced, backups/PITR |
| Container Apps environment | Runs the two apps, wired to Log Analytics |
| Container App — API (`hsdg-<env>-api`) | NestJS API, public ingress, CORS-locked to the web origin |
| Container App — Web (`hsdg-<env>-web`) | Next.js portal, public ingress |

Sizing scales by environment: **staging** = burstable Postgres, single-zone, scale-to-zero web; **prod** = general-purpose Postgres, zone-redundant HA, ZRS storage, larger scale ceilings.

Secrets are **never** committed: they are passed as environment variables at deploy time (`readEnvironmentVariable` in the `.bicepparam` files) and stored in Key Vault. The API reads them at runtime via managed identity — no secret ever lands in an image or in the repo.

## Prerequisites (once)

1. **Tools:** Azure CLI (`az`) with the Bicep extension (`az bicep install`), Docker, and `jq`.
2. **Login & subscription:**
   ```bash
   az login
   az account set --subscription 518dda8a-a074-45ba-8928-755766eafb50
   ```
3. **Register an Entra app** for the portal (SPA/web) — note its **Application (client) ID**. Set redirect URIs after the first deploy, once the web FQDN is known (below). This becomes `ENTRA_CLIENT_ID`; the tenant defaults to the subscription tenant.
4. **Generate the secrets** (store them in your password manager):
   ```bash
   export PG_ADMIN_PASSWORD="$(openssl rand -base64 24)"
   export PG_APP_PASSWORD="$(openssl rand -base64 24)"
   export PG_MIGRATOR_PASSWORD="$(openssl rand -base64 24)"
   export JWT_SECRET="$(openssl rand -base64 32)"
   export ENTRA_CLIENT_ID="<from step 3>"
   ```

## First deploy (manual — one environment, e.g. staging)

```bash
ENV=staging   # or prod

# 1. Validate before touching anything (dry run).
az deployment sub what-if \
  --location centralindia \
  --template-file infra/azure/main.bicep \
  --parameters infra/azure/params/$ENV.bicepparam

# 2. Provision infrastructure (creates the RG + all resources).
az deployment sub create \
  --name hsdg-$ENV-bootstrap \
  --location centralindia \
  --template-file infra/azure/main.bicep \
  --parameters infra/azure/params/$ENV.bicepparam

# 3. Capture outputs.
az deployment sub show --name hsdg-$ENV-bootstrap --query properties.outputs
#    → acrName, acrLoginServer, apiFqdn, webFqdn, keyVaultName, postgresFqdn
```

### 4. Bootstrap the database roles (once per server)

The `hsdg` database exists, but the least-privilege roles do not yet. Allow your
IP, create the roles as the admin, then remove the rule:

```bash
PG_NAME="<postgresFqdn without the domain suffix>"   # e.g. staging-pg-xxxxxxxx
MYIP="$(curl -s https://api.ipify.org)"
az postgres flexible-server firewall-rule create \
  --resource-group rg-hsdg-$ENV --name "$PG_NAME" \
  --rule-name my-ip --start-ip-address "$MYIP" --end-ip-address "$MYIP"

psql "host=<postgresFqdn> port=5432 dbname=hsdg user=hsdgadmin sslmode=require" \
  -v app_pw="$PG_APP_PASSWORD" -v migrator_pw="$PG_MIGRATOR_PASSWORD" \
  -f infra/azure/postgres-roles.sql

az postgres flexible-server firewall-rule delete --yes \
  --resource-group rg-hsdg-$ENV --name "$PG_NAME" --rule-name my-ip
```

### 5. Build & push images, then point the apps at them

```bash
ACR=<acrLoginServer>          # e.g. acrhsdgxxxx.azurecr.io
TAG=$(git rev-parse --short HEAD)
az acr login --name <acrName>

# API
docker build -f apps/api/Dockerfile -t $ACR/hsdg-api:$TAG .
docker push $ACR/hsdg-api:$TAG

# Web — the API base URL is baked into the client bundle at build time.
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://<apiFqdn>/api/v1 \
  -t $ACR/hsdg-web:$TAG .
docker push $ACR/hsdg-web:$TAG

# Redeploy with the real images.
API_IMAGE=$ACR/hsdg-api:$TAG WEB_IMAGE=$ACR/hsdg-web:$TAG \
az deployment sub create \
  --name hsdg-$ENV-apps \
  --location centralindia \
  --template-file infra/azure/main.bicep \
  --parameters infra/azure/params/$ENV.bicepparam
```

### 6. Migrate & (optionally) seed

Migrations run as the migrator role. Reuse the firewall-allow dance from step 4,
fetch the URL from Key Vault, then run:

```bash
DATABASE_MIGRATE_URL="$(az keyvault secret show --vault-name <keyVaultName> \
  --name database-migrate-url --query value -o tsv)" npm run db:migrate
```

Seed the real org (offices, partners, services, compliance rules) using the
Administration UI once, or a production seed script — **not** the dev fixtures.

### 7. Finish Entra wiring

Add the web origin to the Entra app's redirect URIs:
`https://<webFqdn>/` (and later your custom domain). Grant admin consent. The API
already runs with `AUTH_PROVIDER=entra` and `AUTH_DEV_FALLBACK=false`.

## Continuous deployment (`.github/workflows/deploy.yml`)

Manual, environment-gated (`workflow_dispatch` → choose `staging`/`prod`). It logs
in via **OIDC** (no stored cloud credentials), builds & pushes both images,
redeploys, and runs migrations behind a temporary firewall rule.

**One-time GitHub setup:**

1. **Federated credentials** — create an Entra app (or use one) as the deploy
   identity, add a federated credential for this repo's `staging`/`prod`
   environments, and grant it **Contributor + User Access Administrator** on the
   subscription (User Access Administrator is needed because the Bicep creates
   role assignments).
2. **Repo secrets** (per environment where noted): `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `PG_ADMIN_PASSWORD`,
   `PG_APP_PASSWORD`, `PG_MIGRATOR_PASSWORD`, `JWT_SECRET`, `ENTRA_CLIENT_ID`.
3. Add **required reviewers** on the `prod` GitHub environment for an approval gate.

The role bootstrap (step 4) is **not** in CD — it runs once, manually, with the
admin password. CD assumes the roles already exist.

## Hardening follow-ups (post-MVP)

- **Private networking:** put Postgres behind a private endpoint / delegated
  subnet and the Container Apps env on a VNet; drop the `AllowAzureServices`
  firewall rule. (Current setup uses public access + the Azure-services firewall
  switch, which is fine to launch but should be tightened.)
- **Custom domains + managed certs** on both container apps.
- **Blob access via managed identity** instead of a connection string (the
  identity already holds Storage Blob Data Contributor).
- **Antivirus scan on upload**, retention enforcement, alerts (error rate, SLA
  breach, sweep dead-man) in Azure Monitor.
- **A Container Apps Job** for the notification sweep on a schedule.
