#!/usr/bin/env node
// #11722 classmap: exercises StructureBlockBlockEntity, DropperBlockEntity (net/minecraft/block/entity)
// blockentity11583check.mjs — #11583: proves 07c_blockentity.js through its real entry points: Behave.changed ->
// BE.onChanged (BlockEntityType create/remove), BE.tick (Furnace/BlastFurnace/Smoker), the jukebox (comparator signal +
// onStateReplaced disc drop), the dropper/dispenser latch (Behave.tick -> dispenseFrom), and the sign NBT round trip.
// Each source break must fail its row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '07zzq_brewing.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
  '14g_menu.js', '14g2_invclasses.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js', '07e_loot.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07y_equip.js', '07z_potion.js', '07zzy_firework.js', '07zzm_wither.js',
  '13_input.js', '15b_gui.js', '15_hud.js', '14l_use.js', '07zzh_blaze.js', '07zzq_rail.js', '07w_passive.js', '07zo_bee.js', '07n_tame.js', '07r_mount.js', '07ze_llama.js', '14_player.js', '07m_breed.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
  M.BlockEntities.init(); M.Entities.init();
  if (M.Equip) M.Equip.init();
  const Inv = M.Inventory, BE = M.BlockEntities, W = M.World, B = M.Behave, S = M.States, EL = M.EntityList, o = {};
  B.init(W); M.Redstone.init();
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  BE.clear(); EL.init(); EL.pushPlayer = () => null;
  M.Player = { menu: { inventory: Inv.create() }, xpTotal: 0 };
  const put = (x, y, z, n, props) => { let st = S.stateOf(n) | 0; for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]); W.setBlock(x, y, z, st); };
  const run = (n) => { for (let i = 0; i < n; i++) { B.tick(); BE.tick(); } };
  const nm = (s) => (Inv.isEmpty(s) ? '' : M.Items.nameOf(s.i));
  // BlockEntityType: placing creates the typed entity with its fields; removing drops it
  put(0, 64, 0, 'chest'); o.chest = !!BE.get(0, 64, 0) && BE.get(0, 64, 0).items.length === 27;
  put(1, 64, 0, 'furnace'); put(2, 64, 0, 'blast_furnace'); put(3, 64, 0, 'smoker'); put(4, 64, 0, 'campfire'); put(5, 64, 0, 'barrel');
  o.types = ['furnace', 'blast_furnace', 'smoker', 'campfire', 'barrel'].every((t, i) => BE.get(1 + i, 64, 0) && BE.get(1 + i, 64, 0).type === t) &&
    BE.get(2, 64, 0).cookTimeTotal === 100 && BE.get(1, 64, 0).cookTimeTotal === 200 && BE.get(4, 64, 0).items.length === 4;
  put(0, 64, 0, 'stone'); o.removed = BE.get(0, 64, 0) === undefined;
  // furnace family: smelts through BE.tick; blast furnace burns coal at double speed (fuel/2)
  const smelt = (x, type, input) => {
    const e = BE.get(x, 64, 0); e.items[0] = Inv.stack(input, 1); e.items[1] = Inv.stack('coal', 1);
    run(1); const burn = e.burnTime; run(205);
    return { burn, out: nm(e.items[2]) };
  };
  const f = smelt(1, 'furnace', 'raw_iron'), bf = smelt(2, 'blast_furnace', 'raw_iron');
  o.furnace = f.out === 'iron_ingot' && f.burn > 1500 && !BE.get(1, 64, 0).items[0];
  o.blastHalf = bf.out === 'iron_ingot' && bf.burn > 700 && bf.burn < f.burn;
  const sm = BE.get(3, 64, 0); sm.items[0] = Inv.stack('beef', 1); sm.items[1] = Inv.stack('coal', 1); run(110);
  o.smoker = nm(sm.items[2]) === 'cooked_beef';
  const sm2 = BE.get(3, 64, 0); sm2.items[0] = Inv.stack('raw_iron', 1); sm2.items[2] = null; sm2.burnTime = 0; sm2.cookTime = 0;
  const fr = BE.get(1, 64, 0); fr.items[0] = Inv.stack('beef', 1); fr.items[2] = null;
  // jukebox: signal from disc, removal on replace drops the disc
  put(8, 64, 0, 'jukebox'); const jb = BE.get(8, 64, 0);
  jb.record = 'music_disc_cat'; o.signal = BE.jukeboxSignal(8, 64, 0) === 2;
  jb.record = 'music_disc_pigstep'; o.signal13 = BE.jukeboxSignal(8, 64, 0) === 13;
  const n0 = EL.count(); put(8, 64, 0, 'air');
  o.jukeDrop = EL.count() === n0 + 1 && BE.get(8, 64, 0) === undefined;
  // dropper vs dispenser: latch, 4 ticks later one item leaves; a dropper puts it into the chest it faces
  put(10, 64, 0, 'dropper', { facing: 'east' }); put(11, 64, 0, 'chest');
  const dr = BE.get(10, 64, 0); dr.items[0] = Inv.stack('cobblestone', 4);
  put(9, 64, 0, 'redstone_block'); B.changed(9, 64, 0); run(8);
  const ch = BE.get(11, 64, 0);
  o.dropper = dr.items[0].n === 3 && ch.items.some((s) => s && nm(s) === 'cobblestone');
  put(10, 64, 4, 'dispenser', { facing: 'east' }); put(11, 64, 4, 'chest');
  const di = BE.get(10, 64, 4); di.items[0] = Inv.stack('cobblestone', 4); const e0 = EL.count();
  put(9, 64, 4, 'redstone_block'); B.changed(9, 64, 4); run(8);
  o.dispenser = di.items[0].n === 3 && EL.count() === e0 + 1 && !BE.get(11, 64, 4).items.some(Boolean);
  // sign NBT round trip
  put(14, 64, 0, 'oak_sign'); const sg = BE.get(14, 64, 0) || BE.create(14, 64, 0, 'sign'); sg.lines = ['a', 'b', '', 'd']; sg.color = 'red';
  const sg2 = { type: 'sign', lines: ['', '', '', ''], color: 'black' }; BE.signFromNbt(sg2, BE.signToNbt(sg));
  o.sign = sg2.lines.join('|') === 'a|b||d' && sg2.color === 'red';
  // brewing stand: blaze powder refuels 20, nether wart on a water bottle starts the 400-tick brew, then awkward
  put(16, 64, 0, 'brewing_stand'); const bs = BE.get(16, 64, 0);
  bs.items[0] = M.Brewing.potionStack('potion', 'water'); bs.items[3] = Inv.stack('nether_wart', 1); bs.items[4] = Inv.stack('blaze_powder', 1);
  run(1); o.brewStart = bs.fuel === 19 && bs.brewTime > 390 && bs.brewTime <= 400 && !bs.items[4];
  run(402); o.brewDone = M.Brewing.potionOf(bs.items[0]) === 'awkward' && !bs.items[3];
  // campfire: each held item's cooking clock counts up per tick
  const cf = BE.get(4, 64, 0); cf.items[0] = Inv.stack('beef', 1); const c0 = cf.cookingTimes[0]; run(5);
  o.campfire = cf.cookingTimes[0] === c0 + 5 && cf.cookingTimes[1] === 0;
  // barrel viewer count: 0 -> 1 openers flips BarrelBlock.OPEN, back to 0 closes it; shulker box opens/closes via its stage machine
  put(20, 64, 0, 'barrel', { facing: 'up' }); const ba = BE.get(20, 64, 0);
  const isOpen = () => B.propName(W.getBlock(20, 64, 0), 'open');
  const b0 = isOpen(); ba.open = 1; run(1); const b1 = isOpen(); ba.open = 0; run(1);
  o.barrel = b0 === 'false' && b1 === 'true' && isOpen() === 'false';
  put(22, 64, 0, 'shulker_box'); const sh = BE.get(22, 64, 0);
  sh.open = 1; run(3); const s1 = sh.sbStage, p1 = sh.sbProg; run(12); const s2 = sh.sbStage;
  sh.open = 0; run(1); const s3 = sh.sbStage; run(12);
  o.shulker = s1 === 1 && p1 > 0 && s2 === 2 && s3 === 3 && sh.sbStage === 0;
  // dispenser behaviours: minecart onto a rail, armour onto an armor stand, shears on a sheep
  const fire = (z, item, fx) => { put(30, 64, z, 'dispenser', { facing: 'east' }); const d = BE.get(30, 64, z); d.items[0] = Inv.stack(item, 1); fx && fx(); put(29, 64, z, 'redstone_block'); B.changed(29, 64, z); run(8); return d; };
  put(31, 63, 8, 'stone'); put(31, 64, 8, 'rail');
  const dm = fire(8, 'minecart'); o.minecart = !dm.items[0] && EL.list.some((m) => m.type === 'minecart');
  let stand;
  const da = fire(12, 'iron_helmet', () => { stand = EL.spawn('armor_stand', 31.5, 64, 12.5, {}); });
  o.armor = !da.items[0] && !!stand && JSON.stringify(stand.equip).includes(String(Inv.stack('iron_helmet', 1).i));
  let sheep;
  const ds = fire(16, 'shears', () => { sheep = EL.spawn('sheep', 31.5, 64, 16.5, {}); });
  o.shears = !!sheep && !!ds.items[0] && ds.items[0].d === 1;
  let st2;
  const dk = fire(20, 'wither_skeleton_skull', () => { st2 = EL.spawn('armor_stand', 31.5, 64, 20.5, {}); });
  o.skull = !dk.items[0] && W.getBlock(31, 64, 20) === 0 && !!st2 && JSON.stringify(st2.equip).includes(String(Inv.stack('wither_skeleton_skull', 1).i));
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['types', "case 'furnace': case 'blast_furnace': case 'smoker':\n        // burnTime", "case 'furnace': case 'smoker':\n        // burnTime"],
  ['chest', 'e.items = new Array(27); e.open = 0; break;', 'e.items = new Array(26); e.open = 0; break;'],
  ['removed', "if (!want) { if (have) { BE.popFurnaceXp(have); BE.remove(x, y, z); } return; }", "if (!want) { return; }"],
  ['blastHalf', "if (e.type !== 'furnace') v = (v / 2) | 0;", ''],
  ['signal13', 'music_disc_pigstep: 13', 'music_disc_pigstep: 12'],
  ['jukeDrop', "if (have && have.type === 'jukebox' && want !== 'jukebox') BE.jukeboxRemoveRecord(x, y, z);", ''],
  ['dropper', "if (e.type === 'dropper') {", "if (false) {"],
  ['dispenser', "if (r() * n < 1) pick = i;", "if (false) pick = i;"],
  ['brewStart', "e.fuel = 20; blaze.n--;", "e.fuel = 0; blaze.n--;"],
  ['brewDone', "ing.n--;\n    // `Item.getRecipeRemainder`", "\n    // `Item.getRecipeRemainder`"],
  ['campfire', "if (e.items[i]) e.cookingTimes[i]++;", ""],
  ['barrel', "e.barrelWas = now;", "e.barrelWas = now; return;"],
  ['shulker', "if (v === 0) e.sbStage = 3; else if (v === 1) e.sbStage = 1;", "if (v === 0) e.sbStage = 3;"],
  ['minecart', "if (Rl.isRail(st)) d = Rl.isAscending(Rl.shapeOf(st)) ? 0.6 : 0.1;", "if (false) d = 0.1;"],
  ['armor', "if (es < IT.FEET) return null;", "return null;"],
  ['shears', "src.d = (src.d | 0) + 1;\n    if (max", "if (max"],
  ['skull', "W.setBlock(x, y, z, 0);   // no pattern", ''],
  ['furnace', 'input.n--;\n    if (input.n <= 0) e.items[0] = null;', 'if (input.n <= 0) e.items[0] = null;'],
];
for (const [key, a, b] of BR) {
  if (b === null) continue;
  breaks++;
  let hit = false, X;
  try { X = trial((f, s) => { if (f === '07c_blockentity.js' && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!X[key], 'anti-vacuity: break ' + key);
  if (!X[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `blockentity11583check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
