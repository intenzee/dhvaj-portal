import { deriveWorkflowStatus, type WorkflowInputs } from './compliance-workflow-status';

const base: WorkflowInputs = {
  current: 'not_started',
  hasLiveFiling: false,
  taskStatus: null,
  openDependencies: 0,
  approvalPending: false,
};
const derive = (over: Partial<WorkflowInputs>) => deriveWorkflowStatus({ ...base, ...over });

describe('filing workflow status (spec p.23)', () => {
  it('Not started when nothing has happened', () => {
    expect(derive({})).toBe('not_started');
    expect(derive({ taskStatus: 'todo' })).toBe('not_started');
  });

  it('Awaiting data while any client request is open', () => {
    expect(derive({ openDependencies: 1 })).toBe('awaiting_data');
    expect(derive({ taskStatus: 'blocked', openDependencies: 2 })).toBe('awaiting_data');
  });

  it('In preparation follows the task being worked (incl. paused)', () => {
    expect(derive({ taskStatus: 'in_progress' })).toBe('in_preparation');
    expect(derive({ taskStatus: 'paused' })).toBe('in_preparation');
  });

  it('In review when the task was sent for review, even with a request open', () => {
    expect(derive({ taskStatus: 'in_review', openDependencies: 1 })).toBe('in_review');
  });

  it('Ready to file once approved — for 3B only after the client approval is recorded', () => {
    expect(derive({ taskStatus: 'done' })).toBe('ready_to_file');
    expect(derive({ taskStatus: 'done', approvalPending: true })).toBe('in_review');
  });

  it('Filed comes only from a live filing record and beats everything', () => {
    expect(derive({ hasLiveFiling: true, taskStatus: 'in_progress' })).toBe('filed');
    expect(derive({ current: 'filed', taskStatus: 'done' })).toBe('ready_to_file'); // undone lodge
  });

  it('Not applicable sticks until a lead lifts it', () => {
    expect(derive({ current: 'not_applicable', taskStatus: 'in_progress' })).toBe('not_applicable');
  });
});
