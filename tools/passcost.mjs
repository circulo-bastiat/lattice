#!/usr/bin/env node
// passcost.mjs — what a pass actually cost, read from the session transcript. (D-371)
//
//   node tools/passcost.mjs <transcript.jsonl> [--model opus5|sonnet5|haiku45] [--json]
//   node tools/passcost.mjs <transcript.jsonl> --record <session-tag>   -> docs/pass-cost.json
//   node tools/passcost.mjs --find            list transcripts on this machine, newest first
//
// ⚠⚠ THIS FILE EXISTS BECAUSE A STANDING CLAIM STOPPED BEING TRUE. MineHTML's
// `harness/tools/usage_meter.js` opens with *"It cannot read Claude's token spend. Nothing in
// this repo can: a session cannot read /usage"*, and `docs/pass-ledger.json` carries
// `usage_weekly: null` on all 27 entries — an honest null, correctly refusing to invent a figure.
// **The transcript is on disk and every model request in it carries its own `usage` block.**
// So the spend is derivable after the fact, exactly, without asking anyone.
//
// ── WHAT IT MEASURES, AND WHY THESE FOUR NUMBERS ────────────────────────────
// Cost is `requests × context size` and nothing else. The four fields that decide it:
//   input_tokens                 — uncached input, usually tiny
//   cache_creation_input_tokens  — writing to the cache: 1.25x (5m) or 2x (1h) base
//   cache_read_input_tokens      — re-reading the conversation: 0.1x base, and the BULK
//   output_tokens                — includes thinking, which is why effort level is a cost lever
//
// ▶ **THE HEADLINE IS THE QUARTERS, NOT THE TOTAL.** Splitting a session into four equal
// request-count quarters shows the quadratic that everyone knows about and nobody measures:
// on the 16 Sept 2026 session, 91 requests cost $15.79 in Q1 and $30.61 in Q4. Same count,
// 1.94x the money, because every request re-sends the whole conversation. That ratio is the
// argument for starting a new session per unrelated job, and it is not an argument anyone
// believes until they see it in their own numbers.
//
// ⚠ List prices, an estimate, never an invoice — the same caveat `usage_meter.js` states about
// its own figures and `/usage` states about its cost line. Prices move; `--rates` overrides them.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// per million tokens: [input, output, cacheWrite1h, cacheRead]   (docs, 16 Sept 2026)
export const PRICES = {
  opus5:    [5, 25, 10, 0.50],
  sonnet5:  [2, 10,  4, 0.20],
  haiku45:  [1,  5,  2, 0.10],
};

export function parse(text) {
  const reqs = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const u = (d.message && d.message.usage) || d.usage;
    if (!u) continue;
    reqs.push({
      i: u.input_tokens || 0,
      w: u.cache_creation_input_tokens || 0,
      r: u.cache_read_input_tokens || 0,
      o: u.output_tokens || 0,
    });
  }
  return reqs;
}
export function cost(reqs, model = 'opus5', prices = PRICES) {
  const [pi, po, pw, pr] = prices[model];
  let t = 0;
  for (const q of reqs) t += q.i * pi + q.o * po + q.w * pw + q.r * pr;
  return t / 1e6;
}
export const ctxOf = (q) => q.i + q.w + q.r;
export function quarters(reqs) {
  const n = Math.floor(reqs.length / 4);
  if (!n) return [];
  return [0, 1, 2, 3].map((k) => reqs.slice(k * n, k === 3 ? reqs.length : (k + 1) * n));
}
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

if (args.includes('--find')) {
  // ⚠ transcripts live where the SESSION ran, which is not always this machine: a Cowork session
  // writes them in its cloud container, a Claude Code session writes them under ~/.claude.
  const roots = [process.env.HOME && join(process.env.HOME, '.claude', 'projects'), '/root/.claude/projects'].filter(Boolean);
  const out = [];
  for (const root of roots) {
    try {
      for (const p of readdirSync(root)) {
        const dir = join(root, p);
        try { for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(join(dir, f)); } catch {}
        if (p.endsWith('.jsonl')) out.push(dir);
      }
    } catch {}
  }
  out.map((f) => ({ f, m: statSync(f).mtimeMs, b: statSync(f).size }))
     .sort((a, b) => b.m - a.m).slice(0, 12)
     .forEach((x) => console.log(`${(x.b / 1048576).toFixed(1)} MB  ${new Date(x.m).toISOString().slice(0, 16)}  ${x.f}`));
  process.exit(0);
}

