#!/usr/bin/env node
// shearscheck.mjs — #184 G19ea: ShearsItem as a tool (getMiningSpeed, postMine wear, useOnBlock on plant stems) + the hive. Headless, usecheck adapter.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { readdirSync, statSync, existsSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; say('  ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js',
               '07zze_oxidize.js', '07zo_bee.js', '07zx_particle.js'];
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
// ⚠ THE ENTITY TABLE IS LOADED BECAUSE PRIMING TNT SPAWNS ONE. Without it `EntityList.canSpawn`
// is false for everything and §5's TNT assertion would pass over an engine that primed nothing —
// the check would be measuring its own missing payload (D-351's shape).
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const R = MCL.Reg, S = MCL.States, B = MCL.Behave, U = MCL.Use, IT = MCL.Items;

// ── the world, and a player that is only what `Use` reads of one ────────────────────────────
const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) {
    if (!inside(x, y, z)) return false;
    cells[idx(x, y, z)] = id;
    if (B.ready) B.changed(x, y, z);
    return true;
  },
  poke(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; },
  blockLightAt: () => 15,
  clear() { cells.fill(0); },
};
MCL.World = W;
B.init(W);
MCL.BlockEntities.init();
B.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
if (MCL.EntityList && MCL.EntityList.init) MCL.EntityList.init();
U.init(W);

const def = (n) => S.stateOf(n);
const pName = (st, p) => B.propName(st, p);

/**
 * A player stub that is exactly the fields `Use.rightClick` reads, and no more.
 * ⚠ IT IS NOT A REAL PLAYER AND `placeBlock` IS A SPY. §9 asserts the EXCLUSION — that a
 * consumed block use never reaches placement — and the only way to see that is to count the
 * calls rather than the world writes, because a door's open and a door's placement both leave
 * an oak_door in the cell.
 */
let placeCalls = 0;
function mkPlayer(opts) {
  const o = opts || {};
  return {
    mode: 1, instabuild: o.instabuild !== false, invulnerableGamemode: o.instabuild !== false, mayBuild: true, crouching: !!o.crouching,
    slot: 0, inventory: null, yaw: o.yaw || 0,
    hasTarget: true, tx: 0, ty: 0, tz: 0, tface: 2,
    // a bucket casts its OWN ray (BucketItem.use -> Item.raycast): an eye half a block over the
    // target cell's top, looking straight down, so that ray and the crosshair agree on (0,0,0)
    ex: 0.5, ey: 1, ez: 0.5, eyeHeight: 0.5, lookVec() { return [0, -1, 0]; },
    _stack: o.stack || null,
    heldItem() { return this._stack; },
    syncHotbar() {},
    /**
     * ⚠ THE SPY REFUSES WHAT THE REAL ONE WOULD REFUSE. The first version returned true for
     * everything, so a hoe under a solid block "fell through to placement" and §5's refusal
     * assertions passed for the wrong reason — the stub was more capable than the game. It now
     * places only what actually has a block state, which is `placeBlock`'s own first test.
     */
    placeBlock() {
      placeCalls++;
      if (o.placeSucceeds === false) return false;
      const st = this._stack ? MCL.Items.stateOf(this._stack.i | 0) : -1;
      return st > 0;
    },
  };
}
const stackOf = (name) => { const i = IT.of(name); return i < 0 ? null : { i: i, n: 1, d: 0 }; };

/** Put `block` at the origin, aim at it, and right-click once. */
function click(block, heldName, opts) {
  const o = opts || {};
  W.clear();
  B.clearSchedule();
  placeCalls = 0;
  if (block) W.poke(0, 0, 0, typeof block === 'number' ? block : def(block));
  if (o.below) W.poke(0, -1, 0, def(o.below));
  const P = mkPlayer({ stack: heldName ? stackOf(heldName) : null, crouching: o.crouching,
                       instabuild: o.instabuild, yaw: o.yaw, placeSucceeds: o.placeSucceeds });
  P.tface = o.face === undefined ? 2 : o.face;
  const before = W.getBlock(0, 0, 0);
  const res = U.rightClick(P);
  return { res, before, after: W.getBlock(0, 0, 0), P,
           placeCalls, faceCell: W.getBlock(0, 1, 0) };
}

