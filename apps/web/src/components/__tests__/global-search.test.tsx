import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SearchResponse } from '@hsdg/contracts';
import { GlobalSearch, searchSections, stepActive, understoodLine } from '../global-search';

const apiFetch = jest.fn();
jest.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
let wide = true;
jest.mock('@/lib/feature-flags', () => ({
  useFeatureFlags: () => ({
    isOn: (f: string) => (f === 'ff_filing_runs' ? wide : false),
    isLoading: false,
    flags: {},
  }),
}));

const FILING_HREF = '/engagements/e1?tab=gst&fy=2026-27&m=9&part=outward';
const response: SearchResponse = {
  q: 'bharat gstr1 sep',
  understood: { text: ['bharat'], forms: ['gstr1'], period: '2026-09', periodLabel: 'Sep 2026' },
  groups: [
    {
      group: 'filings',
      items: [
        {
          group: 'filings',
          id: 'i1',
          title: 'GSTR-1 · Sep 2026 — Bharat Textiles',
          subtitle: '19AAAC… · In preparation',
          href: FILING_HREF,
          link: { engagementId: 'e1', engagementKind: 'compliance', instanceId: 'i1' },
        },
      ],
    },
    {
      group: 'clients',
      items: [
        {
          group: 'clients',
          id: 'c1',
          title: 'Bharat Textiles',
          subtitle: 'ENT00001',
          href: '/entities/c1',
          link: null,
        },
      ],
    },
  ],
};

describe('global search helpers', () => {
  it('keeps the server’s group order', () => {
    expect(searchSections(response).map((s) => s.group)).toEqual(['filings', 'clients']);
    expect(searchSections(undefined)).toEqual([]);
  });

  it('says what it understood', () => {
    expect(understoodLine(response)).toBe('Looking for GSTR1 · Sep 2026');
    expect(
      understoodLine({
        ...response,
        understood: { text: ['x'], forms: [], period: null, periodLabel: null },
      }),
    ).toBeNull();
  });

  it('wraps the arrow keys', () => {
    expect(stepActive(-1, 1, 3)).toBe(0);
    expect(stepActive(-1, -1, 3)).toBe(2);
    expect(stepActive(2, 1, 3)).toBe(0);
    expect(stepActive(0, -1, 3)).toBe(2);
    expect(stepActive(0, 1, 0)).toBe(-1);
  });
});

describe('GlobalSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    apiFetch.mockReset();
    push.mockReset();
    wide = true;
  });
  afterEach(() => jest.useRealTimers());

  const type = async (q: string) => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <GlobalSearch />
      </QueryClientProvider>,
    );
    const box = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(box, { target: { value: q } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    return box;
  };

  it('"bharat gstr1 sep" + Enter opens the filing’s section', async () => {
    apiFetch.mockResolvedValue(response);
    const box = await type('bharat gstr1 sep');
    expect(apiFetch).toHaveBeenCalledWith('/search?q=bharat%20gstr1%20sep');
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('group', { name: 'Filings' })).toBeInTheDocument();
    expect(within(list).getByText('Looking for GSTR1 · Sep 2026')).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith(FILING_HREF);
  });

  it('arrow keys pick another hit', async () => {
    apiFetch.mockResolvedValue(response);
    const box = await type('bharat gstr1 sep');
    await screen.findByText('Bharat Textiles');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/entities/c1');
  });

  it('without ff_filing_runs it searches clients and engagements as before', async () => {
    wide = false;
    apiFetch.mockResolvedValue({ items: [], total: 0 });
    await type('bharat');
    const paths = apiFetch.mock.calls.map((c) => c[0] as string);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/entities?search=bharat&limit=5',
        '/engagements?search=bharat&limit=5',
      ]),
    );
    expect(paths.some((p) => p.startsWith('/search'))).toBe(false);
  });
});
