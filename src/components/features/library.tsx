'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Icon,
  Menu,
  ProgressRing,
  SegmentedProgress,
  Skeleton,
  SkeletonRegion,
  useToast,
} from '@/components/ui';
import { deleteDocument, deleteGuide } from '@/lib/client/api';
import { setPendingFiles } from '@/lib/client/handoff';
import { useGuides } from '@/lib/client/hooks';
import { isInFlight } from '@/lib/client/poll';
import { byRecent, libraryState, guideHref, hero as pickHero, type CardState } from '@/lib/client/library';
import type { GuideSummary } from '@/lib/client/types';
import { ButtonLink, IconLink, PageImage, pageGutters } from './common';

function metaLine(g: GuideSummary): string {
  const steps = `${g.stepCount} ${g.stepCount === 1 ? 'step' : 'steps'}`;
  return g.estimatedMinutes ? `${steps} - about ${g.estimatedMinutes} min` : steps;
}

function Thumb({ g, className }: { g: GuideSummary; className: string }) {
  if (isInFlight(g.status)) return <Skeleton className={className} />;
  return <PageImage documentId={g.documentId} pageIndex={g.thumbnailPage ?? 0} className={className} />;
}

function StatusLine({ g, state }: { g: GuideSummary; state: CardState }) {
  if (state === 'processing')
    return <p className="type-body-sm mt-1 text-ink-muted">{g.status === 'queued' ? 'Waiting to start' : 'Reading your manual'}</p>;
  if (state === 'failed')
    return (
      <p className="type-body-sm mt-1 inline-flex items-center gap-1 text-danger-fg">
        <Icon name="crossCircle" size={20} /> Couldn&apos;t finish - Try again
      </p>
    );
  if (state === 'finished')
    return (
      <p className="type-body-sm mt-1 inline-flex items-center gap-1 text-success-fg">
        <Icon name="checkCircle" size={20} /> Finished
      </p>
    );
  if (state === 'inProgress')
    return (
      <p className="type-body-sm mt-1 flex items-center gap-2 text-ink-muted">
        <ProgressRing percent={g.progress.percent} />
        <span>
          Step {g.progress.completedCount + 1} of {g.stepCount}
        </span>
      </p>
    );
  return <p className="type-body-sm mt-1 text-ink-muted">Ready</p>;
}

function LibraryCard({ g, onDelete }: { g: GuideSummary; onDelete: (g: GuideSummary) => void }) {
  const router = useRouter();
  const state = libraryState(g);
  const title = g.title?.trim() || 'New manual';
  const ready = state !== 'processing' && state !== 'failed' && !!g.id;
  return (
    <li className="relative" data-testid="guide-card" data-state={state}>
      <Link
        href={guideHref(g)}
        className="flex min-h-24 items-center gap-4 rounded-md border border-line bg-surface p-4 pr-14 text-ink no-underline t-fast hover:border-ink-subtle active:bg-surface-sunken lg:flex-col lg:items-stretch lg:p-5 lg:pr-5"
      >
        <Thumb g={g} className="h-[85px] w-16 shrink-0 lg:aspect-[3/4] lg:h-auto lg:w-32" />
        <div className="min-w-0 flex-1">
          <h3 className="type-display-md line-clamp-2">{title}</h3>
          {state !== 'processing' && state !== 'failed' && <p className="type-body-sm mt-1 text-ink-muted">{metaLine(g)}</p>}
          <StatusLine g={g} state={state} />
        </div>
      </Link>
      <Menu
        label={`More actions for ${title}`}
        className="absolute right-1 top-1"
        items={[
          { label: ready ? 'Open overview' : 'See status', onSelect: () => router.push(ready ? `/g/${g.id}` : `/d/${g.documentId}`) },
          { label: 'Delete', danger: true, onSelect: () => onDelete(g) },
        ]}
      />
    </li>
  );
}

function ContinueHero({ g }: { g: GuideSummary }) {
  const title = g.title?.trim() || 'Your manual';
  const current = Math.min(g.stepCount, g.progress.completedCount + 1);
  return (
    <section aria-labelledby="continue-h" className="lg:col-span-8">
      <Card
        className="grid grid-cols-[5rem_1fr] content-start gap-x-4 gap-y-4 md:grid-cols-[10rem_1fr] md:gap-x-6 lg:p-6"
        data-testid="continue-hero"
      >
        <PageImage
          documentId={g.documentId}
          pageIndex={g.thumbnailPage ?? 0}
          className="aspect-[3/4] w-full md:row-span-2"
        />
        <div className="min-w-0">
          <p className="type-label text-ink-muted">Continue</p>
          <h2 id="continue-h" className="type-display-md line-clamp-3">
            {title}
          </h2>
        </div>
        <div className="col-span-2 flex flex-col gap-4 md:col-span-1 md:self-end">
          <SegmentedProgress
            phases={[{ steps: g.stepCount }]}
            current={current}
            total={g.stepCount}
            completed={g.progress.completedCount}
          />
          <ButtonLink href={guideHref(g)} size="lg" className="w-full md:w-auto md:self-start">
            Continue
          </ButtonLink>
        </div>
      </Card>
    </section>
  );
}

