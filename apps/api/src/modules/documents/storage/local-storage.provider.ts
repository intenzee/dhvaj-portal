import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Logger, NotFoundException } from '@nestjs/common';
import type { StorageProvider } from './storage-provider';

/**
 * Filesystem storage provider for development and test.
 *
 * Blobs are written under a base directory using the opaque reference as the
 * relative path. It is deliberately simple — no network, no credentials — so the
 * whole document pipeline (upload → version → audited download → archive) can be
 * exercised in CI without Azure. Production uses the Azure Blob provider behind
 * the same interface.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly baseDir: string;

  constructor(baseDir: string) {
    // Fall back to a per-host temp dir when unset, so dev needs zero config and
    // test runs never pollute the repo.
    this.baseDir =
      baseDir && baseDir.trim().length > 0 ? baseDir : join(tmpdir(), 'hsdg-doc-storage');
    this.logger.log(`Local document storage at ${this.baseDir}`);
  }

  newReference(engagementId: string, documentId: string): string {
    return `${engagementId}/${documentId}/${randomUUID()}`;
  }

  async write(reference: string, data: Buffer, _contentType?: string): Promise<void> {
    const path = this.resolve(reference);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(reference: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(reference));
    } catch {
      throw new NotFoundException('Document content is no longer available in storage.');
    }
  }

  async remove(reference: string): Promise<void> {
    await rm(this.resolve(reference), { force: true });
  }

  /** Resolve a reference to an absolute path, refusing any path-traversal. */
  private resolve(reference: string): string {
    const path = normalize(join(this.baseDir, reference));
    const base = normalize(this.baseDir);
    if (!isAbsolute(path) || (path !== base && !path.startsWith(base + sep))) {
      throw new NotFoundException('Invalid storage reference.');
    }
    return path;
  }
}
