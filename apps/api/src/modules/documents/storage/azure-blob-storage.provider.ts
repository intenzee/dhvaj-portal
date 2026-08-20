import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { StorageProvider } from './storage-provider';

// Minimal structural types for the slice of `@azure/storage-blob` we use. The
// SDK is an OPTIONAL peer dependency — it is loaded lazily only when
// STORAGE_PROVIDER=azure_blob, so dev/test/CI never need it installed.
interface AzureBlockBlobClient {
  uploadData(
    data: Buffer,
    options?: { blobHTTPHeaders?: { blobContentType?: string } },
  ): Promise<unknown>;
  downloadToBuffer(): Promise<Buffer>;
  deleteIfExists(): Promise<unknown>;
}
interface AzureContainerClient {
  createIfNotExists(): Promise<unknown>;
  getBlockBlobClient(name: string): AzureBlockBlobClient;
}
interface AzureBlobServiceClient {
  getContainerClient(name: string): AzureContainerClient;
}
interface AzureBlobModule {
  BlobServiceClient: { fromConnectionString(connectionString: string): AzureBlobServiceClient };
}

/**
 * Azure Blob Storage provider (production).
 *
 * The bytes are stored as block blobs keyed by the opaque reference; the
 * reference is never exposed to clients, so there is no publicly reachable URL.
 * The SDK is imported lazily and the container is created on first use, so the
 * process only touches Azure when this provider is actually selected. The
 * verification logic is real; it is simply not exercised in CI (no account).
 */
export class AzureBlobStorageProvider implements StorageProvider {
  readonly name = 'azure_blob';
  private readonly logger = new Logger(AzureBlobStorageProvider.name);
  private container?: AzureContainerClient;
  private ensured?: Promise<AzureContainerClient>;

  constructor(
    private readonly connectionString: string,
    private readonly containerName: string,
  ) {
    if (!connectionString || !containerName) {
      throw new Error(
        'STORAGE_PROVIDER=azure_blob requires STORAGE_AZURE_CONNECTION_STRING and STORAGE_AZURE_CONTAINER.',
      );
    }
  }

  newReference(engagementId: string, documentId: string): string {
    return `${engagementId}/${documentId}/${randomUUID()}`;
  }

  async write(reference: string, data: Buffer, contentType: string): Promise<void> {
    const container = await this.ensureContainer();
    await container
      .getBlockBlobClient(reference)
      .uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async read(reference: string): Promise<Buffer> {
    const container = await this.ensureContainer();
    return container.getBlockBlobClient(reference).downloadToBuffer();
  }

  async remove(reference: string): Promise<void> {
    const container = await this.ensureContainer();
    await container.getBlockBlobClient(reference).deleteIfExists();
  }

  private ensureContainer(): Promise<AzureContainerClient> {
    if (this.container) return Promise.resolve(this.container);
    if (!this.ensured) {
      this.ensured = (async () => {
        const mod = this.loadSdk();
        const service = mod.BlobServiceClient.fromConnectionString(this.connectionString);
        const container = service.getContainerClient(this.containerName);
        await container.createIfNotExists();
        this.container = container;
        this.logger.log(`Azure Blob container "${this.containerName}" ready.`);
        return container;
      })();
    }
    return this.ensured;
  }

  private loadSdk(): AzureBlobModule {
    const moduleName = '@azure/storage-blob';
    try {
      // Lazy, optional dependency — loaded only when this provider is selected.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      return require(moduleName) as AzureBlobModule;
    } catch {
      throw new Error(
        'STORAGE_PROVIDER=azure_blob requires the "@azure/storage-blob" package to be installed.',
      );
    }
  }
}
