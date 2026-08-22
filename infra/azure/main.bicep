// ─────────────────────────────────────────────────────────────────────────
// HSDG Portal — Azure infrastructure (subscription-scope entry point).
//
// Creates the per-environment resource group and deploys the resource stack
// (core.bicep) into it. Deploy with:
//
//   az deployment sub create \
//     --name hsdg-<env> \
//     --location centralindia \
//     --template-file infra/azure/main.bicep \
//     --parameters infra/azure/params/<env>.bicepparam
//
// Secrets (DB passwords, JWT secret) are passed as secure parameters at deploy
// time and stored in Key Vault — never committed. See infra/azure/README.md.
// ─────────────────────────────────────────────────────────────────────────

targetScope = 'subscription'

@description('Short environment name — drives resource names and sizing.')
@allowed(['staging', 'prod'])
param environmentName string

@description('Azure region for all resources (India data residency by default).')
param location string = 'centralindia'

@description('Resource group name. Defaults to rg-hsdg-<env>.')
param resourceGroupName string = 'rg-hsdg-${environmentName}'

// ── Secrets (provided at deploy time; stored in Key Vault, never in the repo) ──
@secure()
@description('PostgreSQL server administrator password.')
param pgAdminPassword string

@secure()
@description('Password for the least-privilege application role (hsdg_app).')
param pgAppPassword string

@secure()
@description('Password for the schema-owning migrator role (hsdg_migrator).')
param pgMigratorPassword string

@secure()
@description('JWT signing secret (min 16 chars). Required even under Entra.')
param jwtSecret string

// ── Entra ID (production auth) ────────────────────────────────────────────────
@description('Entra tenant id for token validation (AUTH_ENTRA_TENANT_ID).')
param entraTenantId string = subscription().tenantId

@description('Entra app (client) id for the portal (AUTH_ENTRA_CLIENT_ID).')
param entraClientId string = ''

// ── Container images (placeholders on first deploy; CD overrides after push) ──
@description('API container image ref. CD updates this after building & pushing.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Web container image ref. CD updates this after building & pushing.')
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'hsdg-portal'
    environment: environmentName
  }
}

module core 'core.bicep' = {
  name: 'hsdg-core-${environmentName}'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    pgAdminPassword: pgAdminPassword
    pgAppPassword: pgAppPassword
    pgMigratorPassword: pgMigratorPassword
    jwtSecret: jwtSecret
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    apiImage: apiImage
    webImage: webImage
  }
}

output resourceGroup string = rg.name
output acrLoginServer string = core.outputs.acrLoginServer
output acrName string = core.outputs.acrName
output apiFqdn string = core.outputs.apiFqdn
output webFqdn string = core.outputs.webFqdn
output keyVaultName string = core.outputs.keyVaultName
output postgresFqdn string = core.outputs.postgresFqdn
output containerAppsEnv string = core.outputs.containerAppsEnv
