#!/usr/bin/env node
// cauldronusecheck.mjs — G19eh: CauldronBehavior potion/washing rows (Use.blockUse), off .decomp CauldronBehavior.java.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('cauldronusecheck — water potion into cauldron, banner/dye/shulker washing');
const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '14b_physics.js', '14j_combat.js', '14f_inventory.js', '14l_use.js'], dom: false });
const AS = join(MCLITE_ROOT, 'assets');
E.Items.init({ items: readFileSync(join(AS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(AS, 'items.meta.json'), 'utf8')).rawBytes });
const S = E.States, U = E.Use, Iv = E.Inventory, IT = E.Items, R = E.Reg;
const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
E.World = W; E.Behave.init(W); U.init(W);
const lvl = () => { const st = cells.get(k(0, 10, 0)); return R.names[S.block[st]] === 'cauldron' ? 0 : S.propValue ? 0 : st; };
const nameAt = () => R.names[S.block[cells.get(k(0, 10, 0))]];
const water = (n) => S.withLocal('water_cauldron', n - 1);
const P = () => ({ inventory: Iv.create ? Iv.create() : null, slot: 0, x: 0, y: 11, z: 0 });
function run(setup, itemName, tag, count, fn) {
  setup();
  const p = P(); const it = { i: IT.of(itemName), n: count || 1 };
  const held = tag ? Iv.withTag(it, tag) : it;
  Iv.setItem(p.inventory, 0, held);
  const r = U.blockUse(p, 0, 10, 0, cells.get(k(0, 10, 0)), p.inventory ? Iv.getItem ? Iv.getItem(p.inventory, 0) : held : held);
  return { r, p };
}
const stackAt = (p) => (Iv.getItem ? Iv.getItem(p.inventory, 0) : p.inventory.slots[0]);
const wpot = { Potion: 'minecraft:water' };
const scenarios = () => {
  const out = [];
  let t = run(() => cells.set(k(0, 10, 0), S.stateOf('cauldron')), 'potion', wpot);
  out.push(['water potion fills empty cauldron, bottle returned', nameAt() === 'water_cauldron' && IT.nameOf(stackAt(t.p).i) === 'glass_bottle']);
  t = run(() => cells.set(k(0, 10, 0), water(2)), 'potion', wpot);
  out.push(['water potion tops up level 2 -> 3', cells.get(k(0, 10, 0)) === water(3)]);
  t = run(() => cells.set(k(0, 10, 0), water(1)), 'white_banner', { BlockEntityTag: { Patterns: [{ Pattern: 'bs', Color: 1 }] } });
  out.push(['banner wash empties level 1 and strips patterns', nameAt() === 'cauldron' && !(stackAt(t.p).t && stackAt(t.p).t.BlockEntityTag)]);
  t = run(() => cells.set(k(0, 10, 0), water(2)), 'leather_helmet', { display: { color: 255 } });
  out.push(['leather dye cleared, one level used', !stackAt(t.p).t && cells.get(k(0, 10, 0)) === water(1)]);
  t = run(() => cells.set(k(0, 10, 0), water(3)), 'red_shulker_box', { BlockEntityTag: { Items: [] } });
  out.push(['shulker box undyed, tag kept, one level used', IT.nameOf(stackAt(t.p).i) === 'shulker_box' && !!(stackAt(t.p).t && stackAt(t.p).t.BlockEntityTag) && cells.get(k(0, 10, 0)) === water(2)]);
  return out;
};
for (const [m, c] of scenarios()) ok(c, m);
// negatives: nothing happens
let t = run(() => cells.set(k(0, 10, 0), water(3)), 'potion', wpot);
ok(cells.get(k(0, 10, 0)) === water(3) && IT.nameOf(stackAt(t.p).i) === 'potion', 'full cauldron refuses water potion');
t = run(() => cells.set(k(0, 10, 0), S.stateOf('cauldron')), 'potion', { Potion: 'minecraft:swiftness' });
ok(nameAt() === 'cauldron', 'non-water potion refused');
t = run(() => cells.set(k(0, 10, 0), water(2)), 'leather_helmet');
ok(cells.get(k(0, 10, 0)) === water(2), 'undyed leather passes');
t = run(() => cells.set(k(0, 10, 0), water(2)), 'white_banner');
ok(cells.get(k(0, 10, 0)) === water(2), 'plain banner passes');
// precipitation fill (CauldronBlock/LeveledCauldronBlock.precipitationTick)
const Bh = E.Behave, P0 = () => 0, P1 = () => 0.99;
const precip = () => {
  const out = [];
  cells.set(k(0, 10, 0), S.stateOf('cauldron'));
  Bh.cauldronPrecipitation(0, 10, 0, 1, P0); out.push(['rain fills empty cauldron to level 1', cells.get(k(0, 10, 0)) === water(1)]);
  Bh.cauldronPrecipitation(0, 10, 0, 1, P0); out.push(['rain tops up to level 2', cells.get(k(0, 10, 0)) === water(2)]);
  cells.set(k(0, 10, 0), S.stateOf('cauldron'));
  Bh.cauldronPrecipitation(0, 10, 0, 2, P0); out.push(['snow fills empty cauldron with powder snow', nameAt() === 'powder_snow_cauldron']);
  return out;
};
for (const [m, c] of precip()) ok(c, m);
cells.set(k(0, 10, 0), water(3)); Bh.cauldronPrecipitation(0, 10, 0, 1, P0);
ok(cells.get(k(0, 10, 0)) === water(3), 'full cauldron unchanged by rain');
cells.set(k(0, 10, 0), S.stateOf('cauldron')); Bh.cauldronPrecipitation(0, 10, 0, 1, P1);
ok(nameAt() === 'cauldron', 'failed 0.05 roll leaves it empty');
cells.set(k(0, 10, 0), water(1)); Bh.cauldronPrecipitation(0, 10, 0, 2, P0);
ok(cells.get(k(0, 10, 0)) === water(1), 'snow does not top up a water cauldron');
const realP = Bh.cauldronPrecipitation; Bh.cauldronPrecipitation = () => false;
const brokenP = precip().filter(([, c]) => !c).length; Bh.cauldronPrecipitation = realP;
ok(brokenP === 3, 'all 3 precipitation scenarios fail without the behaviour');
// anti-vacuity: with blockUse disabled every positive scenario must fail
const real = U.blockUse; U.blockUse = () => false;
const broken = scenarios().filter(([, c]) => !c).length; U.blockUse = real;
ok(broken === 5, 'all 5 positive scenarios fail without the behaviour');
console.log(fails.length ? fails.join('\n') : '');
console.log(pass + ' passed, ' + fails.length + ' failed, ' + (broken + brokenP) + ' breaks caught');
process.exit(fails.length ? 1 : 0);
