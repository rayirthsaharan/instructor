import { getConfig } from '@/lib/config';
import { closeDb, openDb, runMigrations } from '@/lib/db';
import { DbJobQueue, HandlerRegistry, runWorker } from '@/lib/jobs';
import { createPipelineDeps, registerPipeline } from '@/lib/pipeline';
import { assertRendererAvailable } from '@/lib/render/pdf';
import { createStorage } from '@/lib/storage';

const registry = new HandlerRegistry();
registry.register('noop', async () => {});

async function main(): Promise<void> {
  const config = getConfig(); // fails fast on a weak SESSION_SECRET in production
  console.log(`PDF renderer: ${assertRendererAvailable()}`); // fails fast with a clear message if it is missing
  const db = openDb(config.databasePath);
  runMigrations(db);
  registerPipeline(registry, createPipelineDeps(db, createStorage(config.storageRoot)));
  const queue = new DbJobQueue(db);
  const stopping = new AbortController();
  const stop = () => stopping.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Worker started.');
  await runWorker(queue, registry, { signal: stopping.signal, pollMs: config.workerPollMs });
  closeDb(db);
  console.log('Worker stopped.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
