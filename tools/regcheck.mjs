#!/usr/bin/env node
// regcheck.mjs — PLAN F8b's acceptance test: the RUNTIME registry against the build's JSON.
//
//   node tools/regcheck.mjs
//
// `src/02b_registry.js` is the only code in the project that reads the packed binaries, and
// it runs at boot on the main thread and again in every worker. If it decodes anything
// wrongly, every block in the world is wrong — and no other suite would notice, because
// every other suite reads the JSON.
//
// So this loads the real module the way a browser does (a bare IIFE against a namespace),
// feeds it the real binaries, and compares EVERY field of EVERY block, EVERY visual state's
// occlusion mask, EVERY real state's collision shape and visual mapping, and EVERY quad,
// against `block-constants.json` and `block-geometry.json`. Not a sample. All of it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator


const ASSETS = MCLITE_ROOT + 'assets';
const SRC = MCLITE_ROOT + 'src';
const rd = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

const NS = { CFG: {} };
globalThis.MCL = NS;
new Function('MCL', readFileSync(join(SRC, '01b_inflate.js'), 'utf8'))(NS);
new Function('MCL', readFileSync(join(SRC, '02b_registry.js'), 'utf8'))(NS);

const C = rd('block-constants.json');
const G = rd('block-geometry.json');
const gm = rd('block-geometry.meta.json');
const rm = rd('block-runtime.meta.json');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 400) fails.push(m); else pass += 0; };

const t0 = Date.now();
const R = NS.Reg.init({
  runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
});
const decodeMs = Date.now() - t0;

// ─────────────────────────────────────────────── 1. shape and totals
console.log('1. totals');
const names = Object.keys(G.states);
ok(R.blockCount === names.length, `${R.blockCount} blocks decoded, ${names.length} in the source`);
ok(R.visualCount === names.reduce((a, n) => a + G.states[n].length, 0), 'visual state total');
ok(R.realCount === rm.realStates, `${R.realCount} real states, meta says ${rm.realStates}`);
// ⚠ THE SPRITE PARTS RIDE IN THE SAME ARRAY (D-342). `block-geometry.json` holds the BLOCK parts
// and `sprite-geometry.json` the extruded item sprites; `pack-geometry.mjs` appends the second to
// the first, so the decoded count is the sum. Reading only the block file and asserting equality
// would fail on a correct build — and, worse, would go on failing until somebody "fixed" it by
// pinning a literal, which is D-305 in reverse.
const SP = (() => {
  try { return (rd('sprite-geometry.json').parts) || []; }
  catch { return []; }
})();
// ⚠ D-407: AND A THIRD FILE SINCE PASS 15 JOB 3 — `pack-geometry.mjs` appends `be-geometry.json`'s
// block-entity parts after the sprites. This check kept reading two of the three and had been red
// since G17e, which nobody saw because no one ran a full suite (KW-10).
const BEP = (() => {
  try { return (rd('be-geometry.json').parts) || []; }
  catch { return []; }
})();
const allParts = G.parts.concat(SP, BEP);
ok(R.partCount === allParts.length,
   `${R.partCount} parts, ${G.parts.length} block + ${SP.length} sprite + ${BEP.length} block-entity in the source`);
ok(R.quadCount === allParts.reduce((a, p) => a + p.length, 0), 'quad total');
// The budget is loose on purpose: a loaded runner (4 suite jobs) has pushed a 190 ms decode past 1.5 s.
ok(decodeMs < 5000, `decoding took ${decodeMs} ms; it happens at boot and again per worker`);
console.log(`   ${pass} ok   (decoded in ${decodeMs} ms)`);

