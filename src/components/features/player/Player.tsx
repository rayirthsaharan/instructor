'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type TouchEvent } from 'react';
import { BottomSheet, Button, buttonClass, cn, Skeleton, SkeletonRegion, SkeletonText, useToast, type MenuItem } from '@/components/ui';
import { pageImageUrl } from '@/lib/client/api';
import { useAssistant, type Citation } from '@/lib/client/assistant';
import { useGuide } from '@/lib/client/guide-store';
import { getOwn } from '@/lib/guide/selectors';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { AssistantDock, AssistantSheet } from '../assistant/AssistantHost';
import { OriginalViewer } from '../original-viewer/OriginalViewer';
import { swipeDirection } from '../source-visual/geometry';
import { marksForPage, pageForPart, visualPages, type MarkView } from '../source-visual/pages';
import { SourceVisual } from '../source-visual/SourceVisual';
import { ActionBar, CloseLink, OfflineBanner, OverflowMenu, PlayerProgress, SpeakerButton, StepCounter } from './chrome';
import { useMediaQuery, useOnline, usePlayerLayout, useSpeech, useStoredFlag, useViewportHeight, useWakeLock, useWideRail } from './hooks';
import {
  missingPartsForStep,
  NOTICE_TEXT,
  nextIsIrreversible,
  primaryAction,
  railGroups,
  readAloudScript,
  resolveStep,
  stepOriginalPage,
  stepPosition,
} from './model';
import { StepContent } from './StepContent';
import { StepRail } from './StepRail';
import { parsePlayerSearch, withPlayerSearch, type PanelName } from './url-state';

const GOT_IT_KEY = 'instructor.player.coachSeen';
const KEEP_AWAKE_KEY = 'instructor.player.keepAwake';
const AUTO_READ_KEY = 'instructor.player.autoRead';
const WAKE_HELPER = "Your browser can't keep the screen on. Set your phone's auto-lock to a longer time.";

/** /g/[id]/play: loads the guide through the shared store and shows the player, or a full-screen state. */
export function PlayerRoute() {
  const { id: guideId } = useParams<{ id: string }>();
  const g = useGuide(guideId);

  if (g.status === 'loading') return <PlayerSkeleton />;
  if (g.status === 'error' || g.status === 'not_found' || !g.guide || !g.documentId) {
    const notFound = g.status === 'not_found';
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4 py-8">
        <h1 className="type-display-lg">{notFound ? "This guide isn't on this device." : "We couldn't open this guide."}</h1>
        <div className="flex flex-col gap-2 md:flex-row">
          {!notFound && (
            <Button size="lg" onClick={g.reload}>
              Try again
            </Button>
          )}
          <Link href="/" className={buttonClass(notFound ? 'primary' : 'secondary', 'lg')}>
            Back to library
          </Link>
        </div>
      </main>
    );
  }
  return (
    <Player
      guideId={guideId}
      guide={g.guide}
      documentId={g.documentId}
      pageCount={g.pageCount}
      progress={g.progress}
      actions={{
        setCurrentStep: g.setCurrentStep,
        completeStep: g.completeStep,
        uncompleteStep: g.uncompleteStep,
        setChecklistItem: g.setChecklistItem,
      }}
      saveState={g.saveFailed ? 'error' : g.saveState === 'error' ? 'saving' : g.saveState}
      retrySave={g.retrySave}
    />
  );
}

function PlayerSkeleton() {
  return (
    <SkeletonRegion className="flex h-dvh flex-col bg-bg">
      <div className="h-12 border-b border-line bg-surface" />
      <div className="mx-4 mt-2 h-1.5 rounded-full bg-line" />
      <Skeleton className="mt-2 h-[42dvh] min-h-60 rounded-none" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-2/3" />
        <SkeletonText lines={3} />
      </div>
      <div className="mt-auto flex gap-2 border-t border-line p-3">
        <Skeleton className="size-14" />
        <Skeleton className="h-14 flex-1" />
        <Skeleton className="size-14" />
      </div>
    </SkeletonRegion>
  );
}

