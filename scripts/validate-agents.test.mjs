import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgents } from './validate-agents.mjs';

const BODY = '\n## Before you work\nx\n## Before you finish\ny\n';
const fm = (o) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
const good = {
  'ui-ux-designer': { model: 'claude-fable-5-2', tools: 'Read, Write' },
  'software-engineer': { model: 'sonnet', tools: 'Read, Bash' },
  'qa-engineer': { model: 'claude-sonnet-5-5', tools: 'Read, Bash' },
  'senior-engineer': { model: 'opus', tools: 'Read, Bash' },
};
function make(overrides = {}, bodies = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-'));
  for (const [name, base] of Object.entries(good)) {
    const o = overrides[name];
    if (o === null) continue;
    const meta = { name, description: 'desc', ...base, ...o };
    for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
    writeFileSync(join(dir, `${name}.md`), fm(meta) + (bodies[name] ?? BODY));
  }
  return dir;
}
function check(overrides, bodies, pattern) {
  const dir = make(overrides, bodies);
  try {
    const { errors } = validateAgents(dir);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern}, got ${JSON.stringify(errors)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('real agents directory passes', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'agents');
  assert.deepEqual(validateAgents(dir).errors, []);
});
test('valid temp directory passes', () => {
  const dir = make();
  try { assert.deepEqual(validateAgents(dir).errors, []); } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('name must match filename', () => check({ 'qa-engineer': { name: 'other' } }, {}, /does not match filename/));
test('missing description', () => check({ 'qa-engineer': { description: undefined } }, {}, /description/));
test('invalid model', () => check({ 'qa-engineer': { model: 'gpt-4' } }, {}, /invalid model/));
test('wrong model family', () => check({ 'senior-engineer': { model: 'haiku' } }, {}, /opus family/));
test('unknown frontmatter key', () => check({ 'qa-engineer': { colour: 'green' } }, {}, /unknown frontmatter key "colour"/));
test('missing heading', () => check({}, { 'qa-engineer': '\n## Before you work\n' }, /Before you finish/));
test('ui-ux-designer must not have Bash', () => check({ 'ui-ux-designer': { tools: 'Read, Bash' } }, {}, /must not include Bash/));
test('missing expected agent', () => check({ 'senior-engineer': null }, {}, /"senior-engineer" not found/));
test('missing frontmatter', () => {
  const dir = make();
  try {
    writeFileSync(join(dir, 'qa-engineer.md'), 'no frontmatter here');
    const { errors } = validateAgents(dir);
    assert.ok(errors.some((e) => /missing or unterminated YAML frontmatter/.test(e)), JSON.stringify(errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- QA edge-case tests ---
import { parseFrontmatter } from './validate-agents.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
const withDir = (fn) => { const dir = make(); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('parse: CRLF line endings', () => {
  const r = parseFrontmatter('---\r\nname: a\r\ndescription: x\r\n---\r\nbody');
  assert.deepEqual(r.data, { name: 'a', description: 'x' });
});
test('parse: value containing colons is kept whole', () => {
  assert.equal(parseFrontmatter('---\ndescription: Use when: a: b\n---\n').data.description, 'Use when: a: b');
});
test('parse: quoted values are unquoted', () => {
  assert.deepEqual(parseFrontmatter('---\nname: "a"\nmodel: \'opus\'\n---\n').data, { name: 'a', model: 'opus' });
});
test('parse: never-closed frontmatter returns null', () => assert.equal(parseFrontmatter('---\nname: a\n'), null));
test('CRLF file with trailing-whitespace headings passes', () => withDir((dir) => {
  const t = readFileSync(join(dir, 'qa-engineer.md'), 'utf8').replace(/\n/g, '\r\n').replace('## Before you work', '## Before you work   ');
  writeFileSync(join(dir, 'qa-engineer.md'), t);
  assert.deepEqual(validateAgents(dir).errors, []);
}));
test('unterminated frontmatter is reported', () => withDir((dir) => {
  writeFileSync(join(dir, 'qa-engineer.md'), '---\nname: qa-engineer\n');
  assert.ok(validateAgents(dir).errors.some((e) => /unterminated/.test(e)));
}));
test('empty directory reports all four expected agents missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-empty-'));
  try { assert.equal(validateAgents(dir).errors.length, 4); } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('nonexistent directory reports error without throwing', () => {
  assert.match(validateAgents(join(tmpdir(), 'no-such-agents-dir-xyz')).errors[0], /Directory not found/);
});
test('non-.md files are ignored', () => withDir((dir) => {
  writeFileSync(join(dir, 'notes.txt'), 'garbage');
  assert.deepEqual(validateAgents(dir).errors, []);
}));
test('inherit is a valid model but not for an expected-family agent', () => {
  check({ 'qa-engineer': { model: 'inherit' } }, {}, /sonnet family/);
  withDir((dir) => {
    writeFileSync(join(dir, 'extra.md'), fm({ name: 'extra', description: 'd', model: 'inherit' }) + BODY);
    assert.deepEqual(validateAgents(dir).errors, []);
  });
});
test('CLI exits 1 on errors, 0 on success', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = join(dirname(fileURLToPath(import.meta.url)), 'validate-agents.mjs');
  const ok = make(); const bad = make({ 'qa-engineer': { model: 'gpt-4' } });
  try {
    assert.equal(spawnSync('node', [script, ok]).status, 0);
    assert.equal(spawnSync('node', [script, bad]).status, 1);
  } finally { rmSync(ok, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});
test('ui-ux-designer with quoted/flow-list/omitted tools containing Bash is rejected', () => {
  for (const tools of ['Read, "Bash"', '[Read, Bash]', undefined]) {
    const dir = make({ 'ui-ux-designer': { tools } });
    try { assert.ok(validateAgents(dir).errors.some((e) => /Bash/.test(e)), `tools=${tools}`); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
test('directory named *.md does not crash validator', () => withDir((dir) => {
  mkdirSync(join(dir, 'dir.md'));
  validateAgents(dir);
}));
