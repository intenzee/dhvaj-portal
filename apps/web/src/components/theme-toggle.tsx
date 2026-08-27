'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';

/** Topbar light/dark switch. Renders a stable placeholder until mounted so the
 *  server and first client render match (the theme itself is applied pre-paint
 *  by the inline script in the root layout). */
export function ThemeToggle(): JSX.Element {
  const { resolved, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolved === 'dark';
  return (
    <button
      onClick={toggle}
      className="relative rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {mounted && isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