/** Desktop-only drop target: files dropped here go straight to Capture (USER_FLOWS 2, 1280 layout). */
function AddTile() {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setPendingFiles(files);
    router.push('/new');
  };
  return (
    <Link
      href="/new"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`hidden min-h-48 flex-col items-center justify-center gap-2 rounded-md border-2 p-6 text-center text-ink no-underline t-fast lg:col-span-4 lg:flex ${
        over ? 'border-solid border-accent bg-accent-soft' : 'border-dashed border-ink-subtle bg-surface hover:border-ink'
      }`}
    >
      <Icon name="page" size={40} className="text-ink-muted" />
      <span className="type-display-md">{over ? 'Drop to add' : 'Add a manual'}</span>
      <span className="type-body-sm text-ink-muted">Drop a PDF or page photos here, or choose files</span>
    </Link>
  );
}

function EmptyState() {
  return (
    <section className="mx-auto flex max-w-[34rem] flex-col items-center gap-4 py-12 text-center" data-testid="library-empty">
      <Icon name="page" size={56} className="text-ink-muted" />
      <h2 className="type-display-lg">Turn any manual into clear steps</h2>
      <p className="type-body-lg text-ink-muted">
        Add the PDF, or take photos of the paper booklet. We&apos;ll mark up the manual&apos;s own pictures, one step at a time.
      </p>
      <ButtonLink href="/new" size="lg" leadingIcon="plus" className="w-full md:w-auto">
        Add a manual
      </ButtonLink>
      <ul className="type-body mt-4 flex flex-col gap-2 text-ink-muted">
        <li>Check your parts first</li>
        <li>One step per screen</li>
        <li>Ask when you&apos;re stuck</li>
      </ul>
    </section>
  );
}

function LoadingState() {
  return (
    <SkeletonRegion>
      <Skeleton className="mb-6 h-48 rounded-md" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-md" />
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function LibraryScreen() {
  const router = useRouter();
  const toast = useToast();
  const { status, guides, reload, refresh } = useGuides();
  const [target, setTarget] = useState<GuideSummary | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const sorted = useMemo(() => [...guides].sort(byRecent), [guides]);
  const heroGuide = pickHero(sorted);

  // "Your guide is ready" when a manual finishes while the Library is open.
  const seen = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const g of guides) {
      const before = seen.current.get(g.documentId);
      if (before && isInFlight(before) && g.status === 'ready') {
        toast.show({
          message: 'Your guide is ready',
          action: { label: 'Open', onAction: () => router.push(`/g/${g.id ?? ''}`) },
        });
      }
      seen.current.set(g.documentId, g.status);
    }
  }, [guides, toast, router]);

  const confirmDelete = async () => {
    const g = target;
    setConfirmOpen(false);
    if (!g) return;
    try {
      await (g.id ? deleteGuide(g.id) : deleteDocument(g.documentId));
      setDeleteFailed(false);
      toast.show({ message: 'Guide deleted' });
      refresh();
    } catch {
      setDeleteFailed(true);
    }
  };

  return (
    <div className={`${pageGutters} pb-12`}>
      <header className="flex items-center justify-between py-3 md:py-5">
        <h1 className="type-display-md">Instructor</h1>
        <div className="md:hidden">
          <IconLink href="/new" icon="plus" label="Add a manual" />
        </div>
        <div className="hidden md:block">
          <ButtonLink href="/new" leadingIcon="plus">
            Add a manual
          </ButtonLink>
        </div>
      </header>
      <main className="flex flex-col gap-6">
        {deleteFailed && (
          <Banner
            kind="error"
            live
            label="Couldn't delete"
            action={
              <Button variant="quiet" onClick={confirmDelete}>
                Try again
              </Button>
            }
          >
            We couldn&apos;t delete that guide.
          </Banner>
        )}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && (
          <Banner
            kind="error"
            live
            action={
              <Button variant="quiet" onClick={reload}>
                Try again
              </Button>
            }
          >
            We couldn&apos;t load your guides.
          </Banner>
        )}
        {status === 'ready' && sorted.length === 0 && <EmptyState />}
        {status === 'ready' && sorted.length > 0 && (
          <>
            {heroGuide && (
              <div className="lg:grid lg:grid-cols-12 lg:gap-6">
                <ContinueHero g={heroGuide} />
                <AddTile />
              </div>
            )}
            <section aria-labelledby="guides-h">
              <h2 id="guides-h" className="type-label mb-3 text-ink-muted">
                Your guides
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                {sorted.map((g) => (
                  <LibraryCard
                    key={g.documentId}
                    g={g}
                    onDelete={(x) => {
                      setTarget(x);
                      setConfirmOpen(true);
                    }}
                  />
                ))}
              </ul>
            </section>
            <div className="md:hidden">
              <ButtonLink href="/new" variant="secondary" size="lg" className="w-full">
                Add a manual
              </ButtonLink>
            </div>
          </>
        )}
        {status === 'error' && (
          <div className="md:hidden">
            <ButtonLink href="/new" variant="secondary" size="lg" className="w-full">
              Add a manual
            </ButtonLink>
          </div>
        )}
      </main>
      <footer className="type-body-sm mt-8 text-ink-muted">Guides are saved on this device.</footer>
      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Delete this guide?"
        message="The guide and the uploaded manual will be removed from this device's library."
        confirmLabel="Delete"
      />
    </div>
  );
}
