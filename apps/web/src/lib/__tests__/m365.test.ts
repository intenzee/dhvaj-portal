import { editorWindowFeatures, m365EmbedUrl, m365OpenUrl } from '../m365';

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

describe('the editor window', () => {
  it('sits on the right 60% of the screen, full height', () => {
    expect(editorWindowFeatures({ availWidth: 2000, availHeight: 1100 })).toBe(
      'popup,width=1200,height=1100,left=800,top=0',
    );
  });

  it('is at least 900px wide, but never wider than the screen', () => {
    expect(editorWindowFeatures({ availWidth: 1280, availHeight: 800, availLeft: 0 })).toBe(
      'popup,width=900,height=800,left=380,top=0',
    );
    expect(editorWindowFeatures({ availWidth: 800, availHeight: 600 })).toBe(
      'popup,width=800,height=600,left=0,top=0',
    );
  });

  it('follows a second monitor offset', () => {
    expect(
      editorWindowFeatures({ availWidth: 1500, availHeight: 900, availLeft: 1920, availTop: 25 }),
    ).toBe('popup,width=900,height=900,left=2520,top=25');
  });
});
