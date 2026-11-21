// tools/salvagecheck.mjs - #5052 (Dan, 11 Oct): a headless run cut off by its turn cap keeps its work. Checks the pure parts of
// tools/brain/salvage.mjs, snapshots a real dirty git checkout with wipCommit, and that launch.mjs wires it in. Anti-vacuity below.
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { salvage: rd('./brain/salvage.mjs'), launch: rd('./brain/launch.mjs'), roles: rd('./brain/roles.json') };
const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
// a throwaway repo with a claimed work branch: one committed-but-unpushed change and one uncommitted change
const repo = mkdtempSync(join(tmpdir(), 'salvagecheck-'));
const git = (a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...a], { cwd: repo, encoding: 'utf8' });
git(['init', '-q']); writeFileSync(join(repo, 'a.txt'), 'base\n'); git(['add', '-A']); git(['commit', '-q', '-m', 'base']);
writeFileSync(join(repo, '.git', 'mclite-claim'), 'work/7-x');
writeFileSync(join(repo, 'b.txt'), 'committed by the run\n'); git(['add', '-A']); git(['commit', '-q', '-m', '#7: part']);
writeFileSync(join(repo, 'a.txt'), 'edited, never committed\n'); writeFileSync(join(repo, 'c.txt'), 'new, untracked\n');
mkdirSync(join(repo, 'assets')); writeFileSync(join(repo, 'assets', 'big.bin'), 'generated');
const HEAD0 = git(['rev-parse', 'HEAD']).stdout.trim(), STATUS0 = git(['status', '--porcelain']).stdout;

