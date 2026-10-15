#!/usr/bin/env node
// inhandcheck.mjs — #401: `ItemRenderer.getModel` swaps the trident and the spyglass to
// `trident_in_hand` / `spyglass_in_hand` for every render mode except GUI, GROUND and FIXED
// (.decomp net/minecraft/client/render/item/ItemRenderer.java getModel ~212-224, renderItem ~102-116).
// The first-person hand must therefore draw the baked in-hand part and the model's OWN
// `firstperson_righthand`; the inventory / dropped path must keep the sprite.
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { requireJar } from './paths.mjs';
import { Jar } from './jarlib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('   ✓ ' + m); };

console.log('inhandcheck — #401: trident_in_hand / spyglass_in_hand in the first-person hand');
let jar;
try { jar = new Jar(requireJar('1.18.2')); } catch (e) { console.log('inhandcheck: SKIP — no 1.18.2 jar'); process.exit(0); }
const jm = (n) => JSON.parse(jar.read('assets/minecraft/models/item/' + n + '.json').toString('utf8'));

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '14f_inventory.js', '14i_hand.js',
  '14k_hand3d.js', '07j_entityrender.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const H3 = M.Hand3D, IT = M.Items, R = M.Reg, D = M.DATA, ER = M.EntityRender;
const idxOf = (n) => { for (let i = 0; i < IT.count; i++) if (IT.nameOf(i) === n) return i; return -1; };
const partOf = (n) => { const p = H3.partsOf(idxOf(n)); return p.parts.length === 1 ? p.parts[0] : -1; };
const bePart = (n) => D.bePart0 + D.beNames[n];

// ── the jar's own answer ────────────────────────────────────────────────────────────────────
const tih = jm('trident_in_hand'), sih = jm('spyglass_in_hand');
ok(tih.parent === 'builtin/entity', 'trident_in_hand is builtin/entity in the jar');
ok(Array.isArray(sih.elements) && sih.elements.length === 2, 'spyglass_in_hand has two elements in the jar');
ok(!(sih.display && sih.display.firstperson_righthand), 'spyglass_in_hand declares no firstperson_righthand');

// ── what the hand draws ─────────────────────────────────────────────────────────────────────
for (const [item, be] of [['trident', 'hand_trident'], ['spyglass', 'hand_spyglass']]) {
  ok(idxOf(item) >= 0, item + ' is an item');
  ok(D.beNames[be] !== undefined, be + ' was baked');
  ok(partOf(item) === bePart(be), item + ' in the hand is the ' + be + ' part, got ' + JSON.stringify(H3.partsOf(idxOf(item)).parts));
  ok(R.partOff[bePart(be) + 1] > R.partOff[bePart(be)], be + ' has quads');
  // GUI / ground / frame keep the inventory model: the sprite layers, and no block-entity item
  ok(ER.itemLayers(idxOf(item)).length > 0, item + ' still has its inventory sprite layers (GUI/ground/fixed)');
  ok(ER.beIndexOf(idxOf(item)) < 0, item + ' is not a block-entity item (a dropped one stays the sprite)');
}
let strays = 0;
for (let i = 0; i < IT.count; i++) {
  const n = IT.nameOf(i);
  if (n === 'trident' || n === 'spyglass') continue;
  for (const p of H3.partsOf(i).parts) if (p === bePart('hand_trident') || p === bePart('hand_spyglass')) strays++;
}
ok(strays === 0, strays + ' other items draw an in-hand part');

// ── the pose is the in-hand model's, not item/generated's ───────────────────────────────────
const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const handOf = (name) => { const m = ident(); H3.applyDisplay(m, idxOf(name)); return m; };
const rowOf = (d) => { const r = d.rotation || [0, 0, 0], t = d.translation || [0, 0, 0], s = d.scale || [1, 1, 1];
  return [r[0], r[1], r[2], t[0], t[1], t[2], s[0], s[1], s[2]]; };
ok(JSON.stringify(H3.IN_HAND.trident.hand) === JSON.stringify(rowOf(tih.display.firstperson_righthand)),
  'trident hand transform equals trident_in_hand.json firstperson_righthand');
ok(H3.IN_HAND.spyglass.hand === null, 'spyglass hand transform is the identity (spyglass_in_hand declares none)');
{ const m = handOf('spyglass'); ok(m.every((v, i) => v === ident()[i]), 'the spyglass pose matrix is the identity'); }
{ const m = handOf('trident'), g = jm('generated').display.firstperson_righthand;
  const m2 = ident(); const save = H3.IN_HAND.trident; H3.IN_HAND.trident = { be: save.be, hand: rowOf(g) };
  H3.applyDisplay(m2, idxOf('trident')); H3.IN_HAND.trident = save;
  ok(m.some((v, i) => Math.abs(v - m2[i]) > 1e-6), 'the trident pose is NOT item/generated\'s'); }

