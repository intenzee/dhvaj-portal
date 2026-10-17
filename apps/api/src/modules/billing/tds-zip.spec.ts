import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { TDS_ZIP_MAX_INFLATED, crc32, isZip, readTdsZip } from './tds-zip';

/** Made up: the head of a 26AS text export, zipped by macOS zip -P 01042015 (ZipCrypto). */
const locked = readFileSync(join(__dirname, '__fixtures__', '26as-locked.zip'));
const PASSWORD = '01042015';

/** A one-entry ZIP, stored (0) or deflated (8), unencrypted. */
function zipOf(name: string, data: Buffer, method: 0 | 8 = 8): Buffer {
  const body = method === 8 ? deflateRawSync(data) : data;
  const n = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}

describe('PS-204 the ZIP TRACES sends the 26AS in', () => {
  it('opens ZipCrypto with the password and reads the text file inside', () => {
    expect(isZip(locked)).toBe(true);
    const read = readTdsZip(locked, PASSWORD);
    expect(read.kind).toBe('file');
    if (read.kind !== 'file') return;
    expect(read.name).toBe('AAAFZ9999Q-2027.txt');
    expect(read.bytes.toString('utf8')).toContain('PART-I - Details of Tax Deducted at Source');
  });

  it('asks for the password, and says when it is wrong', () => {
    expect(readTdsZip(locked)).toEqual({ kind: 'password', wrong: false });
    expect(readTdsZip(locked, '31121999')).toEqual({ kind: 'password', wrong: true });
  });

  it('reads an unprotected ZIP, stored or deflated; the .txt before a .pdf', () => {
    const text = Buffer.from('^Annual Tax Statement^\n');
    for (const method of [0, 8] as const) {
      const read = readTdsZip(zipOf('dir/26AS.TXT', text, method));
      expect(read).toEqual({ kind: 'file', name: '26AS.TXT', bytes: text });
    }
    expect(readTdsZip(zipOf('notes.csv', text))).toEqual({ kind: 'empty' });
    expect(readTdsZip(zipOf('__MACOSX/._26AS.txt', text))).toEqual({ kind: 'empty' });
  });

  it('refuses WinZip AES, asking for the file unzipped', () => {
    const aes = zipOf('26AS.txt', Buffer.from('x'));
    // Method 99 in the central directory entry.
    const cd = aes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    aes.writeUInt16LE(99, cd + 10);
    expect(readTdsZip(aes)).toEqual({ kind: 'aes' });
  });

  it(`never inflates past ${TDS_ZIP_MAX_INFLATED / 1024 / 1024} MB`, () => {
    const bomb = zipOf('26AS.txt', Buffer.alloc(TDS_ZIP_MAX_INFLATED + 1, 0x41));
    expect(bomb.length).toBeLessThan(20_000);
    expect(readTdsZip(bomb)).toEqual({ kind: 'too_large' });
    // Lying about the size in the directory does not get past the cap.
    const cd = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(100, cd + 24);
    expect(readTdsZip(bomb)).toEqual({ kind: 'too_large' });
  });

  it('calls a truncated or tampered file corrupt', () => {
    expect(readTdsZip(locked.subarray(0, 40))).toEqual({ kind: 'corrupt' });
    const zip = zipOf('26AS.txt', Buffer.from('hello'), 0);
    const at = 30 + '26AS.txt'.length;
    zip[at] = zip[at]! ^ 0xff;
    expect(readTdsZip(zip)).toEqual({ kind: 'corrupt' });
  });
});
