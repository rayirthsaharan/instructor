import { getPageImage } from '@/lib/http/documents';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  return handle(req, (ctx, s) => getPageImage(ctx, s, id, index));
}
