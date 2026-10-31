#!/usr/bin/env node
// brewtickcheck.mjs — BrewingStandBlockEntity.tick: fuel, 400-tick timer, craft, bottle states, hopper sides.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
  '14g_menu.js', '07q_effects.js', '07z_potion.js', '07zzq_brewing.js', '07_world.js', '07b_behaviour.js',
  '07c_blockentity.js', '07f_redstone.js', '14b_physics.js', '07i_entitylist.js', '13_input.js', '15b_gui.js', '15_hud.js'];

let pass = 0; let fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => ok(c, 'key: ' + m);

function run(mode) {
  const MCL = loadEngine({ extra: EXTRA, dom: false });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  MCL.BlockEntities.init();
  const Inv = MCL.Inventory, BE = MCL.BlockEntities, Br = MCL.Brewing;
  if (mode === 'norecipe') Br.hasRecipe = () => false;
  const water = () => Inv.stack('potion', 1, 0, { Potion: 'minecraft:water' });
  const nm = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));
  const mk = () => {
    BE.clear(); const e = BE.create(0, 4, 0, 'brewing_stand');
    e.items[0] = water(); e.items[1] = water(); e.items[2] = water();
    e.items[3] = Inv.stack('nether_wart', 2); e.items[4] = Inv.stack('blaze_powder', 3);
    return e;
  };
  const e = mk();
  let first = -1;
  for (let t = 1; t <= 401; t++) {
    BE.tick();
    if (t === 1) { ok(e.brewTime === 400 && e.fuel === 19 && e.items[4].n === 2, 'tick 1: fuel 20 -1, brewTime 400, one blaze powder used'); }
    if (first < 0 && Br.potionOf(e.items[0]) !== 'water') first = t;
  }
  const kinds = e.items.slice(0, 3).map((s) => Br.potionOf(s));
  const fin = e.brewTime === 0 && kinds.every((k) => k === 'awkward') && e.fuel === 19 && e.items[3].n === 1;
  okAv(first === 401 && fin, 'three awkward after exactly 400 ticks of countdown (tick 1 arms it), one fuel (got first=' + first + ' ' + kinds + ' fuel=' + e.fuel + ')');
  // cancel: ingredient removed mid-brew
  const c = mk(); for (let t = 0; t < 10; t++) BE.tick();
  c.items[3] = null; BE.tick();
  ok(c.brewTime === 0, 'taking the ingredient away cancels the countdown');
  // no fuel, no brew
  const d = mk(); d.items[4] = null; BE.tick();
  ok(d.brewTime === 0 && d.fuel === 0, 'no blaze powder, no brewing');
  // hopper sides
  const top = BE.hopperSlotsFor('brewing_stand', 0), side = BE.hopperSlotsFor('brewing_stand', 2);
  const may = (slot, n) => BE.hopperMayPlace ? BE.hopperMayPlace(e, slot, Inv.stack(n, 1)) : true;
  okAv(top.length === 1 && top[0] === 3 && !side.includes(3) && side.includes(4), 'hopper from the top reaches only the ingredient slot');
  ok(BE.hopperSlotsFor('brewing_stand', 1).join() === '0,1,2,3', 'from below: bottles + ingredient');
  // bottle block state
  const B = MCL.Behave;
  if (B) {
    const cells = {}; let props = [];
    B.w = { get: () => 7, set: (x, y, z, v) => { cells.v = v; } };
    B.setProp = (st, k, v) => { props.push(k + '=' + v); return st; };
    const f = mk(); f.items[1] = null; BE.tick();
    ok(props.join() === 'has_bottle_0=true,has_bottle_1=false,has_bottle_2=true', 'bottle states follow slots: ' + props.join());
  }
  return fails;
}
let real = run('real'); real = real.slice();
fails = [];
const broken = run('norecipe');
const caught = broken.filter((f) => f.startsWith('key: ')).length;
real.forEach((f) => console.log('FAIL ' + f));
console.log(`${pass} assertions, ${real.length} failures, ${caught} breaks caught`);
process.exit(real.length === 0 && caught >= 1 ? 0 : 1);
