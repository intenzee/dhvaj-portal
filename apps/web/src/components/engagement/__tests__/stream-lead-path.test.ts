import { serviceLineLeadPath } from '../stream-lead-editor';

describe('stream lead change', () => {
  it('PUTs to the engagement’s service line lead', () => {
    expect(serviceLineLeadPath('e1', 'l1')).toBe('/engagements/e1/service-lines/l1/lead');
  });
});
