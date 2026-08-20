import { createHash } from 'node:crypto';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/** The decoded, validated bytes of an upload plus their integrity metadata. */
export interface DecodedUpload {
  buffer: Buffer;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * Decode a base64 upload, enforce the size ceiling, and compute its SHA-256.
 *
 * Pure and self-contained so it can be unit-tested without the database or a
 * storage provider. Rejects empty content, non-base64 input, and anything over
 * the configured limit — backend validation is authoritative (§18).
 */
export function decodeUpload(contentBase64: string, maxBytes: number): DecodedUpload {
  if (typeof contentBase64 !== 'string' || contentBase64.trim().length === 0) {
    throw new BadRequestException('Document content is required.');
  }

  const buffer = Buffer.from(contentBase64, 'base64');
  // Buffer.from silently drops invalid base64 characters, so a non-empty input
  // that decodes to nothing was not real base64.
  if (buffer.length === 0) {
    throw new BadRequestException('Document content is not valid base64.');
  }
  if (buffer.length > maxBytes) {
    throw new PayloadTooLargeException(`Document exceeds the maximum size of ${maxBytes} bytes.`);
  }

  const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
  return { buffer, sizeBytes: buffer.length, checksumSha256 };
}
