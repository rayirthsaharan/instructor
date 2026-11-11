import { retryDocument } from '@/lib/http/documents';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, (ctx, s) => retryDocument(req, ctx, s, id));
}
