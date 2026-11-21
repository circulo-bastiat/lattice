#!/usr/bin/env node
// promptprefixcheck.mjs — role prompts are cache-friendly (#7773): everything identical across runs comes first,
// the per-run placeholder ({reason} / {brief}) is LAST, so the prompt cache can reuse the static prefix.
// Breaks: a per-run placeholder before the end, a date/time/run-id in the static part, a sentence said twice.
import { readFileSync } from 'node:fs';
const ROLES = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')).roles;
// enlarger: reordering a worker/enlarger prompt needs an eval report (commander rule); owed on #7773.
const OWED = new Set(['enlarger']);
const verdict = (roles) => {
  const bad = [];
  for (const [name, r] of Object.entries(roles)) {
    const p = r.prompt || '', m = p.match(/\{(reason|brief|issue)\}/g);
    if (!m || OWED.has(name)) continue;
    const first = p.search(/\{(reason|brief|issue)\}/), tail = p.slice(first);
    if (m.length > 1 || tail.split('\n').length > 1 || !/^\{\w+\}$|^\w+: \{\w+\}$/.test(tail.trim())) bad.push(`${name}: per-run placeholder is not the last line`);
    const stat = p.slice(0, first);
    if (/\b20\d\d-\d\d-\d\d|\d\d:\d\d:\d\dZ?|\brun[ _-]?id\b/i.test(stat)) bad.push(`${name}: timestamp/run id in the static prefix`);
    const seen = new Set();
    for (const s of stat.split(/(?<=[.!?])\s+|\n/).map((x) => x.trim()).filter((x) => x.length > 60)) { if (seen.has(s)) bad.push(`${name}: duplicated sentence "${s.slice(0, 40)}…"`); seen.add(s); }
  }
  return bad;
};
const clone = () => JSON.parse(JSON.stringify(ROLES));
const BREAKS = [
  ['reason first again', () => { const c = clone(); c.commander.prompt = 'Reason: {reason}\n' + c.commander.prompt.replace(/\n\nReason: \{reason\}$/, ''); return c; }],
  ['timestamp in prefix', () => { const c = clone(); c.fixer.prompt = 'Started 2026-10-16T03:10:00Z. ' + c.fixer.prompt; return c; }],
  ['duplicated rule', () => { const c = clone(); const rule = 'Never prefix a command with timeout, sleep, nohup or watch because the project settings deny them.'; c.chore.prompt = rule + '\n' + rule + '\n' + c.chore.prompt; return c; }],
];
const real = verdict(ROLES); let caught = 0;
for (const [n, mk] of BREAKS) { if (verdict(mk()).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`promptprefixcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
