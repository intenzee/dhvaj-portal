import {
  FEE_PERIOD_UNIT,
  GST_STATES,
  cleanPan,
  firmTypeFromIds,
  panFromGstins,
  readGstin,
  withCompanySuffix,
  type DataCheck,
  type DataCheckRow,
  type FeePeriod,
} from '@hsdg/contracts';
import { registrationState } from './registration-state';

/** One live client as the data check reads it (RLS-scoped). */
export interface CheckClient {
  id: string;
  code: string | null;
  name: string;
  pan: string | null;
  typeSlug: string;
  typeSource: string;
  teamId: string | null;
  registrations: {
    id: string;
    type: string;
    number: string;
    status: string;
    stateCode: string | null;
    acked: boolean;
  }[];
  addresses: { id: string; state: string | null; stateCode: string | null; country: string }[];
  /** Open years with a fee whose period nobody has confirmed. */
  fees: { engagementId: string; fy: string; amount: string; period: FeePeriod; version: number }[];
}

export interface CheckTeam {
  id: string;
  name: string;
}

/** What apply does for a row: the same input the forms send. */
export type CheckFix =
  | { kind: 'state'; registrationId: string; stateCode: string }
  | { kind: 'type'; slug: string; current: string }
  | { kind: 'name'; legalName: string }
  | { kind: 'fees'; years: { engagementId: string; fy: string; version: number }[] }
  | { kind: 'team' };

export type CheckRow = DataCheckRow & { fix?: CheckFix };

export interface CheckInput {
  clients: CheckClient[];
  teams: CheckTeam[];
  /** entity_types slug → name. */
  typeNames: Record<string, string>;
}

const CLIENT_HREF = (id: string): string => `/entities/${id}`;
const stateLabel = (code: string | null): string =>
  code ? (GST_STATES[code] ? `${code} ${GST_STATES[code]}` : code) : 'none';
const inr = (amount: string): string => `₹${Number(amount).toLocaleString('en-IN')}`;

function base(
  c: CheckClient,
  suffix = '',
): Pick<CheckRow, 'id' | 'entityId' | 'code' | 'name' | 'href'> {
  return {
    id: suffix ? `${c.id}:${suffix}` : c.id,
    entityId: c.id,
    code: c.code,
    name: c.name,
    href: CLIENT_HREF(c.id),
  };
}

const liveGstins = (c: CheckClient): CheckClient['registrations'] =>
  c.registrations.filter((r) => r.type === 'gstin' && r.status !== 'cancelled');

/**
 * CM-9 · every row of one check, sorted by client name. Pure — tested; the
 * service loads the clients under the caller's RLS and applies `fix`.
 */
