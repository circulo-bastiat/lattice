// tools/dormancycheck.mjs - #1966: the `dormant` health finding (fill wants workers, no progress 60 min, not usage).
// Anti-vacuity: each rule is deleted from a copy of route.mjs and the cases must catch it.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';   // Windows: import('C:\\...') is ERR_UNSUPPORTED_ESM_URL_SCHEME - the lander runs on Dan's Windows PC
const src = readFileSync(new URL('./brain/route.mjs', import.meta.url), 'utf8');
const brain = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8');
const now = Date.parse('2026-10-03T12:00:00Z'), min = (m) => now - m * 60e3;
const base = { now, fillWant: 4, lastMasterAt: min(90), running: [], usageExplained: false };
const cases = [   // [name, snap, expect dormant]
  ['dormant 90 min', base, true],
  ['usage-capped', { ...base, usageExplained: true }, false],
  ['worker in progress', { ...base, running: ['brain worker'] }, false],
  ['fixer in progress', { ...base, running: ['brain fixer'] }, false],
  ['waker only', { ...base, running: ['brain waker'] }, true],
  ['LOOP-OFF', { ...base, fillWant: 0 }, false],
  ['master commit 10 min ago', { ...base, lastMasterAt: min(10) }, false],
];
const bad = (mod) => cases.filter(([, s, want]) => mod.dormancy(s, {}).some((f) => f.key === 'dormant') !== want).map((c) => c[0]);
const load = async (text) => { const f = join(mkdtempSync(join(tmpdir(), 'dorm-')), 'r.mjs'); writeFileSync(f, text); return import(pathToFileURL(f).href); };
let fail = 0;
const real = bad(await load(src)); if (real.length) { fail++; console.log('FAIL real rules wrong for:', real.join(', ')); }
const finds = (await load(src)).findings({ ...base }, {}).some((f) => f.key === 'dormant');
if (!finds) { fail++; console.log('FAIL findings() does not include dormancy'); }
// #2328: fill-idle must not page when usage caps explain it (3 Oct: Pro on its limit + Max week 97% paged Dan).
const idleBad = (mod) => [[true, false], [false, true]].filter(([ex, want]) => mod.findings({ ...base, fillIdleMin: 52, usageExplained: ex }, {}).some((f) => f.key === 'fill-idle') !== want).map((c) => c[0]);
const idleReal = idleBad(await load(src)); if (idleReal.length) { fail++; console.log('FAIL fill-idle vs usageExplained wrong for explained =', idleReal.join(', ')); }
const CFG0 = { fill: { maxWindowPct: 90, maxWeekPct: 90 } };
// stale reading + a live limit from history().limits still counts as capped (#2266)
const stale = { at: new Date(now - 3 * 3600e3).toISOString(), accounts: { default: { ok: false }, max: { window: { pct: 13 }, week: { pct: 97 } } } };
const staleU = (await load(src)).applyLimits(stale, { pro: now + 3600e3, max: now + 3600e3 }, now);
if (!(await load(src)).capsExplain(CFG0, staleU, now)) { fail++; console.log('FAIL stale readings + live limits are not explained'); }
const wired = /f\.key === 'dormant'\) await post\('fixer'|f\.key === 'dormant'\)\s*\)?\s*await post\('fixer'/.test(brain) && /commits\/master/.test(brain) && /usageExplained/.test(brain) && /"dormant": 1/.test(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8'));
if (!wired) { fail++; console.log('FAIL brain.mjs/roles.json do not wire dormancy (fixer mail, master commit, usage, realert 1h)'); }
// #2050: usage explains the quiet when every account WITH a reading is capped; the login-less `default` ({ok:false}) must not block it.
const CFG = { fill: { maxWindowPct: 90, maxWeekPct: 90 }, accounts: [{ name: 'max', maxWeekPct: 96 }, { name: 'pro' }] };
const at = new Date(now - 5 * 60e3).toISOString(), later = new Date(now + 3600e3).toISOString();
const UCASES = [   // [name, usage, expect explained]
  ['3 Oct shape: default has no login, max week 97, pro limited', { at, accounts: { default: { ok: false, why: 'no login' }, max: { window: { pct: 13 }, week: { pct: 97 } }, pro: { window: { pct: 100, resets_at: later }, week: { pct: 18 } } } }, true],
  ['pro has room', { at, accounts: { default: { ok: false }, max: { window: { pct: 13 }, week: { pct: 97 } }, pro: { window: { pct: 10 }, week: { pct: 18 } } } }, false],
  ['no account has a reading', { at, accounts: { default: { ok: false } } }, false],
];
const ubad = (mod) => UCASES.filter(([, u, want]) => mod.capsExplain(CFG, u, now) !== want).map((c) => c[0]);
const ureal = ubad(await load(src)); if (ureal.length) { fail++; console.log('FAIL capsExplain wrong for:', ureal.join(', ')); }
if (!/capsExplain\(CFG, u, now\)/.test(brain)) { fail++; console.log('FAIL brain.mjs does not use capsExplain for usageExplained'); }
const breaks = [
  ['&& !snap.usageExplained) out.push', ') out.push', 'fill-idle ignores usageExplained (#2328)', idleBad],
  ['.filter((n) => u.accounts[n] && u.accounts[n].window)', '.filter(() => true)', 'a login-less default account blocks the usage explanation (#2050)', ubad],
  ['!(snap.fillWant > 0) || ', '', 'ignores LOOP-OFF', bad],
  ['|| snap.usageExplained', '', 'ignores usage', bad],
  ['brain (worker|tester|commander|fixer)', 'brain (worker|tester|commander|fixer|waker)', 'counts a waker as progress', bad],
  ['.some((t) => /^brain (worker|tester|commander|fixer)/.test(t))', '.some(() => false)', 'ignores running workers', bad],
  ['if (idle < min) return [];', '', 'ignores recent master commit', bad],
];
let caught = 0;
for (const [a, b, name, judge] of breaks) {
  if (!src.includes(a)) { fail++; console.log(`FAIL break "${name}" no longer applies`); continue; }
  if (judge(await load(src.replace(a, b))).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else { fail++; console.log(`FAIL break "${name}" not caught`); }
}
console.log(`dormancycheck: ${caught} breaks caught (of ${breaks.length})`);
console.log(` failures ........... ${fail}\n assertions passed .... ${cases.length + UCASES.length + 3 - fail}`);
process.exit(fail ? 1 : 0);
