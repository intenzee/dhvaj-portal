import type {
  ClientKyc,
  CompleteClientKycInput,
  KycRegisterResponse,
  KycSettings,
  SaveClientKycInput,
  UpdateKycSettingsInput,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';

/** PS-404 · client KYC: the client's record, the register and the firm's rules. */
export const clientKycKey = (entityId: string) => ['entity', entityId, 'kyc'] as const;
export const KYC_REGISTER_KEY = ['client-kyc'] as const;

export const fetchClientKyc = (entityId: string) =>
  apiFetch<ClientKyc>(`/entities/${entityId}/kyc`);

export const saveClientKyc = (entityId: string, body: SaveClientKycInput) =>
  apiFetch<ClientKyc>(`/entities/${entityId}/kyc`, { method: 'PUT', body });

export const completeClientKyc = (entityId: string, body: CompleteClientKycInput) =>
  apiFetch<ClientKyc>(`/entities/${entityId}/kyc/complete`, { method: 'POST', body });

export function fetchKycRegister(q: {
  status?: string;
  risk?: string;
  search?: string;
}): Promise<KycRegisterResponse> {
  const p = new URLSearchParams({ limit: '500' });
  if (q.status) p.set('status', q.status);
  if (q.risk) p.set('risk', q.risk);
  if (q.search?.trim()) p.set('search', q.search.trim());
  return apiFetch<KycRegisterResponse>(`/client-kyc?${p.toString()}`);
}

export const fetchKycSettings = () => apiFetch<KycSettings>('/client-kyc/settings');

export const updateKycSettings = (body: UpdateKycSettingsInput) =>
  apiFetch<KycSettings>('/client-kyc/settings', { method: 'PATCH', body });
