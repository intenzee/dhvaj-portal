import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { decodeUpload } from './documents.upload';
import { LocalStorageProvider } from './storage/local-storage.provider';

describe('decodeUpload', () => {
  const b64 = (s: string): string => Buffer.from(s).toString('base64');

  it('decodes valid base64 and computes the SHA-256 of the bytes', () => {
    const content = 'hello working paper';
    const decoded = decodeUpload(b64(content), 1024);
    expect(decoded.buffer.toString()).toBe(content);
    expect(decoded.sizeBytes).toBe(Buffer.byteLength(content));
    expect(decoded.checksumSha256).toBe(
      createHash('sha256').update(Buffer.from(content)).digest('hex'),
    );
    expect(decoded.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects empty content', () => {
    expect(() => decodeUpload('', 1024)).toThrow(BadRequestException);
    expect(() => decodeUpload('   ', 1024)).toThrow(BadRequestException);
  });

  it('rejects content that exceeds the size ceiling', () => {
    const big = b64('x'.repeat(2048));
    expect(() => decodeUpload(big, 1024)).toThrow(PayloadTooLargeException);
  });
});

describe('LocalStorageProvider', () => {
  const base = mkdtempSync(join(tmpdir(), 'hsdg-doc-test-'));
  const provider = new LocalStorageProvider(base);

  it('round-trips bytes through an opaque reference', async () => {
    const ref = provider.newReference('eng-1', 'doc-1');
    const data = Buffer.from('evidence bytes');
    await provider.write(ref, data, 'application/octet-stream');
    const read = await provider.read(ref);
    expect(read.equals(data)).toBe(true);
  });

  it('refuses path-traversal references', async () => {
    await expect(provider.read('../../etc/passwd')).rejects.toThrow(NotFoundException);
  });

  it('reports a missing reference as not found', async () => {
    await expect(provider.read('eng-1/doc-1/does-not-exist')).rejects.toThrow(NotFoundException);
  });

  it('remove is idempotent (no throw when absent)', async () => {
    await expect(provider.remove('eng-1/doc-1/gone')).resolves.toBeUndefined();
  });
});
