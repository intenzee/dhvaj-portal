'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Spinner } from '@/components/ui';
import type { EditorHandle } from './types';

/** Plain-text / JSON / Markdown viewer and editor. Saves back with the original MIME type. */
export const TextEditor = forwardRef<EditorHandle, { blob: Blob; mime: string; readOnly: boolean; onDirty: () => void }>(
  function TextEditor({ blob, mime, readOnly, onDirty }, ref) {
    const [value, setValue] = useState<string | null>(null);
    const valueRef = useRef('');
    valueRef.current = value ?? '';

    useEffect(() => {
      let cancelled = false;
      void blob.text().then((t) => {
        if (!cancelled) setValue(t);
      });
      return () => {
        cancelled = true;
      };
    }, [blob]);

    useImperativeHandle(
      ref,
      () => ({
        async export(): Promise<Blob> {
          return new Blob([valueRef.current], { type: mime || 'text/plain' });
        },
      }),
      [mime],
    );

    if (value === null) {
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner label="Opening file…" />
        </div>
      );
    }

    return (
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => {
          setValue(e.target.value);
          onDirty();
        }}
        spellCheck={false}
        className="h-full w-full resize-none bg-surface-raised p-5 font-mono text-xs leading-relaxed text-ink outline-none"
      />
    );
  },
);
