/**
 * Tax audit drafts from portal data (Phase 4, F-6; plan F.3 "Using what the
 * portal already knows"). The firm often already files the client's GST and
 * TDS and may have done last year's tax audit, so those clauses open with a
 * first draft instead of a blank form:
 *
 *   1–8         client master: entity, PAN, status, address, registrations,
 *               the year, and the year's s.44AB applicability decision
 *   34          the TDS and TCS returns the firm filed for the year
 *   27, 44      the GST returns the firm filed for the year
 *   18, 32, 40  last year's tax audit of the client (its done answers)
 *   22, 26      the MSME supplier list, once the client has sent it
 *
 * Any other clause, or one whose own source is empty, carries last year's
 * answer when last year's tax audit answered it on the same Act's form
 * (F-10: "last year's answers are copied in as drafts").
 *
 * Every draft says where it came from and the preparer must confirm it; a
 * clause whose source has nothing yet gets no draft, so nothing blocks review
 * for nothing. The builders are pure; applyDrafts() writes them.
 */
import type { PoolClient } from 'pg';
import {
  answerProblems,
  type TaxAuditAnswer,
  type TaxAuditAnswerValue,
  type TaxAuditDraftSource,
  type TaxAuditSubItem,
} from '@hsdg/contracts';

export interface DraftFiling {
  stream: 'gst' | 'tds';
  form: string;
  registration: string | null;
  periodKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  filedOn: string;
  isNil: boolean;
  figures: Record<string, string | number | null> | null;
  lateFee: number | string | null;
  interest: number | string | null;
}

/** What hsdg.tax_audit_draft_sources() returns for an audit. */
export interface DraftSources {
  financialYear: string;
  master: {
    legalName: string;
    pan: string | null;
    typeSlug: string | null;
    typeName: string | null;
    typeCategory: string | null;
    incorporationDate: string | null;
    address: string | null;
  } | null;
  registrations: { type: string; number: string; state: string | null }[];
  applicability: { applicable: boolean | null; clause: string | null } | null;
  filings: DraftFiling[];
  lastYear: {
    auditId: string;
    financialYear: string;
    /** Last year's library version; null when its 3CD work was never opened. */
    libraryVersionId: string | null;
    answers: Record<string, TaxAuditAnswer>;
  } | null;
  msme: { status: string; receivedDate: string | null } | null;
}

export interface ClauseDraft {
  source: TaxAuditDraftSource;
  answer: TaxAuditAnswer;
  note: string;
}

/**
 * The plan drafts clauses 1–8 from the client master; the F-4 library seed
 * names no source for clause 8 (the s.44AB clause), which the year's
 * applicability decision answers.
 */
export function draftSourceOf(
  clauseNo: string,
  librarySource: TaxAuditDraftSource | null,
): TaxAuditDraftSource | null {
  return librarySource ?? (clauseNo === '8' ? 'client_master' : null);
}

