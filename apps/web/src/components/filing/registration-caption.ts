import type { TreeRegistration } from '@hsdg/contracts';

const KIND: Record<string, string> = {
  gstin: 'GSTIN',
  tan: 'TAN',
  cin: 'CIN',
  llpin: 'LLPIN',
  iec: 'IEC',
  pt: 'PT',
  esic: 'ESIC',
  pf: 'PF',
};

/**
 * What a stream tab says about its one registration: the kind, the number
 * once, then the state and scheme (GST). The API's `label` already starts
 * with the number, so it is not printed beside it. Pure — tested.
 */
export function registrationCaption(
  r: Pick<TreeRegistration, 'type' | 'number' | 'stateCode' | 'gstScheme'>,
): {
  kind: string | null;
  number: string;
  extra: string | null;
} {
  const extra = [r.stateCode, r.gstScheme].filter(Boolean).join(' · ');
  return { kind: KIND[r.type] ?? null, number: r.number, extra: extra || null };
}
