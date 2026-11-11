'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { buttonClass, cn, Icon, type ButtonSize, type ButtonVariant, type IconName } from '@/components/ui';
import { pageImageUrl } from '@/lib/client/api';

/** A link that looks like a Button: navigation is a link, not a button. */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  leadingIcon,
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: IconName;
  className?: string;
  children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {leadingIcon && <Icon name={leadingIcon} />}
      <span>{children}</span>
    </Link>
  );
}

/** 44px icon-only link (same look as IconButton). */
export function IconLink({ href, icon, label, className }: { href: string; icon: IconName; label: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn('inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-ink t-fast hover:bg-surface-sunken active:bg-line', className)}
    >
      <Icon name={icon} />
    </Link>
  );
}

/** Four L-shaped corners around a page (decorative; the "snap" motif of the identity). */
export function BracketFrame({ children, className }: { children: ReactNode; className?: string }) {
  const corner = 'absolute size-4 border-ink';
  return (
    <div className={cn('relative p-2', className)}>
      <span aria-hidden="true" className={cn(corner, 'left-0 top-0 border-l-2 border-t-2')} />
      <span aria-hidden="true" className={cn(corner, 'right-0 top-0 border-r-2 border-t-2')} />
      <span aria-hidden="true" className={cn(corner, 'bottom-0 left-0 border-b-2 border-l-2')} />
      <span aria-hidden="true" className={cn(corner, 'bottom-0 right-0 border-b-2 border-r-2')} />
      {children}
    </div>
  );
}

/** Page image from the API. Decorative (the title beside it carries the meaning). Falls back to a plain box. */
export function PageImage({
  documentId,
  pageIndex = 0,
  className,
}: {
  documentId: string;
  pageIndex?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn('overflow-hidden rounded-sm border border-line bg-surface-sunken', className)} aria-hidden="true">
      {failed ? (
        <div className="flex size-full items-center justify-center text-ink-subtle">
          <Icon name="page" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- served by our API, already page-sized
        <img
          src={pageImageUrl(documentId, pageIndex)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

export const pageGutters = 'mx-auto w-full max-w-[1200px] px-4 md:px-6 lg:px-8';
