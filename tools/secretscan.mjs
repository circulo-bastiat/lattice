// #7769: secret scan. `node tools/secretscan.mjs --diff <range>` (PR diff, added lines only), `--tree` (tracked files + _status logs).
// Prints file:line and the KIND of secret, never the secret. Exit 1 on any hit.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATTERNS } from './redact.mjs';

export function scanText(text, file = '?', firstLine = 1) {
  const hits = [];
  String(text).split('\n').forEach((l, i) => { for (const [kind, re] of PATTERNS) { re.lastIndex = 0; if (re.test(l)) hits.push({ file, line: firstLine + i, kind }); } });
  return hits;
}
export function scanDiffText(diff) {
  const hits = []; let file = '?', line = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) file = l.slice(6);
    else if (l.startsWith('@@')) line = +((l.match(/\+(\d+)/) || [0, 1])[1]);
    else if (l.startsWith('+')) { hits.push(...scanText(l.slice(1), file, line)); line++; }
    else if (!l.startsWith('-')) line++;
  }
  return hits;
}
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
export const scanDiff = (range) => scanDiffText(execFileSync('git', ['diff', '-U0', range], { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8' }));
export function scanTree() {
  const hits = [], skip = /\.(png|jpg|ogg|jar|gz|zip|bin)$|(^|\/)(assets|dist|\.mcdata|\.decomp)\//;
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8' }).split('\n').filter((f) => f && !skip.test(f));
  const sd = join(ROOT, '_status'); if (existsSync(sd)) for (const f of readdirSync(sd)) files.push('_status/' + f);
  for (const f of files) { try { const p = join(ROOT, f); if (statSync(p).size < 4e6) hits.push(...scanText(readFileSync(p, 'utf8'), f)); } catch {} }
  return hits;
}
export const fmt = (h) => h.map((x) => `${x.file}:${x.line}  ${x.kind}`).join('\n');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv, i = a.indexOf('--diff');
  const hits = i > 0 ? scanDiff(a[i + 1]) : scanTree();
  if (hits.length) { console.log(fmt(hits)); process.exit(1); }
  console.log('secretscan: clean');
}
