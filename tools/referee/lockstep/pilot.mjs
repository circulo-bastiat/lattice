#!/usr/bin/env node
// lockstep/pilot.mjs -- #5095 (G17-L3c): lockstep pilot, zombie + creeper lanes x N salts on the real 1.18.2 server.
// Per salt each lane runs twice from a fresh process under the SeedAgent; a salt whose two rep0 traces differ is a
// DIVERGENCE (to be filed as a go.mjs bug). One JSON line per (lane, salt); summary last.
//   node tools/referee/lockstep/pilot.mjs [--from 0] [--seeds 20] [--lanes zombie,creeper] [--jobs 3] [--budget-min 7]
// #6574: one salt costs ~110 s of real server, so '--seeds 20' is ~37 min and a worker command lasts ~10 min. Finished (lane, salt)
// results are cached (dir keyed by a hash of the lockstep sources), `--jobs` salts run at once, and no salt is STARTED that could not
// finish inside `--budget-min`. A run that did not get through prints {"pilot":"partial",...,"remaining":k,"again":"<this command>"}
// and exits 0: RUN THE SAME COMMAND AGAIN until the last line is {"pilot":"done"} (or "chunk" for a partial range).
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { tmpdir, loadavg, cpus, freemem } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgent, runLane, sha } from './run.mjs';
import { currentInputs, creditedResults } from './inputs.mjs';
import { watchCaller, killTree } from './caller.mjs';
import { taskList, planTasks, taskKey, partition, estimate, mayStart, summary, seedFromShared } from './pilotplan.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const N = +arg('--seeds', 20), FROM = +arg('--from', 0), lanes = arg('--lanes', 'zombie,creeper,cow,chicken').split(',');
// one 1 GB JVM per job: on a loaded host (load > 4 per core, or < 3 GB available) run one salt at a time
const starved = loadavg()[0] > 4 * cpus().length || freemem() < 3 * 2 ** 30;
const JOBS = starved ? 1 : Math.max(1, +arg('--jobs', 3)), BUDGET_MS = +arg('--budget-min', 7) * 60e3;
// #5451: the budget only gates STARTING a salt; on a saturated host a started salt (slot queue + two server runs) ran past the worker's 10 min with no output. HARD_MS ends the call: running salts are killed (their rep a is cached) and the partial line is printed.
const HARD_MS = +arg('--hard-min', 9) * 60e3;
// the cache is valid for exactly these sources: a change to the agent, the runner or the scenes starts a fresh one
const SRCS = [join(HERE, 'SeedAgent.java'), join(HERE, 'run.mjs'), join(HERE, '..', 'runchase.mjs'), join(HERE, '..', 'chasescen.mjs'), join(HERE, '..', 'server.mjs')];
const srcHash = createHash('sha256').update(SRCS.map((f) => (existsSync(f) ? readFileSync(f) : '')).join('\u0000')).digest('hex').slice(0, 12);
const cacheDir = join(arg('--cache', process.env.MCLITE_PILOT_CACHE || (process.env.BRAIN_HOME ? join(process.env.BRAIN_HOME, 'pilot-cache') : join(process.env.TMPDIR || tmpdir(), 'lockstep-pilot-cache'))), srcHash);   // #7474: a stable per-runner dir so a re-claim resumes
const agentDir = join(cacheDir, 'agent'), agentJar = join(agentDir, 'seedagent.jar');
const resFile = (t) => join(cacheDir, taskKey(t) + '.json');
const sharedDir = join(HERE, 'pilot-results', srcHash);   // #7542: travels with the issue branch, so any runner resumes a partial pilot
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
// a rcon/connect TIMEOUT is the host starving the server (shared runners hit load 150 + swap full), not a divergence: retry the run, never record it as one
const rep0 = (lane, salt, agent, tag) => {
  for (let k = 1; ; k++) {
    try { return JSON.stringify(JSON.parse(runLane({ mob: lane, salt, agent, tag }))[0]); }
    catch (e) { if (k >= 3 || !/timed out/.test(String(e.message))) throw e; console.error(`pilot: ${lane}:${salt} ${tag} timed out (host overloaded), retry ${k}`); }
  }
};

