#!/usr/bin/env node
// cullworldscan.mjs — #1889 KW-CULL item 5: REAL generated terrain, not synthetic pairs. For every section of a
// seeded region, every full-cube cell face whose neighbour cannot occlude it (vanilla Block.shouldRenderFace:
// !neighbour.canOcclude || !faceFull) must be covered by an emitted greedy quad. Greedy merging preserves area, so
// per (section, face) the emitted quad area (uRep*vRep) must be >= the exposed full-cube area. A deficit is a drawn-by-vanilla
// face the mesher dropped; the culprit block ids are named. Other layers (glass/leaves/water) only ADD area, so this can
// under-detect but never false-alarm.   node tools/cullworldscan.mjs [--seed=N] [--rad=N]
import { loadEngine } from './loadsrc.mjs';

const arg = (k, d) => +((process.argv.find((a) => a.startsWith('--' + k + '=')) || '=' + d).split('=')[1]);
const SEED = arg('seed', 1337), RAD = arg('rad', 2);
const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'], dom: false });
const W = M.World, S = M.Section, Me = M.Mesher, CH = M.CH, CFG = M.CFG, SR = M.States, R = M.Reg;
Me.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
let pass = 0; const fails = [], ok = (c, m) => { if (c && /^anti-vacuity/.test(m)) console.log('  ✓ ' + m.replace(' was not caught', ' caught')); if (c) pass++; else fails.push(m); return c; };

M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { features: true }));
W.init(SEED); M.Light.init(); M.Light.setAdapter(M.Light.worldAdapter());
for (let cx = -RAD - 1; cx <= RAD + 1; cx++) for (let cz = -RAD - 1; cz <= RAD + 1; cz++) {
  const c = W.getOrCreate(cx, cz), col = M.Gen.genColumn(cx, cz); c.sec = col.sec; c.state = CH.GENERATED;
}
const DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** emitted greedy area per face for one section; hook may corrupt (anti-vacuity) */
function emitted(cx, cz, sy, hook, airSolid) {
  SR.cull[0] = airSolid ? 63 : 0;
  const snap = W.snapshotFor(cx, cz, sy), buf = Me.mesh(snap, null); W.releaseSnap(snap); SR.cull[0] = 0;
  const area = [0, 0, 0, 0, 0, 0]; if (!buf) return area;
  const h = Me.readHeader(buf), a = new Uint32Array(buf); let n = 0;
  for (let L = 0; L < 3; L++) for (let i = 0; i < h.quads[L]; i++) {
    if (hook && hook(++n)) continue;
    const o = (h.off[L] >> 2) + i * 8; area[(a[o] >>> 18) & 7] += ((a[o + 1] >>> 12) & 255) * ((a[o + 1] >>> 20) & 255);
  }
  return area;
}
function expected(cx, cz, sy, blame) {
  const area = [0, 0, 0, 0, 0, 0], y0 = CFG.WORLD_MIN_Y + sy * 16, col = W.get(cx, cz);
  for (let ly = 0; ly < 16; ly++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const id = S.get(col.sec[sy], (ly << 8) | (lz << 4) | lx);
    if (!id || SR.cull[id] !== 63 || SR.geom[id] !== 1) continue;   // geom 1 = the greedy path; baked models (geom 2) are cullpairaudit's
    for (let d = 0; d < 6; d++) {
      if (d === 3 && sy === 0 && ly === 0) continue;   // the underside of the world floor (y=-64): never reachable, not drawn
      const nb = W.getBlock((cx << 4) + lx + DIR[d][0], y0 + ly + DIR[d][1], (cz << 4) + lz + DIR[d][2]);
      if (nb && (SR.cull[nb] >> d) & 1) continue;   // SR.cull[nb] bit d = the neighbour in direction d covers its face toward us (cullruleaudit proves the mask)
      area[d]++; if (blame) blame[d].set(R.names[SR.block[id]], (blame[d].get(R.names[SR.block[id]]) || 0) + 1);
    }
  }
  return area;
}
function scan(hook, airSolid) {
  const bad = []; let cells = 0, secs = 0;
  for (let cx = -RAD; cx <= RAD; cx++) for (let cz = -RAD; cz <= RAD; cz++) for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    const blame = [0, 1, 2, 3, 4, 5].map(() => new Map()), ex = expected(cx, cz, sy, blame), em = emitted(cx, cz, sy, hook, airSolid);
    secs++;
    for (let d = 0; d < 6; d++) { cells += ex[d]; if (em[d] < ex[d]) bad.push(`section ${cx},${cz},${sy} face ${d}: vanilla draws ${ex[d]} cube faces, mesher emitted ${em[d]} [${[...blame[d].keys()].slice(0, 4)}]`); }
  }
  return { bad, cells, secs };
}
// calibration: face ids and the area unit (one stone in the open = 6 faces of area 1)
{
  const x = 8, y = 200, z = 8, id = SR.stateOf('stone'); W.setBlock(x, y, z, id);
  const e = emitted(0, 0, (y - CFG.WORLD_MIN_Y) >> 4); W.setBlock(x, y, z, 0);
  ok(e.every((v) => v === 1), 'calibration: a lone stone emits area 1 on each of 6 faces (' + e + ')');
}
const r = scan();
ok(r.bad.length === 0, `${r.bad.length} section-face(s) lose vanilla-visible cube faces:\n     ` + r.bad.slice(0, 15).join('\n     '));
ok(r.cells > 10000, `non-trivial: ${r.cells} exposed cube faces over ${r.secs} sections of real terrain`);
let breaks = 0;
{ const b = scan((n) => n % 9 === 0); breaks++; ok(b.bad.length > 0, 'anti-vacuity: dropping every 9th quad was not caught'); }
{ const b = scan(null, true); breaks++; ok(b.bad.length > 0, 'anti-vacuity: a mesher that treats air as an occluder was not caught'); }
if (fails.length) { console.log(fails.map((f) => '  x ' + f).join('\n')); console.log('\nFAIL cullworldscan'); process.exit(1); }
console.log(`cullworldscan: ${pass} assertions, 0 failures (${breaks} anti-vacuity), ${breaks} breaks caught`);
