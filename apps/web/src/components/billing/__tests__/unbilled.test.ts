import type { BillingSettings, UnbilledEngagement, UnbilledItem } from '@hsdg/contracts';
import { settingsChanges } from '../billing-settings';
import {
  ageLine,
  partnersOf,
  selectedTotal,
  setAsideLine,
  setAsideProblem,
  waiverLine,
} from '../unbilled';

const item = (key: string, amount: string, ageDays = 0) =>
  ({ key, amount, ageDays }) as UnbilledItem;

describe('PS-206 unbilled fees', () => {
  it('totals the ticked periods only', () => {
    const items = [item('a', '20000.00'), item('b', '20000.00'), item('c', '1.50')];
    expect(selectedTotal(items, new Set(['a', 'c']))).toBe('20001.50');
    expect(selectedTotal(items, new Set())).toBe('0.00');
  });

  it('says how long ago the period ended', () => {
    expect(ageLine(item('a', '1', 0))).toBe('Running');
    expect(ageLine(item('a', '1', 1))).toBe('Ended 1 day ago');
    expect(ageLine(item('a', '1', 47))).toBe('Ended 47 days ago');
  });

  it('lists each partner once, by name', () => {
    const rows = [
      { partnerId: 'b', partnerName: 'Zoya' },
      { partnerId: 'a', partnerName: 'Arun' },
      { partnerId: 'b', partnerName: 'Zoya' },
      { partnerId: null, partnerName: null },
    ] as UnbilledEngagement[];
    expect(partnersOf(rows)).toEqual([
      { id: 'a', name: 'Arun' },
      { id: 'b', name: 'Zoya' },
    ]);
  });

  it('says how a period was set aside: the outside invoice, or not billed and why', () => {
    const by = { byName: 'Asha Rao', at: '2026-10-03T10:00:00Z' };
    expect(
      setAsideLine({
        kind: 'billed_outside',
        externalInvoiceNumber: 'TALLY/0412',
        externalInvoiceDate: '2026-04-30',
        reason: 'Billed outside the app: TALLY/0412 of 2026-04-30',
        ...by,
      }),
    ).toBe('Invoice TALLY/0412 of 30 Apr 2026 — Asha Rao, 03 Oct 2026');
    expect(
      setAsideLine({
        kind: 'not_billing',
        externalInvoiceNumber: null,
        externalInvoiceDate: null,
        reason: 'First month free',
        byName: null,
        at: '',
      }),
    ).toBe('Not billed: First month free');
    expect(
      setAsideLine({
        kind: null,
        externalInvoiceNumber: null,
        externalInvoiceDate: null,
        reason: 'Billed in Tally',
        ...by,
      }),
    ).toBe('Billed in Tally — Asha Rao, 03 Oct 2026');
  });

  it('names the waived periods and who asked', () => {
    expect(
      waiverLine({
        periods: [
          { key: 'a', label: 'July 2026', periodStart: '', periodEnd: '', amount: '1' },
          { key: 'b', label: 'August 2026', periodStart: '', periodEnd: '', amount: '1' },
        ],
        requestedByName: 'Asha Rao',
        at: '2026-10-03T10:00:00Z',
        reason: 'First two months free',
      }),
    ).toBe('July 2026, August 2026 · asked by Asha Rao, 03 Oct 2026: First two months free');
  });

  it('a set-aside names the outside invoice; not billing needs a reason', () => {
    const f = { kind: 'billed_outside' as const, reason: '', number: '', date: '' };
    expect(setAsideProblem(f, '2026-10-17')).toMatch(/number/);
    expect(setAsideProblem({ ...f, number: 'T/1' }, '2026-10-17')).toMatch(/date/);
    expect(setAsideProblem({ ...f, number: 'T/1', date: '2026-10-18' }, '2026-10-17')).toMatch(
      /after today/,
    );
    expect(setAsideProblem({ ...f, number: 'T/1', date: '2026-10-17' }, '2026-10-17')).toBeNull();
    const n = { ...f, kind: 'not_billing' as const };
    expect(setAsideProblem({ ...n, reason: 'free  ' }, '2026-10-17')).toMatch(/10 characters/);
    expect(setAsideProblem({ ...n, reason: 'First month free' }, '2026-10-17')).toBeNull();
  });

  it('the billing go-live is sent only when changed, and cleared as null', () => {
    const before = { version: 4, billingFrom: null } as unknown as BillingSettings;
    const form = {
      gstin: '',
      stateCode: '',
      sacDefault: '998221',
      invoicePrefix: 'INV',
      invoiceTermsDays: '15',
    };
    const pick = (o: Record<string, unknown>) => ({ version: o.version, billingFrom: o.billingFrom });
    expect(pick(settingsChanges(before, { ...form, billingFrom: '' }))).toEqual({
      version: 4,
      billingFrom: undefined,
    });
    expect(pick(settingsChanges(before, { ...form, billingFrom: '2026-04-01' }))).toEqual({
      version: 4,
      billingFrom: '2026-04-01',
    });
    const set = { ...before, billingFrom: '2026-04-01' };
    expect(pick(settingsChanges(set, { ...form, billingFrom: '' }))).toEqual({
      version: 4,
      billingFrom: null,
    });
  });
});
