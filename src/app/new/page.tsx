import type { Metadata } from 'next';
import { CaptureScreen } from '@/components/features/capture';

export const metadata: Metadata = { title: 'Add your manual - Instructor' };

export default function NewPage() {
  return <CaptureScreen />;
}
