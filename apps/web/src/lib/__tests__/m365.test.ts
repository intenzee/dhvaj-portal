import { editorWindowFeatures, fetchM365Session, isM365File, m365EmbedUrl, m365OpenUrl } from '../m365';

jest.mock('../api', () => ({ apiFetch: jest.fn() }));

const LINK = 'https://contoso.sharepoint.com/:w:/s/Portal/IQCAw?e=abc';

describe('isM365File', () => {
  it('keeps PDFs in the browser viewer and sends Word, Excel and CSV to Microsoft 365', () => {
    expect(isM365File('a.pdf')).toBe(false);
    expect(isM365File('A.PDF')).toBe(false);
    expect(isM365File('a.docx')).toBe(true);
    expect(isM365File('a.xlsx')).toBe(true);
    expect(isM365File('a.csv')).toBe(true);
  });
});

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

describe('Microsoft 365 sessions', () => {
  const api = jest.requireMock('../api') as { apiFetch: jest.Mock };
  beforeEach(() => api.apiFetch.mockReset());

  it('shares one request per document and reuses it for a minute', async () => {
    api.apiFetch.mockResolvedValue({ enabled: true, editorUrl: LINK });
    let t = 1_000_000;
    const now = () => t;
    const a = fetchM365Session('e1', 'd1', now);
    const b = fetchM365Session('e1', 'd1', now);
    expect(a).toBe(b);
    await a;
    t += 59_000;
    await fetchM365Session('e1', 'd1', now);
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
    await fetchM365Session('e1', 'd2', now);
    expect(api.apiFetch).toHaveBeenCalledTimes(2);
    t += 2_000;
    await fetchM365Session('e1', 'd1', now);
    expect(api.apiFetch).toHaveBeenCalledTimes(3);
  });

  it('does not reuse a failure', async () => {
    api.apiFetch.mockRejectedValueOnce(new Error('down'));
    await expect(fetchM365Session('e2', 'd1')).rejects.toThrow('down');
    api.apiFetch.mockResolvedValueOnce({ enabled: true, editorUrl: LINK });
    await expect(fetchM365Session('e2', 'd1')).resolves.toMatchObject({ enabled: true });
    expect(api.apiFetch).toHaveBeenCalledTimes(2);
  });
});
