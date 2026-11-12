'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  BottomSheet,
  Button,
  buttonClass,
  Card,
  ConfirmDialog,
  Icon,
  type IconName,
  Menu,
  Skeleton,
  SkeletonRegion,
  useToast,
} from '@/components/ui';
import { deleteGuide } from '@/lib/client/api';
import { useGuide, type ChecklistState } from '@/lib/client/guide-store';
import { orderedSteps } from '@/lib/guide/selectors';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { pageList } from '@/lib/client/messages';
import { ButtonLink, IconLink, pageGutters } from '../common';
import {
  againHref,
  blockedSteps,
  checklistCounts,
  difficultyLabel,
  isDemoGuide,
  missingSentence,
  numberList,
  originalHref,
  readinessLine,
  startTarget,
  stepsNeeding,
} from './logic';
import { PrepRow } from './prep-row';

export function GuideLoadFailure({ notFound, onRetry }: { notFound: boolean; onRetry: () => void }) {
  return (
    <main className={`${pageGutters} flex flex-col gap-4 py-8`}>
      <h1 className="type-display-lg">{notFound ? "This guide isn't on this device." : "We couldn't open this guide."}</h1>
      <Banner kind={notFound ? 'info' : 'error'} label={notFound ? undefined : "Couldn't open"} live={!notFound}>
        {notFound ? 'It may have been deleted, or it belongs to another browser.' : 'Check your connection and try again.'}
      </Banner>
      <div className="flex flex-wrap gap-2">
        {!notFound && <Button onClick={onRetry}>Try again</Button>}
        <ButtonLink href="/" variant={notFound ? 'primary' : 'secondary'}>
          Back to library
        </ButtonLink>
      </div>
    </main>
  );
}

function OverviewSkeleton() {
  return (
    <main className={`${pageGutters} py-6`}>
      <SkeletonRegion>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-9 w-4/5" />
        <Skeleton className="mt-2 h-9 w-3/5" />
        <div className="mt-6 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}

function Fact({ value, caption, icon, children }: { value: string; caption: string; icon?: IconName; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3 md:p-4">
      {icon && <Icon name={icon} size={20} className="mb-1 text-ink-muted" />}
      <p className="type-display-md">{value}</p>
      {children}
      <p className="type-body-sm text-ink-muted">{caption}</p>
    </div>
  );
}

function Dots({ level }: { level: number }) {
  return (
    <span aria-hidden="true" className="my-1 flex gap-1">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`size-2.5 rounded-full ${i <= level ? 'bg-ink' : 'border border-ink-subtle'}`} />
      ))}
    </span>
  );
}

export function OverviewScreen({ guideId }: { guideId: string }) {
  const g = useGuide(guideId);
  const toast = useToast();

  const savedErr = useRef(false);
  useEffect(() => {
    if (g.saveState === 'error' && !savedErr.current) toast.show({ message: "Couldn't save - we'll retry" });
    savedErr.current = g.saveState === 'error';
  }, [g.saveState, toast]);

  if (g.status === 'loading') return <OverviewSkeleton />;
  if (g.status !== 'ready' || !g.guide || !g.documentId) {
    return <GuideLoadFailure notFound={g.status === 'not_found'} onRetry={g.reload} />;
  }
  return <Ready guideId={guideId} guide={g.guide} documentId={g.documentId} g={g} />;
}

type GuideApi = ReturnType<typeof useGuide>;

