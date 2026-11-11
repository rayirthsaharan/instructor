'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner, Button, Icon, Skeleton, SkeletonRegion, StageList } from '@/components/ui';
import { retryDocument } from '@/lib/client/api';
import { useDocumentPolling } from '@/lib/client/hooks';
import { failureMessage, STAGE_LABELS } from '@/lib/client/messages';
import { bumpRetryCount, getRetryCount } from '@/lib/client/retries';
import { buildRows } from '@/lib/client/stages';
import type { DocumentState } from '@/lib/client/types';
import { BracketFrame, ButtonLink, PageImage } from './common';

const column = 'mx-auto flex w-full max-w-[480px] flex-col gap-6 px-4 pb-12 pt-12 md:min-h-dvh md:justify-center md:pt-0';

function Thumb({ documentId }: { documentId: string }) {
  return (
    <BracketFrame className="w-[136px] shrink-0">
      <PageImage documentId={documentId} pageIndex={0} className="aspect-[3/4] w-full" />
    </BracketFrame>
  );
}

function NotFound() {
  return (
    <main className={column}>
      <h1 className="type-display-lg">This manual isn&apos;t on this device.</h1>
      <ButtonLink href="/" size="lg" className="w-full md:w-auto md:self-start">
        Back to library
      </ButtonLink>
    </main>
  );
}

function Rejected() {
  return (
    <main className={column} data-testid="state-rejected">
      <Icon name="pageQuestion" size={56} className="text-ink-muted" />
      <h1 className="type-display-lg">This doesn&apos;t look like instructions</h1>
      <p className="type-body-lg text-ink-muted">
        We look for manuals and step-by-step guides - for example assembly or setup instructions. This file seems to be something else.
      </p>
      <div className="flex flex-col gap-2 md:flex-row">
        <ButtonLink href="/new" size="lg">
          Try a different file
        </ButtonLink>
        <ButtonLink href="/" variant="quiet" size="lg">
          Back to library
        </ButtonLink>
      </div>
    </main>
  );
}

function Loading() {
  return (
    <main className={column}>
      <SkeletonRegion>
        <Skeleton className="mb-6 aspect-[3/4] w-[120px]" />
        <h1 className="type-display-lg mb-6">Reading your manual</h1>
        <div className="flex flex-col gap-4">
          {STAGE_LABELS.map((l) => (
            <div key={l} className="flex gap-3">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-6 w-40" />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </main>
  );
}

function Failed({ doc, onRetried }: { doc: DocumentState; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState(false);
  // Client-only render (the job is fetched after hydration); re-read after every retry.
  const attempts = getRetryCount(doc.id);
  // The first failure plus two retries is the third failure.
  const f = failureMessage(doc.stage, doc.error?.code, attempts >= 2);

  const retry = async () => {
    setBusy(true);
    setRetryError(false);
    try {
      await retryDocument(doc.id);
      bumpRetryCount(doc.id);
      onRetried();
    } catch {
      setRetryError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Banner
        kind="error"
        live
        label="Couldn't finish"
        action={
          <>
            {f.retryAllowed && (
              <Button variant="primary" loading={busy} onClick={retry}>
                Try again
              </Button>
            )}
            {f.differentFile && (
              <ButtonLink href="/new" variant="secondary">
                Use a different file
              </ButtonLink>
            )}
            <ButtonLink href="/" variant={f.repeated ? 'primary' : 'quiet'}>
              Back to library
            </ButtonLink>
          </>
        }
      >
        {f.message}
        {retryError && <span className="mt-2 block">We couldn&apos;t restart that. Check your connection and try again.</span>}
      </Banner>
  );
}

export function ProcessingScreen() {
  const { documentId } = useParams<{ documentId: string }>();
  const router = useRouter();
  const { doc, notFound, reconnecting, slow, restart } = useDocumentPolling(documentId);

  const guideId = doc?.status === 'ready' ? doc.guideId : null;
  useEffect(() => {
    if (guideId) router.replace(`/g/${guideId}`);
  }, [guideId, router]);

  if (notFound) return <NotFound />;
  if (!doc) return <Loading />;
  if (doc.status === 'rejected') return <Rejected />;

  const rows = buildRows(doc, slow);
  const failed = doc.status === 'failed';
  return (
    <main className={column} data-testid="state-processing" data-status={doc.status}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <Thumb documentId={doc.id} />
        <h1 className="type-display-lg">Reading your manual</h1>
      </div>
      {reconnecting && (
        <div role="status">
          <Banner kind="info">Reconnecting... your manual is still being read.</Banner>
        </div>
      )}
      <StageList rows={rows} />
      {failed ? (
        <Failed doc={doc} onRetried={restart} />
      ) : (
        <>
          <p className="type-body">This usually takes about a minute. You can leave this page - we&apos;ll keep going.</p>
          <ButtonLink href="/" variant="quiet" className="-ml-5 self-start">
            Back to library
          </ButtonLink>
        </>
      )}
    </main>
  );
}
