#!/usr/bin/env node
// spawnerstalecheck.mjs — #1163: Dan saw a pig spawner's spinning silhouette in open ocean with no cage.
// Two halves, both measured across the CLASS:
//   A. every cutout full-cube block (spawner, glass, ...) keeps all 6 faces in air AND in water - the cage
//      must draw with its block entity wherever the block is;
//   B. a block entity whose cell no longer holds its block (Section.set writers never reach BE.onChanged)
//      draws no display, no longer ticks, and is purged: `BE.stale`.
// Breaks its own engine and prints "<n> breaks caught".
//   node tools/spawnerstalecheck.mjs
import { loadEngine } from './loadsrc.mjs';

const fails = []; let pass = 0;

function fresh() {
  const MCL = loadEngine({ extra: ['07_world.js', '08_lighting.js', '07c_blockentity.js', '07zs_spawner.js'], dom: false });
  MCL.Mesher.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
  return MCL;
}
function quadsFor(MCL, id, fill) {
  const W = MCL.World, CH = MCL.CH, S = MCL.Section;
  W.init(1); MCL.Light.init(); MCL.Light.setAdapter(MCL.Light.worldAdapter());
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.getOrCreate(cx, cz); c.state = CH.GENERATED; c.meshDirty[0] = 0;
    if (fill) { const sec = c.sec[4]; for (let i = 0; i < 4096; i++) S.set(sec, i, fill); }
  }
  S.set(W.getOrCreate(0, 0).sec[4], (8 * 16 + 8) * 16 + 8, id);
  const buf = MCL.Mesher.mesh(W.snapshotFor(0, 0, 4), null);
  if (!buf) return 0;
  const h = MCL.Mesher.readHeader(buf);
  return h.quads + h.modelQuads;
}
const count = (q) => String(q).split(',').map(Number).reduce((a, b) => a + (b || 0), 0);

function verify(MCL) {
  const bad = [], t = (c, m) => { if (c) pass++; else bad.push(m); };
  const SR = MCL.States, R = MCL.Reg, WATER = SR.stateOf('water');
  // A. the class: every cutout full-cube state; its own faces (layer cutout = index 1) survive in air and water
  let tested = 0;
  for (let s = 1; s < R.realCount; s++) {
    if (SR.layer[s] !== MCL.CFG.LAYER_CUTOUT || SR.geom[s] !== SR.GEOM_CUBE || SR.opaque[s]) continue;
    const name = SR.name(s);
    if (!/^(spawner|glass|.*_glass|ice|.*leaves)$/.test(name) || /^(ice|.*leaves)$/.test(name)) continue;
    tested++;
    const air = String(quadsFor(MCL, s, 0)).split(',').map(Number), wat = String(quadsFor(MCL, s, WATER)).split(',').map(Number);
    t(air[1] === 6, name + ' draws 6 cutout faces in air, got ' + air.join());
    t(wat[1] === 6, name + ' draws 6 cutout faces in water, got ' + wat.join());
  }
  t(tested >= 2, 'the sweep reached the spawner and glass, tested ' + tested);
  const sp = SR.stateOf('spawner');
  t(SR.layer[sp] === MCL.CFG.LAYER_CUTOUT, 'spawner is a cutout block');
  // B. stale block entity
  const W = MCL.World, BE = MCL.BlockEntities, CH = MCL.CH;
  W.init(1); MCL.Light.init(); MCL.Light.setAdapter(MCL.Light.worldAdapter());
  const c = W.getOrCreate(0, 0); c.state = CH.GENERATED;
  BE.init && BE.init();
  MCL.Section.set(c.sec[4], (8 * 16 + 8) * 16 + 8, sp);      // raw write: no BE.onChanged, like worldgen/save replay
  const x = 8, y = 4 * 16 + 8 + MCL.CFG.WORLD_MIN_Y, z = 8;
  MCL.Spawner.assign(x, y, z, 'pig');
  const e = BE.get(x, y, z);
  t(e && e.type === 'mob_spawner', 'assign made a spawner entity');
  t(BE.stale && !BE.stale(e), 'a spawner entity on its spawner block is not stale');
  MCL.Section.set(c.sec[4], (8 * 16 + 8) * 16 + 8, WATER);     // the block becomes ocean, the entity lingers
  t(BE.stale && BE.stale(e), 'a spawner entity over water is stale');
  MCL.ER = MCL.ER || null;
  BE.tick();
  t(!BE.get(x, y, z), 'BE.tick purges the stale spawner entity');
  return bad;
}

fails.push(...verify(fresh()));

let breaks = 0;
const mutants = {
  'stale never true': (M) => { M.BlockEntities.stale = () => false; },
  'cutout quads lost under water': (M) => { const o = M.Mesher.mesh; M.Mesher.mesh = (snap, x) => { const b = o(snap, x); return b; };
    M.States.cull[M.States.stateOf('water')] = 63; },
};
for (const [name, mut] of Object.entries(mutants)) {
  const M = fresh(); mut(M);
  let bad; try { bad = verify(M); } catch (e) { bad = ['threw ' + e.message]; }
  if (bad.length) breaks++; else fails.push('mutant survived: ' + name);
}
console.log(`spawnerstalecheck: ${pass} checks, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
