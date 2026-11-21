#!/usr/bin/env node
// hudaudit11489check.mjs — #11489: drives 15_hud.js through its real tooltip/effect paths for classes the audit listed
// unchecked: Rarity (+ NetherStarItem, ExperienceBottleItem, EnchantedGoldenAppleItem rarity rows, enchant bump),
// StringHelper.formatTicks / StatusEffectUtil.durationToString (effectDuration), StatusEffectCategory (NOT_BENEFICIAL),
// StatusEffectInstance ordering (effectCompare) as used by AbstractInventoryScreen/InGameHud.
// Anti-vacuity: each scenario is broken by a source patch and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '13_input.js', '15b_gui.js', '15_hud.js'];
function trial(patch) {
  const MCL = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  const H = MCL.Hud, o = {};
  const stk = (n, t) => ({ i: MCL.Items.of(n), n: 1, d: 0, t: t || null });
  const EN = { Enchantments: [{ id: 'minecraft:sharpness', lvl: 1 }] };
  o.starRarity = H.rarityOf(stk('nether_star')) === 1;
  o.bottleRarity = H.rarityOf(stk('experience_bottle')) === 1;
  o.egaRarity = H.rarityOf(stk('enchanted_golden_apple')) === 3;
  o.commonRarity = H.rarityOf(stk('stone')) === 0 && H.rarityOf(stk('elytra')) === 1;
  o.rareRarity = H.rarityOf(stk('golden_apple')) === 2;
  o.enchBump = H.rarityOf(stk('stone', EN)) === 2 && H.rarityOf(stk('nether_star', EN)) === 2 && H.rarityOf(stk('golden_apple', EN)) === 3 && H.stackRarity(stk('stone', EN)) === 2;
  o.dur = H.effectDuration({ effect: 'speed', duration: 20 * 61 }) === '1:01' && H.effectDuration({ effect: 'speed', duration: 20 * 600 }) === '10:00' && H.effectDuration({ effect: 'speed', duration: 20 * 9 }) === '0:09';
  o.durInf = H.effectDuration({ effect: 'speed', duration: 40000 }) === '**:**' && H.effectDuration({ effect: 'speed', duration: 5, permanent: true }) === '**:**';
  o.cat = H.NOT_BENEFICIAL.poison === 1 && H.NOT_BENEFICIAL.glowing === 1 && H.NOT_BENEFICIAL.bad_omen === 1 && !H.NOT_BENEFICIAL.speed && !H.NOT_BENEFICIAL.regeneration && Object.keys(H.NOT_BENEFICIAL).length === 13;
  const a = { effect: 'speed', duration: 100, ambient: false }, b = { effect: 'speed', duration: 200, ambient: false }, c = { effect: 'speed', duration: 50, ambient: true };
  o.cmp = H.effectCompare(a, b) < 0 && H.effectCompare(b, a) > 0 && H.effectCompare(c, a) > 0 && H.effectCompare(a, a) === 0;
  return o;
}
const LBL = { starRarity: 'NetherStarItem UNCOMMON', bottleRarity: 'ExperienceBottleItem UNCOMMON', egaRarity: 'EnchantedGoldenAppleItem EPIC', commonRarity: 'Rarity COMMON default', rareRarity: 'Rarity RARE row', enchBump: 'Rarity enchant bump', dur: 'StringHelper.formatTicks', durInf: 'durationToString infinite', cat: 'StatusEffectCategory non-beneficial set', cmp: 'StatusEffectInstance ordering' };
const A = trial(null);
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const BR = [
  ['starRarity', /elytra experience_bottle skeleton_skull wither_skeleton_skull player_head zombie_head creeper_head dragon_head nether_star /g, 'elytra experience_bottle skeleton_skull wither_skeleton_skull player_head zombie_head creeper_head dragon_head '],
  ['bottleRarity', /1: 'elytra experience_bottle /, "1: 'elytra "],
  ['egaRarity', /repeating_command_block chain_command_block structure_void structure_block jigsaw enchanted_golden_apple /g, 'repeating_command_block chain_command_block structure_void structure_block jigsaw '],
  ['rareRarity', /2: 'beacon conduit golden_apple /, "2: 'beacon conduit "],
  ['commonRarity', /1: 'elytra /, "0: 'elytra "],
  ['enchBump', /r = r <= 1 \? 2 : \(r === 2 \? 3 : r\);\n/, 'r = r;\n'],
  ['dur', /return t < 10 \? m \+ ':0' \+ t : m \+ ':' \+ t;/, "return m + ':' + t;"],
  ['durInf', /return !!inst\.permanent \|\| inst\.duration > 32767;/, 'return !!inst.permanent;'],
  ['cat', /glowing: 1, levitation: 1, unluck: 1, bad_omen: 1/, 'levitation: 1, unluck: 1, bad_omen: 1'],
  ['cmp', /var r = cmp\(a\.ambient \? 1 : 0, b\.ambient \? 1 : 0\);/, 'var r = 0;'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  let hit = false;
  const B = trial((fn, src) => { if (fn !== '15_hud.js') return src; const n = src.replace(re, rep); if (n !== src) hit = true; return n; });
  if (!hit) throw new Error('not found: break pattern did not match ' + key);
  ok(hit, 'break pattern matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
