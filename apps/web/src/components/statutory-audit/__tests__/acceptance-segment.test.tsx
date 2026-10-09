import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AcceptanceSegment, StatutoryAuditAcceptance } from '@hsdg/contracts';
import { AcceptanceSegmentEditor } from '../acceptance-segment';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('@/lib/toast', () => ({ useToast: () => jest.fn() }));

jest.mock('../acceptance-file-card', () => ({
  AcceptanceFileCard: ({ slotKey }: { slotKey: string }) => <div>file card: {slotKey}</div>,
}));

const answer = (questionKey: string, a: string, details: Record<string, unknown> = {}) => ({
  id: questionKey,
  segmentId: 's2',
  questionKey,
  answer: a,
  details,
  narrative: null,
  documentId: null,
  answeredByName: null,
});

const segment = (answers: ReturnType<typeof answer>[]): AcceptanceSegment =>
  ({
    id: 's2',
    segmentKey: 'appointment_eligibility',
    title: 'Appointment & Eligibility',
    state: 'in_progress',
    sortOrder: 2,
    readOnly: false,
    decidedByName: null,
    decidedAt: null,
    version: 1,
    answers,
    required: 11,
    answered: answers.length,
    pending: 0,
    attention: 0,
    attentionItems: [],
    notApplicableReason: null,
  }) as unknown as AcceptanceSegment;

const acc = {
  engagementId: 'e1',
  workflowInstanceId: 'wf1',
  engagementProfile: [{ label: 'Financial year', value: '2024-25', source: 'Engagement' }],
  context: {
    firstYear: true,
    firstYearSource: 'profile',
    otherServices: [],
    independence: {
      required: 0,
      completed: 0,
      pending: 0,
      threatsDisclosed: 0,
      rows: [],
      mine: null,
    },
    fileStatuses: {},
    priorYear: null,
    partner: null,
    manager: null,
  },
} as unknown as StatutoryAuditAcceptance;

describe('01.2 Appointment & Eligibility editor', () => {
  it('shows the APP questions, the eligibility checklist and the consent certificate card', () => {
    render(
      <AcceptanceSegmentEditor
        acc={acc}
        segment={segment([])}
        editable
        busy={false}
        onAnswer={jest.fn()}
      />,
    );
    expect(screen.getByText(/How has DHVAJ been appointed/)).toBeInTheDocument();
    expect(screen.getByText(/Eligibility check — Clear \/ Issue \/ N\/A/)).toBeInTheDocument();
    expect(screen.getByText('Relevant disqualifications')).toBeInTheDocument();
    expect(screen.getByText('file card: consent_certificate')).toBeInTheDocument();
    expect(screen.queryByText('file card: appointment_communication')).not.toBeInTheDocument();
  });

  it('marks a checklist row as an Issue and then asks for the matter and its conclusion', async () => {
    const onAnswer = jest.fn();
    const { rerender } = render(
      <AcceptanceSegmentEditor
        acc={acc}
        segment={segment([])}
        editable
        busy={false}
        onAnswer={onAnswer}
      />,
    );
    const row = screen
      .getByText('Audit ceiling / number of audits consideration')
      .closest('[id^="audit-anchor-question-"]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Issue' }));
    expect(onAnswer).toHaveBeenCalledWith('el_ceiling', 'issue', {});

    rerender(
      <AcceptanceSegmentEditor
        acc={acc}
        segment={segment([answer('el_ceiling', 'issue'), answer('app_04', 'yes')])}
        editable
        busy={false}
        onAnswer={onAnswer}
      />,
    );
    expect(screen.getByText('Describe the matter')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
    expect(screen.getByText('file card: evidence:el_ceiling')).toBeInTheDocument();
    expect(screen.getByText('file card: appointment_communication')).toBeInTheDocument();
  });
});

describe('01.3 Previous Auditor editor', () => {
  const pa = (answers: ReturnType<typeof answer>[], firstYear: boolean) => {
    const seg = {
      ...segment(answers),
      id: 's3',
      segmentKey: 'previous_auditor',
      title: 'Previous Auditor Communication',
    } as AcceptanceSegment;
    const a = { ...acc, context: { ...acc.context, firstYear } } as StatutoryAuditAcceptance;
    return { seg, a };
  };

  it('on a continuing engagement shows only PA-01, derived from the file', () => {
    const { seg, a } = pa([], false);
    render(
      <AcceptanceSegmentEditor acc={a} segment={seg} editable busy={false} onAnswer={jest.fn()} />,
    );
    expect(screen.getByText(/first year DHVAJ is acting/)).toBeInTheDocument();
    expect(screen.getByText(/Set from the engagement history/)).toBeInTheDocument();
    expect(screen.queryByText(/Was another auditor/)).not.toBeInTheDocument();
  });

  it('PA-03 "No" offers the Communication to Previous Auditor card', () => {
    const { seg, a } = pa(
      [
        answer('pa_02', 'yes'),
        answer('pa_details', 'recorded', { firmName: 'Rao & Co' }),
        answer('pa_03', 'no'),
      ],
      true,
    );
    render(
      <AcceptanceSegmentEditor acc={a} segment={seg} editable busy={false} onAnswer={jest.fn()} />,
    );
    expect(screen.getByText('file card: previous_auditor_communication')).toBeInTheDocument();
    expect(screen.getByText('Auditor / Firm Name')).toBeInTheDocument();
    expect(screen.getByText(/Has a response been received/)).toBeInTheDocument();
  });
});

describe('01.5 Independence editor', () => {
  it('summarises team declarations and records my own', async () => {
    const seg = {
      ...segment([]),
      id: 's5',
      segmentKey: 'independence_ethics',
      title: 'Independence & Ethics',
    } as AcceptanceSegment;
    const me = {
      employeeId: 'u1',
      employeeName: 'Partner A',
      role: 'Engagement Partner',
      status: 'pending' as const,
      disclosure: null,
      declaredAt: null,
    };
    const a = {
      ...acc,
      context: {
        ...acc.context,
        independence: {
          required: 2,
          completed: 1,
          pending: 1,
          threatsDisclosed: 0,
          rows: [
            me,
            {
              employeeId: 'u2',
              employeeName: 'Manager X',
              role: 'Engagement Manager',
              status: 'independent' as const,
              disclosure: null,
              declaredAt: '2026-10-01T00:00:00Z',
            },
          ],
          mine: me,
        },
      },
    } as StatutoryAuditAcceptance;
    apiFetch.mockResolvedValue({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AcceptanceSegmentEditor acc={a} segment={seg} editable busy={false} onAnswer={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Required declarations').nextSibling).toHaveTextContent('2');
    expect(screen.getByText(/IND-03/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Team Declarations' }));
    expect(screen.getByText('Manager X')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I am independent' }));
    expect(apiFetch).toHaveBeenCalledWith(
      '/engagements/e1/statutory-audit/wf1/acceptance/independence/declaration',
      { method: 'POST', body: { status: 'independent' } },
    );
  });
});
