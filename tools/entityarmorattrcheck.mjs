#!/usr/bin/env node
// #11676 — EntityAttributes.field_23724 (generic.armor, .decomp entity/attribute/EntityAttributes.java:30): the
// mob base-armor column (07h Ent.ARMOR -> Ent.attrsOf(t).armor) must reach the damage path (Eq.armorOf).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07h_entities.js', '09b_sky.js', '14b_physics.js', '07y_equip.js', '07i_entitylist.js', '07l_spawn.js', '14i_hand.js', '14j_combat.js', '14d_survival.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
{ const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8')); M.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes }); }
M.Entities.init(); M.EntityList.init(); M.Equip.init(); M.Hand.init(); M.Combat.init();
const W = M.World, CH = M.CH, STONE = M.States.stateOf('stone') | 0;
function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 60, z, STONE);
}
const jar = readFileSync(join(ROOT, '.decomp/net/minecraft/entity/attribute/EntityAttributes.java'), 'utf8');
function run(mut) {
  const E = M.Entities, saved = JSON.stringify(E.attrs.wither), sa = E.attrs.wither;
  if (mut) mut(E);
  const f = [];
  const w = E.attrsOf('wither'), pig = E.attrsOf('pig');
  if (!w || w.armor !== 4) f.push('wither attr armor != 4');
  if (!pig || pig.armor !== 0) f.push('pig attr armor != registry default 0');
  const hit = (t) => { M.EntityList.clear(); freshWorld(); const e = M.EntityList.spawn(t, 0.5, 61, 0.5); if (!e) return null; e.maxHealth = e.health = 300; M.Combat.hurt(e, 20, 0, true); return e.health; };
  const hw = hit('wither'), hp = hit('pig');
  if (hw === null || !(hw > 280.5 && hw < 281)) f.push('Cb.hurt(wither,20) health ' + hw + ' != armor-4 result 280.64');
  if (!/"generic\.armor",\s*new ClampedEntityAttribute\("attribute\.name\.generic\.armor", 0\.0, 0\.0, 30\.0\)/.test(jar)) f.push('jar field_23724 not default 0 max 30');
  E.attrs.wither = sa; if (JSON.stringify(sa) !== saved) E.attrs.wither = JSON.parse(saved);
  return f;
}
const base = run(null);
let ok = base.length === 0; base.forEach((x) => console.log('FAIL', x));
const breaks = [
  ['wither armor column cut', (E) => { E.attrs.wither = Object.assign({}, E.attrs.wither, { armor: 0 }); }],
  ['pig gets armor', (E) => { E.attrs.pig = Object.assign({}, E.attrs.pig, { armor: 9 }); }],
  ['attrsOf cut', (E) => { const o = E.attrsOf; E.attrsOf = () => null; setTimeout(() => { E.attrsOf = o; }, 0); }],
];
let caught = 0;
for (const [n, m] of breaks) { const a = JSON.stringify(M.Entities.attrs); const o = M.Entities.attrsOf; const f = run(m); M.Entities.attrs = JSON.parse(a); M.Entities.attrsOf = o; if (f.length) caught++; else { console.log('NOT CAUGHT', n); ok = false; } }
console.log(`${ok ? 6 : 0} assertions, ${ok ? 0 : 1} failures, ${caught} breaks caught`);
process.exit(ok ? 0 : 1);
