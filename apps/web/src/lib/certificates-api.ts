/**
 * Practice Services PS-402 — the certificates desk: the API calls in one place.
 */
import type {
  Certificate,
  CertificateRegisterRow,
  CertificateStatus,
  CertificateTemplate,
  CreateCertificateInput,
  RecordForm15caInput,
  ReviewCertificateInput,
  RevokeCertificateInput,
  SignCertificateInput,
  UpdateCertificateInput,
} from '@hsdg/contracts';
import { apiFetch } from './api';

export const certificatesKey = ['certificates'] as const;

export interface CertificateRegisterFilters {
  search: string;
  status: CertificateStatus | '';
  template: string;
}

/** The register path for these filters (empty ones left out). Pure — tested. */
export function certificateRegisterPath(f: CertificateRegisterFilters): string {
  const p = new URLSearchParams();
  if (f.search.trim()) p.set('search', f.search.trim());
  if (f.status) p.set('status', f.status);
  if (f.template) p.set('template', f.template);
  const q = p.toString();
  return `/registers/certificates${q ? `?${q}` : ''}`;
}

export const fetchCertificateTemplates = () =>
  apiFetch<CertificateTemplate[]>('/certificates/templates');
export const fetchCertificateRegister = (f: CertificateRegisterFilters) =>
  apiFetch<CertificateRegisterRow[]>(certificateRegisterPath(f));
export const fetchCertificates = (engagementId: string) =>
  apiFetch<Certificate[]>(`/engagements/${engagementId}/certificates`);

const one = (engagementId: string, id: string) => `/engagements/${engagementId}/certificates/${id}`;
export const certificatePdfPath = (engagementId: string, id: string) =>
  `${one(engagementId, id)}/pdf`;

export const createCertificate = (engagementId: string, body: CreateCertificateInput) =>
  apiFetch<Certificate>(`/engagements/${engagementId}/certificates`, { method: 'POST', body });
export const updateCertificate = (c: Certificate, body: Omit<UpdateCertificateInput, 'version'>) =>
  apiFetch<Certificate>(one(c.engagementId, c.id), {
    method: 'PATCH',
    body: { ...body, version: c.version },
  });

type Step =
  | { to: 'submit' | 'issue' }
  | { to: 'review'; body: Omit<ReviewCertificateInput, 'version'> }
  | { to: 'sign'; body: Omit<SignCertificateInput, 'version'> }
  | { to: 'revoke'; body: Omit<RevokeCertificateInput, 'version'> }
  | { to: 'form-15ca'; body: Omit<RecordForm15caInput, 'version'> };

/** One step of the certificate's flow, against the version on screen. */
export const certificateStep = (c: Certificate, step: Step) =>
  apiFetch<Certificate>(`${one(c.engagementId, c.id)}/${step.to}`, {
    method: 'POST',
    body: { version: c.version, ...('body' in step ? step.body : {}) },
  });
