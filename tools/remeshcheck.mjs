#!/usr/bin/env node
// remeshcheck.mjs — KW-48b (#578): blocks still turn see-through after breaking. AUDIT of every remesh
// path, headless: the REAL World streamer + Jobs (inline) + Mesher, a solid stone block with glass and
// leaves in it, edits at every section-edge class, and after each edit the pipeline's delivered mesh
// (and vis mask) of EVERY section is compared with a from-scratch remesh of the same world.
//   node tools/remeshcheck.mjs [--nobreak]
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m, d) => { if (c) pass++; else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };

const R = 3, SY0 = 5, SY1 = 6;   // chunks -R..R, stone sections SY0..SY1

function build(patch) {
  const M = loadEngine({ extra: ['07_world.js', '09_jobs.js'], dom: true, patch });
  const W = M.World, J = M.Jobs, CFG = M.CFG, CH = M.CH, SC = M.Section, S = M.States;
  const meshes = new Map();
  M.Gfx = { setSectionMesh(cx, cz, sy, buf) { meshes.set(W.sectionKey(cx, cz, sy), buf ? Buffer.from(new Uint8Array(buf)).toString('base64') : null); } };
  J.mode = 'inline';
  const stone = S.stateOf('stone'), glass = S.stateOf('glass'), leaves = S.stateOf('oak_leaves');
  for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
    const c = W.getOrCreate(cx, cz);
    for (let sy = SY0; sy <= SY1; sy++) SC.fill(c.sec[sy], stone);
    c.state = CH.GENERATED;
    let m = 0; for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) m |= 1 << sy;
    c.meshDirty[0] = m;
  }
  const at = (x, y, z, id) => SC.set(W.get(x >> 4, z >> 4).sec[(y - CFG.WORLD_MIN_Y) >> 4], (((y - CFG.WORLD_MIN_Y) & 15) << 8) | ((z & 15) << 4) | (x & 15), id);
  // cutout/translucent blocks sprinkled through the core, several on section edges
  for (let i = 0; i < 40; i++) at(((i * 7) % 40) - 20, CFG.WORLD_MIN_Y + SY0 * 16 + ((i * 5) % 32), ((i * 11) % 40) - 20, i & 1 ? glass : leaves);
  return { M, W, J, CFG, meshes, stone, glass, leaves };
}

// one frame: stream + pump, microtasks flushed so promise callbacks land
async function frames(e, n, pumpMicros) {
  for (let i = 0; i < n; i++) { e.W.stream(0, 0, 2); e.J.pump(pumpMicros || 1e9); await Promise.resolve(); await Promise.resolve(); }
}
const pendingWork = (e) => { let d = 0; e.W.chunks.forEach((c) => { if (c.cx * c.cx + c.cz * c.cz <= 4) d += c.meshDirty[0] ? 1 : 0; }); return d + e.W.meshJobs.size + e.J.queue.length; };
async function settle(e) { for (let i = 0; i < 400 && (i < 2 || pendingWork(e)); i++) await frames(e, 1); return !pendingWork(e); }

// sections whose delivered mesh / vis differs from a from-scratch remesh
function diffs(e) {
  const { W, CFG, M } = e; const bad = [];
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) for (let sy = 3; sy <= 8; sy++) {
    if (cx * cx + cz * cz > 4) continue;   // outside the streamed disc (rd 2)
    const buf = M.Mesher.mesh(W.snapshotFor(cx, cz, sy), null, cx * 16, CFG.WORLD_MIN_Y + sy * 16, cz * 16);
    const vis = M.Mesher.lastVis & 0x7FFF;
    const want = buf ? Buffer.from(new Uint8Array(buf)).toString('base64') : null;
    const got = e.meshes.get(W.sectionKey(cx, cz, sy)) || null;
    const c = W.get(cx, cz);
    if (got !== want) bad.push(`mesh ${cx},${cz},${sy}`);
    else if ((c.vis[sy] & 0x7FFF) !== vis) bad.push(`vis ${cx},${cz},${sy} ${c.vis[sy].toString(16)}!=${vis.toString(16)}`);
  }
  return bad;
}

