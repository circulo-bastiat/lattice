#!/usr/bin/env node
// statsridecheck.mjs -- G26v: every vehicle feeds Stats.riding with PlayerEntity.increaseRidingMotionStats's rule
// (.decomp PlayerEntity.java:1511): round((float)sqrt(dx2+dy2+dz2)*100F) cm, only when > 0, to the vehicle's stat
// (minecart/boat/pig/horse-family/strider); and the player tick calls Stats.travel with `vehicle` in every gamemode.
//   node tools/statsridecheck.mjs
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07zzo_stats.js'] });
const St = M.Stats;
const java = readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/entity/player/PlayerEntity.java', 'utf8');
ok(/instanceof AbstractMinecartEntity\)[\s\S]*?BoatEntity[\s\S]*?PigEntity[\s\S]*?HorseBaseEntity[\s\S]*?StriderEntity/.test(java), 'vanilla order minecart/boat/pig/horse/strider');

const TABLE = {
  minecart: 'minecart_one_cm', chest_minecart: 'minecart_one_cm', furnace_minecart: 'minecart_one_cm', hopper_minecart: 'minecart_one_cm',
  tnt_minecart: 'minecart_one_cm', spawner_minecart: 'minecart_one_cm', command_block_minecart: 'minecart_one_cm',
  boat: 'boat_one_cm', pig: 'pig_one_cm', strider: 'strider_one_cm',
  horse: 'horse_one_cm', donkey: 'horse_one_cm', mule: 'horse_one_cm', llama: 'horse_one_cm', trader_llama: 'horse_one_cm',
  skeleton_horse: 'horse_one_cm', zombie_horse: 'horse_one_cm',
};
const key = (k) => St.map[St.statName ? St.statName('custom', 'minecraft:' + k) : k];
function run(riding, tag) {
  for (const [t, stat] of Object.entries(TABLE)) {
    St.reset();
    riding({ type: t }, 3, 0, 4);      // 5 blocks -> 500
    riding({ type: t }, 0, 1.5, 0);    // vertical counts (3D) -> 150
    riding({ type: t }, 0.001, 0, 0);  // round(0.1)=0 -> nothing
    const got = Object.entries(St.map).filter(([, v]) => v);
    ok(got.length === 1 && got[0][0].endsWith(stat) && got[0][1] === 650, `${tag}: ${t} -> ${stat} 650 (got ${JSON.stringify(got)})`);
  }
  St.reset(); riding({ type: 'cow' }, 1, 1, 1); riding(null, 1, 1, 1);
  ok(Object.keys(St.map).length === 0, tag + ': non-vehicles count nothing');
}
const real = (v, x, y, z) => St.riding(v, x, y, z);
run(real, 'engine');
// travel(): a vehicle short-circuits the on-foot branches
St.reset(); St.travel({ vehicle: { type: 'boat' }, onGround: true }, 1, 0, 0);
ok(Object.keys(St.map).length === 1 && Object.keys(St.map)[0].endsWith('boat_one_cm'), 'travel with vehicle -> boat_one_cm only');

// call-site: Player.tick passes vehicle and is not behind the invulnerable (creative) guard
const pl = readFileSync(MCLITE_ROOT + 'src/14_player.js', 'utf8');
const site = pl.indexOf('NS.Stats.travel({');
const guard = pl.lastIndexOf('if (Sv && !P.invulnerableGamemode)', site);
const callOk = (src) => { const s = src.indexOf('NS.Stats.travel({'); const g = src.lastIndexOf('if (Sv && !P.invulnerableGamemode)', s);
  return s > 0 && /vehicle: P\.vehicle/.test(src.slice(s, s + 700)) && !(g > src.lastIndexOf('Stats.travel', s - 1) && g < s && g > src.lastIndexOf('var Sv = NS.Survival', s)); };
ok(callOk(pl), 'Player.tick: Stats.travel gets vehicle, outside the survival-only guard');

// ---- anti-vacuity: break the data and the check must notice
for (const drop of ['strider', 'pig', 'boat', 'llama']) {
  const broken = (v, x, y, z) => (v && v.type === drop ? undefined : St.riding(v, x, y, z));
  const before = fails.length; run(broken, 'broken'); const bad = fails.length > before;
  fails.length = before; caught(bad, 'dropped call site ' + drop + ' not noticed');
}
{ const skew = (v, x, y, z) => St.riding(v, x, y, z + 0.01);
  const before = fails.length; run(skew, 'broken'); const bad = fails.length > before; fails.length = before; caught(bad, 'skewed distance not noticed'); }
caught(!callOk(pl.replace('vehicle: P.vehicle', 'vehicle: null')), 'removed vehicle arg not noticed');

console.log(`statsridecheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
