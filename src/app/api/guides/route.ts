import { listGuides } from '@/lib/http/guides';
import { handle } from '@/lib/http/respond';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handle(req, (ctx, s) => listGuides(ctx, s));
}
