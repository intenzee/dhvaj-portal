'use client';

import { priorFiledChoices, type PriorFiledChoice, type Stream } from '@hsdg/contracts';
import { cn } from '@/lib/cn';

/** Whether every token of a choice is picked. */
export function choiceOn(choice: PriorFiledChoice, tokens: readonly string[]): boolean {
  return choice.tokens.every((t) => tokens.includes(t));
}

/** Pick or drop a choice's tokens (pure). */
export function toggleChoice(choice: PriorFiledChoice, tokens: readonly string[]): string[] {
  return choiceOn(choice, tokens)
    ? tokens.filter((t) => !choice.tokens.includes(t))
    : [...new Set([...tokens, ...choice.tokens])];
}

/** Every choice of these years whose period has begun before `month` ('YYYY-MM'). */
export function choicesBefore(
  stream: Stream,
  financialYears: readonly string[],
  month: string,
): PriorFiledChoice[] {
  return financialYears.flatMap((fy) => {
    const { periods } = priorFiledChoices(stream, fy);
    return periods.filter((p) => p.tokens.every((t) => t < month));
  });
}

/**
 * "Filed before the portal": a stream's months (or quarters) for each year,
 * plus the year's annual returns, as toggles. A period still running (or yet
 * to come) cannot be ticked. `value` is the tokens sent to the API.
 */
export function PriorFiledPicker({
  stream,
  financialYears,
  value,
  onChange,
  today,
  label,
}: {
  stream: Stream;
  financialYears: readonly string[];
  value: readonly string[];
  onChange: (tokens: string[]) => void;
  /** 'YYYY-MM-DD' (IST). */
  today: string;
  label?: string;
}): JSX.Element {
  const thisMonth = today.slice(0, 7);
  const upToLastMonth = choicesBefore(stream, financialYears, thisMonth);
  const allEarlierOn = upToLastMonth.length > 0 && upToLastMonth.every((c) => choiceOn(c, value));
  return (
    <div className="space-y-2" role="group" aria-label={label ?? 'Filed before the portal'}>
      {[...financialYears].sort().map((fy) => {
        const { periods, annual } = priorFiledChoices(stream, fy);
        const choices = annual ? [...periods, annual] : periods;
        return (
          <div key={fy} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs font-medium text-ink-muted">FY {fy}</span>
            {choices.map((c) => {
              const on = choiceOn(c, value);
              // A month is filed after it ends; the annual returns after the year.
              const notYet = c.firstMonth >= thisMonth;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  disabled={notYet && !on}
                  title={notYet ? 'This period has not ended yet.' : undefined}
                  onClick={() => onChange(toggleChoice(c, value))}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs transition',
                    on
                      ? 'border-success-500/40 bg-success-50 text-success-700'
                      : 'border-line bg-surface-raised text-ink-muted hover:border-primary-600/60',
                    notYet && !on && 'cursor-not-allowed opacity-40 hover:border-line',
                  )}
                >
                  {on && <span aria-hidden>✓ </span>}
                  {c.label}
                </button>
              );
            })}
          </div>
        );
      })}
      {upToLastMonth.length > 0 && (
        <div className="flex gap-3 text-xs">
          <button
            type="button"
            className="text-primary-700 hover:underline"
            onClick={() =>
              onChange(
                allEarlierOn
                  ? value.filter((t) => !upToLastMonth.some((c) => c.tokens.includes(t)))
                  : [...new Set([...value, ...upToLastMonth.flatMap((c) => c.tokens)])],
              )
            }
          >
            {allEarlierOn ? 'Clear the ended periods' : 'Tick every period that has ended'}
          </button>
          {value.length > 0 && (
            <button
              type="button"
              className="text-ink-muted hover:underline"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
