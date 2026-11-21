#!/usr/bin/env node
// headmodelcheck.mjs — #675: the model golden's `head` rows must hold EVERY cuboid of the vanilla
// builder chain (llama neck + 2 ears, ocelot/cat nose + 2 ears), read from .decomp — not from the
// TSV. The extractor once dropped `cuboid(String,..,Dilation)`. Breaks its own data (anti-vacuity, D-30).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D = join(ROOT, '.decomp/net/minecraft/client/render/entity/model');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { if (c) { breaks++; console.log('  ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };

// expected boxes: every cuboid(...) of the "head" addChild statement, as "x,y,z,w,h,d"
function decompHead(file, startRe) {
  const src = readFileSync(join(D, file), 'utf8');
  const i = src.search(startRe);
  const j = src.indexOf('ModelTransform', i);
  const chain = src.slice(i, j);
  const out = [];
  for (const m of chain.matchAll(/\.cuboid\((?:"\w+",\s*)?(-?[\d.]+)F?,\s*(-?[\d.]+)F?,\s*(-?[\d.]+)F?,\s*(-?[\d.]+)F?,\s*(-?[\d.]+)F?,\s*(-?[\d.]+)F?/g))
    out.push(m.slice(1, 7).map(Number).join(','));
  return out;
}
const rowsOf = (tsv, layer) => tsv.filter((l) => l.startsWith(layer + '\thead\t'))
  .map((l) => l.split('\t').slice(4, 10).map(Number).join(','));
const compare = (tsv, layer, want) => {
  const got = rowsOf(tsv, layer).sort(), w = want.slice().sort();
  return got.length === w.length && got.every((g, k) => g === w[k]);
};

if (!existsSync(D)) { console.log('SKIP - no .decomp'); process.exit(0); }
const tsv = readFileSync(join(ROOT, 'tools/golden/models-1.18.2.tsv'), 'utf8').split('\n');
const want = {
  llama: decompHead('LlamaEntityModel.java', /"head"/), trader_llama: null,
  ocelot: decompHead('OcelotEntityModel.java', /"head"/), cat: null,
};
want.trader_llama = want.llama; want.cat = want.ocelot;
ok(want.llama.length === 4, 'llama head chain reads 4 cuboids, got ' + want.llama.length);
ok(want.ocelot.length === 4, 'ocelot head chain reads 4 cuboids, got ' + want.ocelot.length);
for (const layer of Object.keys(want)) ok(compare(tsv, layer, want[layer]), layer + ' head rows != vanilla builder chain');
// anti-vacuity: drop one row per layer / corrupt one box — the comparison must notice
for (const layer of Object.keys(want)) {
  const idx = tsv.findIndex((l) => l.startsWith(layer + '\thead\t'));
  const dropped = tsv.filter((_, k) => k !== idx);
  okAv(!compare(dropped, layer, want[layer]), layer + ': a missing head cuboid');
  const bent = tsv.slice(); const c = bent[idx].split('\t'); c[4] = String(Number(c[4]) + 1); bent[idx] = c.join('\t');
  okAv(!compare(bent, layer, want[layer]), layer + ': a shifted head cuboid');
}
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
for (const f of fails) console.log('  ✗ ' + f);
console.log('================ headmodelcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
