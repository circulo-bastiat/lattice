#!/usr/bin/env node
// swimgoalcontrolscheck.mjs — #4321: vanilla SwimGoal.setControls(EnumSet.of(JUMP)) only
// (.decomp/net/minecraft/entity/ai/goal/SwimGoal.java:12). Every roster `new Ai.SwimGoal(` registration
// must be JUMP-only, or it blocks the MOVE goals (chase, wander) vanilla runs alongside it.
// Anti-vacuity: re-adding MOVE to each registration must be caught ("<n> breaks caught").
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
const bad = s => s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /new Ai\.SwimGoal\(/.test(l) && /Ai\.MOVE/.test(l));
const n = (src.match(/new Ai\.SwimGoal\(/g) || []).length;
let fail = 0;
if (n < 4) { console.log('  ✗ only ' + n + ' SwimGoal registrations found'); fail++; }
for (const [i, l] of bad(src)) { console.log(`  ✗ 07k_goals.js:${i} ${l.trim()}`); fail++; }
let breaks = 0;
for (const m of src.matchAll(/gs\.add\(\d+, Ai\.JUMP, new Ai\.SwimGoal\(/g)) {
  const mut = src.slice(0, m.index) + m[0].replace('Ai.JUMP', 'Ai.MOVE | Ai.JUMP') + src.slice(m.index + m[0].length);
  if (bad(mut).length) { breaks++; console.log('  ✓ mutant caught'); } else { console.log('  ✗ mutant survived'); fail++; }
}
if (!breaks) { console.log('  ✗ no mutants'); fail++; }
if (fail) { console.log('FAIL ' + fail); process.exit(1); }
console.log(`OK  ${n} checks passed, 0 failures; SwimGoal registrations all JUMP-only; ${breaks} breaks caught`);
