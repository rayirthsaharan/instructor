'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export type ToastOptions = {
  message: string;
  icon?: IconName;
  /** One Quiet action ("Undo"). Doubles the duration to 8s. */
  action?: { label: string; onAction: () => void };
};

export function toastDuration(hasAction: boolean): number {
  return hasAction ? 8000 : 4000;
}

/** Presentational toast (DS 7.8). Light: ink fill, bg text. Dark: surface-raised, ink text, 1px line. */
export function ToastView({
  message,
  icon,
  action,
  className,
  live = true,
  ...rest
}: ToastOptions & { className?: string; live?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
      className={cn(
        'toast-enter flex max-w-[420px] items-center gap-3 rounded-sm px-4 py-3 shadow-elev-2',
        'bg-ink text-bg dark:border dark:border-line dark:bg-surface-raised dark:text-ink',
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      <p className="type-body min-w-0 flex-1">{message}</p>
      {action && (
        <Button
          variant="quiet"
          size="sm"
          onClick={action.onAction}
          className="!text-bg dark:!text-accent hover:!bg-white/10 !px-3"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

type Ctx = { show: (t: ToastOptions) => void; dismiss: () => void };
const ToastContext = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/**
 * Max one visible toast; the newest replaces. Pauses on hover/focus. Bottom offset (bar height + 12)
 * is set by the screen through the `--toast-offset` custom property on an ancestor.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  // The root layout already provides one; a nested provider (e.g. the gallery) reuses it so the page
  // has exactly one polite live region.
  const parent = useContext(ToastContext);
  if (parent) return <>{children}</>;
  return <ToastProviderRoot>{children}</ToastProviderRoot>;
}

function ToastProviderRoot({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const [paused, setPaused] = useState(false);
  const idRef = useRef(0);

  const show = useCallback((t: ToastOptions) => {
    idRef.current += 1;
    setPaused(false);
    setToast({ ...t, id: idRef.current });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);

  const id = toast?.id;
  const hasAction = !!toast?.action;
  useEffect(() => {
    if (id === undefined || paused) return;
    const h = setTimeout(() => setToast(null), toastDuration(hasAction));
    return () => clearTimeout(h);
  }, [id, hasAction, paused]);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 lg:justify-start"
        style={{ bottom: 'calc(var(--toast-offset, 0px) + 12px + env(safe-area-inset-bottom))' }}
      >
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {toast && (
            <ToastView
              key={toast.id}
              live={false}
              message={toast.message}
              icon={toast.icon}
              action={
                toast.action && {
                  label: toast.action.label,
                  onAction: () => {
                    toast.action?.onAction();
                    setToast(null);
                  },
                }
              }
            />
          )}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
