import { taskActionLabel } from '../work-types';

describe('taskActionLabel', () => {
  it('reads "Resume work" when picking a paused or blocked task back up', () => {
    expect(taskActionLabel('start', 'todo')).toBe('Start work');
    expect(taskActionLabel('start', 'blocked')).toBe('Resume work');
    expect(taskActionLabel('start', 'paused')).toBe('Resume work');
    expect(taskActionLabel('send-for-review', 'in_progress')).toBe('Send for review');
  });
});
