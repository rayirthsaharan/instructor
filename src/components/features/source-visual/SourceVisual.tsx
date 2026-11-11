'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, cn, Icon, ProvenanceTag, Skeleton } from '@/components/ui';
import {
  bracketPath,
  calloutCenter,
  clampTransform,
  doubleTap,
  fitTransform,
  isZoomed,
  panBy,
  regionToScreen,
  swipeDirection,
  zoomBy,
  zoomLevel,
  ZOOM_STEP,
  type Size,
  type Transform,
} from './geometry';
import { ExtraIcon } from './icons';
import { visualTag, type MarkView, type VisualPage } from './pages';

type LoadState = 'loading' | 'loaded' | 'error';

export interface SourceVisualProps {
  /** Pager pages (one for the Original viewer). */
  pages: VisualPage[];
  /** Index into `pages`. */
  pageIdx: number;
  onPageIdxChange?: (idx: number) => void;
  imageUrl: (pageIndex: number) => string;
  /** Alt text of the page image (DS 7.10: "Manual page 12, area for step 7: <title>"). */
  altFor: (page: VisualPage) => string;
  /** Changes whenever the view must reset to fit (a new step). */
  resetKey: string;
  /** `step`: cropped to the region, full controls. `page`: whole page, no pager or tags (Original viewer). */
  mode?: 'step' | 'page';
  lowConfidence?: boolean;
  selectedMarkKey?: string | null;
  onSelectMark?: (mark: MarkView | null) => void;
  /** Controlled Marks state; when omitted the component keeps its own. */
  marksVisible?: boolean;
  onMarksVisibleChange?: (visible: boolean) => void;
  /** Hide the built-in Marks button (the host renders its own). */
  hideMarksButton?: boolean;
  /** Draws brackets at 4px for the first 2s (a region opened from a citation or the step). */
  emphasise?: boolean;
  onOpenOriginal?: (pageIndex: number) => void;
  /** Swipe at 1x (never while zoomed). */
  onSwipe?: (dir: 'next' | 'prev') => void;
  onImageStateChange?: (state: LoadState) => void;
  className?: string;
}

const EMPHASIS_MS = 2000;
const SETTLE_MS = 360;
const MARK_COLOR = 'var(--mark-stroke)';
const UNSURE_COLOR = 'var(--mark-unsure-stroke)';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Source visual (DS 7.10): the manual page, unaltered, fitted to the step's region, with corner brackets, a dim
 * wash and numbered callouts drawn over it in screen pixels. Zoom 1x-5x (pinch, Ctrl/Cmd+wheel, buttons, keys),
 * drag to pan when zoomed, swipe at 1x navigates steps. The page image is never filtered or recoloured.
 */
