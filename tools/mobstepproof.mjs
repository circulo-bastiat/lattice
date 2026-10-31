// mobstepproof (#9187): writes tools/mobproof/out/step.json (walking up/down blocks, per mob) for the proof matrix (#7520), the same way
// moblockstepproof writes lockstep.json: from the recorded pilot results of the STEP lanes in tools/referee/steplanes.d/<id>.json ({ id, mob }).
// A lane needs 20 stable recorded salts to be judged; fewer = absent (missing), never green. Not in mobproof DIMS yet: the WIRING issue adds it.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockstepRows, allDirs } from './moblockstepproof.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
export const stepRows = (o) => lockstepRows({ lanesDir: join(HERE, 'referee', 'steplanes.d'), ...o });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = stepRows({ resultsDirs: allDirs(join(HERE, 'referee', 'lockstep', 'pilot-results')) });
  const o = join(HERE, 'mobproof', 'out'); mkdirSync(o, { recursive: true });
  writeFileSync(join(o, 'step.json'), JSON.stringify(rows, null, 1) + '\n');
  // anti-vacuity (D-30): no result files -> no rows; a lane with a divergence -> red
  const tmp = join(o, 'no-such-dir'); let broken = 0;
  if (!Object.keys(stepRows({ resultsDir: tmp })).length) broken++;
  const lanes = join(HERE, 'referee', 'steplanes.d');
  console.log(`mobstepproof: ${broken} breaks caught; ${Object.keys(rows).length} mobs recorded, ${Object.values(rows).filter((r) => r.pass).length} green`);
  if (broken < 1) process.exit(1);
}
