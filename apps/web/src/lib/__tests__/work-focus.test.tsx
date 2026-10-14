import { act, render } from '@testing-library/react';
import {
  HIGHLIGHT_MS,
  firstPresentTarget,
  revealWorkElement,
  useWorkLinkFocus,
  workFocusTargets,
} from '../work-focus';

let search = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/engagements/e1',
  useSearchParams: () => search,
}));

const scrollIntoView = jest.fn();
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
beforeEach(() => {
  scrollIntoView.mockClear();
  document.body.innerHTML = '';
});

describe('workFocusTargets', () => {
  it('orders request, task, then the open period’s part', () => {
    expect(workFocusTargets({ part: 'outward', task: 't1', request: 'd1' })).toEqual([
      { selector: '[data-request-id="d1"]', highlight: true },
      { selector: '[data-task-id="t1"]', highlight: true },
      { selector: '[data-open-period] [data-part="outward"]', highlight: false },
    ]);
  });
  it('the annual part is not inside a period', () => {
    expect(workFocusTargets({ part: 'annual' })).toEqual([
      { selector: '[data-part="annual"]', highlight: false },
    ]);
  });
  it('nothing to focus', () => {
    expect(workFocusTargets({})).toEqual([]);
  });
  it('escapes quotes so a crafted link cannot break the selector', () => {
    const [t] = workFocusTargets({ task: 'a"]' });
    expect(() => document.querySelector(t!.selector)).not.toThrow();
  });
});

describe('revealWorkElement', () => {
  it('scrolls a section to the top and focuses its heading', () => {
    document.body.innerHTML =
      '<section data-part="outward"><h4 data-part-heading>Outward</h4></section>';
    const el = document.querySelector<HTMLElement>('section')!;
    revealWorkElement(el, false);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(document.activeElement?.textContent).toBe('Outward');
    expect(el.hasAttribute('data-work-highlight')).toBe(false);
  });
  it('jumps without animation when the system asks for reduced motion', () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as never;
    document.body.innerHTML = '<section data-part="outward"></section>';
    revealWorkElement(document.querySelector<HTMLElement>('section')!, false);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    window.matchMedia = matchMedia;
  });
  it('centres and flashes a row, then clears the highlight', () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<li data-task-id="t1">Task</li>';
    const el = document.querySelector<HTMLElement>('li')!;
    revealWorkElement(el, true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(el.hasAttribute('data-work-highlight')).toBe(true);
    jest.advanceTimersByTime(HIGHLIGHT_MS);
    expect(el.hasAttribute('data-work-highlight')).toBe(false);
    jest.useRealTimers();
  });
});

function Probe({ children }: { children?: React.ReactNode }): JSX.Element {
  useWorkLinkFocus();
  return <div>{children}</div>;
}

describe('useWorkLinkFocus', () => {
  it('scrolls to the part once it renders, then to the task row inside it', async () => {
    search = new URLSearchParams('tab=gst&m=9&part=outward&task=t1');
    const { rerender } = render(<Probe />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The month opens: the Outward section renders before its workspace.
    rerender(
      <Probe>
        <div data-open-period="2026-09">
          <section data-part="outward">
            <h4 data-part-heading>Outward</h4>
          </section>
        </div>
      </Probe>,
    );
    await act(async () => {});
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(firstPresentTarget(document, workFocusTargets({ part: 'outward', task: 't1' }))).toBe(1);

    // The workspace loads its task.
    rerender(
      <Probe>
        <div data-open-period="2026-09">
          <section data-part="outward">
            <h4 data-part-heading>Outward</h4>
            <div data-task-id="t1">Task</div>
          </section>
        </div>
      </Probe>,
    );
    await act(async () => {});
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-task-id="t1"]')!.hasAttribute('data-work-highlight')).toBe(
      true,
    );
  });

  it('ignores a part in a month that is not open', async () => {
    search = new URLSearchParams('tab=gst&part=inward');
    render(
      <Probe>
        <section data-part="inward" />
      </Probe>,
    );
    await act(async () => {});
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
