import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  /** Required: an icon-only control has no other name. */
  'aria-label': string;
  icon: IconName;
  /** 44 everywhere, 56 in the step player action bar. */
  size?: 44 | 56;
  /** For toggles; sets aria-pressed. */
  pressed?: boolean;
  /** Accent-coloured icon (e.g. zoom reset when zoomed). */
  accent?: boolean;
};

export function IconButton({ icon, size = 44, pressed, accent, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        'inline-flex items-center justify-center rounded-sm t-fast cursor-pointer hover:bg-surface-sunken active:bg-line disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        accent ? 'text-accent' : 'text-ink',
        pressed && 'bg-accent-soft text-accent',
        size === 56 ? 'size-14' : 'size-11',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
