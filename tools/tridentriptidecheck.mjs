#!/usr/bin/env node
// tridentriptidecheck.mjs -- #5616 riptide (TridentItem.onStoppedUsing, .decomp): the PLAYER's thrown trident (TridentItem.use/onStoppedUsing, .decomp).
// 9 ticks held = no throw, 10 = throw at 2.5, durability -1, the stuck trident picked up restores the damaged stack.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('tridentriptidecheck - #5616: trident riptide');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
               '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15,
};
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Use.init(W);

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat, ES = MCL.Effects;

// pinned so a velocity assertion is exact arithmetic instead of a tolerance band that
// occasionally loses to a rare multi-sigma gaussian draw -- the same Math.random override
// pattern combatcheck/aicheck/etc. already use for a seeded roll. Restored at the very end.
const REAL_RANDOM = Math.random;
Math.random = () => 0.5;
function gaussOffset() { return Cb.gauss(Math.random) * Cb.ARROW_GAUSS_SCALE * Use.BOW_DIVERGENCE; }

ok(Use.ready, 'Use module reports ready');
ok(!!EL.canSpawn('arrow') && !!EL.canSpawn('spectral_arrow'), 'both arrow types are simulatable (D-402 motion table)');

// ── a player stub that is exactly what Use.bowStart/bowRelease/getArrowSlot read ────────────
function player(opts) {
  const inv = Iv.create();
  const o = opts || {};
  return Object.assign({
    inventory: inv,
    slot: 0,
    instabuild: false,
    usingItem: false, useHand: 0, useTicks: 0,
    ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true,
    yaw: 0, pitch: 0,
    heldItem() { return Iv.getItem(this.inventory, this.slot); },
    lookVec() { return [0, 0, -1]; },       // fixed, straight -Z — this engine's own convention
    syncHotbar() {},
  }, o);
}
const trident = (d) => Iv.stack('trident', 1, d || 0, { Enchantments: [{ id: 'minecraft:riptide', lvl: 3 }] });
function hold(P, ticks) {
  Iv.setItem(P.inventory, P.slot, trident(5));
  const st = Iv.getItem(P.inventory, P.slot);
  const started = Use.tridentStart(P, st);
  P.useTicks = ticks;
  const before = EL.list.length;
  const fired = Use.bowRelease(P);
  return { started, fired, spawned: EL.list.length - before };
}

const rip = (lvl) => Iv.stack('trident', 1, 5, { Enchantments: [{ id: 'minecraft:riptide', lvl }] });
function go(P, lvl, ticks) {
  Iv.setItem(P.inventory, P.slot, rip(lvl));
  const st = Iv.getItem(P.inventory, P.slot);
  const started = Use.tridentStart(P, st);
  if (!started) return { started, fired: false };
  P.useTicks = ticks;
  return { started, fired: Use.bowRelease(P) };
}
// water, riptide III: look(0,0,-1) * 3*(1+3)/4 = 3
let P = player({ inWater: true, onGround: false });
let r = go(P, 3, 10);
ok(r.fired, 'water: riptide fires');
ok(Math.abs(P.vz + 3) < 1e-9 && P.vx === 0 && P.vy === 0, 'riptide III velocity = look * 3.0, got ' + P.vz);
ok(P.riptideTicks === 20, 'riptideTicks = 20');
ok(Iv.getItem(P.inventory, 0) && Iv.getItem(P.inventory, 0).d === 6 && EL.list.length === 0, 'stack kept, damaged 1, no entity');
P = player({ inWater: true, onGround: false }); go(P, 1, 10);
ok(Math.abs(P.vz + 1.5) < 1e-9, 'riptide I velocity 1.5');
P = player({ inWater: true, onGround: true }); go(P, 2, 10);
ok(Math.abs(P.ey - 65.1999999) < 1e-6, 'on ground: hop 1.2');
P = player({ inWater: true }); go(P, 3, 9);
ok(P.vz === 0 && !P.riptideTicks, '9 ticks: nothing');
P = player({ inWater: true }); go(P, 3, 10); MCL.Use.tickRiptide(P);
ok(P.riptideTicks === 19, 'tickRiptide counts down');
P.horizontalCollision = true; MCL.Use.tickRiptide(P);
ok(P.riptideTicks === 0, 'wall stops riptide');
// dry air
P = player();
r = go(P, 3, 10);
ok(!r.started && P.vz === 0 && !P.riptideTicks, 'dry: no start, no motion');
ok(Iv.getItem(P.inventory, 0).d === 5, 'dry: stack unchanged');
// anti-vacuity
const sv = Use.touchingWaterOrRain;
Use.touchingWaterOrRain = () => true;
P = player(); go(P, 3, 10);
okAv(P.vz === -3, 'dropping the water gate launches in dry air (dry assertion would fail)');
Use.touchingWaterOrRain = sv;
const sd = Use.damage; Use.damage = () => true;
P = player({ inWater: true }); go(P, 3, 10);
okAv(Iv.getItem(P.inventory, 0).d === 5, 'no durability spend leaves d=5 (d=6 assertion would fail)');
Use.damage = sd;
Math.random = REAL_RANDOM;
console.log(`\n assertions passed .. ${pass}\n failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