if (process.argv.includes('--one')) {   // child: one (lane, salt), two fresh server runs; prints and caches its result line
  const [lane, salt] = arg('--one', '').split(':');
  // #7500: with every server slot held by other pilots the wait for one is bounded by MCLITE_SLOT_WAIT_MS; exit 75 = "no slot, run again", not a failure.
  // The first run is cached so the retry does not repeat ~110 s of server.
  // #7585 proof run: a hosted job starts with an empty cache, so the child builds the agent jar itself (it used to die here, silently, with no jar)
  if (!existsSync(agentJar)) { mkdirSync(agentDir, { recursive: true }); buildAgent(agentDir); }
  const fa = resFile({ lane, salt: +salt }) + '.a';
  let a, b;
  try {
    try { a = readFileSync(fa, 'utf8'); } catch { a = rep0(lane, +salt, agentJar, 'a'); writeFileSync(fa, a); }
    b = rep0(lane, +salt, agentJar, 'b');
  } catch (e) { if (/no server slot free/.test(String(e.message))) process.exit(75); throw e; }
  const r = { lane, salt: +salt, same: a === b, a: sha(a), b: sha(b), inputs: currentInputs(lane) };   // #9003: what this result depends on
  writeFileSync(resFile({ lane, salt: +salt }), JSON.stringify(r));
  try { mkdirSync(sharedDir, { recursive: true }); writeFileSync(join(sharedDir, taskKey({ lane, salt: +salt }) + '.json'), JSON.stringify(r)); } catch { /* read-only checkout: the runner cache still has it */ }
  console.log(JSON.stringify(r));
  process.exit(0);
}

