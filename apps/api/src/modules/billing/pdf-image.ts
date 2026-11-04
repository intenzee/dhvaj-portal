import { deflateSync, inflateSync } from 'node:zlib';

/**
 * An image ready for a PDF 1.4 XObject: JPEG passes through (DCTDecode); PNG
 * is decoded, laid on white (no transparency in the plain writer) and
 * re-compressed as RGB (FlateDecode). Throws ImageError with a message a
 * person can act on. Pure — tested.
 */
export interface PdfImage {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray';
  filter: 'DCTDecode' | 'FlateDecode';
  data: Buffer;
}

export class ImageError extends Error {}

const SAVE_AS = 'Save the logo as a PNG or an RGB JPEG and upload it again.';

export function pdfImage(data: Buffer, contentType: 'image/png' | 'image/jpeg'): PdfImage {
  return contentType === 'image/jpeg' ? jpeg(data) : png(data);
}

function jpeg(b: Buffer): PdfImage {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8)
    throw new ImageError(`That is not a JPEG. ${SAVE_AS}`);
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new ImageError(`The JPEG could not be read. ${SAVE_AS}`);
    const marker = b[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = b.readUInt16BE(i + 5);
      const width = b.readUInt16BE(i + 7);
      const comps = b[i + 9]!;
      if (b[i + 4] !== 8) throw new ImageError(`The JPEG is not 8-bit. ${SAVE_AS}`);
      if (comps !== 1 && comps !== 3) throw new ImageError(`The JPEG is CMYK. ${SAVE_AS}`);
      if (!width || !height) throw new ImageError(`The JPEG has no size. ${SAVE_AS}`);
      return {
        width,
        height,
        colorSpace: comps === 1 ? 'DeviceGray' : 'DeviceRGB',
        filter: 'DCTDecode',
        data: b,
      };
    }
    i += 2 + len;
  }
  throw new ImageError(`The JPEG could not be read. ${SAVE_AS}`);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function png(b: Buffer): PdfImage {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG)) {
    throw new ImageError(`That is not a PNG. ${SAVE_AS}`);
  }
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i);
    const name = b.toString('latin1', i + 4, i + 8);
    const body = b.subarray(i + 8, i + 8 + len);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    i += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!width || !height || ch === undefined)
    throw new ImageError(`The PNG could not be read. ${SAVE_AS}`);
  if (depth !== 8) throw new ImageError(`The PNG is not 8-bit. ${SAVE_AS}`);
  if (interlace !== 0) throw new ImageError(`The PNG is interlaced. ${SAVE_AS}`);
  if (type === 3 && !palette) throw new ImageError(`The PNG has no palette. ${SAVE_AS}`);
  if (width * height > 4_000_000)
    throw new ImageError('The logo is too large; keep it under 2000 × 2000.');

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    throw new ImageError(`The PNG could not be read. ${SAVE_AS}`);
  }
  const stride = width * ch;
  if (raw.length < (stride + 1) * height) throw new ImageError(`The PNG is cut short. ${SAVE_AS}`);
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= ch ? px[out + x - ch]! : 0;
      const up = y > 0 ? px[out - stride + x]! : 0;
      const ul = y > 0 && x >= ch ? px[out - stride + x - ch]! : 0;
      let r: number;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + up;
      else if (f === 3) r = v + ((a + up) >> 1);
      else if (f === 4) {
        const p = a + up - ul;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      } else throw new ImageError(`The PNG could not be read. ${SAVE_AS}`);
      px[out + x] = r & 0xff;
    }
  }

  // Lay it on white as RGB.
  const rgb = Buffer.alloc(width * height * 3);
  const over = (c: number, alpha: number): number =>
    Math.round((c * alpha + 255 * (255 - alpha)) / 255);
  for (let p = 0; p < width * height; p++) {
    let r: number;
    let g: number;
    let bl: number;
    let alpha = 255;
    const s = p * ch;
    if (type === 0) r = g = bl = px[s]!;
    else if (type === 4) {
      r = g = bl = px[s]!;
      alpha = px[s + 1]!;
    } else if (type === 2) {
      r = px[s]!;
      g = px[s + 1]!;
      bl = px[s + 2]!;
    } else if (type === 6) {
      r = px[s]!;
      g = px[s + 1]!;
      bl = px[s + 2]!;
      alpha = px[s + 3]!;
    } else {
      const idx = px[s]!;
      r = palette![idx * 3] ?? 0;
      g = palette![idx * 3 + 1] ?? 0;
      bl = palette![idx * 3 + 2] ?? 0;
      if (trns && idx < trns.length) alpha = trns[idx]!;
    }
    rgb[p * 3] = over(r, alpha);
    rgb[p * 3 + 1] = over(g, alpha);
    rgb[p * 3 + 2] = over(bl, alpha);
  }
  return { width, height, colorSpace: 'DeviceRGB', filter: 'FlateDecode', data: deflateSync(rgb) };
}

/** The box an image fits into, keeping its shape. */
export function fitInto(
  img: { width: number; height: number },
  maxW: number,
  maxH: number,
): {
  w: number;
  h: number;
} {
  const s = Math.min(maxW / img.width, maxH / img.height);
  return { w: Math.round(img.width * s * 100) / 100, h: Math.round(img.height * s * 100) / 100 };
}
