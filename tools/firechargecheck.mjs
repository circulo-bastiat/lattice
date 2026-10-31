#!/usr/bin/env node
// firechargecheck.mjs — #186 G19eb: FireChargeItem.useOnBlock and FlintAndSteelItem.useOnBlock as
// two items (.decomp item/FireChargeItem.java, item/FlintAndSteelItem.java): a fire charge is
// CONSUMED (never damaged), plays item.firecharge.use, lights campfire/candle/candle cake and
// primes TNT; flint and steel takes 1 durability and plays item.flintandsteel.use; creative keeps both.
//   node tools/firechargecheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

console.log('firechargecheck — #186 G19eb: fire charge as its own item');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
  '14b_physics.js', '14f_inventory.js', '14l_use.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const R = MCL.Reg, S = MCL.States, B = MCL.Behave, U = MCL.Use, It = MCL.Items;

const N = 48, MID = 24, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const W = {
  getBlock: (x, y, z) => cells[idx(x, y, z)],
  setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; if (B.ready) B.changed(x, y, z); return true; },
  poke(x, y, z, id) { cells[idx(x, y, z)] = id; },
  blockLightAt: () => 15,
};
MCL.World = W; B.init(W); MCL.BlockEntities.init(); B.clearSchedule(); MCL.Redstone.init();
MCL.Entities.init(); MCL.EntityList.init(); U.init(W);

const played = [];
MCL.Sound = { play: (ev) => { played.push(ev); return true; } };
const put = (x, y, z, st) => W.setBlock(x, y, z, typeof st === 'string' ? S.stateOf(st) | 0 : st);
const nm = (st) => R.names[S.block[st]];
const litOf = (st) => B.propName(st, 'lit');
const UP = [0, 1, 2, 3, 4, 5].find((f) => MCL.CFG.FACE_DY[f] === 1);
function player(item, o) {
  const P = { instabuild: !!(o && o.creative), inventory: null, slot: 0, syncHotbar() {},
    heldItem() { return this._s; } };
  P._s = { i: It.of(item), n: 3, d: 0 };
  return P;
}
function reset() { cells.fill(0); B.clearSchedule(); MCL.EntityList.init(); played.length = 0; }

function useOn(item, block, o) {
  reset();
  put(0, 10, 0, 'stone');
  if (block !== 'stone') put(0, 11, 0, (block === 'campfire' || block === 'soul_campfire') ? B.setProp(S.stateOf(block) | 0, 'lit', false) : block);
  const P = player(item, o);
  const tgt = block === 'stone' ? [0, 10, 0] : [0, 11, 0];
  const st = W.getBlock(tgt[0], tgt[1], tgt[2]);
  let res = U.blockUse(P, tgt[0], tgt[1], tgt[2], st, P._s);
  if (!res) res = U.itemUseOn(P, tgt[0], tgt[1], tgt[2], UP, st, P._s);
  return { P, res, tgt, after: W.getBlock(tgt[0], tgt[1], tgt[2]), above: W.getBlock(tgt[0], tgt[1] + 1, tgt[2]) };
}

for (const item of ['fire_charge', 'flint_and_steel']) {
  const charge = item === 'fire_charge';
  const snd = charge ? 'item.firecharge.use' : 'item.flintandsteel.use';
  const cost = (r, creative) => charge ? r.P._s.n === (creative ? 3 : 2) : r.P._s.d === (creative ? 0 : 1);
  for (const blk of ['campfire', 'soul_campfire', 'candle', 'candle_cake']) {
    const r = useOn(item, blk);
    ok(r.res && litOf(r.after) === 'true', `${item} lights ${blk}`);
    ok(cost(r, false), `${item} on ${blk} pays ${charge ? 'one item' : 'one durability'}`);
    ok(played.join() === snd, `${item} on ${blk} plays ${snd} (got ${played})`);
    ok(cost(useOn(item, blk, { creative: true }), true), `creative ${item} on ${blk} pays nothing`);
  }
  const t = useOn(item, 'tnt');
  ok(t.after === 0 && MCL.EntityList.all().some((e) => e.type === 'tnt'), `${item} primes tnt`);
  ok(cost(t, false), `${item} on tnt pays ${charge ? 'one item' : 'one durability'}`);
  ok(cost(useOn(item, 'tnt', { creative: true }), true), `creative ${item} on tnt pays nothing`);
  const f = useOn(item, 'stone');
  ok(nm(f.above) === 'fire', `${item} sets fire on the clicked face`);
  ok(cost(f, false), `${item} on stone pays ${charge ? 'one item' : 'one durability'}`);
  ok(played.join() === snd, `${item} fire plays ${snd} (got ${played})`);
  ok(cost(useOn(item, 'stone', { creative: true }), true), `creative ${item} fire pays nothing`);
  // canBeLit refuses an already-lit campfire: it is a fire on top instead
  reset(); put(0, 10, 0, 'stone'); put(0, 11, 0, B.setProp(S.stateOf('campfire') | 0, 'lit', true));
  ok(!U.canBeLit(W.getBlock(0, 11, 0)), 'a lit campfire cannot be lit again');
  // waterlogged campfire / candle refuse
  ok(!U.canBeLit(B.setProp(B.setProp(S.stateOf('campfire') | 0, 'lit', false), 'waterlogged', true)), 'waterlogged campfire refuses');
  ok(!U.canBeLit(B.setProp(B.setProp(S.stateOf('candle') | 0, 'lit', false), 'waterlogged', true)), 'waterlogged candle refuses');
}
ok(U.OWED.join(' ').indexOf('fire charge,') < 0, 'Use.OWED no longer lists the fire charge');

// ── anti-vacuity: each rule, broken, changes the result ──
{
  const real = U.spendIgniter;
  U.spendIgniter = (P, s) => U.damage(P, s, 1);   // the old alias: durability for everything
  const r = useOn('fire_charge', 'campfire');
  okAv(r.P._s.n === 3, 'with fire charge treated as flint, the stack is NOT consumed — the count check sees it');
  U.spendIgniter = real;
  const realS = U.igniteSound; U.igniteSound = () => {};
  useOn('fire_charge', 'stone');
  okAv(played.length === 0, 'with the sound removed, no item.firecharge.use plays — the sound check sees it');
  U.igniteSound = realS;
  const realC = U.canBeLit; U.canBeLit = () => false;
  okAv(nm(useOn('flint_and_steel', 'campfire').after) === 'campfire' && litOf(useOn('flint_and_steel', 'campfire').after) !== 'true',
    'with canBeLit broken the campfire stays unlit — the lighting check sees it');
  U.canBeLit = realC;
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }

