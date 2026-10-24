#!/usr/bin/env node
// lockstep/soakcapture.mjs -- #9446 (G17-L38a): the REAL-SERVER half of the soak: 12 mixed mobs (soak.mjs SOAK_MOBS) summoned by one scripted
// /summon list in a seeded GENERATED world, per-mob per-tick ENTX rows for SOAK_TICKS ticks. No engine side, no divergence table (owed, #6270).
//   node tools/referee/lockstep/soakcapture.mjs [--salt N] [--ticks 3000]  -> one JSON line { salt, ticks, a, b, same, rows:[per-mob row counts] }
// Two fresh server runs under the SeedAgent (ENTXLOG on); `same` = the two per-mob traces are identical (a == b).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '../server.mjs';
import { connectRcon } from '../rcon.mjs';
import { buildAgent, sha } from './run.mjs';
import { SOAK_MOBS, SOAK_TICKS } from './soak.mjs';
import { parseEntxLog, compareTraces } from './trace.mjs';
export const SOAK_SEED = 9446;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one /summon per mob at its surface y (1.18.2 has no `positioned over`: the surface is probed over rcon, see surfaceY), Tags soak<n>, persistent.
export const soakSummons = (ys, base = [0, 0]) => SOAK_MOBS.map((m) =>
  `summon minecraft:${m.id} ${base[0] + m.x + 0.5} ${ys[m.n]} ${base[1] + m.z + 0.5} {Tags:["soak${m.n}"],PersistenceRequired:1b}`);