async function run(patch, label) {
  const e = build(patch);
  const { W, CFG } = e;
  ok(await settle(e), label + ': initial meshing settles');
  ok(diffs(e).length === 0, label + ': initial world matches a full remesh', diffs(e).slice(0, 3).join('; '));
  const bx = 0, bz = 0, by = CFG.WORLD_MIN_Y + SY0 * 16;   // section corner (chunk 0,0, sy SY0) — local (0,0,0)
  const P = [0, 8, 15];
  let n = 0, bad = 0, first = '';
  // A: break at every edge class of a section — one edit, settle, compare
  for (const lx of P) for (const ly of P) for (const lz of P) {
    W.setBlock(bx + lx, by + ly + 16, bz + lz, 0); n++;
    await settle(e);
    const d = diffs(e); if (d.length) { bad++; first = first || `break ${lx},${ly},${lz}: ${d.slice(0, 3).join('; ')}`; }
  }
  // B: a burst — several edits in a row with the mesher only serviced a little between (jobs in flight)
  for (let k = 0; k < 6; k++) {
    for (let j = 0; j < 4; j++) W.setBlock(-16 + ((k * 5 + j * 3) & 15) * 1, by + 20 + j, 15 - k, 0);
    await frames(e, 1, 0);        // issues jobs, runs at least one (budget 0 still pops one? drains below)
    W.setBlock(-1, by + 20 + k, 15 - k, e.glass);   // re-dirty WHILE the mesh job is in flight
    await frames(e, 1);
  }
  await settle(e); n += 6;
  { const d = diffs(e); if (d.length) { bad++; first = first || 'burst: ' + d.slice(0, 3).join('; '); } }
  // C: the race itself — an edit while its section's job is in flight must never leave a stale
  // vis mask trusted: the moment the stale job lands, the section is still dirty and must read 0x7FFF.
  { const cx = 0, cz = 0, sy = SY0 + 1, k = W.sectionKey(cx, cz, sy);
    W.setBlock(3, by + 16 + 5, 3, e.glass); await settle(e);
    W.setBlock(3, by + 16 + 6, 3, 0);
    W.stream(0, 0, 2);                                   // issues the job (snapshot taken now)
    ok(W.meshJobs.has(k), label + ': race setup — job in flight');
    W.setBlock(3, by + 16 + 7, 3, 0);                    // edit while in flight -> dirty again
    e.J.pump(1e9); await Promise.resolve(); await Promise.resolve();   // the STALE job lands
    const c = W.get(cx, cz);
    if (!(c.meshDirty[0] & (1 << sy))) { ok(false, label + ': race setup — section still dirty after stale landing'); }
    else if (c.vis[sy] !== 0x7FFF) { bad++; first = first || `stale job overwrote the uncertain vis mask (${c.vis[sy].toString(16)})`; }
    await settle(e);
    const d = diffs(e); if (d.length) { bad++; first = first || 'race: ' + d.slice(0, 3).join('; '); }
  }
  ok(bad === 0, label + ': every edit leaves every section equal to a full remesh', first + ' [' + bad + ' bad of ' + (n + 1) + ']');
  return bad;
}

console.log('remeshcheck — KW-48b: does every remesh path leave the picture equal to a full rebuild?');
const good = await run(null, 'master');
// anti-vacuity: each break removes one dirtying rule and the check must notice
const breaks = [
  ['setBlock skips the diagonal section', (f, s) => f === '07_world.js' ? s.replace('var z0 = lz === 0 ? -1 : 0, z1 = lz === 15 ? 1 : 0;', 'var z0 = 0, z1 = 0;') : s],
  ['setBlock skips the y neighbour', (f, s) => f === '07_world.js' ? s.replace('var y0 = lyy === 0 ? -1 : 0, y1 = lyy === 15 ? 1 : 0;', 'var y0 = 0, y1 = 0;') : s],
  ['setBlock skips the x neighbour', (f, s) => f === '07_world.js' ? s.replace('var x0 = lx === 0 ? -1 : 0, x1 = lx === 15 ? 1 : 0;', 'var x0 = 0, x1 = 0;') : s],
  ['markDirty keeps the old vis', (f, s) => f === '07_world.js' ? s.replace('c.meshDirty[0] |= (1 << sy); c.vis[sy] = 0x7FFF;', 'c.meshDirty[0] |= (1 << sy);') : s],
];
let caught = 0;
for (const [name, p] of breaks) {
  let applied = true;
  const patch = (f, s) => { const r = p(f, s); if (f === '07_world.js' && r === s) applied = false; return r; };
  const before = fails.length;
  const bad = await run(patch, 'break[' + name + ']');
  ok(applied, 'break "' + name + '" matched the source');
  if (bad > 0) { caught++; console.log('✓ break caught: ' + name); }
  fails.length = before;      // failures inside a break are the point
}
ok(caught === breaks.length, 'every break is caught', caught + '/' + breaks.length);
console.log(` assertions passed .. ${pass}`);
console.log(`${caught} breaks caught`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
