#!/usr/bin/env node
// extract-sided.mjs — `hasSidedTransparency` PER BLOCK, OUT OF .decomp (cloud unit nifty-gauss, D-773 "all green").
//
//   node tools/extract-sided.mjs          # suite stage: re-derives and fails if the committed golden drifted
//   node tools/extract-sided.mjs --write  -> tools/golden/sided-light-1.18.2.tsv
//
// Vanilla's `ChunkLightProvider.getRealisticOpacity` treats a state that is opaque AND `hasSidedTransparency` by its
// culling SHAPE (a bottom slab's full DOWN face blocks light through it); `SpreadableBlock.canSurvive` asks exactly that
// about the block on top of grass/mycelium. The override lives on the block CLASS, so the table follows each registered
// block's class chain (extract-pathfind.mjs's parser of Blocks.java) to the nearest `hasSidedTransparency` body and
// classifies it: `true` · `extended` (PistonBlock: `get(EXTENDED)`) · `notdouble` (SlabBlock: `TYPE != DOUBLE`).
// Every block NOT listed answers AbstractBlock's `false`. An unrecognised body stops the extractor (never guessed).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from './extract-pathfind.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BLK = join(ROOT, '.decomp', 'net', 'minecraft', 'block');
const OUT = join(ROOT, 'tools', 'golden', 'sided-light-1.18.2.tsv');
if (!existsSync(BLK)) { console.log('extract-sided: no .decomp/ here — keeping the committed golden'); process.exit(0); }

export function classify(body) {
  const t = body.trim();
  if (t === 'return true;') return 'true';
  if (t === 'return false;') return 'false';
  if (/^return \$\$0\.get\(EXTENDED\);$/.test(t)) return 'extended';
  if (/^return \$\$0\.get\(TYPE\) != SlabType\.field_12682;$/.test(t)) return 'notdouble';   // field_12682 = DOUBLE
  return null;
}
const d = derive(BLK);
const body = (c) => { const s = d.src[c]; const m = s && s.match(/public boolean hasSidedTransparency\([^)]*\)\s*\{([\s\S]*?)\n    \}/); return m ? m[1] : null; };
const rows = [], bad = [];
for (const [name, cls] of d.regs) {
  if (!cls) continue;
  for (let c = cls; c && c !== 'AbstractBlock'; c = d.ext[c]) {
    const b = body(c); if (b === null) continue;
    const r = classify(b);
    if (r === null) bad.push(c + ': ' + b.trim());
    else if (r !== 'false') rows.push([name, r, c]);
    break;
  }
}
console.log('================ extract-sided ================');
console.log(' registered blocks ... ' + d.regs.length);
console.log(' sided rows .......... ' + rows.length + '  (' + ['true', 'extended', 'notdouble'].map((r) => r + ' ' + rows.filter((x) => x[1] === r).length).join(', ') + ')');
const want = { stone_slab: 'notdouble', oak_stairs: 'true', snow: 'true', farmland: 'true', piston: 'extended', dirt_path: 'true' };
for (const [n, r] of Object.entries(want)) { const row = rows.find((x) => x[0] === n); if (!row || row[1] !== r) bad.push(`anchor ${n}: ${row ? row[1] : 'missing'}, want ${r}`); }
for (const n of ['stone', 'grass_block', 'glass', 'oak_leaves']) if (rows.some((x) => x[0] === n)) bad.push(`anchor ${n} listed, want absent`);
if (d.regs.length < 850) bad.push('only ' + d.regs.length + ' registrations parsed');
if (bad.length) { for (const b of bad) console.error(' x ' + b); process.exit(1); }
const text = '# block\trule\towner_class — hasSidedTransparency, non-false rows only (tools/extract-sided.mjs, .decomp)\n' + rows.map((r) => r.join('\t')).join('\n') + '\n';
if (process.argv.includes('--write')) {
  mkdirSync(join(ROOT, 'tools', 'golden'), { recursive: true });
  writeFileSync(OUT, text);
  console.log(' wrote ............... tools/golden/sided-light-1.18.2.tsv');
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8').replace(/\r/g, '') !== text) {
  console.error(' x the committed golden differs from .decomp — run node tools/extract-sided.mjs --write'); process.exit(1);
}
console.log(' assertions passed .... ' + (Object.keys(want).length + 4 + 1));