mkdirSync(agentDir, { recursive: true });
const have = (d) => new Set(existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
// #9003: a result from ANY dir counts while its recorded `inputs` equal the lane's current ones (an edit to a file the lane does not load costs nothing)
const rootDir = join(HERE, 'pilot-results');
const credit = existsSync(rootDir) ? creditedResults(rootDir, undefined, readdirSync(rootDir).map((d) => join(rootDir, d)).reverse()) : {};
for (const [k, r] of Object.entries(credit)) { if (!have(cacheDir).has(k)) { try { writeFileSync(join(cacheDir, k + '.json'), JSON.stringify(r)); } catch { /* it just runs again */ } } }
for (const k of seedFromShared(taskList(lanes, FROM, 2 * N).map(taskKey), have(cacheDir), have(sharedDir))) { try { copyFileSync(join(sharedDir, k + '.json'), join(cacheDir, k + '.json')); } catch { /* unreadable: it just runs again */ } }
// #7585: `--remote mirror` (or MCLITE_PILOT_REMOTE=mirror) runs the salts as hosted jobs on the public test mirror, one per job, and seeds the
// same cache/shared files from the accepted results; anything missing or unreachable simply runs here below.
if ((arg('--remote', process.env.MCLITE_PILOT_REMOTE || '')) === 'mirror') {
  try {
    const { runPilot } = await import('../../infra/mirror.mjs');
    mkdirSync(sharedDir, { recursive: true });
    for (const lane of lanes) for (const r of await runPilot(lane, FROM, Math.min(N, 20), new Set(Array.from({ length: 20 }, (_, i) => FROM + i).filter((x) => have(cacheDir).has(taskKey({ lane, salt: x })) || have(sharedDir).has(taskKey({ lane, salt: x })))))) {
      for (const d of [cacheDir, sharedDir]) writeFileSync(join(d, taskKey({ lane, salt: r.salt }) + '.json'), JSON.stringify({ ...r, inputs: currentInputs(lane) }));
    }
  } catch (e) { console.error('pilot: mirror unavailable (' + String(e.message || e).slice(0, 160) + '), running here'); }
}
if (!existsSync(agentJar)) buildAgent(agentDir);
const results = {};
for (const t of taskList(lanes, FROM, 2 * N)) { try { results[taskKey(t)] = JSON.parse(readFileSync(resFile(t), 'utf8')); } catch { /* not run yet */ } }   // cached salts, incl. replacements
let tasks = planTasks(lanes, FROM, N, results);
const queue = partition(tasks, results).pending, queued = new Set(queue.map(taskKey));
const t0 = Date.now(), durs = []; const kids = new Set(); let running = 0, started = 0, failed = null, starting = false, deferred = false;
watchCaller((why) => { console.error(`pilot: ${why === 'caller' ? 'the caller is gone' : why} (#9324) - killing ${kids.size} running salt(s) and their servers`); for (const k of kids) killTree(k.pid); });
await new Promise((resolve) => {
  const beat = setInterval(() => console.error(`pilot: ${Math.round((Date.now() - t0) / 1e3)} s into the call, ${running} running, ${queue.length} queued`), 60e3);
  const hard = setTimeout(() => { failed = failed || `hard limit ${HARD_MS / 6e4} min reached, ${running} salt(s) killed`; for (const k of kids) { try { process.kill(-k.pid, 'SIGKILL'); } catch { /* gone */ } } }, HARD_MS);
  const pump = () => {
    while (!failed && !deferred && !starting && mayStart({ elapsedMs: Date.now() - t0, budgetMs: BUDGET_MS, estMs: estimate(durs), running, jobs: JOBS, pending: queue.length, startedThisCall: started })) {
      const t = queue.shift(), t1 = Date.now(); running++; started++; starting = true;
      // each salt gets its OWN free ports: runchase's fixed 25671/26671 made two salts starting together bind-race (rcon: bad password)
      Promise.all([freePort(), freePort()]).then(([port, rcon]) => {
        const c = spawn(process.execPath, [join(HERE, 'pilot.mjs'), '--one', `${t.lane}:${t.salt}`, '--cache', dirname(cacheDir)], { stdio: ['ignore', 'pipe', 'inherit'], detached: true, env: { ...process.env, MCLITE_CHASE_PORT: String(port), MCLITE_CHASE_RCON: String(rcon), MCLITE_SLOT_WAIT_MS: String(Math.max(60e3, BUDGET_MS - (Date.now() - t0))), MCLITE_SLOT_SINCE: String(t1) } });
        starting = false; kids.add(c);
        console.error(`pilot: start ${t.lane}:${t.salt} (budget ${Math.round(BUDGET_MS / 6e4)} min, a salt may run past it; a re-run resumes from the cache)`);
        let out = ''; c.stdout.on('data', (d) => { out += d; });
        c.on('close', (code) => {
          kids.delete(c); running--; durs.push(Date.now() - t1);
          console.error(`pilot: ${t.lane}:${t.salt} ${code === 0 ? 'finished' : code === 75 ? 'found no free server slot (other pilots hold them)' : 'exit ' + code} after ${Math.round((Date.now() - t1) / 1e3)} s (${Math.round((Date.now() - t0) / 1e3)} s into the call, ${running} running, ${queue.length} queued)`);   // progress on stderr: stdout stays the result lines, but a piped run is no longer silent until the end
          if (code === 0) { try { results[taskKey(t)] = JSON.parse(out.trim().split('\n').pop()); } catch { failed = `salt ${t.lane}:${t.salt} printed no result`; } } else if (code === 75) deferred = true; else failed = `salt ${t.lane}:${t.salt} exited ${code}`;
          tasks = planTasks(lanes, FROM, N, results);   // #7474: a server-unstable salt is replaced by the next one
          for (const x of tasks) if (!results[taskKey(x)] && !queued.has(taskKey(x))) { queued.add(taskKey(x)); queue.push(x); }
          pump();
        });
        pump();
      });
    }
    if (!running) { clearInterval(beat); clearTimeout(hard); resolve(); }
  };
  pump();
});
for (const t of tasks) if (results[taskKey(t)]) console.log(JSON.stringify(results[taskKey(t)]));
if (failed) { console.error('pilot: ' + failed + ' (finished salts are cached; run the same command again)'); }
// a chunk is a partial salt range: pilotsum.mjs merges the chunk lines into the one 'done' line
console.log(JSON.stringify(summary({ tasks, results, lanes, from: FROM, n: N, again: `node tools/referee/lockstep/pilot.mjs ${process.argv.slice(2).join(' ')}`.trim() })));
process.exit(failed ? 1 : 0);
