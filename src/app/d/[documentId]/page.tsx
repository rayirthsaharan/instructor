import type { Metadata } from 'next';
import { ProcessingScreen } from '@/components/features/processing';

export const metadata: Metadata = { title: 'Reading your manual - Instructor' };

export default function ProcessingPage() {
  return <ProcessingScreen />;
}
