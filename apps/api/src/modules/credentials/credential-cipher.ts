import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/** A login as stored: AES-256-GCM output and the key version that made it. */
export interface SealedCredential {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export interface CredentialSecret {
  username: string;
  password: string;
}

/** `1:<base64>,2:<base64>` → version → 32-byte key. Throws on a malformed list. Pure — tested. */
export function parseCredentialKeys(raw: string | undefined): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  if (!raw || raw.trim() === '') return keys;
  for (const part of raw.split(',')) {
    const [v, b64] = part.trim().split(':');
    const version = Number(v);
    const key = Buffer.from(b64 ?? '', 'base64');
    if (!Number.isInteger(version) || version < 1 || key.length !== 32)
      throw new Error('CREDENTIALS_KEYS must be "<version>:<base64 of 32 bytes>", comma-separated');
    if (keys.has(version)) throw new Error(`CREDENTIALS_KEYS lists version ${version} twice`);
    keys.set(version, key);
  }
  return keys;
}

/** The additional data a sealed login is bound to: its row, client, portal and account. */
export function credentialAad(
  id: string,
  entityId: string,
  portal: string,
  account: string,
): string {
  return `${id}|${entityId}|${portal}|${account}`;
}

/**
 * ADR-0035 — seals and opens clients' portal logins with AES-256-GCM. The key
 * lives only in CREDENTIALS_KEYS; the highest version seals, every listed
 * version opens. Each seal uses a fresh 12-byte IV and binds the ciphertext to
 * its row (`credentialAad`), so a ciphertext moved to another row fails.
 */
@Injectable()
export class CredentialCipher {
  private readonly keys: Map<number, Buffer>;
  private readonly current: number | null;

  constructor(config: AppConfigService) {
    this.keys = parseCredentialKeys(config.get('CREDENTIALS_KEYS'));
    this.current = this.keys.size > 0 ? Math.max(...this.keys.keys()) : null;
  }

  /** A key is configured: logins can be saved and shown. */
  get ready(): boolean {
    return this.current !== null;
  }

  seal(secret: CredentialSecret, aad: string): SealedCredential {
    if (this.current === null) throw new Error('No credential key is configured.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ u: secret.username, p: secret.password }), 'utf8'),
      cipher.final(),
    ]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: this.current };
  }

  /** Seal one value (a bank account, a PAN) under the same key and rules. */
  sealText(value: string, aad: string): SealedCredential {
    return this.seal({ username: value, password: '' }, aad);
  }

  openText(sealed: SealedCredential, aad: string): string {
    return this.open(sealed, aad).username;
  }

  open(sealed: SealedCredential, aad: string): CredentialSecret {
    const key = this.keys.get(sealed.keyVersion);
    if (!key) throw new Error(`Credential key version ${sealed.keyVersion} is not configured.`);
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.authTag);
    const plain = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
    const { u, p } = JSON.parse(plain.toString('utf8')) as { u: string; p: string };
    return { username: u, password: p };
  }
}
