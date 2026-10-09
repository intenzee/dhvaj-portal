'use client';

/**
 * Reference links for a Section 02 sub-section (Section 02.2 spec §20): the
 * configured authority links for `contextKey` plus any cited provision ids,
 * resolved from the central Provision Library for the audit period
 * (`effectiveOn`); `anchors` narrows them to one field. Owned by the
 * provision-library segment; this is the mount point the 02.2 workspace renders.
 */
export function FrameworkReferences(_props: {
  contextKey: string;
  provisionIds?: string[];
  effectiveOn?: string;
  anchors?: string[];
}): JSX.Element | null {
  return null;
}
