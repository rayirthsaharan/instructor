'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AddPagesTile,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Dropzone,
  Icon,
  IconButton,
  PageThumbnailGrid,
  useToast,
  type PageTile,
} from '@/components/ui';
import { ApiError, createDocument } from '@/lib/client/api';
import { takePendingFiles } from '@/lib/client/handoff';
import { convertHeicToJpeg } from '@/lib/client/heic';
import { useCoarsePointer, useIsDesktop } from '@/lib/client/hooks';
import { MSG, pageList, uploadErrorMessage, type MappedUploadError } from '@/lib/client/messages';
import { classifyFile, formatBytes, insertAt, move, planAdd, type AddPlan } from '@/lib/client/selection';
import { IconLink, pageGutters } from './common';

type Item = { id: string; file: File; kind: 'pdf' | 'image'; src?: string; loading: boolean };

const ACCEPT = '.pdf,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const TIP = 'Photograph each page flat, in good light, one page per photo.';

let seq = 0;
const nextId = () => `f${++seq}`;

const REPLACE_COPY: Record<NonNullable<AddPlan['replace']>, { title: string; message: (n: number) => string; label: string }> = {
  'photos-with-pdf': {
    title: 'Replace the photos with this PDF?',
    message: (n) => `The ${n} ${n === 1 ? 'photo' : 'photos'} you added will be removed.`,
    label: 'Replace',
  },
  'pdf-with-photos': {
    title: 'Replace the PDF with these photos?',
    message: () => 'The PDF you added will be removed.',
    label: 'Replace',
  },
  'pdf-with-pdf': {
    title: 'Replace the PDF with this one?',
    message: () => 'The PDF you added will be removed.',
    label: 'Replace',
  },
};

