#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = join(root, 'api', 'src');
const allowed = new Set(['db.ts', 'seed.ts']);

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : extname(entry.name) === '.ts' ? [path] : [];
  });
}

// Remove comments while preserving quoted text. SQL must be detected inside
// literals, but words such as "SELECT-shaped" in architecture comments are not
// executable and must not create a noisy gate people learn to ignore.
function withoutComments(input) {
  let out = '', state = 'code';
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1];
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { out += '  '; i++; state = 'code'; }
      else out += c === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'code') {
      if (c === '/' && n === '/') { out += '  '; i++; state = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i++; state = 'block'; continue; }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      out += c;
      continue;
    }
    out += c;
    if (c === '\\') { out += input[++i] ?? ''; continue; }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') ||
        (state === 'template' && c === '`')) state = 'code';
  }
  return out;
}

const sql = /\bSELECT\b[\s\S]{0,120}\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+[a-z_][a-z0-9_.]*\s+SET\b|\bDELETE\s+FROM\b/i;
const failures = [];

for (const path of files(source)) {
  const rel = relative(source, path);
  if (allowed.has(rel)) continue;
  const body = withoutComments(readFileSync(path, 'utf8'));
  if (/\bDATABASE_URL\b/.test(body)) failures.push(`${rel}: references DATABASE_URL`);
  if (/import\s+(?!type\b)[^;]*?from\s*['"][^'"]*\/db\.ts['"]/.test(body) ||
      /import\s*\(\s*['"][^'"]*\/db\.ts['"]\s*\)/.test(body)) {
    failures.push(`${rel}: runtime-imports db.ts`);
  }
  if (/from\s*['"]pg['"]|import\s*\(\s*['"]pg['"]\s*\)/.test(body)) {
    failures.push(`${rel}: imports pg`);
  }
  if (sql.test(body)) failures.push(`${rel}: contains an executable SQL literal`);
}

if (failures.length) {
  console.error('api data boundary FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('Runtime API code may call only named /data operations. db.ts and seed.ts are init-only.');
  process.exit(1);
}

console.log('api data boundary: no DATABASE_URL, pg, db runtime import, or SQL literal outside init');
