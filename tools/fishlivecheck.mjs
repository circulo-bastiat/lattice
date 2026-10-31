#!/usr/bin/env node
// fishlivecheck.mjs — G24: FishingBobberEntity.tick is called from EL.tick in a live world.
// Cast a rod over open water, tick the entity list: bobber flies, settles BOBBING in the water, and
// tickFishingLogic produces a bite (caughtFish). Faults: tick call disabled / wait timer zeroed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
console.log('fishlivecheck — G24: live bobber tick');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
  '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js',
  '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14d_survival.js', '07q_effects.js', '14j_combat.js',
  '14l_use.js', '07zzq_fishing.js', '02j_sounds.js', '09c_weather.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const R = MCL.Reg, def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
const WATER = def('water'), STONE = def('stone');
const blocks = new Map();
const W = { getBlock: (x, y, z) => { const k = x + ',' + y + ',' + z; if (blocks.has(k)) return blocks.get(k); return y <= 50 ? STONE : y <= 63 ? WATER : 0; },
  get: () => null, setBlock() { return true; }, blockLightAt: () => 15 };
MCL.World = W; MCL.Behave.init(W); MCL.BlockEntities.init(); MCL.Entities.init(); MCL.EntityList.init(); MCL.Combat.init(); MCL.Use.init(W);
MCL.Physics.shapeAt = (x, y, z) => (W.getBlock(x, y, z) === STONE ? MCL.Physics.FULL_CUBE : null);
const { Inventory: Iv, EntityList: EL, Fishing: Fi } = MCL;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
MCL.Sound.entitySound = () => {};

function scene() {
  const P = { inventory: Iv.create(), slot: 0, ex: 0.5, ey: 64, ez: 0.5, x: 0.5, y: 64, z: 0.5, EYE: 1.62, yaw: Math.PI, pitch: 0.3, fishHook: null };
  Iv.setItem(P.inventory, 0, Iv.stack('fishing_rod', 1, 0));
  const res = { cast: Fi.use(P, Iv.getItem(P.inventory, 0)), P };
  const e = P.fishHook; res.e = e; res.states = []; res.bite = false;
  if (!e) return res;
  for (let t = 0; t < 1500 && !e.removed; t++) {
    EL.tick(); if (e.state !== undefined && res.states[res.states.length - 1] !== e.state) res.states.push(e.state);
    if (e.caughtFish) { res.bite = true; break; }
  }
  return res;
}
console.log('\n1. cast over open water');
const r0 = scene();
ok(r0.cast && r0.e, 'cast spawned a bobber');
ok(r0.states[0] === Fi.FLYING && r0.states.includes(Fi.BOBBING), 'FLYING -> BOBBING: ' + r0.states);
ok(r0.e && !r0.e.removed && r0.e.y > 62 && r0.e.y < 65, 'bobber floats at the surface: y=' + (r0.e && r0.e.y));
ok(r0.bite, 'a bite (caughtFish) occurred from tickFishingLogic');

console.log('\n2. anti-vacuity');
let breaks = 0;
function fault(name, apply, undo, pred) {
  apply(); const r = scene(); undo();
  breaks++; const caught = pred(r); ok(caught, 'fault not caught: ' + name); if (caught) console.log('  ✓ fault caught: ' + name);
}
const origTick = Fi.tick, origLogic = Fi.tickFishingLogic;
fault('tick call disabled', () => { Fi.tick = () => {}; }, () => { Fi.tick = origTick; }, (r) => !r.bite);
fault('bite logic disabled', () => { Fi.tickFishingLogic = (e) => { e.waitCountdown = 0; }; }, () => { Fi.tickFishingLogic = origLogic; }, (r) => !r.bite);
fault('water treated as air', () => { Fi.liveEnv = (o => () => Object.assign(o(), { fluidHeight: () => 0 }))(Fi.liveEnv); }, () => {}, (r) => !r.bite);
if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`OK  ${pass} checks passed, 0 failures; live bobber tick; ${breaks} breaks caught`);
