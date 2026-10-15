#!/usr/bin/env node
// lightluminancecheck.mjs — #577: every literal .luminance(n) in the decompiled Blocks.java equals
// block-constants.json emitLight (enchanting_table was 0, vanilla 7).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(R + '.decomp/net/minecraft/block/Blocks.java', 'utf8');
const C = JSON.parse(readFileSync(R + 'assets/block-constants.json', 'utf8')).blocks;
function lits(text) {
  const r = [];
  for (const p of text.split(/register\(\s*"/).slice(1)) {
    const name = p.slice(0, p.indexOf('"')), end = p.indexOf('\n    );');
    for (const n of p.slice(0, end < 0 ? p.length : end).matchAll(/luminance\(\$+\w+ -> (\d+)\)/g)) r.push([name, +n[1]]);
  }
  return r;
}
const bad = (l, c) => l.filter(([b, v]) => !c[b] || c[b].emitLight !== v).map(([b, v]) => `${b}: vanilla ${v}, got ${c[b] && c[b].emitLight}`);
const L = lits(src);
let fails = bad(L, C);
console.log(`${L.length} literal luminances checked`);
for (const f of fails) console.log('   ✗ ' + f);
let breaks = 0;
const C2 = JSON.parse(JSON.stringify(C)); C2[L[0][0]].emitLight = L[0][1] + 1;
if (bad(L, C2).length) { breaks++; console.log('   ✓ break caught: wrong emitLight'); } else fails.push('anti-vacuity: wrong emitLight not caught');
const C3 = JSON.parse(JSON.stringify(C)); C3.enchanting_table.emitLight = 0;
if (bad(L, C3).length) { breaks++; console.log('   ✓ break caught: enchanting_table 0'); } else fails.push('anti-vacuity: enchanting_table 0 not caught');
console.log(`${L.length} checks passed, ${fails.length} failures`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
