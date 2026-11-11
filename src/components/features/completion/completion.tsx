'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Banner, Button, Icon, ProgressRing, segmentFills, Skeleton, SkeletonRegion, useToast } from '@/components/ui';
import { useGuide } from '@/lib/client/guide-store';
import { orderedSteps } from '@/lib/guide/selectors';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { ButtonLink } from '../common';
import { GuideLoadFailure } from '../overview/overview';
import { originalHref, playHref, stepsNeeding } from '../overview/logic';

export interface CompletionModel {
  total: number;
  doneCount: number;
  skipped: Array<{ n: number; id: string; title: string }>;
  missing: Array<{ id: string; name: string; kind: 'part' | 'tool'; steps: number[] }>;
  firstStepId: string;
}

/** Pure model of the Completion screen: what was skipped and what is still marked missing. */
export function completionModel(
  guide: ValidatedGuide,
  completedStepIds: string[],
  checklist: Record<string, 'unchecked' | 'have' | 'missing'>,
): CompletionModel {
  const steps = orderedSteps(guide);
  const done = new Set(completedStepIds);
  const skipped = steps.flatMap((s, i) => (done.has(s.id) ? [] : [{ n: i + 1, id: s.id, title: s.title }]));
  const isMissing = (id: string) => Object.hasOwn(checklist, id) && checklist[id] === 'missing';
  const missing = [
    ...guide.parts.filter((p) => isMissing(p.id)).map((p) => ({ id: p.id, name: p.name, kind: 'part' as const })),
    ...guide.tools.filter((t) => isMissing(t.id)).map((t) => ({ id: t.id, name: t.name, kind: 'tool' as const })),
  ].map((m) => ({ ...m, steps: stepsNeeding(guide, m.kind, m.id).map((s) => s.n) }));
  return { total: steps.length, doneCount: steps.length - skipped.length, skipped, missing, firstStepId: steps[0]!.id };
}

export function CompletionScreen({ guideId }: { guideId: string }) {
  const g = useGuide(guideId);
  const toast = useToast();
  const savedErr = useRef(false);
  useEffect(() => {
    if (g.saveState === 'error' && !savedErr.current) toast.show({ message: "Couldn't save - we'll retry" });
    savedErr.current = g.saveState === 'error';
  }, [g.saveState, toast]);

  if (g.status === 'loading') {
    return (
      <main className="mx-auto w-full max-w-[480px] px-4 pt-16">
        <SkeletonRegion>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="mx-auto mt-6 size-14 rounded-full" />
          <Skeleton className="mt-6 h-10 w-2/3" />
        </SkeletonRegion>
      </main>
    );
  }
  if (g.status !== 'ready' || !g.guide) return <GuideLoadFailure notFound={g.status === 'not_found'} onRetry={g.reload} />;

  const guide = g.guide;
  const m = completionModel(guide, g.progress.completedStepIds, g.progress.checklist);
  const finished = m.skipped.length === 0;
  const fills = segmentFills(
    guide.phases.map((p) => ({ steps: p.stepIds.length })),
    m.doneCount,
  );

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-col gap-6 px-4 pb-10 pt-16 md:min-h-dvh md:justify-center md:pt-10">
      <div
        role="progressbar"
        aria-label="Steps done"
        aria-valuemin={0}
        aria-valuemax={m.total}
        aria-valuenow={m.doneCount}
        aria-valuetext={`${m.doneCount} of ${m.total} steps done`}
        className="flex h-1.5 gap-0.5"
      >
        {guide.phases.map((p, i) => (
          <div key={p.id} className="h-full overflow-hidden rounded-full bg-line" style={{ flexGrow: p.stepIds.length, flexBasis: 0 }}>
            <div
              className={`h-full rounded-full ${(fills[i] ?? 0) >= 1 ? 'bg-success-fg' : 'bg-accent'}`}
              style={{ width: `${(fills[i] ?? 0) * 100}%` }}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3">
        {finished ? (
          <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-success-solid text-success-on">
            <Icon name="check" size={32} />
          </span>
        ) : (
          <ProgressRing percent={Math.round((m.doneCount / m.total) * 100)} label={`${m.doneCount} of ${m.total} steps done`} />
        )}
        <h1 className="type-display-xl">{finished ? 'Finished.' : 'Almost there.'}</h1>
        <p className="type-body-lg text-ink-muted">
          {finished
            ? `You completed all ${m.total} ${m.total === 1 ? 'step' : 'steps'} of ${guide.title}.`
            : `You've done ${m.doneCount} of ${m.total} steps of ${guide.title}.`}
        </p>
      </div>

      {!finished && (
        <section
          aria-labelledby="skipped-h"
          data-testid="skipped"
          className="rounded-md border-[1.5px] border-warn-fg bg-warn-soft p-4"
        >
          <h2 id="skipped-h" className="type-body-lg font-semibold">
            {`${m.skipped.length} ${m.skipped.length === 1 ? "step isn't" : "steps aren't"} marked done`}
          </h2>
          <ul className="mt-2 flex flex-col">
            {m.skipped.map((s) => (
              <li key={s.id}>
                <Link
                  href={playHref(guideId, s.id)}
                  className="flex min-h-14 items-center gap-3 rounded-sm text-ink no-underline hover:bg-surface-sunken"
                >
                  <span className="type-tag w-8 shrink-0 text-ink-muted">{s.n}</span>
                  <span className="min-w-0 flex-1">{s.title}</span>
                  <Icon name="chevronRight" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {m.missing.length > 0 && (
        <section aria-labelledby="missing-h" data-testid="missing" className="rounded-md border border-line bg-surface p-4">
          <h2 id="missing-h" className="type-body-lg font-semibold">
            Still marked missing
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {m.missing.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{p.name}</span>
                {p.steps.length > 0 && (
                  <span className="type-body-sm block text-ink-muted">{`Needed in ${p.steps.length === 1 ? 'step' : 'steps'} ${p.steps.join(', ')}`}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Banner kind="info">Keep the original manual - it has the care, warranty and safety information.</Banner>

      <div className="flex flex-col gap-2 lg:flex-row">
        <ButtonLink href="/" size="lg">
          Back to library
        </ButtonLink>
        <ButtonLink href={playHref(guideId, m.firstStepId)} variant="secondary" size="lg">
          Review the steps
        </ButtonLink>
        <ButtonLink href={originalHref(guideId, 1)} variant="quiet" size="lg">
          Open original manual
        </ButtonLink>
      </div>

      {g.saveState === 'error' && (
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
          Your latest changes aren&apos;t saved yet.
        </Banner>
      )}
    </main>
  );
}
