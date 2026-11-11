import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gallery, type ThemeChoice } from './Gallery';

export const metadata: Metadata = { title: 'UI gallery' };

// Developer-only page: hidden in production builds.
export default async function Page({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_UI !== '1') notFound();
  const { theme } = await searchParams;
  const initial: ThemeChoice = theme === 'light' || theme === 'dark' ? theme : 'system';
  return <Gallery initialTheme={initial} />;
}
