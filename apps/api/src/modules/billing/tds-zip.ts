import { inflateRawSync } from 'node:zlib';

/**
 * PS-204 · the ZIP TRACES delivers the 26AS text export in ("View As Text"),
 * protected with the PAN holder's date of birth or incorporation (DDMMYYYY);
 * a deductor's Form 16A ZIP uses its TAN. Reads the one file wanted out of it:
 * the first .txt, else the first .pdf. Stored or deflated entries, plain or
 * under traditional PKWARE encryption (ZipCrypto, what TRACES and most tools
 * write). WinZip AES is recognised and refused: unzip it first. The password
 * is used here and nowhere else — never stored or logged. Pure — tested.
 */

/** A 26AS text export is tens of kilobytes; refuse anything that inflates past this. */
export const TDS_ZIP_MAX_INFLATED = 5 * 1024 * 1024;

export type TdsZipRead =
  | { kind: 'file'; name: string; bytes: Buffer }
  /** Encrypted, and no password or the wrong one was given. */
  | { kind: 'password'; wrong: boolean }
  /** WinZip AES (method 99): not read here. */
  | { kind: 'aes' }
  /** No .txt or .pdf inside. */
  | { kind: 'empty' }
  | { kind: 'too_large' }
  /** Not a ZIP we can read: truncated, or a method other than stored/deflate. */
  | { kind: 'corrupt' };

export function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crcByte = (crc: number, b: number): number =>
  (CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0;

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcByte(crc, b);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Traditional PKWARE encryption: three 32-bit keys stirred by each plain byte. */
class ZipCrypto {
  private k0 = 0x12345678;
  private k1 = 0x23456789;
  private k2 = 0x34567890;

  constructor(password: Buffer) {
    for (const b of password) this.update(b);
  }

  private update(b: number): void {
    this.k0 = crcByte(this.k0, b);
    this.k1 = (this.k1 + (this.k0 & 0xff)) >>> 0;
    this.k1 = (Math.imul(this.k1, 134775813) + 1) >>> 0;
    this.k2 = crcByte(this.k2, this.k1 >>> 24);
  }

  decrypt(data: Buffer): Buffer {
    const out = Buffer.allocUnsafe(data.length);
    for (let i = 0; i < data.length; i++) {
      const t = (this.k2 | 2) & 0xffff;
      const p = data[i]! ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
      this.update(p);
      out[i] = p;
    }
    return out;
  }
}

interface Entry {
  name: string;
  flags: number;
  method: number;
  modTime: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** The central directory, found from its end record. Null when it is not there. */
function entries(zip: Buffer): Entry[] | null {
  const min = Math.max(0, zip.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    out.push({
      flags: zip.readUInt16LE(at + 8),
      method: zip.readUInt16LE(at + 10),
      modTime: zip.readUInt16LE(at + 12),
      crc: zip.readUInt32LE(at + 16),
      compressedSize: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      localOffset: zip.readUInt32LE(at + 42),
      name: zip.toString('utf8', at + 46, at + 46 + nameLen),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const wanted = (e: Entry, ext: string): boolean =>
  !e.name.endsWith('/') &&
  !e.name.startsWith('__MACOSX/') &&
  !e.name.split('/').pop()!.startsWith('.') &&
  e.name.toLowerCase().endsWith(ext);

export function readTdsZip(zip: Buffer, password?: string): TdsZipRead {
  const all = entries(zip);
  if (!all) return { kind: 'corrupt' };
  const entry = all.find((e) => wanted(e, '.txt')) ?? all.find((e) => wanted(e, '.pdf'));
  if (!entry) return { kind: 'empty' };
  if (entry.method === 99) return { kind: 'aes' };
  if (entry.method !== 0 && entry.method !== 8) return { kind: 'corrupt' };
  if (entry.size > TDS_ZIP_MAX_INFLATED) return { kind: 'too_large' };

  const at = entry.localOffset;
  if (at + 30 > zip.length || zip.readUInt32LE(at) !== 0x04034b50) return { kind: 'corrupt' };
  const start = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  if (end > zip.length) return { kind: 'corrupt' };
  let data = zip.subarray(start, end);

  const encrypted = (entry.flags & 1) === 1;
  if (encrypted) {
    if (!password) return { kind: 'password', wrong: false };
    if (data.length < 12) return { kind: 'corrupt' };
    const plain = new ZipCrypto(Buffer.from(password, 'utf8')).decrypt(data);
    // The header's last byte checks the password: the CRC's high byte, or
    // the time's when sizes follow the data (bit 3).
    const check = entry.flags & 8 ? (entry.modTime >>> 8) & 0xff : entry.crc >>> 24;
    if (plain[11] !== check) return { kind: 'password', wrong: true };
    data = plain.subarray(12);
  }

  let bytes: Buffer;
  try {
    bytes =
      entry.method === 0
        ? Buffer.from(data)
        : inflateRawSync(data, { maxOutputLength: TDS_ZIP_MAX_INFLATED });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return { kind: 'too_large' };
    // A wrong password that passed the one-byte check inflates to garbage.
    return encrypted ? { kind: 'password', wrong: true } : { kind: 'corrupt' };
  }
  if (bytes.length > TDS_ZIP_MAX_INFLATED) return { kind: 'too_large' };
  if (crc32(bytes) !== entry.crc) {
    return encrypted ? { kind: 'password', wrong: true } : { kind: 'corrupt' };
  }
  return { kind: 'file', name: entry.name.split('/').pop()!, bytes };
}
