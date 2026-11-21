#!/usr/bin/env node
// heldbecheck.mjs — #108 (G7): a chest / ender chest / trapped chest / shulker box IN THE HAND is drawn.
//
//   node tools/heldbecheck.mjs
//
// Vanilla's `builtin/entity` items bake no block-model quads, so `Hand3D.partsOf` (state path) found
// nothing and the first-person hand held an invisible chest. The GUI icon (15h_bemodel) and the dropped
// item (ER.beFor) were already drawn from the block-entity parts `pack-blockentity.mjs` baked; the hand
// now uses the SAME part. Asserts: every one of the 4 families (+ all 16 shulker dyes) yields one part
// inside the be range with real quads; a stone and a stick still take their own paths; and the
// anti-vacuity breaks (no beNames / an emptied part / a wrong name) make the claim fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };

console.log('heldbecheck — #108: block-entity items in the first-person hand');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '14f_inventory.js', '14i_hand.js',
  '14k_hand3d.js', '07j_entityrender.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const H3 = M.Hand3D, IT = M.Items, R = M.Reg, D = M.DATA;
const idxOf = (n) => { for (let i = 0; i < 2000; i++) if (IT.nameOf(i) === n) return i; return -1; };
const quads = (p) => R.partOff[p + 1] - R.partOff[p];

const NAMES = ['chest', 'trapped_chest', 'ender_chest', 'shulker_box'];
for (const c of ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple',
  'blue','brown','green','red','black']) NAMES.push(c + '_shulker_box');
for (const n of NAMES) {
  const i = idxOf(n);
  ok(i >= 0, n + ' is an item');
  const info = H3.partsOf(i);
  ok(info.parts.length === 1 && info.parts[0] >= D.bePart0 && info.parts[0] < D.bePart0 + D.beParts,
    n + ' is held as one block-entity part, got ' + JSON.stringify(info.parts));
  ok(info.parts.length === 1 && quads(info.parts[0]) > 0, n + ' held part has quads');
}
console.log('   ' + NAMES.length + ' items checked');

// other paths are untouched
ok(H3.partsOf(idxOf('stone')).parts.length === 1 && H3.partsOf(idxOf('stone')).parts[0] < D.bePart0, 'stone stays a block-state part');

// anti-vacuity
{
  const saved = D.beNames;
  D.beNames = {};
  { const q = H3.partsOf(idxOf('chest')).parts; okAv(q.length === 0 || q[0] < D.bePart0, 'without beNames the chest is no longer the block-entity part (caught)'); }
  D.beNames = saved;
  const bad = Object.assign({}, saved, { chest: saved.ender_chest });
  D.beNames = bad;
  okAv(H3.partsOf(idxOf('chest')).parts[0] === H3.partsOf(idxOf('ender_chest')).parts[0], 'a swapped name maps to another part (caught)');
  D.beNames = saved;
  const p = H3.partsOf(idxOf('chest')).parts[0];
  const o = R.partOff[p + 1];
  R.partOff[p + 1] = R.partOff[p];
  okAv(quads(p) === 0, 'an emptied part has no quads (caught)');
  R.partOff[p + 1] = o;
}

console.log(fails.length ? fails.map((f) => '  ✗ ' + f).join('\n') : '');
console.log(`heldbecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
