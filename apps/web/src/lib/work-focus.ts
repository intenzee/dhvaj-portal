'use client';

import { useEffect, useRef } from 'react';
import { WORK_LINK_PARAM } from '@hsdg/contracts';
import { useUrlState } from './url-state';

/** How long a linked row stays highlighted. */
export const HIGHLIGHT_MS = 4000;
/** How long to wait for the linked row to render (trees and workspaces load lazily). */
const WAIT_MS = 10_000;

/** One element a work link may point at: a row is highlighted, a section is only focused. */
export interface WorkFocusTarget {
  selector: string;
  highlight: boolean;
}

/**
 * What a work link (`?part=` / `?task=` / `?request=`) points at on the page,
 * most specific first: a client request, then a task, then the filing part
 * of the open period. Empty when the link names none of them. Pure — tested.
 */
export function workFocusTargets(params: {
  part?: string | null;
  task?: string | null;
  request?: string | null;
}): WorkFocusTarget[] {
  const esc = (v: string) => v.replace(/["\\]/g, '\\$&');
  const targets: WorkFocusTarget[] = [];
  if (params.request) {
    targets.push({ selector: `[data-request-id="${esc(params.request)}"]`, highlight: true });
  }
  if (params.task) {
    targets.push({ selector: `[data-task-id="${esc(params.task)}"]`, highlight: true });
  }
  if (params.part) {
    targets.push({
      selector:
        params.part === 'annual'
          ? '[data-part="annual"]'
          : `[data-open-period] [data-part="${esc(params.part)}"]`,
      highlight: false,
    });
  }
  return targets;
}

/** Index of the first (most specific) target present under `root`, or -1. */
export function firstPresentTarget(root: ParentNode, targets: WorkFocusTarget[]): number {
  return targets.findIndex((t) => root.querySelector(t.selector) !== null);
}

/** Smooth scrolling, unless the person asked their system for reduced motion. */
function scrollBehavior(): ScrollBehavior {
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduce ? 'auto' : 'smooth';
}

/** Scroll an element into view, move focus to it (or its heading) and flash a row. */
export function revealWorkElement(el: HTMLElement, highlight: boolean): void {
  el.scrollIntoView({ behavior: scrollBehavior(), block: highlight ? 'center' : 'start' });
  const focusable = el.querySelector<HTMLElement>('[data-part-heading]') ?? el;
  if (
    !focusable.hasAttribute('tabindex') &&
    !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(focusable.tagName)
  ) {
    focusable.setAttribute('tabindex', '-1');
  }
  focusable.focus({ preventScroll: true });
  if (highlight) {
    el.setAttribute('data-work-highlight', '');
    window.setTimeout(() => el.removeAttribute('data-work-highlight'), HIGHLIGHT_MS);
  }
}

/**
 * Engagement page: once the element a work link names has rendered, bring it
 * into view, focus it and (for a task / request row) highlight it for a few
 * seconds. The filing part can render before the task row inside it (each
 * workspace loads on its own), so the best match so far is revealed and the
 * hook keeps waiting for the most specific one. Runs once per distinct link,
 * so later clicks that rewrite the URL (opening another month) don't yank
 * the scroll back.
 */
export function useWorkLinkFocus(): void {
  const url = useUrlState();
  const part = url.get(WORK_LINK_PARAM.part);
  const task = url.get(WORK_LINK_PARAM.task);
  const request = url.get(WORK_LINK_PARAM.request);
  const done = useRef<string | null>(null);

  useEffect(() => {
    const targets = workFocusTargets({ part, task, request });
    const key = targets.map((t) => t.selector).join('|');
    if (targets.length === 0 || key === done.current) return;

    let best = targets.length;
    let observer: MutationObserver | null = null;
    let timer: number | null = null;
    const stop = () => {
      observer?.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
    const attempt = (): boolean => {
      const i = firstPresentTarget(document, targets);
      if (i < 0 || i >= best) return false;
      best = i;
      done.current = key;
      const t = targets[i]!;
      revealWorkElement(document.querySelector<HTMLElement>(t.selector)!, t.highlight);
      if (i > 0) return false;
      stop();
      return true;
    };
    if (attempt()) return;
    observer = new MutationObserver(() => {
      attempt();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(stop, WAIT_MS);
    return stop;
  }, [part, task, request]);
}