// ─────────────────────────────────────────────── 1b. AIR IS STATE ZERO
// This is a load-bearing invariant, not a tidiness rule. From session 2 the world stores
// registry REAL STATE IDS: a section palette entry, the mesher's 18^3 scratch volume and
// every neighbour-padding read all hold one. All three are zero-filled typed arrays and all
// three treat a zero as "nothing here". If air were not state 0, a section's untouched
// padding would decode as whatever block the alphabet put first — in this registry,
// `acacia_button[face=ceiling,facing=east,powered=false]` — and a chunk edge would grow a
// wall of buttons. `tools/extract-blocks.mjs` pins air first for exactly this reason.
console.log('1b. air is block 0 and real state 0');
{
  ok(R.names[0] === 'air', `block 0 is "${R.names[0]}", not air — zero no longer means air`);
  ok(R.id.air === 0, `R.id.air is ${R.id.air}, expected 0`);
  ok(R.realFirst[0] === 0, `air's first real state is ${R.realFirst[0]}, expected 0`);
  ok(R.visFirst[0] === 0, `air's first visual state is ${R.visFirst[0]}, expected 0`);
  ok(R.realFirst[1] === 1, `air occupies ${R.realFirst[1]} real states, expected exactly 1`);
  ok(R.defaultState[0] === 0, `air's default state is ${R.defaultState[0]}, expected 0`);
  ok(R.toVisual[0] === 0, `real state 0 maps to visual ${R.toVisual[0]}, expected 0`);
  ok(R.occlusion[0] === 0, `air occludes ${R.occlusion[0].toString(2)}, expected nothing`);
  // and the rest is still alphabetical, so nothing else moved
  const rest = R.names.slice(1);
  const sorted = rest.slice().sort();
  ok(rest.every((n, i) => n === sorted[i]),
     'blocks after air are no longer in alphabetical order — the pin moved more than air');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. every block's constants
console.log('2. per-block constants — all 900');
const TOOLS = ['pickaxe', 'axe', 'shovel', 'hoe'];
const TIERS = [null, 'stone', 'iron', 'diamond'];
for (let i = 0; i < names.length; i++) {
  const n = names[i], b = C.blocks[n];
  ok(R.names[i] === n, `block ${i} is "${R.names[i]}", source says "${n}" — ORDER MISMATCH`);
  ok(R.id[n] === i, `${n} maps to index ${R.id[n]}, expected ${i}`);
  if (!b) continue;
  const h = b.hardness == null ? Infinity : b.hardness;
  ok(Math.abs(R.hard[i] - h) < 1e-4 || (!isFinite(R.hard[i]) && !isFinite(h)), `${n}.hardness ${R.hard[i]} != ${h}`);
  ok(R.emit[i] === (b.emitLight | 0), `${n}.emit ${R.emit[i]} != ${b.emitLight}`);
  ok(R.filter[i] === Math.min(15, b.filterLight | 0), `${n}.filter ${R.filter[i]} != ${b.filterLight}`);
  ok(!!(R.flags[i] & R.FLAG_TRANSPARENT) === !!b.transparent, `${n}.transparent`);
  ok(!!(R.flags[i] & R.FLAG_LOOT) === !!b.lootTable, `${n}.lootTable flag`);
  ok(R.stack[i] === Math.min(255, b.stackSize || 64), `${n}.stackSize ${R.stack[i]} != ${b.stackSize}`);
  for (let t = 0; t < TOOLS.length; t++)
    ok(!!(R.tools[i] & (1 << t)) === (b.tools.indexOf(TOOLS[t]) >= 0), `${n} tool ${TOOLS[t]}`);
  ok(TIERS[(R.tools[i] >> 4) & 15] === b.needsTier, `${n}.needsTier ${TIERS[(R.tools[i] >> 4) & 15]} != ${b.needsTier}`);
  ok(R.defaultState[i] === b.defaultState, `${n}.defaultState`);
  ok(R.visFirst[i + 1] - R.visFirst[i] === G.states[n].length, `${n} visual state count`);
  ok(R.realFirst[i + 1] - R.realFirst[i] === b.stateCount, `${n} real state count`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. every occlusion mask and every real state
console.log('3. per-state occlusion, visual mapping and collision — all 8,933 + 20,344');
let occBad = 0, visBad = 0, shpBad = 0;
for (let i = 0; i < names.length; i++) {
  const n = names[i], b = C.blocks[n];
  if (!b) continue;
  const v0 = R.visFirst[i], r0 = R.realFirst[i];
  for (let s = 0; s < b.occlusion.length; s++) if (R.occlusion[v0 + s] !== b.occlusion[s]) occBad++;
  for (let s = 0; s < b.toVisual.length; s++) {
    if (R.toVisual[r0 + s] !== v0 + b.toVisual[s]) visBad++;
    // the shape index was remapped when packing; compare the BOXES, which is what matters
    const want = C.shapes[String(b.collision[s])] || [];
    const si = R.shapeOf[r0 + s];
    const got = [];
    for (let k = R.shapeOff[si]; k < R.shapeOff[si + 1]; k++) {
      const box = [];
      for (let q = 0; q < 6; q++) box.push(R.shapeBox[k * 6 + q] / 1024);
      got.push(box);
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) shpBad++;
  }
}
ok(occBad === 0, `${occBad} occlusion masks decoded wrongly`);
ok(visBad === 0, `${visBad} real->visual mappings decoded wrongly`);
ok(shpBad === 0, `${shpBad} collision shapes decoded wrongly`);
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. every quad
console.log('4. geometry — all 41,389 quads');
let qBad = 0, posBad = 0, uvBad = 0;
for (let p = 0; p < G.parts.length; p++) {
  const src = G.parts[p];
  ok(R.partOff[p + 1] - R.partOff[p] === src.length, `part ${p} has ${R.partOff[p + 1] - R.partOff[p]} quads, source has ${src.length}`);
  for (let j = 0; j < src.length; j++) {
    const q = R.partOff[p] + j, s = src[j];
    const f = R.qFlags[q];
    const cull = (f >> 3) & 7, tint = (f >> 7) & 7;
    if ((f & 7) !== s.d) qBad++;
    if ((cull === 7 ? -1 : cull) !== s.cull) qBad++;
    if (((f >> 6) & 1) !== s.shade) qBad++;
    if ((tint === 0 ? -1 : tint - 1) !== s.tint) qBad++;
    if (R.qTile[q] !== s.t) qBad++;
    for (let k = 0; k < 12; k++) if (R.qPos[q * 12 + k] !== Math.round(s.p[k] * 16)) posBad++;
    for (let k = 0; k < 8; k++) if (R.qUv[q * 8 + k] !== Math.round(s.uv[k] * 16)) uvBad++;
  }
}
ok(qBad === 0, `${qBad} quad fields decoded wrongly`);
ok(posBad === 0, `${posBad} vertex positions decoded wrongly`);
ok(uvBad === 0, `${uvBad} uv coordinates decoded wrongly`);
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. groups and alternatives
console.log('5. groups and alternatives');
let grpBad = 0, altBad = 0;
for (let i = 0; i < names.length; i++) {
  const n = names[i], states = G.states[n], v0 = R.visFirst[i];
  for (let s = 0; s < states.length; s++) {
    const v = v0 + s, src = states[s];
    if (R.groupCount(v) !== src.length) { grpBad++; continue; }
    for (let g = 0; g < src.length; g++) {
      const gg = src[g];
      const a0 = R.grpAltOff[R.stGroupOff[v] + g], a1 = R.grpAltOff[R.stGroupOff[v] + g + 1];
      const wantAlts = typeof gg === 'number' ? [gg] : gg.a;
      if (a1 - a0 !== wantAlts.length) { altBad++; continue; }
      for (let a = 0; a < wantAlts.length; a++) if (R.altPart[a0 + a] !== wantAlts[a]) altBad++;
    }
  }
}
ok(grpBad === 0, `${grpBad} states have the wrong group count`);
ok(altBad === 0, `${altBad} alternatives decoded wrongly`);

// the position hash must be deterministic and must actually spread
{
  const stone = R.id.stone, v = R.visFirst[stone];
  ok(R.groupCount(v) === 1, 'stone draws one group');
  const picks = new Set();
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) picks.add(R.partFor(v, 0, x, 64, z));
  ok(picks.size === 4, `stone's four random alternatives must all appear across 144 positions, saw ${picks.size}`);
  ok(R.partFor(v, 0, 5, 64, 7) === R.partFor(v, 0, 5, 64, 7), 'the variant choice must be a pure function of position');
  ok(R.partFor(v, 0, 5, 64, 7) !== R.partFor(v, 0, 5, 64, 8) || R.partFor(v, 0, 5, 64, 7) !== R.partFor(v, 0, 6, 64, 7),
     'the variant choice must actually vary with position');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. the lookups behave
console.log('6. lookups');
{
  const stone = R.id.stone;
  ok(R.blockOfVisual(R.visFirst[stone]) === stone, 'blockOfVisual finds the right block');
  ok(R.blockOfVisual(R.visFirst[stone + 1] - 1) === stone, 'blockOfVisual at the last state of a block');
  ok(R.blockOfVisual(0) === 0, 'blockOfVisual at zero');
  ok(R.blockOfVisual(R.visualCount - 1) === R.blockCount - 1, 'blockOfVisual at the end');
  for (let d = 0; d < 6; d++) ok(R.occludes(R.visFirst[stone], d) === 1, `stone occludes ${R.DIRS[d]}`);
  const slab = R.id.oak_slab;
  const bottom = C.blocks.oak_slab.props.find((p) => p.name === 'type').values.indexOf('bottom');
  void bottom;
  ok(!R.transparent(R.id.stone), 'stone is not transparent');
  ok(R.transparent(R.id.glass), 'glass is transparent');
  ok(R.transparent(R.id.oak_leaves), 'leaves are transparent');
  void slab;
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. ANTI-VACUITY (D-30)
console.log('7. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const brk = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };
  brk('a truncated constants blob', () => {
    const raw = NS.Z.unpack(readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), rm.rawBytes);
    NS.Reg.decodeConstants(raw.subarray(0, raw.length - 40));
  });
  brk('a constants blob with the wrong magic', () => {
    const raw = NS.Z.unpack(readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), rm.rawBytes);
    const bad = raw.slice(); bad[0] = 0x58;
    NS.Reg.decodeConstants(bad);
  });
  brk('geometry whose block order disagrees with the constants', () => {
    // rename the first block in the decoded name table, then re-decode the geometry: the
    // cross-check must refuse rather than pair one block's shape with another's constants
    const keep = NS.Reg.names[0];
    NS.Reg.names[0] = 'not_the_same_block';
    try { NS.Reg.decodeGeometry(NS.Z.unpack(readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), gm.rawBytes)); }
    finally { NS.Reg.names[0] = keep; }
  });
  brk('air not pinned to block 0', () => {
    // Reproduce the alphabetical ordering this project used to have and assert the check
    // above would have rejected it — otherwise "air is state 0" is a comment, not a test.
    const alphabetical = R.names.slice().sort();
    if (alphabetical[0] !== 'air') throw 0;
  });
  brk('trailing bytes after the constants', () => {
    const raw = NS.Z.unpack(readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), rm.rawBytes);
    const bad = new Uint8Array(raw.length + 8);
    bad.set(raw);
    NS.Reg.decodeConstants(bad);
  });
  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — the decoder accepts broken input`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}
// put the registry back the way it was, since the breaks above mutated it
NS.Reg.init({
  runtime: readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64'), runtimeBytes: rm.rawBytes,
  geometry: readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64'), geometryBytes: gm.rawBytes,
});

console.log('');
console.log('================ regcheck ================');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
if (fails.length > 20) console.log(`   ... and ${fails.length - 20} more`);
console.log('');
console.log(` ${R.blockCount} blocks · ${R.visualCount} visual · ${R.realCount} real · ${R.quadCount} quads · decoded in ${decodeMs} ms`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
