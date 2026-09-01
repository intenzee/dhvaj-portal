/**
 * Classify a document by its MIME type and/or filename extension, and small
 * helpers for moving bytes between the API (base64) and the in-browser editors.
 * Editing is offered only for kinds we can faithfully round-trip: spreadsheets
 * (SheetJS) and Word .docx (mammoth → rich text → docx).
 */

export type FileKind = 'pdf' | 'image' | 'excel' | 'word' | 'csv' | 'text' | 'other';

/** Canonical MIME types we write back when saving an edited file. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const CSV_MIME = 'text/csv';

function ext(filename: string | null | undefined): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function detectKind(contentType: string | null | undefined, filename: string | null | undefined): FileKind {
  const ct = (contentType ?? '').toLowerCase();
  const e = ext(filename);

  if (ct === 'application/pdf' || e === 'pdf') return 'pdf';
  if (ct.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(e)) {
    return 'image';
  }
  if (ct === CSV_MIME || e === 'csv') return 'csv';
  if (
    ct.includes('spreadsheetml') ||
    ct === 'application/vnd.ms-excel' ||
    ['xlsx', 'xls', 'xlsm', 'ods'].includes(e)
  ) {
    return 'excel';
  }
  // Only the modern XML .docx is editable (mammoth cannot read legacy binary .doc).
  if (ct.includes('wordprocessingml') || e === 'docx') return 'word';
  if (
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    ['txt', 'md', 'markdown', 'json', 'log', 'xml', 'yaml', 'yml', 'csv'].includes(e)
  ) {
    return 'text';
  }
  return 'other';
}

/** Kinds that can be edited in-app and saved back as a new version. */
export function isEditable(kind: FileKind): boolean {
  return kind === 'excel' || kind === 'word' || kind === 'csv' || kind === 'text';
}

/** Encode a Blob as base64 (without the data: URI prefix), matching the upload API. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not encode the file.'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
