import { putProgress } from '@/lib/http/guides';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, (ctx, s) => putProgress(req, ctx, s, id));
}
