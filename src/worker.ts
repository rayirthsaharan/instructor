import { closeDb, getDb, runMigrations } from '@/lib/db';
import { DbJobQueue, HandlerRegistry, runOnce } from '@/lib/jobs';

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 1000);

const registry = new HandlerRegistry();
registry.register('noop', async () => {});

async function main(): Promise<void> {
  const db = getDb();
  runMigrations(db);
  const queue = new DbJobQueue(db);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Worker started.');
  while (!stopping) {
    const worked = await runOnce(queue, registry);
    if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  closeDb(db);
  console.log('Worker stopped.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
