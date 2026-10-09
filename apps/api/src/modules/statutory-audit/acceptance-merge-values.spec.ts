import {
  ACCEPTANCE_FILE_SLOTS,
  availableFileTransitions,
  fileTransitionError,
  slotOf,
} from '@hsdg/contracts';
import type { EngagementMasterFacts } from './master-facts';
import {
  buildMergeValues,
  formatLongDate,
  templateSelectionFacts,
} from './acceptance-merge-values';

const master = {
  entityId: 'e1',
  engagementCode: 'ENG-001',
  financialYear: '2025-26',
  periodLabel: 'FY',
  officeName: 'Mumbai',
  legalName: 'Bharat Industries Private Limited',
  corporateId: { type: 'cin', number: 'U12345MH2020PTC000001' },
  pan: 'AAACB1234C',
  entityTypeName: 'Private limited company',
  entityTypeSlug: 'private_limited',
  registeredOffice: '1 Main St, Mumbai',
  partnerName: 'Partner A',
  managerName: 'Manager X',
  listings: [],
  listingStatus: 'unlisted',
  relationships: [],
} as unknown as EngagementMasterFacts;

describe('buildMergeValues', () => {
  it('fills masters, firm details and Section 01 answers', () => {
    const answers = new Map([
      ['appointment_eligibility:app_01', { answer: 'agm', details: {} }],
      ['appointment_eligibility:app_02', { answer: '2025-09-30', details: {} }],
      [
        'appointment_eligibility:app_03',
        { answer: 'recorded', details: { from: '2025-26', to: '2029-30' } },
      ],
      [
        'previous_auditor:pa_details',
        { answer: 'recorded', details: { firmName: 'Old & Co', frn: '012345W' } },
      ],
    ]);
    const v = buildMergeValues({
      master,
      firm: { firmName: 'DHVAJ & Associates', frn: '123456W', address: null },
      partnerMembershipNo: '098765',
      answers,
      today: '2026-10-09',
    });
    expect(v).toMatchObject({
      'firm.name': 'DHVAJ & Associates',
      'firm.frn': '123456W',
      'firm.address': null,
      'client.name': 'Bharat Industries Private Limited',
      'client.cin': 'U12345MH2020PTC000001',
      'engagement.auditPeriod': '1 April 2025 to 31 March 2026',
      'engagement.periodEnd': '31 March 2026',
      'partner.membershipNo': '098765',
      'appointment.basis': 'Appointment at AGM',
      'appointment.date': '30 September 2025',
      'appointment.periodFrom': '2025-26',
      'appointment.periodTo': '2029-30',
      'previousAuditor.firmName': 'Old & Co',
      'previousAuditor.email': null,
      today: '9 October 2026',
    });
  });

  it('uses the specified basis when APP-01 is Other', () => {
    const v = buildMergeValues({
      master,
      firm: { firmName: 'F', frn: null, address: null },
      partnerMembershipNo: null,
      answers: new Map([
        [
          'appointment_eligibility:app_01',
          { answer: 'other', details: { specify: 'Tribunal order' } },
        ],
      ]),
      today: '2026-10-09',
    });
    expect(v['appointment.basis']).toBe('Tribunal order');
    expect(v['appointment.date']).toBeNull();
  });

  it('formats dates long-form and leaves other text alone', () => {
    expect(formatLongDate('2026-01-05')).toBe('5 January 2026');
    expect(formatLongDate('FY 2025-26')).toBe('FY 2025-26');
    expect(formatLongDate(null)).toBeNull();
  });

  it('derives the variant-selection facts', () => {
    expect(templateSelectionFacts(master)).toEqual({
      listed: false,
      entityTypeSlug: 'private_limited',
      hasGroup: false,
    });
    expect(
      templateSelectionFacts({ ...master, listings: ['NSE'] } as EngagementMasterFacts).listed,
    ).toBe(true);
  });
});

describe('file card lifecycles', () => {
  const letter = ACCEPTANCE_FILE_SLOTS.find((s) => s.slot === 'engagement_letter')!;
  const comm = ACCEPTANCE_FILE_SLOTS.find((s) => s.slot === 'previous_auditor_communication')!;

  it('walks the engagement letter Draft → Partner Review → Approved → Issued → Accepted', () => {
    expect(fileTransitionError(letter, 'draft', 'partner_review', {}, false)).toBeNull();
    expect(fileTransitionError(letter, 'partner_review', 'approved', {}, false)).toMatch(
      /Only the Engagement Partner/,
    );
    expect(fileTransitionError(letter, 'partner_review', 'approved', {}, true)).toBeNull();
    expect(
      fileTransitionError(letter, 'approved', 'issued', { issuedDate: '2026-10-01' }, false),
    ).toMatch(/Mode of delivery is required/);
    expect(
      fileTransitionError(
        letter,
        'approved',
        'issued',
        { issuedDate: '2026-10-01', deliveryMode: 'email' },
        false,
      ),
    ).toBeNull();
    expect(fileTransitionError(letter, 'draft', 'issued', {}, true)).toMatch(/is not a step/);
  });

  it('needs the sent date + mode to mark the communication Sent, and a reason to reopen', () => {
    expect(
      fileTransitionError(comm, 'ready_to_send', 'sent', { sentMode: 'email' }, false),
    ).toMatch(/Date communicated is required/);
    expect(
      fileTransitionError(
        comm,
        'ready_to_send',
        'sent',
        { sentDate: 'yesterday', sentMode: 'email' },
        false,
      ),
    ).toMatch(/must be a date/);
    expect(fileTransitionError(comm, 'sent', 'draft', {}, false)).toMatch(/Reason for reopening/);
  });

  it('offers partner-only steps only to the partner', () => {
    expect(availableFileTransitions(letter, 'partner_review', false)).toEqual([]);
    expect(availableFileTransitions(letter, 'partner_review', true).map((t) => t.to)).toEqual([
      'approved',
      'draft',
    ]);
  });

  it('resolves per-answer evidence slots', () => {
    expect(slotOf('evidence:app_04')).toMatchObject({ slot: 'evidence', multiple: true });
    expect(slotOf('evidence:BAD KEY')).toBeNull();
    expect(slotOf('nope')).toBeNull();
  });
});
