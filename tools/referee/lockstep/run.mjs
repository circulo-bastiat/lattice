#!/usr/bin/env node
// lockstep/run.mjs -- #4986 (G17-L0): can the real 1.18.2 server's java.util.Random be pinned?
// Compiles SeedAgent (rewrites Random()'s System.nanoTime() seed salt to a constant), runs the chasescen zombie lane on the
// real server, and prints a hash of the per-tick Pos traces (REPS traces of T ticks each).
//   node tools/referee/lockstep/run.mjs [--salt N] [--noagent]   -> one JSON line {sha, reps, ticks, repsEqual}
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1]; };

export function buildAgent(dir) {
  const out = join(dir, 'out'); mkdirSync(out, { recursive: true });
  const c = spawnSync('javac', ['--add-exports', 'java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED', '-d', out, join(HERE, 'SeedAgent.java')], { encoding: 'utf8' });
  if (c.status !== 0) throw new Error('javac: ' + c.stderr);
  const mf = join(dir, 'manifest.txt'); writeFileSync(mf, 'Premain-Class: SeedAgent\nCan-Retransform-Classes: true\nBoot-Class-Path: seedagent.jar\n');
  const j = spawnSync('jar', ['cfm', join(dir, 'seedagent.jar'), mf, '-C', out, '.'], { encoding: 'utf8' });
  if (j.status !== 0) throw new Error('jar: ' + j.stderr);
  return join(dir, 'seedagent.jar');
}

