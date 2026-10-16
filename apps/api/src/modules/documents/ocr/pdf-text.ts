import { extractText, getDocumentProxy } from 'unpdf';

/** The most a local text read takes on: past this the PDF waits for Document Intelligence. */
export const PDF_TEXT_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_TEXT_MAX_PAGES = 20;
/** Fewer visible characters than this and the PDF is a scan, not text (PS-104). */
const MIN_TEXT_CHARS = 40;

/**
 * The text layer of a digitally generated PDF — what the GST portal and the
 * income-tax e-proceedings issue — read locally, with no OCR service. Null
 * for a scan (no text layer), an oversized or unreadable file. Never throws.
 */
export async function pdfTextLayer(bytes: Buffer | Uint8Array): Promise<string | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > PDF_TEXT_MAX_BYTES) return null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (pdf.numPages > PDF_TEXT_MAX_PAGES) return null;
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join('\n') : text;
      return merged.replace(/\s/g, '').length >= MIN_TEXT_CHARS ? merged : null;
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch {
    return null;
  }
}
