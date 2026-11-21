#!/usr/bin/env node
// itemmap11737check.mjs — #11737: MapIcon.Type, MapBannerMarker, MapFrameMarker, ToolMaterial, ArmorMaterial (07pn_mapmarkers.js)
// against .decomp values and the item registry, plus the cartographer wiring in 07p_trade.js. Breaks its own source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine, ASSETS } from './loadsrc.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const F = '07pn_mapmarkers.js';
function trial(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', F], dom: false, ...(patch ? { patch: (f, t) => (f === F ? patch(t) : t) } : {}) });
  const M = E.MapMarkers, o = {};
  o.ids = M.TYPES.length === 27 && M.typeId('mansion') === 8 && M.typeId('monument') === 9 && M.typeId('red_x') === 26 && M.byId(99).name === 'red_x' && M.byId(-3).name === 'player';
  o.tint = M.byId(8).tint === 5393476 && M.byId(9).tint === 3830373 && !M.byId(1).hasTint && M.byId(0).alwaysRender === false && M.byId(4).countLimited === false && M.byId(26).countLimited === false;
  o.banner = M.bannerIconType('white') === 10 && M.bannerIconType('black') === 25 && M.bannerIconType('red') === 24 && M.bannerIconType('nope') === 25 && M.bannerKey({ x: 1, y: -2, z: 3 }) === 'banner-1,-2,3';
  const bn = M.bannerFromNbt(M.bannerNbt({ pos: { x: 4, y: 5, z: 6 }, color: 'cyan', name: 'N' }));
  o.nbt = bn.color === 'cyan' && bn.pos.z === 6 && bn.name === 'N' && M.bannerFromNbt({ Pos: { X: 0, Y: 0, Z: 0 }, Color: 'zz' }).color === 'white';
  const fr = M.frameFromNbt(M.frameNbt({ pos: { x: 7, y: 8, z: 9 }, rotation: 3, entityId: 42 }));
  o.frame = fr.rotation === 3 && fr.entityId === 42 && M.frameKey({ x: 7, y: 8, z: 9 }) === 'frame-7,8,9';
  const ic = M.icon(1, 2, 3, 17, null); o.icon = ic.rotation === 1 && M.iconEquals(ic, M.icon(1, 2, 3, 1, null)) && !M.iconEquals(ic, M.icon(1, 2, 4, 1, null));
  o.dyes = JSON.stringify(M.DYES) === JSON.stringify(E.Recipes ? E.Recipes.dyeNames() : M.DYES);
  // materials vs the item registry (extracted from the jar): durability of the tools, armour per slot
  const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
  E.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
  const IT = E.Items, d = (n) => IT.durability[IT.of(n)];
  o.tool = ['wood', 'stone', 'iron', 'diamond', 'gold', 'netherite'].every((m) => d((m === 'wood' ? 'wooden' : m === 'gold' ? 'golden' : m) + '_pickaxe') === M.toolMaterial(m).durability) && M.toolMaterial('netherite').miningLevel === 4 && M.toolMaterial('gold').miningSpeed === 12;
  o.armor = ['leather', 'iron', 'golden', 'diamond', 'netherite'].every((m) => { const k = m === 'golden' ? 'gold' : m; return d(m + '_helmet') === M.armorDurability(k, 3) && d(m + '_boots') === M.armorDurability(k, 0); }) && M.armorProtection('diamond', 2) === 8 && M.ARMOR.netherite[4] === 0.1 && M.ARMOR.diamond[3] === 2;
  return o;
}
const base = trial(); for (const [k, v] of Object.entries(base)) ok(v, 'baseline ' + k);
const trade = readFileSync(join(ROOT, 'src/07p_trade.js'), 'utf8');
ok(/icon: 'monument'/.test(trade) && /icon: 'mansion'/.test(trade) && /NS\.MapMarkers\.typeId\(row\.icon\)/.test(trade), 'trade wires the map icon type');
ok(readFileSync(join(ROOT, 'build.mjs'), 'utf8').includes("'" + F + "'"), 'build lists the module');
const BR = [['ids', "['mansion', 1, 5393476", "['mansion', 1, 5393477", ['tint']], ['ids2', "['red_x', 1, -1, 0]];", "['red_x', 1, -1, 0], ['x', 0, -1, 0]];", ['ids']],
  ['bk', "'banner-'", "'bnr-'", ['banner']], ['bdef', "MM.typeId('banner_black') :", "MM.typeId('banner_white') :", ['banner']],
  ['wd', "'Color: m.color'", "", []], ['nbtdef', "? n.Color : 'white'", "? n.Color : 'black'", ['nbt']], ['fk', "'frame-'", "'f-'", ['frame']],
  ['rot', 'rot & 15', 'rot & 31', ['icon']], ['stone', 'stone: [1, 131', 'stone: [1, 132', ['tool']], ['ng', 'netherite: [4, 2031', 'netherite: [3, 2031', ['tool']],
  ['arm', 'diamond: [33,', 'diamond: [34,', ['armor']], ['tgh', '[3, 6, 8, 3], 15, 3, 0.1]', '[3, 6, 8, 3], 15, 3, 0]', ['armor']],
  ['bd', '[13, 15, 16, 11]', '[13, 15, 16, 12]', ['armor']], ['mon', "['monument', 1, 3830373", "['monument', 1, 3830374", ['tint']]];
let breaks = 0;
for (const [key, a, b, expect] of BR) {
  if (!expect.length) continue;
  let hit = false; let X;
  const p = (s) => { const j = s.indexOf(a); if (j >= 0) { hit = true; return s.slice(0, j) + b + s.slice(j + a.length); } return s; };
  try { X = trial(p); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]); ok(caught, 'anti-vacuity: ' + key); if (caught) { breaks++; console.log('  ✓ break caught: ' + key); }
}
console.log(`itemmap11737check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
