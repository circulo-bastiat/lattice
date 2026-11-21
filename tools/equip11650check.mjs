#!/usr/bin/env node
// equip11650check.mjs — #11650: proves 07y_equip.js through its real entry points: Eq.armorOf (ProtectionEnchantment
// factors 1/2/2/3/2), Eq.protectionReduce, Eq.ITEM_ENCHANTABILITY (ToolMaterials), Eq.tryEquip (MiningToolItem,
// BannerItem/ominous banner), Eq.rollArmor slot order (EquipmentSlot), Eq.inhabited save round trip (ChunkSerializer
// InhabitedTime). Reach: 07i_entitylist/17_main/16b_save call these. Source breaks must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '14i_hand.js', '14j_combat.js', '07y_equip.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch: patch ? (f, s) => (f === '07y_equip.js' ? patch(s) : s) : undefined });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Equip.init(); {
    const table = {};
    for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
      if (!line || line[0] === '#') continue;
      const c = line.split('\t'); if (c[0] === 'item' || c.length < 9) continue;
      table[c[0]] = [Math.round(parseFloat(c[6]) * 10000) / 10000, Math.round(parseFloat(c[7]) * 10000) / 10000, +c[8]];
    }
    M.Hand.bindAttrs(table);
  }
  const Eq = M.Equip, IT = M.Items, o = {};
  const st = (n, ench) => { const s = M.Inventory.stack(n, 1, 0, null); if (ench) s.t = { Enchantments: ench }; return s; };
  const en = (id, lvl) => ({ id: 'minecraft:' + id, lvl });
  o.ready = Eq.ready === true;
  // ProtectionEnchantment.getProtectionAmount factors
  const mk = (id, lvl) => { const e = { x: 0, z: 0, type: 'zombie' }; Eq.setEquipped(e, IT.HEAD, st('iron_helmet', [en(id, lvl)])); return e; };
  const prot = (id, src) => Eq.armorOf(mk(id, 2), src).protection;
  o.protG = prot('protection', null) === 2;
  o.protProj = prot('projectile_protection', 'projectile') === 4 && prot('projectile_protection', 'fire') === 0;
  o.protFire = prot('fire_protection', 'fire') === 4;
  o.protFall = prot('feather_falling', 'fall') === 6;
  o.protBlast = prot('blast_protection', 'explosion') === 4;
  const ar = Eq.armorOf(mk('protection', 1));
  o.armor = ar.armor === 2 + IT.defenseOf(IT.of('iron_helmet')) && ar.armor > 2;
  o.reduce = Math.abs(Eq.protectionReduce(10, 5) - 8) < 1e-9 && Math.abs(Eq.protectionReduce(10, 99) - 2) < 1e-9 && Eq.protectionReduce(10, -3) === 10;
  // ToolMaterials enchantability
  const T = Eq.ITEM_ENCHANTABILITY;
  o.mat = T.wooden_sword === 15 && T.stone_axe === 5 && T.iron_shovel === 14 && T.diamond_sword === 10 && T.golden_axe === 22 && T.netherite_sword === 15;
  // MiningToolItem
  if (process.env.DBG) console.log(!!Eq.isMiningTool(st('iron_axe')), M.Hand.attrs && Object.keys(M.Hand.attrs).length, M.Hand.attrsFor(st('iron_axe')));
  o.mine = Eq.isMiningTool(st('iron_axe')) && Eq.isMiningTool(st('diamond_pickaxe')) && !Eq.isMiningTool(st('iron_sword')) && !Eq.isMiningTool(st('bow'));
  if (process.env.DBG) console.log(Eq.prefersNewEquipment(st('diamond_pickaxe'), st('wooden_pickaxe'), { type: 'zombie' }), Eq.prefersNewEquipment(st('wooden_pickaxe'), st('diamond_pickaxe'), { type: 'zombie' }), Eq.prefersNewEquipment(st('iron_axe'), st('dirt'), { type: 'zombie' }), IT.isBlock(IT.of('dirt')));
  o.prefAxe = Eq.prefersNewEquipment(st('diamond_pickaxe'), st('wooden_pickaxe'), { type: 'zombie' }) === true &&
    Eq.prefersNewEquipment(st('wooden_pickaxe'), st('diamond_pickaxe'), { type: 'zombie' }) === false &&
    Eq.prefersNewEquipment(st('iron_axe'), st('dirt'), { type: 'zombie' }) === true;
  // BannerItem: ominous banner
  const b = Eq.getOminousBanner();
  o.banner = Eq.isOminousBanner(b) && !Eq.isOminousBanner(st('white_banner')) && IT.nameOf(b.i) === 'white_banner' && b.t.HideFlags === 32;
  // EquipmentSlot: armour tier order feet,legs,chest,head; tryEquip puts a helmet in HEAD
  const e = { x: 0, z: 0, type: 'zombie' };
  o.slot = Eq.preferredSlot(st('iron_boots')) === IT.FEET && Eq.preferredSlot(st('iron_helmet')) === IT.HEAD && Eq.tryEquip(e, st('iron_helmet'), () => 0.5) && Eq.getEquipped(e, IT.HEAD) && Eq.dropChance(e, IT.HEAD) === 2;
  Eq.clampedLocalDifficulty = () => 1;
  const e2 = { x: 0, z: 0, type: 'zombie' }; let rc = 0; Eq.rollArmor(e2, () => (rc++ < 5 ? 0 : 0.99));   // r()=0: always rolls, tier 0+3 bumps=3, break chance never hit... see below
  o.rollSlots = [[IT.FEET, 'boots'], [IT.LEGS, 'leggings'], [IT.CHEST, 'chestplate'], [IT.HEAD, 'helmet']].every(([s, w]) => { const q = Eq.getEquipped(e2, s); return q && IT.nameOf(q.i) === 'iron_' + w; });
  // ChunkSerializer InhabitedTime save round trip
  M.World.init(1);
  Eq.inhabited = new Map([[M.World.key(3, -5), 1234], [M.World.key(-7, 2), 9]]);
  const j = Eq.inhabitedToJSON(); Eq.inhabited = new Map(); Eq.inhabitedFromJSON(JSON.parse(JSON.stringify(j)));
  o.inhab = j.length === 2 && Eq.inhabitedAt(3 * 16 + 1, -5 * 16 + 2) === 1234 && Eq.inhabitedAt(-7 * 16, 2 * 16) === 9 && Eq.inhabitedAt(0, 0) === 0;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.Equip\.initMob/.test(rd('07i_entitylist.js')) && /NS\.Equip\.tickPickup/.test(rd('07i_entitylist.js')), 'reach: entitylist');
