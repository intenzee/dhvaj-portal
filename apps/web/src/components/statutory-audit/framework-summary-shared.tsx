'use client';

import type { ReactNode } from 'react';
import {
  FRAMEWORK_SOURCE_ANCHOR,
  FRAMEWORK_SOURCE_SECTION_LABEL,
  type FrameworkSourceSection,
} from '@hsdg/contracts';

/** The 02.8 Track B panels' shared bits: the card heading and the "View 02.x" source link. */

export function PanelHeading({ title, hint }: { title: string; hint?: ReactNode }): JSX.Element {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Jump to the section that owns the conclusion — incorrect output is fixed there, never here. */
export function SourceLink({ source }: { source: FrameworkSourceSection }): JSX.Element {
  const label = FRAMEWORK_SOURCE_SECTION_LABEL[source] ?? source;
  return (
    <button
      type="button"
      className="text-left text-primary-700 hover:underline"
      title={`View ${label}`}
      onClick={() =>
        document
          .getElementById(FRAMEWORK_SOURCE_ANCHOR[source])
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    >
      {source === 'other_areas' ? 'Other areas' : source}
    </button>
  );
}
