import {
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Portal passwords — pure helpers (no database). Hashes are salted scrypt,
 * stored as `scrypt$N$r$p$<salt b64>$<hash b64>` so the cost can be raised
 * later without invalidating existing hashes.
 */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
// scrypt needs 128·N·r bytes; leave headroom over Node's 32 MiB default.
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time check of a password against a stored hash. False for a malformed hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });
  return timingSafeEqual(key, expected);
}

/**
 * A hash of a random value, verified against when the email is unknown so a
 * wrong email takes as long as a wrong password.
 */
let decoyHash: Promise<string> | null = null;
export function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return decoyHash;
}

// No 0/O, 1/l/I — the temporary password is read out or typed from a note.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A temporary password like `Kp7m-Qx4t-Zr9w` (12 random characters, ~69 bits). */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) group += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

/** Why a chosen password is not acceptable, or null when it is. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (new Set(password).size < 4) return 'Use a less repetitive password.';
  const lower = password.toLowerCase();
  const name = email.split('@')[0]?.toLowerCase() ?? '';
  if (name.length >= 3 && lower.includes(name)) return 'Don’t use your email name in the password.';
  if (['password', 'dhvaj', 'qwerty', '12345678'].some((w) => lower.includes(w))) {
    return 'That password is too easy to guess.';
  }
  return null;
}
