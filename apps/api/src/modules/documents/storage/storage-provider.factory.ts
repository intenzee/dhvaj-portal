import type { AppConfigService } from '../../../config/app-config.service';
import { GraphClient } from '../m365/graph-client';
import type { StorageProvider } from './storage-provider';
import { LocalStorageProvider } from './local-storage.provider';
import { AzureBlobStorageProvider } from './azure-blob-storage.provider';
import { SharePointStorageProvider } from './sharepoint-storage.provider';

/**
 * Build the configured {@link StorageProvider}:
 *
 *   STORAGE_PROVIDER=local       → filesystem (dev/test, default)
 *   STORAGE_PROVIDER=azure_blob  → Azure Blob Storage
 *   STORAGE_PROVIDER=sharepoint  → the firm's SharePoint Online site (M365_* settings)
 *
 * Kept apart from the Nest module (config is a type-only import) so the
 * operator scripts can build providers without booting the API's config.
 */
export function createStorageProvider(config: AppConfigService): StorageProvider {
  switch (config.get('STORAGE_PROVIDER')) {
    case 'azure_blob':
      return new AzureBlobStorageProvider(
        config.get('STORAGE_AZURE_CONNECTION_STRING') ?? '',
        config.get('STORAGE_AZURE_CONTAINER') ?? '',
      );
    case 'sharepoint':
      return new SharePointStorageProvider(
        new GraphClient(config),
        config.get('STORAGE_SHAREPOINT_ROOT'),
      );
    default:
      return new LocalStorageProvider(config.get('STORAGE_LOCAL_DIR') ?? '');
  }
}
