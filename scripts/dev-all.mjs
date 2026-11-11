// Runs the web server and the job worker together for local use. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const children = [
  ['web', ['npx', 'next', 'dev']],
  ['worker', ['npx', 'tsx', 'src/worker.ts']],
].map(([name, [cmd, ...args]]) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const tag = (stream, out) => stream.on('data', (d) => out.write(String(d).replace(/^(?=.)/gm, `[${name}] `)));
  tag(child.stdout, process.stdout);
  tag(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    stop(code ?? 1);
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 2000).unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
