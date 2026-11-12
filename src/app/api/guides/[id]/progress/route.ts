import { patchProgress, putProgress } from '@/lib/http/guides';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

/** Replaces the whole record (tooling / seeding). The app writes with PATCH. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, (ctx, s) => putProgress(req, ctx, s, id));
}

/** Applies progress operations against the current server state; see docs/API.md "Progress". */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, (ctx, s) => patchProgress(req, ctx, s, id));
}
