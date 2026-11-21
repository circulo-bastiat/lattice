#!/usr/bin/env node
// piglinsoundcheck.mjs — #4045: PiglinBrain.getSound (PiglinBrain.java:590) activity -> SoundEvent via MobVoice.pick(piglin, ambient).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zzf_piglin.js', '07zzp_mobvoice.js'], initReg: false });
const Pg = M.Piglin, MV = M.MobVoice;
let fails = [], pass = 0, breaks = 0;
const mk = (f) => Object.assign({ type: 'piglin', x: 0, y: 64, z: 0, health: 16, pgClock: 0 }, f);
const alive = { health: 10, x: 1, y: 64, z: 1, dead: false };
const run = () => {
  const o = [], safe = (v) => { Pg.shouldZombify = () => v; };
  const old = Pg.shouldZombify;
  safe(true);
  o.push(MV.pick(mk({}), 'ambient') === 'entity.piglin.retreat');                       // overworld: shouldZombify -> retreat grunt
  o.push(Pg.activitySound(mk({ pgAdmireUntil: 10 })) === 'entity.piglin.retreat'); // shouldZombify beats admire (PiglinBrain.java:594-610)
  safe(false);
  o.push(MV.pick(mk({}), 'ambient') === 'entity.piglin.ambient');
  o.push(MV.pick(mk({ pgAdmireUntil: 10 }), 'ambient') === null);   // #4355: silent unless IDLE
  o.push(Pg.activitySound(mk({ pgCelebrateUntil: 10 })) === 'entity.piglin.celebrate' && MV.pick(mk({ pgCelebrateUntil: 10 }), 'ambient') === null && MV.pick(mk({ vehicle: {} }), 'ambient') === null);
  const a = Pg.angryAt; Pg.angryAt = () => alive; o.push(Pg.activitySound(mk({})) === 'entity.piglin.angry' && MV.pick(mk({}), 'ambient') === null); Pg.angryAt = a;
  const v = Pg.avoidTarget; Pg.avoidTarget = () => alive; o.push(Pg.activitySound(mk({})) === 'entity.piglin.retreat' && MV.pick(mk({}), 'ambient') === null); Pg.avoidTarget = v;
  const far = { health: 10, x: 50, y: 64, z: 0, dead: false };
  safe(false); Pg.avoidTarget = () => far; o.push(Pg.activitySound(mk({})) === 'entity.piglin.ambient'); Pg.avoidTarget = v;   // avoid target beyond 12: no retreat
  o.push(Pg.activitySound(mk({ pgAdmireUntil: 10 })) === 'entity.piglin.admiring_item');
  safe(true); Pg.angryAt = () => alive; o.push(Pg.activitySound(mk({})) === 'entity.piglin.angry'); Pg.angryAt = a;   // fight beats zombify
  safe(false);
  const nr = Pg.nearestRepellent;
  Pg.nearestRepellent = () => ({ x: 1, y: 64, z: 1 }); o.push(Pg.activitySound(mk({})) === 'entity.piglin.retreat');   // soul fire nearby, IDLE: retreat
  Pg.nearestRepellent = () => null; o.push(Pg.activitySound(mk({})) === 'entity.piglin.ambient');
  Pg.nearestRepellent = nr;
  Pg.shouldZombify = old;
  return o;
};
run().forEach((v, i) => v ? pass++ : fails.push('assertion #' + i));
const caught = (label, fn, restore) => {
  fn(); let bad; try { bad = !run().every(Boolean); } catch (e) { bad = true; } restore();
  if (bad) { breaks++; console.log('   ✓ break caught: ' + label); } else fails.push('anti-vacuity: ' + label);
};
{ const o = Pg.activitySound; caught('activitySound always ambient', () => { Pg.activitySound = () => 'entity.piglin.ambient'; }, () => { Pg.activitySound = o; }); }
{ const o = Pg.activitySound; caught('activitySound drops admire', () => { Pg.activitySound = (e) => (e.pgAdmireUntil ? 'entity.piglin.angry' : o(e)); }, () => { Pg.activitySound = o; }); }
{ const o = Pg.activitySound; caught('nearestRepellent stubbed null', () => { Pg.activitySound = (e) => { const r = Pg.nearestRepellent; Pg.nearestRepellent = () => null; try { return o(e); } finally { Pg.nearestRepellent = r; } }; }, () => { Pg.activitySound = o; }); }
{ const o = Pg.inIdleActivity; caught('idle gate removed', () => { Pg.inIdleActivity = () => true; }, () => { Pg.inIdleActivity = o; }); }
{ const o = Pg.isCelebrating; caught('celebrate ignored', () => { Pg.isCelebrating = () => false; }, () => { Pg.isCelebrating = o; }); }
console.log('\n================ piglinsoundcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
