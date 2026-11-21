#!/usr/bin/env node
// horselandcheck.mjs — #3177: HorseBaseEntity.handleFallDamage plays entity.horse.land (distance > 1, damage or not) and never small_fall/big_fall.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07zl_panda.js', '07zzp_mobvoice.js'], dom: false });
const MV = MCL.MobVoice;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const played = [];
MCL.Sound = MCL.Sound || {};
MCL.Sound.play = (id, o) => { played.push([id, o]); return true; };
MCL.Sound.blockVP = () => [1, 1];
MCL.Sound.blockFall = () => { played.push(['block.fall', {}]); return true; };
MCL.Physics = MCL.Physics || {}; MCL.Physics.blockAt = () => 1;
MCL.Physics.HORSE_BASE = MCL.Physics.HORSE_BASE || { horse: 1, donkey: 1, mule: 1, skeleton_horse: 1, zombie_horse: 1, llama: 1, trader_llama: 1 };
MCL.Physics.horseFallDamage = MCL.Physics.horseFallDamage || ((d, m) => Math.max(0, Math.ceil((d * 0.5 - 3) * m)));
const ids = () => played.map((p) => p[0]).join();
const fall = (type, dist) => {
  played.length = 0;
  const e = { type, x: 0, y: 5, z: 0, health: 20 };
  const dmg = MCL.Physics.horseFallDamage(dist, 1);
  if (MCL.Physics.HORSE_BASE[type] === 1) MV.horseLand(e, dist);
  if (dmg > 0) MV.onFall(e, dmg);
  return ids();
};
function scenario() {
  let r = true;
  for (const t of ['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama', 'trader_llama']) {
    const ll = t.endsWith('llama');   // LlamaEntity.handleFallDamage has no horse.land
    r = r && fall(t, 2) === (ll ? '' : 'entity.horse.land') && fall(t, 3) === (ll ? '' : 'entity.horse.land') && fall(t, 10) === (ll ? '' : 'entity.horse.land,') + 'block.fall' && fall(t, 1) === '';
  }
  return r && fall('cow', 10) === 'entity.generic.small_fall,block.fall';
}
ok(scenario(), 'horse-base types: 2 blocks -> horse.land only; 10 blocks -> horse.land + block fall; 1 block silent');
const hl = MV.horseLand; MV.horseLand = () => false; if (!scenario()) breaks++; else console.log('break1 missed'); MV.horseLand = hl;
const of = MV.onFall; MV.onFall = (e, d) => { MV.emit(e, 'entity.generic.big_fall', 1, 1); return of(e, d); }; if (!scenario()) breaks++; else console.log('break2 missed'); MV.onFall = of;
const H = MCL.Physics.HORSE_BASE; MCL.Physics.HORSE_BASE = {}; if (!scenario()) breaks++; else console.log('break3 missed'); MCL.Physics.HORSE_BASE = H;
ok(breaks === 3, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
