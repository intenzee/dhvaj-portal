import { changeLogArea, changeLogFieldLabel } from '@hsdg/contracts';

describe('change log labels', () => {
  it('reads a first upload as a file added, a later one as a new version', () => {
    expect(changeLogArea('document_versions', { version_no: 1 })).toBe('File');
    expect(changeLogArea('document_versions', { version_no: 3 })).toBe('File version');
    expect(changeLogArea('document_versions', null)).toBe('File');
    expect(changeLogArea('documents', { status: ['active', 'archived'] })).toBe('File details');
    expect(changeLogArea('entities')).toBe('Client');
    expect(changeLogArea('something_new')).toBe('something_new');
  });

  it('names file columns readably and others from their column name', () => {
    expect(changeLogFieldLabel('filename')).toBe('File name');
    expect(changeLogFieldLabel('size_bytes')).toBe('Size (bytes)');
    expect(changeLogFieldLabel('document_id')).toBe('File');
    expect(changeLogFieldLabel('engagement_partner_id')).toBe('Engagement partner');
  });
});
