import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/** Static `surface-sunken` block: no shimmer, no pulse (DS 7.14). Always decorative. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('bg-surface-sunken rounded-sm', className)} {...rest} />;
}

/** Text skeleton: lines at 60-90% width, matching the final line height. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['90%', '75%', '60%', '85%', '70%'];
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded-xs bg-surface-sunken" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

/** Wraps skeleton content: hides it from AT and announces one "Loading" status per region. */
export function SkeletonRegion({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn(className)}>
      <span className="sr-only">Loading</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}
