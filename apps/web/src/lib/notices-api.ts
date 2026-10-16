/**
 * The notice register's API calls (PS-101 … PS-105), in one place so a path
 * the API names differently is a one-line change.
 */
import type {
  AddNoticeEventRequest,
  AppealNoticeRequest,
  AppealNoticeResponse,
  CloseNoticeRequest,
  CreateNoticeRequest,
  Notice,
  NoticeIntakeResponse,
  NoticeListResponse,
  NoticeType,
  NoticesReport,
  UpdateNoticeRequest,
  UpsertNoticeTypeRequest,
  VoidNoticeEventRequest,
} from '@hsdg/contracts';
import { apiFetch } from './api';

export const noticesKey = ['notices'] as const;
export const noticeKey = (id: string) => ['notices', 'one', id] as const;
export const noticeTypesKey = ['notice-types'] as const;

export const noticeTypesQuery = {
  queryKey: noticeTypesKey,
  queryFn: () => apiFetch<NoticeType[]>('/notice-types'),
  staleTime: 5 * 60 * 1000,
};

export const fetchNotices = (path: string) => apiFetch<NoticeListResponse>(path);
export const fetchNotice = (id: string) => apiFetch<Notice>(`/notices/${id}`);

export const createNotice = (body: CreateNoticeRequest) =>
  apiFetch<Notice>('/notices', { method: 'POST', body });
export const updateNotice = (id: string, body: UpdateNoticeRequest) =>
  apiFetch<Notice>(`/notices/${id}`, { method: 'PATCH', body });
export const addNoticeEvent = (id: string, body: AddNoticeEventRequest) =>
  apiFetch<Notice>(`/notices/${id}/events`, { method: 'POST', body });
export const voidNoticeEvent = (id: string, eventId: string, body: VoidNoticeEventRequest) =>
  apiFetch<Notice>(`/notices/${id}/events/${eventId}/void`, { method: 'POST', body });
export const closeNotice = (id: string, body: CloseNoticeRequest) =>
  apiFetch<Notice>(`/notices/${id}/close`, { method: 'POST', body });
export const appealNotice = (id: string, body: AppealNoticeRequest) =>
  apiFetch<AppealNoticeResponse>(`/notices/${id}/appeal`, { method: 'POST', body });
export const noticeIntake = (documentId: string) =>
  apiFetch<NoticeIntakeResponse>('/notices/intake', { method: 'POST', body: { documentId } });
export const upsertNoticeType = (code: string, body: UpsertNoticeTypeRequest) =>
  apiFetch<NoticeType>(`/notice-types/${encodeURIComponent(code)}`, { method: 'PUT', body });
export const fetchNoticesReport = (officeId: string) =>
  apiFetch<NoticesReport>(
    `/reports/notices${officeId ? `?officeId=${encodeURIComponent(officeId)}` : ''}`,
  );

/** Read a File as base64 (without the data: prefix) and its content type. */
function readFileBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        base64: result.slice(result.indexOf(',') + 1),
        contentType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  });
}

export type NoticeDocumentType = 'notice' | 'reply' | 'order';

/**
 * File a notice's PDF (the notice, the reply filed, the order) through the
 * engagement's document upload — POST /engagements/:id/documents with
 * `documentType` and, once the notice exists, `noticeId` (the API files it
 * under the notice). Returns the new document's id.
 */
export async function uploadNoticeDocument(input: {
  engagementId: string;
  file: File;
  documentType: NoticeDocumentType;
  noticeId?: string | null;
  title?: string;
}): Promise<{ id: string }> {
  const { base64, contentType } = await readFileBase64(input.file);
  return apiFetch<{ id: string }>(`/engagements/${input.engagementId}/documents`, {
    method: 'POST',
    body: {
      title: input.title?.trim() || input.file.name.replace(/\.[^.]+$/, '') || input.file.name,
      documentType: input.documentType,
      classification: 'internal',
      filename: input.file.name,
      contentType,
      contentBase64: base64,
      ...(input.noticeId ? { noticeId: input.noticeId } : {}),
    },
  });
}

/** Soft-delete a PDF filed on the wrong engagement by the intake (restorable, audited). */
export const withdrawUpload = (engagementId: string, documentId: string) =>
  apiFetch(`/engagements/${engagementId}/documents/${documentId}/delete`, {
    method: 'POST',
    body: { reason: 'Notice PDF filed on the wrong engagement; re-filed on the right one.' },
  });

export const noticeDocumentDownloadPath = (engagementId: string, documentId: string) =>
  `/engagements/${engagementId}/documents/${documentId}/download`;
