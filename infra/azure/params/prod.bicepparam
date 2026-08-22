using '../main.bicep'

// Non-secret configuration. Secrets come from environment variables so nothing
// sensitive is committed — set them before deploying (see infra/azure/README.md).
param environmentName = 'prod'
param location = 'centralindia'

// Entra app registration for the portal (fill in once the app is registered).
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')

// Container images. Placeholders on first deploy; CD sets these after pushing.
param apiImage = readEnvironmentVariable('API_IMAGE', 'mcr.microsoft.com/k8se/quickstart:latest')
param webImage = readEnvironmentVariable('WEB_IMAGE', 'mcr.microsoft.com/k8se/quickstart:latest')

// Secrets (required) — read from the environment, stored in Key Vault by the deploy.
param pgAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')
param pgAppPassword = readEnvironmentVariable('PG_APP_PASSWORD')
param pgMigratorPassword = readEnvironmentVariable('PG_MIGRATOR_PASSWORD')
param jwtSecret = readEnvironmentVariable('JWT_SECRET')
