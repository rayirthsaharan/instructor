import type { Metadata } from 'next';
import { CompletionScreen } from '@/components/features/completion/completion';

export const metadata: Metadata = { title: 'Finished - Instructor' };

export default async function DonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompletionScreen guideId={id} />;
}
