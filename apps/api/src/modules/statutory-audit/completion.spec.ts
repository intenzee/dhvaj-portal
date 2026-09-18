import {
  canApproveCompletion,
  canArchive,
  canSignOff,
  completionItemResolved,
  sectionResolved,
  signOffBlockers,
  ALL_COMPLETION_ITEMS,
  COMPLETION_ITEMS,
  COMPLETION_ITEM_STATE,
  REPORTING_ITEMS,
  type CompletionGate,
  type CompletionItemState,
} from '@hsdg/contracts';

/** A gate with everything satisfied — spread + override per test. */
function gate(overrides: Partial<CompletionGate> = {}): CompletionGate {
  return {
    completionItemsResolved: true,
    reportingItemsResolved: true,
    openBlockingNotes: 0,
    areasOpen: 0,
    completionApproved: false,
    signedOff: false,
    archived: false,
    ...overrides,
  };
}

describe('completionItemResolved (§27)', () => {
  it('treats complete and not_applicable as resolved, others not', () => {
    const states: [CompletionItemState, boolean][] = [
      [COMPLETION_ITEM_STATE.complete, true],
      [COMPLETION_ITEM_STATE.notApplicable, true],
      [COMPLETION_ITEM_STATE.inProgress, false],
      [COMPLETION_ITEM_STATE.notStarted, false],
    ];
    for (const [state, expected] of states) {
      expect(completionItemResolved({ state })).toBe(expected);
    }
  });
});

describe('sectionResolved (§27)', () => {
  it('is true only when every item in the section is resolved', () => {
    const items = [
      { section: 'completion' as const, state: COMPLETION_ITEM_STATE.complete },
      { section: 'completion' as const, state: COMPLETION_ITEM_STATE.notApplicable },
      { section: 'reporting' as const, state: COMPLETION_ITEM_STATE.inProgress },
    ];
    expect(sectionResolved(items, 'completion')).toBe(true);
    expect(sectionResolved(items, 'reporting')).toBe(false);
  });

  it('is vacuously true for an empty section', () => {
    expect(sectionResolved([], 'completion')).toBe(true);
  });
});

describe('canApproveCompletion (§28)', () => {
  it('needs the completion checklist resolved and no blocking notes, not yet approved', () => {
    expect(canApproveCompletion(gate())).toBe(true);
    expect(canApproveCompletion(gate({ completionItemsResolved: false }))).toBe(false);
    expect(canApproveCompletion(gate({ openBlockingNotes: 1 }))).toBe(false);
    expect(canApproveCompletion(gate({ completionApproved: true }))).toBe(false);
    expect(canApproveCompletion(gate({ archived: true }))).toBe(false);
  });

  it('ignores reporting items and open areas (those gate sign-off, not completion)', () => {
    expect(canApproveCompletion(gate({ reportingItemsResolved: false, areasOpen: 3 }))).toBe(true);
  });
});

describe('canSignOff (§28, §29)', () => {
  const ready = gate({ completionApproved: true });

  it('requires approval, resolved reporting, no open areas and no blocking notes', () => {
    expect(canSignOff(ready)).toBe(true);
    expect(canSignOff(gate({ completionApproved: false }))).toBe(false);
    expect(canSignOff({ ...ready, reportingItemsResolved: false })).toBe(false);
    expect(canSignOff({ ...ready, areasOpen: 1 })).toBe(false);
    expect(canSignOff({ ...ready, openBlockingNotes: 1 })).toBe(false);
    expect(canSignOff({ ...ready, signedOff: true })).toBe(false);
  });
});

describe('canArchive (§27.10)', () => {
  it('needs a signed-off, not-yet-archived file', () => {
    expect(canArchive(gate({ signedOff: true }))).toBe(true);
    expect(canArchive(gate({ signedOff: false }))).toBe(false);
    expect(canArchive(gate({ signedOff: true, archived: true }))).toBe(false);
  });
});

describe('signOffBlockers (§32)', () => {
  it('lists nothing when the gate is clear (after approval)', () => {
    expect(signOffBlockers(gate({ completionApproved: true }))).toEqual([]);
  });

  it('names each unmet prerequisite', () => {
    const reasons = signOffBlockers(
      gate({
        completionApproved: false,
        reportingItemsResolved: false,
        areasOpen: 2,
        openBlockingNotes: 1,
      }),
    );
    expect(reasons).toEqual([
      'Completion is not yet approved.',
      'Reporting checklist has open items.',
      '2 audit area(s) are not yet concluded.',
      '1 blocking review note(s) are open.',
    ]);
  });
});

describe('checklist catalogue (§27.07/§27.08)', () => {
  it('has the seven completion + five reporting items with unique keys per section', () => {
    expect(COMPLETION_ITEMS).toHaveLength(7);
    expect(REPORTING_ITEMS).toHaveLength(5);
    expect(ALL_COMPLETION_ITEMS).toHaveLength(12);
    const key = (s: string, k: string): string => `${s}:${k}`;
    const keys = ALL_COMPLETION_ITEMS.map((i) => key(i.section, i.itemKey));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
