#!/usr/bin/env node
// fishsoundcheck.mjs — #1275: pufferfish blow_up/blow_out/sting and fish flop sounds, at PufferfishEntity.tick's exact thresholds.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
  '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07q_effects.js', '07zi_squid.js', '07zj_fish.js'] });
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Fish.init();
const Fh = M.Fish;
let log = [], tick = 0;
M.Sound = { mobSound: (e, ev) => { log.push([tick, ev]); return true; } };
Fh.random = () => 0.5;
const mk = () => ({ type: 'pufferfish', x: 0, y: 5, z: 0, baseWidth: 0.7, baseHeight: 0.7, width: 0.7, height: 0.7, puffState: 0, inflateTicks: 0, deflateTicks: 0, inWater: true });
const e = mk();
M.EntityList.list.length = 0; M.Player = null;
const at = (ev) => log.filter((l) => l[1] === ev).map((l) => l[0]);
// threat present: tick 1 puffs to 1, then inflateTicks passes 40 -> state 2
const threat = { type: 'zombie', x: 0.5, y: 5, z: 0, health: 20, width: 0.6, height: 1.95, removed: false };
M.EntityList.list.push(threat);
for (tick = 1; tick <= 45; tick++) Fh.puffTick(e);
const up = at('entity.puffer_fish.blow_up');
okAv(up.length === 2 && up[0] === 1 && up[1] === 41, 'blow_up at tick 1 and when inflateTicks>40 (got ' + up + ')');
okAv(e.puffState === 2, 'fully puffed');
threat.removed = true;
log = [];
for (tick = 100; tick <= 300; tick++) Fh.puffTick(e);
const out = at('entity.puffer_fish.blow_out');
okAv(out.length === 2 && out[0] === 161 && out[1] === 201, 'blow_out at deflateTicks>60 then >100 (got ' + out + ')');
okAv(e.puffState === 0, 'deflated');
// silent fish makes no sound
const q = mk(); q.silent = true; threat.removed = false; log = [];
Fh.puffTick(q); ok(log.length === 0, 'silent pufferfish plays nothing');
// flop
log = [];
const f = { type: 'cod', inWater: false, onGround: true, verticalCollision: true, x: 0, y: 0, z: 0 };
Fh.tickMovementFlop(f);
okAv(at('entity.cod.flop').length === 1, 'cod flop sound');
log = []; const pf = { type: 'pufferfish', inWater: false, onGround: true, verticalCollision: true, x: 0, y: 0, z: 0 };
Fh.tickMovementFlop(pf);
okAv(at('entity.puffer_fish.flop').length === 1, 'puffer_fish flop sound');
// sting
log = []; const p2 = mk(); p2.puffState = 2; M.EntityList.list.length = 0;
const pig = M.EntityList.spawn('pig', 0.5, 3.5, 0.5); p2.x = 0.6; p2.y = 3.5; p2.z = 0.5;
Fh.stingNearby(p2);
okAv(at('entity.puffer_fish.sting').length === 1, 'sting sound');
console.log(fails.length ? fails.join('\n') : '');
console.log(`fishsoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
