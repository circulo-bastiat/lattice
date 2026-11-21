#!/usr/bin/env node
// equipsoundcheck.mjs — #8730: LivingEntity.onEquipStack plays ItemStack.getEquipSound (ArmorMaterials' sound, elytra's own;
// null for everything else incl. pumpkin in 1.18.2). Table closed against tools/golden/equipsounds.tsv both ways. Breaks its own data (D-30).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07y_equip.js'] });
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/items.meta.json'), 'utf8'));
M.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
M.Equip.init();
const gold = readFileSync(join(ROOT, 'tools/golden/equipsounds.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
const log = [];
M.Sound = Object.assign(M.Sound || {}, { entitySound: (...a) => { log.push(a[0]); } });
const stack = (n) => ({ i: M.Items.of(n), n: 1 });
let fails = 0, breaks = 0, ok = 0;
const expect = (label, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) ok++; else { fails++; console.log('FAIL ' + label, got, want); } };
const place = (name, slot, silent) => { log.length = 0; const e = { x: 0, y: 64, z: 0, silent }; M.Equip.setEquipped(e, slot, name ? stack(name) : null); return log.slice(); };
const pieces = ['helmet', 'chestplate', 'leggings', 'boots'];
const itemMat = { leather: 'leather', chainmail: 'chainmail', iron: 'iron', golden: 'gold', diamond: 'diamond', turtle: 'turtle', netherite: 'netherite' };
const seen = new Set();
for (const [it, mat] of Object.entries(itemMat)) {
  const g = gold.find((r) => r[0] === mat); if (!g) { fails++; console.log('FAIL golden lacks ' + mat); continue; }
  seen.add(mat);
  const item = it + '_helmet';
  if (M.Items.of(item) < 0 || M.Items.of(item) == null) continue;
  expect(item, place(item, 4), [g[1]]);
}
expect('elytra', place('elytra', 3), [gold.find((r) => r[0] === 'elytra')[1]]);
for (const r of gold) if (r[0] !== 'elytra' && !seen.has(r[0])) { fails++; console.log('FAIL golden material unmapped ' + r[0]); }
expect('pumpkin silent', place('carved_pumpkin', 4), []);
expect('empty silent', place(null, 4), []);
expect('silent entity', place('iron_boots', 1, true), []);
// anti-vacuity: corrupt golden / disable engine
const orig = M.Equip.equipSoundOf;
M.Equip.equipSoundOf = () => null;
if (place('iron_helmet', 4).length === 0) breaks++; else { fails++; console.log('FAIL anti-vacuity engine'); }
M.Equip.equipSoundOf = orig;
if (JSON.stringify(place('iron_helmet', 4)) !== JSON.stringify(['item.armor.equip_chain'])) breaks++; else { fails++; console.log('FAIL anti-vacuity data'); }
console.log(`${ok} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
