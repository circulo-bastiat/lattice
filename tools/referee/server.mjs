// server.mjs — start the REAL 1.18.2 dedicated server headless, for the referee (unit I4).
//
// The referee exists to ask the GAME what a mob's numbers are, never to guess them. This file
// only launches the vanilla jar and waits for it to say "Done"; it decides nothing about any
// mob (D-263).
//
//   node tools/referee/server.mjs            (smoke-starts and stops the server)
//   import { startServer } from './server.mjs'  (what run.mjs actually uses)
//
// Java: the 1.18.2 server needs 17+. This machine's default `java` may be older (the referee
// was written on a 2-core/3GB VM stuck on Java 11) — pass JAVA_HOME or have a 17+ java on PATH.
// The 1.18.2 server jar is a bundler with its own libraries inside: once downloaded, no network
// call is needed to start it (verified: run with `-Dlog4j2.formatMsgNoLookups=true` offline).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, loadavg, cpus } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const REFEREE_ROOT = fileURLToPath(new URL('../..', import.meta.url)); // project ROOT

function findJava() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', 'java'));
  candidates.push('java');
  for (const c of candidates) {
    // `java -version` writes its banner to STDERR and exits 0 -- execFileSync only hands back
    // stdout on success, so the banner must come from spawnSync's captured streams either way,
    // success or failure, not from the catch block alone (that silently misread every present,
    // working JDK as "no output" and refused Java 21).
    const r = spawnSync(c, ['-version'], { encoding: 'utf8' });
    if (r.error) continue;
    return { bin: c, out: (r.stdout || '') + (r.stderr || '') };
  }
  return null;
}

function javaMajor(versionOutput) {
  const m = versionOutput.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return 0;
  const first = parseInt(m[1], 10);
  return first === 1 ? parseInt(m[2], 10) : first; // "1.8.0" (old scheme) vs "17.0.x"
}

function resolveJarsDir() {
  if (process.env.MCLITE_JARS) return process.env.MCLITE_JARS;
  if (process.env.MCLITE_ROOT) return join(process.env.MCLITE_ROOT, 'jars');
  return join(REFEREE_ROOT, 'jars');
}

export function resolveServerJar() {
  const dir = resolveJarsDir();
  const candidates = [join(dir, '1.18.2', 'server.jar'), join(dir, '1.18.2.server.jar')];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`referee/server.mjs: no 1.18.2 server.jar found under ${dir} (looked: ${candidates.join(', ')})`);
}

// Every process gets its OWN run dir (own world, own session.lock, own server.properties) under <shared>/runs/<pid>;
// golden/, libraries/ and versions/ are symlinks to the shared copies. One shared world meant two runners on a machine
// fought over session.lock and rewrote each other's rcon port (#6025). Children inherit MCLITE_REFEREE_RUN and reuse
// the parent's dir; an explicit MCLITE_REFEREE_DIR is taken as given.
export function refereeWorkDir() {
  if (process.env.MCLITE_REFEREE_DIR) return process.env.MCLITE_REFEREE_DIR;
  const shared = join(homedir(), '.mclite-referee', '1.18.2');
  const inherited = process.env.MCLITE_REFEREE_RUN;
  if (inherited && existsSync(inherited)) return inherited;
  const runs = join(shared, 'runs');
  mkdirSync(join(shared, 'golden'), { recursive: true });
  mkdirSync(runs, { recursive: true });
  for (const d of readdirSync(runs)) { // sweep dirs whose owner is gone (kill -9 skips the exit hook)
    try { process.kill(+d, 0); } catch (e) { if (e.code === 'ESRCH') rmSync(join(runs, d), { recursive: true, force: true }); }
  }
  const dir = join(runs, String(process.pid));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const n of ['golden', 'libraries', 'versions']) {
    mkdirSync(join(shared, n), { recursive: true });
    symlinkSync(join(shared, n), join(dir, n));
  }
  process.env.MCLITE_REFEREE_RUN = dir;
  process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });
  return dir;
}

