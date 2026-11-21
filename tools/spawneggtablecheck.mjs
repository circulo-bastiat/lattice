#!/usr/bin/env node
// spawneggtablecheck.mjs — #8905: every spawn egg against Items.java / SpawnEggItem.
//
//   node tools/spawneggtablecheck.mjs
//
// Reads `new SpawnEggItem(EntityType.X, primary, secondary, settings)` rows out of the decompiled
// Items.java on every run, resolves X to the registered entity name through EntityType.java, and
// compares with the engine: the exact set of egg items, each egg's two tint colours
// (tint0 = primary, tint1 = secondary), the entity type use.js derives from the item name
// (NS.EntityList.canSpawn), and the creative tab (MISC).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';

const DEC = join(MCLITE_ROOT, '.decomp/net/minecraft');
const fails = [];
let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function oracle(mut) {
  const et = readFileSync(join(DEC, 'entity/EntityType.java'), 'utf8');
  const reg = {};
  for (const m of et.matchAll(/public static final EntityType<[^>]*> (\w+) = register\(\s*"(\w+)"/g)) reg[m[1]] = m[2];
  const it = readFileSync(join(DEC, 'item/Items.java'), 'utf8');
  const eggs = {};
  for (const m of it.matchAll(/"(\w+)",\s*new SpawnEggItem\(EntityType\.(\w+),\s*(-?\d+),\s*(-?\d+),\s*new Item\.Settings\(\)\.group\(ItemGroup\.(\w+)\)/g))
    eggs[m[1]] = { type: reg[m[2]], p: +m[3], s: +m[4], group: m[5] };
  if (mut) mut(eggs);
  return eggs;
}

const NS = loadEngine({ extra: ['02g_items.js'], dom: false });
initRegistry(NS);
const IT = NS.Items;
const imeta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
IT.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: imeta.rawBytes });

function compare(eggs) {
  const out = [];
  const engine = IT.names.filter((n) => n.endsWith('_spawn_egg'));
  for (const n of engine) if (!eggs[n]) out.push(`extra engine egg ${n}`);
  for (const [n, e] of Object.entries(eggs)) {
    const i = IT.index[n];
    if (i === undefined) { out.push(`missing engine egg ${n}`); continue; }
    if (IT.tint0[i] !== e.p || IT.tint1[i] !== e.s) out.push(`${n} tints ${IT.tint0[i]},${IT.tint1[i]} want ${e.p},${e.s}`);
    const stem = n.slice(0, -'_spawn_egg'.length);
    if (stem !== e.type) out.push(`${n} entity type ${stem} want ${e.type}`);
    else if (NS.EntityList && !NS.EntityList.canSpawn(stem)) out.push(`${n}: EntityList.canSpawn(${stem}) false`);
    if (e.group !== 'MISC') out.push(`${n} tab ${e.group} want MISC`);
  }
  return out;
}

const eggs = oracle();
ok(Object.keys(eggs).length > 60, `only ${Object.keys(eggs).length} eggs read from Items.java`);
for (const d of compare(eggs)) ok(false, d);

// anti-vacuity (D-30): break the oracle, the check must notice
let breaks = 0;
const first = Object.keys(eggs)[0];
const muts = [
  (e) => { e[first].p ^= 1; },
  (e) => { delete e[first]; },
  (e) => { e[first].type = 'nonesuch'; },
  (e) => { e.fake_spawn_egg = { type: 'fake', p: 1, s: 2, group: 'MISC' }; },
];
for (const m of muts) { const d = compare(oracle(m)); if (d.length) breaks++; else fails.push('a break was not caught'); }
console.log(`spawneggtablecheck — ${Object.keys(eggs).length} eggs in Items.java, ${breaks} breaks caught`);
if (fails.length) { console.log(fails.slice(0, 40).map((f) => '  FAIL ' + f).join('\n')); console.log(`${pass} ok, ${fails.length} FAILED`); process.exit(1); }
console.log(`${pass} ok`);
