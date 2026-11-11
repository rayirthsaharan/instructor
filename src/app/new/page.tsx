import type { Metadata } from 'next';
import { CaptureScreen } from '@/components/features/capture';

export const metadata: Metadata = { title: 'Add your manual - Instructor' };

/** `?again=7,8` (from the Overview's unreadable-pages banner) asks for every page to be added again. */
export default async function NewPage({ searchParams }: { searchParams: Promise<{ again?: string | string[] }> }) {
  const raw = (await searchParams).again;
  const again = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
    .split(',')
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 999)
    .slice(0, 60);
  return <CaptureScreen againPages={[...new Set(again)].sort((a, b) => a - b)} />;
}
