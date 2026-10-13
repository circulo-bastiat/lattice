#!/usr/bin/env node
// usecheck.mjs — PLAN G19's acceptance: RIGHT-CLICK (D-361).
//
//   node tools/usecheck.mjs
//
// ⚠⚠ **WHAT THIS CHECK EXISTS TO PREVENT IS A GREEN SUITE OVER A GAME WHERE NO BLOCK RESPONDS
// TO A RIGHT-CLICK.** That is what shipped for nineteen stages: `Player.act`'s right button did
// one thing, `placeBlock`, so a door could be placed and never opened, a lever could be placed
// and never thrown, and G15's four redstone stages had no switch a hand could reach. Every one
// of the 1.18 M assertions in this suite was green throughout, because every one of them entered
// the system BELOW the input — the exact shape D-331 and D-339 paid for twice already.
//
// So this file asserts the PAIR every time: the interaction happens AND the thing it is supposed
// to be exclusive with does not. A door that opens is worth little if it also places the block
// in your hand into the doorway, and "it opened" alone cannot tell the two apart.
//
// ⚠ IT RUNS HEADLESS, over `behavcheck`'s flat-array world adapter, so the whole of G19 is
// testable without a browser. `inputcheck` is what proves the mouse button reaches it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { readdirSync, statSync, existsSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js',
               '07zze_oxidize.js', '07zx_particle.js'];
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