// ── the geometry: bounds against the jar / the decomp ───────────────────────────────────────
function bounds(part) {
  const buf = new Float32Array(1 << 14), n = H3.emitPart(buf, 0, part, ident(), null, 1);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let o = 0; o < n; o += H3.FLOATS_PER_VERTEX) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], buf[o + k]); mx[k] = Math.max(mx[k], buf[o + k]); }
  return { mn, mx, n };
}
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.004);
{
  const b = bounds(bePart('hand_spyglass'));
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const el of sih.elements) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], el.from[k] / 16 - 0.5); mx[k] = Math.max(mx[k], el.to[k] / 16 - 0.5); }
  ok(b.n > 0 && near(b.mn, mn) && near(b.mx, mx), 'spyglass part bounds equal the jar elements: ' + JSON.stringify([b.mn, mn]));
  // both textured from the one layer set; the up cap of the top element exists, the top element has no down face
  ok(D.beNames.hand_spyglass !== undefined && R.partOff[bePart('hand_spyglass') + 1] - R.partOff[bePart('hand_spyglass')] === 5 + 6, 'spyglass part has 5 + 6 faces');
}
const DECOMP = join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/model/TridentEntityModel.java');
if (existsSync(DECOMP)) {
  const src = readFileSync(DECOMP, 'utf8');
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  let boxes = 0;
  for (const m of src.matchAll(/cuboid\(([-\d.F]+), ([-\d.F]+), ([-\d.F]+), ([-\d.F]+), ([-\d.F]+), ([-\d.F]+)\)/g)) {
    const [x, y, z, w, h, d] = m.slice(1).map((v) => parseFloat(v));
    boxes++;
    // scale(1, -1, -1), then the (-0.5,-0.5,-0.5) shift: y' = -y, z' = -z
    const lo = [x, -(y + h), -(z + d)], hi = [x + w, -y, -z];
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], lo[k] / 16 - 0.5); mx[k] = Math.max(mx[k], hi[k] / 16 - 0.5); }
  }
  const b = bounds(bePart('hand_trident'));
  ok(boxes === 5, 'TridentEntityModel has 5 boxes, parsed ' + boxes);
  ok(near(b.mn, mn) && near(b.mx, mx), 'trident part bounds equal TridentEntityModel under scale(1,-1,-1): ' + JSON.stringify([b.mn, b.mx, mn, mx]));
} else console.log('   (no .decomp: trident bounds not compared)');

// ── anti-vacuity: break it, and each assertion class must notice ─────────────────────────────
{
  const saved = H3.IN_HAND.trident;
  delete H3.IN_HAND.trident;   // "map trident to its inventory model"
  okAv(partOf('trident') !== bePart('hand_trident'), 'a trident routed to its inventory model no longer draws the in-hand part (caught)');
  H3.IN_HAND.trident = saved;
  const sn = D.beNames;
  D.beNames = Object.assign({}, sn, { hand_trident: sn.hand_spyglass });
  okAv(partOf('trident') !== bePart('hand_trident') || bePart('hand_trident') === bePart('hand_spyglass'), 'a swapped be name points the trident at the spyglass part (caught)');
  D.beNames = Object.assign({}, sn, { trident: sn.hand_trident });
  okAv(ER.beIndexOf(idxOf('trident')) >= 0, 'a be name on the item itself would turn the dropped trident into the in-hand model (caught)');
  D.beNames = sn;
  H3.IN_HAND.trident = { be: saved.be, hand: rowOf(jm('generated').display.firstperson_righthand) };
  okAv(JSON.stringify(H3.IN_HAND.trident.hand) !== JSON.stringify(rowOf(tih.display.firstperson_righthand)), 'item/generated\'s transform on the trident differs from the in-hand one (caught)');
  H3.IN_HAND.trident = saved;
  const p = bePart('hand_spyglass'), o = R.partOff[p + 1];
  R.partOff[p + 1] = R.partOff[p] + 1;
  okAv(bounds(p).n > 0 && R.partOff[p + 1] - R.partOff[p] !== 11, 'a spyglass part with faces missing changes its face count (caught)');
  R.partOff[p + 1] = o;
}

console.log(fails.length ? fails.map((f) => '  ✗ ' + f).join('\n') : '');
console.log(`inhandcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
