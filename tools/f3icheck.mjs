#!/usr/bin/env node
// f3icheck.mjs — G17-K5. F3+I formatter (Commands.copyLookAt / stateString): /setblock and /summon text.
//   node tools/f3icheck.mjs
// Breaks its own source (drops the [..] block-state brackets) and the check must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/15g_commands.js'), 'utf8');
// the formatter only needs a registry stub with oak_stairs facing/half/waterlogged (+ chest as a plain block)
function stubNS() {
  const NS = {};
  NS.Reg = { names: ['oak_stairs', 'chest'], realFirst: [0, 1000], propFirst: [0, 3, 3], propId: [0, 1, 2],
    propNames: ['half', 'facing', 'waterlogged'], valueNames: ['east', 'bottom', 'false'],
    propVals: [1, 0, 2], propValOff: [0, 1, 2], propValN: [1, 1, 1], propStride: [1, 1, 1] };
  NS.States = { block: { 5: 0, 1005: 1 } };
  return NS;
}
function load(src) {
  const m = src.match(/C\.stateString = [\s\S]*?(?=  \/\*\* `minecraft:item_slot`)/)[0];
  const snbt = src.match(/var snbtStr = [\s\S]*?\n  \};\n/)[0];
  const NS = stubNS(), C = {};
  new Function('NS', 'C', snbt + m + 'return C;')(NS, C);
  return C;
}
let asserted = 0;
function verify(C) {
  const f = [], eq = (a, b, m) => { asserted++; if (a !== b) f.push(m + ': got ' + a); };
  eq(C.copyLookAt({ kind: 'block', x: 1, y: 64, z: -3, state: 5 }), '/setblock 1 64 -3 minecraft:oak_stairs[facing=east,half=bottom,waterlogged=false]', 'stairs');
  eq(C.copyLookAt({ kind: 'block', x: 0, y: 70, z: 2, state: 1005, nbt: { Items: [{ Slot: 0, id: 'minecraft:stick', Count: 3 }] } }),
    '/setblock 0 70 2 minecraft:chest{Items: [{Slot: 0, id: "minecraft:stick", Count: 3}]}', 'chest');
  eq(C.copyLookAt({ kind: 'entity', id: 'minecraft:cow', x: 1.005, y: 64, z: -2.5, nbt: { id: 'minecraft:cow', UUID: 1, Pos: [1], Health: 10, CustomName: '"Bessie"' } }),
    '/summon minecraft:cow 1.00 64.00 -2.50 {id: "minecraft:cow", Health: 10, CustomName: "\\"Bessie\\""}', 'cow');
  return f;
}
const base = verify(load(SRC));
if (base.length) { console.log('FAIL', base.join('; ')); process.exit(1); }
let caught = 0, total = 0;
for (const [a, b] of [["(parts.length ? '[' +", "(false ? '[' +"], ["(t.nbt ? snbtStr(t.nbt) : '')", "''"], ["k !== 'Pos' &&", ""]]) {
  total++;
  if (!SRC.includes(a)) { console.log('FAIL break target missing: ' + a); process.exit(1); }
  let r; try { r = verify(load(SRC.replace(a, b))); } catch (e) { r = ['threw']; }
  if (r.length) { caught++; console.log('  ✓ break caught: ' + b.slice(0, 30)); }
}
console.log(`assertions passed ..... ${asserted}`);
console.log(`${caught} breaks caught (f3icheck OK)`);
process.exit(caught === total ? 0 : 1);
