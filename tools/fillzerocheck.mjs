// tools/fillzerocheck.mjs - #4991 (Dan, 10 Oct): the worker switch at 0 must mean nothing fill-made starts. Two guards: fill() drops held
// fill/tester mail instead of re-routing it, and launch.mjs refuses a fill-made run while the repo variable is 0. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { testerSwitch } from './brain/route.mjs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { brain: rd('./brain/brain.mjs'), launch: rd('./brain/launch.mjs'), yml: rd('../.github/workflows/brain.yml'), go: rd('./go.mjs') };
const verdict = (S) => {
  const bad = [], b = S.brain, l = S.launch;
  const re = b.indexOf('re-routing held'), drop = b.indexOf('dropping held');
  if (!/const fillOff = !\(fillWant\(CFG, now, process\.env\.FILL_WORKERS\) > 0 \|\| TS > 0\)/.test(b)) bad.push('brain.mjs does not compute fillOff from the worker switch');
  if (!(drop > 0 && re > drop)) bad.push('brain.mjs does not drop held fill mail BEFORE re-routing it');
  if (!/if \(fillOff \|\| TS === 0\) for \(const \[r, pm\] of Object\.entries\(pendingMail\(\)\)\) if \(\(fillOff \|\| r === 'tester'\) && \/\^\(fill\|test slot\)\/\.test\(pm\.reason/.test(b)) bad.push('the drop does not cover fill reserve / test slot mail');
  if (!/setPendingMail\(r, null\); \}/.test(b)) bad.push('the held mail is not cleared');
  if (!/FILL_WORKERS', null, \{ ok404: true \}/.test(l) || !/=== '0'\) \{ console\.log\(`SKIP/.test(l)) bad.push('launch.mjs does not refuse a fill-made run at FILL_WORKERS=0');
  if (!/\^\(fill\|test slot\)\/\.test\(reason\)/.test(l)) bad.push('launch.mjs guard does not cover fill reserve / test slot reasons');
  if (!(l.indexOf('FILL_WORKERS=0 (#4991)') > 0 && l.indexOf('FILL_WORKERS=0 (#4991)') < l.indexOf('if (!rateOk('))) bad.push('launch.mjs guard runs after the rate check');
  if (!/FILL_TESTERS: \$\{\{ vars\.FILL_TESTERS \}\}/.test(S.yml)) bad.push('brain.yml does not pass the FILL_TESTERS variable to the brain');
  if (!/const TS = testerSwitch\(process\.env\.FILL_TESTERS\)/.test(b)) bad.push('fill() does not read the tester switch');
  if (!/if \(TS !== null && p\.role === 'tester'\) continue;/.test(b)) bad.push('the Pro reserve tester ignores FILL_TESTERS');
  if (!/if \(TS !== null\) PC\.testers = TS;/.test(b)) bad.push('the tester count does not follow FILL_TESTERS');
  if (!/String\(fillWant\(CFG, now, process\.env\.FILL_WORKERS\) \+ TS\)/.test(b)) bad.push('the total does not add FILL_TESTERS to FILL_WORKERS');
  if (!/FILL_TESTERS', null, \{ ok404: true \}[\s\S]{0,60}\.catch/.test(l) || !/FILL_TESTERS=0 \(#4991\)/.test(l)) bad.push('launch.mjs does not refuse a tester at FILL_TESTERS=0');
  if (!/loop testers <n\|auto>/.test(S.go) || !/FILL_TESTERS/.test(S.go)) bad.push('go.mjs has no `loop testers`');
  return bad;
};
const BREAKS = [
  ['fillOff dropped', (S) => ({ ...S, brain: S.brain.replace('const fillOff = !(', 'const fillOffX = !(') })],
  ['drop never happens', (S) => ({ ...S, brain: S.brain.replace('if (fillOff || TS === 0) for (const [r, pm]', 'if (false) for (const [r, pm]') })],
  ['drop only fill, not tester slot', (S) => ({ ...S, brain: S.brain.replace('/^(fill|test slot)/.test(pm.reason', '/^fill/.test(pm.reason') })],
  ['mail not cleared', (S) => ({ ...S, brain: S.brain.replace('setPendingMail(r, null); }', '}') })],
  ['launch guard removed', (S) => ({ ...S, launch: S.launch.replace("=== '0') { console.log(`SKIP", "=== '9') { console.log(`SKIP") })],
  ['launch guard misses tester slots', (S) => ({ ...S, launch: S.launch.replace('/^(fill|test slot)/.test(reason)', '/^fill/.test(reason)') })],
  ['launch guard after the rate check', (S) => ({ ...S, launch: S.launch.replace('FILL_WORKERS=0 (#4991)', 'FILL_WORKERS=0 (#4991)').replace('if (!rateOk(', 'if (0) {}\nif (!rateOk(').replace(/(if \(!dry && \/\^\(fill\|test slot\)\/\.test\(reason\)\) \{[\s\S]*?\n\}\n)/, '') + '\n' + 'FILL_WORKERS=0 (#4991)' })],
];
BREAKS.push(
  ['yml drops FILL_TESTERS', (S) => ({ ...S, yml: S.yml.replace('FILL_TESTERS: ${{ vars.FILL_TESTERS }}', '') })],
  ['reserve tester ignores the switch', (S) => ({ ...S, brain: S.brain.replace("if (TS !== null && p.role === 'tester') continue;", '') })],
  ['tester count ignores the switch', (S) => ({ ...S, brain: S.brain.replace('if (TS !== null) PC.testers = TS;', '') })],
  ['total ignores the testers', (S) => ({ ...S, brain: S.brain.replace(' + TS), usage, api)', '), usage, api)') })],
  ['launch lets a tester start at 0', (S) => ({ ...S, launch: S.launch.replace('FILL_TESTERS=0 (#4991)', 'x') })],
  ['go.mjs has no tester switch', (S) => ({ ...S, go: S.go.replace('loop testers <n|auto>', 'x') })],
);
const real = verdict(SRC); let caught = 0;
const ts = [[undefined, null], ['', null], ['auto', null], ['0', 0], [' 3 ', 3], ['99', 10], ['x', null]];
for (const [v, want] of ts) if (testerSwitch(v) !== want) real.push(`testerSwitch(${JSON.stringify(v)}) !== ${want}`);
for (const [n, mk] of BREAKS) { const m = mk(SRC); if (verdict(m).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`fillzerocheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
