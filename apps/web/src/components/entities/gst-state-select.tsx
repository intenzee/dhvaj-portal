'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { GST_STATES, gstStateOptions, readGstin } from '@hsdg/contracts';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';

/** The address dropdown's last option: an address abroad has no GST state. */
export const OUTSIDE_INDIA = 'outside';

const OPTIONS = gstStateOptions();

/** '07' → '07 · Delhi'; unknown codes as given. */
export function gstStateLabel(code: string | null | undefined): string {
  if (!code) return '';
  if (code === OUTSIDE_INDIA) return 'Outside India';
  return GST_STATES[code] ? `${code} · ${GST_STATES[code]}` : code;
}

/** Options matching what is typed: "del" or "07" both find Delhi. Pure — tested. */
export function matchStates(term: string, outside = false) {
  const t = term.trim().toLowerCase();
  const all = outside
    ? [...OPTIONS, { code: OUTSIDE_INDIA, name: 'Outside India', label: 'Outside India' }]
    : OPTIONS;
  if (!t) return all;
  return all.filter(
    (o) =>
      o.code.startsWith(t) || o.name.toLowerCase().includes(t) || o.label.toLowerCase().includes(t),
  );
}

/**
 * The state a GSTIN implies, and whether the chosen one differs from it.
 * Pure — tested.
 */
export function gstinStateCheck(
  gstin: string | null | undefined,
  value: string | null | undefined,
): { prefix: string | null; mismatch: boolean } {
  const read = readGstin(gstin);
  const prefix = read.valid && read.stateName ? read.stateCode : null;
  return { prefix, mismatch: !!prefix && !!value && value !== prefix && value !== OUTSIDE_INDIA };
}

/**
 * CM-2 · every State / State code field: a searchable dropdown of GST
 * states. With a GSTIN, the state is picked from its first two digits
 * ("from GSTIN"); choosing another asks once, in place — "Use Delhi (07)" or
 * "Keep Haryana" — and Keep sets `acknowledged`, which the form sends as
 * stateMismatchAcknowledged.
 */
export function GstStateSelect({
  value,
  onChange,
  gstin,
  acknowledged = false,
  onAcknowledge,
  allowOutside = false,
  id,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  gstin?: string | null;
  acknowledged?: boolean;
  onAcknowledge?: (ack: boolean) => void;
  /** Addresses: add "Outside India" at the end. */
  allowOutside?: boolean;
  id?: string;
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { prefix, mismatch } = gstinStateCheck(gstin, value);

  // A new valid GSTIN picks its state, unless someone chose one by hand.
  const lastPrefix = useRef<string | null>(null);
  useEffect(() => {
    if (prefix === lastPrefix.current) return;
    const prev = lastPrefix.current;
    lastPrefix.current = prefix;
    if (prefix && (!value || value === prev)) {
      onChange(prefix);
      onAcknowledge?.(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const results = useMemo(() => matchStates(term, allowOutside), [term, allowOutside]);
  const pick = (code: string): void => {
    onChange(code);
    onAcknowledge?.(false);
    setTerm('');
    setOpen(false);
  };

  return (
    <div ref={box}>
      <div className="relative">
        <div
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm',
            disabled && 'bg-surface-raised',
          )}
        >
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            disabled={disabled}
            value={open ? term : gstStateLabel(value)}
            placeholder={open ? 'Type a state or its code…' : 'Pick a state…'}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                e.preventDefault();
                pick(results[0].code);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {prefix && value === prefix && !open && (
            <span className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-700">
              from GSTIN
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        </div>
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 shadow-pop"
          >
            {results.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-faint">No state matches.</li>
            )}
            {results.map((o) => (
              <li key={o.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.code === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o.code)}
                  className={cn(
                    'block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-raised',
                    o.code === value && 'font-medium text-primary-700',
                  )}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {mismatch && !acknowledged && prefix && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          <p className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              GSTIN {readGstin(gstin).gstin} starts with {prefix}, which is {GST_STATES[prefix]}.
              You picked {gstStateLabel(value).replace(' · ', ' ')}. The first two digits of a GSTIN
              are always its state.
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" type="button" onClick={() => pick(prefix)}>
              Use {GST_STATES[prefix]} ({prefix})
            </Button>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => onAcknowledge?.(true)}
            >
              Keep {GST_STATES[value] ?? value}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
