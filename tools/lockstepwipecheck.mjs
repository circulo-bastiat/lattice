// lockstepwipecheck (#9844): the lander's wipe gate (tools/infra/lockstepwipe.mjs), the farm's dead-result drop (pilotfarm.dropDead) and the status-line
// drop finder (tools/infra/lockstepdrop.mjs) on fixtures. Then the REAL gate against origin/master when it exists. Prints '<n> breaks caught'.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const TOOLS = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(TOOLS, f), 'utf8');
const SRC = { wipe: read('infra/lockstepwipe.mjs'), drop: read('infra/lockstepdrop.mjs'), farm: read('infra/pilotfarm.mjs') };
let ASSERTS = 0;
/** import a copy of infra/<name> (optionally with one text mutation) sitting next to a symlink-free copy of the referee inputs module */
async function load(name, mut) {
  let src = SRC[name]; if (mut) { if (!src.includes(mut[0])) throw new Error('no-op break: ' + mut[0]); src = src.replace(mut[0], mut[1]); }
  const d = mkdtempSync(join(tmpdir(), 'lsw-')); mkdirSync(join(d, 'infra')); mkdirSync(join(d, 'referee', 'lockstep'), { recursive: true });
  writeFileSync(join(d, 'referee', 'lockstep', 'inputs.mjs'), read('referee/lockstep/inputs.mjs'));
  writeFileSync(join(d, 'infra', name + '.mjs'), src);
  return { m: await import(pathToFileURL(join(d, 'infra', name + '.mjs')).href + '?' + Math.random()), d, src };
}
const tree = (shared, nLanes) => {   // a fake tools/ with run.mjs = shared and n lanes
  const d = mkdtempSync(join(tmpdir(), 'lswt-')); mkdirSync(join(d, 'referee', 'lanes.d'), { recursive: true }); mkdirSync(join(d, 'referee', 'lockstep'), { recursive: true });
  writeFileSync(join(d, 'referee', 'lockstep', 'run.mjs'), shared);
  for (let i = 0; i < nLanes; i++) writeFileSync(join(d, 'referee', 'lanes.d', `l${i}.json`), '{}');
  return d;
};
async function run(mut) {
  let fails = 0; const ok = (c, msg) => { ASSERTS++; if (!c) { fails++; if (!mut) console.log('FAIL: ' + msg); } };
  const W = await load('wipe', mut && mut.wipe), made = [W.d];
  const a = tree('x\nbase\n', 10), b = tree('x\nbase\nnew shared code\n', 10), c = tree('x\nbase\n// LANE:l3\nnew\n// END LANE\n', 10);
  made.push(a, b, c);
  const wb = W.m.wipedLanes(a, b), wc = W.m.wipedLanes(a, c);
  ok(wb.wiped.length === 10 && wb.files.join() === 'referee/lockstep/run.mjs', 'an unfenced edit wipes every lane and names the file');
  ok(wc.wiped.join() === 'l3', 'a LANE-fenced addition changes only that lane');
  ok(!W.m.verdict(wb, 'plain body').ok && /10 lanes/.test(W.m.verdict(wb, '').msg), 'more than 5 lanes lose credit: bounced with the count');
  ok(W.m.verdict(wb, 'x\nLockstep-Wipe: ack because the harness must change').ack === true, 'lockstep-wipe: ack lets it through');
  ok(W.m.verdict({ wiped: ['a', 'b', 'c', 'd', 'e'], files: [] }, '').ok, 'five lanes or fewer is fine');
  // status line
  const D = await load('drop', mut && mut.drop), mx = (n, sha) => ({ sha, roster: 91, rows: Object.fromEntries(Array.from({ length: 91 }, (_, i) => ['m' + i, { lockstep: i < n ? 'green' : 'red' }])) });
  made.push(D.d);
  const git = (args) => (args.includes('--reverse') ? 'abc1234 #9742: edit SeedAgent\ndef5678 later\n' : '');
  ok(D.m.lockstepCount(mx(72, 'a')) === 72, 'lockstep count');
  ok(/FELL 71 points .*abc1234 #9742/.test(D.m.statusLine(mx(1, 'b'), { count: 72, sha: 'a' }, git)), 'a fall of more than 10 names the first SHARED commit');
  ok(!/FELL/.test(D.m.statusLine(mx(65, 'b'), { count: 72, sha: 'a' }, git)), 'a fall of 7 is not reported');
  ok(!/FELL/.test(D.m.statusLine(mx(1, 'a'), { count: 72, sha: 'a' }, git)), 'the same build twice is not a fall');
  // #10102 staleNote: the matrix line says when it is hand-restored, older than the code, or behind the results
  const full = { ...mx(43, 'a1b2c3d4e5'), full: true }, gitS = (inp, res) => (args) => (args.includes(':(exclude)tools/referee/lockstep/pilot-results') ? inp : args.includes('tools/referee/lockstep/pilot-results') ? res : '');
  ok(/NOT a full run/.test(D.m.staleNote({ ...mx(78, 'a1b2c3d4e5') }, gitS('', ''))) && /NOT a full run/.test(D.m.staleNote(null, gitS('', ''))), 'a matrix without the full-run stamp is called hand-restored / not a full run');
  ok(D.m.staleNote(full, gitS('', '')) === '', 'a full-run matrix with no commits since says nothing');
  ok(/OLDER THAN THE CODE: 2 commit\(s\) since a1b2c3d .*oldest: aaa2 older/.test(D.m.staleNote(full, gitS('bbb1 newer\naaa2 older\n', ''))), 'commits that changed lockstep inputs since the matrix build are counted, oldest named');
  ok(/3 result commit\(s\) landed since a1b2c3d/.test(D.m.staleNote(full, gitS('', 'r1\nr2\nr3\n'))) && !/OLDER THAN THE CODE/.test(D.m.staleNote(full, gitS('', 'r1\n'))), 'result-only commits since the build are counted separately from input changes');
  ok(/not in this clone/.test(D.m.staleNote(full, () => { throw new Error('bad revision'); })), 'a build sha this clone does not have is said, not hidden');
  ok(/statusLine\(mx, store, gitIn\(root\)\) \+ staleNote\(mx, gitIn\(root\)\)/.test(D.src), 'the status line (report) appends the staleNote');
  // dropDead
  const F = await load('farm', mut && mut.farm), res = mkdtempSync(join(tmpdir(), 'lswr-')); made.push(F.d, res);
  const { currentInputs } = await import(pathToFileURL(join(F.d, 'referee', 'lockstep', 'inputs.mjs')).href + '?' + Math.random());
  writeFileSync(join(res, 'l1-0.json'), JSON.stringify({ lane: 'l1', salt: 0, same: true, inputs: currentInputs('l1', b) }));
  writeFileSync(join(res, 'l1-1.json'), JSON.stringify({ lane: 'l1', salt: 1, same: true, inputs: currentInputs('l1', a) }));
  const said = [], dead = F.m.dropDead(res, b, (t) => said.push(t));
  ok(dead.length === 1 && dead[0].endsWith('l1-1.json') && readdirSync(res).join() === 'l1-0.json', 'dropDead removes only the result recorded against older inputs');
  ok(said.length === 1, 'dropDead tells the bus');
  for (const d of made) rmSync(d, { recursive: true, force: true });
  return fails;
}
const base = await run(null);
if (base) { console.log(`FAIL: ${base} assertion(s) failed`); process.exit(1); }
const BREAKS = [
  { wipe: ['wiped.length <= max ? { ok: true', 'true ? { ok: true'] },
  { wipe: ['ACK.test(ackText)', 'false'] },
  { wipe: ['ACK = /lockstep-wipe', 'ACK = /nope-wipe'] },
  { wipe: ['if (sameInputs(a, b)) continue;', 'if (true) continue;'] },
  { drop: ['store.count - n > FALL', 'store.count - n > 1000'] },
  { drop: ['store.sha !== (mx && mx.sha) &&', ''] },
  { drop: ["if (!(mx && mx.full === true && mx.sha))", "if (false)"] },
  { drop: ["if (inputs.length) s +=", "if (false) s +="] },
  { drop: [":(exclude)tools/referee/lockstep/pilot-results'", "'tools/referee/lockstep'"] },
  { drop: ["which is not in this clone", "which is here"] },
  { drop: ["statusLine(mx, store, gitIn(root)) + staleNote(mx, gitIn(root))", "statusLine(mx, store, gitIn(root))"] },
  { farm: ['if (!sameInputs(r.inputs, cur)) { unlinkSync(f); dead.push(f); }', 'if (false) { unlinkSync(f); dead.push(f); }'] },
  { farm: ['if (dead.length && say)', 'if (false)'] },
];
let caught = 0;
for (const b of BREAKS) { let f; try { f = await run(b); } catch { f = 1; } if (f > 0) caught++; else console.log('NOT CAUGHT: ' + JSON.stringify(Object.values(b)[0][0])); }
if (caught !== BREAKS.length) process.exit(1);
// the real gate on this checkout (skipped without origin/master)
const g = spawnSync(process.execPath, [join(TOOLS, 'infra', 'lockstepwipe.mjs')], { encoding: 'utf8', env: { ...process.env } });
if (g.status !== 0) console.log((g.stdout || '').trim());
console.log(`lockstepwipecheck: ${caught} breaks caught, ${ASSERTS} assertions`);
process.exit(g.status === 0 ? 0 : 1);
