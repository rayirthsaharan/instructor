'use client';

import { useState } from 'react';
import type { SourceRef } from '@/lib/guide/schema';
import { pageImageUrl } from '@/lib/client/api';
import { cropStyle } from './logic';

/** True when `source` names an exact region (a fallback area is not an exact crop). */
export const hasCrop = (source?: SourceRef): source is SourceRef & { region: NonNullable<SourceRef['region']> } =>
  !!source?.region && !source.regionFallback;

/**
 * Thumbnail of the part's source region, cut from the unaltered manual page image (never recoloured).
 * Decorative: the row's text names the part. Nothing is shown when the region is unknown or the image fails.
 */
export function PartThumb({ documentId, source, size = 48 }: { documentId: string; source?: SourceRef; size?: number }) {
  const [aspect, setAspect] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  if (!hasCrop(source) || failed) return null;
  const style = cropStyle(source.region, aspect ?? 1.414, size);
  return (
    <span
      aria-hidden="true"
      data-testid="part-thumb"
      className="relative block shrink-0 overflow-hidden rounded-xs border border-line bg-white"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- crop of a user page served by our API */}
      <img
        src={pageImageUrl(documentId, source.pageIndex)}
        alt=""
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w > 0 && h > 0) setAspect(h / w);
        }}
        onError={() => setFailed(true)}
        className="absolute max-w-none"
        style={{ ...style, visibility: aspect ? 'visible' : 'hidden' }}
      />
    </span>
  );
}