export function SourceVisual({
  pages,
  pageIdx,
  onPageIdxChange,
  imageUrl,
  altFor,
  resetKey,
  mode = 'step',
  lowConfidence = false,
  selectedMarkKey = null,
  onSelectMark,
  marksVisible: marksControlled,
  onMarksVisibleChange,
  hideMarksButton = false,
  emphasise = false,
  onOpenOriginal,
  onSwipe,
  onImageStateChange,
  className,
}: SourceVisualProps) {
  const page = pages[Math.min(Math.max(pageIdx, 0), pages.length - 1)];
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const [ownMarks, setOwnMarks] = useState(true);
  const marksVisible = marksControlled ?? ownMarks;
  const setMarksVisible = (v: boolean) => {
    if (marksControlled === undefined) setOwnMarks(v);
    onMarksVisibleChange?.(v);
  };

  // Image loading is keyed by URL + retry nonce.
  const [retry, setRetry] = useState(0);
  const url = page ? imageUrl(page.pageIndex) : '';
  const imgKey = `${url}|${retry}`;
  const [load, setLoad] = useState<{ key: string; state: LoadState; w: number; h: number }>({ key: '', state: 'loading', w: 0, h: 0 });
  const loadState: LoadState = load.key === imgKey ? load.state : 'loading';
  const imgW = load.key === imgKey ? load.w : 0;
  const imgH = load.key === imgKey ? load.h : 0;
  const img = useMemo<Size>(() => ({ w: imgW, h: imgH }), [imgW, imgH]);
  useEffect(() => {
    onImageStateChange?.(loadState);
  }, [loadState, onImageStateChange]);

  const ready = loadState === 'loaded' && stage.w > 0 && stage.h > 0 && img.w > 0;
  const base: Transform = useMemo(
    () => (ready ? fitTransform(stage, img, page?.region, page?.approximate) : { tx: 0, ty: 0, s: 1 }),
    [ready, stage, img, page?.region, page?.approximate],
  );
  const baseKey = `${resetKey}|${pageIdx}|${stage.w}x${stage.h}|${img.w}x${img.h}`;
  const [view, setView] = useState<{ key: string; t: Transform; animate: boolean } | null>(null);
  const t = view && view.key === baseKey ? view.t : base;
  const animate = !!view && view.key === baseKey && view.animate;
  const zoomed = ready && isZoomed(t, base);
  const level = ready ? zoomLevel(t, base) : 1;

  const latest = useRef({ t, base, stage, img, zoomed, ready, baseKey });
  useEffect(() => {
    latest.current = { t, base, stage, img, zoomed, ready, baseKey };
  });

  const commit = useCallback((next: Transform, animated: boolean) => {
    const L = latest.current;
    const anim = animated && !prefersReducedMotion();
    setView({ key: L.baseKey, t: clampTransform(next, L.stage, L.img), animate: anim });
    latest.current = { ...L, t: next };
  }, []);

  // While an animated zoom runs the overlay is hidden, so brackets never lag behind the image.
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!animate) return;
    const raf = requestAnimationFrame(() => setSettling(true));
    const h = setTimeout(() => setSettling(false), SETTLE_MS + 40);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(h);
    };
  }, [animate, t]);

  const centre = () => ({ x: latest.current.stage.w / 2, y: latest.current.stage.h / 2 });
  const zoomStep = (factor: number) => {
    const L = latest.current;
    if (!L.ready) return;
    commit(zoomBy(L.t, L.base, L.stage, L.img, factor, centre()), true);
  };
  const reset = () => {
    const L = latest.current;
    if (L.ready) commit(L.base, true);
  };

  // Gestures
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x0: 0, y0: 0, t0: 0, moved: false, pinched: false, lastTap: { t: 0, x: 0, y: 0 } });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-no-gesture]')) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.x0 = p.x;
      g.y0 = p.y;
      g.t0 = performance.now();
      g.moved = false;
      g.pinched = false;
    } else {
      g.pinched = true;
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    const L = latest.current;
    if (pointers.current.size === 2 && L.ready) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.current.set(e.pointerId, p);
      const [a2, b2] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (before > 4 && after > 4) {
        const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
        commit(zoomBy(L.t, L.base, L.stage, L.img, after / before, mid), false);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (Math.hypot(p.x - gesture.current.x0, p.y - gesture.current.y0) > 8) gesture.current.moved = true;
    if (L.zoomed && L.ready) commit(panBy(L.t, L.stage, L.img, p.x - prev.x, p.y - prev.y), false);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const L = latest.current;
    if (pointers.current.size > 0 || g.pinched) {
      if (pointers.current.size === 0) g.pinched = false;
      return;
    }
    const dt = performance.now() - g.t0;
    if (!g.moved) {
      // Tap; two taps close together toggle fit / 2.5x at the tapped point.
      const now = performance.now();
      const lt = g.lastTap;
      if (now - lt.t < 320 && Math.hypot(p.x - lt.x, p.y - lt.y) < 30 && L.ready) {
        commit(doubleTap(L.t, L.base, L.stage, L.img, p), true);
        g.lastTap = { t: 0, x: 0, y: 0 };
      } else {
        g.lastTap = { t: now, x: p.x, y: p.y };
      }
      return;
    }
    if (!L.zoomed && onSwipe && e.pointerType !== 'mouse') {
      const dir = swipeDirection(p.x - g.x0, p.y - g.y0, dt);
      if (dir) onSwipe(dir);
    }
  };
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scrolling is left to the page
      const L = latest.current;
      if (!L.ready) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      commit(zoomBy(L.t, L.base, L.stage, L.img, Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top }), false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [commit, stageRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const L = latest.current;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (e.key === '+' || e.key === '=') zoomStep(ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') zoomStep(1 / ZOOM_STEP);
    else if (e.key === '0') reset();
    else if (e.key === 'm' || e.key === 'M') setMarksVisible(!marksVisible);
    else if (arrows[e.key] && L.zoomed && L.ready) {
      const [ax, ay] = arrows[e.key]!;
      commit(panBy(L.t, L.stage, L.img, ax * L.stage.w * 0.15, ay * L.stage.h * 0.15), true);
    } else return;
    e.preventDefault();
  };

  // Emphasis: 4px brackets for the first 2s, then 3px (DS 2.3). Resets when the region changes.
  const [emphasisDone, setEmphasisDone] = useState<string | null>(null);
  const emphKey = `${resetKey}|${pageIdx}`;
  useEffect(() => {
    if (!emphasise) return;
    const h = setTimeout(() => setEmphasisDone(emphKey), EMPHASIS_MS);
    return () => clearTimeout(h);
  }, [emphasise, emphKey]);
  const strokeW = emphasise && emphasisDone !== emphKey ? 4 : 3;

  const dimId = useId().replace(/:/g, '');
  const listId = useId();

  if (!page) return null;
  const marks = page.marks;
  const showOverlay = ready && marksVisible && marks.length > 0 && !settling;
  const tag = mode === 'step' ? visualTag(page, lowConfidence, marksVisible) : null;
  const pageRect = ready ? { x: t.tx, y: t.ty, w: img.w * t.s, h: img.h * t.s } : null;
  const hasMultiple = pages.length > 1 && mode === 'step';

  return (
    <div
      ref={stageRef}
      role="group"
      aria-roledescription="zoomable image"
      aria-label={`Manual page ${page.pageIndex + 1}${mode === 'step' ? ', zoomable picture' : ''}. Keys: plus and minus zoom, 0 fits, arrows pan when zoomed, M toggles marks.`}
      tabIndex={0}
      data-testid={mode === 'page' ? 'viewer-visual' : 'source-visual'}
      data-zoom={level.toFixed(2)}
      data-load={loadState}
      data-marks={marksVisible ? 'on' : 'off'}
      data-page={page.pageIndex}
      data-tag={tag ?? ''}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ touchAction: 'none' }}
      className={cn('relative h-full w-full select-none overflow-hidden bg-surface-sunken', className)}
    >
      {/* The page, exactly as uploaded: no filter, tint or blend in either theme. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- user page images come from the API at runtime */}
      <img
        key={imgKey}
        src={retry > 0 ? `${url}${url.includes('?') ? '&' : '?'}retry=${retry}` : url}
        alt={altFor(page)}
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          setLoad({ key: imgKey, state: 'loaded', w: el.naturalWidth || 1000, h: el.naturalHeight || 1000 });
        }}
        onError={() => setLoad({ key: imgKey, state: 'error', w: 0, h: 0 })}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: img.w || undefined,
          height: img.h || undefined,
          maxWidth: 'none',
          transformOrigin: '0 0',
          transform: ready ? `translate(${t.tx}px, ${t.ty}px) scale(${t.s})` : undefined,
          transition: animate ? `transform ${SETTLE_MS}ms var(--ease-in-out)` : 'none',
          background: '#fff',
          filter: 'none',
          mixBlendMode: 'normal',
          opacity: ready ? 1 : 0,
          animation: ready ? 'fade-in var(--dur-fast) var(--ease-out)' : undefined,
          pointerEvents: 'none',
        }}
      />

      {loadState === 'loading' && <VisualSkeleton />}
      {loadState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center" data-no-gesture>
          <Icon name="pageQuestion" size={32} className="text-ink-muted" />
          <p className="type-body-lg">Couldn&apos;t load this page</p>
          <Button variant="secondary" size="sm" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {ready && pageRect && (
        <>
          {showOverlay && (
            <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" data-testid="mark-layer">
              <defs>
                <mask id={dimId} maskUnits="userSpaceOnUse" x={0} y={0} width={stage.w} height={stage.h}>
                  <rect x={0} y={0} width={stage.w} height={stage.h} fill="white" />
                  {marks.map((m) => {
                    const r = regionToScreen(m.region, t, img);
                    return <rect key={m.key} x={r.x} y={r.y} width={r.w} height={r.h} fill="black" />;
                  })}
                </mask>
              </defs>
              <rect
                data-testid="dim-wash"
                x={pageRect.x}
                y={pageRect.y}
                width={pageRect.w}
                height={pageRect.h}
                fill="var(--mark-dim)"
                mask={`url(#${dimId})`}
              />
              {marks.map((m) => {
                const r = regionToScreen(m.region, t, img);
                const unsure = lowConfidence || m.approximate;
                const active = selectedMarkKey === m.key;
                const d = bracketPath(r);
                return (
                  <g key={m.key} data-testid="mark" data-mark={m.key} data-dashed={unsure ? 'true' : 'false'}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={active ? 'var(--mark-fill-active)' : 'var(--mark-fill)'} />
                    <path d={d} fill="none" stroke="var(--mark-halo)" strokeWidth={strokeW + 3} strokeLinecap="round" strokeLinejoin="round" />
                    <path
                      d={d}
                      fill="none"
                      stroke={unsure ? UNSURE_COLOR : MARK_COLOR}
                      strokeWidth={strokeW}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={unsure ? '6 5' : undefined}
                    />
                  </g>
                );
              })}
            </svg>
          )}
          {showOverlay &&
            marks
              .filter((m) => m.callout)
              .map((m) => {
                const r = regionToScreen(m.region, t, img);
                const c = calloutCenter(r, stage);
                const active = selectedMarkKey === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    data-no-gesture
                    data-testid="callout"
                    aria-pressed={active}
                    aria-label={m.description}
                    onClick={() => onSelectMark?.(active ? null : m)}
                    className="absolute flex size-11 cursor-pointer items-center justify-center rounded-full"
                    style={{ left: c.x - 22, top: c.y - 22 }}
                  >
                    <span
                      className="type-tag flex size-7 items-center justify-center rounded-full"
                      style={{
                        background: 'var(--mark-callout-bg)',
                        color: 'var(--mark-callout-fg)',
                        boxShadow: active ? '0 0 0 2px #fff, 0 0 0 4px var(--mark-callout-bg)' : '0 0 0 2px #fff',
                      }}
                    >
                      {m.callout}
                    </span>
                  </button>
                );
              })}
        </>
      )}

      {/* Marked areas as a list for screen readers (DS 7.10). */}
      {ready && marksVisible && marks.some((m) => m.number !== null) && (
        <ul id={listId} className="sr-only" aria-label="Marked areas">
          {marks
            .filter((m) => m.number !== null)
            .map((m) => (
              <li key={m.key}>{m.description}</li>
            ))}
        </ul>
      )}

      {/* Controls */}
      {mode === 'step' && (
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2" data-no-gesture>
          <span className="pointer-events-none">
            {!marksVisible && (
              <span className="type-body-sm pointer-events-auto inline-block rounded-sm bg-surface/92 px-2 py-1 font-semibold text-ink-muted shadow-elev-1" data-testid="marks-off-tag">
                Marks off
              </span>
            )}
          </span>
          <div className="pointer-events-auto flex gap-2">
            {!hideMarksButton && (
              <ControlButton
                label="Marks"
                pressed={marksVisible}
                onClick={() => setMarksVisible(!marksVisible)}
                icon={marksVisible ? <Icon name="eye" /> : <ExtraIcon name="eyeOff" />}
                text="Marks"
                testId="marks-toggle"
              />
            )}
            {onOpenOriginal && (
              <ControlButton
                label="Original page"
                onClick={() => onOpenOriginal(page.pageIndex)}
                icon={<Icon name="page" />}
                text="Original page"
                textClass="hidden md:inline"
                testId="original-page"
              />
            )}
          </div>
        </div>
      )}

      {tag && ready && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-2" data-testid="visual-tag" data-no-gesture>
          {tag === 'lowConfidence' && <ProvenanceTag kind="doubleCheck" className="shadow-elev-1" />}
          {tag === 'approximate' && <ProvenanceTag kind="approximate" className="shadow-elev-1" />}
          {tag === 'wholePage' && (
            <span className="type-body-sm rounded-sm border border-line bg-surface/92 px-2 py-1 font-semibold text-ink-muted shadow-elev-1">Whole page shown</span>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2" data-no-gesture>
        <div className="pointer-events-auto flex items-center gap-1 rounded-sm bg-surface/92 px-1 text-ink shadow-elev-1">
          <span className="type-tag px-2" data-testid="page-tag">
            p. {page.pageIndex + 1}
          </span>
          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label="Previous picture for this step"
                disabled={pageIdx <= 0}
                onClick={() => onPageIdxChange?.(pageIdx - 1)}
                className="flex size-11 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="pager-prev"
              >
                <Icon name="chevronLeft" />
              </button>
              <span className="type-tag" aria-live="polite" data-testid="pager-count">
                {pageIdx + 1} / {pages.length}
              </span>
              <button
                type="button"
                aria-label="Next picture for this step"
                disabled={pageIdx >= pages.length - 1}
                onClick={() => onPageIdxChange?.(pageIdx + 1)}
                className="flex size-11 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="pager-next"
              >
                <Icon name="chevronRight" />
              </button>
            </>
          )}
        </div>
        <div className="pointer-events-auto flex items-center rounded-sm bg-surface/92 text-ink shadow-elev-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!zoomed}
            onClick={() => zoomStep(1 / ZOOM_STEP)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="zoom-out"
          >
            <ExtraIcon name="zoomOut" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={level >= 4.99}
            onClick={() => zoomStep(ZOOM_STEP)}
            className="flex size-11 cursor-pointer items-center justify-center rounded-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="zoom-in"
          >
            <ExtraIcon name="zoomIn" />
          </button>
          <button
            type="button"
            aria-label="Fit to view"
            onClick={reset}
            className={cn(
              'flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-sm px-2 hover:bg-surface-sunken',
              zoomed ? 'text-accent' : 'text-ink',
            )}
            data-testid="zoom-reset"
          >
            <ExtraIcon name="fit" />
            <span className="type-tag hidden md:inline">Fit</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  text,
  textClass,
  icon,
  onClick,
  pressed,
  testId,
}: {
  label: string;
  text: string;
  textClass?: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className="flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-sm bg-surface/92 px-2 text-ink shadow-elev-1 t-fast hover:bg-surface-sunken"
    >
      {icon}
      <span className={cn('type-body-sm font-semibold', textClass)}>{text}</span>
    </button>
  );
}

/** Skeleton stage with bracket corners in `line` (DS 7.10); no spinner. */
function VisualSkeleton() {
  return (
    <div role="status" className="absolute inset-0" data-testid="visual-skeleton">
      <span className="sr-only">Loading the manual page</span>
      <div aria-hidden="true" className="absolute inset-6">
        <Skeleton className="size-full rounded-md" />
        {(['left-0 top-0 border-l-[3px] border-t-[3px]', 'right-0 top-0 border-r-[3px] border-t-[3px]', 'bottom-0 left-0 border-b-[3px] border-l-[3px]', 'bottom-0 right-0 border-b-[3px] border-r-[3px]'] as const).map((c) => (
          <span key={c} className={cn('absolute size-6 border-line', c)} />
        ))}
      </div>
    </div>
  );
}
