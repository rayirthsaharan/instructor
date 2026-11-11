import { Suspense } from 'react';
import { PlayerRoute } from '@/components/features/player/Player';

export const metadata = { title: 'Step by step - Instructor' };

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayerRoute />
    </Suspense>
  );
}
