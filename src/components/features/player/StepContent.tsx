'use client';

import { useState } from 'react';
import {
  Banner,
  BottomSheet,
  Button,
  Disclosure,
  Icon,
  InstructorNote,
  PageTag,
  PartChip,
  ProvenanceTag,
  SourceQuote,
  WarningBanner,
} from '@/components/ui';
import type { Guidance, Step } from '@/lib/guide/schema';
import { partsForStep, toolsForStep } from '@/lib/guide/selectors';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { PartThumb } from '../overview/part-thumb';
import { missingPartSentence, sortedWarnings, type MissingPartUse, type StepPosition } from './model';

const sectionLabel = 'type-label text-ink-muted';

/** Guidance from the manual (with its quote) or labelled as Instructor's own (D-011). */
function GuidanceBody({ g, page, lang }: { g: Guidance; page: number; lang: string }) {
  return (
    <>
      {g.origin === 'inferred' && <InstructorNote />}
      <p>{g.text}</p>
      {g.origin === 'manual' && g.sourceQuote && <SourceQuote quote={g.sourceQuote} page={page} lang={lang} />}
    </>
  );
}

export interface StepContentProps {
  guide: ValidatedGuide;
  documentId: string;
  step: Step;
  position: StepPosition;
  isDone: boolean;
  review: boolean;
  missing: MissingPartUse[];
  selectedPartId: string | null;
  onSelectPart: (partId: string | null) => void;
  onOpenOriginal: (pageIndex: number) => void;
  onFoundPart: (partId: string) => void;
  /** Image failed to load: point the user to the original manual. */
  imageFailed?: boolean;
}