type Progress = ReturnType<typeof useGuide>['progress'];
interface PlayerProps {
  guideId: string;
  guide: ValidatedGuide;
  documentId: string;
  pageCount: number;
  progress: Progress;
  actions: Pick<ReturnType<typeof useGuide>, 'setCurrentStep' | 'completeStep' | 'uncompleteStep' | 'setChecklistItem'>;
  saveState: 'idle' | 'saving' | 'error';
  retrySave: () => void;
}

function Player({ guideId, guide, documentId, pageCount, progress, actions, saveState, retrySave }: PlayerProps) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const url = parsePlayerSearch(searchParams);
  const layout = usePlayerLayout();
  const wideRail = useWideRail();
  // Desktop windows under 560px tall have no room for the dock: the assistant opens as the modal sheet instead.
  const shortDesktop = useMediaQuery('(max-height: 559.98px)') && layout === 'desktop';
  const online = useOnline();
  // The dock reports when its pinned banners leave the chat less than its minimum: the sheet is used for that step at that window height.
  const viewportHeight = useViewportHeight();
  const [noRoom, setNoRoom] = useState<{ stepId: string; height: number } | null>(null);

  // Which step: the URL wins; otherwise where the user left off, decided once when the player opens.
  const [initial] = useState(() => resolveStep(guide, url.step, progress));
  const stepId = url.step && getOwn(guide.steps, url.step) ? url.step : initial.stepId;
  const step = guide.steps[stepId]!;
  const position = stepPosition(guide, stepId);
  const isDone = progress.completedStepIds.includes(stepId);
  const groups = useMemo(() => railGroups(guide, progress.completedStepIds, progress.checklist), [guide, progress.completedStepIds, progress.checklist]);
  const pages = useMemo(() => visualPages(step, guide.parts), [step, guide.parts]);
  const missing = missingPartsForStep(guide, stepId, progress.checklist);
  const primary = primaryAction(step, isDone, !position.next);
  const reviewMode = initial.review;

  // ---- URL helpers (history API, so changing step or panel never reloads anything)
  const overlays = useRef<PanelName[]>([]);
  const commitUrl = (patch: Parameters<typeof withPlayerSearch>[1], mode: 'push' | 'replace') => {
    const q = withPlayerSearch(window.location.search, patch);
    const href = `${window.location.pathname}${q}`;
    if (mode === 'push') window.history.pushState(null, '', href);
    else window.history.replaceState(null, '', href);
  };
  const [markPage, setMarkPage] = useState<number | null>(null);
  // The assistant stays open underneath the Original viewer when a citation (or "Open the original manual") opened it.
  const [askBelow, setAskBelow] = useState(false);
  // A cited region replaces the step's own marks in the viewer.
  const [cite, setCite] = useState<{ mark: MarkView | null } | null>(null);
  const openPanel = (panel: PanelName, page?: number) => {
    overlays.current.push(panel);
    commitUrl({ panel, page: page ?? null }, 'push');
  };
  const closePanel = () => {
    if (overlays.current.length > 0) {
      overlays.current.pop();
      window.history.back();
    } else {
      commitUrl({ panel: null, page: null }, 'replace');
    }
  };
  const openOriginal = (pageIndex: number, fromAsk = false) => {
    setMarkPage(pageIndex);
    setCite(null);
    setAskBelow(fromAsk);
    openPanel('original', pageIndex + 1);
  };
  const openCitation = (c: Citation) => {
    const mark: MarkView | null = c.region
      ? { key: 'cite', number: null, callout: null, region: c.region, approximate: false, description: 'Area the answer refers to' }
      : null;
    setMarkPage(c.pageIndex);
    setCite({ mark });
    setAskBelow(true);
    openPanel('original', c.pageIndex + 1);
  };
  const goToStep = (id: string) => {
    // The docked assistant (desktop) stays open while the step changes; every other overlay closes.
    if (layout === 'desktop' && parsePlayerSearch(window.location.search).panel === 'ask') return commitUrl({ step: id }, 'replace');
    overlays.current = [];
    commitUrl({ step: id, panel: null, page: null }, 'replace');
  };

  // Keep the history stack in sync when the browser's Back / Forward changes the panel.
  const panel = url.panel;
  const dockNoRoom = noRoom !== null && noRoom.stepId === stepId && noRoom.height === viewportHeight;
  const assistantOpen = panel === 'ask' || (panel === 'original' && askBelow);
  const assistant = useAssistant(guideId, stepId, assistantOpen);
  useEffect(() => {
    const st = overlays.current;
    if (!panel) overlays.current = [];
    else if (st.length >= 2 && st[st.length - 2] === panel) st.pop();
  }, [panel]);

  // The URL is the truth: make it name the step we resolved, and keep saved progress in step with it.
  useEffect(() => {
    if (url.step !== stepId) commitUrl({ step: stepId }, 'replace');
  }, [stepId, url.step]);
  const { setCurrentStep } = actions;
  useEffect(() => {
    setCurrentStep(stepId);
  }, [stepId, setCurrentStep]);

  // One-off toasts when the player opens.
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    if (initial.notice) toast.show({ message: NOTICE_TEXT[initial.notice], icon: 'info' });
    else if (!url.step && !initial.review && progress.currentStepId && getOwn(guide.steps, progress.currentStepId) && position.number > 1) {
      toast.show({ message: `Picking up at step ${position.number}`, icon: 'info' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // ---- per-step selection (part chip <-> callout), reset whenever the step changes
  const [sel, setSel] = useState<{ stepId: string; partId: string | null; markKey: string | null; pageIdx: number }>({ stepId, partId: null, markKey: null, pageIdx: 0 });
  const cur = sel.stepId === stepId ? sel : { stepId, partId: null, markKey: null, pageIdx: 0 };
  const pageIdx = Math.min(cur.pageIdx, pages.length - 1);
  const selectPart = (partId: string | null) => {
    if (!partId) return setSel({ ...cur, partId: null, markKey: null });
    const at = pageForPart(pages, partId);
    const mark = at >= 0 ? pages[at]!.marks.find((m) => m.partId === partId) : undefined;
    setSel({ stepId, partId, markKey: mark?.key ?? null, pageIdx: at >= 0 ? at : pageIdx });
  };
  const selectMark = (m: MarkView | null) => setSel({ ...cur, markKey: m?.key ?? null, partId: m?.partId ?? null });
  const [imageFailed, setImageFailed] = useState(false);

  // ---- navigation
  // Read the step from the URL at event time: key repeat can outrun a render, and must not skip or repeat a step.
  const stepNow = () => {
    const s = parsePlayerSearch(window.location.search).step;
    return s && getOwn(guide.steps, s) ? s : stepId;
  };
  const goNext = () => {
    const n = stepPosition(guide, stepNow()).next;
    if (n) goToStep(n.id);
  };
  const goPrev = () => {
    const p = stepPosition(guide, stepNow()).prev;
    if (p) goToStep(p.id);
  };
  const changeViewerPage = (delta: number) => {
    const now = (parsePlayerSearch(window.location.search).page ?? stepOriginalPage(step) + 1) - 1;
    commitUrl({ page: Math.min(Math.max(1, pageCount), Math.max(1, now + 1 + delta)) }, 'replace');
  };
  const onPrimary = () => {
    navigator.vibrate?.(10);
    if (!isDone) actions.completeStep(stepId);
    if (position.next) {
      if (!isDone) {
        toast.show({
          message: `Step ${position.number} done`,
          icon: 'checkCircle',
          action: {
            label: 'Undo',
            onAction: () => {
              actions.uncompleteStep(stepId);
              goToStep(stepId);
            },
          },
        });
      }
      goToStep(position.next.id);
    } else {
      router.push(`/g/${encodeURIComponent(guideId)}/done`);
    }
  };

  // Step change: new picture, focus on the title, text back to the top, haptic on an irreversible step.
  const panelRef = useRef<HTMLDivElement>(null);
  const [compactState, setCompactState] = useState({ stepId, on: false });
  const compact = compactState.stepId === stepId && compactState.on;
  const setCompact = (on: boolean) => setCompactState({ stepId, on });
  const firstRun = useRef(true);
  const speech = useSpeech();
  const [autoRead, setAutoRead] = useStoredFlag(AUTO_READ_KEY, false);
  const [keepAwake, setKeepAwake] = useStoredFlag(KEEP_AWAKE_KEY, true);
  const wake = useWakeLock(keepAwake);
  const { speak, stop: stopSpeech } = speech;
  const onStepShown = useEffectEvent(() => {
    stopSpeech();
    if (step.irreversible) navigator.vibrate?.([30, 60, 30]);
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    panelRef.current?.scrollTo(0, 0);
    panelRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    if (autoRead) speak(readAloudScript(step), guide.language);
  });
  useEffect(() => {
    onStepShown();
  }, [stepId]);

  // Stage shrinks to 30% while the text is scrolled (phone and tablet), with a guard against flicker.
  const onPanelScroll = () => {
    const el = panelRef.current;
    if (!el || layout === 'desktop' || layout === 'landscape') return;
    const top = el.scrollTop;
    if (compact && top <= 4) setCompact(false);
    else if (!compact && top > 24) {
      const gain = window.innerHeight * 0.12;
      if (el.scrollHeight > el.clientHeight + gain + 16) setCompact(true);
    }
  };

  // Swipe on the text panel (touch only): navigates, never completes.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: performance.now() } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y, performance.now() - s.t);
    if (dir === 'next') goNext();
    else if (dir === 'prev') goPrev();
  };

  // Keyboard (USER_FLOWS 6.4). Overlays and inputs own their keys; arrows are left to a zoomed picture.
  const toggleRead = () => (speech.speaking ? stopSpeech() : speak(readAloudScript(step), guide.language));
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], dialog[open]')) return;
    if (url.panel && !(url.panel === 'ask' && layout === 'desktop')) return;
    const plain = !e.ctrlKey && !e.metaKey;
    let handled = true;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onPrimary();
    else if (plain && (e.key === 'ArrowRight' || e.key === 'PageDown')) goNext();
    else if (plain && (e.key === 'ArrowLeft' || e.key === 'PageUp')) goPrev();
    else if (plain && (e.key === 'r' || e.key === 'R') && speech.supported) toggleRead();
    else if (plain && (e.key === '/' || e.key === 'a' || e.key === 'A')) {
      if (url.panel !== 'ask') openPanel('ask');
    } else if (plain && e.key === 'Escape' && url.panel === 'ask') closePanel();
    else if (plain && (e.key === 'o' || e.key === 'O')) openOriginal(stepOriginalPage(step));
    else if (plain && e.key === 'Escape') document.querySelector<HTMLElement>('[data-testid="leave-guide"]')?.focus();
    else handled = false;
    if (handled) e.preventDefault();
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // A sideways swipe is for steps, never the browser's history navigation.
  useEffect(() => {
    const root = document.documentElement;
    root.style.overscrollBehaviorX = 'none';
    return () => {
      root.style.overscrollBehaviorX = '';
    };
  }, []);

  // Toasts sit above the action bar on phone and tablet.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--toast-offset', layout === 'desktop' ? '0px' : '84px');
    return () => {
      root.style.removeProperty('--toast-offset');
    };
  }, [layout]);

  // First run: one coach line on step 1.
  const [coachSeen, setCoachSeen, coachLoaded] = useStoredFlag(GOT_IT_KEY, false);
  const coach = coachLoaded && !coachSeen && position.index === 0 ? { onDismiss: () => setCoachSeen(true) } : null;

  const menuItems: MenuItem[] = [
    { label: 'Original manual', onSelect: () => openOriginal(stepOriginalPage(step)) },
    {
      label: 'Keep screen on',
      checked: keepAwake && wake === 'active',
      disabled: wake === 'unsupported',
      description: wake === 'unsupported' ? WAKE_HELPER : undefined,
      onSelect: () => setKeepAwake(!keepAwake),
    },
    ...(speech.supported
      ? [{ label: 'Read each step aloud automatically', checked: autoRead, onSelect: () => setAutoRead(!autoRead) } satisfies MenuItem]
      : []),
    { label: 'Guide overview', onSelect: () => router.push(`/g/${encodeURIComponent(guideId)}`) },
    ...(isDone ? [{ label: 'Mark as not done', onSelect: () => actions.uncompleteStep(stepId) } satisfies MenuItem] : []),
  ];

  const overviewHref = `/g/${encodeURIComponent(guideId)}`;
  const leftEdge = layout === 'phone' || layout === 'landscape';

  const visual = (
    <SourceVisual
      pages={pages}
      pageIdx={pageIdx}
      onPageIdxChange={(i) => setSel({ ...cur, pageIdx: i, markKey: null })}
      imageUrl={(i) => pageImageUrl(documentId, i)}
      altFor={(p) => `Manual page ${p.pageIndex + 1}, area for step ${position.number}: ${step.title}`}
      resetKey={stepId}
      lowConfidence={step.confidence === 'low'}
      selectedMarkKey={cur.markKey}
      onSelectMark={selectMark}
      onOpenOriginal={openOriginal}
      onSwipe={(d) => (d === 'next' ? goNext() : goPrev())}
      onImageStateChange={(s) => setImageFailed(s === 'error')}
      className={cn(!leftEdge && 'rounded-md')}
    />
  );

  const content = (
    <StepContent
      guideId={guideId}
      guide={guide}
      documentId={documentId}
      step={step}
      position={position}
      isDone={isDone}
      review={reviewMode}
      missing={missing}
      selectedPartId={cur.partId}
      onSelectPart={selectPart}
      onOpenOriginal={openOriginal}
      onFoundPart={(id) => actions.setChecklistItem(id, 'have')}
      imageFailed={imageFailed}
    />
  );

  const textPanel = (
    <div
      ref={panelRef}
      onScroll={onPanelScroll}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      style={{ touchAction: 'pan-y' }}
      data-testid="text-panel"
    >
      <div className={cn('mx-auto px-4 py-6 md:px-6', layout !== 'desktop' && layout !== 'landscape' && 'max-w-[640px]')}>{content}</div>
    </div>
  );

  const bar = (
    <ActionBar
      layout={layout}
      canGoBack={!!position.prev}
      primary={primary}
      irreversible={step.irreversible}
      nextIrreversible={nextIsIrreversible(position.next)}
      onBack={goPrev}
      onPrimary={onPrimary}
      onSteps={() => openPanel('steps')}
      askOpen={url.panel === 'ask' && layout === 'desktop'}
      onAsk={() => (url.panel === 'ask' && layout === 'desktop' ? closePanel() : url.panel !== 'ask' && openPanel('ask'))}
      coach={coach}
    />
  );

  const progressBar = (
    <PlayerProgress groups={groups} position={position} title={step.title} irreversible={step.irreversible} className={layout === 'landscape' ? '!px-0 !h-1.5' : 'pb-0'} />
  );

  const saveBanner =
    saveState === 'error' ? (
      <div role="status" className="type-body-sm flex items-center justify-between gap-2 bg-danger-soft px-4 py-2 text-danger-fg" data-testid="save-error">
        <span>Progress isn&apos;t saving - check your connection.</span>
        <Button variant="quiet" size="sm" onClick={retrySave}>
          Try again
        </Button>
      </div>
    ) : null;

  const topRow = (
    <div className="flex items-center gap-1 px-2 md:px-4 lg:px-8">
      {layout !== 'landscape' && <CloseLink href={overviewHref} />}
      <StepCounter position={position} review={reviewMode} onOpenSteps={layout === 'desktop' ? undefined : () => openPanel('steps')} asButton={layout === 'landscape'} />
      {speech.supported && <SpeakerButton speaking={speech.speaking} onToggle={toggleRead} />}
      <OverflowMenu items={menuItems} />
    </div>
  );

  const stepsRail = (compactRail: boolean) => (
    <StepRail groups={groups} currentStepId={stepId} onSelect={goToStep} compact={compactRail} className="pt-3" />
  );

  const assistantProps = {
    guide,
    documentId,
    pageCount,
    stepId,
    assistant,
    online,
    onGoToStep: goToStep,
    onOpenCitation: openCitation,
    onOpenManual: () => openOriginal(stepOriginalPage(step), true),
  };

  let body: React.ReactNode;
  if (layout === 'desktop') {
    body = (
      <div className="flex h-dvh flex-col bg-bg">
        <header className="shrink-0 border-b border-line bg-surface pt-1">
          <div className="flex h-14 items-center">
            <div className="w-full">{topRow}</div>
          </div>
          {progressBar}
        </header>
        {!online && <OfflineBanner />}
        {saveBanner}
        <div className="flex min-h-0 flex-1">
          <div className={cn('relative shrink-0', wideRail ? 'w-[280px]' : 'w-16')}>
            <aside
              aria-label="All steps"
              className={cn('group/rail absolute inset-y-0 left-0 z-20 overflow-y-auto border-r border-line bg-surface-raised', wideRail ? 'w-[280px]' : 'w-16 focus-within:w-[280px] hover:w-[280px] focus-within:shadow-elev-2 hover:shadow-elev-2')}
            >
              {stepsRail(!wideRail)}
            </aside>
          </div>
          <div className="min-w-0 flex-1 p-6">{visual}</div>
          <div className="flex w-[420px] shrink-0 flex-col bg-surface shadow-[inset_1px_0_0_var(--color-line)]">
            {assistantOpen && !shortDesktop && !dockNoRoom ? <AssistantDock {...assistantProps} onNoRoom={() => setNoRoom({ stepId, height: window.innerHeight })} onClose={closePanel} missing={missing} onFoundPart={(id) => actions.setChecklistItem(id, 'have')} onOpenOriginal={openOriginal} /> : textPanel}
            {bar}
          </div>
        </div>
      </div>
    );
  } else if (layout === 'landscape') {
    body = (
      <div className="flex h-dvh flex-col bg-bg">
        {progressBar}
        {saveBanner}
        <div className="flex min-h-0 flex-1">
          <div className="relative h-full w-[56%] shrink-0">
            {visual}
            <div className="absolute left-2 top-2 z-10">
              <CloseLink href={overviewHref} overlay />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col border-l border-line bg-surface">
            <div className="shrink-0 border-b border-line">{topRow}</div>
            {!online && <OfflineBanner />}
            {textPanel}
            {bar}
          </div>
        </div>
      </div>
    );
  } else {
    const stageHeight = compact ? '30dvh' : layout === 'tablet' ? '48dvh' : 'clamp(240px, 42dvh, 360px)';
    body = (
      <div className="flex h-dvh flex-col bg-bg">
        <header className="shrink-0 border-b border-line bg-surface">
          <div className={cn('flex items-center', layout === 'tablet' ? 'h-14' : 'h-12')}>
            <div className="w-full">{topRow}</div>
          </div>
          {progressBar}
          <div className="h-2" />
        </header>
        {!online && <OfflineBanner />}
        {saveBanner}
        <div className={cn('shrink-0', layout === 'tablet' && 'p-6 pb-0')} style={{ height: stageHeight, transition: 'height var(--dur-base) var(--ease-in-out)' }}>
          {visual}
        </div>
        {textPanel}
        {bar}
      </div>
    );
  }

  return (
    <main data-testid="player" data-fixed-screen data-layout={layout} data-step={stepId} data-compact={compact}>
      {body}

      {layout !== 'desktop' && (
        <BottomSheet open={url.panel === 'steps'} onClose={closePanel} title="Steps" initialDetent="full" lgPresentation="dialog">
          <div className="-mx-4">
            <StepRail groups={groups} currentStepId={stepId} onSelect={goToStep} />
          </div>
        </BottomSheet>
      )}

      {(layout !== 'desktop' || shortDesktop || dockNoRoom) && <AssistantSheet {...assistantProps} open={assistantOpen} onClose={closePanel} />}

      <OriginalViewer
        open={url.panel === 'original'}
        documentId={documentId}
        pageCount={Math.max(1, pageCount)}
        pageIndex={(url.page ?? stepOriginalPage(step) + 1) - 1}
        onPageChange={(i) => commitUrl({ page: i + 1 }, 'replace')}
        onPageDelta={changeViewerPage}
        onClose={closePanel}
        closeLabel={`Back to step ${position.number}`}
        marks={markPage === null ? [] : cite ? (cite.mark ? [cite.mark] : []) : marksForPage(pages, markPage)}
        markPage={markPage}
        unreadable={guide.unreadablePages.map((u) => u.pageIndex)}
      />
    </main>
  );
}
