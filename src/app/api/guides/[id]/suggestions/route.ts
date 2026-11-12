import { getSuggestions } from '@/lib/http/assistant';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, (ctx, s) => getSuggestions(req, ctx, s, id));
}
