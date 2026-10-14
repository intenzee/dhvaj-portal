import { workSectionsParam, type WorkSection } from '@hsdg/contracts';

/**
 * API paths for the client and engagement lists, and the home panel's "View
 * all" link — one place that writes `?section=` (any-of, comma list). Pure.
 */
function withQuery(path: string, q: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString().replace(/%2C/g, ',');
  return s ? `${path}?${s}` : path;
}

export function entityListPath(o: {
  limit: number;
  offset: number;
  search?: string;
  sections?: readonly WorkSection[];
}): string {
  return withQuery('/entities', {
    limit: o.limit,
    offset: o.offset,
    search: o.search,
    section: workSectionsParam(o.sections ?? []),
  });
}

export function engagementListPath(o: {
  limit: number;
  offset: number;
  status?: string;
  kind?: string;
  mine?: boolean;
  sections?: readonly WorkSection[];
}): string {
  return withQuery('/engagements', {
    limit: o.limit,
    offset: o.offset,
    status: o.status,
    kind: o.kind,
    mine: o.mine,
    section: workSectionsParam(o.sections ?? []),
  });
}

/** The engagements page for "my engagements" in these sections. */
export function myEngagementsHref(sections: readonly WorkSection[]): string {
  return withQuery('/engagements', { mine: true, section: workSectionsParam(sections) });
}