const M = MCL.Mining;
const spd = (b, item) => M.playerSpeed(R.id[b], { item });
say('1. ShearsItem.getMiningSpeedMultiplier');
for (const [b, v] of [['cobweb', 15], ['oak_leaves', 15], ['azalea_leaves', 15], ['white_wool', 5], ['red_wool', 5], ['vine', 2], ['glow_lichen', 2], ['dirt', 1], ['grass', 1]]) {
  ok(spd(b, 'shears') === v, `shears vs ${b}: ${spd(b, 'shears')} want ${v}`);
}
okAv(spd('oak_leaves', 'stick') !== 15 && spd('white_wool', 'iron_pickaxe') !== 5, 'a stick/pickaxe does not get the shears speed');
say('2. isSuitableFor / drops');
ok(M.canHarvest(R.id.cobweb, 'shears'), 'cobweb harvestable with shears');
okAv(!M.canHarvest(R.id.cobweb, 'stick') && !M.canHarvest(R.id.cobweb, null), 'cobweb is not harvestable bare-handed or with a stick');
const names = (b, item) => MCL.Loot.breakDrops(def(b), { item, silkTouch: false }).map((d) => d.item);
const dropOf = (b, item) => JSON.stringify(MCL.Loot.breakDrops(def(b), { item }));
ok(/"item":"cobweb"/.test(dropOf('cobweb', 'shears')), 'cobweb + shears drops cobweb: ' + dropOf('cobweb', 'shears'));
okAv(!/cobweb|string/.test(dropOf('cobweb', 'stick')) && /string/.test(dropOf('cobweb', 'iron_sword')), 'cobweb + stick drops nothing, a sword string');
ok(/oak_leaves/.test(dropOf('oak_leaves', 'shears')), 'leaves + shears drop the leaves block: ' + dropOf('oak_leaves', 'shears'));
ok(/vine/.test(dropOf('vine', 'shears')), 'vine + shears drops vine');
say('3. useOnBlock: AbstractPlantStemBlock');
for (const b of ['kelp', 'weeping_vines', 'twisting_vines', 'cave_vines']) {
  const st = pAge(b, 3);
  const r = click(st, 'shears', { instabuild: false });
  ok(r.res && pName(r.after, 'age') === '25', `${b}: age 3 -> 25 (got ${pName(r.after, 'age')})`);
  const r2 = click(pAge(b, 25), 'shears', { instabuild: false });
  ok(pName(r2.after, 'age') === '25' && r2.P._stack.d === 0, `${b}: already max age is left alone, no wear`);
  const r3 = click(st, 'stick', { instabuild: false });
  okAv(pName(r3.after, 'age') === '3', `${b}: a stick does not age it`);
  ok(r.P._stack.d === 1, `${b}: shears take 1 damage (d=${r.P._stack.d})`);
}
function pAge(b, a) { let s = def(b); s = MCL.Behave.setProp ? MCL.Behave.setProp(s, 'age', String(a)) : s; return s; }
say('4. beehive');
{
  let h = def('beehive'); h = B.setProp(h, 'honey_level', '5');
  const r = click(h, 'shears', { instabuild: false });
  ok(r.res && pName(r.after, 'honey_level') === '0', 'shears on a full hive take the honey');
  const r2 = click(B.setProp(def('beehive'), 'honey_level', '4'), 'shears', { instabuild: false });
  okAv(pName(r2.after, 'honey_level') === '4', 'a not-full hive keeps its honey');
}
say(`   ${pass} ok`);
say('');
say('================== shearscheck ==================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` ${breaks} breaks caught`);
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