const file = args.find((a) => !a.startsWith('--'));
if (!file || !existsSync(file)) {
  console.error('usage: node tools/passcost.mjs <transcript.jsonl>   (or --find)');
  process.exit(2);
}
const model = opt('--model', 'opus5');
const reqs = parse(readFileSync(file, 'utf8'));
if (!reqs.length) { console.error('no usage blocks in that file — is it a session transcript?'); process.exit(2); }

const sum = (k) => reqs.reduce((a, q) => a + q[k], 0);
const inputSide = sum('i') + sum('w') + sum('r');
const total = cost(reqs, model);
const ctxs = reqs.map(ctxOf);
const qsRec = quarters(reqs);

// ⚠ --record exists so a measured figure can be CITED rather than typed. `briefcheck` fails on a
// hand-typed live number in STATE.md, and it caught this file's own findings being typed in by
// hand on the day it was written. A number a tool produced belongs in a file a tool wrote.
if (args.includes('--record')) {
  const tag = args[args.indexOf('--record') + 1] || 'unnamed';
  const out = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'docs', 'pass-cost.json');
  let db = {};
  try { db = JSON.parse(readFileSync(out, 'utf8')); } catch { db = { _README: 'GENERATED by tools/passcost.mjs --record. One entry per measured pass. Never typed by hand (D-6, D-371).', passes: {} }; }
  db.passes = db.passes || {};
  db.passes[tag] = { at: new Date().toISOString(), model, requests: reqs.length,
    cache_read: sum('r'), output: sum('o'), median_context: median(ctxs),
    cost_usd: Number(total.toFixed(2)), per_request_usd: Number((total / reqs.length).toFixed(3)),
    hit_rate_pct: Number((100 * sum('r') / Math.max(1, inputSide)).toFixed(1)),
    q1_usd: qsRec.length === 4 ? Number(cost(qsRec[0], model).toFixed(2)) : null,
    q4_usd: qsRec.length === 4 ? Number(cost(qsRec[3], model).toFixed(2)) : null };
  db.latest = tag;
  writeFileSync(out, JSON.stringify(db, null, 1) + '\n');
  console.log('recorded ' + tag + ' in docs/pass-cost.json');
  process.exit(0);
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ file, model, requests: reqs.length, input: sum('i'), cache_write: sum('w'),
    cache_read: sum('r'), output: sum('o'), input_side: inputSide, cost_usd: Number(total.toFixed(2)),
    per_request_usd: Number((total / reqs.length).toFixed(3)), median_context: median(ctxs) }, null, 1));
  process.exit(0);
}

console.log('');
console.log('================ passcost ================');
console.log(` requests ........... ${reqs.length}`);
console.log(` input .............. ${sum('i').toLocaleString('en-US')}`);
console.log(` cache WRITE ........ ${sum('w').toLocaleString('en-US')}`);
console.log(` cache READ ......... ${sum('r').toLocaleString('en-US')}   ← the bulk, and it is re-read every request`);
console.log(` output ............. ${sum('o').toLocaleString('en-US')}   ← thinking is billed here, so effort is a cost lever`);
console.log(` cache hit rate ..... ${(100 * sum('r') / Math.max(1, inputSide)).toFixed(1)}%`);
console.log(` median context ..... ${median(ctxs).toLocaleString('en-US')}`);
console.log('');
for (const m of Object.keys(PRICES)) {
  console.log(` as ${m.padEnd(9)} ..... $${cost(reqs, m).toFixed(2)}${m === model ? '   ←' : ''}`);
}
console.log(` per request ........ $${(total / reqs.length).toFixed(3)}   ← and a shell call is at least one request`);
console.log('');
console.log(' THE QUADRATIC — equal request counts, rising cost:');
quarters(reqs).forEach((q, k) => {
  console.log(`   Q${k + 1}: ${String(q.length).padStart(4)} requests · median context ${median(q.map(ctxOf)).toLocaleString('en-US').padStart(9)} · $${cost(q, model).toFixed(2)}`);
});
const qs = quarters(reqs);
if (qs.length === 4) {
  const ratio = cost(qs[3], model) / Math.max(1e-9, cost(qs[0], model));
  console.log(`   ▶ the last quarter cost ${ratio.toFixed(2)}x the first FOR THE SAME NUMBER OF REQUESTS.`);
  console.log('     Nothing got harder. The conversation got longer, and every request re-sends it.');
}
console.log(' ⚠ list prices, an estimate, never an invoice.');
console.log('==========================================');
