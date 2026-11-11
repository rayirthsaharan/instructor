'use client';

import { useParams } from 'next/navigation';
import { Skeleton, SkeletonRegion } from '@/components/ui';
import { useGuides } from '@/lib/client/hooks';
import { ButtonLink, pageGutters } from './common';

/** Temporary overview (M1-b): the real overview is built in the next milestone. */
export function GuidePlaceholder() {
  const { id } = useParams<{ id: string }>();
  const { status, guides } = useGuides();
  const guide = guides.find((g) => g.id === id);
  return (
    <main className={`${pageGutters} flex flex-col gap-4 py-8`}>
      {status === 'loading' ? (
        <SkeletonRegion>
          <Skeleton className="h-9 w-2/3" />
        </SkeletonRegion>
      ) : (
        <h1 className="type-display-xl">{guide?.title?.trim() || (status === 'error' ? "We couldn't load this guide." : 'Your guide')}</h1>
      )}
      <p className="type-body-lg text-ink-muted">Guide overview coming next</p>
      <ButtonLink href="/" variant="secondary" className="self-start">
        Back to library
      </ButtonLink>
    </main>
  );
}
