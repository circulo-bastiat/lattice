#!/usr/bin/env node
// enchhelper11649check.mjs — #11649: proves 07ox_enchhelper.js (the 30 Enchantment subclasses' power windows,
// canCombine exclusions, targets, EnchantedBook stored list), reached from 07oy_enchtable/07zzp_anvil/15g_commands; source breaks caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07ox_enchhelper.js'], dom: false, patch: patch ? (f, s) => (f === '07ox_enchhelper.js' ? patch(s) : s) : undefined });
  const E = MCL.EnchHelper, o = {};
  o.roster = E.ids().length === 38 && E.ENCH.mending.treasure === true && E.ENCH.soul_speed.rand === false;
  o.minmax = E.getMinPower('respiration', 2) === 20 && E.getMaxPower('respiration', 2) === 50 &&
    E.getMinPower('depth_strider', 3) === 30 && E.getMaxPower('depth_strider', 3) === 45 &&
    E.getMinPower('efficiency', 3) === 21 && E.getMaxPower('efficiency', 3) === 81 &&
    E.getMinPower('loyalty', 2) === 19 && E.getMaxPower('loyalty', 2) === 50 &&
    E.getMinPower('quick_charge', 3) === 52 && E.getMaxPower('impaling', 2) === 29 &&
    E.getMinPower('mending', 1) === 25 && E.getMaxPower('mending', 1) === 75 &&
    E.getMinPower('punch', 2) === 32 && E.getMaxPower('punch', 2) === 57 &&
    E.getMinPower('flame', 1) === 20 && E.getMaxPower('aqua_affinity', 1) === 41;
  o.curses = E.getMinPower('binding_curse', 1) === 25 && E.getMaxPower('vanishing_curse', 1) === 50 && E.isCurse('binding_curse') && E.isCurse('vanishing_curse') && !E.isCurse('mending');
  o.exclusive = !E.canCombine('depth_strider', 'frost_walker') && !E.canCombine('multishot', 'piercing') &&
    !E.canCombine('infinity', 'mending') && !E.canCombine('riptide', 'loyalty') && !E.canCombine('riptide', 'channeling') &&
    !E.canCombine('silk_touch', 'fortune') && !E.canCombine('silk_touch', 'looting') && !E.canCombine('sharpness', 'smite');
  o.compat = E.canCombine('loyalty', 'channeling') && E.canCombine('flame', 'infinity') && E.canCombine('unbreaking', 'mending') &&
    E.canCombine('knockback', 'fire_aspect') && E.canCombine('protection', 'feather_falling') && !E.canCombine('protection', 'protection');
  o.incompat = E.incompatible('riptide').sort().join() === 'channeling,loyalty';
  o.type = E.TYPE.aqua_affinity === 'armor_head' && E.TYPE.binding_curse === 'wearable' && E.TYPE.vanishing_curse === 'vanishable' && E.TYPE.channeling === 'trident' && E.TYPE.quick_charge === 'crossbow';
  o.accept = E.isAcceptableItem('aqua_affinity', 'iron_helmet') && !E.isAcceptableItem('aqua_affinity', 'iron_boots') &&
    E.isAcceptableItem('binding_curse', 'elytra') && E.isAcceptableItem('binding_curse', 'carved_pumpkin') &&
    E.isAcceptableItem('channeling', 'trident') && !E.isAcceptableItem('channeling', 'bow') &&
    E.isAcceptableItem('efficiency', 'shears') && E.isAcceptableItem('sharpness', 'iron_axe') && !E.isAcceptableItem('knockback', 'iron_axe') &&
    E.isAcceptableItem('piercing', 'crossbow') && E.isAcceptableItem('lure', 'fishing_rod');
  o.vanish = E.targetAccepts('vanishable', 'compass') && E.targetAccepts('vanishable', 'bow') && !E.targetAccepts('vanishable', 'stick');
  o.book = E.isBookOffer('mending') && !E.isBookOffer('soul_speed');
  // stack substrate (no Items => plain 'Enchantments' list)
  const s = { i: 1, n: 1 };
  E.addEnchantment(s, 'minecraft:unbreaking', 2); E.addEnchantment(s, 'mending', 1); E.addEnchantment(s, 'unbreaking', 3);
  const g = E.get(s);
  o.stack = g.unbreaking === 3 && g.mending === 1 && s.t.Enchantments.length === 2 && !E.addEnchantment(s, 'bogus', 1);
  o.rm = E.removeEnchantment(s, 'mending') && !E.removeEnchantment(s, 'mending') && (E.removeEnchantment(s, 'unbreaking'), !s.t.Enchantments);
  const r = E.set({ i: 1, n: 1 }, { flame: 1, power: 0 });
  o.set = r.t.Enchantments.length === 1 && r.t.Enchantments[0].id === 'minecraft:flame';
  // possible entries at power 30 for a bow: power(21..) punch flame infinity windows
  const pe = E.getPossibleEntries(30, 'bow', false).map((x) => x.id + x.level).sort().join();
  o.possible = pe === 'flame1,infinity1,power3,punch1';
  const ts = E.getPossibleEntries(60, 'trident', false).map((x) => x.id).sort().join();
  o.treasure = E.getPossibleEntries(30, ['breakable'], true).some((x) => x.id === 'mending') && !E.getPossibleEntries(30, ['breakable'], false).some((x) => x.id === 'mending');
  let n = 0; const rng = () => [0.1, 0.9, 0.5, 0.3, 0.99][n++ % 5];
  const gen = E.generateEnchantments(rng, 'bow', 'bow', 20, false);
  o.gen = gen.length >= 1 && gen.every((x) => E.ENCH[x.id].target === 'bow') && E.generateEnchantments(rng, 'stick', 'bow', 20, false).length === 0;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.EnchHelper/.test(rd('07oy_enchtable.js')) && /NS\.EnchHelper/.test(rd('07zzp_anvil.js')) && /NS\.EnchHelper/.test(rd('15g_commands.js')), 'reach: table/anvil/commands use EnchHelper');
