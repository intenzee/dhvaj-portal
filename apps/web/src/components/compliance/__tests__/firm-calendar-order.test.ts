import { openFirst } from '../firm-calendar';

describe('openFirst', () => {
  it('puts still-to-file rows first and filed / N/A last, keeping the date order in each', () => {
    const rows = [
      { id: 'a', dueDate: '2026-11-07', workflowStatus: 'filed' },
      { id: 'b', dueDate: '2026-11-07', workflowStatus: 'not_started' },
      { id: 'c', dueDate: '2026-11-11', workflowStatus: 'not_applicable' },
      { id: 'd', dueDate: '2026-11-11', workflowStatus: 'in_review' },
      { id: 'e', dueDate: '2026-11-20', workflowStatus: 'ready_to_file' },
    ] as const;
    expect(openFirst(rows).map((r) => r.id)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });
});
