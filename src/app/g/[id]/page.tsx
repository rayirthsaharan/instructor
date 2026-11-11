import type { Metadata } from 'next';
import { OverviewScreen } from '@/components/features/overview/overview';

export const metadata: Metadata = { title: 'Your guide - Instructor' };

export default async function GuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OverviewScreen guideId={id} />;
}
