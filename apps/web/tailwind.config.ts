import type { Config } from 'tailwindcss';

/**
 * HSDG design system — matches the practice-cockpit direction: an Inter type
 * scale, a corporate blue primary with semantic status colours, and a dark navy
 * sidebar. Clean, professional, information-dense (§22).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary (corporate blue) + supporting accents.
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        secondary: { 500: '#1da5e9', 600: '#0e8fd0' },
        success: { 50: '#ecfdf5', 500: '#16a34a', 600: '#15803d', 700: '#166534' },
        warning: { 50: '#fffbeb', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
        danger: { 50: '#fef2f2', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
        // Dark navy sidebar.
        sidebar: {
          DEFAULT: '#0b1220',
          hover: '#16203a',
          active: '#1d4ed8',
          muted: '#8ea2c6',
          border: '#1c2740',
        },
        ink: {
          DEFAULT: '#0f172a',
          muted: '#475569',
          faint: '#94a3b8',
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
