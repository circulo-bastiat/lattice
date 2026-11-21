#!/usr/bin/env node
// farmfirstcheck.mjs - #9973: the pilot farm sorted lanes shortest-first, so the 13 mobs with NO lockstep credit (0/20 every one) waited behind ~250 lanes and the
// matrix sat at 78/91 for 12 h. FARM_FIRST / --first names lanes that lead the queue (only while short); the workflow passes the repo variable to the farm step.
// Breaks: `first` ignored, a finished first lane not skipped, k not capping, the farm call not passing first, the workflow env removed.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const SRC = readFileSync(new URL('./infra/pilotfarm.mjs', import.meta.url), 'utf8');
const WF = readFileSync(new URL('../.github/workflows/pilot-farm.yml', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const NL = /export const nextLanes = [^\n]*\n[\s\S]*?export const nextLanesFirst = [\s\S]*?\n\};\n/;
const cases = async (src) => {
  const bad = [], d = mkdtempSync(join(tmpdir(), 'ffc-')), f = join(d, `pf-${n++}.mjs`);
  try {
    // only the pure part: nextLanes (the module's main block needs the repo)
    const m = src.match(NL); if (!m) return ['nextLanesFirst is not the #9973 form'];
    writeFileSync(f, m[0]); const { nextLanesFirst: nextLanes } = await import(pathToFileURL(f).href);
    const plan = [{ lane: 'a', missing: 1 }, { lane: 'b', missing: 2 }, { lane: 'wolf', missing: 20 }, { lane: 'cat', missing: 20 }, { lane: 'done', missing: 0 }];
    const ids = (x) => x.map((p) => p.lane).join();
    if (ids(nextLanes(plan, 3, ['wolf', 'cat'])) !== 'wolf,cat,a') bad.push('first lanes do not lead, in the given order');
    if (ids(nextLanes(plan, 2, ['done', 'cat'])) !== 'cat,a') bad.push('a finished first lane is not skipped');
    if (ids(nextLanes(plan, 1, ['wolf', 'cat'])) !== 'wolf') bad.push('k does not cap');
    if (ids(nextLanes(plan, 3)) !== 'a,b,wolf' || ids(nextLanes(plan, 3, [])) !== 'a,b,wolf') bad.push('an empty first changes the shortest-first order');
    if (ids(nextLanes(plan, 5, ['nolane'])) !== 'a,b,wolf,cat') bad.push('an unknown first lane breaks the queue');
  } finally { rmSync(d, { recursive: true, force: true }); }
  return bad;
};
const real = await cases(SRC); ok(real.length === 0, 'nextLanes: ' + real.join('; '));
ok(/nextLanesFirst\(plan2, K, String\(arg\('--first', process\.env\.FARM_FIRST/.test(SRC), 'the farm run passes --first / FARM_FIRST to nextLanes');
ok(/FARM_FIRST: \$\{\{ vars\.FARM_FIRST \}\}/.test(WF), 'pilot-farm.yml passes vars.FARM_FIRST to the farm step');
const swap = (re, to) => SRC.replace(re, to);
for (const [name, src] of [
  ['first ignored', swap(/lead = first\.map\(\(l\) => rest\.find\(\(p\) => p\.lane === l\)\)\.filter\(Boolean\);/, 'lead = [];')],
  ['a finished first lane leads', swap(/rest\.find\(\(p\) => p\.lane === l\)/, 'plan.find((p) => p.lane === l)')],
  ['k not capping', swap(/\]\.slice\(0, k\);/, '];')],
]) {
  if (src === SRC) { ok(false, 'break did not apply: ' + name); continue; }
  const b = await cases(src); ok(b.length > 0, `cases cannot tell "${name}"`); if (b.length) { breaks++; console.log(`  ✓ "${name}" caught: ${b[0]}`); }
}
for (const [name, bad] of [['the farm call not passing first', SRC.replace("nextLanesFirst(plan2, K, String(arg('--first'", "nextLanes(plan2, K, String(arg('--x'")], ['the workflow env removed', WF.replace('FARM_FIRST: ${{ vars.FARM_FIRST }}', '')]]) {
  const hit = name.startsWith('the farm') ? /nextLanesFirst\(plan2, K, String\(arg\('--first', process\.env\.FARM_FIRST/.test(bad) : /FARM_FIRST: \$\{\{ vars\.FARM_FIRST \}\}/.test(bad);
  ok(!hit, `wiring "${name}" is not caught`); if (!hit) { breaks++; console.log(`  ✓ wiring "${name}" caught`); }
}
console.log(`farmfirstcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
