#!/usr/bin/env node
// damagesrccheck.mjs - #1603: snow golem heat (DamageSource.ON_FIRE) and snow golem / enderman water damage
// (DamageSource.DROWN) carry their source, so fire_resistance negates the burn and drown bypasses armour.
// ANTI-VACUITY: re-run with the source stripped / fire_resistance ignored; each must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
            '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07zw_mobnbt.js', '07zq_snowgolem.js', '07zg_enderman.js'],
    dom: false
  });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const out = [], say = (c, m) => { if (!c) out.push(m); };
  const Cb = M.Combat, EL = M.EntityList;
  let fr = true;
  M.Effects = Object.assign(M.Effects || {}, { hasStatusEffect: (e, n) => brk !== 'noresist' && fr && n === 'fire_resistance' });
  const seen = [];
  const realHurt = Cb.hurt;
  Cb.hurt = function (e, a, n, p, src) { seen.push(src); return realHurt.call(Cb, e, a, n, p, brk === 'nosrc' ? undefined : src); };
  M.Biomes = M.Biomes || {}; M.Biomes.temperatureAt = () => 2.0;
  M.World = M.World || {}; M.World.biomeAt = () => 0; M.World.getBlock = () => 0;
  EL.list.length = 0;
  const g = EL.spawn('snow_golem', 0, 64, 0);
  const h0 = g.health;
  M.SnowGolem.applyHeatDamage(g);
  say(seen.length === 1 && seen[0] && seen[0].source === 'onFire', 'heat damage source is onFire');
  say(g.health === h0, 'fire_resistance negates the hot-biome burn (health ' + h0 + ' -> ' + g.health + ')');
  fr = false;
  M.SnowGolem.applyHeatDamage(g);
  say(g.health < h0, 'without fire_resistance the burn hurts');
  seen.length = 0; g.inWater = true;
  M.SnowGolem.applyWaterDamage(g);
  say(seen.length === 1 && seen[0] && seen[0].source === 'drown', 'snow golem water source is drown');
  seen.length = 0;
  const en = EL.spawn('enderman', 4, 64, 0); en.inWater = true;
  if (M.Enderman.applyWaterDamage) M.Enderman.applyWaterDamage(en);
  say(seen.length >= 1 && seen[0] && seen[0].source === 'drown', 'enderman water source is drown');
  return out;
}
const fails = scenario(null);
let caught = 0;
for (const b of ['nosrc', 'noresist']) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`damagesrccheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`damagesrccheck: ${caught} breaks caught (of 2)`);
process.exit(fails.length ? 1 : 0);
