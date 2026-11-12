'use client';

import Link from 'next/link';
import { cn, Icon, Menu, PageTag } from '@/components/ui';
import type { Tool, Part } from '@/lib/guide/schema';
import type { ChecklistState } from '@/lib/client/guide-store';
import { playHref, type NeededStep } from './logic';
import { hasCrop, PartThumb } from './part-thumb';

/**
 * One row of "Before you start" (DS 7.4). Three states: unchecked | have | missing.
 * The main target is role=checkbox (aria-checked = have); "missing" is announced in its name.
 * The overflow menu is a separate control.
 */
export function PrepRow({
  guideId,
  documentId,
  item,
  kind,
  state,
  needed,
  onState,
  onShow,
}: {
  guideId: string;
  documentId: string;
  item: Part | Tool;
  kind: 'part' | 'tool';
  state: ChecklistState;
  needed: NeededStep[];
  onState: (s: ChecklistState) => void;
  onShow: (page: number) => void;
}) {
  const missing = state === 'missing';
  const part = kind === 'part' ? (item as Part) : null;
  const tool = kind === 'tool' ? (item as Tool) : null;
  const source = part?.source ?? tool?.source;
  const manualLabel = part?.manualLabel;
  const quantity = part?.quantity;
  const showPageTag = part && !hasCrop(source) && source;

  const menu = [
    missing
      ? { label: 'I found it', onSelect: () => onState('unchecked') }
      : { label: "I'm missing this", onSelect: () => onState('missing') },
    ...(source ? [{ label: 'Show in manual', onSelect: () => onShow(source.pageIndex + 1) }] : []),
  ];

  return (
    <li
      data-testid="prep-row"
      data-state={state}
      data-item={item.id}
      className={cn('rounded-md border border-line px-3 py-1 t-fast', missing ? 'bg-warn-soft' : 'bg-surface hover:bg-surface-sunken')}
    >
      <div className="flex min-h-14 items-center gap-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={state === 'have'}
          onClick={() => onState(state === 'have' ? 'unchecked' : 'have')}
          className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm text-left"
        >
          {missing ? (
            <span className="flex size-7 shrink-0 items-center justify-center text-warn-fg">
              <Icon name="warn" size={28} />
            </span>
          ) : (
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-xs border-2 t-instant',
                state === 'have' ? 'border-success-solid bg-success-solid text-success-on' : 'border-ink-subtle bg-surface',
              )}
            >
              {state === 'have' && <Icon name="check" size={20} />}
            </span>
          )}
          {part && <PartThumb documentId={documentId} source={part.source} />}
          {tool && (
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xs bg-surface-sunken text-ink-muted">
              <Icon name="wrench" />
            </span>
          )}
          <span className="min-w-0 py-1">
            <span className="block wrap-anywhere font-semibold">{item.name}</span>
            {(manualLabel || quantity) && (
              <span className="type-tag block wrap-anywhere text-ink-muted">{[manualLabel, quantity ? `x${quantity}` : null].filter(Boolean).join('  ')}</span>
            )}
            {tool && !tool.included && <span className="type-body-sm block text-ink-muted">Not in the box - you need your own</span>}
          </span>
          {missing && <span className="sr-only">Marked missing</span>}
        </button>
        {showPageTag && <PageTag page={source.pageIndex + 1} />}
        <Menu label={`More options for ${item.name}`} items={menu} />
      </div>
      {missing && (
        <div className="type-body-sm flex flex-wrap items-center gap-x-1 pb-2 pl-10 text-ink-muted">
          {needed.length > 0 ? (
            <>
              <span>Needed in {needed.length === 1 ? 'step' : 'steps'}</span>
              {needed.map((s) => (
                <Link
                  key={s.id}
                  href={playHref(guideId, s.id)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xs px-2 text-accent underline"
                  aria-label={`Step ${s.n}`}
                >
                  {s.n}
                </Link>
              ))}
            </>
          ) : (
            <span>No step in this guide uses it.</span>
          )}
        </div>
      )}
    </li>
  );
}
