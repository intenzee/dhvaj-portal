'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Trash2, Upload } from 'lucide-react';
import {
  FIRM_LOGO_MAX_BYTES,
  FIRM_PROFILE_FIELDS,
  PERMISSION,
  type FirmInvoiceProfile,
  type FirmLogoType,
  type FirmProfileField,
  type UpdateFirmInvoiceProfileInput,
} from '@hsdg/contracts';
import { ApiError, apiFetch, fetchBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { Field, Input } from '@/components/form';

export const FIRM_FIELD_LABEL: Record<FirmProfileField, string> = {
  pan: 'PAN',
  phone: 'Phone',
  website: 'Website',
  bankAccountName: 'Account name',
  bankName: 'Bank',
  bankAccountNumber: 'Account number',
  bankIfsc: 'IFSC',
  bankBranch: 'Branch',
  upiId: 'UPI ID',
};

type Form = Record<FirmProfileField, string>;

export function firmForm(p: FirmInvoiceProfile): Form {
  return Object.fromEntries(FIRM_PROFILE_FIELDS.map((k) => [k, p[k] ?? ''])) as Form;
}

/** Only the fields that changed; blank clears one (null). Pure — tested. */
export function firmProfileChanges(
  before: FirmInvoiceProfile,
  form: Form,
): UpdateFirmInvoiceProfileInput {
  const out: UpdateFirmInvoiceProfileInput = {};
  for (const k of FIRM_PROFILE_FIELDS) {
    const v = form[k].trim() || null;
    if (v !== (before[k] ?? null)) out[k] = v;
  }
  return out;
}

/** Why a file cannot be the logo, or null. Pure — tested. */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    return 'The logo must be a PNG or a JPEG.';
  }
  if (file.size > FIRM_LOGO_MAX_BYTES) return 'The logo is over 500 KB; make it smaller.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(file);
  });
}

const PROFILE_KEY = ['billing', 'firm-profile'] as const;

/**
 * Quick invoices · the firm in full on its invoices: PAN, phone, website,
 * bank account and UPI (printed in a "Bank details" block), and the logo at
 * the top. Partners change it; everyone billing sees it.
 */
export function FirmProfileCard(): JSX.Element | null {
  const { principal } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const mayEdit = can(principal, PERMISSION.billingApprove);
  const profile = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => apiFetch<FirmInvoiceProfile>('/billing/firm-profile'),
  });
  const p = profile.data;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The logo preview: an object URL of the stored image.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const logoType = p?.logoContentType ?? null;
  useEffect(() => {
    if (!logoType) {
      setLogoUrl(null);
      return;
    }
    let url: string | null = null;
    let live = true;
    fetchBlob('/billing/firm-profile/logo')
      .then(({ blob }) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setLogoUrl(url);
      })
      .catch(() => setLogoUrl(null));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [logoType, profile.dataUpdatedAt]);

  const onSaved = (next: FirmInvoiceProfile, msg: string): void => {
    qc.setQueryData(PROFILE_KEY, next);
    toast(msg);
  };
  const save = useMutation({
    mutationFn: (body: UpdateFirmInvoiceProfileInput) =>
      apiFetch<FirmInvoiceProfile>('/billing/firm-profile', { method: 'PATCH', body }),
    onSuccess: (next) => {
      onSaved(next, 'Firm details saved — new invoices carry them.');
      setEditing(false);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'),
  });
  const upload = useMutation({
    mutationFn: async (file: File) =>
      apiFetch<FirmInvoiceProfile>('/billing/firm-profile/logo', {
        method: 'PUT',
        body: { contentType: file.type as FirmLogoType, contentBase64: await readBase64(file) },
      }),
    onSuccess: (next) => onSaved(next, 'Logo saved — new invoices carry it.'),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not upload the logo.', 'error'),
  });
  const removeLogo = useMutation({
    mutationFn: () =>
      apiFetch<FirmInvoiceProfile>('/billing/firm-profile/logo', { method: 'DELETE' }),
    onSuccess: (next) => onSaved(next, 'Logo taken off the invoices.'),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove it.', 'error'),
  });

  if (!p) return null;
  const f = form ?? firmForm(p);
  const changes = firmProfileChanges(p, f);

  const pickLogo = (file: File | undefined): void => {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) toast(problem, 'error');
    else upload.mutate(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const bank = [p.bankAccountName, p.bankName, p.bankBranch].filter(Boolean).join(' · ');
  const account = [
    p.bankAccountNumber ? `A/c ${p.bankAccountNumber}` : null,
    p.bankIfsc ? `IFSC ${p.bankIfsc}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card className="mb-4" data-testid="firm-profile">
      <CardHeader className="flex items-center justify-between">
        <CardTitle>The firm on its invoices</CardTitle>
        {mayEdit && !editing && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setForm(firmForm(p));
              setEditing(true);
            }}
          >
            Change
          </Button>
        )}
      </CardHeader>
      <CardBody>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex w-full shrink-0 flex-col items-start gap-2 sm:w-40">
            <div className="flex h-20 w-40 items-center justify-center rounded-md border border-line bg-surface-raised">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Firm logo" className="max-h-16 max-w-[9rem] object-contain" />
              ) : (
                <span className="flex items-center gap-1 text-xs text-ink-faint">
                  <ImageIcon className="h-4 w-4" /> No logo
                </span>
              )}
            </div>
            {mayEdit && (
              <div className="flex gap-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  aria-label="Logo file"
                  onChange={(e) => pickLogo(e.target.files?.[0])}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={upload.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> {logoUrl ? 'Replace' : 'Upload logo'}
                </Button>
                {logoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove logo"
                    disabled={removeLogo.isPending}
                    onClick={() => removeLogo.mutate()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>

          {!editing ? (
            <dl className="grid flex-1 grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Item label="Firm" value={p.firmName} />
              <Item label="PAN" value={p.pan} />
              <Item label="FRN" value={p.frn} />
              <Item label="Phone" value={p.phone} />
              <Item label="E-mail" value={p.email} />
              <Item label="Website" value={p.website} />
              <div className="col-span-full">
                <Item label="Address" value={p.address} />
              </div>
              <div className="col-span-2">
                <Item label="Bank" value={[bank, account].filter(Boolean).join(' — ') || null} />
              </div>
              <Item label="UPI" value={p.upiId} />
              {!p.bankAccountNumber && (
                <p className="col-span-full text-xs text-ink-faint">
                  Add the bank account so clients see where to pay on every invoice.
                </p>
              )}
            </dl>
          ) : (
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              {FIRM_PROFILE_FIELDS.map((k) => (
                <Field key={k} label={FIRM_FIELD_LABEL[k]}>
                  <Input
                    value={f[k]}
                    onChange={(e) => setForm({ ...f, [k]: e.target.value })}
                    maxLength={k === 'pan' ? 10 : k === 'bankIfsc' ? 11 : 200}
                  />
                </Field>
              ))}
              <p className="col-span-full text-xs text-ink-faint">
                Firm name, address, GSTIN, FRN and e-mail come from the firm’s settings.
              </p>
              <div className="col-span-full flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => save.mutate(changes)}
                  disabled={save.isPending || Object.keys(changes).length === 0}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
        {!mayEdit && (
          <p className="mt-3 text-xs text-ink-faint">A partner changes these details and the logo.</p>
        )}
      </CardBody>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="break-words text-ink">{value || '—'}</dd>
    </div>
  );
}
