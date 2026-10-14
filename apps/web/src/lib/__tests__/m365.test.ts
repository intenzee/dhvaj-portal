import { m365EmbedUrl, m365OpenUrl } from '../m365';

const LINK = 'https://contoso.sharepoint.com/:w:/s/Portal/IQCAw?e=abc';

describe('Microsoft 365 links', () => {
  it('frames the read-only embed view, keeping the link token', () => {
    const url = new URL(m365EmbedUrl(LINK));
    expect(url.searchParams.get('action')).toBe('embedview');
    expect(url.searchParams.get('e')).toBe('abc');
    expect(url.pathname).toBe('/:w:/s/Portal/IQCAw');
  });

  it('opens editing in a new tab when the link allows it, else the plain link', () => {
    expect(new URL(m365OpenUrl(LINK, true)).searchParams.get('action')).toBe('edit');
    expect(new URL(m365OpenUrl(LINK, false)).searchParams.has('action')).toBe(false);
  });
});
