// lockstep/dolphinpathdump.mjs -- #8760: the real 1.18.2 dolphin's Navigation path node list (x,y,z per tick) in seeded swim layouts.
//   node tools/referee/lockstep/dolphinpathdump.mjs [--layouts 0-19] [--salt N] [--out file]
// Each layout is one real-server run (runchase lane dolphinpath, SeedAgent pathlog); output { layouts: { n: paths[tick] = [[x,y,z],..]|null } }.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent, runLane } from './run.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const [lo, hi] = String(arg('--layouts', '0-19')).split('-').map(Number);
const salt = +arg('--salt', 1);
const dir = join(tmpdir(), 'dolphinpath-agent');
const jar = join(dir, 'seedagent.jar');
if (!existsSync(jar)) { mkdirSync(dir, { recursive: true }); buildAgent(dir); }
const out = { lane: 'dolphinpath', salt, layouts: {} };
for (let n = lo; n <= (hi ?? lo); n++) {
  process.env.MCLITE_CHASE_LAYOUT = String(n);
  const c = runLane({ mob: 'dolphinpath', salt, agent: jar, tag: 'dp' + n, full: true });
  out.layouts[n] = c.paths[0];
  const ticks = c.paths[0].filter(Boolean);
  console.log(`layout ${n}: ${ticks.length} ticks with a path, longest ${Math.max(0, ...ticks.map((p) => p.length))} nodes`);
}
if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(out) + '\n');
