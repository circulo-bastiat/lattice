#!/usr/bin/env node
// #11685: ItemCooldownManager (pearl row), EnderPearlItem, LingeringPotionItem, SnowballItem,
// ThrowablePotionItem in 07zzd_throw.js, driven through Throw.use (the Use.rightClick fallback), each cut and caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');



const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js', '14d_survival.js',
               '07q_effects.js', '07m_breed.js', '07z_potion.js', '14j_combat.js', '14l_use.js',
               '07zzd_throw.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js',
               // struck s117 -- sound (S.entitySound) and the egg/pearl particle bursts
               // (Px.spawnEggBurst/Px.spawnPearlBurst) both need their own module loaded to
               // exercise anything beyond the `if (NS.Sound && ...)`/`if (NS.Particle && ...)`
               // no-op guards `Th.use`/`Th.tickEgg`/`Th.tickPearl` already fall back to.
               '02j_sounds.js', '07zx_particle.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
            setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
            blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Breed.init();
MCL.Use.init(W);
MCL.Commands = { rules: {}, ruleGet(name) { return (name in this.rules) ? this.rules[name] : 'true'; } };

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat,
      Th = MCL.Throw, Po = MCL.Potion, ES = MCL.Effects, Br = MCL.Breed, ER = MCL.EntityRender;


const REAL_RANDOM = Math.random;
Math.random = () => 0.5; MCL.wrand = () => 0.5;   // NS.wrand: world.random (#6441)
function gaussOffset() { return Cb.gauss(Math.random) * Cb.ARROW_GAUSS_SCALE * Th.DIVERGENCE; }

function player(opts) {
  const inv = Iv.create();
  return Object.assign({
    inventory: inv, slot: 0, instabuild: false,
    ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true,
    yaw: 0, pitch: 0, hasTarget: false, targetEntity: null, crouching: false,
    heldItem() { return Iv.getItem(this.inventory, this.slot); },
    lookVec() { return [0, 0, -1]; },
    syncHotbar() {},
  }, opts || {});
}
const stk = (name, n, tag) => Iv.stack(name, n === undefined ? 1 : n, 0, tag);
let pass = 0, fails = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };
const last = () => EL.list[EL.list.length - 1];
function run() {
  // SnowballItem
  let P = player(); Iv.setItem(P.inventory, 0, stk('snowball', 3));
  let n0 = EL.list.length;
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true && EL.list.length === n0 + 1 && last().type === 'snowball', 'snowball throws a snowball');
  ok(Math.abs(last().vz - -1.5) < 0.5 && Iv.getItem(P.inventory, 0).n === 2, 'snowball speed 1.5 and stack spent');
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, 'snowball has no cooldown');
  // EnderPearlItem + ItemCooldownManager
  P = player(); Iv.setItem(P.inventory, 0, stk('ender_pearl', 4));
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true && last().type === 'ender_pearl', 'pearl throws an ender_pearl');
  ok(P.pearlCooldown === 20, 'pearl sets a 20-tick cooldown');
  n0 = EL.list.length;
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === false && EL.list.length === n0, 'pearl refused mid-cooldown');
  for (let i = 0; i < 20; i++) Th.tickCooldown(P);
  ok(P.pearlCooldown === 0 && Th.use(P, Iv.getItem(P.inventory, 0)) === true, 'cooldown ticks to 0 and pearl throws again');
  // ThrowablePotionItem (splash) and LingeringPotionItem
  for (const [item, ling, snd] of [['splash_potion', false, 'entity.splash_potion.throw'], ['lingering_potion', true, 'entity.lingering_potion.throw']]) {
    P = player(); Iv.setItem(P.inventory, 0, stk(item, 2, { Potion: 'minecraft:poison' }));
    ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, item + ' throws');
    const e = last();
    ok(e.type === 'potion' && e.lingering === ling && e.potionId === 'poison', item + ' spawns potion with lingering=' + ling);
    ok(Th.ITEMS[item].sound === snd && Math.abs(Th.ITEMS[item].speed - 0.5) < 1e-9 && Th.ITEMS[item].pitchOffset === -20, item + ' sound/speed/pitchOffset');
  }
}
Math.random = () => 0.5; MCL.wrand = () => 0.5;
run();
const O = { use: Th.use, tick: Th.tickCooldown, items: Th.ITEMS, cd: Th.PEARL_COOLDOWN };
const reset = () => { Th.use = O.use; Th.tickCooldown = O.tick; Th.ITEMS = O.items; Th.PEARL_COOLDOWN = O.cd; };
const cloneItems = (f) => { const c = JSON.parse(JSON.stringify(O.items)); f(c); return c; };
const cuts = [
  () => { Th.ITEMS = cloneItems((c) => { delete c.snowball; }); },
  () => { Th.ITEMS = cloneItems((c) => { c.snowball.speed = 0.5; }); },
  () => { Th.ITEMS = cloneItems((c) => { delete c.ender_pearl; }); },
  () => { Th.PEARL_COOLDOWN = 0; },
  () => { Th.tickCooldown = () => {}; },
  () => { Th.ITEMS = cloneItems((c) => { c.lingering_potion.lingering = false; }); },
  () => { Th.ITEMS = cloneItems((c) => { c.lingering_potion.sound = 'x'; }); },
  () => { Th.ITEMS = cloneItems((c) => { c.splash_potion.pitchOffset = 0; }); },
];
for (const cut of cuts) {
  reset(); const f0 = fails; cut(); try { run(); } catch (e) { fails++; }
  if (fails > f0) { breaks++; fails = f0; console.log('   ✓ cut caught'); } else console.log('FAIL cut not caught');
}
reset();
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);
process.exit(fails || breaks !== cuts.length ? 1 : 0);
