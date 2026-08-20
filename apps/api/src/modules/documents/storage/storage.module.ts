import { Module } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.module';
import { STORAGE_PROVIDER, type StorageProvider } from './storage-provider';
import { LocalStorageProvider } from './local-storage.provider';
import { AzureBlobStorageProvider } from './azure-blob-storage.provider';

/**
 * Selects the blob storage provider by config and exposes it under the
 * {@link STORAGE_PROVIDER} token — the document service depends only on the
 * interface, never a concrete implementation.
 *
 *   STORAGE_PROVIDER=local       → filesystem (dev/test, default)
 *   STORAGE_PROVIDER=azure_blob  → Azure Blob Storage (production)
 */
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): StorageProvider =>
        config.get('STORAGE_PROVIDER') === 'azure_blob'
          ? new AzureBlobStorageProvider(
              config.get('STORAGE_AZURE_CONNECTION_STRING') ?? '',
              config.get('STORAGE_AZURE_CONTAINER') ?? '',
            )
          : new LocalStorageProvider(config.get('STORAGE_LOCAL_DIR') ?? ''),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
