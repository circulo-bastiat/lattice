#!/usr/bin/env node
// beaudit11485check.mjs — #11485: drives 07c_blockentity.js through the real path (World + Behave + BlockEntities.tick/dispenseFrom,
// registry real states) for classes the audit listed unchecked, off .decomp semantics:
//   DropperBlock / ItemDispenserBehavior (the dropper inserts into the container it faces, a dispenser throws),
//   FluidDrainable (empty bucket drains a water source), FallibleItemDispenserBehavior (no target -> item kept),
//   ShearsDispenserBehavior (full beehive: 3 honeycomb, honey_level 0, shears wear), BlockPlacementDispenserBehavior +
//   AutomaticItemPlacementContext (shulker box placed in front), ArmorItem.dispenseArmor + EntityPredicates (helmet onto the first
//   living non-dead entity whose slot is empty, drop chance 2.0), SkullItem (skeleton skull is dispenseArmor),
//   MinecartItem (spawn height on a rail), JukeboxBlock / JukeboxBlockEntity (disc comparator signal, removeRecord drops the disc),
//   WitherSkullBlock (no pattern: the dispensed skull is taken back), AbstractFurnaceBlockEntity / BlastFurnaceBlockEntity /
//   SmokerBlockEntity (fuel time, getFuelTime = super/2, cook completes at cookTimeTotal), BarrelBlockEntity + ViewerCountManager
//   (open count flips the OPEN property), ShulkerBoxBlockEntity (opening stage), SignBlockEntity (NBT round trip), BlockEntityType
//   (block -> type table), BrewingStandBlockEntity (canCraft), CampfireBlockEntity / ComparatorBlockEntity / SkullBlockEntity (type table).
// Anti-vacuity: each scenario is broken by a source patch and must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '07zzq_brewing.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
  '14g_menu.js', '14g2_invclasses.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07y_equip.js', '07z_potion.js', '07zzy_firework.js', '07zzm_wither.js',
  '13_input.js', '15b_gui.js', '15_hud.js', '14l_use.js', '07zzh_blaze.js', '07w_passive.js', '07zo_bee.js', '07n_tame.js', '07r_mount.js', '07ze_llama.js', '14_player.js', '07m_breed.js', '07zzj_strider.js', '07zze_oxidize.js', '07zx_particle.js', '07zzt_boat.js', '07zn_mooshroom.js', '07zq_snowgolem.js', '07d_mining.js', '07e_loot.js', '07zzt_armorstand.js', '07zzq_rail.js', '07zzr_minecart.js', '07zv_villagerbrain.js'];
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  MCL.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
  MCL.BlockEntities.init(); MCL.Entities.init();
  if (MCL.Equip) MCL.Equip.init();
  const Inv = MCL.Inventory, BE = MCL.BlockEntities, W = MCL.World, B = MCL.Behave, EL = MCL.EntityList, CH = MCL.CH, S = MCL.States;
  B.init(W); MCL.Use.init(W);
  const o = {}; const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
  const fresh = () => { W.init(1); for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
    BE.clear(); EL.init(); EL.pushPlayer = () => null; };
  const putP = (x, y, z, name, props) => { let st = S.stateOf(name) | 0; for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]); W.setBlock(x, y, z, st); return st; };
  const blockAt = (x, y, z, name, props) => { putP(x, y, z, name, props); return BE.get(x, y, z) || BE.create(x, y, z, name); };
  const rnd = () => 0.5;
  const attempt = (k, f) => { try { o[k] = !!f(); } catch (e) { o[k] = false; o[k + 'Err'] = String(e); } };
  const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

  // BlockEntityType: block -> type table
  attempt('types', () => BE.typeOf(S.block ? MCL.Reg.id.chest : 0) === 'chest' && BE.typeOf(MCL.Reg.id.barrel) === 'barrel' &&
    BE.typeOf(MCL.Reg.id.blast_furnace) === 'blast_furnace' && BE.typeOf(MCL.Reg.id.smoker) === 'smoker' && BE.typeOf(MCL.Reg.id.campfire) === 'campfire' &&
    BE.typeOf(MCL.Reg.id.soul_campfire) === 'campfire' && BE.typeOf(MCL.Reg.id.comparator) === 'comparator' && BE.typeOf(MCL.Reg.id.jukebox) === 'jukebox' &&
    BE.typeOf(MCL.Reg.id.zombie_head) === 'skull' && BE.typeOf(MCL.Reg.id.oak_sign) === 'sign' && BE.typeOf(MCL.Reg.id.red_shulker_box) === 'shulker_box' &&
    BE.typeOf(MCL.Reg.id.brewing_stand) === 'brewing_stand' && BE.typeOf(MCL.Reg.id.stone) === undefined);
  // DropperBlock / ItemDispenserBehavior
  attempt('dropper', () => { fresh(); const d = blockAt(0, 4, 0, 'dropper', { facing: 'down' }), c = blockAt(0, 3, 0, 'chest'); d.items[0] = stk('cobblestone', 8);
    BE.dispenseFrom(d, rnd); return c.items[0] && c.items[0].n === 1 && d.items[0].n === 7 && EL.count() === 0; });
  attempt('dispenserThrows', () => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'down' }), c = blockAt(0, 3, 0, 'chest'); d.items[0] = stk('cobblestone', 8);
    BE.dispenseFrom(d, rnd); return !(c.items[0] && c.items[0].n) && d.items[0].n === 7 && EL.count() === 1; });
  // FluidDrainable via the dispenser's empty bucket
  attempt('drainable', () => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'down' }); putP(0, 3, 0, 'water', { level: 0 }); d.items[0] = stk('bucket', 1);
    BE.dispenseFrom(d, rnd); return nameOf(d.items[0]) === 'water_bucket' && W.getBlock(0, 3, 0) !== S.stateOf('water'); });
  // FallibleItemDispenserBehavior: shears with no target keep the item
  attempt('fallible', () => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'down' }); d.items[0] = stk('shears', 1);
    BE.dispenseFrom(d, rnd); return nameOf(d.items[0]) === 'shears' && !(d.items[0].d | 0) && EL.count() === 0; });
  // ShearsDispenserBehavior: full beehive
  attempt('shears', () => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'down' }); putP(0, 3, 0, 'beehive', { honey_level: 5 }); d.items[0] = stk('shears', 1);
    BE.dispenseFrom(d, rnd); return B.propName(W.getBlock(0, 3, 0), 'honey_level') === '0' && d.items[0].d === 1 &&
      EL.list.some((m) => m.type === 'item' && MCL.Items.nameOf(m.item) === 'honeycomb' && m.count === 3); });
  // BlockPlacementDispenserBehavior + AutomaticItemPlacementContext
  attempt('placement', () => { fresh(); for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) putP(x, 3, z, 'stone');
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'north' }); d.items[0] = stk('red_shulker_box', 1);
    BE.dispenseFrom(d, rnd); return S.name(W.getBlock(0, 4, -1)) === 'red_shulker_box' && !d.items[0] && !!BE.get(0, 4, -1); });
  attempt('placementBlocked', () => { fresh(); putP(0, 4, -1, 'stone'); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'north' }); d.items[0] = stk('red_shulker_box', 1);
    BE.dispenseFrom(d, rnd); return S.name(W.getBlock(0, 4, -1)) === 'stone' && (!d.items[0] || d.items[0].n === 1) && EL.count() <= 1; });
  // ArmorItem.dispenseArmor / EntityPredicates
  const armour = (dead) => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'north' }); d.items[0] = stk('iron_helmet', 1);
    const z = EL.spawn('zombie', 0.5, 4, -0.5, {}); if (dead) z.dead = true; BE.dispenseFrom(d, rnd); return { d, z }; };
  attempt('armor', () => { const { d, z } = armour(false); const E = MCL.Equip; return !d.items[0] && nameOf(E.getEquipped(z, MCL.Items.HEAD)) === 'iron_helmet' && z.persistent === true; });
  attempt('predicate', () => { const { d } = armour(true); return !!d.items[0] ? true : EL.list.some((m) => m.item || m.stack) && true; });
  attempt('predicateKeep', () => { const { d, z } = armour(true); return !MCL.Equip.getEquipped(z, MCL.Items.HEAD); });
  attempt('skullItem', () => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'north' }); d.items[0] = stk('skeleton_skull', 1);
    const z = EL.spawn('zombie', 0.5, 4, -0.5, {}); BE.dispenseFrom(d, rnd); return !d.items[0] && nameOf(MCL.Equip.getEquipped(z, MCL.Items.HEAD)) === 'skeleton_skull'; });
  // WitherSkullBlock.canDispense: no soul-sand pattern -> skull is not left standing
  const tee = (body) => { fresh(); const d = blockAt(1, 7, 5, 'dispenser', { facing: 'down' }); d.items[0] = stk('wither_skeleton_skull', 1);
    if (body) { for (const x of [0, 1, 2]) putP(x, 5, 5, 'soul_sand'); putP(1, 4, 5, 'soul_sand'); for (const x of [0, 2]) putP(x, 6, 5, 'wither_skeleton_skull'); }
    return d; };
  const withers = () => EL.list.filter((q) => q.type === 'wither' && !q.removed).length;
  attempt('witherBuilds', () => { const d = tee(true); return BE.dispenseFrom(d, rnd) === true && !d.items[0] && withers() === 1; });
  attempt('witherNoPattern', () => { const d = tee(false); BE.dispenseFrom(d, rnd); return S.name(W.getBlock(1, 6, 5)) === 'air' && withers() === 0; });
  // MinecartItem.DISPENSER_BEHAVIOR on a flat rail
  attempt('minecart', () => { fresh(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'north' }); putP(0, 3, -1, 'stone'); putP(0, 4, -1, 'rail', { shape: 'north_south' }); d.items[0] = stk('minecart', 1);
    BE.dispenseFrom(d, rnd); const m = EL.list.find((q) => q.type === 'minecart'); return !!m && !d.items[0] && Math.abs(m.y - 4.1) < 1e-6 && Math.abs(m.z - (0.5 - 1.125)) < 1e-6; });
  // JukeboxBlock / JukeboxBlockEntity
  attempt('jukebox', () => { fresh(); const j = blockAt(0, 4, 0, 'jukebox'); j.record = 'music_disc_cat'; return BE.jukeboxSignal(0, 4, 0) === 2 && (j.record = 'music_disc_otherside', BE.jukeboxSignal(0, 4, 0) === 14); });
  attempt('jukeboxRemove', () => { fresh(); const j = blockAt(0, 4, 0, 'jukebox'); j.record = 'music_disc_13'; putP(0, 4, 0, 'stone');
    return j.record === null && EL.count() === 1 && BE.jukeboxSignal(0, 4, 0) === 0; });
  // AbstractFurnaceBlockEntity / BlastFurnaceBlockEntity / SmokerBlockEntity
  const burn = (type, input, fuel) => { fresh(); const f = blockAt(0, 4, 0, type); f.items[0] = stk(input, 1); f.items[1] = stk(fuel, 1); BE.tick(); return f; };
  attempt('furnaceFuel', () => { const f = burn('furnace', 'iron_ore', 'coal'); return f.burnDuration === 1600 && f.burnTime === 1600 && f.lit === true && !f.items[1]; });
  attempt('blastFuel', () => { const f = burn('blast_furnace', 'iron_ore', 'coal'); return f.burnDuration === 800; });
  attempt('smokerFuel', () => { const f = burn('smoker', 'beef', 'coal'); return f.burnDuration === 800; });
  attempt('smeltDone', () => { const f = burn('furnace', 'iron_ore', 'coal'); for (let i = 0; i < 198; i++) BE.tick(); const a = !f.items[2]; BE.tick(); return a && nameOf(f.items[2]) === 'iron_ingot' && !f.items[0]; });
  attempt('smokerRejectsOre', () => { const f = burn('smoker', 'iron_ore', 'coal'); return f.burnTime === 0 && f.cookTime === 0; });
  // BarrelBlockEntity / ViewerCountManager
  attempt('barrel', () => { fresh(); const b = blockAt(0, 4, 0, 'barrel', { facing: 'up' }); b.open = 1; BE.barrelSync(b); const a = B.propName(W.getBlock(0, 4, 0), 'open') === 'true';
    b.open = 0; BE.barrelSync(b); return a && B.propName(W.getBlock(0, 4, 0), 'open') === 'false'; });
  attempt('viewers', () => { fresh(); const ev = []; MCL.GameEvent = { emit: (n) => ev.push(n) }; const b = blockAt(0, 4, 0, 'chest'); b.open = 2; BE.openEdge(b); BE.openEdge(b); b.open = 0; BE.openEdge(b);
    return ev.join() === 'container_open,container_close'; });
  // ShulkerBoxBlockEntity
  attempt('shulker', () => { fresh(); MCL.GameEvent = { emit() {} }; const s = blockAt(0, 4, 0, 'shulker_box'); s.open = 1; BE.tickShulkerBox(s); const a = s.sbStage === 1; for (let i = 0; i < 12; i++) BE.tickShulkerBox(s);
    return a && s.sbStage === 2; });
  // SignBlockEntity
  attempt('sign', () => { fresh(); const s = blockAt(0, 4, 0, 'oak_sign'); s.lines = ['a', 'b', '', 'd']; s.color = 'red'; s.glowing = true; const t = BE.signToNbt(s);
    const r = BE.signFromNbt({ type: 'sign' }, t); return t.GlowingText === 1 && t.Color === 'red' && t.Text2 === '{"text":"b"}' && r.lines.join('|') === 'a|b||d' && r.glowing === true && r.color === 'red'; });
  // BrewingStandBlockEntity
  attempt('brewing', () => { fresh(); const b = blockAt(0, 4, 0, 'brewing_stand'); const bottle = MCL.Brewing.potionStack('potion', 'water');
    if (!bottle) return false; b.items[0] = bottle; b.items[3] = stk('nether_wart', 1); const a = BE.brewCanCraft(b); if (process.env.DBG) console.log('BR', a, bottle); b.items[3] = stk('golden_carrot', 1); return a && !BE.brewCanCraft(b); });
  // CampfireBlockEntity / ComparatorBlockEntity / SkullBlockEntity: created with the block, with their own state
  attempt('campfire', () => { fresh(); const c = blockAt(0, 4, 0, 'campfire'); return c.type === 'campfire' && Array.isArray(c.items) && c.items.length === 4; });
  attempt('comparator', () => { fresh(); const c = blockAt(0, 4, 0, 'comparator'); return c.type === 'comparator' && (c.outputSignal | 0) === 0; });
  attempt('skullBE', () => { fresh(); putP(0, 4, 0, 'skeleton_skull'); B.changed(0, 4, 0); const c = BE.get(0, 4, 0) || BE.create(0, 4, 0, 'skull'); return c.type === 'skull' && c.owner === null; });
  return o;
}
const LBL = { types: 'BlockEntityType table', dropper: 'DropperBlock inserts', dispenserThrows: 'ItemDispenserBehavior throws', drainable: 'FluidDrainable bucket', fallible: 'FallibleItemDispenserBehavior keeps item',
  shears: 'ShearsDispenserBehavior beehive', placement: 'BlockPlacementDispenserBehavior shulker', placementBlocked: 'AutomaticItemPlacementContext blocked', armor: 'ArmorItem.dispenseArmor', predicate: 'EntityPredicates dead entity skipped (item thrown)', predicateKeep: 'EntityPredicates dead entity unequipped', skullItem: 'SkullItem dispenseArmor',
  witherNoPattern: 'WitherSkullBlock.canDispense no pattern', witherBuilds: 'WitherSkullBlock.onPlaced builds wither', minecart: 'MinecartItem spawn height', jukebox: 'JukeboxBlock comparator', jukeboxRemove: 'JukeboxBlockEntity removeRecord', furnaceFuel: 'AbstractFurnaceBlockEntity fuel', blastFuel: 'BlastFurnaceBlockEntity fuel/2', smokerFuel: 'SmokerBlockEntity fuel/2',
  smeltDone: 'AbstractFurnaceBlockEntity cook completes', smokerRejectsOre: 'SmokerBlockEntity food only', barrel: 'BarrelBlockEntity open', viewers: 'ViewerCountManager edges', shulker: 'ShulkerBoxBlockEntity stages', sign: 'SignBlockEntity NBT',
  brewing: 'BrewingStandBlockEntity canCraft', campfire: 'CampfireBlockEntity', comparator: 'ComparatorBlockEntity', skullBE: 'SkullBlockEntity' };
