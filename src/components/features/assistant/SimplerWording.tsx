'use client';

import { Button, SkeletonRegion, SkeletonText } from '@/components/ui';
import { useSimpler } from '@/lib/client/assistant';
import { COPY } from './copy';

/**
 * Body of the "Explain it more simply" disclosure (USER_FLOWS 6.4). Requests the wording once the disclosure is
 * open. Only the instruction is reworded: warnings, the irreversible banner and the Source quote are not touched.
 * The text is rendered as plain text.
 */
export function SimplerWording({ guideId, stepId, open }: { guideId: string; stepId: string; open: boolean }) {
  const { state, retry } = useSimpler(guideId, stepId, open);
  if (!state) return null;
  if (state.status === 'loading') {
    return (
      <SkeletonRegion>
        <SkeletonText lines={3} />
      </SkeletonRegion>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-1" data-testid="simpler-error">
        <p role="alert">{COPY.stepSimple.error}</p>
        <Button variant="quiet" size="sm" className="-ml-3" onClick={retry}>
          {COPY.tryAgain}
        </Button>
      </div>
    );
  }
  if (state.fellBack) {
    return (
      <p data-testid="simpler-fellback" role="status">
        {COPY.stepSimple.fellBack}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="simpler-wording" role="status">
      <p className="type-label text-ink-muted">{COPY.stepSimple.label}</p>
      <p className="whitespace-pre-wrap wrap-anywhere" data-testid="simpler-text">
        {state.text}
      </p>
      <p className="type-body-sm text-ink-muted">{COPY.stepSimple.note}</p>
    </div>
  );
}
