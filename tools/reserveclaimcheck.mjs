#!/usr/bin/env node
// reserveclaimcheck.mjs - #9675: the reserve pools never start more new WORKERS than issues a worker can claim now (22 Oct 18:50Z: 10 workers for
// 1-4 claimable issues; 8 queue-thin markers in 2 min; the shared PAT went ~5400 calls/h). Testers are not capped. With nothing claimable no worker
// starts, so the thin-queue decision (#8897) takes the claimable count itself as its marker. Breaks: the cap ignored, the wiring removed.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), BRAIN = join(TOOLS, 'brain');
const RSRC = readFileSync(join(BRAIN, 'route.mjs'), 'utf8'), BSRC = readFileSync(join(BRAIN, 'brain.mjs'), 'utf8');
let asserts = 0, fails = 0, breaks = 0, k = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const T0 = Date.parse('2026-10-22T20:00:00Z');   // outside the 08:00-14:00 ET quiet window
const CFG = JSON.parse(readFileSync(join(BRAIN, 'roles.json'), 'utf8'));
const C = { ...CFG, fill: { ...(CFG.fill || {}), maxTotal: 16, maxWindowPct: 95, maxWeekPct: 99 }, accounts: [{ name: 'max', workers: 8 }, { name: 'pro', workers: 2 }, { name: 'tst', workers: 1, role: 'tester' }] };
const U = { at: new Date(T0).toISOString(), accounts: { max: { window: { pct: 5 }, week: { pct: 5 } }, pro: { window: { pct: 5 }, week: { pct: 5 } }, tst: { window: { pct: 5 }, week: { pct: 5 } } } };
async function cases(src) {
  const d = mkdtempSync(join(tmpdir(), 'rcc-')); const bad = [];
  try {
    for (const f of readdirSync(BRAIN).filter((x) => x.endsWith('.mjs') || x.endsWith('.json'))) copyFileSync(join(BRAIN, f), join(d, f));
    writeFileSync(join(d, `route${k}.mjs`), src);
    const { reservePlan } = await import(pathToFileURL(join(d, `route${k++}.mjs`)).href);
    const sum = (p, role) => p.filter((x) => (x.role || 'worker') === role).reduce((s, x) => s + x.n, 0);
    const t = (n, c) => { let v = false; try { v = !!c(); } catch (e) { v = false; } if (!v) bad.push(n); };
    t('1 claimable -> 1 new worker in total', () => sum(reservePlan(C, T0, {}, 0, U, null, {}, 16, 1), 'worker') === 1);
    t('0 claimable -> no new worker', () => sum(reservePlan(C, T0, {}, 0, U, null, {}, 16, 0), 'worker') === 0);
    t('a tester still starts with nothing claimable', () => sum(reservePlan(C, T0, {}, 0, U, null, {}, 16, 0), 'tester') === 1);
    t('plenty claimable -> each account its own target', () => JSON.stringify(reservePlan(C, T0, {}, 0, U, null, {}, 16, 50).filter((x) => !x.role)) === '[{"account":"max","n":8},{"account":"pro","n":2}]');
    t('no claimable given -> unchanged (Infinity)', () => sum(reservePlan(C, T0, {}, 0, U, null, {}, 16), 'worker') === 10);
  } catch (e) { bad.push('threw: ' + e.message); } finally { rmSync(d, { recursive: true, force: true }); }
  return bad;
}
const real = await cases(RSRC); ok(real.length === 0, 'reservePlan: ' + real.join('; '));
const brk = RSRC.replace("if ((a.role || 'worker') === 'worker') { n = Math.min(n, Math.max(0, claimLeft)); claimLeft -= n; }", '');
if (brk === RSRC) ok(false, 'break did not apply'); else { const b = await cases(brk); ok(b.length > 0, 'cases cannot tell a reservePlan that ignores claimable'); if (b.length) { breaks++; console.log(`  ✓ reservePlan ignoring claimable is caught: ${b[0]}`); } }
const WIRES = [
  ['fill passes claimable to fillReserve', /fillReserve\(runs, runningBy, wruns\.length, U, api, now, bad\.includes\('queue'\) \? Infinity : claimable\)/],
  ['fillReserve passes it to reservePlan', /reservePlan\(CFGH, now, byAll, totAll, U, api, poolOpen, workerTotalCap\(CFGH, mode\), claimable\)/],
  ['a thin claimable count stands in for the queue-thin marker', /claimable < base\.thin && now - base\.lastDecisionAt > 30 \* 60e3\) base\.markerAt = Math\.max\(base\.markerAt, now\)/],
];
for (const [n, re] of WIRES) { ok(re.test(BSRC), n); const br = BSRC.replace(re, 'X'); if (br !== BSRC && !re.test(br)) { breaks++; console.log(`  ✓ wiring "${n}" removed is caught`); } }
console.log(`reserveclaimcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
