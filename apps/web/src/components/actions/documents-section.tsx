'use client';

import { DocumentsPanel } from '@/components/documents/documents-panel';

/**
 * Engagement-wide documents tab. Thin wrapper over the reusable
 * {@link DocumentsPanel} (list + live side preview, scoped upload, edit,
 * archive, and managing-partner-only delete). The same panel is reused, scoped,
 * inside the per-task and per-component-period drawers.
 */
export function DocumentsSection({ engagementId }: { engagementId: string }): JSX.Element {
  return (
    <section className="mt-4">
      <DocumentsPanel engagementId={engagementId} />
    </section>
  );
}
