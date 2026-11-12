import { simplifyStep } from '@/lib/http/assistant';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const { id, stepId } = await params;
  return handle(req, (ctx, s) => simplifyStep(ctx, s, id, stepId));
}