// one real-server run of a chasescen lane (id = SCEN id); returns the trace text (JSON of the lane's logs)
export const GOLD_FEED = 10;   // #9265: the lane tick the apple is fed at (goldenapplelane.mjs engineGoldenAppleTrace's feedTick)
export function runLane({ mob = 'zombie', salt, agent, tag, logFile, full }) {
  const dir = mkdtempSync(join(tmpdir(), 'lockstep-' + tag + '-'));
  try {
    const outFile = join(dir, 'chase.json');
    const jvm = [];
    if (agent) jvm.push(`-javaagent:${agent}`, `-Dmclite.lockstep.salt=${salt}`, `-Dmclite.lockstep.reset=${join(dir, 'reset.txt')}`, ...(logFile ? [`-Dmclite.lockstep.log=${logFile}`, '-Dmclite.lockstep.logall=true'] : []), // LANE:goldenapple #9265: the agent feeds the golden apple at the zombie villager's n-th tick call (ZombieVillager.tick hook)
      ...(mob === 'goldenapple' ? [`-Dmclite.lockstep.feed=${GOLD_FEED}`] : []),
      // END LANE
      '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED', ...(full ? [`-Dmclite.lockstep.pathlog=${join(dir, 'path.txt')}`] : []));
    // LANE:extra #6224: debugging-only JVM flags from the environment; no pilot lane reads them, so they must not re-hash every lane
    if (agent && process.env.MCLITE_LOCKSTEP_EXTRA) jvm.push(...process.env.MCLITE_LOCKSTEP_EXTRA.split(' '));
    // END LANE
    // LANE:golemwander #9260: the village arena's beds/job sites must read as occupied (SeedAgent.poiOcc)
    if (agent && mob === 'golemwander') jvm.push('--add-opens=java.base/java.util=ALL-UNNAMED', ...(process.env.RNGDBG ? ['-Dmclite.lockstep.rngdbg=true', '-Dmclite.lockstep.rngseq=true'] : []), '-Dmclite.lockstep.poiocc=true', ...(process.env.POIDBG ? ['-Dmclite.lockstep.poidbg=true'] : []));
    // END LANE
    // LANE:goat #10219
    if (agent && mob === 'goat') jvm.push('--add-opens=java.base/java.util=ALL-UNNAMED', '-Dmclite.lockstep.rebasegoat=true', ...(process.env.RNGDBG ? ['-Dmclite.lockstep.rngdbg=true', '-Dmclite.lockstep.rngseq=true'] : []));
    // END LANE
    if (agent && mob === 'wither' && process.env.RNGDBG) jvm.push('--add-opens=java.base/java.util=ALL-UNNAMED', '-Dmclite.lockstep.rngdbg=true', '-Dmclite.lockstep.rngseq=true', '-Dmclite.lockstep.rngmeth=true');   // #10618 debug
    // LANE:villager #10219
    if (agent && mob === 'villager') jvm.push('--add-opens=java.base/java.util=ALL-UNNAMED', '-Dmclite.lockstep.rebasevillager=true', ...(process.env.RNGDBG ? ['-Dmclite.lockstep.rngdbg=true', '-Dmclite.lockstep.rngseq=true'] : []));
    // END LANE
    const r = spawnSync(process.execPath, [join(HERE, '..', 'runchase.mjs')], {
      encoding: 'utf8', maxBuffer: 1 << 26,
      env: { ...process.env, MCLITE_CHASE_ONLY: mob, MCLITE_CHASE_OUT: outFile, ...(agent ? { MCLITE_LOCKSTEP_RESET: join(dir, 'reset.txt') } : {}), MCLITE_CHASE_WORKDIR: join(dir, 'srv'), ...(full ? { MCLITE_LOCKSTEP_PATHLOG: join(dir, 'path.txt') } : {}), MCLITE_JVM_ARGS: jvm.join(' ') },
    });
    if (r.status !== 0) throw new Error('runchase failed:\n' + (r.stderr || r.stdout).slice(-1500));
    const g = JSON.parse(readFileSync(outFile, 'utf8'));
    const c = g.cases[mob];
    // LANE:goldenapple #9265: per rep, per tick the ENTX-shaped entities list [[type, id, conv, [[effect, amp, dur]]]] (id -1: the server's entity id is not part of the compare)
    if (c.gold && !full) return JSON.stringify(c.gold.map((rep) => rep.map(([cv, fx]) => [['zombie_villager', 0, cv > 0 ? cv : -1, fx]])));
    // END LANE
    // LANE:villagerkill #9263: entities = the victim's [[kind, 0, -1]] per tick (kind 0 none / 1 villager / 2 zombie_villager; the server's id is not compared)
    if (c.vk && !full) return JSON.stringify(c.logs.map((l, i) => l.map((p, t) => ({ pos: p, entities: vkEntities(c.vk[i][t]) }))));
    // END LANE
    // LANE:waterentities #9264
    if (c.conv && !full) return JSON.stringify(c.logs.map((l, i) => ({ pos: l, kind: c.conv[i] })));
    // END LANE
    if (c.hp && !full) return JSON.stringify(c.logs.map((l, i) => ({ pos: l, hp: c.hp[i] })));   // #9213: arrowdamage lane
    return full ? c : JSON.stringify(c.hurt ? c.logs.map((l, i) => ({ pos: l, hurt: c.hurt[i] })) : c.logs);   // #9214: a damage lane compares Health/HurtTime too
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// LANE:villagerkill #9263
export const vkEntities = (k) => k === 1 ? [['villager', 0, -1]] : k === 2 ? [['zombie_villager', 0, -1]] : [];
// END LANE
export const runZombie = (o) => runLane({ ...o, mob: 'zombie' });

// #6255: per-tick engine goals for engineRow: engineRow(t, x, goalsEv(Ai, e)).
export const goalsEv = (Ai, e) => ({ goals: Ai.runningGoals(e) });

// #5093: per-seed report. server = rep-0 Pos log ([x,y,z] per tick); engineFor(salt) -> engineRow[] for that salt's seed.
// Returns one entry per salt: { salt, ok, div } where div = first divergent { tick, field, a, b } (a = server, b = engine).
export function perSeedReport(salts, serverFor, engineFor, compareTraces, opts = { fields: ['pos'] }) {
  return salts.map((salt) => {
    const S = serverFor(salt).map((p, tick) => ({ tick, pos: p }));
    const div = compareTraces(S, engineFor(salt), opts);
    return { salt, ok: !div, div };
  });
}
export const fmtReport = (mob, rep) => rep.map((r) => r.ok ? `${mob} salt ${r.salt}: identical` :
  `${mob} salt ${r.salt}: first divergence tick ${r.div.tick} field ${r.div.field} server=${JSON.stringify(r.div.a)} engine=${JSON.stringify(r.div.b)}`).join('\n');

export const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const noagent = process.argv.includes('--noagent');
  const salt = +(arg('--salt') || 0);
  const agent = noagent ? null : buildAgent(mkdtempSync(join(tmpdir(), 'lockstep-agent-')));
  const t = runLane({ mob: arg('--mob') || 'zombie', salt, agent, tag: 'x' });
  const L = JSON.parse(t);
  console.log(JSON.stringify({ salt, agent: !noagent, sha: sha(t), reps: L.length, ticks: L[0].length, repsEqual: L.every((x) => JSON.stringify(x) === JSON.stringify(L[0])), rep0: sha(JSON.stringify(L[0])), head: L[0].slice(0, 30).filter((_, i) => i % 3 == 0).map((p) => p.join(",")).join(" "), firstDiv01: L[0].findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(L[1][i])) }));
}

// #6257 (G17-L25): drain NS.Sounds' per-tick log into engineRow's ev.sounds ([[id, volume, pitch], ...] or null).
export function drainSounds(Sounds, tick) {
  const l = Sounds.drain().filter((x) => x.tick === tick);
  return l.length ? l.map((x) => [String(x.id).replace(/^minecraft:/, ''), x.volume, x.pitch]) : null;
}

// #6258 (G17-L26): ev.particles = Px.drainTally() (the tick's { id: count }); ev.drops = [[itemName, count]] from EL.dropTrace.
export function drainParticles(Px) { return Px.drainTally(); }
export function drainDrops(EL, itemName) {
  const l = (EL.dropTrace || []).splice(0);
  return l.length ? l.map(([i, c]) => [itemName(i), c]) : null;
}
