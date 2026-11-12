import { deleteMessages, getMessages, postMessage } from '@/lib/http/assistant';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(req, (ctx, s) => getMessages(ctx, s, id));
}

/** Streams the answer as server-sent events; see docs/API.md "Assistant". */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(req, (ctx, s) => postMessage(req, ctx, s, id));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(req, (ctx, s) => deleteMessages(ctx, s, id));
}
