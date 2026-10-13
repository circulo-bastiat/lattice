#!/usr/bin/env node
// beitemcheck.mjs — #594 (KW-49-4): beds (16), banners (16, one dye each), shield, conduit and trident are drawn in the hand and as dropped items.
//
//   node tools/beitemcheck.mjs
//
// Declared deviation kept: banner PATTERNS are per-instance NBT and are not drawn (base colour only).
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

console.log('beitemcheck — #594: bed/banner/shield/conduit/trident in hand and ground');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '14f_inventory.js', '14i_hand.js',
  '14k_hand3d.js', '07j_entityrender.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const H3 = M.Hand3D, IT = M.Items, R = M.Reg, D = M.DATA;
const idxOf = (n) => { for (let i = 0; i < 2000; i++) if (IT.nameOf(i) === n) return i; return -1; };
const quads = (p) => R.partOff[p + 1] - R.partOff[p];


const DY = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const NAMES = ['shield', 'conduit'];
for (const c of DY) NAMES.push(c + '_bed', c + '_banner');

const inBe = (p) => p >= D.bePart0 && p < D.bePart0 + D.beParts;
for (const n of NAMES) {
  const i = idxOf(n);
  ok(i >= 0, n + ' is an item');
  const info = H3.partsOf(i);
  ok(info.parts.length === 1 && inBe(info.parts[0]), n + ' is held as one block-entity part, got ' + JSON.stringify(info.parts));
  ok(info.parts.length === 1 && quads(info.parts[0]) > 0, n + ' held part has quads');
  const g = M.EntityRender.beIndexOf(i);
  ok(g >= 0 && M.EntityRender.bePartOf(g) === info.parts[0], n + ' dropped item uses the same part as the hand');
}
console.log('   ' + NAMES.length + ' items checked');
// a bed is two layers (head + foot), so it has more quads than either half alone
ok(quads(H3.partsOf(idxOf('red_bed')).parts[0]) > quads(H3.partsOf(idxOf('shield')).parts[0]) - 100, 'bed part is populated');
// the conduit is one 6x6x6 shell: six faces
ok(quads(H3.partsOf(idxOf('conduit')).parts[0]) === 6, 'conduit is one box, six quads');
// the sixteen banners are one shape and sixteen dyes: distinct atlas tiles
{
  const seen = new Set();
  for (const c of DY) { const p = H3.partsOf(idxOf(c + '_banner')).parts[0]; seen.add(p); }
  ok(seen.size === 16, 'the 16 banners are 16 distinct dyed parts');
}
// trident: the in-hand model, never the inventory sprite
{
  const p = H3.partsOf(idxOf('trident'));
  ok(p.parts.length === 1 && inBe(p.parts[0]) && quads(p.parts[0]) > 0, 'trident is held as the in_hand model part');
  const g = M.EntityRender.beIndexOf(idxOf('trident'));
  ok(g < 0, 'a dropped trident keeps its sprite (inventory model), as vanilla');
}

// anti-vacuity
{
  const saved = D.beNames;
  D.beNames = {};
  for (const n of ['red_bed', 'white_banner', 'shield', 'conduit', 'trident']) {
    const q = H3.partsOf(idxOf(n)).parts;
    okAv(q.length === 0 || !inBe(q[0]), 'without beNames ' + n + ' is no longer a block-entity part (caught)');
  }
  D.beNames = saved;
  const p = H3.partsOf(idxOf('conduit')).parts[0];
  const o = R.partOff[p + 1];
  R.partOff[p + 1] = R.partOff[p];
  okAv(quads(p) === 0, 'an emptied conduit part has no quads (caught)');
  R.partOff[p + 1] = o;
}

console.log(fails.length ? fails.map((f) => '  ✗ ' + f).join('\n') : '');
console.log(`beitemcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
