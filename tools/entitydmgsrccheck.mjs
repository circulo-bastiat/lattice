#!/usr/bin/env node
// entitydmgsrccheck.mjs — #11679: EntityDamageSource (14d_survival.js Sv.DAMAGE mob/sting/explosion...):
// isScaledWithDifficulty is true for an entity-dealt blow (mob, sting) and not for a projectile source (arrow);
// Sv.hurt applies PEACEFUL 0 / EASY min(a/2+1,a) / NORMAL a / HARD a*3/2 only to the scaled ones.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['14d_survival.js'], dom: false });
const Sv = M.Survival || M.Sv;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const taken = (type, diff) => {
  const saved = Sv.difficulty; Sv.difficulty = () => diff;
  try {
    const e = { health: 20, maxHealth: 20, absorption: 0, invulnerable: 0, dead: false };
    Sv.hurt(e, type, 4, null);
    return 20 - e.health;
  } finally { Sv.difficulty = saved; }
};
const good = () => {
  const r = {};
  for (const t of ['mob', 'sting', 'arrow']) for (const d of ['peaceful', 'easy', 'normal', 'hard']) r[t + d] = taken(t, d);
  return r.mobpeaceful === 0 && r.mobeasy === 3 && r.mobnormal === 4 && r.mobhard === 6 &&
    r.stingpeaceful === 0 && r.stingeasy === 3 && r.stinghard === 6 &&
    r.arrowpeaceful === 4 && r.arroweasy === 4 && r.arrowhard === 4;
};
ok(good(), 'entity-dealt sources scale with difficulty, projectile source does not');
ok(Sv.DAMAGE.mob.scaled === true && Sv.DAMAGE.sting.scaled === true && !Sv.DAMAGE.arrow.scaled, 'flags');
const caught = (label, fn, restore) => {
  fn(); let bad; try { bad = !good(); } catch (e) { bad = true; } restore();
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
const m = Sv.DAMAGE.mob.scaled, s = Sv.DAMAGE.sting.scaled, a = Sv.DAMAGE.arrow.scaled;
const rest = () => { Sv.DAMAGE.mob.scaled = m; Sv.DAMAGE.sting.scaled = s; Sv.DAMAGE.arrow.scaled = a; };
caught('mob not scaled', () => { Sv.DAMAGE.mob.scaled = false; }, rest);
caught('sting not scaled', () => { Sv.DAMAGE.sting.scaled = false; }, rest);
caught('arrow scaled', () => { Sv.DAMAGE.arrow.scaled = true; }, rest);
console.log('\n================ entitydmgsrccheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
