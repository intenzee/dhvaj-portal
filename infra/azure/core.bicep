// ─────────────────────────────────────────────────────────────────────────
// HSDG Portal — core resource stack (resource-group scope).
//
// Provisions: Log Analytics + Application Insights, Container Registry, a
// user-assigned managed identity, Key Vault (RBAC) with app secrets, a Storage
// account + blob container (document bytes), Azure Database for PostgreSQL
// Flexible Server (v16, SSL-enforced), a Container Apps environment, and the API
// and Web container apps — with RBAC so the identity can pull images and read
// secrets/blobs.
//
// Sizing scales by environment (staging = burstable/single-zone; prod =
// general-purpose/zone-redundant). Secrets are passed in and stored in Key
// Vault; nothing sensitive is emitted as an output.
// ─────────────────────────────────────────────────────────────────────────

@allowed(['staging', 'prod'])
param environmentName string
param location string = resourceGroup().location

@secure()
param pgAdminPassword string
@secure()
param pgAppPassword string
@secure()
param pgMigratorPassword string
@secure()
param jwtSecret string

param entraTenantId string
param entraClientId string
param apiImage string
param webImage string

// ── Naming ────────────────────────────────────────────────────────────────
var isProd = environmentName == 'prod'
var token = uniqueString(subscription().id, resourceGroup().id, environmentName)
var prefix = 'hsdg-${environmentName}'
var tags = {
  application: 'hsdg-portal'
  environment: environmentName
}

// ── Observability: Log Analytics + Application Insights ─────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: isProd ? 90 : 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-ai'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

// ── Container Registry ──────────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrhsdg${token}'
  location: location
  tags: tags
  sku: { name: isProd ? 'Standard' : 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ── User-assigned managed identity (pulls images, reads secrets/blobs) ──────
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-id'
  location: location
  tags: tags
}

// ── Key Vault (RBAC-authorized) ─────────────────────────────────────────────
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-hsdg-${take(token, 12)}'
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: isProd ? 90 : 7
    enablePurgeProtection: isProd ? true : null
    publicNetworkAccess: 'Enabled'
  }
}

// ── Storage (document bytes) ────────────────────────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'sthsdg${token}'
  location: location
  tags: tags
  sku: { name: isProd ? 'Standard_ZRS' : 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'hsdg-documents'
  properties: {
    publicAccess: 'None'
  }
}

// ── PostgreSQL Flexible Server (v16, SSL enforced by default) ───────────────
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: '${prefix}-pg-${take(token, 8)}'
  location: location
  tags: tags
  sku: {
    name: isProd ? 'Standard_D2ds_v5' : 'Standard_B1ms'
    tier: isProd ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'hsdgadmin'
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: isProd ? 128 : 32
    }
    backup: {
      backupRetentionDays: isProd ? 35 : 7
      geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: isProd ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: 'hsdg'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allow other Azure services (Container Apps outbound) to reach the server.
// The 0.0.0.0 sentinel rule is Azure's "allow Azure resources" switch, not the
// public internet. Private networking is the hardening follow-up (see README).
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── Key Vault secrets ───────────────────────────────────────────────────────
var pgFqdn = '${postgres.name}.postgres.database.azure.com'
var storageKey = storage.listKeys().keys[0].value
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storageKey};EndpointSuffix=${environment().suffixes.storage}'

resource secretJwt 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'jwt-secret'
  properties: { value: jwtSecret }
}
resource secretDbUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: 'postgres://hsdg_app:${pgAppPassword}@${pgFqdn}:5432/hsdg?sslmode=require'
  }
}
resource secretMigrateUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-migrate-url'
  properties: {
    value: 'postgres://hsdg_migrator:${pgMigratorPassword}@${pgFqdn}:5432/hsdg?sslmode=require'
  }
}
resource secretStorage 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'storage-connection-string'
  properties: { value: storageConnectionString }
}
resource secretPgAdmin 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'pg-admin-password'
  properties: { value: pgAdminPassword }
}

// ── RBAC: let the identity pull images and read secrets/blobs ───────────────
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var kvSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var blobDataContribRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, acrPullRole)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRole
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, uami.id, kvSecretsUserRole)
  scope: kv
  properties: {
    roleDefinitionId: kvSecretsUserRole
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource blobContrib 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, uami.id, blobDataContribRole)
  scope: storage
  properties: {
    roleDefinitionId: blobDataContribRole
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Container Apps environment ──────────────────────────────────────────────
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var acrServer = acr.properties.loginServer
var identityConfig = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${uami.id}': {}
  }
}
var registriesConfig = [
  {
    server: acrServer
    identity: uami.id
  }
]

// ── Web container app (public; the browser loads this) ──────────────────────
resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-web'
  location: location
  tags: tags
  identity: identityConfig
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: registriesConfig
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json(isProd ? '1.0' : '0.5')
            memory: isProd ? '2Gi' : '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 5 : 2
      }
    }
  }
  dependsOn: [acrPull]
}

// ── API container app (public; browser calls it directly, CORS-locked) ──────
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-api'
  location: location
  tags: tags
  identity: identityConfig
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto'
        allowInsecure: false
      }
      registries: registriesConfig
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/database-url'
          identity: uami.id
        }
        {
          name: 'jwt-secret'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/jwt-secret'
          identity: uami.id
        }
        {
          name: 'storage-connection-string'
          keyVaultUrl: '${kv.properties.vaultUri}secrets/storage-connection-string'
          identity: uami.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json(isProd ? '1.0' : '0.5')
            memory: isProd ? '2Gi' : '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'API_GLOBAL_PREFIX', value: 'api' }
            { name: 'LOG_LEVEL', value: 'info' }
            { name: 'LOG_PRETTY', value: 'false' }
            { name: 'SWAGGER_ENABLED', value: isProd ? 'false' : 'true' }
            { name: 'CORS_ORIGINS', value: 'https://${webApp.properties.configuration.ingress.fqdn}' }
            { name: 'DATABASE_SSL', value: 'true' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'AUTH_PROVIDER', value: 'entra' }
            { name: 'AUTH_DEV_FALLBACK', value: 'false' }
            { name: 'AUTH_JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'AUTH_ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'AUTH_ENTRA_CLIENT_ID', value: entraClientId }
            { name: 'STORAGE_PROVIDER', value: 'azure_blob' }
            { name: 'STORAGE_AZURE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'STORAGE_AZURE_CONTAINER', value: 'hsdg-documents' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: isProd ? 10 : 3
      }
    }
  }
  dependsOn: [
    acrPull
    kvSecretsUser
    blobContrib
    secretDbUrl
    secretJwt
    secretStorage
  ]
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output apiFqdn string = apiApp.properties.configuration.ingress.fqdn
output webFqdn string = webApp.properties.configuration.ingress.fqdn
output keyVaultName string = kv.name
output postgresFqdn string = pgFqdn
output containerAppsEnv string = caEnv.name
output managedIdentityClientId string = uami.properties.clientId