export function CaptureScreen({ againPages = [] }: { againPages?: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const coarse = useCoarsePointer();
  const desktop = useIsDesktop();

  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const urls = useRef(new Set<string>());

  const [problems, setProblems] = useState<MappedUploadError[]>([]);
  const [prompt, setPrompt] = useState<{ replace: NonNullable<AddPlan['replace']>; files: File[]; previousCount: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [announce, setAnnounce] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Toasts sit above the fixed footer bar on small screens.
  useEffect(() => {
    document.documentElement.style.setProperty('--toast-offset', desktop ? '0px' : '80px');
    return () => {
      document.documentElement.style.removeProperty('--toast-offset');
    };
  }, [desktop]);

  useEffect(() => {
    const set = urls.current;
    return () => {
      set.forEach((u) => URL.revokeObjectURL(u));
      set.clear();
      abortRef.current?.abort();
    };
  }, []);

  const commit = useCallback((files: File[], replace: boolean) => {
    const fresh: Item[] = files.map((file) => {
      const kind = classifyFile(file);
      if (kind === 'image') {
        const src = URL.createObjectURL(file);
        urls.current.add(src);
        return { id: nextId(), file, kind: 'image', src, loading: false };
      }
      return { id: nextId(), file, kind: kind === 'pdf' ? 'pdf' : 'image', loading: kind === 'heic' };
    });
    setItems((prev) => (replace ? fresh : [...prev, ...fresh]));
    // HEIC: converted where the browser can decode it; otherwise rejected with a clear message.
    fresh
      .filter((it) => classifyFile(it.file) === 'heic')
      .forEach(async (it) => {
        const jpeg = await convertHeicToJpeg(it.file);
        if (!jpeg) {
          setItems((prev) => prev.filter((p) => p.id !== it.id));
          setProblems([{ message: MSG.heic, kind: 'error', retry: false }]);
          return;
        }
        const src = URL.createObjectURL(jpeg);
        urls.current.add(src);
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, file: jpeg, src, loading: false } : p)));
      });
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const current = itemsRef.current;
      const plan = planAdd(current.map((i) => i.file), files);
      setProblems(plan.errors.map((message) => ({ message, kind: 'error', retry: false })));
      const accepted = plan.accepted.map((i) => files[i]).filter((f): f is File => !!f);
      if (accepted.length === 0) return;
      if (plan.replace) {
        setPrompt({ replace: plan.replace, files: accepted, previousCount: current.length });
        return;
      }
      commit(accepted, false);
    },
    [commit],
  );

  // Files handed over from the Library drop tile.
  useEffect(() => {
    const pending = takePendingFiles();
    if (pending.length) addFiles(pending);
  }, [addFiles]);

  // The whole page accepts drops (1280 layout); stops the browser from opening a dropped file.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  const removeAt = (index: number) => {
    const item = itemsRef.current[index];
    if (!item) return;
    setItems((prev) => prev.filter((p) => p.id !== item.id));
    setProblems([]);
    toast.show({
      message: item.kind === 'pdf' ? 'File removed' : 'Page removed',
      action: {
        label: 'Undo',
        onAction: () => setItems((prev) => (prev.some((p) => p.id === item.id) ? prev : insertAt(prev, index, item))),
      },
    });
  };

  const moveItem = (from: number, to: number) => {
    setItems((prev) => move(prev, from, to));
    const target = Math.max(0, Math.min(itemsRef.current.length - 1, to));
    if (from !== target) setAnnounce(`Page ${from + 1} moved to position ${target + 1}`);
  };

  const upload = async () => {
    const files = itemsRef.current.map((i) => i.file);
    if (files.length === 0) return;
    setProblems([]);
    setUploading(true);
    setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { documentId } = await createDocument(files, { onProgress: setProgress, signal: ctrl.signal });
      router.replace(`/d/${documentId}`);
    } catch (e) {
      setUploading(false);
      if (e instanceof ApiError && e.code === 'aborted') return;
      const mapped = uploadErrorMessage(e instanceof ApiError ? e.code : 'network', e instanceof Error ? e.message : '');
      if (e instanceof ApiError && e.code === 'quota_exceeded') setLimitReached(true);
      setProblems([mapped]);
    }
  };

  const pdf = items.find((i) => i.kind === 'pdf');
  const photos = items.filter((i) => i.kind === 'image');
  const decoding = items.some((i) => i.loading);
  const canAnalyse = items.length > 0 && !decoding && !uploading && !limitReached;

  const helper = items.length === 0
    ? MSG.empty
    : pdf
      ? `1 PDF - ${formatBytes(pdf.file.size)}`
      : `${photos.length} ${photos.length === 1 ? 'page' : 'pages'}`;

  const tiles: PageTile[] = photos.map((p) => ({ id: p.id, src: p.src, name: p.file.name, loading: p.loading }));

  return (
    <div className="min-h-dvh">
      <header className={`${pageGutters} flex items-center gap-1 py-2 md:py-4`}>
        <IconLink href="/" icon="chevronLeft" label="Back to library" className="-ml-2" />
        <h1 className="type-display-md">Add your manual</h1>
      </header>
      <main className={`${pageGutters} pb-40 lg:grid lg:grid-cols-12 lg:gap-8 lg:pb-12`}>
        <div className="flex flex-col gap-4 lg:col-span-8">
          {againPages.length > 0 && (
            <Banner kind="info">
              Add every page again, including {pageList(againPages)}. Your current guide stays in your library.
            </Banner>
          )}
          {problems.map((p) => (
            <Banner
              key={p.message}
              kind={p.kind === 'info' ? 'info' : 'error'}
              live
              label={p.kind === 'info' ? undefined : 'Problem'}
              action={
                p.retry ? (
                  <Button variant="quiet" onClick={upload}>
                    Try again
                  </Button>
                ) : undefined
              }
            >
              {p.message}
            </Banner>
          ))}

          {uploading ? (
            <Card data-testid="upload-panel" className="flex items-center gap-4">
              <Icon name="page" className="text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="type-body truncate font-semibold">
                  {pdf ? pdf.file.name : `${photos.length} page ${photos.length === 1 ? 'photo' : 'photos'}`}
                </p>
                <div
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
                >
                  <div className="h-full bg-accent" style={{ width: `${progress * 100}%`, transition: 'width var(--dur-base) var(--ease-in-out)' }} />
                </div>
                <p className="type-body-sm mt-1 text-ink-muted">Uploading {Math.round(progress * 100)}%</p>
              </div>
              <IconButton icon="close" aria-label="Cancel upload" onClick={() => abortRef.current?.abort()} />
            </Card>
          ) : items.length === 0 ? (
            <Dropzone
              showCamera={coarse}
              onChoose={() => pickRef.current?.click()}
              onCamera={() => cameraRef.current?.click()}
              onDropFiles={addFiles}
              disabled={limitReached}
              disabledHelper={MSG.limit}
            />
          ) : pdf ? (
            <Card className="flex items-center gap-3" data-testid="pdf-row">
              <Icon name="page" className="text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="type-body truncate font-semibold">{pdf.file.name}</p>
                <p className="type-body-sm text-ink-muted">PDF - {formatBytes(pdf.file.size)}</p>
              </div>
              <IconButton icon="close" aria-label={`Remove ${pdf.file.name}`} onClick={() => removeAt(0)} />
            </Card>
          ) : (
            <PageThumbnailGrid
              tiles={tiles}
              onRemove={removeAt}
              onMove={moveItem}
              addTiles={
                <>
                  <AddPagesTile label="Add more pages" onClick={() => pickRef.current?.click()} />
                  {coarse && <AddPagesTile label="Take a photo" onClick={() => cameraRef.current?.click()} />}
                </>
              }
            />
          )}

          <p className="type-body-sm text-ink-muted lg:hidden">{TIP}</p>
          <p role="status" className="sr-only">
            {announce}
          </p>
        </div>

        <aside className="lg:col-span-4">
          <section className="hidden lg:block" aria-labelledby="best-h">
            <h2 id="best-h" className="type-label mb-3 text-ink-muted">
              What works best
            </h2>
            <ul className="type-body flex flex-col gap-2">
              <li>{TIP}</li>
              <li>Use one PDF, or photos of the pages - not both.</li>
              <li>Up to 60 pages and 40 MB.</li>
            </ul>
          </section>
          <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-4 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-6 lg:static lg:mt-6 lg:flex-col lg:items-stretch lg:border-0 lg:bg-transparent lg:p-0">
            <p id="analyse-helper" className="type-body-sm min-w-0 flex-1 text-ink-muted lg:flex-none">
              {limitReached ? MSG.limit : helper}
            </p>
            <Button
              size="lg"
              disabled={!canAnalyse}
              loading={uploading}
              onClick={upload}
              aria-describedby="analyse-helper"
              className="shrink-0 lg:w-full"
            >
              Analyse manual
            </Button>
          </div>
        </aside>
      </main>

      <input
        ref={pickRef}
        type="file"
        hidden
        multiple
        accept={ACCEPT}
        data-testid="file-input"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        data-testid="camera-input"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      <ConfirmDialog
        open={prompt !== null}
        onCancel={() => setPrompt(null)}
        onConfirm={() => {
          if (!prompt) return;
          itemsRef.current.forEach((i) => i.src && (URL.revokeObjectURL(i.src), urls.current.delete(i.src)));
          commit(prompt.files, true);
          setPrompt(null);
        }}
        title={prompt ? REPLACE_COPY[prompt.replace].title : ''}
        message={prompt ? REPLACE_COPY[prompt.replace].message(prompt.previousCount) : ''}
        confirmLabel="Replace"
      />
    </div>
  );
}
