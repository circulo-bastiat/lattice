#!/usr/bin/env node
// poolcapcheck.mjs — #1898: the in-flight gen/mesh budgets scale with the LIVE worker pool, so the
// Worker Threads slider is not dead past 4 workers. Drives the real W.stream against a recording Jobs stub
// at the shipped medium caps (4/6/6) for pools 1..12.
// Anti-vacuity: the pre-fix caps (patched back into the REAL source text) must fail the pool-8 row.
import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(patch) {
  const MCL = loadEngine({ extra: ['06_atlas.js', '07_world.js', '08_lighting.js', '09_jobs.js', '10_camera.js', '10_gfx.js', '16_settings.js'], dom: true, patch });
  const W = MCL.World, G = MCL.Gen; MCL.Blocks.init(); G.init(4242, G.defaults());
  const rows = [];
  for (const pool of [1, 2, 4, 8, 12]) {
    const asked = { gen: 0, mesh: 0 }, never = new Promise(() => {});
    MCL.Jobs = { mode: 'workers', workers: new Array(pool).fill(0),
      requestGen: () => { asked.gen++; return never; }, requestMesh: () => { asked.mesh++; return never; },
      lastId: () => 1, cancel() {}, pump() {} };
    W.chunks.clear(); W.genInflight = 0; W.meshInflight = 0; W.meshJobs && W.meshJobs.clear();
    W.maxGenInflight = 4; W.maxMeshInflight = 6; W.maxMeshPerFrame = 6; W.load = 1;
    W.stream(0, 0, 8);
    const gen = asked.gen;
    for (let cx = -9; cx <= 9; cx++) for (let cz = -9; cz <= 9; cz++) {
      const c = W.getOrCreate(cx, cz), col = getCachedColumn(MCL, cx, cz);
      c.sec = col.sec; c.hmap = col.hmap; c.biome = col.biome || null; c.state = MCL.CH.GENERATED; c.meshDirty[0] = 0xfffff;
    }
    W.genInflight = 0; W.meshInflight = 0; W.stream(0, 0, 8);
    rows.push({ pool, gen, mesh: asked.mesh });
  }
  return rows;
}
function judge(rows) {
  let bad = 0;
  for (const r of rows) {
    if (r.gen !== Math.max(4, r.pool)) bad++;
    if (r.mesh !== Math.max(6, Math.ceil(r.pool * 1.5))) bad++;
  }
  return bad;
}
const rows = run();
console.log('pool  gen-in-flight  mesh-in-flight'); rows.forEach((r) => console.log(String(r.pool).padEnd(6) + String(r.gen).padEnd(15) + r.mesh));
ok(judge(rows) === 0, 'in-flight caps follow max(floor, pool) / max(floor, 1.5 x pool): ' + JSON.stringify(rows));
ok(rows.find((r) => r.pool === 8).gen === 8 && rows.find((r) => r.pool === 8).mesh === 12, 'pool 8 feeds 8 gen + 12 mesh jobs');

let breaks = 0;
const cut = (name, patch) => {
  const bad = judge(run(patch));
  if (bad > 0) { breaks++; console.log('   ✓ break caught: ' + name); } else fails.push('anti-vacuity: not caught: ' + name);
};
cut('caps hard-wired to the old 4/6', (f, s) => f === '07_world.js' ? s.replace('Math.max(W.maxGenInflight, live)', 'W.maxGenInflight').replace('Math.max(W.maxMeshInflight, Math.ceil(live * 1.5))', 'W.maxMeshInflight') : s);
cut('mesh cap ignores the pool', (f, s) => f === '07_world.js' ? s.replace('Math.ceil(live * 1.5)', '0') : s);
cut('gen cap ignores the pool', (f, s) => f === '07_world.js' ? s.replace('Math.max(W.maxGenInflight, live)', 'W.maxGenInflight') : s);
console.log(`${breaks} breaks caught`);
ok(breaks === 3, 'all three breaks caught');
fails.forEach((m) => console.log('FAIL  ' + m));
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
