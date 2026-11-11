import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  /** Explains why the button is disabled when that is not obvious (DS 7.1). */
  helper?: ReactNode;
  children: ReactNode;
};

const base =
  'inline-flex items-center justify-center gap-2 rounded-sm px-5 type-button t-fast select-none cursor-pointer disabled:cursor-not-allowed max-w-full';
const sizes: Record<ButtonSize, string> = {
  sm: 'h-11 text-[0.875rem]',
  md: 'h-12',
  lg: 'h-14',
};
const variants: Record<ButtonVariant, string> = {
  primary:
    'focus-on-accent bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed disabled:bg-surface-sunken disabled:text-ink-subtle disabled:hover:bg-surface-sunken',
  secondary:
    'bg-surface text-ink border-[1.5px] border-ink-subtle hover:bg-surface-sunken active:border-ink active:bg-surface-sunken disabled:bg-surface-sunken disabled:text-ink-subtle disabled:border-0 disabled:hover:bg-surface-sunken',
  quiet:
    'bg-transparent text-accent hover:bg-accent-soft active:bg-accent-soft active:text-accent-pressed disabled:text-ink-subtle disabled:hover:bg-transparent',
  danger:
    'focus-on-accent bg-danger-solid text-danger-on hover:bg-[color-mix(in_srgb,var(--color-danger-solid),black_8%)] active:bg-[color-mix(in_srgb,var(--color-danger-solid),black_16%)] disabled:bg-surface-sunken disabled:text-ink-subtle',
};

/** Class string of a Button, for links that look like buttons (navigation should be a link, not a button). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(base, sizes[size], variants[variant], 'no-underline', className);
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  helper,
  children,
  className,
  type = 'button',
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  const helperId = useId();
  const button = (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-describedby={helper ? helperId : rest['aria-describedby']}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(base, sizes[size], variants[variant], className)}
    >
      {loading ? <Icon name="spinner" size={20} className="spinner" /> : leadingIcon && <Icon name={leadingIcon} />}
      <span>{children}</span>
      {trailingIcon && <Icon name={trailingIcon} />}
    </button>
  );
  if (!helper) return button;
  return (
    <div className="inline-flex flex-col items-start gap-2">
      {button}
      <p id={helperId} className="type-body-sm text-ink-muted">
        {helper}
      </p>
    </div>
  );
}
