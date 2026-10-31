#!/usr/bin/env node
// matrixkeepcheck.mjs - #9937: a full run with mirror shard faults (23 Oct 18:57Z: shards 0, 9 and 15 timed out) had partial out/*.json, no lockstep.json, and full.mjs
// published a 0/91 proof matrix over the good 78/91. The guard `keepMatrix` makes such a run build, publish and prove NOTHING; the previous full matrix stands.
// It runs the guard expression on fixture runs, and asserts the matrix block is gated by it. Breaks: the guard always false, the gate removed, the gate on the wrong
// variable, the publish moved out of the gated block.
import { readFileSync } from 'node:fs';
const FULL = readFileSync(new URL('./infra/full.mjs', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const DEF = /const keepMatrix = (.+);\n/, GATE = /if \(ledger && !fault && !keepMatrix\) try \{/;
const verdict = (src) => {
  const bad = [];
  const d = src.match(DEF);
  if (!d) return ['keepMatrix is not defined'];
  const guard = new Function('AGG', 'merged', `return ${d[1]};`);
  const run = (faults, local) => guard(local ? undefined : '/x', { ledger: { mirrorFaults: faults } });
  if (run(['pack-shard-timeout (shard 0)']) !== true) bad.push('a run with a faulted shard does not keep the previous matrix');
  if (run(['pack-shard-timeout (shard 0)', 'pack-shard-timeout (shard 9)']) !== true) bad.push('two faulted shards do not keep the previous matrix');
  if (run([]) !== false) bad.push('a clean run is blocked from publishing its matrix');
  if (run(['x'], true) !== false) bad.push('a local (non-mirror) run is blocked from publishing its matrix');
  if (!GATE.test(src)) bad.push('the matrix block is not gated by keepMatrix');
  const gi = src.search(GATE), pi = src.indexOf('publishMatrixBranch'), fi = src.indexOf('fullMatrix = mx');
  if (gi < 0 || fi < gi || pi < fi) bad.push('the matrix is assigned or published outside the gated block order');
  if (!/proof matrix kept:/.test(src)) bad.push('the kept matrix is not reported');
  return bad;
};
const real = verdict(FULL); ok(real.length === 0, 'full.mjs: ' + real.join('; '));
const cases = [
  ['the guard is always false', FULL.replace(DEF, 'const keepMatrix = false;\n')],
  ['the gate on the matrix block removed', FULL.replace(GATE, 'if (ledger && !fault) try {')],
  ['the guard defined on the wrong data', FULL.replace(DEF, 'const keepMatrix = !!(AGG && merged && (merged.ledger.failedStages || []).length === 0 && (merged.ledger.mirrorFaults || []).length === 99);\n')],
  ['the keep message removed', FULL.replace('proof matrix kept:', 'proof matrix')],
  ['the publish moved above the gate', FULL.replace(GATE, 'if (ledger && !fault && !keepMatrix) try {').replace('let fullMatrix = null;', "let fullMatrix = null; const early = () => (fullMatrix = 1, 'publishMatrixBranch');")],
];
for (const [name, src] of cases) {
  if (src === FULL) { ok(false, 'break did not apply: ' + name); continue; }
  const b = verdict(src); ok(b.length > 0, `check cannot tell "${name}"`); if (b.length) { breaks++; console.log(`  ✓ "${name}" caught: ${b[0]}`); }
}
console.log(`matrixkeepcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
