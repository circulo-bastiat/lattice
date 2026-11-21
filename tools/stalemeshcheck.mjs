#!/usr/bin/env node
// stalemeshcheck.mjs — KW-48b-3 (#588): a mesh built from an older world state must never replace a newer one.
// The REAL World streamer with Jobs.requestMesh replaced by jobs we resolve BY HAND, in any order.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fails.push(m); console.log('FAIL  ' + m); } return c; };

async function run(patch, label) {
  const M = loadEngine({ extra: ['07_world.js', '09_jobs.js'], dom: true, patch });
  const W = M.World, J = M.Jobs, CH = M.CH, CFG = M.CFG;
  const uploads = [];
  M.Gfx = { setSectionMesh(cx, cz, sy, buf) { uploads.push(buf ? new Uint8Array(buf)[0] : null); } };
  J.mode = 'inline';
  const pend = [];
  J.requestMesh = (cx, cz, sy, snap, release) => new Promise((res) => { J.lastId = ++J.nextId; pend.push(res); if (release) release(snap); });
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { const k = W.getOrCreate(x, z); k.state = CH.GENERATED; k.meshDirty[0] = 0; }
  const c = W.get(0, 0);
  const sy = 4, bit = 1 << sy, flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  let bad = 0;
  // build 1 lands (gen 0) and is uploaded
  W.markDirty(0, 0, sy); const g1 = c.meshGen[sy];
  W.stream(0, 0, 2);   // issues the job for generation g1
  // out-of-order: the edit bumps the generation, then the OLD result lands
  W.markDirty(0, 0, sy);
  ok(c.meshGen[sy] > g1, label + ': markDirty bumps the generation');
  const stale = pend.length ? pend[0] : null;
  if (!stale) { ok(false, label + ': setup - no job issued'); return 1; }
  stale({ buf: new Uint8Array([111]).buffer, vis: 0 });
  await flush();
  if (uploads.length) { bad++; }
  if (c.vis[sy] !== 0x7FFF) bad++;
  ok(uploads.length === 0, label + ': stale result is not uploaded');
  return bad;
}

console.log('stalemeshcheck — KW-48b-3: a stale mesh upload is dropped');
await run(null, 'master');
ok(fails.length === 0, 'master drops the stale upload');
const good = fails.length;
const breaks = [
  ['landing ignores the generation', (f, s) => f === '07_world.js' ? s.replace('if (c.meshGen[sy] !== gen) return;', '') : s],
  ['markDirty does not bump', (f, s) => f === '07_world.js' ? s.replace('c.meshGen[sy]++; }', '}') : s],
];
let caught = 0;
for (const [name, p] of breaks) {
  let applied = true;
  const patch = (f, s) => { const r = p(f, s); if (f === '07_world.js' && r === s) applied = false; return r; };
  const before = fails.length;
  const bad = await run(patch, 'break[' + name + ']');
  ok(applied, 'break "' + name + '" matched the source');
  if (fails.length > before) { caught++; console.log('✓ break caught: ' + name); }
  fails.length = before;
}
ok(caught === breaks.length, 'every break is caught');
console.log(` assertions passed .. ${pass}`);
console.log(`${caught} breaks caught`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
