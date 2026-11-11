'use client';

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { Button } from './Button';
import { Icon } from './Icon';

/**
 * Upload dropzone (DS 7.9). The zone is not a tab stop; the buttons are. On touch devices "Take photos" is
 * Primary and "Choose files" Secondary; on desktop "Choose files" is Primary and the helper adds "or drop them here".
 */
export function Dropzone({
  onChoose,
  onCamera,
  onDropFiles,
  showCamera,
  disabled,
  disabledHelper,
  className,
  children,
}: {
  onChoose: () => void;
  onCamera: () => void;
  onDropFiles: (files: File[]) => void;
  showCamera: boolean;
  disabled?: boolean;
  /** Explains the limit when disabled. */
  disabledHelper?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return (
    <div
      data-testid="dropzone"
      data-over={over || undefined}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        if (!disabled) onDropFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-md border-2 p-6 text-center t-fast md:min-h-[280px]',
        over ? 'border-solid border-accent bg-accent-soft' : 'border-dashed border-ink-subtle bg-surface hover:border-ink',
        disabled && 'opacity-40',
        className,
      )}
    >
      <Icon name="page" size={40} className="text-ink-muted" />
      <h2 className="type-display-md">{over ? 'Drop to add' : 'Add your manual'}</h2>
      <p className="type-body-sm max-w-[34ch] text-ink-muted">
        {disabled && disabledHelper
          ? disabledHelper
          : `PDF or photos of the pages - up to 60 pages, 40 MB${showCamera ? '' : ' - or drop them here'}`}
      </p>
      <div className="flex w-full max-w-sm flex-col gap-3">
        {showCamera && (
          <Button size="lg" variant="primary" leadingIcon="plus" onClick={onCamera} disabled={disabled} className="w-full">
            Take photos
          </Button>
        )}
        <Button
          size="lg"
          variant={showCamera ? 'secondary' : 'primary'}
          onClick={onChoose}
          disabled={disabled}
          className="w-full"
        >
          Choose files
        </Button>
      </div>
      {children}
    </div>
  );
}
