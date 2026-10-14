'use client';

import { useCallback } from 'react';
import { FEATURE_FLAG, workItemHref, type WorkItemRef } from '@hsdg/contracts';
import { useFeatureFlags } from './feature-flags';

/** A list row that can point at its work: the engagement, and (from the API) the exact item. */
export interface LinkedRow {
  engagementId: string;
  link?: WorkItemRef | null;
}

/**
 * Where a list row opens: the exact filing / task / request when the API sent
 * a `link` and ff_work_links is on, else the engagement (the old behaviour).
 * Pure — tested.
 */
export function workHrefFor(row: LinkedRow, workLinks: boolean): string {
  return workLinks && row.link ? workItemHref(row.link) : `/engagements/${row.engagementId}`;
}

/** `workHrefFor` bound to the current ff_work_links flag. */
export function useWorkHref(): (row: LinkedRow) => string {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.workLinks);
  return useCallback((row: LinkedRow) => workHrefFor(row, on), [on]);
}
