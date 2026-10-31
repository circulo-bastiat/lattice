#!/usr/bin/env node
// extract-equipsounds.mjs — #8730: writes tools/golden/equipsounds.tsv from .decomp (ArmorMaterials.java + SoundEvents.java
// + ElytraItem.getEquipSound). Columns: key<TAB>sound. Never hand-typed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(join(R, '.decomp/net/minecraft', p), 'utf8');
const snd = {};
for (const m of rd('sound/SoundEvents.java').matchAll(/(field_\d+) = register\("([^"]+)"\)/g)) snd[m[1]] = m[2];
const rows = [];
for (const m of rd('item/ArmorMaterials.java').matchAll(/^\s*\w+\("(\w+)", \d+, new int\[\][^)]*?\}, \d+, SoundEvents\.(field_\d+)/gm)) rows.push([m[1], snd[m[2]]]);
const el = /getEquipSound\(\) \{\s*return SoundEvents\.(field_\d+)/.exec(rd('item/ElytraItem.java'));
rows.push(['elytra', snd[el[1]]]);
mkdirSync(join(R, 'tools/golden'), { recursive: true });
writeFileSync(join(R, 'tools/golden/equipsounds.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
console.log(rows.length + ' rows');
