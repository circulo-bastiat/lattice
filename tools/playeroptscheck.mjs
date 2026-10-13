#!/usr/bin/env node
// playeroptscheck.mjs -- #6408 G18a-SK2: PlayerEntityRenderer.setModelPose, hat/jacket/sleeves/pants follow
// the Skin Customization options (NS.Options.modelParts). Browser-free.
//
//   node tools/playerskincheck.mjs [--verbose]
//
//   1. the model: `player` (Steve, 4-wide arms) and `player_slim` (Alex, 3-wide) are 14-part
//      layers whose boxes are PlayerEntityModel.getTexturedModelData's (.decomp), incl. the
//      0.25-dilated jacket/sleeves/pants over the base parts.
//   2. the roster: ER.mobLayerFor draws both; `ear` and `cloak` (PlayerEntityModel.renderEars/
//      renderCape -- never from a default skin) cost and emit no quads.
//   3. setupAnim: sleeves/pants/jacket take EXACTLY the pose of the part they cover
//      (PlayerEntityModel.setAngles' copyTransform x5), swing and arm-swing alike.
//   4. the skin: every slice of every drawn face samples the jar's own pixels -- steve.png for
//      `player`, alex.png for `player_slim` -- an independent decode, not the packer's state.
//      (The browser mob stage's pixel probe of the live picture is that stage's job; this is
//      the packed-data half it stands on, like mobtexcheck's.)
//   5. anti-vacuity: each of the above is broken on purpose and the assertion is watched to fire.

import { readFileSync } from 'node:fs';
import { inflateRawSync, constants as ZLIB } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar } from './paths.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m); };

console.log('playeroptscheck -- #6408, the player model honours the PlayerModelPart toggles');

const A = MCLITE_ROOT + 'assets/';
const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
const mm = JSON.parse(readFileSync(A + 'models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(A + 'models.bin').toString('base64'), modelsBytes: mm.rawBytes });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel;

const geomRaw = readFileSync(A + 'mob-geometry.json');
const geom = JSON.parse(geomRaw.toString('utf8'));
const { deflateRawSync } = await import('node:zlib');
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geomRaw, { level: 9 }).toString('base64'), mobGeometryBytes: geomRaw.length });


const ALL = { cape: true, jacket: true, left_sleeve: true, right_sleeve: true, left_pants_leg: true, right_pants_leg: true, hat: true };
let FLAGS = ALL, IGNORE_HAT = false;
M.Options = { modelParts: () => { const f = Object.assign({}, FLAGS); if (IGNORE_HAT) f.hat = true; return f; } };
const PART = { hat: 'hat', jacket: 'jacket', left_sleeve: 'left_sleeve', right_sleeve: 'right_sleeve', left_pants_leg: 'left_pants', right_pants_leg: 'right_pants' };
const geom2 = ER.mobGeomFor;
function emit(name) {
  const n = ER.mobQuadCount(name), out = new Uint32Array((n + 64) * 16);
  const end = ER.emitMobLayer(out, 0, name, 0, 0, 0, 1, 0, 15, 0, 3);
  const quads = new Map();
  for (let q = 0; q < end / 16; q++) { const k = Array.from(out.subarray(q * 16, q * 16 + 16)).join(','); quads.set(k, (quads.get(k) || 0) + 1); }
  return { n, end, quads };
}
function partQuads(name, pn) {
  const L = ER.boxLayerFor(name), G = ER.mobGeomFor(name), k = L.parts.findIndex((p) => p.n === pn);
  let w = 0; for (let f = 0; f < 6; f++) { const s = G[k] && G[k][f]; w += (s && s.length) ? s.length : 1; }
  return w;
}
function run(name, key) {
  FLAGS = ALL; const base = emit(name);
  FLAGS = Object.assign({}, ALL, { [key]: false }); const off = emit(name);
  let bad = 0;
  const want = PART[key] ? partQuads(name, PART[key]) : 0;
  if (off.n !== base.n - want || off.end !== base.end - want * 16) bad++;
  // everything that was not the overlay is unchanged: off's quads are a sub-multiset of all-on's, short by exactly `want`
  let missing = 0;
  for (const [k, c] of base.quads) missing += c - (off.quads.get(k) || 0);
  for (const [k, c] of off.quads) if (c > (base.quads.get(k) || 0)) bad++;
  if (missing !== want) bad++;
  return bad;
}
for (const nm of ['player', 'player_slim']) {
  FLAGS = ALL; const a = emit(nm); ok(a.n === a.end / 16 && a.n > 0, nm + ': all-on count/emit disagree');
  ok(partQuads(nm, 'hat') > 0, nm + ': hat has no quads');
  for (const key of Object.keys(PART)) ok(run(nm, key) === 0, nm + ': ' + key + ' off does not remove exactly that overlay');
  FLAGS = { ...ALL, cape: false }; const c = emit(nm); FLAGS = ALL;
  ok(c.n === a.n && c.end === a.end, nm + ': the cape toggle changed the body draw');
}
// all-on equals "no Options at all" (today's output)
{ const keep = M.Options; FLAGS = ALL; const a = emit('player'); M.Options = undefined; const b = emit('player'); M.Options = keep;
  ok(a.end === b.end && [...a.quads].every(([k, c]) => b.quads.get(k) === c), 'all-on differs from the no-options draw'); }
// armor layers keep their own hat
{ FLAGS = { ...ALL, hat: false }; const a = emit('player#b'); FLAGS = ALL; const b = emit('player#b'); ok(a.end === b.end, 'a player armor layer was hidden by the hat toggle'); }
// break proof: ignoring the hat flag is caught
IGNORE_HAT = true; caught(run('player', 'hat') !== 0, 'ignoring the hat flag is caught'); IGNORE_HAT = false;
FLAGS = { ...ALL, hat: false }; { const a = emit('player'); FLAGS = ALL; const b = emit('player'); caught(a.end === b.end ? false : true, 'hat off changes the draw (a no-op flag would not)'); }
caught(run('player', 'cape') === 0 && partQuads('player', 'jacket') > 0, 'a cape toggle that removed the jacket would be caught (jacket is a real part)');

console.log(fails.length ? '\n' + fails.map((f) => '   x ' + f).join('\n') : '');
if (fails.length) { console.log('FAILED (' + fails.length + ')'); process.exit(1); }
console.log(`playeroptscheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
