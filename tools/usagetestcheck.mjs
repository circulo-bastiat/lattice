#!/usr/bin/env node
// tools/usagetestcheck.mjs - #1497: the arithmetic and the verdicts of the usage test (usagetestlib.mjs), with
// deliberate breaks proving each one. The session/usage calls themselves need real accounts and are not run here.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('./usagetestlib.mjs', import.meta.url)), 'utf8');
let N = 0;
function run(L) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const row = (account, run, before, samples, tokens, cost) => ({ account, run, before: { window: before, week: 10 }, samples: samples.map(([t, w]) => ({ t, window: w, week: 10 })), tokens, cost });
  const pro = row('pro', 'A empty dir', 2, [[0, 3], [60, 9], [180, 8]], { in: 10, out: 5, cw: 20000, cr: 0 }, 0.08);
  const max = row('max', 'A empty dir', 20, [[0, 20], [60, 21], [180, 21]], { in: 10, out: 5, cw: 20000, cr: 0 }, 0.08);
  ok(L.delta(pro, 'window') === 7, 'the delta is the LARGEST sample minus the reading before (the endpoint lags): 9 - 2');
  ok(L.delta(max, 'window') === 1, 'Max: 21 - 20');
  ok(L.delta(row('pro', 'x', 5, [[0, 4]], {}, 0), 'window') === 0, 'a falling reading is no negative delta');
  ok(L.rates(pro).pctPerMTok === 349.74, 'pts per million tokens: 7 / 20015 tokens');
  ok(L.rates(row('pro', 'x', 1, [[0, 2]], {}, 0)).pctPerMTok === null, 'no tokens = n/a, not a division by zero');
  ok(L.measurable({ ok: true, window: { pct: 59 } }) === true && L.measurable({ ok: true, window: { pct: 60 } }) === false, 'an account at/over 60% is not measured');
  ok(L.measurable({ ok: false, window: { pct: 5 }, why: 'login expired' }) === false && L.measurable(null) === false, 'a failed or missing reading is not measured');
  const t = L.table([pro, max]);
  ok(/Pro's window rose 7\.0x as much as Max's/.test(t), 'the table says how many times more Pro rose than Max');
  ok(/Start-up cost/.test(L.table([pro, row('pro', 'B repo dir', 3, [[0, 14]], { in: 1, out: 1, cw: 60000, cr: 0 }, 0.3)])), 'the start-up line compares the empty dir with the repo dir');
  ok(/pro\s+A empty dir\s+7\s/.test(t), 'a table row per session with its window points');
  return f;
}
const fails = run(await import(pathToFileURL(fileURLToPath(new URL('./usagetestlib.mjs', import.meta.url))).href));
const BREAKS = [
  ['delta ignores the lagging samples', 'Math.max(...(row.samples || []).map((s) => num(s[key])), num(row.before[key]))', 'num((row.samples || [])[0] && row.samples[0][key])'],
  ['delta can go negative', ', num(row.before[key]));', ');'],
  ['per-token rate divides by zero', 'tok > 0 ? ', 'true ? '],
  ['a busy account is measured', 'num(usage.window.pct) < BUSY_PCT', 'true'],
  ['a failed reading is measured', '!!(usage && usage.ok && usage.window &&', '!!(usage && usage.window &&'],
  ['the Pro-vs-Max ratio is gone', "Pro's window rose", "Window rose"],
];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!SRC.includes(from)) { fails.push(`break "${name}": usagetestlib.mjs no longer contains its target - update this check`); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'usagetestcheck-')), f = join(dir, 'usagetestlib.mjs');
  writeFileSync(f, SRC.split(from).join(to));
  let bf; try { bf = run(await import(pathToFileURL(f).href)); } catch { bf = ['threw']; }
  if (bf.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(dir, { recursive: true, force: true });
}
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(`usagetestcheck: ${N / (BREAKS.length + 1)} assertions per run, ${caught} breaks caught (of ${BREAKS.length})`);
console.log(`${Math.round(N / (BREAKS.length + 1))} assertions, ${fails.length} failures`);
process.exit(fails.length ? 1 : 0);
