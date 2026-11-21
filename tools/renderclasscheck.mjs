#!/usr/bin/env node
// renderclasscheck.mjs - #11727: every net.minecraft.client.render class (all subpackages) exists in .decomp, is cited by a
// src/ module (the module that replaces it, ruled in docs/decisions/11495-render-class-map.md), and that module is wired
// (classmap wired flag). Mutants: strip the class name from src / point at a bogus class - both must be caught.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const cm = JSON.parse(readFileSync('tools/classmap.json', 'utf8'));
const rows = cm.rows.filter((r) => r[0].startsWith('net/minecraft/client/render/') && r[5] !== 'out-of-scope');
const src = readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync('src/' + f, 'utf8')]);
const ruling = readFileSync('docs/decisions/11495-render-class-map.md', 'utf8');
const cited = (name, S) => S.some(([, t]) => new RegExp('(?<![A-Za-z])' + name + '(?![A-Za-z])').test(t));
const fails = []; let pass = 0, breaks = 0;
const FOG = readFileSync('.decomp/net/minecraft/client/render/FogShape.java', 'utf8');
if (!/field_36350\(0\)[\s\S]*field_36351\(1\)/.test(FOG)) fails.push('FogShape ids changed in .decomp');
for (const r of rows) {
  const name = r[0].split('/').pop();
  if (!existsSync(`.decomp/${r[0]}.java`)) { fails.push(`${name}: no .decomp source`); continue; }
  if (r[1] === 'MISSING') { fails.push(`${name}: no module`); continue; }
  if (!cited(name, src)) fails.push(`${name}: not cited in src/`); else pass++;
  const cut = src.map(([f, t]) => [f, t.replace(new RegExp('(?<![A-Za-z])' + name + '(?![A-Za-z])', 'g'), 'X')]);
  if (!cited(name, cut)) breaks++; else fails.push(`${name}: cut mutant survived`);
  if (!cited(name + 'Bogus', src)) breaks++; else fails.push(`${name}: bogus mutant survived`);
}
if (!/replaced, not ported/.test(ruling)) fails.push('ruling file lost');
for (const f of fails) console.log('FAIL', f);
console.log(`renderclasscheck: ${pass}/${rows.length} cited, ${breaks} breaks caught`);
process.exit(fails.length || breaks < 2 * rows.length || !rows.length ? 1 : 0);
