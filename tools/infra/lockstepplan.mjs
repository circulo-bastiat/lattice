// lockstepplan.mjs (#9364 R1/R4): which lockstep lanes need a pilot. A lane whose stored results (any dir) carry `inputs` equal to the checked-out
// files for `need` stable salts is CREDITED (shown with its original result, no pilot); anything else needs a pilot, run as a ci-pilot job.
// Uses the #9003 rule in tools/referee/lockstep/inputs.mjs, so a doctored result (foreign / missing / stale inputs, or same:false) never credits.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { creditedResults } from '../referee/lockstep/inputs.mjs';
/** { credited: {lane: n}, needPilot: [{lane, missing:[salts]}] } for `lanes`, files read from `root`, results from `dirsNewestFirst` */
export function lockstepPlan({ lanes, root, dirs, need = 20 }) {
  const cr = creditedResults(null, root, dirs.filter(existsSync)), credited = {}, needPilot = [];
  for (const lane of lanes) {
    const have = new Set(Object.values(cr).filter((r) => r.lane === lane && r.same === true).map((r) => r.salt));
    const missing = []; for (let s = 0; s < need; s++) if (!have.has(s)) missing.push(s);
    if (missing.length) needPilot.push({ lane, missing }); else credited[lane] = have.size;
  }
  return { credited, needPilot };
}
export const resultDirs = (resultsRoot) => (existsSync(resultsRoot) ? readdirSync(resultsRoot).map((d) => join(resultsRoot, d)).reverse() : []);
/** #9364 R1: the `lockstep-<lane>` stage ids in `ids` whose lane is fully credited by stored results (inputs equal to the files in `root`): a shard skips them (no pilot) */
export function creditedStageIds(ids, root, resultsRoot) {
  const lanesDir = join(root, 'tools', 'referee', 'lanes.d');
  const lanes = ids.filter((id) => /^lockstep-/.test(id) && existsSync(join(lanesDir, id.slice(9) + '.json'))).map((id) => id.slice(9));
  if (!lanes.length) return [];
  const { credited } = lockstepPlan({ lanes, root: join(root, 'tools'), dirs: resultDirs(resultsRoot) });
  return Object.keys(credited).map((l) => 'lockstep-' + l);
}
