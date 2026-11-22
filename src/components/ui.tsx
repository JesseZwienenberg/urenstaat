/** Shared building blocks: large touch targets, large text. */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useStore } from '../store';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white active:bg-emerald-800 disabled:bg-gray-300 disabled:text-gray-500',
  secondary: 'bg-white text-gray-900 border-2 border-gray-300 active:bg-gray-100 disabled:text-gray-400',
  danger: 'bg-white text-red-700 border-2 border-red-300 active:bg-red-50',
  ghost: 'text-emerald-800 underline underline-offset-4',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-14 w-full rounded-xl px-4 py-3 text-lg font-semibold ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Page({
  title,
  subtitle,
  backLabel = 'Terug',
  showBack = true,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  backLabel?: string;
  showBack?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { back } = useStore();
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 bg-gray-800 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-white">
        {showBack && (
          <button type="button" onClick={back} className="-ml-2 mb-1 min-h-11 px-2 text-base text-gray-200">
            ‹ {backLabel}
          </button>
        )}
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-base text-gray-300">{subtitle}</p>}
      </header>
      <main className="flex-1 space-y-4 p-4">{children}</main>
      {footer && (
        <footer className="sticky bottom-0 space-y-3 border-t border-gray-200 bg-gray-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      )}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-base font-semibold text-gray-800">{label}</span>
      <input
        {...props}
        className="min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-3 text-lg focus:border-emerald-700 focus:outline-none"
      />
      {hint && <span className="mt-1 block text-sm text-gray-600">{hint}</span>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'warning' | 'ok' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-300 bg-red-50 text-red-900',
    warning: 'border-amber-400 bg-amber-50 text-amber-900',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    info: 'border-gray-300 bg-white text-gray-800',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border-2 p-3 text-base ${styles}`}>
      {children}
    </div>
  );
}

export const selectClass =
  'min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-3 text-lg focus:border-emerald-700 focus:outline-none';

export function Steps({ current }: { current: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <p className="text-sm font-semibold tracking-wide text-gray-500 uppercase" aria-label={`Stap ${current} van 5`}>
      Stap {current} van 5
    </p>
  );
}
