import { deleteDocumentRoute, getDocumentStatus } from '@/lib/http/documents';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(req, (ctx, s) => getDocumentStatus(ctx, s, id));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(req, (ctx, s) => deleteDocumentRoute(ctx, s, id));
}
