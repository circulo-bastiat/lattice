// #7683 (Dan, 15 Oct): 64 of 259 worker sessions in 24 h (25%) wrote no code - 45 closed their RED issue "already fixed"
// and 19 had their hand-off refused for no commits - each costing a full Claude start. The claim step in brain.yml now
// runs this BEFORE launch.mjs: a RED issue whose named checks all pass on this checkout is closed without a session.
//   node tools/infra/prelaunch.mjs [brief-file]   exit 0 + "SATISFIED" = closed, skip Claude; any other output = launch.
import { readFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { handoffVerdict } from './handoffstuck.mjs';
import { fileURLToPath } from 'url';

/** The suite check ids a RED title names ("RED usagestalecheck ..." / "RED lockstep-zombie-20"). Not-RED -> []. */
export function redChecks(title, known) {
  if (!/^RED\b/.test(title)) return [];
  const words = title.slice(3).match(/[a-z][a-z0-9_-]*/g) || [];
  return [...new Set(words.filter((w) => known.has(w)))];
}

/** #9933: the full run (the judge) re-reddened this issue AFTER the last answer on it, or the answers contradict it: never close it from a green run in
 *  the worker's own workspace (the environments differ: 12 checks stayed red for 3 days while this closed them as "already fixed"). */
export function launchInstead(comments) {
  const cs = (comments || []).filter((c) => typeof c?.body === 'string');
  const v = handoffVerdict(cs);
  return v === 'fresh' || v === 'diverges' ? v : '';
}

/** #9324: checks that need a lockstep pilot (never run inside the 540 s pre-launch gate). */
export const pilotBound = (id) => /^lockstep-/.test(id);

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const brief = readFileSync(process.argv[2] || join(root, '.git', 'mclite-brief.txt'), 'utf8');
  const m = brief.match(/^## YOUR ISSUE\s+#(\d+)\s+(.*?)\s+\[/m);
  const ws = (brief.match(/^workspace (\S+)/m) || [])[1];
  if (!m || !ws) return console.log('prelaunch: no issue in brief, launching');
  const known = new Set(readdirSync(join(root, 'tools', 'stages.d')).map((f) => f.replace(/\.json$/, '')));
  const ids = redChecks(m[2], known);
  if (!ids.length) return console.log('prelaunch: not a RED issue naming a check, launching');
  // #9324: a lockstep check runs a 20-salt pilot (~37 min of real server, or a mirror round trip): it can never finish inside this
  // 540 s gate, and a timed-out run used to leave its Minecraft servers running on the brain VM. The worker session verifies those.
  if (ids.some(pilotBound)) return console.log(`prelaunch: ${ids.filter(pilotBound).join(', ')} needs a lockstep pilot, launching`);
  try {   // #9933: the judge's red comment newer than the last answer = launch, whatever this workspace says (any read failure = the old behaviour)
    const { gh } = await import('./gh.mjs');
    const why = launchInstead(await gh('GET', `/repos/{repo}/issues/${m[1]}/comments?per_page=100`));
    if (why) return console.log(`prelaunch: the full run still reds ${ids.join(', ')} (${why === 'fresh' ? 'its red comment is newer than the last answer' : 'earlier "already pass" answers contradict it'}), launching`);
  } catch { /* offline: fall through */ }
  const run = (a, cwd) => spawnSync('node', a, { cwd, encoding: 'utf8', timeout: 540e3 });
  if (run(['build.mjs'], ws).status !== 0) return console.log('prelaunch: build failed, launching');
  for (const id of ids) {
    const r = run(['tools/suite.mjs', '--fast', '--only', id], ws);
    if (r.status !== 0) return console.log(`prelaunch: ${id} is red, launching`);
  }
  const msg = `prelaunch (#7683): ${ids.join(', ')} already pass on master ${spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ws, encoding: 'utf8' }).stdout.trim()}; closed before any session started`;
  const d = run(['tools/go.mjs', 'done', '--dir', ws, '--already-fixed', '--msg', msg], ws);
  if (d.status !== 0) return console.log('prelaunch: close failed, launching: ' + String(d.stderr).slice(-200));
  console.log('SATISFIED ' + msg);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
