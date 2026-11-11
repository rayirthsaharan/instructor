import { createDocument } from '@/lib/http/documents';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return handle(req, (ctx, s) => createDocument(req, ctx, s));
}
