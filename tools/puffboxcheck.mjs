#!/usr/bin/env node
// puffboxcheck.mjs — #1273: PufferfishEntity.InflateGoal.canStart (getBoundingBox().expand(2.0)) and sting
// (expand(0.3)) are AABB-vs-AABB tests: target size and puff scale count. Not centre-distance spheres.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07q_effects.js', '07zi_squid.js', '07zj_fish.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Fish.init();
const EL = M.EntityList, Fh = M.Fish;
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };

console.log('puffboxcheck — #1273: pufferfish inflate/sting use expanded bounding boxes');
const fresh = () => { EL.list.length = 0; const e = EL.spawn('pufferfish', 0.5, 10, 0.5); e.inWater = true; return e; };
const put = (type, x, y, z) => { const o = EL.spawn(type, x, y, z); o.x = x; o.y = y; o.z = z; return o; };

// a 2.7-tall golem 3.8 below: centre 2.45 away vertically (sphere r^2 8 says no), but its top is inside expand(2.0)
{
  const e = fresh(); put('iron_golem', 0.5, 6.2, 0.5);
  Fh.puffTick(e);
  ok(e.puffState === 1, `tall target, box within expand(2.0) -> inflates (state ${e.puffState})`);
}
{ const e = fresh(); put('iron_golem', 0.5, 4.5, 0.5); Fh.puffTick(e);   // top at 7.2 < 10-2
  okAv(e.puffState === 0, `tall target whose box is out of reach does not inflate (state ${e.puffState})`); }
{ const e = fresh(); put('iron_golem', 0.5 + 0.35 + 0.7 + 2.5, 10, 0.5); Fh.puffTick(e);
  okAv(e.puffState === 0, `wide target out of the 2.0 expand horizontally does not inflate (state ${e.puffState})`); }
{ const e = fresh(); put('iron_golem', 0.5 + 0.175 + 0.7 + 1.9, 10, 0.5); Fh.puffTick(e);
  ok(e.puffState === 1, `wide target with far centre but box within 2.0 inflates (state ${e.puffState})`); }
{ const e = fresh(); const item = put('pig', 1, 10, 0.5); delete item.health; Fh.puffTick(e);
  okAv(e.puffState === 0, `a non-living entity (no health) never triggers InflateGoal (state ${e.puffState})`); }
// sting: far centre, touching boxes
{
  const e = fresh(); Fh.setPuffState(e, 2);
  const h = put('iron_golem', 0.5 + e.width / 2 + 0.7 + 0.25, 10, 0.5); const hp = h.health;
  Fh.stingNearby(e);
  ok(h.health < hp, `wide target within expand(0.3) is stung though centres are ~1.3 apart (${hp} -> ${h.health})`);
}
{
  const e = fresh(); Fh.setPuffState(e, 2);
  const h = put('iron_golem', 0.5 + e.width / 2 + 0.7 + 0.5, 10, 0.5); const hp = h.health;
  Fh.stingNearby(e);
  okAv(h.health === hp, `target beyond 0.3 of the box is not stung (${hp} -> ${h.health})`);
}
{
  const e = fresh(); Fh.setPuffState(e, 0);
  const h = put('iron_golem', 0.5, 10, 0.5); const hp = h.health;
  Fh.stingNearby(e);
  okAv(h.health === hp, 'an unpuffed fish never stings');
}

console.log('================ puffboxcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
