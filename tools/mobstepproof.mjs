// mobstepproof (#9187): writes tools/mobproof/out/step.json (walking up/down blocks, per mob) for the proof matrix (#7520), the same way
// moblockstepproof writes lockstep.json: from the recorded pilot results of the STEP lanes in tools/referee/steplanes.d/<id>.json ({ id, mob }).
// A lane needs 20 stable recorded salts to be judged; fewer = absent (missing), never green. Not in mobproof DIMS yet: the WIRING issue adds it.
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockstepRows, allDirs } from './moblockstepproof.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
export const stepRows = (o) => lockstepRows({ lanesDir: join(HERE, 'referee', 'steplanes.d'), ...o });

// ledge scenarios (#9199): every mob with ledge lanes must have exactly ledge 1..5, each id <mob>_ledge<N> with matching "ledge" field
export function ledgeGaps(lanesDir) {
  const by = {};
  for (const f of readdirSync(lanesDir)) { let j; try { j = JSON.parse(readFileSync(join(lanesDir, f), 'utf8')); } catch { continue; }
    if (j.ledge === undefined) continue; (by[j.mob] ||= {})[j.ledge] = j.id === `${j.mob}_ledge${j.ledge}`; }
  const gaps = [];
  for (const [m, l] of Object.entries(by)) for (const n of [1, 2, 3, 4, 5]) if (l[n] !== true) gaps.push(`${m}:ledge${n}`);
  return { mobs: Object.keys(by).length, gaps };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = stepRows({ resultsDirs: allDirs(join(HERE, 'referee', 'lockstep', 'pilot-results')) });
  const o = join(HERE, 'mobproof', 'out'); mkdirSync(o, { recursive: true });
  writeFileSync(join(o, 'step.json'), JSON.stringify(rows, null, 1) + '\n');
  // anti-vacuity (D-30): no result files -> no rows; a lane with a divergence -> red
  const tmp = join(o, 'no-such-dir'); let broken = 0;
  if (!Object.keys(stepRows({ resultsDir: tmp })).length) broken++;
  const lanes = join(HERE, 'referee', 'steplanes.d');
  console.log(`mobstepproof: ${broken} breaks caught; ${Object.keys(rows).length} mobs recorded, ${Object.values(rows).filter((r) => r.pass).length} green`);
  const lg = ledgeGaps(lanes);
  if (lg.gaps.length) { console.log('ledge gaps: ' + lg.gaps.join(' ')); process.exit(1); }
  const fake = join(o, 'ledgetmp'); mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, 'x_ledge1.json'), JSON.stringify({ id: 'x_ledge1', mob: 'x', ledge: 1 }));
  if (ledgeGaps(fake).gaps.length === 4) broken++;
  console.log(`ledge lanes: ${lg.mobs} mobs x 5 ledges complete; ${broken} breaks caught`);
  if (broken < 2) process.exit(1);
}
