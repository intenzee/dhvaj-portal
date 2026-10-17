import { Injectable } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';

/** A Form 26AS runs to a few pages a year; a Form 16A to two. */
const TDS_PDF_MAX_PAGES = 40;
/** Fewer visible characters than this and the PDF is a scan, not text. */
const MIN_TEXT_CHARS = 40;

export type TdsPdfText =
  | { kind: 'text'; text: string }
  /** Encrypted, and no password or the wrong one was given. */
  | { kind: 'password'; wrong: boolean }
  /** A scan, too long, or not a PDF pdf.js can open. */
  | { kind: 'unreadable' };

/**
 * PS-204 · the text layer of a TRACES PDF. TRACES encrypts the 26AS and
 * Form 16A PDFs with the PAN holder's date of birth or incorporation
 * (DDMMYYYY), so unlike the document reader this one takes a password and
 * says when it needs one. The password is used here and nowhere else — never
 * stored or logged. A provider, so e2e can stand in for pdf.js (which does not
 * run under jest's VM).
 */
@Injectable()
export class TdsPdfReader {
  async read(bytes: Buffer, password?: string): Promise<TdsPdfText> {
    let pdf;
    try {
      pdf = await getDocumentProxy(new Uint8Array(bytes), password ? { password } : {});
    } catch (err) {
      // pdf.js: PasswordException, code 1 = needs one, 2 = incorrect.
      const e = err as { name?: string; code?: number };
      if (e?.name === 'PasswordException') return { kind: 'password', wrong: e.code === 2 };
      return { kind: 'unreadable' };
    }
    try {
      if (pdf.numPages > TDS_PDF_MAX_PAGES) return { kind: 'unreadable' };
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join('\n') : text;
      return merged.replace(/\s/g, '').length >= MIN_TEXT_CHARS
        ? { kind: 'text', text: merged }
        : { kind: 'unreadable' };
    } catch {
      return { kind: 'unreadable' };
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
}