ok(/NS\.Equip\.tickInhabited/.test(rd('17_main.js')) && /NS\.Equip\.inhabitedToJSON/.test(rd('16b_save.js')), 'reach: main/save');
const BR = [
  ['projfactor', "out.protection += 2 * Cb.enchantLevel(st, 'projectile_protection')", "out.protection += 1 * Cb.enchantLevel(st, 'projectile_protection')", ['protProj']],
  ['fallfactor', "out.protection += 3 * Cb.enchantLevel(st, 'feather_falling')", "out.protection += 2 * Cb.enchantLevel(st, 'feather_falling')", ['protFall']],
  ['firefactor', "out.protection += 2 * Cb.enchantLevel(st, 'fire_protection')", "out.protection += 3 * Cb.enchantLevel(st, 'fire_protection')", ['protFire']],
  ['reduce', 'damage * (1 - a / 25)', 'damage * (1 - a / 20)', ['reduce']],
  ['ench', 'stone_axe: 5', 'stone_axe: 6', ['mat']],
  ['mining', 'return !!H.attrsFor(stack) && !H.isSword(stack);', 'return !!H.attrsFor(stack);', ['mine']],
  ['minetool', "if (IT.isBlock(oldStack.i)) return true;", "if (IT.isBlock(oldStack.i)) return false;", ['prefAxe']],
  ['banner', 'HideFlags: 32', 'HideFlags: 0', ['banner']],
  ['slotorder', 'var order = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD];', 'var order = [IT.HEAD, IT.CHEST, IT.LEGS, IT.FEET];', ['rollSlots']],
  ['dropchance', 'Eq.setDropChance(e, slot, Eq.OMINOUS_BANNER_DROP_CHANCE);   // 2.0', 'Eq.setDropChance(e, slot, 0);   // 2.0', ['slot']],
  ['inhab', 'Math.floor(k / 4194304) << 10 >> 10', '0', ['inhab']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`equip11650check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