/** The text panel of a step, in the fixed safety-driven order of USER_FLOWS 6.2. */
export function StepContent(p: StepContentProps) {
  const { guide, step, position } = p;
  const page = (step.sources[0]?.pageIndex ?? 0) + 1;
  const openFirstPage = () => p.onOpenOriginal(step.sources[0]?.pageIndex ?? 0);
  const parts = partsForStep(guide, step.id);
  const tools = toolsForStep(guide, step.id);
  const [partSheet, setPartSheet] = useState<string | null>(null);
  const sheetPart = partSheet ? parts.find((x) => x.part.id === partSheet) : undefined;

  return (
    <article data-testid="step-content" data-step={step.id} className="flex flex-col gap-4">
      {step.irreversible && <Banner kind="irreversible" />}
      {sortedWarnings(step.warnings).map((w, i) => (
        <WarningBanner
          key={i}
          severity={w.severity}
          text={w.text}
          sourceQuote={w.sourceQuote}
          page={page}
          lang={guide.language}
          onOpenPage={openFirstPage}
        />
      ))}
      {p.missing.map((m) => (
        <Banner
          key={m.part.id}
          kind="caution"
          label="Missing part"
          action={
            <Button variant="quiet" size="sm" onClick={() => p.onFoundPart(m.part.id)}>
              I found it
            </Button>
          }
        >
          {missingPartSentence(m)}
        </Banner>
      ))}
      {step.confidence === 'low' && (
        <Banner
          kind="unsure"
          action={
            <Button variant="quiet" size="sm" onClick={openFirstPage}>
              Show original page
            </Button>
          }
        />
      )}

      <div>
        <h1 tabIndex={-1} className="type-display-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4" data-testid="step-title">
          <span className="sr-only">
            Step {position.number} of {position.total}:{' '}
          </span>
          {step.title}
        </h1>
        {p.isDone && (
          <p className="type-body-sm mt-1 inline-flex items-center gap-1 font-semibold text-success-fg" data-testid="done-tag">
            <Icon name="checkCircle" size={20} /> Done
          </p>
        )}
      </div>

      <p className="type-glance" data-testid="instruction">
        {step.instruction}
      </p>

      {(step.sourceQuote || step.interpretedFromDiagram) && (
        <div className="flex flex-col items-start gap-2">
          <SourceQuote quote={step.sourceQuote} page={page} lang={guide.language} onOpenPage={openFirstPage} />
          {step.interpretedFromDiagram && <ProvenanceTag kind="diagram" />}
        </div>
      )}

      {(parts.length > 0 || tools.length > 0) && (
        <section aria-label="For this step" className="flex flex-col gap-2">
          <h2 className={sectionLabel}>For this step</h2>
          <ul className="flex flex-wrap gap-2" data-testid="step-chips">
            {parts.map(({ part, quantity }) => {
              const isMissing = missingIds(p.missing).has(part.id);
              const selected = p.selectedPartId === part.id;
              return (
                <li key={part.id} className="max-w-full">
                  <PartChip
                    name={part.name}
                    manualLabel={part.manualLabel}
                    quantity={quantity ? `x${quantity}` : undefined}
                    thumbnail={<PartThumb documentId={p.documentId} source={part.source} size={32} />}
                    selected={selected}
                    missing={isMissing}
                    onSelect={() => {
                      if (selected) setPartSheet(part.id);
                      else p.onSelectPart(part.id);
                    }}
                  />
                </li>
              );
            })}
            {tools.map((tool) => (
              <li key={tool.id} className="max-w-full">
                {tool.source ? (
                  <PartChip tool name={tool.name} included={tool.included} onSelect={() => p.onOpenOriginal(tool.source!.pageIndex)} />
                ) : (
                  <span className="inline-flex h-12 items-center gap-2 rounded-sm border border-ink-subtle bg-surface px-2">
                    <Icon name="wrench" size={20} className="text-ink-muted" />
                    <span className="font-semibold">{tool.name}</span>
                    {!tool.included && <span className="type-body-sm whitespace-nowrap text-ink-muted">Not in the box</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {step.checkpoint && (
        <section className="rounded-md bg-success-soft p-3" data-testid="checkpoint">
          <p className="type-label flex items-center gap-2 text-success-fg">
            <Icon name="checkCircle" size={20} /> You&apos;ll know it&apos;s right when
          </p>
          <div className="type-body-lg mt-1 flex flex-col gap-1 text-ink">
            <p>{step.checkpoint.text}</p>
            {step.checkpoint.origin === 'inferred' && <InstructorNote />}
            {step.checkpoint.origin === 'manual' && step.checkpoint.sourceQuote && (
              <SourceQuote quote={step.checkpoint.sourceQuote} page={page} lang={guide.language} />
            )}
          </div>
        </section>
      )}

      <div>
        {step.why && (
          <Disclosure label="Why this matters">
            <GuidanceBody g={step.why} page={page} lang={guide.language} />
          </Disclosure>
        )}
        {step.commonMistake && (
          <Disclosure label="Common mistake">
            <GuidanceBody g={step.commonMistake} page={page} lang={guide.language} />
          </Disclosure>
        )}
        <Disclosure label="Explain it more simply" className="border-b">
          <p>Simpler wording arrives with the assistant in the next update. The original instruction above stays as it is.</p>
        </Disclosure>
      </div>

      {p.imageFailed && <p className="type-body-sm text-ink-muted">The picture didn&apos;t load. You can still open the original manual.</p>}

      <div>
        <Button variant="quiet" size="sm" onClick={openFirstPage} data-testid="show-original">
          Show original page
        </Button>
      </div>

      <BottomSheet open={!!sheetPart} onClose={() => setPartSheet(null)} title={sheetPart?.part.name ?? 'Part'}>
        {sheetPart && (
          <div className="flex flex-col gap-3 pb-4">
            <div className="flex items-center gap-3">
              <PartThumb documentId={p.documentId} source={sheetPart.part.source} size={112} />
              <dl className="type-body flex flex-col gap-1">
                {sheetPart.part.manualLabel && (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Label in the manual</dt>
                    <dd className="type-tag">{sheetPart.part.manualLabel}</dd>
                  </div>
                )}
                {sheetPart.quantity !== undefined && (
                  <div className="flex gap-2">
                    <dt className="text-ink-muted">Needed in this step</dt>
                    <dd className="type-tag">x{sheetPart.quantity}</dd>
                  </div>
                )}
              </dl>
            </div>
            {sheetPart.part.description && <p className="type-body-lg">{sheetPart.part.description}</p>}
            <div className="flex items-center gap-2">
              <PageTag page={sheetPart.part.source.pageIndex + 1} />
              <Button
                variant="secondary"
                onClick={() => {
                  const idx = sheetPart.part.source.pageIndex;
                  setPartSheet(null);
                  p.onOpenOriginal(idx);
                }}
              >
                Show in manual
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </article>
  );
}

const missingIds = (m: MissingPartUse[]) => new Set(m.map((x) => x.part.id));
