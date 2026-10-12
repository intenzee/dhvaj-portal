import { Module } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.module';
import { STORAGE_PROVIDER } from './storage-provider';
import { createStorageProvider } from './storage-provider.factory';

/**
 * Selects the blob storage provider by config (see {@link createStorageProvider})
 * and exposes it under the {@link STORAGE_PROVIDER} token — the document service
 * depends only on the interface, never a concrete implementation.
 */
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [AppConfigService],
      useFactory: createStorageProvider,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