function Ready({ guideId, guide, documentId, g }: { guideId: string; guide: ValidatedGuide; documentId: string; g: GuideApi }) {
  const router = useRouter();
  const toast = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const { checklist, completedStepIds } = g.progress;
  const counts = useMemo(() => checklistCounts(guide, checklist), [guide, checklist]);
  const blocked = useMemo(() => blockedSteps(guide, checklist), [guide, checklist]);
  const steps = useMemo(() => orderedSteps(guide), [guide]);
  const target = startTarget(guideId, guide, g.progress);
  const doneSet = new Set(completedStepIds);
  const readiness = readinessLine(counts);
  const sentence = missingSentence(blocked, counts.missing);
  const unreadable = guide.unreadablePages.map((u) => u.pageIndex + 1).sort((a, b) => a - b);
  const needsAck = guide.safetyCritical && target.mode === 'start';
  const startDisabled = needsAck && !understood;

  const state = (id: string): ChecklistState => checklist[id] ?? 'unchecked';
  const showInManual = (page: number) => router.push(originalHref(guideId, page));

  function onStart() {
    if (target.mode === 'start' && (counts.unchecked > 0 || counts.missing > 0)) setSheetOpen(true);
    else router.push(target.href);
  }

  async function doDelete() {
    setConfirmDelete(false);
    try {
      await deleteGuide(guideId);
      router.push('/');
    } catch {
      toast.show({ message: "Couldn't delete the guide. Try again." });
    }
  }

  function checkAll(ids: string[]) {
    for (const id of ids) if (state(id) === 'unchecked') g.setChecklistItem(id, 'have');
  }

  const group = (title: string, kind: 'tool' | 'part') => {
    const items = kind === 'tool' ? guide.tools : guide.parts;
    const ids = items.map((i) => i.id);
    const checkAllOn = items.length > 0 && ids.some((id) => state(id) === 'unchecked');
    return (
      <section aria-label={title} data-testid={`prep-${kind}s`}>
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h3 className="type-label text-ink-muted">{title}</h3>
          {checkAllOn && (
            <>
              <span className="hidden md:block">
                <Button variant="quiet" size="sm" onClick={() => checkAll(ids)}>
                  {`Check all ${title.toLowerCase()}`}
                </Button>
              </span>
              <Menu
                className="md:hidden"
                label={`More options for ${title.toLowerCase()}`}
                items={[{ label: `Check all ${title.toLowerCase()}`, onSelect: () => checkAll(ids) }]}
              />
            </>
          )}
        </div>
        {items.length === 0 ? (
          <p className="type-body text-ink-muted">{`The manual doesn't list any ${kind === 'tool' ? 'tools' : 'parts'}.`}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <PrepRow
                key={item.id}
                guideId={guideId}
                documentId={documentId}
                item={item}
                kind={kind}
                state={state(item.id)}
                needed={stepsNeeding(guide, kind, item.id)}
                onState={(s) => g.setChecklistItem(item.id, s)}
                onShow={showInManual}
              />
            ))}
          </ul>
        )}
      </section>
    );
  };

  const startButton = (cls?: string) => (
    <Button
      size="lg"
      className={cls}
      disabled={startDisabled}
      onClick={onStart}
      helper={startDisabled ? 'Tick "I understand" above to start.' : undefined}
    >
      {target.label}
    </Button>
  );

  const readinessBlock = (
    <div aria-live="polite">
      {readiness && (
        <p className="type-body-sm font-semibold" data-testid="readiness">
          {readiness}
        </p>
      )}
      {sentence && (
        <p className="type-body-sm text-ink-muted" data-testid="missing-sentence">
          {sentence}
        </p>
      )}
    </div>
  );

  const unchecked = counts.unchecked;
  const itemWord = (n: number) => (n === 1 ? 'item' : 'items');
  const missingWord = counts.missingTools === 0 ? 'part' : counts.missingParts === 0 ? 'tool' : 'item';

  return (
    <div className="pb-48 lg:pb-12">
      <header className={`${pageGutters} flex items-center justify-between py-2`}>
        <IconLink href="/" icon="chevronLeft" label="Back to library" />
        <Menu
          label="More actions for this guide"
          items={[
            { label: 'Original manual', onSelect: () => showInManual(1) },
            { label: 'Delete guide', onSelect: () => setConfirmDelete(true), danger: true },
          ]}
        />
      </header>
      <main className={`${pageGutters} lg:grid lg:grid-cols-12 lg:gap-x-10`}>
        <div className="mx-auto w-full max-w-[640px] lg:col-span-7 lg:row-start-1 lg:max-w-none">
          <p className="type-label text-ink-muted">Here&apos;s the plan</p>
          <h1 className="type-display-xl mt-1">{guide.title}</h1>
          {isDemoGuide(guide) && (
            <p className="type-tag mt-2 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-ink-muted" data-testid="demo-label">
              Demo guide - mock analysis, not read from your manual
            </p>
          )}
          {guide.summary && <p className="type-body-lg mt-3 text-ink-muted">{guide.summary}</p>}

          <div className="mt-6 grid grid-cols-3 gap-2 md:gap-3" data-testid="facts">
            {guide.estimatedMinutes ? <Fact icon="clock" value={`About ${guide.estimatedMinutes} min`} caption="Time" /> : <Fact icon="clock" value="Not stated" caption="Time" />}
            <Fact icon="people" value={`${guide.peopleNeeded} ${guide.peopleNeeded === 1 ? 'person' : 'people'}`} caption="Needed" />
            <Fact value={difficultyLabel(guide.difficulty)} caption="Difficulty">
              <Dots level={guide.difficulty} />
            </Fact>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {guide.safetyCritical && (
              <Banner kind="warning" label="Safety-critical">
                This job involves safety-critical work. Follow the original manual&apos;s warnings exactly. If you&apos;re unsure, stop and
                get a qualified person.
                {target.mode === 'start' && (
                  <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                    <input
                      type="checkbox"
                      checked={understood}
                      onChange={(e) => setUnderstood(e.target.checked)}
                      className="size-7 shrink-0 accent-[var(--color-accent)]"
                    />
                    I understand
                  </label>
                )}
              </Banner>
            )}
            {unreadable.length > 0 && (
              <Banner
                kind="caution"
                label="Unreadable pages"
                action={
                  <>
                    <Link href={originalHref(guideId, unreadable[0]!)} className={buttonClass('quiet', 'sm')}>
                      {`View page ${unreadable[0]}`}
                    </Link>
                    <Link href={againHref(guide.unreadablePages.map((u) => u.pageIndex))} className={buttonClass('secondary', 'sm')}>
                      Start again with new photos or a new file
                    </Link>
                  </>
                }
              >
                {`We couldn't read ${pageList(unreadable)}. Steps from ${unreadable.length === 1 ? 'that page' : 'those pages'} may be missing. Check ${unreadable.length === 1 ? 'it' : 'them'} in the original.`}
              </Banner>
            )}
            <Banner kind="info">
              The original manual is the authority. If this guide and the manual differ, follow the manual. Steps are Instructor&apos;s
              wording of your manual. Text marked FROM YOUR MANUAL is the manual&apos;s exact words.
            </Banner>
            {g.saveFailed && (
              <Banner
                kind="error"
                label="Couldn't save"
                live
                action={
                  <Button variant="secondary" size="sm" onClick={() => void g.retrySave()}>
                    Try again
                  </Button>
                }
              >
                Your latest changes aren&apos;t saved yet. They are still on screen.
              </Banner>
            )}
          </div>
        </div>

        <section
          aria-labelledby="prep-h"
          className="mx-auto mt-8 w-full max-w-[640px] lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:max-w-none"
        >
          <div className="lg:sticky lg:top-6">
            <Card className="lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col">
              <h2 id="prep-h" className="type-display-md">
                Before you start
              </h2>
              <div className="mt-1">{readinessBlock}</div>
              <div className="mt-3 flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" data-testid="prep-groups">
                {group('Tools', 'tool')}
                {group('Parts', 'part')}
              </div>
              <div className="mt-4 hidden lg:block">{startButton('w-full')}</div>
            </Card>
          </div>
        </section>

        <section
          aria-labelledby="steps-h"
          className="mx-auto mt-8 w-full max-w-[640px] lg:col-span-7 lg:row-start-2 lg:max-w-none"
        >
          <h2 id="steps-h" className="type-display-md">
            The steps
          </h2>
          <p className="type-body-sm text-ink-muted">{`${steps.length} ${steps.length === 1 ? 'step' : 'steps'} in ${guide.phases.length} ${guide.phases.length === 1 ? 'phase' : 'phases'}`}</p>
          <ol className="mt-3 flex flex-col gap-2" data-testid="phases">
            {guide.phases.map((ph) => {
              const phSteps = ph.stepIds.map((id) => steps.find((s) => s.id === id)).filter((s) => !!s);
              const done = phSteps.filter((s) => doneSet.has(s.id)).length;
              return (
                <li key={ph.id}>
                  <details className="rounded-md border border-line bg-surface">
                    <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 px-4 py-2">
                      <span className="font-semibold">{ph.title}</span>
                      <span className="type-body-sm shrink-0 text-ink-muted">
                        {`${phSteps.length} ${phSteps.length === 1 ? 'step' : 'steps'}${done ? `, ${done} done` : ''}`}
                      </span>
                    </summary>
                    <ol className="border-t border-line">
                      {phSteps.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/g/${encodeURIComponent(guideId)}/play?step=${encodeURIComponent(s.id)}`}
                            className="flex min-h-14 items-center gap-3 px-4 py-2 text-ink no-underline hover:bg-surface-sunken"
                          >
                            <span className="type-tag w-8 shrink-0 text-ink-muted">{steps.indexOf(s) + 1}</span>
                            <span className="min-w-0 flex-1">{s.title}</span>
                            {doneSet.has(s.id) && <span className="type-body-sm text-success-fg">Done</span>}
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ol>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-2">
          {readiness && <p className="type-body-sm text-center text-ink-muted">{readiness}</p>}
          {startButton('w-full')}
        </div>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Start anyway?"
        footer={
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>
              Back to checklist
            </Button>
            <Button
              onClick={() => {
                setSheetOpen(false);
                router.push(target.href);
              }}
            >
              Start anyway
            </Button>
          </div>
        }
      >
        <div className="type-body-lg flex flex-col gap-2">
          {unchecked > 0 && <p>{`You haven't checked ${unchecked} ${itemWord(unchecked)}. Start anyway?`}</p>}
          {counts.missing > 0 && (
            <p>
              {`${counts.missing} ${missingWord}${counts.missing === 1 ? ' is' : 's are'} marked missing.${
                blocked.length ? ` ${blocked.length === 1 ? 'Step' : 'Steps'} ${numberList(blocked.map((b) => b.n))} ${counts.missing === 1 ? 'needs it' : 'need them'}.` : ''
              }`}
            </p>
          )}
        </div>
      </BottomSheet>
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
        title="Delete this guide?"
        message="The guide and the uploaded manual will be removed from this device's library."
        confirmLabel="Delete"
      />
    </div>
  );
}