async function verdict(S) {
  const bad = []; let M;
  try { M = await load(S.salvage.replace("'../infra/gitenv.mjs'", JSON.stringify(new URL('./infra/gitenv.mjs', import.meta.url).href))); } catch (e) { return [`salvage.mjs does not load: ${e.message}`]; }
  const { cutOff, continuation, wipCommit, claimRef, CONT } = M;
  if (!cutOff({ subtype: 'error_max_turns', num_turns: 26 }, '')) bad.push('a run ended by error_max_turns is not seen as cut off');
  if (!cutOff({}, 'x\n[brain] killed at the 100-minute limit')) bad.push('a run killed at the 100-minute limit is not seen as cut off');
  if (cutOff({ subtype: 'success', num_turns: 12 }, '')) bad.push('a finished run is seen as cut off');
  const c1 = continuation('commander', 'queue-thin (bus message 9)', 25);
  if (!c1 || !c1.startsWith(CONT) || !c1.includes('queue-thin (bus message 9)')) bad.push('a cut-off commander task is not re-parked as CONTINUE with its original task');
  if (continuation('commander', c1, 25) !== null) bad.push('a CONTINUE task is re-parked again (loop)');
  if (continuation('worker', 'fill', 60) !== null) bad.push('a worker task is re-parked (workers resume through the queue + wip/)');
  if (!continuation('fixer', 'red master', 80)) bad.push('a cut-off fixer task is dropped');
  if (claimRef(repo) !== 'work/7-x') bad.push('claimRef does not read the claimed work branch');
  const w = wipCommit(repo, 'work/7-x');
  if (!w) bad.push('wipCommit made no snapshot');
  else {
    const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', w.commit], { cwd: repo, encoding: 'utf8' }).stdout.split('\n');
    const show = (f) => spawnSync('git', ['show', `${w.commit}:${f}`], { cwd: repo, encoding: 'utf8' }).stdout;
    if (!ls.includes('c.txt')) bad.push('the snapshot misses an untracked file');
    if (!ls.includes('b.txt')) bad.push('the snapshot misses a committed-but-unpushed file');
    if (show('a.txt') !== 'edited, never committed\n') bad.push('the snapshot misses an uncommitted edit');
    if (ls.some((f) => f.startsWith('assets/'))) bad.push('the snapshot carries generated assets/');
    if (spawnSync('git', ['rev-parse', `${w.commit}^`], { cwd: repo, encoding: 'utf8' }).stdout.trim() !== HEAD0) bad.push('the snapshot is not on top of HEAD');
  }
  if (git(['rev-parse', 'HEAD']).stdout.trim() !== HEAD0 || git(['status', '--porcelain']).stdout !== STATUS0) bad.push("wipCommit touched the run's HEAD, index or files");
  // wiring: launch.mjs salvages a cut-off run, counts salvaged work as progress, re-parks the task, says so on the bus
  if (!/import \{ cutOff, continuation, salvage \} from '\.\/salvage\.mjs'/.test(S.launch)) bad.push('launch.mjs does not import salvage.mjs');
  if (!/const cut = cutOff\(res, err\) && !limit;/.test(S.launch)) bad.push('launch.mjs does not detect a cut-off run');
  if (!/sv = await salvage\(\{ root: ROOT/.test(S.launch)) bad.push('launch.mjs does not salvage a cut-off run');
  if (!/if \(sv && sv\.changed && sv\.pushed\) produced = true;/.test(S.launch)) bad.push('salvaged work still counts as a burned run');
  if (!/if \(cont\) setPendingMail\(role, \{ reason: cont/.test(S.launch)) bad.push('a cut-off commander/fixer task is not re-parked');
  if (!/\$\{cutTag\}/.test(S.launch)) bad.push('the bus line does not say the run was cut off');
  if (!/refs\/heads\/wip\/\$\{ref\}/.test(S.salvage)) bad.push('salvage does not push to wip/<branch> (the place go.mjs start restores from)');
  if (!/handoff: released/.test(S.salvage)) bad.push('salvage does not release the claim');
  let C; try { C = JSON.parse(S.roles); } catch { return [...bad, 'roles.json is not valid JSON']; }
  if (!((C.roles.commander || {}).maxTurns >= 50)) bad.push(`commander maxTurns ${(C.roles.commander || {}).maxTurns} < 50: a queue-thin split (read + up to 10 newissue calls) is cut off (11 Oct 04:35Z, 26 turns)`);
  return bad;
}
const mutR = (fn) => (S) => { const C = JSON.parse(S.roles); fn(C); return { ...S, roles: JSON.stringify(C) }; };
const sub = (k, a, b) => (S) => ({ ...S, [k]: S[k].replace(a, b) });
const BREAKS = [
  ['max_turns not detected', sub('salvage', "res.subtype === 'error_max_turns'", "res.subtype === 'error_max_turnz'")],
  ['100-min kill not detected', sub('salvage', '100-minute limit/', '200-minute limit/')],
  ['continuation loops', sub('salvage', "String(reason).startsWith(CONT)", 'false')],
  ['workers re-parked', sub('salvage', "['commander', 'fixer', 'chore']", "['commander', 'fixer', 'chore', 'worker']")],
  ['fixer dropped', sub('salvage', "['commander', 'fixer', 'chore']", "['commander', 'chore']")],
  ['untracked files skipped', sub('salvage', "g(['add', '-A', '--', '.', ...WIP_EXCLUDE], E)", "g(['add', '-u', '--', '.', ...WIP_EXCLUDE], E)")],
  ['assets carried', sub('salvage', "':!assets', ", '')],
  ['snapshot off HEAD', sub('salvage', "'commit-tree', tree, '-p', 'HEAD'", "'commit-tree', tree")],
  ['real index used', sub('salvage', "const E = { GIT_INDEX_FILE: idx };", 'const E = {};')],
  ['wrong wip ref', sub('salvage', 'refs/heads/wip/${ref}', 'refs/heads/salvage/${ref}')],
  ['no release', sub('salvage', 'handoff: released (salvaged', 'salvaged (')],
  ['not imported', sub('launch', "import { cutOff, continuation, salvage } from './salvage.mjs';", '')],
  ['not salvaged', sub('launch', 'sv = await salvage({ root: ROOT', 'sv = await Promise.resolve({ root: ROOT')],
  ['salvage = burn', sub('launch', 'if (sv && sv.changed && sv.pushed) produced = true;', '')],
  ['task dropped', sub('launch', 'if (cont) setPendingMail(role, { reason: cont', 'if (0) setPendingMail(role, { reason: cont')],
  ['silent bus line', sub('launch', '${cutTag}', '')],
  ['commander 25 turns', mutR((C) => { C.roles.commander.maxTurns = 25; })],
];
const real = await verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { if ((await verdict(mk(SRC))).length) caught++; else console.log(' NOT CAUGHT:', n); }
rmSync(repo, { recursive: true, force: true });
for (const x of real) console.log(' FAIL:', x);
console.log(`salvagecheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