export function dataCheckRows(check: DataCheck, input: CheckInput): CheckRow[] {
  const typeName = (slug: string): string => input.typeNames[slug] ?? slug;
  const holders = new Map<string, CheckClient>();
  for (const c of input.clients) {
    const pan = cleanPan(c.pan);
    if (pan) holders.set(pan, c);
  }
  const rows: CheckRow[] = [];

  for (const c of input.clients) {
    const pan = cleanPan(c.pan);
    switch (check) {
      case 'gstin_other_pan': {
        if (!pan) break;
        const gstins = liveGstins(c);
        const agreed = panFromGstins(gstins.map((g) => g.number));
        for (const r of gstins) {
          const read = readGstin(r.number);
          if (!read.pan || read.pan === pan) continue;
          const holder = holders.get(read.pan);
          rows.push({
            ...base(c, r.id),
            problem: `GSTIN ${read.gstin} carries PAN ${read.pan}; the client's PAN is ${pan}.`,
            current: read.gstin,
            proposed:
              holder && holder.id !== c.id
                ? `Move it to ${holder.code ?? ''} ${holder.name}`.replace(/\s+/g, ' ')
                : agreed && agreed !== pan
                  ? `Correct the PAN to ${agreed}`
                  : 'Open the client to correct it',
            canApply: false,
          });
        }
        break;
      }
      case 'gstin_invalid':
        for (const r of liveGstins(c)) {
          const read = readGstin(r.number);
          if (read.valid) continue;
          rows.push({
            ...base(c, r.id),
            problem: `GSTIN ${r.number} is not a valid GSTIN.`,
            current: r.number,
            proposed: 'Open the client to correct it',
            canApply: false,
          });
        }
        break;
      case 'state':
        for (const r of c.registrations) {
          if (r.status === 'cancelled') continue;
          const read = r.type === 'gstin' ? readGstin(r.number) : null;
          const prefix = read?.stateName ? read.stateCode : null;
          const unreadable = !!r.stateCode && !GST_STATES[r.stateCode];
          const missing = !r.stateCode && !!prefix;
          const mismatch =
            !unreadable && !r.acked && !!registrationState(r.type, r.number, r.stateCode).mismatch;
          if (!unreadable && !missing && !mismatch) continue;
          rows.push({
            ...base(c, r.id),
            problem: unreadable
              ? `State "${r.stateCode}" on ${r.number} is not a GST state.`
              : missing
                ? `${r.number} has no state.`
                : `${r.number} starts with ${prefix} but the state is ${stateLabel(r.stateCode)}.`,
            current: stateLabel(r.stateCode),
            proposed: prefix ? stateLabel(prefix) : 'Open the client to pick the state',
            canApply: !!prefix,
            ...(prefix
              ? { fix: { kind: 'state' as const, registrationId: r.id, stateCode: prefix } }
              : {}),
          });
        }
        break;
      case 'address_state':
        for (const a of c.addresses) {
          const text = a.state?.trim();
          if (a.stateCode || !text || a.country !== 'IN' || /^outside india$/i.test(text)) continue;
          rows.push({
            ...base(c, a.id),
            problem: `Address state "${text}" is not a GST state.`,
            current: text,
            proposed: 'Open the client to pick the state',
            canApply: false,
          });
        }
        break;
      case 'firm_type': {
        if (c.typeSource !== 'legacy') break;
        const gstins = liveGstins(c).map((g) => g.number);
        const says = firmTypeFromIds({
          pan: c.pan,
          gstins,
          nameOrTypedType: c.name,
          hasBusinessRegistration: gstins.length > 0,
        });
        if (!says || says.slug === c.typeSlug) break;
        rows.push({
          ...base(c),
          problem: says.reason,
          current: typeName(c.typeSlug),
          proposed: typeName(says.slug),
          canApply: true,
          fix: { kind: 'type', slug: says.slug, current: c.typeSlug },
        });
        break;
      }
      case 'company_name': {
        const named = withCompanySuffix(c.name, c.typeSlug);
        if (named === c.name) break;
        rows.push({
          ...base(c),
          problem: 'A private limited company whose name does not say so.',
          current: c.name,
          proposed: named,
          canApply: true,
          fix: { kind: 'name', legalName: named },
        });
        break;
      }
      case 'fee_period': {
        if (c.fees.length === 0) break;
        rows.push({
          ...base(c),
          problem: `${c.fees.length} open year${c.fees.length === 1 ? '' : 's'} with a fee whose period nobody confirmed.`,
          current: c.fees
            .map((f) => `FY ${f.fy}: ${inr(f.amount)} per ${FEE_PERIOD_UNIT[f.period]}`)
            .join('; '),
          proposed: c.fees.every((f) => f.period === 'annual')
            ? 'Confirm per year'
            : 'Open the client to set the period',
          canApply: c.fees.every((f) => f.period === 'annual'),
          fix: {
            kind: 'fees',
            years: c.fees.map((f) => ({
              engagementId: f.engagementId,
              fy: f.fy,
              version: f.version,
            })),
          },
        });
        break;
      }
      case 'client_without_team':
        if (c.teamId) break;
        rows.push({
          ...base(c),
          problem: 'No client team looks after this client.',
          current: null,
          proposed: 'Assign a team',
          canApply: true,
          fix: { kind: 'team' },
        });
        break;
      default:
        break;
    }
  }

  if (check === 'team_without_partner') {
    for (const t of input.teams) {
      rows.push({
        id: t.id,
        entityId: null,
        code: null,
        name: t.name,
        problem: 'The team has no overseeing partner.',
        current: null,
        proposed: 'Open the team and add one',
        href: `/people/teams/${t.id}`,
        canApply: false,
      });
    }
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** One CSV line per row, for the partners. */
export function dataCheckCsv(rows: DataCheckRow[]): string {
  const cell = (v: string | null): string => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Code', 'Client', 'Problem', 'Current', 'Proposed fix'].join(',')];
  for (const r of rows)
    lines.push([r.code, r.name, r.problem, r.current, r.proposed].map(cell).join(','));
  return `${lines.join('\n')}\n`;
}
