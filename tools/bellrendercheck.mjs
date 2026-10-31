#!/usr/bin/env node
// bellrendercheck.mjs -- #6392: a PLACED BELL IS DRAWN (BellBlockEntityRenderer).
//
//   node tools/bellrendercheck.mjs
//
// The bell block's own model bakes the frame only; the swinging bell_body (body 6x7x6 + base 8x2x8 on
// entity/bell/bell_body, 32x32) is the block-entity renderer's. It must be on ER.BE_WORLD, off
// ER.BE_WORLD_OWED, draw both boxes, and swing exactly as the renderer's formula says while ringing.
// ANTI-VACUITY: a bell with no layer, no rule, or no ring rule must fail.

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { ok(c, 'anti-vacuity: ' + m); if (c) { breaks++; console.log('   ✓ ' + m); } };
console.log('bellrendercheck -- the placed bell (#6392)');

const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                   modelsBytes: mm.rawBytes });
}
{
  // The real `mob-geometry.json`, deflated into `NS.DATA` exactly as `gen-data.mjs` writes it,
  // so `ER.mobGeomFor`'s own unpack path runs rather than being skipped (mobboxcheck's note).
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, {
    mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length
  });
}
M.EntityList.init();
M.EntityRender.init();
M.BlockEntities.init();

const ER = M.EntityRender, BEM = M.BEModel, BEs = M.BlockEntities, SR = M.States, R = M.Reg;
const Me = M.Mesher, CFG = M.CFG, P_ = R.PROP, V = R.PVAL;
ok(ER.ready, 'the entity renderer is up');
ok(BEs.ready, 'the block-entity store is up');
ok(BEM.ready, 'the model payload decodes');

// a world that answers getBlock from a map, and a constant light
const CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = M.World || {};
M.World.getBlock = (x, y, z) => CELLS.get(key(x, y, z)) || 0;
M.World.getLight = () => 0xF0;
const put = (x, y, z, st, type) => {
  CELLS.set(key(x, y, z), st);
  BEs.remove(x, y, z);
  const e = BEs.create(x, y, z, type);
  return e;
};


const placeBell = () => {
  CELLS.clear(); BEs.clear();
  CELLS.set('0,70,0', SR.stateOf('bell'));
  return BEs.create(0, 70, 0, 'bell');
};

ok(!!ER.BE_WORLD.bell && ER.BE_WORLD.bell.layer === 'bell', 'bell is on the drawn table');
ok(!ER.BE_WORLD_OWED.some((t) => /^bell\b/.test(t)), 'and off the owed list');
const e = placeBell();
const v = ER.beWorldItem(e, 0);
ok(!!v && v.layer === 'bell', 'the rule resolves the bell layer');
const parts = BEM.layer('bell').parts.map((p) => p.n).sort().join(',');
ok(parts === 'bell_base,bell_body', 'the layer is body + base (' + parts + ')');
const b = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
ok(!!b && b.drawn === 1, 'a placed bell draws its one layer (' + (b && b.drawn) + ')');

// the ring swing: sin(t/PI)/(4+t/3) on pitch (north -, south +) or roll (east -, west +)
e.ringing = true; e.ticks = 5;
const t = 5.5, s = Math.sin(t / Math.PI) / (4 + t / 3);
for (const [dir, ax, sg] of [['north', 'rx', -1], ['south', 'rx', 1], ['east', 'rz', -1], ['west', 'rz', 1]]) {
  e.lastSideHit = dir;
  const d = ER.bellAnim(e, 0.5).deltaFor('bell_body');
  ok(d && Math.abs(d[ax] - sg * s) < 1e-9 && Math.abs(d[ax === 'rx' ? 'rz' : 'rx']) < 1e-12, 'ringing ' + dir + ': ' + ax + ' = ' + sg + '*s');
}
e.ringing = false;
const rest = ER.bellAnim(e, 0.5).deltaFor('bell_body');
ok(rest.rx === 0 && rest.rz === 0, 'not ringing: at rest');

okAv((() => { const sv = ER.BE_WORLD.bell; delete ER.BE_WORLD.bell; const r = ER.beWorldItem(placeBell(), 0); ER.BE_WORLD.bell = sv; return !r; })(), 'a bell off the drawn table has no rule');
okAv((() => { const g = ER.boxLayerFor; ER.boxLayerFor = (n, k) => (n === 'bell' ? null : g(n, k));
  const bb = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1); ER.boxLayerFor = g; return !bb || bb.drawn === 0; })(), 'a bell with no packed layer draws nothing');
okAv((() => { const sv = ER.bellAnim; ER.bellAnim = () => ({ deltaFor: () => null });
  const x = placeBell(); x.ringing = true; x.ticks = 5; x.lastSideHit = 'north';
  const d = ER.bellAnim(x, 0.5).deltaFor('bell_body'); ER.bellAnim = sv; return !d; })(), 'without the ring rule the bell never swings');

console.log(' bellrendercheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   x ' + f); process.exit(1); }
