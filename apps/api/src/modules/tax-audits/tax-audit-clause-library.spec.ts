import {
  compareClauseNo,
  conditionProblems,
  describeCondition,
  evaluateClauseCondition,
  type TaxAuditLibraryClauseInput,
} from '@hsdg/contracts';
import { clauseProblems, versionProblems } from './tax-audit-clause-library.service';

const clause = (over: Partial<TaxAuditLibraryClauseInput>): TaxAuditLibraryClauseInput => ({
  clauseNo: '31',
  part: 'B',
  title: 'Loans and deposits',
  subItems: [{ key: 'a', label: 'Loans accepted', kind: 'table' }],
  appliesWhen: { fact: 'loansOrDeposits', is: true },
  notApplicableReason: 'No loans or deposits.',
  defaultPackage: 'loans_deposits',
  defaultGrade: 'article',
  evidence: ['Loan ledgers'],
  draftSource: null,
  partnerReview: false,
  sortOrder: 10,
  ...over,
});

describe('evaluateClauseCondition', () => {
  it('applies a clause with no condition', () => {
    expect(evaluateClauseCondition(null, {})).toBe(true);
  });

  it('reads a fact, and waits while it is not known', () => {
    const c = { fact: 'loansOrDeposits', is: true } as const;
    expect(evaluateClauseCondition(c, { loansOrDeposits: true })).toBe(true);
    expect(evaluateClauseCondition(c, { loansOrDeposits: false })).toBe(false);
    expect(evaluateClauseCondition(c, {})).toBeNull();
    expect(evaluateClauseCondition({ not: c }, { loansOrDeposits: false })).toBe(true);
    expect(evaluateClauseCondition({ not: c }, {})).toBeNull();
  });

  it('settles all / any as soon as one part decides them', () => {
    const firm = { fact: 'isFirmOrAop', is: true } as const;
    const closely = { fact: 'closelyHeldCompany', is: true } as const;
    expect(evaluateClauseCondition({ any: [firm, closely] }, { isFirmOrAop: true })).toBe(true);
    expect(evaluateClauseCondition({ any: [firm, closely] }, { isFirmOrAop: false })).toBeNull();
    expect(
      evaluateClauseCondition(
        { any: [firm, closely] },
        { isFirmOrAop: false, closelyHeldCompany: false },
      ),
    ).toBe(false);
    expect(evaluateClauseCondition({ all: [firm, closely] }, { isFirmOrAop: false })).toBe(false);
    expect(evaluateClauseCondition({ all: [firm, closely] }, { isFirmOrAop: true })).toBeNull();
  });

  it('reads a condition out in words', () => {
    expect(describeCondition(null)).toBe('Always');
    expect(
      describeCondition({
        any: [
          { fact: 'isFirmOrAop', is: true },
          { fact: 'closelyHeldCompany', is: true },
        ],
      }),
    ).toBe(
      'The assessee is a firm, LLP, AOP or BOI or a company in which the public are not substantially interested',
    );
  });
});

describe('conditionProblems', () => {
  it('passes a sound condition', () => {
    expect(conditionProblems(null)).toEqual([]);
    expect(conditionProblems({ all: [{ fact: 'holdsStock', is: true }] })).toEqual([]);
  });

  it('names an unknown fact, a bad value, an empty group and a stray key', () => {
    expect(conditionProblems({ fact: 'hasYacht', is: true })).toEqual([
      'appliesWhen: "hasYacht" is not an audit fact.',
    ]);
    expect(conditionProblems({ fact: 'holdsStock', is: 'yes' })).toEqual([
      'appliesWhen: "is" must be true or false.',
    ]);
    expect(conditionProblems({ any: [] })).toEqual(['appliesWhen.any needs conditions.']);
    expect(conditionProblems({ all: [{ fact: 'holdsStock' }] })).toEqual([
      'appliesWhen.all[0]: "is" must be true or false.',
    ]);
    expect(conditionProblems({ maybe: 1 })).toEqual(['appliesWhen: unknown key "maybe".']);
    expect(conditionProblems([1])).toEqual(['appliesWhen must be an object.']);
  });
});

describe('clause and version checks', () => {
  it('asks why a conditional clause is Not applicable', () => {
    expect(clauseProblems(clause({}))).toEqual([]);
    expect(clauseProblems(clause({ notApplicableReason: '  ' }))).toEqual([
      'Clause 31: say why it is Not applicable when its condition fails.',
    ]);
    expect(clauseProblems(clause({ appliesWhen: null, notApplicableReason: null }))).toEqual([]);
  });

  it('refuses two sub-items with one key', () => {
    expect(
      clauseProblems(
        clause({
          subItems: [
            { key: 'a', label: 'One', kind: 'text' },
            { key: 'a', label: 'Two', kind: 'text' },
          ],
        }),
      ),
    ).toEqual(['Clause 31: two sub-items share a key.']);
  });

  it('refuses an empty version and a clause listed twice', () => {
    expect(versionProblems([])).toEqual(['A version needs at least one clause.']);
    expect(versionProblems([clause({}), clause({})])).toEqual(['Clause 31 is listed twice.']);
  });
});

describe('compareClauseNo', () => {
  it('orders clauses the way the form does', () => {
    const shuffled = ['30', '21(b)', '8a', '29A', '21', '9', '8', '21(a)', '29B', '29', '44'];
    expect([...shuffled].sort(compareClauseNo)).toEqual([
      '8',
      '8a',
      '9',
      '21',
      '21(a)',
      '21(b)',
      '29',
      '29A',
      '29B',
      '30',
      '44',
    ]);
  });
});
