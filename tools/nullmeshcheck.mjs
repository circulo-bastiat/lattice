#!/usr/bin/env node
// nullmeshcheck.mjs — #1262: a mesh job that resolves NULL (no worker ran it) is not an empty section.
// Reading it as empty cleared `meshed` and the section vanished ('see-through right after a break').
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fails.push(m); console.log('FAIL  ' + m); } return c; };

async function run(patch, label) {
  const M = loadEngine({ extra: ['07_world.js', '09_jobs.js'], dom: true, patch });
  const W = M.World, J = M.Jobs, CH = M.CH;
  const uploads = [];
  M.Gfx = { setSectionMesh(cx, cz, sy, buf) { uploads.push(buf ? 1 : null); } };
  J.mode = 'inline';
  const pend = [];
  J.requestMesh = (cx, cz, sy, snap, release) => new Promise((res) => { J.lastId = ++J.nextId; pend.push(res); if (release) release(snap); });
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { const k = W.getOrCreate(x, z); k.state = CH.GENERATED; k.meshDirty[0] = 0; }
  const c = W.get(0, 0), sy = 4, bit = 1 << sy, flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  c.meshed[0] |= bit;                       // a mesh is held and drawn
  W.markDirty(0, 0, sy);                    // a break dirties the section
  W.stream(0, 0, 2);
  if (!pend.length) { ok(false, label + ': setup - no job issued'); return; }
  pend[0](null);                            // nobody ran the job
  await flush();
  ok((c.meshed[0] & bit) !== 0, label + ': null result keeps the held mesh');
  ok((c.meshDirty[0] & bit) !== 0, label + ': null result re-dirties for a retry');
  ok(uploads.length === 0, label + ': null result uploads nothing');
}

console.log('nullmeshcheck — #1262: a null mesh result keeps the held mesh');
await run(null, 'master');
ok(fails.length === 0, 'master keeps the mesh');
const breaks = [
  ['null read as empty', (f, s) => f === '07_world.js' ? s.replace('if (!res) { c.meshDirty[0] |= (1 << sy); return; }', '') : s],
  ['null not re-dirtied', (f, s) => f === '07_world.js' ? s.replace('if (!res) { c.meshDirty[0] |= (1 << sy); return; }', 'if (!res) return;') : s],
];
let caught = 0;
for (const [name, p] of breaks) {
  let applied = true;
  const patch = (f, s) => { const r = p(f, s); if (f === '07_world.js' && r === s) applied = false; return r; };
  const before = fails.length;
  await run(patch, 'break[' + name + ']');
  ok(applied, 'break "' + name + '" matched the source');
  if (fails.length > before) { caught++; console.log('✓ break caught: ' + name); }
  fails.length = before;
}
ok(caught === breaks.length, 'every break is caught');
console.log(` assertions passed .. ${pass}`);
console.log(`${caught} breaks caught`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