// The generated world's origin can be ocean: the first of these bases whose 4 corner points are dry land (surface block not water, y 63..110) hosts the mobs.
export const BASES = (() => { const o = [[0, 0]]; for (let r = 1; r <= 12; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (Math.max(Math.abs(x), Math.abs(z)) === r) o.push([x * 64, z * 64]); return o; })();   // rings of step 64
export async function findLand(C) {
  for (const [bx, bz] of BASES) {
    await C(`forceload add ${bx - 16} ${bz - 16} ${bx + 32} ${bz + 48}`); await sleep(700);
    const pts = [[bx, bz], [bx + 16, bz + 24], [bx + 8, bz + 12]]; let dry = true;
    for (const [x, z] of pts) {
      let y; try { y = (await surfaceY(C, x, z)) - 1; } catch { dry = false; break; }
      if (process.env.SOAK_KEEP) console.error('probe', bx, bz, x, z, y);
      if (y < 63 || y > 110 || /Test passed/.test(await C(`execute if block ${x} ${y} ${z} minecraft:water`))) { dry = false; break; }
    }
    if (dry) return [bx, bz];
    await C(`forceload remove ${bx - 16} ${bz - 16} ${bx + 32} ${bz + 48}`);
  }
  throw new Error('findLand: no dry base found');
}
// first non-air block going down from y=200 at (x,z), +1 (`execute if block` replies 'Test passed' for a match)
export async function surfaceY(C, x, z) {
  for (let y = 200; y > -64; y--) if (/Test failed/.test(await C(`execute if block ${x} ${y} ${z} minecraft:air`))) return y + 1;
  throw new Error(`surfaceY: no ground at ${x},${z}`);
}
export const soakPack = (ys, base) => ({
  spawn: [...soakSummons(ys, base), 'scoreboard players set #t mc 0', 'scoreboard players set #run mc 1'],
  tick: ['scoreboard players set #20 mc 20', 'execute store result score #g mc run time query gametime', 'scoreboard players operation #g mc %= #20 mc',
    'execute if score #arm mc matches 1 if score #g mc matches 0 run function mclitesoak:spawn', 'execute if score #arm mc matches 1 if score #g mc matches 0 run scoreboard players set #arm mc 0',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'],
});
// ENTX text -> per-mob traces. Entity ids are handed out in summon order, so the 12 lowest ids that tick-1 appear are mob 0..11; later ids (babies) are not mobs.
// -> { mobs: [[{ tick, entities:[[type,id,conv,[[eff,amp,dur]]]] }]] per mob, ids, extra }
export function splitEntx(text, ticks = SOAK_TICKS, n = SOAK_MOBS.length) {
  const byTick = parseEntxLog(text), firstSeen = new Map();
  const tks = Object.keys(byTick).map(Number).sort((p, q) => p - q);
  for (const t of tks) for (const r of byTick[t]) if (!firstSeen.has(r[1])) firstSeen.set(r[1], t);
  const t0 = tks[0];   // the summons share one tick; anything first seen later (babies, worldgen stragglers) is not one of the 12
  const ids = [...firstSeen].filter(([, t]) => t <= t0 + 1).map(([id]) => id).sort((p, q) => p - q).slice(0, n);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const mobs = ids.map(() => []); let extra = 0;
  for (const t of tks) {
    if (t > ticks + t0) break;
    for (const r of byTick[t]) { const i = idx.get(r[1]); if (i === undefined) extra++; else mobs[i].push({ tick: t, entities: [[r[0], i, r[2], r[3]]] }); }   // the raw entity id depends on how many entities worldgen made first (differs run to run): the mob's index stands in
  }
  const extraTypes = {}; for (const t of tks) for (const r of byTick[t]) if (!idx.has(r[1])) extraTypes[r[0] + '#' + r[1]] = (extraTypes[r[0] + '#' + r[1]] || 0) + 1;
  return { mobs, ids, extra, extraTypes };
}
export const sameCapture = (A, B) => A.mobs.length === B.mobs.length && A.mobs.every((t, i) => compareTraces(t, B.mobs[i], { fields: ['entities'] }) === null);
export async function captureSoak({ salt, agent, ticks = SOAK_TICKS, tag = 'x' }) {
  const dir = mkdtempSync(join(tmpdir(), 'soakcap-' + tag + '-')), log = join(dir, 'entx.txt'), reset = join(dir, 'reset.txt'), workDir = join(dir, 'srv');
  writeFileSync(log, ''); writeFileSync(reset, 'rep0');
  const fdir = join(workDir, 'world', 'datapacks', 'mclitesoak', 'data', 'mclitesoak', 'functions'), tdir = join(workDir, 'world', 'datapacks', 'mclitesoak', 'data', 'minecraft', 'tags', 'functions');
  mkdirSync(fdir, { recursive: true }); mkdirSync(tdir, { recursive: true });
  const pk = join(workDir, 'world', 'datapacks', 'mclitesoak');
  writeFileSync(join(pk, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite soak' } }));
  writeFileSync(join(tdir, 'tick.json'), JSON.stringify({ values: ['mclitesoak:tick'] }));
  const jvmArgs = [`-javaagent:${agent}`, `-Dmclite.lockstep.salt=${salt}`, `-Dmclite.lockstep.reset=${reset}`, `-Dmclite.lockstep.entxlog=${log}`, '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED'];
  const server = await startServer({ workDir, jvmArgs, xmx: '1536M', properties: { 'level-type': 'default', 'generator-settings': null, 'level-seed': SOAK_SEED, 'spawn-monsters': 'false' } });
  let rcon;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0',
      'scoreboard objectives add mc dummy', 'scoreboard players set #run mc 0', 'scoreboard players set #arm mc 0']) await C(c);
    const base = await findLand(C), ys = []; for (const m of SOAK_MOBS) ys.push(await surfaceY(C, base[0] + m.x, base[1] + m.z));
    const P = soakPack(ys, base);
    writeFileSync(join(fdir, 'spawn.mcfunction'), P.spawn.join('\n') + '\n'); writeFileSync(join(fdir, 'tick.mcfunction'), P.tick.join('\n') + '\n');
    const rl = await C('reload'); if (/rror|nknown/.test(rl)) throw new Error('reload: ' + rl);
    await sleep(4000);   // chunks generate; the post-load entity burst settles (same pause as runchase)
    await C('kill @e[type=!player]');
    writeFileSync(log, ''); writeFileSync(reset, 'rep0arm'); await sleep(200);
    await C('scoreboard players set #arm mc 1');
    await sleep(ticks * 50 + 1000);
    let tNow = 0;
    for (let i = 0; i < 60; i++) { tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1]; if (tNow >= ticks) break; await sleep(500); }
    if (process.env.SOAK_KEEP) { console.error('base', base, 'ys', JSON.stringify(ys)); for (const m of SOAK_MOBS) console.error(m.n, m.id, await C(`data get entity @e[tag=soak${m.n},limit=1] Pos`)); }
    await C('scoreboard players set #run mc 0');
    if (tNow < ticks) throw new Error(`soakcapture: only ${tNow}/${ticks} ticks ran`);
  } finally { if (rcon) rcon.close(); await server.stop(); }
  if (process.env.SOAK_KEEP) writeFileSync(process.env.SOAK_KEEP, readFileSync(log));
  try { return splitEntx(readFileSync(log, 'utf8'), ticks); } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
  const salt = +arg('--salt', 0), ticks = +arg('--ticks', SOAK_TICKS);
  const agent = buildAgent(mkdtempSync(join(tmpdir(), 'soakcap-agent-')));
  const a = await captureSoak({ salt, agent, ticks, tag: 'a' }), b = await captureSoak({ salt, agent, ticks, tag: 'b' });
  const h = (c) => sha(JSON.stringify(c.mobs));
  console.log(JSON.stringify({ salt, ticks, a: h(a), b: h(b), same: sameCapture(a, b), mobs: a.mobs.length, rows: a.mobs.map((t) => t.length), extra: [a.extra, b.extra] }));
  if (!sameCapture(a, b)) console.error('first divergence per mob:', JSON.stringify(a.mobs.map((t, i) => { const d = compareTraces(t, b.mobs[i], { fields: ['entities'] }); return d && { tick: d.tick, a: d.a, b: d.b }; })), '\nextra a', JSON.stringify(a.extraTypes), '\nextra b', JSON.stringify(b.extraTypes));
  process.exit(sameCapture(a, b) && a.mobs.length === SOAK_MOBS.length ? 0 : 1);
}