const BR = [
  ['respmin', 'function (l) { return 10 * l; }', 'function (l) { return 9 * l; }', ['minmax']],
  ['effmax', 'efficiency: function (l) { return (1 + l * 10) + 50; }', 'efficiency: function (l) { return (1 + l * 10) + 40; }', ['minmax']],
  ['loyalmax', 'loyalty: function () { return 50; }', 'loyalty: function () { return 40; }', ['minmax']],
  ['mendmax', 'MIN.mending(l) + 50', 'MIN.mending(l) + 40', ['minmax']],
  ['depth', "b !== 'frost_walker'", 'true', ['exclusive'], ["b !== 'depth_strider'", 'true']],
  ['inf', "case 'infinity': return b !== 'mending';", "case 'infinity': return true;", ['exclusive']],
  ['multi', "return b !== 'piercing';\n      case 'piercing': return b !== 'multishot';", "return true;\n      case 'piercing': return true;", ['exclusive']],
  ['ripl', "b !== 'loyalty' && b !== 'channeling'", "b !== 'loyalty'", ['exclusive', 'incompat']],
  ['bindtype', "binding_curse: 'wearable'", "binding_curse: 'armor'", ['type', 'accept']],
  ['elytra', "n === 'elytra' ||", '', ['accept']],
  ['shears', "itemName === 'shears'", 'false', ['accept']],
  ['soulbook', "id !== 'soul_speed'", 'true', ['book']],
  ['treasure', 'if (e.treasure && !treasureAllowed) continue;', '', ['treasure', 'possible']],
  ['replace', 'L[i] = { id: want, lvl: lvl | 0 }; return true;', 'continue;', ['stack']],
  ['setzero', 'if (map[k] > 0)', 'if (map[k] >= 0)', ['set']],
  ['flamemax', 'flame: function () { return 50; }', 'flame: function () { return 20; }', ['possible']],
];
for (const [key, a, b, expect, more] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; let r = s.split(a).join(b); if (more) r = r.split(more[0]).join(more[1]); return r; } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`enchhelper11649check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
