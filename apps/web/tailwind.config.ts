import type { Config } from 'tailwindcss';

/** The theme-aware shades of a status hue (globals.css sets both themes). */
const flipping = (hue: string): Record<string, string> =>
  Object.fromEntries(
    [50, 100, 200, 300, 800].map((s) => [s, `rgb(var(--${hue}-${s}) / <alpha-value>)`]),
  );

/**
 * HSDG design system — matches the practice-cockpit direction: an Inter type
 * scale, a corporate blue primary with semantic status colours, and a dark navy
 * sidebar. Clean, professional, information-dense (§22).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Theme-aware semantic surfaces & borders (CSS variables flipped by the
        // `.dark` class — see globals.css). Channels are space-separated RGB so
        // the `/<alpha-value>` opacity syntax keeps working (bg-surface/70 etc.).
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        // Primary (corporate blue) + supporting accents. The tints (50–300) and
        // the deepest text shade (800) are CSS variables flipped by `.dark`, so
        // every use — bg-success-50/50, border-warning-200, text-warning-800 —
        // reads on a dark surface without a per-class override. 400–700 stay
        // fixed: they are solid buttons and badges with white text.
        primary: {
          ...flipping('primary'),
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        secondary: { 500: '#1da5e9', 600: '#0e8fd0' },
        success: {
          ...flipping('success'),
          400: '#4ade80',
          500: '#16a34a',
          600: '#15803d',
          700: '#166534',
        },
        warning: {
          ...flipping('warning'),
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        danger: {
          ...flipping('danger'),
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        },
        // Dark navy sidebar.
        sidebar: {
          DEFAULT: '#0b1220',
          hover: '#16203a',
          active: '#1d4ed8',
          muted: '#8ea2c6',
          border: '#1c2740',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        pop: '0 8px 24px -6px rgb(15 23 42 / 0.16)',
      },
    },
  },
  plugins: [],
};

export default config;
