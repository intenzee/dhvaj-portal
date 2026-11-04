import {
  answerFields,
  answerMissing,
  answerProblems,
  openingStatus,
  sendForReviewBlockers,
  TAX_AUDIT_FREE_ANSWER_KEY,
  type TaxAuditSubItem,
} from '@hsdg/contracts';
import {
  factsProblems,
  packageGrade,
  packageTaskTitle,
  withDraft,
} from './tax-audit-workspace.service';

const fields: TaxAuditSubItem[] = [
  { key: 'a', label: 'Tax deducted', kind: 'yes_no' },
  { key: 'b', label: 'Amount', kind: 'amount' },
  { key: 'c', label: 'Paid on', kind: 'date' },
  { key: 'd', label: 'Details', kind: 'table' },
];

describe('tax audit working papers', () => {
  it('gives a clause with no sub-items one free-text field', () => {
    expect(answerFields([])).toEqual([
      { key: TAX_AUDIT_FREE_ANSWER_KEY, label: 'Answer', kind: 'text' },
    ]);
    expect(answerFields(fields)).toHaveLength(4);
  });

  it('refuses an answer of the wrong kind or for a field the clause has not', () => {
    expect(answerProblems(fields, { a: true, b: 1200.5, c: '2026-03-31', d: 'x\ty' })).toEqual([]);
    expect(answerProblems(fields, { c: '' })).toEqual([]);
    expect(answerProblems(fields, { a: 'yes', b: '100', c: '31/03/2026', z: 'x' })).toEqual([
      'Tax deducted: answer yes or no.',
      'Amount: give an amount.',
      'Paid on: give a date.',
      '"z" is not a field of this clause.',
    ]);
    expect(answerProblems(fields, { b: Number.NaN })).toEqual(['Amount: give an amount.']);
    expect(answerProblems([], { text: 'Nil' })).toEqual([]);
  });

  it('lists the fields still blank; false and 0 are answers', () => {
    expect(answerMissing(fields, { a: false, b: 0, c: ' ' })).toEqual(['Paid on', 'Details']);
    expect(answerMissing([], {})).toEqual(['Answer']);
  });

  it('opens a clause Not applicable only when the facts rule it out', () => {
    const loans = { fact: 'loansOrDeposits', is: true } as const;
    expect(openingStatus(loans, { loansOrDeposits: false })).toBe('not_applicable');
    expect(openingStatus(loans, { loansOrDeposits: true })).toBe('not_started');
    expect(openingStatus(loans, {})).toBe('not_started');
    expect(openingStatus(null, {})).toBe('not_started');
  });

  it('holds a paper back from review until answered, evidenced and its draft confirmed', () => {
    const base = {
      subItems: fields.slice(0, 2),
      answer: { a: true, b: 10 },
      evidenceRequired: ['TDS returns'],
      evidenceCount: 1,
      draftSource: null,
      draftConfirmedAt: null,
    };
    expect(sendForReviewBlockers(base)).toEqual([]);
    expect(
      sendForReviewBlockers({ ...base, answer: {}, evidenceCount: 0, draftSource: 'tds_filings' }),
    ).toEqual([
      'Answer Tax deducted; Amount.',
      'Attach the evidence: TDS returns.',
      'Confirm the draft from the portal first.',
    ]);
    expect(
      sendForReviewBlockers({
        ...base,
        evidenceRequired: [],
        evidenceCount: 0,
        draftSource: 'tds_filings',
        draftConfirmedAt: '2026-11-04T05:00:00.000Z',
      }),
    ).toEqual([]);
  });
});

describe('tax audit packages', () => {
  it('goes to the highest grade any of its clauses needs', () => {
    expect(packageGrade([])).toBe('article');
    expect(packageGrade(['article', 'senior', 'article'])).toBe('senior');
    expect(packageGrade(['senior', 'manager'])).toBe('manager');
  });

  it('names the task after the year, the package and its clauses', () => {
    expect(packageTaskTitle('2025-26', 'tds_tcs', ['34'])).toMatch(
      /^Tax audit FY 2025-26 — .+ \(cl\. 34\)$/,
    );
    expect(packageTaskTitle('2025-26', 'general', ['1', '2', '3', '4', '5', '6', '7'])).toMatch(
      /\(cl\. 1, 2, 3, 4, 5, 6 …\)$/,
    );
  });

  it('takes only known audit facts, as true or false', () => {
    expect(factsProblems({ holdsStock: true, gstRegistered: false })).toEqual([]);
    expect(factsProblems({ holdsStock: 'yes', nope: true })).toEqual([
      'holdsStock must be true or false.',
      '"nope" is not an audit fact.',
    ]);
  });

  it('fills only the blank fields from the portal’s draft', () => {
    expect(withDraft({ a: 'mine', b: '', c: false }, { a: 'draft', b: 'draft', d: 5 })).toEqual({
      a: 'mine',
      b: 'draft',
      c: false,
      d: 5,
    });
    expect(withDraft({ a: 'x' }, null)).toEqual({ a: 'x' });
  });
});
