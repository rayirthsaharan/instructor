#!/usr/bin/env node
// Validates .claude/agents/*.md frontmatter and structure. Dependency-free.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_IDS = ['claude-fable-5-2', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
export const MODEL_ALIASES = ['fable', 'sonnet', 'opus', 'haiku', 'inherit'];
export const ALLOWED_KEYS = [
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns',
  'autoCompactWindow', 'effort', 'skills', 'mcpServers', 'hooks', 'memory', 'background',
  'omitClaudeMd', 'isolation', 'color', 'initialPrompt', 'experimental',
];
export const EXPECTED_FAMILY = {
  'ui-ux-designer': 'fable',
  'software-engineer': 'sonnet',
  'qa-engineer': 'sonnet',
  'senior-engineer': 'opus',
};
const REQUIRED_HEADINGS = ['## Before you work', '## Before you finish'];

const family = (model) => (MODEL_ALIASES.includes(model) ? model : /^claude-([a-z]+)-/.exec(model)?.[1]);

/** Parse `---` delimited frontmatter with simple `key: value` lines. Returns null if absent. */
export function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return null;
  const data = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith('#') || /^\s/.test(line)) continue; // skip nested/continuation
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (m) data[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

/** Validate a directory of agent files. Returns { agents: [{name, model, tools}], errors: [string] }. */
export function validateAgents(dir) {
  const errors = [];
  const agents = [];
  if (!existsSync(dir)) return { agents, errors: [`Directory not found: ${dir}`] };
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile()).sort();
  const seen = new Set();
  for (const file of files) {
    const base = file.slice(0, -3);
    const err = (msg) => errors.push(`${file}: ${msg}`);
    const fm = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
    if (!fm) { err('missing or unterminated YAML frontmatter (--- delimiters)'); continue; }
    const { data, body } = fm;
    for (const k of Object.keys(data)) {
      if (!ALLOWED_KEYS.includes(k)) err(`unknown frontmatter key "${k}" (Claude Code silently ignores it)`);
    }
    if (!data.name) err('missing "name"');
    else {
      if (!/^[a-z0-9-]+$/.test(data.name)) err(`name "${data.name}" must be lowercase letters, digits, hyphens`);
      if (data.name !== base) err(`name "${data.name}" does not match filename "${base}"`);
      seen.add(data.name);
    }
    if (!data.description) err('missing or empty "description"');
    if (!data.model) err('missing "model"');
    else if (![...MODEL_IDS, ...MODEL_ALIASES].includes(data.model)) {
      err(`invalid model "${data.model}" (allowed: ${[...MODEL_IDS, ...MODEL_ALIASES].join(', ')})`);
    } else {
      const want = EXPECTED_FAMILY[data.name];
      if (want && family(data.model) !== want) err(`${data.name} must use the ${want} family, found "${data.model}"`);
    }
    for (const h of REQUIRED_HEADINGS) {
      if (!new RegExp(`^${h}\\s*$`, 'm').test(body)) err(`body missing heading "${h}"`);
    }
    const tools = data.tools ? data.tools.split(',').map((t) => t.trim().replace(/^[\[\s"']+|[\]\s"']+$/g, '').toLowerCase()).filter(Boolean) : [];
    if (data.name === 'ui-ux-designer') {
      if (!data.tools) err('ui-ux-designer must declare "tools" (omitting inherits all tools, including Bash)');
      else if (tools.includes('bash')) err('ui-ux-designer tools must not include Bash');
    }
    agents.push({ name: data.name ?? base, model: data.model ?? '-', tools: data.tools ?? '(all)' });
  }
  for (const name of Object.keys(EXPECTED_FAMILY)) {
    if (!seen.has(name)) errors.push(`expected agent "${name}" not found in ${dir}`);
  }
  return { agents, errors };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = resolve(process.argv[2] ?? join(root, '.claude', 'agents'));
  const { agents, errors } = validateAgents(dir);
  const w = (k) => Math.max(...agents.map((a) => a[k].length), k.length);
  const row = (a, b, c) => `${a.padEnd(w('name'))}  ${b.padEnd(w('model'))}  ${c}`;
  console.log(row('name', 'model', 'tools'));
  for (const a of agents) console.log(row(a.name, a.model, a.tools));
  if (errors.length) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nOK: all agents valid');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