const NOTE_MAX = 1000;
const fyStart = (fy: string): string => `${fy.slice(0, 4)}-04-01`;
const fyEnd = (fy: string): string => `${Number(fy.slice(0, 4)) + 1}-03-31`;
/** "2025-26" → assessment year "2026-27". */
export function assessmentYear(fy: string): string {
  const y = Number(fy.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}
const day = (d: string | null): string => (d ? d.slice(0, 10) : '');
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const cell = (v: unknown): string => {
  const n = num(v);
  return n === null ? '' : String(n);
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const period = (f: DraftFiling): string =>
  f.periodKey ?? (f.periodStart ? `${day(f.periodStart)} to ${day(f.periodEnd)}` : '');

/** Form 3CD status, from the client master's entity type. */
const STATUS_BY_TYPE: Record<string, string> = {
  individual: 'Individual',
  proprietorship: 'Individual',
  huf: 'Hindu Undivided Family',
  partnership: 'Firm',
  llp: 'Firm (Limited Liability Partnership)',
  private_limited: 'Company',
  public_limited: 'Company',
  opc: 'Company',
  aop: 'Association of Persons',
};

const INDIRECT_REGISTRATION: Record<string, string> = { gstin: 'GSTIN', iec: 'IEC' };

function clientMaster(clauseNo: string, s: DraftSources): ClauseDraft | null {
  const m = s.master;
  if (!m) return null;
  const from = `From the client master (${m.legalName}).`;
  const out = (answer: TaxAuditAnswer, note = from): ClauseDraft => ({
    source: 'client_master',
    answer,
    note,
  });
  switch (clauseNo) {
    case '1':
      return out({ name: m.legalName });
    case '2':
      return m.address ? out({ address: m.address }) : null;
    case '3':
      return m.pan ? out({ pan: m.pan }) : null;
    case '4': {
      const rows = s.registrations.filter((r) => INDIRECT_REGISTRATION[r.type]);
      if (rows.length === 0) {
        return out({ liable: false }, `${from} It shows no GSTIN or IEC; check before confirming.`);
      }
      return out(
        {
          liable: true,
          registrations: rows
            .map((r) => [INDIRECT_REGISTRATION[r.type], r.number, r.state ?? ''].join('\t'))
            .join('\n'),
        },
        `${from} Columns: type, number, state.`,
      );
    }
    case '5': {
      const status = (m.typeSlug && STATUS_BY_TYPE[m.typeSlug]) ?? m.typeName;
      return status ? out({ status }) : null;
    }
    case '6': {
      const start = fyStart(s.financialYear);
      const inc = day(m.incorporationDate);
      const fromDay = inc && inc > start ? inc : start;
      return out(
        { from: fromDay, to: fyEnd(s.financialYear) },
        fromDay === start
          ? `The financial year ${s.financialYear}.`
          : `The financial year ${s.financialYear}, from incorporation on ${inc} (client master).`,
      );
    }
    case '7':
      return out(
        { ay: assessmentYear(s.financialYear) },
        `The assessment year for FY ${s.financialYear}.`,
      );
    case '8':
      return s.applicability?.applicable !== false && s.applicability?.clause
        ? out(
            { clause: s.applicability.clause },
            `From the year's tax audit applicability decision (s.${s.applicability.clause}).`,
          )
        : null;
    default:
      return null;
  }
}

function tdsFilings(clauseNo: string, s: DraftSources): ClauseDraft | null {
  if (clauseNo !== '34') return null;
  const tds = s.filings.filter((f) => f.stream === 'tds');
  if (tds.length === 0) return null;
  const answer: TaxAuditAnswer = {};
  const amounts = tds.filter(
    (f) => num(f.figures?.tax_deducted) !== null || num(f.figures?.tax_deposited) !== null,
  );
  if (amounts.length) {
    answer.a = amounts
      .map((f) =>
        [f.form, period(f), cell(f.figures?.tax_deducted), cell(f.figures?.tax_deposited)].join(
          '\t',
        ),
      )
      .join('\n');
  }
  answer.b = tds
    .map((f) =>
      [
        f.form,
        period(f),
        day(f.dueDate),
        day(f.filedOn),
        f.dueDate ? (day(f.filedOn) <= day(f.dueDate) ? 'Yes' : 'No') : '',
      ].join('\t'),
    )
    .join('\n');
  const interest = tds.filter((f) => (num(f.interest) ?? 0) > 0);
  if (interest.length) {
    answer.c = interest.map((f) => [f.form, period(f), cell(f.interest)].join('\t')).join('\n');
  }
  const late = tds.filter((f) => f.dueDate && day(f.filedOn) > day(f.dueDate)).length;
  return {
    source: 'tds_filings',
    answer,
    note: clip(
      `From the ${plural(tds.length, 'TDS/TCS return')} the firm filed for FY ${s.financialYear}` +
        (late ? `, ${late} after the due date` : '') +
        '. Columns — (a) form, period, tax deducted, tax deposited; (b) form, period, due date, ' +
        'date furnished, within time; (c) form, period, interest paid. Add the section-wise ' +
        'detail and any short deduction from the books.',
    ),
  };
}

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

function gstFilings(clauseNo: string, s: DraftSources): ClauseDraft | null {
  const gst = s.filings.filter((f) => f.stream === 'gst');
  if (gst.length === 0) return null;
  const itcOf = (f: DraftFiling): (number | null)[] =>
    HEADS.map((h) => num(f.figures?.[`itc_${h}`]));
  const withItc = gst.filter((f) => itcOf(f).some((v) => v !== null));
  const total = (f: DraftFiling): number => itcOf(f).reduce<number>((a, v) => a + (v ?? 0), 0);
  if (clauseNo === '27') {
    if (withItc.length === 0) return null;
    return {
      source: 'gst_filings',
      answer: {
        a: withItc
          .map((f) => [f.registration ?? '', f.form, period(f), ...itcOf(f).map(cell)].join('\t'))
          .join('\n'),
      },
      note: clip(
        `ITC used, from the ${plural(withItc.length, 'GST return')} the firm filed for FY ` +
          `${s.financialYear}. Columns: GSTIN, return, period, IGST, CGST, SGST, cess. ` +
          'Add its treatment in the books and any prior period items.',
      ),
    };
  }
  if (clauseNo === '44') {
    const byGstin = new Map<string, { returns: number; itc: number; any: boolean }>();
    for (const f of gst) {
      const k = f.registration ?? '';
      const row = byGstin.get(k) ?? { returns: 0, itc: 0, any: false };
      row.returns += 1;
      if (withItc.includes(f)) {
        row.itc += total(f);
        row.any = true;
      }
      byGstin.set(k, row);
    }
    return {
      source: 'gst_filings',
      answer: {
        breakup: [...byGstin.entries()]
          .map(([gstin, r]) => [gstin, String(r.returns), r.any ? String(r.itc) : ''].join('\t'))
          .join('\n'),
      },
      note: clip(
        `Check figures from the ${plural(gst.length, 'GST return')} the firm filed for FY ` +
          `${s.financialYear}. Columns: GSTIN, returns filed, ITC used. Split the purchase ` +
          'register into total, exempt or nil rated, composition, other registered and ' +
          'unregistered, and check it against these.',
      ),
    };
  }
  return null;
}

function lastYear(clauseNo: string, s: DraftSources): ClauseDraft | null {
  const ly = s.lastYear;
  const prev = ly?.answers[clauseNo];
  if (!ly || !prev) return null;
  const lines = (v: TaxAuditAnswerValue | undefined): string[][] =>
    typeof v === 'string' && v.trim() ? v.split('\n').map((l) => l.split('\t')) : [];
  const fy = ly.financialYear;
  if (clauseNo === '18') {
    const rows = lines(prev.blocks);
    if (rows.length === 0) return null;
    return {
      source: 'last_year',
      answer: {
        blocks: rows
          .map((c) => (c.length >= 7 ? [c[0], c[1], c[6]].join('\t') : c.join('\t')))
          .join('\n'),
      },
      note: clip(
        `Opening written-down values are FY ${fy}'s closing values (last year's tax audit). ` +
          'Columns: block, rate, opening WDV, additions, deductions, depreciation, closing WDV.',
      ),
    };
  }
  if (clauseNo === '40') {
    const rows = lines(prev.ratios);
    if (rows.length === 0) return null;
    return {
      source: 'last_year',
      answer: { ratios: rows.map((c) => [c[0] ?? '', '', c[1] ?? ''].join('\t')).join('\n') },
      note: clip(
        `FY ${fy}'s ratios (last year's tax audit) moved to the previous-year column. ` +
          'Columns: ratio, this year, previous year.',
      ),
    };
  }
  if (clauseNo === '32') {
    return {
      source: 'last_year',
      answer: { ...prev },
      note: clip(
        `Last year's answer (FY ${fy} tax audit). Add FY ${fy}'s own loss or set-off ` +
          'from its return and drop what has lapsed.',
      ),
    };
  }
  return null;
}

function msmeList(clauseNo: string, s: DraftSources): ClauseDraft | null {
  if (clauseNo !== '22' && clauseNo !== '26') return null;
  const m = s.msme;
  if (!m || (m.status !== 'received' && m.status !== 'partially_received')) return null;
  const when = m.receivedDate ? ` on ${day(m.receivedDate)}` : '';
  const part = m.status === 'partially_received' ? ' (in part)' : '';
  return {
    source: 'msme_list',
    answer: {},
    note: clip(
      `The client sent its MSME supplier list${part}${when} (information request). ` +
        (clauseNo === '22'
          ? 'Work out the interest under s.23 of the MSMED Act on late payments to them.'
          : 'Payments to them beyond the s.15 MSMED limit fall under s.43B(h).'),
    ),
  };
}

/** Last year's answer as it was, for any clause it answered (F-10). */
function carried(clauseNo: string, s: DraftSources): ClauseDraft | null {
  const prev = s.lastYear?.answers[clauseNo];
  if (!prev || Object.keys(prev).length === 0) return null;
  return {
    source: 'last_year',
    answer: { ...prev },
    note: `Last year's answer (FY ${s.lastYear!.financialYear} tax audit), carried over: check it still holds this year.`,
  };
}

const BUILDERS: Record<
  TaxAuditDraftSource,
  (clauseNo: string, s: DraftSources) => ClauseDraft | null
> = {
  client_master: clientMaster,
  tds_filings: tdsFilings,
  gst_filings: gstFilings,
  last_year: lastYear,
  msme_list: msmeList,
};

/**
 * The clause's draft, its fields checked against the clause: from its own
 * source, else last year's answer; null when neither has anything.
 */
export function draftFor(
  clauseNo: string,
  source: TaxAuditDraftSource | null,
  subItems: readonly TaxAuditSubItem[],
  s: DraftSources,
): ClauseDraft | null {
  const d = (source ? BUILDERS[source](clauseNo, s) : null) ?? carried(clauseNo, s);
  if (!d) return null;
  // Only what the clause can hold, of the kind it holds.
  const answer = Object.fromEntries(
    Object.entries(d.answer).filter(([k, v]) => answerProblems(subItems, { [k]: v }).length === 0),
  );
  return { ...d, answer };
}

function clip(note: string): string {
  return note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note;
}

/** JSON with keys in order, to tell a changed draft from the one stored. */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/**
 * Last year's answers carry only onto the same Act's form: a clause number
 * under the Income-tax Act 2025 is not the 1961 Act's clause.
 */
async function sameForm(
  client: PoolClient,
  auditId: string,
  s: DraftSources,
): Promise<DraftSources> {
  if (!s.lastYear?.libraryVersionId) return s;
  const { rows } = await client.query<{ same: boolean }>(
    `SELECT lv.act = tv.act AS same
       FROM hsdg.tax_audit_clause_library_versions lv,
            hsdg.tax_audit_clause_library_versions tv
      WHERE lv.id = $1
        AND tv.id = (SELECT l.library_version_id FROM hsdg.tax_audit_working_papers w
                       JOIN hsdg.tax_audit_clause_library l ON l.id = w.library_clause_id
                      WHERE w.tax_audit_id = $2 LIMIT 1)`,
    [s.lastYear.libraryVersionId, auditId],
  );
  return rows[0]?.same === false ? { ...s, lastYear: null } : s;
}

interface DraftPaperRow {
  id: string;
  clause_no: string;
  status: string;
  library_source: TaxAuditDraftSource | null;
  sub_items: TaxAuditSubItem[];
  draft_source: TaxAuditDraftSource | null;
  draft_answer: TaxAuditAnswer | null;
  draft_note: string | null;
  draft_confirmed_at: Date | null;
}

export interface DraftRun {
  /** Clauses given a new or changed draft. */
  drafted: string[];
  /** Clauses whose unconfirmed draft went because its source is now empty. */
  cleared: string[];
}

/**
 * Draft the audit's papers still being prepared. A new or changed draft
 * replaces the old and needs confirming again; the answer is never touched.
 * An unconfirmed draft whose source has gone empty is taken away.
 */
export async function applyDrafts(client: PoolClient, auditId: string): Promise<DraftRun> {
  const {
    rows: [src],
  } = await client.query<{ s: DraftSources }>(`SELECT hsdg.tax_audit_draft_sources($1) AS s`, [
    auditId,
  ]);
  const sources = await sameForm(client, auditId, src!.s);
  const { rows: papers } = await client.query<DraftPaperRow>(
    `SELECT w.id, w.clause_no, w.status, l.draft_source AS library_source, l.sub_items,
            w.draft_source, w.draft_answer, w.draft_note, w.draft_confirmed_at
       FROM hsdg.tax_audit_working_papers w
       JOIN hsdg.tax_audit_clause_library l ON l.id = w.library_clause_id
      WHERE w.tax_audit_id = $1 AND w.status IN ('not_started', 'in_progress')
      ORDER BY w.clause_no
      FOR UPDATE OF w`,
    [auditId],
  );
  const run: DraftRun = { drafted: [], cleared: [] };
  for (const w of papers) {
    const d = draftFor(
      w.clause_no,
      draftSourceOf(w.clause_no, w.library_source),
      w.sub_items,
      sources,
    );
    if (!d) {
      if (w.draft_source && !w.draft_confirmed_at) {
        await client.query(
          `UPDATE hsdg.tax_audit_working_papers
              SET draft_source = NULL, draft_answer = NULL, draft_note = NULL,
                  version = version + 1
            WHERE id = $1`,
          [w.id],
        );
        run.cleared.push(w.clause_no);
      }
      continue;
    }
    if (
      w.draft_source === d.source &&
      w.draft_note === d.note &&
      stable(w.draft_answer) === stable(d.answer)
    ) {
      continue;
    }
    await client.query(
      `UPDATE hsdg.tax_audit_working_papers
          SET draft_source = $2, draft_answer = $3::jsonb, draft_note = $4,
              draft_confirmed_at = NULL, draft_confirmed_by_employee_id = NULL,
              version = version + 1
        WHERE id = $1`,
      [w.id, d.source, JSON.stringify(d.answer), d.note],
    );
    run.drafted.push(w.clause_no);
  }
  return run;
}
