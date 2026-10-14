#!/usr/bin/env node
// piglinangercheck.mjs — #1221: Angerable.tickAngerLogic -> chooseRandomAngerTime on revenge; zombified_piglin rolls
// betweenSeconds(20,39) = 400..780 ticks like wolf/iron_golem/bee. Proves it can fail (breaks the whitelist).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js'], initReg: false });
const Ai = M.Ai;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const hit = (type, r) => {
  const e = { type, angerTime: 0, lastHurtByEntity: { id: 1 }, target: null, x: 0, y: 64, z: 0 };
  const g = new Ai.HurtByTargetGoal(e, () => r, null);
  g.start();
  return e.angerTime;
};
const good = () => [0, 0.5, 0.999999].every((r) => { const t = hit('zombified_piglin', r); return t >= 400 && t <= 780; })
  && hit('zombified_piglin', 0) === 400 && hit('zombified_piglin', 0.999999) === 780 && hit('wolf', 0) === 400;
ok(good(), 'piglin anger 400..780 after revenge');
const old = Ai.rollAngerTime;
Ai.rollAngerTime = () => 0;
if (!good()) { breaks++; console.log('   ✓ break caught: zero roll'); } else fails.push('anti-vacuity: zero roll unnoticed');
Ai.rollAngerTime = old;
Ai.rollAngerTime = (r) => 400;
if (!good()) { breaks++; console.log('   ✓ break caught: constant roll'); } else fails.push('anti-vacuity: constant roll unnoticed');
Ai.rollAngerTime = old;
console.log('\n================ piglinangercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