// #6078: a recorded golden belongs to the clone (scenario set) that recorded it. Concurrent runners on one machine
// sharing ~/.mclite-referee/1.18.2 overwrote each other's entity-motion.json mid-check. Default: one dir per clone.
export function refereeCloneDir() {
  if (process.env.MCLITE_REFEREE_DIR) return process.env.MCLITE_REFEREE_DIR;
  return join(homedir(), '.mclite-referee', '1.18.2-' + createHash('sha1').update(REFEREE_ROOT).digest('hex').slice(0, 10));
}

function randPassword() { return randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, ''); }

/**
 * startServer({ port, rconPort, jar, workDir, xmx, timeoutMs }) -> { proc, rconPort, rconPassword, workDir, stop() }
 * Boots the dedicated server, blocks (foreground, single wait) until its stdout prints "Done",
 * or rejects on timeout / early exit. This is a bounded wait on a process WE just launched —
 * not polling a queue (D-436).
 */
function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}

// a fixed port some other (stale or concurrent) server already holds is not an error: take a free one
export function portFree(p) {
  return new Promise((res) => { const s = createServer(); s.once('error', () => res(false)); s.listen(p, () => s.close(() => res(true))); });
}

// #6065: runners share one world dir, and two servers on it die on session.lock. One server per workDir at a time:
// an atomic mkdir lock holding our pid; a dead owner's lock is stolen. A bounded wait on another process, not a queue poll.
async function lockWorkDir(workDir, waitMs) {
  const lock = join(workDir, '.server-lock'), t0 = Date.now();
  for (;;) {
    try { mkdirSync(lock); writeFileSync(join(lock, 'pid'), String(process.pid)); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0; try { pid = +readFileSync(join(lock, 'pid'), 'utf8'); } catch { /* owner is mid-write */ }
      let alive = true;
      if (pid) { try { process.kill(pid, 0); } catch (k) { alive = k.code === 'EPERM'; } }
      if (pid && !alive) { rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() - t0 > waitMs) throw new Error(`referee/server.mjs: ${workDir} is in use by pid ${pid || '?'} (waited ${waitMs}ms)`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const release = () => { try { if (readFileSync(join(lock, 'pid'), 'utf8') === String(process.pid)) rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ } };
  process.once('exit', release);
  return release;
}

// Held by this process once taken. Runners write their datapack into the shared world BEFORE startServer, so they call
// lockReferee() first; startServer then reuses the lock (otherwise another runner's gate/step overwrites ours).
let held = null;
export async function lockReferee(opts = {}) {
  if (held) return held;
  const dir = opts.workDir || refereeWorkDir();
  mkdirSync(dir, { recursive: true });
  const rel = await lockWorkDir(dir, opts.lockWaitMs || 20 * 60000);
  return (held = () => { held = null; rel(); });
}

// #6426: a requested port that is bound falls back to a free one, and the fallback run gets its own workDir
// (<workDir>-p<port>) so concurrent pilots / runchase / rundrown never share a port or a world.
export async function resolveBusyPort(opts) {
  const want = opts.port || +process.env.MCLITE_REFEREE_PORT;
  if (!want || (await portFree(want) && await portFree(opts.rconPort || want + 1000))) return opts;
  const port = await freePort(), rconPort = await freePort();
  return { ...opts, port, rconPort, workDir: (opts.workDir || refereeWorkDir()) + '-p' + port };
}

export async function startServer(opts = {}) {
  opts = await resolveBusyPort(opts);
  const release = await lockReferee(opts);
  try { const srv = await startServerLocked(opts); const stop = srv.stop; srv.stop = async () => { try { await stop(); } finally { release(); } }; srv.proc.once('exit', release); return srv; }
  catch (e) { release(); throw e; }
}

async function startServerLocked(opts) {
  const java = findJava();
  if (!java) throw new Error('referee/server.mjs: no `java` found on PATH and JAVA_HOME is unset');
  const major = javaMajor(java.out);
  if (major < 17) {
    throw new Error(`referee/server.mjs: Java ${major || '?'} found (${java.bin}); the 1.18.2 server needs Java 17+. ` +
      `Set JAVA_HOME to a 17+ JDK. (Full -version output: ${java.out.split('\n')[0]})`);
  }

  const jar = opts.jar || resolveServerJar();
  const workDir = opts.workDir || refereeWorkDir();
  mkdirSync(workDir, { recursive: true });

  // env: a second server beside the first (infra worker). No port given: a free one (#5111: concurrent runners on one machine hit 'Address already in use' on a fixed 25577)
  let port = opts.port || +process.env.MCLITE_REFEREE_PORT || await freePort();
  let rconPort = opts.rconPort || (opts.port || process.env.MCLITE_REFEREE_PORT ? port + 1000 : await freePort());
  if (!await portFree(port)) port = await freePort();
  if (!await portFree(rconPort)) rconPort = await freePort();
  const rconPassword = opts.rconPassword || randPassword();

  writeFileSync(join(workDir, 'eula.txt'), 'eula=true\n');
  writeFileSync(join(workDir, 'server.properties'), [
    'online-mode=false',
    'level-type=flat',
    'generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}',
    'spawn-protection=0',
    'enable-rcon=true',
    `rcon.password=${rconPassword}`,
    `rcon.port=${rconPort}`,
    `server-port=${port}`,
    'white-list=false',
    'max-players=64',          // runchase.mjs connects one growbot per lane (21 > the default 20)
    'enforce-whitelist=false',
    'gamemode=creative',
    'difficulty=easy',         // NOT peaceful: vanilla discards every Monster-class entity on peaceful (checked empirically -- a summoned zombie was gone before the very next RCON command could read it). No player ever joins, so nothing is at risk from an unattacked, un-ticked-for-long mob.
    'spawn-npcs=true',         // false actively discards EVERY Villager/Wandering Trader server-wide (checked empirically -- both vanished right after a clean /summon, no kill, no error logged); true just stops natural village generation, which this flat world has none of anyway.
    'spawn-monsters=false',
    'view-distance=4',
    'simulation-distance=4',
    'max-tick-time=-1',
    'enable-command-block=false',
    '',
  ].join('\n'));

  const extra = (opts.jvmArgs || (process.env.MCLITE_JVM_ARGS ? process.env.MCLITE_JVM_ARGS.split(' ') : []));
  const args = [...extra, `-Xmx${opts.xmx || '1G'}`, '-Dlog4j2.formatMsgNoLookups=true', '-jar', jar, 'nogui'];
  const proc = spawn(java.bin, args, { cwd: workDir });

  let out = '';
  const ready = await new Promise((resolve, reject) => {
    // the 120 s floor assumed an idle machine; at load 55 on 6 cores 'Preparing start region' outlasts it (#6634): stretch by the load per core (#5429: load 124 on 6 cores outlasted the old 6x cap; now 40x, and any server output re-arms the timer)
    const timeoutMs = opts.timeoutMs || Math.round(120000 * Math.min(40, Math.max(1, Math.max(loadavg()[0], loadavg()[1]) / Math.max(1, cpus().length))));
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => reject(new Error('referee/server.mjs: server did not report Done within ' + timeoutMs + 'ms of its last output:\n' + out.slice(-2000))), timeoutMs); };
    arm();
    proc.stdout.on('data', (d) => {
      out += d.toString();
      arm();
      if (/\]: Done \(/.test(out)) { clearTimeout(timer); resolve(true); }
    });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`referee/server.mjs: server exited early (code ${code}):\n` + out.slice(-2000))); });
  });
  if (!ready) throw new Error('referee/server.mjs: server did not start');

  return {
    proc, rconPort, rconPassword, workDir, port,
    async stop() {
      try { proc.stdin.write('stop\n'); } catch { /* ignore */ }
      await new Promise((resolve) => {
        const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } resolve(); }, 15000);
        proc.once('exit', () => { clearTimeout(t); resolve(); });
      });
    },
  };
}

// Smoke test: `node tools/referee/server.mjs` starts and immediately stops the server.
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startServer({});
  console.log('referee/server.mjs: server reported Done (rcon port ' + s.rconPort + ')');
  await s.stop();
  console.log('referee/server.mjs: stopped cleanly');
}
