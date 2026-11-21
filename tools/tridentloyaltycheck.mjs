#!/usr/bin/env node
// tridentloyaltycheck.mjs -- #5615 (TridentEntity.tick loyalty, .decomp)
// was: #5614: the PLAYER's thrown trident (TridentItem.use/onStoppedUsing, .decomp).
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

console.log('tridentloyaltycheck - #5615: trident Loyalty return flight');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js',
               '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
// the test cube sits at y -16..15, the players at y 64: a floor under the trident is a rule, not a cell
let FLOOR = false;
const floorAt = (x, y, z) => FLOOR && y === 64 && Math.abs(x) <= 3 && z >= -15 && z <= -9;
const W = {
  getBlock: (x, y, z) => (floorAt(x, y, z) ? MCL.States.stateOf('stone') : inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15,
  get: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
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

const trident = (lvl) => Iv.stack('trident', 1, 0, lvl ? { Enchantments: [{ id: 'minecraft:loyalty', lvl }] } : null);
function run(lvl, opts) {
  opts = opts || {};
  const P = player({ x: 0, y: 64, z: 0, width: 0.6, height: 1.8, health: 20 });
  MCL.Player = P;
  Iv.setItem(P.inventory, 0, trident(lvl));
  Use.tridentStart(P, Iv.getItem(P.inventory, 0));
  P.useTicks = 10; Use.bowRelease(P);
  const t = EL.list[EL.list.length - 1];
  t.shake = 0; t.x = 0; t.y = 66; t.z = -12; t.vx = t.vy = t.vz = 0;
  FLOOR = !!opts.floor;
  t.dealtDamage = true; t.stuck = !!opts.stuck;
  let n = 0, got = false;
  for (; n < 400 && !t.removed; n++) { if (opts.killAt === n) P.health = 0; EL.tick ? EL.tick() : 0; if (!EL.tick) { throw new Error('no EL.tick'); } }
  const all = []; for (let i = 0; i < 41; i++) { const s = Iv.getItem(P.inventory, i); if (s && !Iv.isEmpty(s)) all.push(s); }
  return { t, n, P, inv: all };
}
// independent reference of TridentEntity.tick + move, in vanilla order (loyalty step, then move by velocity)
function ref(lvl) {
  let x = 0, y = 66, z = -12, vx = 0, vy = 0, vz = 0, n = 0;
  const ey = 64 + Cb.eyeHeightOf({ type: 'player', height: 1.8 });
  for (; n < 400; n++) {
    let dx = 0 - x, dy = ey - y, dz = 0 - z;
    y += dy * 0.015 * lvl;   // the pull uses the vector taken BEFORE the setPos
    const l = Math.hypot(dx, dy, dz), k = 0.05 * lvl;
    vx = vx * 0.95 + dx / l * k; vy = vy * 0.95 + dy / l * k; vz = vz * 0.95 + dz / l * k;
    x += vx; y += vy; z += vz; vx *= 0.99; vy *= 0.99; vz *= 0.99;   // PersistentProjectileEntity.tick noClip: move, then drag, no gravity
    if (Math.abs(x) < 0.6 && Math.abs(z) < 0.6 && y < 65.8 && y + 0.5 > 64) return n + 1;
  }
  return -1;
}
const r3 = run(3);
ok(r3.t.removed && r3.inv.length === 1 && IT.nameOf(r3.inv[0].i) === 'trident', 'loyalty 3: trident ends up in the inventory');
ok(r3.t.noClip === true && r3.t.returnTimer > 0, 'loyalty 3: noClip set, returnTimer counted');
const want = ref(3);
say('ticks', r3.n, 'ref', want);
ok(want > 0 && Math.abs(r3.n - want) <= 2, `loyalty 3: arrives in the vanilla tick count (${r3.n} vs ref ${want})`);
const r0 = run(0, { floor: true });   // the empty test world has no floor: a free trident would fall out of it and be removed
ok(!r0.t.removed && !r0.t.noClip && r0.inv.length === 0 && (r0.t.returnTimer | 0) === 0, 'loyalty 0: stays where it is');
const rd = run(3, { killAt: 3 });
ok(rd.t.removed && rd.n <= 5 && rd.inv.length === 0, 'owner dead: trident discarded, not picked up');
// anti-vacuity: no returnTimer logic -> never returns
const sv = Cb.tickTrident; const SvTT = Cb.tickTrident;
Cb.tickTrident = function (e) { e.loyalty = 0; return SvTT(e); };
const rb = run(3, { floor: true });
okAv(!rb.t.removed && rb.inv.length === 0, 'without the loyalty step the trident never returns');
Cb.tickTrident = sv;
okAv(r3.t.returnTimer > 1, 'returnTimer advances every return tick');
Math.random = REAL_RANDOM;
console.log(`\n assertions passed .. ${pass}\n failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
