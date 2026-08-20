import Link from 'next/link';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('rounded-xl border border-slate-200 bg-white shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('border-b border-slate-100 px-5 py-3.5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): JSX.Element {
  return <h3 className={cn('text-[15px] font-semibold text-ink', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

/** A titled panel with an optional right-aligned "view all" link — the dashboard workhorse. */
export function Panel({
  title,
  linkHref,
  linkLabel = 'View all',
  action,
  bodyClassName,
  className,
  children,
}: {
  title: string;
  linkHref?: string;
  linkLabel?: string;
  action?: ReactNode;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {action ??
          (linkHref && (
            <Link
              href={linkHref}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
            >
              {linkLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ))}
      </div>
      <div className={cn('flex-1 px-5 py-4', bodyClassName)}>{children}</div>
    </Card>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
};
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonProps): JSX.Element {
  const variants: Record<string, string> = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 disabled:bg-primary-600/50',
    secondary: 'border border-slate-300 bg-white text-ink hover:bg-slate-50',
    ghost: 'text-ink-muted hover:bg-slate-100',
    subtle: 'bg-primary-50 text-primary-700 hover:bg-primary-100',
  };
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

const TONES: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-primary-50 text-primary-700',
  warn: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  success: 'bg-success-50 text-success-700',
};
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof TONES | string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        TONES[tone] ?? TONES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary-600" />
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-ink-muted">
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
