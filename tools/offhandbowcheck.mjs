#!/usr/bin/env node
// offhandbowcheck.mjs -- #2331: BowItem.use(world, player, hand) draws from EITHER hand. A bow
// carried in the off hand (main hand empty / PASS) is drawn by Use.rightClick, then Use.bowRelease
// fires it from the off-hand stack (durability spent there, not on the main-hand slot).

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

console.log('offhandbowcheck — #2331: a bow in the off hand draws and fires');

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
// Use draws from the player JRandom (pRand, #6447), not Math.random: pin that stream too
(MCL.Player || Use).random = { nextDouble: () => 0.5 };


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
    lookVec() { return [0, 0, -1]; },
    syncHotbar() {},
  }, o);
}
const bow = () => Iv.stack('bow', 1, 0);
const arrows = (P) => { Iv.setItem(P.inventory, 5, Iv.stack('arrow', 3)); };
const nEnt = () => EL.list.filter((e) => e.type === 'arrow').length;

function run() {
  const P = player({ hasTarget: false });
  Iv.setItem(P.inventory, Iv.OFFHAND, bow());
  arrows(P);
  const r = Use.rightClick(P);
  ok(r === 'use' && P.usingItem === true && P.useHand === 1, `off-hand bow, empty main hand: rightClick starts a draw in hand 1 (got ${r}, hand ${P.useHand})`);
  P.useTicks = 20;
  const before = nEnt();
  const fired = Use.bowRelease(P);
  ok(fired === true && nEnt() === before + 1, 'release fires an arrow from the off-hand bow');
  const off = Iv.getItem(P.inventory, Iv.OFFHAND);
  ok(off && (off.d | 0) === 1, `the off-hand bow took the durability (d=${off && off.d})`);
  ok(Iv.getItem(P.inventory, 5).n === 2, 'one arrow consumed');
  return { r, fired };
}
const real = run();

// main hand holds a plain block: its use() does not consume the click -> off hand still draws
{
  const P = player({ hasTarget: false });
  Iv.setItem(P.inventory, Iv.OFFHAND, bow()); arrows(P);
  const P2 = player({ hasTarget: false });
  Iv.setItem(P2.inventory, 0, bow()); Iv.setItem(P2.inventory, Iv.OFFHAND, bow()); arrows(P2);
  Use.rightClick(P2);
  ok(P2.usingItem && P2.useHand === 0, 'bow in BOTH hands: the main hand wins (hand 0)');
}
{
  const P = player({ hasTarget: false });
  arrows(P); Iv.setItem(P.inventory, Iv.OFFHAND, bow());
  P.instabuild = false; Iv.setItem(P.inventory, 5, null);
  ok(Use.rightClick(P) === false && !P.usingItem, 'off-hand bow with no ammo (survival): no draw');
}

// anti-vacuity: break the new fallback / the hand argument and the real run must fail
{
  const saved = Use.bowStart;
  Use.bowStart = function (P, s) { return saved.call(Use, P, s, 0); };
  const P = player({ hasTarget: false });
  Iv.setItem(P.inventory, Iv.OFFHAND, bow()); arrows(P);
  Use.rightClick(P);
  okAv(P.useHand !== 1, 'forcing hand 0 loses the off-hand draw this check asserts');
  Use.bowStart = function () { return false; };
  const Q = player({ hasTarget: false });
  Iv.setItem(Q.inventory, Iv.OFFHAND, bow()); arrows(Q);
  okAv(Use.rightClick(Q) !== 'use', 'a bowStart that refuses leaves no off-hand draw');
  Use.bowStart = saved;
}

Math.random = REAL_RANDOM;
console.log(`offhandbowcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
