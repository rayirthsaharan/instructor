'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Banner,
  BottomSheet,
  Button,
  Card,
  ChecklistRow,
  ChecklistRowSkeleton,
  Chip,
  CitationChip,
  ConfirmDialog,
  GuideCard,
  IconButton,
  InstructorNote,
  PartChip,
  ProgressRing,
  ProvenanceTag,
  SegmentedProgress,
  Skeleton,
  SkeletonRegion,
  SkeletonText,
  SourceQuote,
  ToastProvider,
  ToastView,
  WarningBanner,
  useToast,
  type ChecklistStatus,
} from '@/components/ui';

export type ThemeChoice = 'system' | 'light' | 'dark';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-4 py-6">
      <h2 id={`${id}-h`} className="type-display-lg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-label text-ink-muted">{label}</p>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

function Stack({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-label text-ink-muted">{label}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

const QUOTE = 'Do not overtighten the cam lock; it may crack the panel.';
// 1x1 grey PNG standing in for a part crop.
const THUMB =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="white"/><circle cx="16" cy="16" r="8" fill="none" stroke="#555" stroke-width="3"/></svg>',
  );

function ToastDemo() {
  const toast = useToast();
  return (
    <Row label="Live (newest replaces; 4s, 8s with action; pauses on hover/focus)">
      <Button variant="secondary" onClick={() => toast.show({ message: 'Marked as missing.' })}>
        Show toast
      </Button>
      <Button variant="secondary" onClick={() => toast.show({ message: 'Part removed.', action: { label: 'Undo', onAction: () => {} } })}>
        Show toast with Undo
      </Button>
    </Row>
  );
}

function Content() {
  const [chip, setChip] = useState(true);
  const [part, setPart] = useState(false);
  const [rows, setRows] = useState<ChecklistStatus[]>(['unchecked', 'have', 'missing']);
  const [sheet, setSheet] = useState<false | 'panel' | 'dialog'>(false);
  const [confirm, setConfirm] = useState(false);
  const cycle = (i: number) =>
    setRows((r) => r.map((s, j) => (j === i ? (s === 'have' ? 'unchecked' : 'have') : s)));

  return (
    <>
      <Section id="buttons" title="Button">
        {(['primary', 'secondary', 'quiet', 'danger'] as const).map((v) => (
          <Row key={v} label={`${v}: default / with icon / loading / disabled`}>
            <Button variant={v}>Continue</Button>
            <Button variant={v} leadingIcon="check" trailingIcon="chevronRight">
              With icons
            </Button>
            <Button variant={v} loading>
              Saving
            </Button>
            <Button variant={v} disabled>
              Disabled
            </Button>
          </Row>
        ))}
        <Row label="sizes: sm 44 / md 48 / lg 56">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row label="disabled with helper">
          <Button disabled helper="Tick every part you have to start.">
            Start building
          </Button>
        </Row>
        <Row label="forced keyboard focus">
          <Button data-force-focus>Primary focus</Button>
          <Button variant="secondary" data-force-focus>
            Secondary focus
          </Button>
        </Row>
        <Row label="icon button: 44 / 56 / pressed / accent / disabled / focus">
          <IconButton icon="close" aria-label="Dismiss" />
          <IconButton icon="more" aria-label="More options" size={56} />
          <IconButton icon="eye" aria-label="Marks" pressed />
          <IconButton icon="page" aria-label="Fit" accent />
          <IconButton icon="close" aria-label="Dismiss (disabled)" disabled />
          <IconButton icon="close" aria-label="Dismiss (focus)" data-force-focus />
        </Row>
      </Section>

      <Section id="cards" title="Card">
        <Card>
          <h3 className="type-display-md">Static card</h3>
          <p className="type-body text-ink-muted">Surface, 1px line border, radius 12.</p>
        </Card>
        <Stack label="Guide card: ready / in progress / finished / processing / failed">
          <GuideCard title="Bookshelf KALLAX 2x4" status="ready" />
          <GuideCard title="Standing desk frame" status="inProgress" step={7} totalSteps={24} />
          <GuideCard title="Crib assembly" status="finished" />
          <GuideCard title="Reading your manual" status="processing" />
          <GuideCard title="Garden swing" status="failed" />
        </Stack>
      </Section>

      <Section id="chips" title="Chip and Part chip">
        <Row label="chip: default / selected / disabled">
          <Chip selected={chip} onClick={() => setChip((v) => !v)}>
            {chip ? 'Selected (tap)' : 'Unselected (tap)'}
          </Chip>
          <Chip>Default</Chip>
          <Chip selected>Selected</Chip>
          <Chip disabled>Disabled</Chip>
        </Row>
        <Row label="part chip: default / selected / missing / no quantity / tool / tool not in box">
          <PartChip name="Cam lock" quantity="x4" manualLabel="B" calloutNumber={1} />
          <PartChip name="Wooden dowel" quantity="x8" manualLabel="104321" calloutNumber={2} selected={part} onSelect={() => setPart((v) => !v)} />
          <PartChip name="Side panel" quantity="x2" manualLabel="A" missing />
          <PartChip name="Back panel" />
          <PartChip name="Phillips screwdriver" tool />
          <PartChip name="Rubber mallet" tool included={false} />
        </Row>
      </Section>

      <Section id="checklist" title="Checklist row">
        <Stack label="unchecked / have / missing (tap to toggle the first two)">
          {rows.map((s, i) => (
            <ChecklistRow
              key={i}
              name={['Cam lock', 'Wooden dowel', 'Side panel'][i] ?? ''}
              manualLabel={['B', '104321', 'A'][i]}
              quantity={['x4', 'x8', 'x2'][i]}
              thumbnailSrc={THUMB}
              status={s}
              neededInSteps={[
                { step: 4, href: '#checklist' },
                { step: 9, href: '#checklist' },
              ]}
              onToggle={() => cycle(i)}
              onOverflow={() => {}}
            />
          ))}
        </Stack>
        <Stack label="loading">
          <SkeletonRegion>
            <ChecklistRowSkeleton />
          </SkeletonRegion>
        </Stack>
      </Section>

      <Section id="progress" title="Progress">
        <Stack label="segmented: step 7 of 24 (phases 6 / 10 / 8)">
          <SegmentedProgress phases={[{ steps: 6 }, { steps: 10 }, { steps: 8 }]} current={7} total={24} title="Assemble the frame" />
        </Stack>
        <Stack label="segmented: first step / last step">
          <SegmentedProgress phases={[{ steps: 6 }, { steps: 10 }, { steps: 8 }]} current={1} total={24} title="Sort the parts" />
          <SegmentedProgress phases={[{ steps: 6 }, { steps: 10 }, { steps: 8 }]} current={24} total={24} title="Finish" />
        </Stack>
        <Row label="ring: 0 / 40 / 100 %">
          <ProgressRing percent={0} />
          <ProgressRing percent={40} />
          <ProgressRing percent={100} />
        </Row>
      </Section>

      <Section id="banners" title="Banner">
        <Banner kind="caution">Keep fingers clear of the hinge while closing the door.</Banner>
        <Banner kind="warning">Unplug the unit before removing the panel. Risk of electric shock.</Banner>
        <Banner kind="irreversible" />
        <Banner kind="unsure" action={<Button variant="quiet" size="sm">Show original page</Button>} />
        <Banner kind="error" label="Couldn't read page 3" live action={<Button variant="secondary" size="sm">Try again</Button>}>
          The photo is too dark to read. Take it again with more light.
        </Banner>
        <Banner kind="info" />
        <h3 className="type-display-md">Warning banner source line (3 cases)</h3>
        <WarningBanner severity="warning" text={QUOTE} sourceQuote={`  ${QUOTE}`} page={12} onOpenPage={() => {}} />
        <WarningBanner severity="caution" text="Do not overtighten the cam lock." sourceQuote={QUOTE} page={12} lang="en" onOpenPage={() => {}} />
        <WarningBanner severity="caution" text="Hot surface." page={12} onOpenPage={() => {}} />
      </Section>

      <Section id="overlays" title="Toast, Sheet, Dialog">
        <Row label="toast static: plain / with icon and Undo">
          <ToastView live={false} message="Marked as missing." />
          <ToastView live={false} icon="checkCircle" message="Part removed." action={{ label: 'Undo', onAction: () => {} }} />
        </Row>
        <ToastDemo />
        <Row label="bottom sheet / destructive dialog">
          <Button variant="secondary" onClick={() => setSheet('dialog')}>
            Open bottom sheet
          </Button>
          <Button variant="secondary" onClick={() => setSheet('panel')}>
            Open sheet (panel on desktop)
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Open dialog
          </Button>
        </Row>
        <BottomSheet
          open={sheet !== false}
          lgPresentation={sheet === 'panel' ? 'panel' : 'dialog'}
          onClose={() => setSheet(false)}
          title="Cam lock"
          footer={<Button onClick={() => setSheet(false)}>Show in manual</Button>}
        >
          <p className="type-body-lg">Label B. Quantity x4. Used in steps 4 and 9.</p>
          <SkeletonText lines={4} className="mt-4" />
        </BottomSheet>
        <ConfirmDialog
          open={confirm}
          onCancel={() => setConfirm(false)}
          onConfirm={() => setConfirm(false)}
          title="Start again?"
          message="Your progress on this guide will be cleared."
          confirmLabel="Start again"
        />
      </Section>

      <Section id="skeleton" title="Skeleton">
        <SkeletonRegion className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full rounded-md" />
          <SkeletonText lines={3} />
        </SkeletonRegion>
      </Section>

      <Section id="provenance" title="Source quote, provenance, citation">
        <Stack label="source quote (verbatim, with page tag)">
          <SourceQuote quote={QUOTE} page={12} lang="en" onOpenPage={() => {}} />
        </Stack>
        <Stack label="provenance tags">
          <div className="flex flex-wrap gap-2">
            <ProvenanceTag kind="diagram" />
            <ProvenanceTag kind="approximate" />
            <ProvenanceTag kind="doubleCheck" />
          </div>
          <InstructorNote />
        </Stack>
        <Row label="citation chip: with step / page only / forced focus">
          <CitationChip page={12} stepNumber={7} onOpen={() => {}} />
          <CitationChip page={3} onOpen={() => {}} />
          <span data-force-focus className="rounded-xs">
            <CitationChip page={12} stepNumber={7} />
          </span>
        </Row>
      </Section>
    </>
  );
}

export function Gallery({ initialTheme }: { initialTheme: ThemeChoice }) {
  const [theme, setTheme] = useState<ThemeChoice>(initialTheme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ToastProvider>
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-(--gutter) py-3">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
          <h1 className="type-display-md">UI gallery</h1>
          <div role="group" aria-label="Theme" className="flex gap-2">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <Chip key={t} selected={theme === t} onClick={() => setTheme(t)}>
                {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
              </Chip>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-(--gutter) pb-24">
        <Content />
      </main>
    </ToastProvider>
  );
}