// ─────────────────────────────────────────────── 1. the layer is bound
say('1. the use layer is bound to the roster, the tags and the world');
{
  ok(U.ready, 'Use.init ran');
  ok(MCL.Tags.ready, 'the tag substrate is loaded — the families are read from it, not from name suffixes');
  ok(B.ready, 'the behaviour layer is bound, so a changed cell updates its neighbours');
  ok(IT.ready, 'the item table is decoded');
  // ⚠ D-351's rule, second use: six families are TAG lookups, and a missing tag payload would
  // make every one of them answer "no" with `ready` still true.
  ok(U.tagsReady, 'the tag substrate reports ready to `Use` itself');
  ok(U.tagFamilies.length === 0,
     `every tag family resolves a column (${U.tagFamilies.join(', ') || 'all six'})`);
  say(`   ${U.OWED.length} interactions named as owed`);
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. doors
say('\n2. a door opens, both halves, and an iron one does not');
{
  // ⚠ BOTH HALVES. The upper half is placed by the placement path (D-332) and must follow the
  // lower one when it opens, or every door in the game is half-open and looks like a mesher bug.
  W.clear();
  const lower = def('oak_door');
  const upper = B.setProp(lower, 'half', 'upper');
  W.poke(0, 0, 0, lower); W.poke(0, 1, 0, upper);
  const P = mkPlayer({});
  ok(U.rightClick(P) === 'block', 'a click on a door is consumed by the BLOCK');
  ok(pName(W.getBlock(0, 0, 0), 'open') === 'true', 'the lower half opened');
  ok(pName(W.getBlock(0, 1, 0), 'open') === 'true', 'and the upper half opened with it');
  const P2 = mkPlayer({});
  U.rightClick(P2);
  ok(pName(W.getBlock(0, 0, 0), 'open') === 'false'
     && pName(W.getBlock(0, 1, 0), 'open') === 'false', 'clicking again shuts both');

  const iron = click('iron_door');
  ok(iron.res === false, 'an IRON door refuses the hand — it is a MATERIAL check, not a name');
  ok(pName(iron.after, 'open') === 'false', 'and it really did not move');
  const it = click('iron_trapdoor');
  ok(it.res === false, 'and so does an iron trapdoor');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. the rest of the toggles
say('\n3. trapdoor, fence gate, lever, button, repeater, comparator');
{
  const td = click('oak_trapdoor');
  ok(td.res === 'block' && pName(td.after, 'open') === 'true', 'a trapdoor opens');

  const fg = click('oak_fence_gate');
  ok(fg.res === 'block' && pName(fg.after, 'open') === 'true', 'a fence gate opens');
  // ⚠ AND IT TURNS TO FACE YOU. Facing the gate's own facing means the gate would swing through
  // the player, so vanilla flips it first.
  W.clear();
  const gate = B.setProp(def('oak_fence_gate'), 'facing', 'north');
  W.poke(0, 0, 0, gate);
  const Pg = mkPlayer({ yaw: Math.PI });          // looking south, so the gate faces away
  U.rightClick(Pg);
  ok(pName(W.getBlock(0, 0, 0), 'facing') === 'south',
     `an opening gate turns to face the player (got ${pName(W.getBlock(0, 0, 0), 'facing')})`);

  const lv = click('lever');
  ok(lv.res === 'block' && pName(lv.after, 'powered') === 'true', 'a lever throws');
  const lv2 = click(B.setProp(def('lever'), 'powered', true));
  ok(lv2.res === 'block' && pName(lv2.after, 'powered') === 'false', 'and throws back');

  const bt = click('stone_button');
  ok(bt.res === 'block' && pName(bt.after, 'powered') === 'true', 'a button presses');
  // ⚠ A PRESSED BUTTON CONSUMES THE CLICK AND DOES NOT FALL THROUGH TO PLACEMENT.
  const bt2 = click(B.setProp(def('stone_button'), 'powered', true), 'stone');
  ok(bt2.res === 'block' && bt2.placeCalls === 0,
     'clicking a button that is already down consumes the click and does not place anything');

  const rp = click('repeater');
  ok(rp.res === 'block' && pName(rp.after, 'delay') === '2', 'a repeater steps its delay');
  const rp4 = click(B.setProp(def('repeater'), 'delay', 4));
  ok(pName(rp4.after, 'delay') === '1', 'and wraps from 4 back to 1');

  const cp = click('comparator');
  ok(cp.res === 'block' && pName(cp.after, 'mode') === 'subtract', 'a comparator toggles to subtract');
  const cp2 = click(B.setProp(def('comparator'), 'mode', 'subtract'));
  ok(pName(cp2.after, 'mode') === 'compare', 'and back to compare');

  // #477: RepeaterBlock/ComparatorBlock.onUse PASS when !allowModifyWorld (adventure) - nothing changes
  for (const nm of ['repeater', 'comparator']) {
    W.clear();
    W.poke(0, 0, 0, def(nm));
    const before = W.getBlock(0, 0, 0);
    const Pa = mkPlayer({}); Pa.mayBuild = false;
    U.rightClick(Pa);
    ok(W.getBlock(0, 0, 0) === before, `an adventure-mode player cannot change a ${nm}`);
    okAv(rp.after !== def('repeater') && cp.after !== def('comparator'),
         'the same click with mayBuild=true does change them - so the adventure assertion measured the guard');
  }

  // #475: RepeaterBlock.onUse plays NO sound; ComparatorBlock.onUse plays block.comparator.click, vol 0.3,
  // pitch 0.55 entering SUBTRACT else 0.5. Capture what Use hands NS.Sound.play.
  {
    const Snd = MCL.Sound || (MCL.Sound = {});
    const savedPlay = Snd.play, savedPlace = Snd.blockPlace;
    const played = [];
    Snd.play = (ev, o) => { played.push({ ev, o: o || {} }); return true; };
    Snd.blockPlace = () => { played.push({ ev: 'blockPlace', o: {} }); return true; };
    click('repeater');
    ok(played.length === 0, 'a repeater click is silent');
    click('comparator');
    const c1 = played[0];
    ok(played.length === 1 && c1.ev === 'block.comparator.click' && c1.o.volume === 0.3 && c1.o.pitch === 0.55,
       'a comparator entering subtract clicks: block.comparator.click, volume 0.3, pitch 0.55');
    played.length = 0;
    click(B.setProp(def('comparator'), 'mode', 'subtract'));
    const c2 = played[0];
    ok(played.length === 1 && c2.ev === 'block.comparator.click' && c2.o.volume === 0.3 && c2.o.pitch === 0.5,
       'a comparator leaving subtract clicks at pitch 0.5');
    okAv(c1 && c2 && c1.o.pitch !== c2.o.pitch, 'the two modes differ in pitch, so the pitch assertion measured the mode');
    Snd.play = savedPlay; Snd.blockPlace = savedPlace;
  }
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. the button comes back up
say('\n4. a pressed button unpresses on a SCHEDULED tick, at its own duration');
{
  // ⚠ 30 TICKS WOODEN, 20 STONE. One constant for both is wrong for half the roster, and a
  // button that never comes up at all is a circuit stuck on — which is why this is asserted
  // through `Behave.tick` rather than by calling `Use.buttonTick` directly (D-339's rule).
  const runFor = (n) => { for (let i = 0; i < n; i++) B.tick(); };
  W.clear(); B.clearSchedule();
  W.poke(0, 0, 0, def('stone_button'));
  U.rightClick(mkPlayer({}));
  ok(pName(W.getBlock(0, 0, 0), 'powered') === 'true', 'the stone button is down');
  runFor(19);
  ok(pName(W.getBlock(0, 0, 0), 'powered') === 'true', 'still down after 19 ticks');
  runFor(1);
  ok(pName(W.getBlock(0, 0, 0), 'powered') === 'false', 'and up on the 20th');

  W.clear(); B.clearSchedule();
  W.poke(0, 0, 0, def('oak_button'));
  U.rightClick(mkPlayer({}));
  runFor(20);
  ok(pName(W.getBlock(0, 0, 0), 'powered') === 'true', 'a WOODEN button is still down at 20');
  runFor(10);
  ok(pName(W.getBlock(0, 0, 0), 'powered') === 'false', 'and up at 30 — the two durations differ');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. the items
say('\n5. the hoe, the shovel, the axe, the buckets and the igniter');
{
  const hoe = click('grass_block', 'diamond_hoe');
  ok(hoe.res === 'item' && R.names[S.block[hoe.after]] === 'farmland', 'a hoe tills grass into farmland');
  // ⚠ COARSE DIRT GOES TO DIRT, NOT TO FARMLAND — vanilla's table, and the one everybody
  // reconstructs wrongly because "a hoe makes farmland" is the rule people remember.
  const coarse = click('coarse_dirt', 'diamond_hoe');
  ok(R.names[S.block[coarse.after]] === 'dirt', `coarse dirt goes to DIRT (got ${R.names[S.block[coarse.after]]})`);
  // ⚠ AND NOT THROUGH A BLOCK. The cell above must be air.
  W.clear(); W.poke(0, 0, 0, def('grass_block')); W.poke(0, 1, 0, def('stone'));
  const blocked = U.rightClick(mkPlayer({ stack: stackOf('diamond_hoe') }));
  ok(blocked === false && R.names[S.block[W.getBlock(0, 0, 0)]] === 'grass_block',
     'a hoe does nothing under a solid block');

  const sh = click('grass_block', 'diamond_shovel');
  ok(sh.res === 'item' && R.names[S.block[sh.after]] === 'dirt_path',
     `a shovel makes a path (got ${R.names[S.block[sh.after]]}) — the suffix length is why this once did nothing`);

  const ax = click('oak_log', 'diamond_axe');
  ok(ax.res === 'item' && R.names[S.block[ax.after]] === 'stripped_oak_log', 'an axe strips a log');
  // ⚠ AND KEEPS THE AXIS. A stripped log that snaps back to vertical is the tell that somebody
  // wrote `stateOf(name)` instead of carrying the property across.
  W.clear();
  W.poke(0, 0, 0, B.setProp(def('oak_log'), 'axis', 'x'));
  U.rightClick(mkPlayer({ stack: stackOf('diamond_axe') }));
  ok(pName(W.getBlock(0, 0, 0), 'axis') === 'x', 'and the stripped log keeps the axis it had');

  // s128 — AxeItem's scrape and wax-off branches, HoneycombItem's wax-on (07zze_oxidize.js)
  const nm = (st) => R.names[S.block[st]];
  const glowOf = (fn) => { MCL.Particle.clear(); const out = fn(); const k = new Set(MCL.Particle.list.map((q) => q.type)); out.glow = [...k].join(); return out; };
  const sc = glowOf(() => click('weathered_copper', 'diamond_axe'));
  ok(sc.res === 'item' && nm(sc.after) === 'exposed_copper', `an axe scrapes one oxidation tier (got ${nm(sc.after)})`);
  ok(sc.glow === 'scrape', `a scrape shows the 3005 scrape particles (got "${sc.glow}")`);
  W.clear();
  W.poke(0, 0, 0, B.setProp(B.setProp(def('oxidized_cut_copper_stairs'), 'facing', 'west'), 'half', 'top'));
  U.rightClick(mkPlayer({ stack: stackOf('diamond_axe') }));
  ok(nm(W.getBlock(0, 0, 0)) === 'weathered_cut_copper_stairs' && pName(W.getBlock(0, 0, 0), 'facing') === 'west' &&
     pName(W.getBlock(0, 0, 0), 'half') === 'top', 'a scraped stair keeps facing and half');
  const wo = glowOf(() => click('waxed_exposed_copper', 'diamond_axe'));
  ok(wo.glow === 'wax_off', `taking wax off shows the 3004 wax_off particles (got "${wo.glow}")`);
  ok(wo.res === 'item' && nm(wo.after) === 'exposed_copper', `an axe takes the wax off (got ${nm(wo.after)})`);
  const bare = click('copper_block', 'diamond_axe');
  okAv(nm(bare.after) === 'copper_block', 'an axe on bare unwaxed copper does nothing (no lower tier, no wax)');
  const hc = glowOf(() => click('weathered_cut_copper_slab', 'honeycomb', { instabuild: false }));
  ok(hc.glow === 'wax_on', `waxing shows the 3003 wax_on particles (got "${hc.glow}")`);
  okAv(glowOf(() => click('stone', 'honeycomb')).glow === '', 'honeycomb on stone shows no wax particles');
  ok(hc.res === 'item' && nm(hc.after) === 'waxed_weathered_cut_copper_slab', `honeycomb waxes copper (got ${nm(hc.after)})`);
  ok(hc.P._stack && (hc.P._stack.n | 0) === 0, `survival waxing spends the honeycomb (n=${hc.P._stack && hc.P._stack.n})`);
  const hcc = click('copper_block', 'honeycomb');
  ok(hcc.P._stack.n === 1 && nm(hcc.after) === 'waxed_copper_block', 'creative waxing keeps the honeycomb');
  ok(MCL.Oxidize.waxPairs() === 16, `all 16 UNWAXED_TO_WAXED pairs resolve in the registry (${MCL.Oxidize.waxPairs()})`);
  okAv(nm(click('waxed_copper_block', 'honeycomb').after) === 'waxed_copper_block', 'honeycomb on waxed copper does nothing');
  okAv(nm(click('stone', 'honeycomb').after) === 'stone', 'honeycomb on stone does nothing');

  const wb = click('stone', 'water_bucket');
  ok(wb.res === 'item' && R.names[S.block[wb.faceCell]] === 'water', 'a water bucket pours onto the clicked face');
  const lb = click('stone', 'lava_bucket');
  ok(R.names[S.block[lb.faceCell]] === 'lava', 'and a lava bucket pours lava');
  // an EMPTY bucket takes a SOURCE and nothing else
  const pick = click('water', 'bucket');
  ok(pick.res === 'item' && pick.after === 0, 'an empty bucket picks up a water SOURCE');
  const flowing = B.setProp(def('water'), 'level', 3);
  const noPick = click(flowing, 'bucket');
  ok(noPick.res === false && noPick.after !== 0, 'and refuses FLOWING water, which is level != 0');

  // ⚠ THE IGNITER IS A BLOCK USE ON TNT AND AN ITEM USE ON AIR — two different code paths, and
  // putting the TNT case on the item side sets a fire on top of the TNT instead of priming it.
  const tnt = click('tnt', 'flint_and_steel');
  ok(tnt.res === 'block' && tnt.after === 0, 'flint and steel PRIMES tnt — the block goes away');
  ok(MCL.EntityList.all().filter((e) => e.type === 'tnt').length >= 1, 'and a primed tnt entity exists');
  const candle = click('candle', 'flint_and_steel');
  ok(candle.res === 'block' && pName(candle.after, 'lit') === 'true', 'and lights a candle');
  // #536: CakeBlock.onUse candle -> candle cake; CandleBlock/CandleCakeBlock.onUse empty-hand extinguish; eating a candle cake
  const cc = click('cake', 'candle');
  ok(cc.res === 'block' && R.names[S.block[cc.after]] === 'candle_cake', 'a candle on a cake makes a candle_cake');
  const lit = B.setProp(def('candle'), 'lit', true);
  const ext = click(lit, null);
  ok(ext.res === 'block' && pName(ext.after, 'lit') === 'false', 'an empty hand extinguishes a lit candle');
  const litCake = B.setProp(def('candle_cake'), 'lit', true);
  const extC = click(litCake, null);
  ok(extC.res === 'block' && pName(extC.after, 'lit') === 'false' && R.names[S.block[extC.after]] === 'candle_cake', 'and a lit candle cake');
  const eatC = click('candle_cake', null, { instabuild: true });
  ok(eatC.res === 'block' && R.names[S.block[eatC.after]] === 'cake' && pName(eatC.after, 'bites') === '1', 'eating a candle cake leaves a bitten plain cake');
  const fire = click('stone', 'flint_and_steel');
  ok(fire.res === 'item' && R.names[S.block[fire.faceCell]] === 'fire', 'and sets a fire on a stone face');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. the order, which is the architecture
say('\n6. the ORDER: block use, then item useOn, then placement — and the sneak clause');
{
  // A door with a block in hand OPENS; it does not place.
  const d = click('oak_door', 'stone');
  ok(d.res === 'block' && d.placeCalls === 0,
     'a door with a block in hand OPENS and does not place — the exclusion is the whole point');
  // ...unless you are crouching, which is how you build against furniture.
  const dc = click('oak_door', 'stone', { crouching: true });
  ok(dc.res === 'place' && dc.placeCalls === 1,
     'crouching with a block in hand SKIPS the door and places');
  ok(pName(W.getBlock(0, 0, 0), 'open') === 'false', 'and the door did not open while crouching');
  // crouching with EMPTY hands still uses the block — vanilla's `|| hands are empty`
  const de = click('oak_door', null, { crouching: true });
  ok(de.res === 'block', 'crouching with EMPTY hands still opens the door');
  // an ordinary block with a block in hand falls through to placement
  const pl = click('stone', 'stone');
  ok(pl.res === 'place' && pl.placeCalls === 1, 'a plain block falls through to placement');
  // and an item whose useOn consumed the click never reaches placement
  const hoe2 = click('grass_block', 'diamond_hoe');
  ok(hoe2.placeCalls === 0, 'a hoe that tilled does not also place');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. durability, and creative
say('\n7. a tool spends durability, and creative does not');
{
  W.clear(); W.poke(0, 0, 0, def('grass_block'));
  const P = mkPlayer({ stack: stackOf('diamond_hoe'), instabuild: false });
  P.inventory = {};
  MCL.Inventory.setItem = MCL.Inventory.setItem || function () {};
  U.rightClick(P);
  ok(P._stack.d === 1, `a survival hoe took one point of damage (d=${P._stack.d})`);

  W.clear(); W.poke(0, 0, 0, def('grass_block'));
  const C = mkPlayer({ stack: stackOf('diamond_hoe'), instabuild: true });
  U.rightClick(C);
  ok((C._stack.d | 0) === 0, 'and a creative one took none');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────── 7b. spawn eggs, for real — G18c (D-393)
say('\n7b. a spawn egg for a type EL can simulate really spawns it, and consumes itself');
{
  const before = MCL.EntityList.count();
  const P = mkPlayer({ stack: stackOf('cow_spawn_egg'), instabuild: false });
  P.tface = 2;                                       // clicking the TOP face
  W.clear(); W.poke(0, 0, 0, def('grass_block'));
  const res = U.rightClick(P);
  ok(res === 'item', `a cow egg on grass spawns — rightClick returned ${JSON.stringify(res)}`);
  ok(MCL.EntityList.count() === before + 1, 'the entity list actually grew by one');
  const spawned = MCL.EntityList.all().slice(-1)[0];
  ok(!!spawned && spawned.type === 'cow', `the new entity is a cow (${spawned && spawned.type})`);
  // vanilla's SpawnEggItem.useOn: the mob's feet land on the clicked FACE, not inside the block
  ok(Math.abs(spawned.y - 1) < 1e-9, `it stands on the clicked face, not inside it (y=${spawned.y})`);
  ok((P._stack.n | 0) === 0, `a survival egg consumed itself (n=${P._stack.n})`);

  const C = mkPlayer({ stack: stackOf('cow_spawn_egg'), instabuild: true });
  C.tface = 2;
  const beforeC = MCL.EntityList.count();
  U.rightClick(C);
  ok(MCL.EntityList.count() === beforeC + 1, 'a creative egg spawns too');
  ok((C._stack.n | 0) === 1, `and a creative one kept its stack (n=${C._stack.n})`);
}
say(`   ${pass} ok`);

// ─────────────────────────────────────── 7c. SpawnEggItem whole — s119 (.decomp SpawnEggItem/EntityType)
say('\n7c. spawn eggs: useOnBlock position + getOriginY + yaw, use() into a fluid, spawnBaby');
{
  const EL = MCL.EntityList;
  const last = () => EL.all().slice(-1)[0];
  const eggAt = (block, face, egg, below) => {
    W.clear(); if (below) W.poke(0, -1, 0, def(below)); W.poke(0, 0, 0, def(block));
    const P = mkPlayer({ stack: stackOf(egg || 'cow_spawn_egg'), instabuild: true });
    P.tface = face; const n0 = EL.count(); const r = U.rightClick(P);
    return { r, spawned: EL.count() === n0 + 1 ? last() : null };
  };
  // a bottom slab: invertY (moved, face UP) drops the cow onto the slab's own top, y = 0.5
  const slab = eggAt('oak_slab', 2);
  ok(slab.spawned && Math.abs(slab.spawned.y - 0.5) < 1e-9, `an egg on a bottom slab stands ON it (getOriginY) — y=${slab.spawned && slab.spawned.y}`);
  // a collision-empty block (tall grass): the mob goes INTO the clicked cell
  const grass = eggAt('grass', 2, 'cow_spawn_egg', 'grass_block');
  ok(grass.spawned && Math.abs(grass.spawned.y - 0) < 1e-9 && Math.abs(grass.spawned.x - 0.5) < 1e-9,
     `an egg on tall grass spawns in the grass's own cell (y=${grass.spawned && grass.spawned.y})`);
  // a side face: the neighbour cell, not inverted
  const side = eggAt('stone', 4);
  const fx = MCL.CFG.FACE_DX[4], fz = MCL.CFG.FACE_DZ[4];
  ok(side.spawned && Math.abs(side.spawned.x - (fx + 0.5)) < 1e-9 && Math.abs(side.spawned.z - (fz + 0.5)) < 1e-9 && Math.abs(side.spawned.y) < 1e-9,
     `an egg on a stone SIDE spawns in the face's neighbour at the same y (${side.spawned && [side.spawned.x, side.spawned.y, side.spawned.z]})`);
  // yaw: wrapDegrees(random*360), in radians, head = body
  const yaws = [];
  for (let i = 0; i < 12; i++) { const e = eggAt('stone', 2).spawned; if (e) yaws.push(e.yaw); ok(e && e.yHeadRot === e.yaw, 'head yaw = body yaw'); }
  ok(yaws.every(y => y >= -Math.PI - 1e-9 && y < Math.PI + 1e-9) && new Set(yaws.map(y => y.toFixed(6))).size > 6,
     `egg yaws are random over the full turn (${yaws.length} spawns, ${new Set(yaws.map(y => y.toFixed(6))).size} distinct)`);
  // anti-vacuity: the same slab WITHOUT invertY would leave the cow floating at y=1
  W.clear(); W.poke(0, 0, 0, def('oak_slab'));
  okAv(Math.abs(U.eggOriginY(0, 1, 0, 0.9, false) - (-0.5)) > 1e-9, 'a non-inverted origin over a slab differs from the inverted one — the slab assertion can fail');
  // use(): air-click into a water SOURCE spawns there, y exactly the fluid cell; a flowing cell refuses
  const fluidClick = (st) => {
    W.clear(); W.poke(0, -1, 0, st);
    const P = mkPlayer({ stack: stackOf('squid_spawn_egg'), instabuild: false });
    P.hasTarget = false; P.ex = 0.5; P.ey = 1; P.ez = 0.5; P.EYE = 0.62; P.reach = 5;
    P.lookVec = () => [0, -1, 0];
    const n0 = EL.count(); const r = U.rightClick(P);
    return { r, n: EL.count() - n0, e: last(), P };
  };
  const src = fluidClick(def('water'));
  ok(src.r === 'use' && src.n === 1 && src.e.type === 'squid' && Math.abs(src.e.y - (-1)) < 1e-9,
     `a squid egg aimed at a water source spawns a squid IN it (r=${src.r}, y=${src.e && src.e.y})`);
  ok((src.P._stack.n | 0) === 0, 'and the survival egg is spent');
  const flowSt = S.stateOf ? (() => { for (let st = def('water'); st < def('water') + 16; st++) if (S.block[st] === S.block[def('water')] && pName(st, 'level') && pName(st, 'level') !== '0') return st; return -1; })() : -1;
  if (flowSt > 0) {
    const fl = fluidClick(flowSt);
    ok(fl.r === false && fl.n === 0, 'a flowing (non-source) water cell is not a SOURCE_ONLY hit — nothing spawns');
  }
  // spawnBaby: an egg of the SAME type on a mob makes a baby at its position
  W.clear(); W.poke(0, -1, 0, def('stone'));
  const cow = EL.spawn('cow', 3.5, 0, 3.5);
  const Pb = mkPlayer({ stack: stackOf('cow_spawn_egg'), instabuild: false });
  const n0 = EL.count();
  ok(U.entityUse(Pb, cow, Pb._stack) === true && EL.count() === n0 + 1, 'a cow egg on a cow makes one more mob');
  const baby = last();
  ok(baby.type === 'cow' && (baby.growAge | 0) < 0 && baby.x === cow.x && baby.z === cow.z && baby.yaw === 0,
     `it is a baby cow at the parent's position, yaw 0 (age ${baby.growAge})`);
  ok((Pb._stack.n | 0) === 0, 'the survival egg is spent');
  const zb = EL.spawn('zombie', 6.5, 0, 6.5);
  ok(U.spawnEggBaby(mkPlayer({ instabuild: true }), zb, stackOf('zombie_spawn_egg')) === true && (last().growAge | 0) < 0 && last().type === 'zombie',
     'a zombie egg on a zombie makes a baby zombie (ZombieEntity overrides setBaby)');
  const sk = EL.spawn('skeleton', 8.5, 0, 8.5);
  ok(U.spawnEggBaby(mkPlayer({ instabuild: true }), sk, stackOf('skeleton_spawn_egg')) === false, 'a skeleton cannot be a baby — PASS');
  ok(U.spawnEggBaby(mkPlayer({ instabuild: true }), cow, stackOf('pig_spawn_egg')) === false, 'a pig egg on a cow is not the same type — PASS');
  // referee: the baby lists are re-derived from .decomp's own class tree (rule 3/4)
  const DEC = join(ROOT, '.decomp', 'net', 'minecraft', 'entity');
  if (existsSync(DEC)) {
    const files = {}, ext = {};
    const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.java')) files[f.slice(0, -5)] = readFileSync(p, 'utf8'); } };
    walk(DEC);
    for (const [c, src2] of Object.entries(files)) { const m = src2.match(/public (?:abstract )?class (\w+)(?:<[^>]*>)? extends (\w+)/); if (m) ext[m[1]] = m[2]; }
    const anc = (c) => { const o = []; while (ext[c]) { c = ext[c]; o.push(c); } return o; };
    const snake = (c) => c.replace(/Entity$/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    const passive = [], setb = [], nullc = [];
    for (const [c, src2] of Object.entries(files)) {
      if (!c.endsWith('Entity') || /public abstract class/.test(src2)) continue;
      const a = anc(c);
      if (a.includes('PassiveEntity')) {
        const m = src2.match(/createChild\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
        if (m && /return null/.test(m[1]) && (m[1].match(/return/g) || []).length === 1) nullc.push(snake(c)); else passive.push(snake(c));
      } else if (/public void setBaby\(boolean/.test(src2) || a.some(x => !['MobEntity', 'PassiveEntity', 'LivingEntity'].includes(x) && /public void setBaby\(boolean/.test(files[x] || ''))) setb.push(snake(c));
    }
    const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    ok(eq(passive, U.EGG_BABY_PASSIVE), `Use.EGG_BABY_PASSIVE matches .decomp's PassiveEntity tree (${passive.sort().join(',')})`);
    ok(eq(setb, U.EGG_BABY_SETBABY), `Use.EGG_BABY_SETBABY matches .decomp's setBaby overrides (${setb.sort().join(',')})`);
    ok(eq(nullc, U.EGG_BABY_NULLCHILD), `Use.EGG_BABY_NULLCHILD matches .decomp's null createChild (${nullc.sort().join(',')})`);
    okAv(!eq(passive.concat(['skeleton']), U.EGG_BABY_PASSIVE), 'an extra type in the derived list is caught');
  }
  // anti-vacuity: unhook the entityUse join -> the cow-on-cow must stop making a baby
  const realB = U.spawnEggBaby; U.spawnEggBaby = () => false;
  const Pc = mkPlayer({ stack: stackOf('cow_spawn_egg'), instabuild: true }); const nb = EL.count();
  U.entityUse(Pc, cow, Pc._stack);
  okAv(EL.count() === nb, 'with spawnEggBaby unhooked, entityUse makes no baby — the join assertion can fail');
  U.spawnEggBaby = realB;
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 8. the owed list, held closed
say('\n8. every interaction this engine does NOT have is named, and really does nothing');
{
  ok(U.OWED.length >= 8, `${U.OWED.length} owed interactions are named`);
  // ⚠ A STAGE NAME, NOT JUST A DASH. The first version accepted any hyphen, so an entry that
  // named no owner passed on the strength of the word "name-tag" in it.
  const unnamed = U.OWED.filter((s) => !/\bG\d+[a-z]?\b|EntityList\.owed/.test(s));
  ok(unnamed.length === 0, `every owed entry names the stage it waits for (${unnamed.join(' | ')})`);
  // ⚠ AND THE NAMED ONES ARE REALLY ABSENT. An entry that quietly started working is a stale
  // promise, and a reader who trusts it will not look again (D-324's rule, third use).
  // D-396: skeleton is now spawnable, so its own egg no longer demonstrates the refusal.
  // D-401: spider joined it — squid (still fully owed, EL.owed()) demonstrates the refusal now.
  // s98: squid joined too; s99: fox/goat/polar bear/fish joined; loop/silverfish: silverfish
  // joined too — ghast (still fully owed, EL.owed()) demonstrates the refusal now.
  // s135: ghast joined too — shulker (still fully owed) demonstrated the refusal after that.
  // cloud unit (confident-lamport-asj6ue): shulker is spawnable now too (07i_entitylist.js), and
  // it is the LAST swap this chain can make — wither and ender_dragon have never had a spawn egg
  // in vanilla at all (14l_use.js's own OWED entry above), so no future mob stage, however far it
  // gets `EL.canSpawn` (cloud unit confident-lamport-mdnl4x already made `EL.canSpawn('wither')`
  // true, motion substrate only), can ever hand this test a real egg to demonstrate the refusal
  // with. FORCING the refusal (the same shape §7c's `spawnEggBaby` unhook already uses)
  // tests Use.entityUse's own gate instead of a mob this project happens not to have built yet.
  const EL = MCL.EntityList;
  const realCanSpawn = EL.canSpawn;
  EL.canSpawn = (t) => (t === 'shulker' ? false : realCanSpawn(t));
  const forcedRefusal = click('dirt', 'shulker_spawn_egg');
  okAv(forcedRefusal.res === false, 'with EL.canSpawn forced false for a real egg\'s type, the click still refuses — the refusal path itself, not a coincidence of an unbuilt mob, can fail');
  ok(U.lastRefusal && /D-307/.test(U.lastRefusal),
     `and it SAYS so rather than being silent (${U.lastRefusal})`);
  EL.canSpawn = realCanSpawn;
  const shulkeregg = click('dirt', 'shulker_spawn_egg');
  ok(shulkeregg.res !== false, 'and with EL.canSpawn restored, a real shulker egg now actually works (cloud unit, EL.canSpawn extended to shulker)');
  const skelegg = click('dirt', 'skeleton_spawn_egg');
  ok(skelegg.res !== false, 'a skeleton spawn egg now actually works (D-396, EL.canSpawn extended)');
  const spideregg = click('dirt', 'spider_spawn_egg');
  ok(spideregg.res !== false, 'and a spider spawn egg now actually works too (D-401, EL.canSpawn extended again)');
  const chest = click('chest', null);
  ok(chest.res === false, 'a chest still opens nothing — G19b');
  // D-403: the barrel dispatches through the exact same `Hud.openChest` gate as a chest, so in
  // THIS harness (no `NS.Hud` wired at all) it must fail the same way, for the same reason —
  // `Hd && Hd.openChest && ...` short-circuits before `be.type` is ever read.
  const barrel = click('barrel', null);
  ok(barrel.res === false, 'a barrel dispatches through the same Hud.openChest gate as a chest, and fails the same way headless — real behaviour is chestcheck.mjs\'s province (D-403)');
  // D-404: the ender chest dispatches through the SAME gate too — again failing here for the
  // same `Hd && Hd.openChest` short-circuit, before `be.type` (let alone the shared-inventory
  // rebind) is ever reached. The rebind itself is enderchestcheck.mjs's province, the way the
  // barrel's own menu equivalence is chestcheck.mjs's.
  const enderChest = click('ender_chest', null);
  ok(enderChest.res === false, 'an ender chest dispatches through the same Hud.openChest gate too, and fails the same way headless — real behaviour is enderchestcheck.mjs\'s province (D-404)');
  // D-414: the three furnaces dispatch by BLOCK-ENTITY TYPE to `Hud.openFurnace`. A stub Hud
  // records the call, so this proves the ROUTE (x/y/z, and that all three blocks take it) and
  // nothing about the screen — that is furnacecheck.mjs's province. Anti-vacuity: with the stub
  // answering false the click is not consumed, and a stone block never reaches the stub at all.
  {
    const savedHud = MCL.Hud, calls = [];
    MCL.Hud = { openFurnace: (x, y, z) => { calls.push([x, y, z]); return true; } };
    for (const b of ['furnace', 'blast_furnace', 'smoker']) {
      calls.length = 0;
      const r = click(b, null);
      ok(r.res === 'block' && calls.length === 1 && calls[0].join() === '0,0,0',
         `a ${b} routes the click to Hud.openFurnace(0,0,0) and consumes it (${JSON.stringify(calls)})`);
    }
    calls.length = 0;
    click('stone', null);
    ok(calls.length === 0, 'a stone block never reaches Hud.openFurnace');
    MCL.Hud = { openFurnace: () => false };
    const refused = click('furnace', null);
    ok(refused.res === false, 'and when the screen refuses to open, the click is NOT consumed (anti-vacuity: the result is the opener is, not a constant true)');
    MCL.Hud = savedHud;
  }
  // loop/beds-s116: STRUCK -- a bed's own dispatch is `Sleep.use` now (14m_sleep.js), which
  // this headless harness does not load (EXTRA above has no 14m_sleep.js), so `Use.blockUse`'s
  // own `NS.Sleep && NS.Sleep.ready && ...` guard still answers false here for a different
  // reason than before — the same "stub answers false" shape the furnace/chest sections just
  // above already use. `bedcheck.mjs` is the real behaviour's own province.
  const bed = click('red_bed', null);
  ok(bed.res === false, 'a bed click does nothing in a harness with no Sleep module wired');
}
say(`   ${pass} ok`);

// ─────────────────────────────────────────────── 9. anti-vacuity
say('\n9. anti-vacuity: break it, and it must be caught');
{
  // ⚠ D-30: a break that cannot fire is not a break. Each of these disables exactly one rule and
  // asserts the assertion above it would have failed.
  const savedDoors = MCL.Tags.blockTag('doors');
  ok(savedDoors >= 0, 'the doors tag resolves — otherwise §2 was vacuous');

  // (a) an unbound Use does nothing at all
  U.ready = false;
  okAv(U.rightClick(mkPlayer({})) === false, 'with Use unbound, a click does nothing');
  U.ready = true;

  // (b) the sneak clause really is what routes the click
  W.clear(); W.poke(0, 0, 0, def('oak_door'));
  const a = U.rightClick(mkPlayer({ stack: stackOf('stone'), crouching: false }));
  W.clear(); W.poke(0, 0, 0, def('oak_door'));
  const b = U.rightClick(mkPlayer({ stack: stackOf('stone'), crouching: true }));
  okAv(a === 'block' && b === 'place', `the same click routes two ways on the sneak flag (${a} vs ${b})`);

  // (c) the button's schedule is what brings it back up, not a timer
  W.clear(); B.clearSchedule();
  W.poke(0, 0, 0, def('stone_button'));
  U.rightClick(mkPlayer({}));
  for (let i = 0; i < 200; i++) { /* no B.tick() at all */ }
  okAv(pName(W.getBlock(0, 0, 0), 'powered') === 'true',
       'without a scheduled tick the button stays down — so §4 measured the scheduler');

  // (d) the family test is the TAG, not the name
  okAv(MCL.Tags.stateInCol(savedDoors, def('iron_door')),
       'iron_door IS in the doors tag — so §2 refusing it is a material rule and not a tag miss');
}
say(`   ${pass} ok`);

say('');
say('================== usecheck ==================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say(` owed interactions .. ${U.OWED.length}`);
say('==============================================');
for (const f of fails) say('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
