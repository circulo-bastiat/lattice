#!/usr/bin/env node
// extract-luminance.mjs — `.luminance(...)` PER BLOCK RULE, OUT OF .decomp Blocks.java (#406).
//
//   node tools/extract-luminance.mjs          # suite stage: re-derives and fails if the committed golden drifted
//   node tools/extract-luminance.mjs --write  -> tools/golden/luminance-1.18.2.tsv
//
// Vanilla's `AbstractBlockState.getLuminance()` is per STATE (a lambda over the state). The rule kinds:
//   const N · lit N (LIT ? N : 0) · candles (LIT ? 3*CANDLES : 0) · level (LightBlock LEVEL_15) · pickle
//   (dry ? 0 : 3+3*PICKLES) · anchor (floor(CHARGES/4*15)) · berries (BERRIES ? N : 0) · lichen (any direction ? N : 0).
// An unrecognised lambda stops the extractor (never guessed). Blocks not listed emit 0.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, '.decomp', 'net', 'minecraft', 'block', 'Blocks.java');
const OUT = join(ROOT, 'tools', 'golden', 'luminance-1.18.2.tsv');
if (!existsSync(SRC)) { console.log('extract-luminance: no .decomp/ here — keeping the committed golden'); process.exit(0); }

export function classify(expr) {
  let m;
  if ((m = expr.match(/^\$\$0x -> (\d+)$/))) return ['const', +m[1]];
  if ((m = expr.match(/^createLightLevelFromLitBlockState\((\d+)\)$/))) return ['lit', +m[1]];
  if (expr === 'CandleBlock.STATE_TO_LUMINANCE') return ['candles', 0];
  if (expr === 'LightBlock.STATE_TO_LUMINANCE') return ['level', 0];
  if ((m = expr.match(/^CaveVines\.getLuminanceSupplier\((\d+)\)$/))) return ['berries', +m[1]];
  if ((m = expr.match(/^GlowLichenBlock\.getLuminanceSupplier\((\d+)\)$/))) return ['lichen', +m[1]];
  if (expr === '$$0x -> SeaPickleBlock.isDry($$0x) ? 0 : 3 + 3 * $$0x.get(SeaPickleBlock.PICKLES)') return ['pickle', 0];
  if (expr === '$$0x -> RespawnAnchorBlock.getLightLevel($$0x, 15)') return ['anchor', 15];
  return null;
}
const text = readFileSync(SRC, 'utf8');
const parts = text.split(/\n    public static final Block \w+ = /).slice(1);
const rows = [], bad = [];
let seen = 0;
for (const p of parts) {
  const nm = p.match(/register\(\s*"(\w+)"/); if (!nm) continue;
  const at = p.indexOf('.luminance('); if (at < 0) continue;
  seen++;
  let i = at + 11, depth = 1, j = i;
  while (depth > 0 && j < p.length) { const c = p[j++]; if (c === '(') depth++; else if (c === ')') depth--; }
  const expr = p.slice(i, j - 1).trim();
  const r = classify(expr);
  if (!r) bad.push(nm[1] + ': ' + expr); else rows.push([nm[1], r[0], r[1]]);
}
const want = { furnace: ['lit', 13], smoker: ['lit', 13], blast_furnace: ['lit', 13], redstone_ore: ['lit', 9], candle_cake: ['lit', 3],
  white_candle: ['candles', 0], light: ['level', 0], sea_pickle: ['pickle', 0], respawn_anchor: ['anchor', 15], cave_vines: ['berries', 14], glow_lichen: ['lichen', 7], torch: ['const', 14] };
for (const [n, [k, v]] of Object.entries(want)) { const r = rows.find((x) => x[0] === n); if (!r || r[1] !== k || r[2] !== v) bad.push(`anchor ${n}: ${r ? r[1] + ' ' + r[2] : 'missing'}, want ${k} ${v}`); }
if (rows.length < 60) bad.push('only ' + rows.length + ' rows');
if (bad.length) { for (const b of bad) console.error(' x ' + b); process.exit(1); }
const out = '# block\trule\tparam — .luminance() per block (tools/extract-luminance.mjs, .decomp Blocks.java)\n' + rows.map((r) => r.join('\t')).join('\n') + '\n';
if (process.argv.includes('--write')) {
  mkdirSync(join(ROOT, 'tools', 'golden'), { recursive: true });
  writeFileSync(OUT, out);
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8').replace(/\r/g, '') !== out) {
  console.error(' x the committed golden differs from .decomp — run node tools/extract-luminance.mjs --write'); process.exit(1);
}
// anti-vacuity: an unknown lambda and a drifted golden must both be refused
let breaks = 0;
if (classify('$$0x -> 99 + foo') === null) breaks++;
if (classify('createLightLevelFromLitBlockState(13)')[1] === 13 && classify('createLightLevelFromLitBlockState(12)')[1] !== 13) breaks++;
if (readFileSync(OUT, 'utf8').replace('furnace\tlit\t13', 'furnace\tlit\t12') !== out) breaks++;
console.log(' ' + (Object.keys(want).length + 1) + ' assertions, 0 failures, ' + breaks + ' breaks caught');
