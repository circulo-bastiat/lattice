#!/usr/bin/env node
// procapcheck.mjs - #1939 (Dan, 3 Oct: "1 tester 2 workers"): Pro carries at most 1 tester + 2 workers. Its reserved pool is
// 1 tester; when the primary pool falls to Pro (Max past its week cap) primaryCaps holds it to 2 sessions, 0 testers.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { primaryCaps, reservePlan } from './brain/route.mjs';
const rd = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const SRC = { roles: rd('tools/brain/roles.json'), brain: rd('tools/brain/brain.mjs') };
const NOW = Date.parse('2026-10-03T04:00:00Z');
function verdicts(S, caps = primaryCaps) {
  const bad = [];
  let C; try { C = JSON.parse(S.roles); } catch { return ['roles.json is not valid JSON']; }
  const pro = (C.accounts || []).find((a) => a.name === 'pro') || {};
  // what Pro may carry at most: its reserved pool + the primary pool when that falls to Pro
  const reserve = reservePlan(C, NOW, {}, 0, { at: new Date(NOW).toISOString(), accounts: { pro: { window: { pct: 0 }, week: { pct: 0 } } } }, { remaining: 5000 }, {});
  const resv = reserve.filter((p) => p.account === 'pro');
  const resTesters = resv.filter((p) => p.role === 'tester').reduce((s, p) => s + p.n, 0), resWorkers = resv.filter((p) => p.role !== 'tester').reduce((s, p) => s + p.n, 0);
  const pc = caps(C, 'pro'), want = Number((C.fill || {}).workers) || 6;
  const primary = Math.min(want, pc.sessions), primTesters = Math.min(primary, pc.testers);
  if (resTesters + primTesters > 1) bad.push(`Pro would carry ${resTesters + primTesters} testers, at most 1`);
  if (resWorkers + primary - primTesters > 2) bad.push(`Pro would carry ${resWorkers + primary - primTesters} workers, at most 2`);
  const mc = caps(C, 'max', NOW);
  if (mc.sessions !== Infinity || mc.testers !== ((C.fill || {}).testers || 0)) bad.push('the caps leak onto Max');
  if (!/n = Math\.min\(n, Math\.max\(0, PC\.sessions - running\)\)/.test(S.brain)) bad.push('the fill ignores the account session cap');
  if (!/Math\.min\(PC\.testers, shape\.testers\) - testing/.test(S.brain)) bad.push('the fill ignores the account tester cap');
  return bad;
}
{ const b = verdicts(SRC); for (const x of b) ok(false, x); ok(true, ''); }
for (const [n, f, caps] of [
  ['reserve back to 2 testers', (S) => ({ ...S, roles: S.roles.replace('"name": "pro", "workers": 1, "role": "tester"', '"name": "pro", "workers": 2, "role": "tester"') })],
  ['no session cap on Pro', (S) => ({ ...S, roles: S.roles.replace('"maxWorkers": 2, ', '') })],
  ['Pro primary may run testers', (S) => ({ ...S, roles: S.roles.replace('"testers": 0,', '"testers": 4,') })],
  ['fill ignores the session cap', (S) => ({ ...S, brain: S.brain.replace('n = Math.min(n, Math.max(0, PC.sessions - running));', '') })],
  ['fill ignores the tester cap', (S) => ({ ...S, brain: S.brain.replace('Math.min(PC.testers, shape.testers) - testing', 'shape.testers - testing') })],
  ['caps applied to every account', (S) => S, (C, name) => primaryCaps(C, 'pro')],
]) { const m = f(SRC); const c = verdicts(m, caps).length > 0; ok(c, `break NOT caught: ${n}`); if (c) { breaks++; console.log(`  ✓ break caught: ${n}`); } }
console.log(`procapcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
