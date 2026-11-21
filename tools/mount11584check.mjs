#!/usr/bin/env node
// mount11584check.mjs — #11584: proves 07r_mount.js's DyedCarpetBlock (carpetColorIndex), SaddleItem (Mount.interact/trySaddleItem),
// HorseArmorItem (menu slot 1 + equipArmor), AbstractDonkeyEntity (chest attach/menu size/hideChestParts), DonkeyEntityModel and
// LlamaEntityModel (hideChestParts), HorseMarkingFeatureRenderer (variant marking layer index) through the real entry points
// (Mount.interact, Mount.menu). Each source break must fail its row.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), ASSETS = join(ROOT, 'assets');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07r_mount.js', '07zzj_strider.js', '07zzp_mobvoice.js', '14f_inventory.js', '14g_menu.js', '14g2_invclasses.js', '14l_use.js',
  '14j_combat.js', '14d_survival.js', '14_player.js', '15b_gui.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, ...(patch ? { patch } : {}) });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  M.DATA = Object.assign({}, M.DATA, {
    entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')),
    mobSounds: Object.fromEntries(readFileSync(join(ROOT, 'tools/golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/).filter(l => l && l[0] !== '#').map(l => { const c = l.split('\t'); return [c[0], c.slice(2)]; }))
  });
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Breed.init(); M.Tame.init(); M.Mount.init();
  M.World.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  const STONE = M.States.stateOf('stone') | 0;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) M.World.setBlock(x, 63, z, STONE);
  const Mnt = M.Mount, EL = M.EntityList, Inv = M.Inventory, o = {};
  const sp = (t, tamed) => { const e = EL.spawn(t, 0, 64, 0); e.tamed = !!tamed; return e; };
  // DyedCarpetBlock: sixteen dyed carpets, ordinal = DyeColor; moss is not one
  o.carpet = Mnt.carpetColorIndex('white_carpet') === 0 && Mnt.carpetColorIndex('black_carpet') === 15 && Mnt.carpetColorIndex('red_carpet') === 14;
  o.mossNot = Mnt.carpetColorIndex('moss_carpet') === -1 && !Mnt.isCarpetItem('stone') && Mnt.isCarpetItem('lime_carpet');
  // SaddleItem.useOnEntity via Mount.interact
  const h = sp('horse', true);
  const r = Mnt.interact(h, 'saddle', {});
  o.saddle = !!r && r.consumed === true && h.saddled === true;
  const h2 = sp('horse', false);
  const r2 = Mnt.interact(h2, 'saddle', {});
  o.saddleUntamed = h2.saddled !== true && !(r2 && r2.consumed);
  const lm = sp('llama', true);
  Mnt.interact(lm, 'saddle', {});
  o.llamaNoSaddle = lm.saddled !== true;
  // HorseArmorItem: interact opens screen (tame), menu slot 1 takes armour
  const h3 = sp('horse', true);
  const r3 = Mnt.interact(h3, 'iron_horse_armor', {});
  o.armorOpens = !!r3 && r3.opened === true && !r3.consumed;
  const m3 = Mnt.menu(h3, Inv.create());
  const iron = Inv.stack('iron_horse_armor', 1);
  o.armorSlot = m3.slots[1].placeFn(iron) === true && m3.slots[1].placeFn(Inv.stack('lime_carpet', 1)) === false;
  M.Menu.slotSet(m3.slots[1], iron);
  o.armorBonus = h3.armorItem === 'iron_horse_armor' && h3.armorBonus === 5;
  // llama decor slot takes carpet, not armour, and sets colour
  const m4 = Mnt.menu(lm, Inv.create());
  o.llamaCarpet = m4.slots[1].placeFn(Inv.stack('lime_carpet', 1)) === true && m4.slots[1].placeFn(iron) === false;
  M.Menu.slotSet(m4.slots[1], Inv.stack('lime_carpet', 1));
  o.llamaColor = lm.carpetColor === 5;
  // AbstractDonkeyEntity: chest attach, 17-slot menu, hideChestParts
  const d = sp('donkey', true);
  o.hiddenBefore = !!Mnt.hideChestParts(d) && Mnt.hideChestParts(d).left_chest === 1;
  const r5 = Mnt.interact(d, 'chest', {});
  o.chest = !!r5 && r5.consumed === true && d.hasChest === true;
  o.chestShown = Mnt.hideChestParts(d) === null;
  o.size17 = Mnt.menu(d, Inv.create()).slots.length === 17 + 36;
  const d2 = sp('donkey', false);
  Mnt.interact(d2, 'chest', {});
  o.chestUntamed = d2.hasChest !== true;
  o.horseNoChest = Mnt.hideChestParts(h) === null;
  // LlamaEntityModel: chest hidden until chest, columns = strength
  lm.hasChest = true; lm.strength = 3;
  o.llamaChest = Mnt.hideChestParts(lm) === null && Mnt.menu(lm, Inv.create()).slots.length === 2 + 9 + 36;
  // HorseMarkingFeatureRenderer: colour/marking packed layer index
  const v = Mnt.encodeVariant(3, 4);
  o.marking = Mnt.horseColor({ variant: v }) === 3 && Mnt.horseMarking({ variant: v }) === 4 && Mnt.rollVariant(() => 0.999) === Mnt.encodeVariant(6, 4);
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['carpetOrdinal', "var i = dyes.indexOf(m[1]);", "var i = dyes.indexOf(m[1]) + 1;"],
  ['carpetRegex', "/^(.*)_carpet$/", "/^(.*)_carpetx$/"],
  ['saddleGate', "if (!Mnt.isMountable(e) || Mnt.isSaddled(e) || !Mnt.canBeSaddled(e)) return null;", "if (!Mnt.isMountable(e) || Mnt.isSaddled(e)) return null;"],
  ['llamaSaddle', "if (Mnt.isLlama(e)) return false;\n    return !!e && e.dead", "return !!e && e.dead"],
  ['armorBonus', "iron_horse_armor: 5,", "iron_horse_armor: 4,"],
  ['armorMay', "return Mnt.hasArmorSlot(e) && Mnt.isHorseArmor(n);", "return true;"],
  ['carpetMay', "if (Mnt.hasDecorSlot(e)) return Mnt.isCarpetItem(n);", "if (Mnt.hasDecorSlot(e)) return true;"],
  ['chestAttach', "Mnt.addChest(e);\n          // `playAddChestSound`", "// `playAddChestSound`"],
  ['hideParts', "(!e.hasChest || isBaby(e))) ? Mnt.CHEST_PART_NAMES : null", "false) ? Mnt.CHEST_PART_NAMES : null"],
  ['chestSize', "var size = chest ? (2 + 3 * Mnt.inventoryColumns(e)) : 2;", "var size = 2;"],
  ['columns', "return Mnt.isLlama(e) ? Mnt.getStrength(e) : 5;", "return 5;"],
  ['variant', "return (color & 0xFF) | ((marking << 8) & 0xFF00);", "return (color & 0xFF) | ((marking << 4) & 0xFF00);"],
];
let breaks = 0;
for (const [name, from, to] of BR) {
  let hit = false;
  const O = trial((file, src) => { if (file !== '07r_mount.js') return src; if (!src.includes(from)) return src; hit = true; return src.replace(from, to); });
  const failed = !hit ? null : Object.keys(O).some(k => !O[k]);
  if (failed === null) fails.push('break ' + name + ': source text not found'); else if (!failed) fails.push('break ' + name + ' NOT caught'); else { breaks++; console.log('  ✓ break caught: ' + name); }
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `mount11584check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