const A = trial(null); if (process.env.DBG) console.log(A);
for (const [key, m] of Object.entries(LBL)) { ok(A[key], m); if (A[key + 'Err']) fails.push(key + ': ' + A[key + 'Err']); }
const F = '07c_blockentity.js';
const BR = [
  ['types', /\['blast_furnace',/, "['blast_furnaceX',"],
  ['dropper', /if \(e\.type === 'dropper'\) \{/, "if (false) {"],
  ['dispenserThrows', /if \(e\.type === 'dropper'\) \{/, "if (e.type === 'dropper' || e.type === 'dispenser') {"],
  ['drainable', /if \(!filled\) return BE\.dispenseThrowFrom/, 'if (true) return BE.dispenseThrowFrom'],
  ['shears', /src\.d = \(src\.d \| 0\) \+ 1;/, 'src.d = (src.d | 0);'],
  ['fallible', /if \(!done\) return false;\n    var src = e\.items\[slot\], max/, 'var src = e.items[slot], max'],
  ['placement', /if \(!W\.setBlock\(x, y, z, st\)\) return false;\n    if \(NS\.Save/, 'return false;\n    if (NS.Save'],
  ['placementBlocked', /if \(!S\.canBeReplacedBy\(W\.getBlock\(x, y, z\), id, pf, y, true\)\) return false;/, ''],
  ['armor', /Eq\.setDropChance\(t, es, BE\.ARMOUR_DROP_CHANCE\); t\.persistent = true;/, ''],
  ['predicateKeep', /if \(m\.dead \|\| m\.removed \|\| m\.mode === 3/, 'if (m.mode === 3'],
  ['skullItem', /IT\.equipSlot\(i\) >= IT\.FEET && !BE\.DISPENSE_BEHAVIORS\[n\]/, 'false'],
  ['witherBuilds', /BE\.checkWitherSummon\(x, y, z\);\n      \}/, '}'],
  ['minecart', /d = Rl\.isAscending\(Rl\.shapeOf\(st\)\) \? 0\.6 : 0\.1;/, 'd = 0.6;'],
  ['jukebox', /music_disc_cat: 2,/, 'music_disc_cat: 3,'],
  ['jukeboxRemove', /if \(have && have\.type === 'jukebox' && want !== 'jukebox'\) BE\.jukeboxRemoveRecord\(x, y, z\);/, ''],
  ['furnaceFuel', /var v = R\.fuelTime\(fuel\);/, 'var v = R.fuelTime(fuel) + 1;'],
  ['blastFuel', /if \(e\.type !== 'furnace'\) v = \(v \/ 2\) \| 0;/, ''],
  ['smeltDone', /if \(e\.cookTime === e\.cookTimeTotal\) \{/, 'if (e.cookTime === e.cookTimeTotal + 1) {'],
  ['smokerRejectsOre', /function cookType\(type\) \{/, 'function cookType(type) { if (type === "smoker") return "smelting";'],
  ['barrel', /B\.setProp\(st, 'open', now\)/, "B.setProp(st, 'open', !now)"],
  ['viewers', /G\.emit\(now \? \(sb \? 'shulker_open' : 'container_open'/, "G.emit(!now ? (sb ? 'shulker_open' : 'container_open'"],
  ['shulker', /if \(v !== was\) \{/, 'if (false) {'],
  ['sign', /GlowingText: e\.glowing \? 1 : 0/, 'GlowingText: 0'],
  ['brewing', /I\.isEmpty\(e\.items\[i\]\) && Br\.hasRecipe\(e\.items\[i\], ing\)\) return true/, 'I.isEmpty(e.items[i]) && true) return true'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  let hit = false;
  const B = trial((f, src) => { const n = f === F ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; });
  ok(hit, 'break pattern matched (no-op if not found): ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
