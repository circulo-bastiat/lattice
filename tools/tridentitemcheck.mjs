#!/usr/bin/env node
// tridentitemcheck.mjs -- #5614: the PLAYER's thrown trident (TridentItem.use/onStoppedUsing, .decomp).
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

console.log('tridentitemcheck - #5614: the player thrown trident');

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
const PL = (globalThis.NS || {}).Player || Use; PL.random = { nextDouble: () => 0.5 };   // the player throw draws from its own stream (pRand)
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
const trident = (d) => Iv.stack('trident', 1, d || 0, { Enchantments: [{ id: 'minecraft:loyalty', lvl: 1 }] });
function hold(P, ticks) {
  Iv.setItem(P.inventory, P.slot, trident(5));
  const st = Iv.getItem(P.inventory, P.slot);
  const started = Use.tridentStart(P, st);
  P.useTicks = ticks;
  const before = EL.list.length;
  const fired = Use.bowRelease(P);
  return { started, fired, spawned: EL.list.length - before };
}
let P = player();
let r = hold(P, 9);
ok(r.started, 'tridentStart begins the hold');
ok(!r.fired && r.spawned === 0, '9 ticks: no throw');
ok(Iv.getItem(P.inventory, 0) !== null && Iv.getItem(P.inventory, 0).d === 5, '9 ticks: stack kept, undamaged');
P = player();
r = hold(P, 10);
ok(r.fired && r.spawned === 1, '10 ticks: throws');
const t = EL.list[EL.list.length - 1];
ok(t.type === 'trident' && t.shooter === P, 'a trident entity shot by the player');
const g = Cb.ARROW_GAUSS_SCALE;
ok(Math.abs(t.vz - (-1 + Cb.gauss(Math.random) * g) * 2.5) < 1e-9, 'velocity is 2.5 along look');
ok(Iv.getItem(P.inventory, 0) === null, 'survival: stack removed from hand');
ok(t.pickupType === Cb.PICKUP_ALLOWED && t.pickupDamage === 6, 'pickup allowed, carries damage 5+1');
// pick it up
t.stuck = true; t.vx = t.vy = t.vz = 0; t.shake = 0;
MCL.Player = Object.assign(P, { x: 0, y: 64, z: 0, width: 0.6, height: 1.8 });
t.x = 0; t.y = 64; t.z = 0;
Cb.tickTrident(t);
const back = Iv.getItem(P.inventory, 0) || Iv.getItem(P.inventory, 9) || Iv.getItem(P.inventory, 1);
const all = []; for (let i = 0; i < 41; i++) { const s = Iv.getItem(P.inventory, i); if (s && !Iv.isEmpty(s)) all.push(s); }
ok(t.removed && all.length === 1 && IT.nameOf(all[0].i) === 'trident' && all[0].d === 6, 'pickup restores the damaged trident (d=6)');
ok(all.length === 1 && JSON.stringify(all[0].t) === JSON.stringify(trident(0).t), 'enchantment tag kept');
// creative: no pickup, not removed from hand? (creative keeps stack)
const C = player({ instabuild: true });
r = hold(C, 10);
const ct = EL.list[EL.list.length - 1];
ok(r.fired && ct.pickupType === Cb.PICKUP_CREATIVE_ONLY, 'creative: creative-only pickup');
ok(Iv.getItem(C.inventory, 0) && Iv.getItem(C.inventory, 0).d === 5, 'creative: stack kept, no durability loss');
// anti-vacuity
const saved = Use.TRIDENT_MIN_USE_TICKS;
Use.TRIDENT_MIN_USE_TICKS = 0;
okAv(hold(player(), 9).fired === true, 'removing the 10-tick gate lets 9 ticks throw (the 9-tick assertion would fail)');
Use.TRIDENT_MIN_USE_TICKS = saved;
const savedD = Use.damage; Use.damage = () => true;
okAv(hold(player(), 10).fired && Iv.stack('trident', 1, 6).d === 6 && EL.list[EL.list.length - 1].pickupDamage === 5, 'no durability spend would give pickupDamage 5, not 6');
Use.damage = savedD;
Math.random = REAL_RANDOM;
console.log(`\n assertions passed .. ${pass}\n failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
