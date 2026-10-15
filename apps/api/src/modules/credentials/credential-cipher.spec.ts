import { randomBytes } from 'node:crypto';
import { CredentialCipher, credentialAad, parseCredentialKeys } from './credential-cipher';

const key = (): string => randomBytes(32).toString('base64');
const cipherWith = (keys: string | undefined) => new CredentialCipher({ get: () => keys } as never);

describe('CredentialCipher (ADR-0035)', () => {
  const secret = { username: 'bharat_traders', password: 'S3cret!pass' };
  const aad = credentialAad('c1', 'e1', 'gst', 'main');

  it('round-trips a login and never leaves it readable in the ciphertext', () => {
    const c = cipherWith(`1:${key()}`);
    const sealed = c.seal(secret, aad);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('S3cret');
    expect(c.open(sealed, aad)).toEqual(secret);
  });

  it('uses a fresh IV every time', () => {
    const c = cipherWith(`1:${key()}`);
    expect(c.seal(secret, aad).iv.equals(c.seal(secret, aad).iv)).toBe(false);
  });

  it('refuses a ciphertext moved to another row, or tampered with', () => {
    const c = cipherWith(`1:${key()}`);
    const sealed = c.seal(secret, aad);
    expect(() => c.open(sealed, credentialAad('c2', 'e1', 'gst', 'main'))).toThrow();
    expect(() => c.open(sealed, credentialAad('c1', 'e1', 'traces', 'deductor'))).toThrow();
    const bad = Buffer.from(sealed.ciphertext);
    bad[0] = bad[0]! ^ 1;
    expect(() => c.open({ ...sealed, ciphertext: bad }, aad)).toThrow();
  });

  it('seals with the newest key and still opens what older keys sealed', () => {
    const k1 = key();
    const old = cipherWith(`1:${k1}`).seal(secret, aad);
    const rotated = cipherWith(`1:${k1},2:${key()}`);
    expect(rotated.seal(secret, aad).keyVersion).toBe(2);
    expect(rotated.open(old, aad)).toEqual(secret);
    expect(() => cipherWith(`2:${key()}`).open(old, aad)).toThrow(/version 1/);
  });

  it('is not ready without a key, and rejects a malformed key list', () => {
    expect(cipherWith(undefined).ready).toBe(false);
    expect(() => cipherWith(undefined).seal(secret, aad)).toThrow();
    expect(() => parseCredentialKeys('1:short')).toThrow();
    expect(() => parseCredentialKeys(`1:${key()},1:${key()}`)).toThrow(/twice/);
    expect(parseCredentialKeys(`1:${key()}, 3:${key()}`).size).toBe(2);
  });
});
