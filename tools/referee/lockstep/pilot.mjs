#!/usr/bin/env node
// lockstep/pilot.mjs -- #5095 (G17-L3c): lockstep pilot, zombie + creeper lanes x N salts on the real 1.18.2 server.
// Per salt each lane runs twice from a fresh process under the SeedAgent; a salt whose two rep0 traces differ is a
// DIVERGENCE (to be filed as a go.mjs bug). One JSON line per (lane, salt); summary last.
//   node tools/referee/lockstep/pilot.mjs [--from 0] [--seeds 20] [--lanes zombie,creeper] [--jobs 3] [--budget-min 7]
// #6574: one salt costs ~110 s of real server, so '--seeds 20' is ~37 min and a worker command lasts ~10 min. Finished (lane, salt)
// results are cached (dir keyed by a hash of the lockstep sources), `--jobs` salts run at once, and no salt is STARTED that could not
// finish inside `--budget-min`. A run that did not get through prints {"pilot":"partial",...,"remaining":k,"again":"<this command>"}
// and exits 0: RUN THE SAME COMMAND AGAIN until the last line is {"pilot":"done"} (or "chunk" for a partial range).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgent, runLane, sha } from './run.mjs';
import { taskList, taskKey, partition, estimate, mayStart, summary } from './pilotplan.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const N = +arg('--seeds', 20), FROM = +arg('--from', 0), lanes = arg('--lanes', 'zombie,creeper,cow,chicken').split(',');
const JOBS = Math.max(1, +arg('--jobs', 3)), BUDGET_MS = +arg('--budget-min', 7) * 60e3;
// the cache is valid for exactly these sources: a change to the agent, the runner or the scenes starts a fresh one
const SRCS = [join(HERE, 'SeedAgent.java'), join(HERE, 'run.mjs'), join(HERE, '..', 'runchase.mjs'), join(HERE, '..', 'chasescen.mjs'), join(HERE, '..', 'server.mjs')];
const srcHash = createHash('sha256').update(SRCS.map((f) => (existsSync(f) ? readFileSync(f) : '')).join('\u0000')).digest('hex').slice(0, 12);
const cacheDir = join(arg('--cache', join(process.env.TMPDIR || tmpdir(), 'lockstep-pilot-cache')), srcHash);
const agentDir = join(cacheDir, 'agent'), agentJar = join(agentDir, 'seedagent.jar');
const resFile = (t) => join(cacheDir, taskKey(t) + '.json');
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const rep0 = (lane, salt, agent, tag) => JSON.stringify(JSON.parse(runLane({ mob: lane, salt, agent, tag }))[0]);

if (process.argv.includes('--one')) {   // child: one (lane, salt), two fresh server runs; prints and caches its result line
  const [lane, salt] = arg('--one', '').split(':');
  const a = rep0(lane, +salt, agentJar, 'a'), b = rep0(lane, +salt, agentJar, 'b');
  const r = { lane, salt: +salt, same: a === b, a: sha(a), b: sha(b) };
  writeFileSync(resFile({ lane, salt: +salt }), JSON.stringify(r));
  console.log(JSON.stringify(r));
  process.exit(0);
}

mkdirSync(agentDir, { recursive: true });
if (!existsSync(agentJar)) buildAgent(agentDir);
const tasks = taskList(lanes, FROM, N), results = {};
for (const t of tasks) { try { results[taskKey(t)] = JSON.parse(readFileSync(resFile(t), 'utf8')); } catch { /* not run yet */ } }
const queue = partition(tasks, results).pending;
const t0 = Date.now(), durs = []; let running = 0, started = 0, failed = null, starting = false;
await new Promise((resolve) => {
  const pump = () => {
    while (!failed && !starting && mayStart({ elapsedMs: Date.now() - t0, budgetMs: BUDGET_MS, estMs: estimate(durs), running, jobs: JOBS, pending: queue.length, startedThisCall: started })) {
      const t = queue.shift(), t1 = Date.now(); running++; started++; starting = true;
      // each salt gets its OWN free ports: runchase's fixed 25671/26671 made two salts starting together bind-race (rcon: bad password)
      Promise.all([freePort(), freePort()]).then(([port, rcon]) => {
        const c = spawn(process.execPath, [join(HERE, 'pilot.mjs'), '--one', `${t.lane}:${t.salt}`, '--cache', dirname(cacheDir)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, MCLITE_CHASE_PORT: String(port), MCLITE_CHASE_RCON: String(rcon) } });
        starting = false;
        let out = ''; c.stdout.on('data', (d) => { out += d; });
        c.on('close', (code) => {
          running--; durs.push(Date.now() - t1);
          if (code === 0) { try { results[taskKey(t)] = JSON.parse(out.trim().split('\n').pop()); } catch { failed = `salt ${t.lane}:${t.salt} printed no result`; } } else failed = `salt ${t.lane}:${t.salt} exited ${code}`;
          pump();
        });
        pump();
      });
    }
    if (!running) resolve();
  };
  pump();
});
for (const t of tasks) if (results[taskKey(t)]) console.log(JSON.stringify(results[taskKey(t)]));
if (failed) { console.error('pilot: ' + failed + ' (finished salts are cached; run the same command again)'); }
// a chunk is a partial salt range: pilotsum.mjs merges the chunk lines into the one 'done' line
console.log(JSON.stringify(summary({ tasks, results, lanes, from: FROM, n: N, again: `node tools/referee/lockstep/pilot.mjs ${process.argv.slice(2).join(' ')}`.trim() })));
process.exit(failed ? 1 : 0);
