#!/usr/bin/env node
// piglinhittimercheck.mjs — #1294: ZombifiedPiglinEntity.mobTick: hasAngerTime() => playerHitTimer = age.
// An angry piglin keeps counting as player-killed after lastHurtByPlayer expires. Proves it can fail.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['14j_combat.js'], initReg: false });
const Cb = M.Combat;
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = (type, anger) => {
  const e = { type, maxHealth: 20, health: 20, age: 500, angerTime: anger, target: null, playerHitTimer: 0 };
  for (let i = 0; i < 3; i++) Cb.tickEntity(e);
  return Cb.recentlyHitByPlayer(e);
};
const good = () => run('zombified_piglin', 400) === true && run('zombified_piglin', 0) === false && run('wolf', 400) === false;
ok(good(), 'angry piglin counts as player-hit; calm piglin / angry wolf do not');
const old = Cb.tickEntity;
Cb.tickEntity = function (e) { old(e); e.playerHitTimer = 0; };
if (!good()) { breaks++; console.log('   ✓ break caught: timer cleared'); } else fails.push('anti-vacuity: cleared timer unnoticed');
Cb.tickEntity = old;
Cb.tickEntity = function (e) { old(e); if (e.type === 'wolf') e.playerHitTimer = 5; };
if (!good()) { breaks++; console.log('   ✓ break caught: wolf also flagged'); } else fails.push('anti-vacuity: wolf flag unnoticed');
Cb.tickEntity = old;
console.log('\n================ piglinhittimercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
