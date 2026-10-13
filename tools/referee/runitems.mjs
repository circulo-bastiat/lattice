#!/usr/bin/env node
// runitems.mjs — the referee's ITEMS runner (infra I6, 25 Sept 2026): ITEM ENTITIES + EXPERIENCE
// ORBS vs the real 1.18.2 server. Lanes + the question: itemscen.mjs. No player connects — every
// lane sits on a forceloaded pad (forceloaded chunks tick with nobody nearby), which sidesteps
// "does an item near a player get picked up" entirely, per that file's header.
//
//   node tools/referee/runitems.mjs            (~2 min)
//   node tools/referee/runitems.mjs --only distH_0.3,cap_cobblestone
//
// Own port 25871 / rcon 26871, work dir $MCLITE_ITEMS_WORKDIR or ~/.mclite-referee-items;
// golden -> golden/items.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';
import {
  FLOOR_Y, MERGE_DIST_TICKS, MERGE_DIST, MERGE_LIMIT_TICKS, MERGE_LIMIT, DESPAWN_TICKS,
  ITEM_DESPAWN, FALL_X, FALL_HEIGHT, FALL_TICKS, XP_TICKS, XP_DESPAWN_TICKS, XP_SAME, XP_MIXED,
  XP_DESPAWN, ALL_X, MAX_X,
} from './itemscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? new RegExp(process.argv[onlyArg + 1]) : null;
const keep = (id) => !ONLY || ONLY.test(id);

async function main() {
  const mergeDist = MERGE_DIST.filter((l) => keep(l.id));
  const mergeLimit = MERGE_LIMIT.filter((l) => keep(l.id));
  const despawn = ITEM_DESPAWN.filter((l) => keep(l.id));
  const doFall = keep('fall');
  const xpSame = keep(XP_SAME.id) ? XP_SAME : null;
  const xpMixed = keep(XP_MIXED.id) ? XP_MIXED : null;
  const xpDespawn = XP_DESPAWN.filter((l) => keep(l.id));

  const workDir = process.env.MCLITE_ITEMS_WORKDIR || join(homedir(), '.mclite-referee-items');
  rmSync(join(workDir, 'world', 'playerdata'), { recursive: true, force: true });
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteitems');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mci', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee items' } }));

  // one 3x3 stone pad per lane, air above it
  const arena = [];
  for (const x of ALL_X) {
    arena.push(`fill ${x - 2} ${FLOOR_Y - 1} -2 ${x + 2} ${FLOOR_Y - 1} 2 minecraft:stone`);
    arena.push(`fill ${x - 2} ${FLOOR_Y} -2 ${x + 2} ${FLOOR_Y + 12} 2 minecraft:air`);
  }
  writeFileSync(join(fdir, 'arena.mcfunction'), arena.join('\n') + '\n');

  // ⚠ CHECKPOINTS ARE SERVER-SCHEDULED, NOT RCON-POLLED. An earlier version waited on the
  // gametime clock over RCON and read the result with more RCON round trips (~40ms+ each, the
  // rcon.mjs multi-packet settle debounce) -- on the despawn lanes, whose itemAge/orbAge flips
  // exactly 10 ticks (500ms) after summon, a handful of unrelated reads ahead of the despawn
  // read was enough real time to silently cross the flip, so "+5" sometimes read a lane that had
  // already despawned. `/schedule function ... <N>t` runs ON THE SERVER'S OWN TICK CLOCK,
  // immune to how long our RCON round trip takes -- every checkpoint capture is scheduled in the
  // SAME tick as the summon, and we only touch RCON again, once, well after the last one fires.
  const summon = [];
  const named = (name) => `,tag:{display:{Name:'${JSON.stringify({ text: name })}'}}`;
  for (const l of mergeDist) {
    const dx = l.axis === 'x' ? l.gap / 2 : 0, dy = l.axis === 'y' ? l.gap : 0;
    summon.push(`summon minecraft:item ${l.x - dx + 0.5} ${FLOOR_Y} 0.5 {Item:{id:"minecraft:${l.item}",Count:${l.count}b},Motion:[0.0d,0.0d,0.0d],Tags:["${l.id}","${l.id}a"]}`);
    summon.push(`summon minecraft:item ${l.x + dx + 0.5} ${FLOOR_Y + dy} 0.5 {Item:{id:"minecraft:${l.item}",Count:${l.count}b},Motion:[0.0d,0.0d,0.0d],Tags:["${l.id}","${l.id}b"]}`);
  }
  for (const l of mergeLimit) {
    const item2 = l.item2 || l.item;
    const nbtB = l.nameB ? named(l.nameB) : '';
    summon.push(`summon minecraft:item ${l.x - 0.15 + 0.5} ${FLOOR_Y} 0.5 {Item:{id:"minecraft:${l.item}",Count:${l.a}b},Motion:[0.0d,0.0d,0.0d],Tags:["${l.id}a"]}`);
    summon.push(`summon minecraft:item ${l.x + 0.15 + 0.5} ${FLOOR_Y} 0.5 {Item:{id:"minecraft:${item2}",Count:${l.b}b${nbtB}},Motion:[0.0d,0.0d,0.0d],Tags:["${l.id}b"]}`);
  }
  for (const l of despawn) {
    summon.push(`summon minecraft:item ${l.x + 0.5} ${FLOOR_Y} 0.5 {Item:{id:"minecraft:${l.item}",Count:${l.count}b},Motion:[0.0d,0.0d,0.0d],Age:${l.age}s,Tags:["${l.id}"]}`);
  }
  const orbLane = (lane) => lane.values.forEach((v, i) => summon.push(`summon minecraft:experience_orb ${lane.x + 0.5} ${FLOOR_Y} 0.5 {Value:${v}s,Count:1,Tags:["${lane.id}","${lane.id}_${i}"]}`));
  if (xpSame) orbLane(xpSame);
  if (xpMixed) orbLane(xpMixed);
  for (const l of xpDespawn) summon.push(`summon minecraft:experience_orb ${l.x + 0.5} ${FLOOR_Y} 0.5 {Value:${l.value}s,Count:1,Age:${l.age}s,Tags:["${l.id}"]}`);

  // one storage-write mcfunction per checkpoint tick that has anything to capture
  // ⚠ NBT PATHS SPLIT ON '.': a lane id like "distH_0.3" used directly as a storage path segment
  // silently becomes TWO segments ("distH_0" then "3"), not one key -- sanitise every id used in
  // a storage PATH (never in a tag/selector, which take the literal id and are unaffected).
  const skey = (id) => id.replace(/\./g, '_');
  const cps = [...new Set([...MERGE_DIST_TICKS, MERGE_LIMIT_TICKS, ...DESPAWN_TICKS, ...XP_TICKS, ...XP_DESPAWN_TICKS])].sort((x, y) => x - y);
  for (const cp of cps) {
    const w = [];
    for (const l of despawn) if (DESPAWN_TICKS.includes(cp)) w.push(`execute store result storage mci:r d.${skey(l.id)}.t${cp} int 1 run execute if entity @e[tag=${l.id}]`);
    for (const l of xpDespawn) if (XP_DESPAWN_TICKS.includes(cp)) w.push(`execute store result storage mci:r xd.${skey(l.id)}.t${cp} int 1 run execute if entity @e[tag=${l.id}]`);
    for (const l of mergeDist) if (MERGE_DIST_TICKS.includes(cp)) {
      w.push(`execute store result storage mci:r md.${skey(l.id)}.t${cp}.n int 1 run execute if entity @e[tag=${l.id}]`);
      w.push(`execute store result storage mci:r md.${skey(l.id)}.t${cp}.a int 1 if entity @e[tag=${l.id}a] run data get entity @e[tag=${l.id}a,limit=1] Item.Count`);
      w.push(`execute store result storage mci:r md.${skey(l.id)}.t${cp}.b int 1 if entity @e[tag=${l.id}b] run data get entity @e[tag=${l.id}b,limit=1] Item.Count`);
    }
    for (const l of mergeLimit) if (cp === MERGE_LIMIT_TICKS) {
      w.push(`execute store result storage mci:r ml.${skey(l.id)}.a int 1 if entity @e[tag=${l.id}a] run data get entity @e[tag=${l.id}a,limit=1] Item.Count`);
      w.push(`execute store result storage mci:r ml.${skey(l.id)}.b int 1 if entity @e[tag=${l.id}b] run data get entity @e[tag=${l.id}b,limit=1] Item.Count`);
    }
    for (const lane of [xpSame, xpMixed].filter(Boolean)) if (XP_TICKS.includes(cp)) {
      w.push(`execute store result storage mci:r xp.${skey(lane.id)}.t${cp}.n int 1 run execute if entity @e[tag=${lane.id}]`);
      lane.values.forEach((v, i) => {
        w.push(`execute store result storage mci:r xp.${skey(lane.id)}.t${cp}.v${i} int 1 if entity @e[tag=${lane.id}_${i}] run data get entity @e[tag=${lane.id}_${i},limit=1] Value`);
        w.push(`execute store result storage mci:r xp.${skey(lane.id)}.t${cp}.c${i} int 1 if entity @e[tag=${lane.id}_${i}] run data get entity @e[tag=${lane.id}_${i},limit=1] Count`);
      });
    }
    if (w.length) writeFileSync(join(fdir, `cp${cp}.mcfunction`), w.join('\n') + '\n');
    // ⚠ OFF BY ONE, CONFIRMED EMPIRICALLY (the fall trace's own ys[0] == the un-moved spawn
    // height): a function scheduled `Nt` fires at the START of tick N, BEFORE that tick's own
    // entity physics/merge/despawn checks run -- so it reads the state after N-1 ticks, not N.
    // Scheduling at `(cp+1)t` reads the state after exactly `cp` ticks, matching the engine
    // side's own `tickN(cp); read()` convention and the mid-cadence merge checks (vanilla only
    // retries a stationary item's merge every 40 ticks, so a checkpoint sampled one tick early
    // can silently miss a merge that happens ON tick 40).
    summon.push(`schedule function mci:cp${cp} ${cp + 1}t replace`);
  }
  const LAST_CP = cps.length ? Math.max(...cps) : 0;

  // FALL: same schedule-not-RCON principle, one function that appends this tick's y then
  // reschedules itself for the next tick (`fc` counts the tick, so it always fires exactly
  // FALL_TICKS times regardless of any RCON lag around it).
  if (doFall) {
    summon.push(`kill @e[type=minecraft:item,x=${FALL_X - 3},y=${FLOOR_Y - 2},z=-3,dx=6,dy=${FALL_HEIGHT + 6},dz=6]`);
    summon.push(`summon minecraft:item ${FALL_X + 0.5} ${FLOOR_Y + FALL_HEIGHT} 0.5 {Item:{id:"minecraft:cobblestone",Count:1b},Motion:[0.0d,0.0d,0.0d],Tags:["fall"]}`);
    summon.push('scoreboard objectives add mci_fc dummy', 'scoreboard players set fc mci_fc 0', 'data modify storage mci:r fall set value []',
      'schedule function mci:fallstep 1t replace');
    // ⚠ `execute store result ... run data get entity <target> <path>` loses the fraction:
    // `data get`'s OWN result (what gets chained) is already an int (its default internal
    // scale is 1, applied before `execute store` ever sees a value) -- the outer store's
    // "double" type only changes how that already-truncated int is REPRESENTED. The fix is
    // `data get`'s own scale argument: scale the Pos value up to an integer INSIDE `data get`
    // (Pos[1] 1000 -> e.g. 13763 for y=13.763), then scale back down on the way into storage.
    writeFileSync(join(fdir, 'fallstep.mcfunction'), [
      'data modify storage mci:r fall append value 0.0d',
      'execute store result storage mci:r fall[-1] double 0.001 run data get entity @e[tag=fall,limit=1] Pos[1] 1000',
      'scoreboard players add fc mci_fc 1',
      `execute if score fc mci_fc matches ..${FALL_TICKS - 1} run schedule function mci:fallstep 1t replace`,
    ].join('\n') + '\n');
  }
  writeFileSync(join(fdir, 'summon.mcfunction'), summon.join('\n') + '\n');

  const server = await startServer({ workDir, port: 25871, rconPort: 26871, xmx: '1536M' });
  const t0 = Date.now();
  const cases = { mergeDist: {}, mergeLimit: {}, despawn: {}, xp: {}, xpDespawn: {} };
  let fall = null;
  const notes = [];
  let rcon;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty peaceful', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', `forceload add -16 -16 ${MAX_X + 16} 16`, 'datapack enable "file/mcliteitems"'])
      await C(c);
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };

    // ⚠ RETRIED, NOT JUST DELAYED (up to 3 attempts): even with the settle sleep below, an
    // isolated single-entity lane has, empirically, still occasionally read back "despawned"
    // ticks before its real 6000-itemAge transition could possibly have fired -- a rare
    // server-side hiccup (its own log shows "Can't keep up!" tick-catch-up warnings around
    // world/chunk generation), not a vanilla rule. `sane()` below is the same 6000-itemAge law
    // every despawn/xpDespawn lane already carries, so this cannot mask a real vanilla mismatch:
    // a lane genuinely dying early would fail `sane()` on every attempt and still surface.
    const sane = (r) => {
      for (const l of despawn) if (l.age > -32768) { const t = 6000 - l.age; for (const cp of DESPAWN_TICKS) if (cp <= t - 3) { const v = r.d && r.d[skey(l.id)] && r.d[skey(l.id)][`t${cp}`]; if (v === 0) return false; } }
      for (const l of xpDespawn) { const t = 6000 - l.age; for (const cp of XP_DESPAWN_TICKS) if (cp <= t - 3) { const v = r.xd && r.xd[skey(l.id)] && r.xd[skey(l.id)][`t${cp}`]; if (v === 0) return false; } }
      return true;
    };
    let r = {};
    for (let attempt = 1; attempt <= 3; attempt++) {
      // a clean slate: the work dir persists across runs, and a leftover pile from a PRIOR run
      // (or, on a retry, from the PREVIOUS attempt) sitting exactly where a fresh lane summons
      // would silently absorb the new item into itself (same item, same spot -> instant merge),
      // discarding the fresh item's own tag with it -- or, for a tagged non-mergeable entity
      // (an orb), just leave TWO of it alive and inflate every count that reads its tag. `kill`
      // can itself miss an entity whose chunk is still settling (the very hiccup the retry above
      // exists for), so confirm the world is actually empty before rebuilding.
      for (let k = 1; k <= 5; k++) {
        await C('kill @e[type=!minecraft:player]');
        if (!/count:\s*[1-9]/i.test(await C('execute if entity @e[type=!minecraft:player]'))) break;
        await sleep(300);
      }
      await C('data modify storage mci:r set value {}');
      await C('function mci:arena');
      // a generous settle: a pad whose chunk is still finishing async generation/finalisation
      // when something is summoned into it has, empirically, sometimes lost that entity outright
      // (reproduced on an isolated single-orb, single-fill lane far from any other cause) --
      // giving every pad's chunk time to fully settle before summoning is cheap next to a false
      // "despawned" reading.
      await sleep(3000);
      await C('function mci:summon');
      const g0 = await gametime();
      // every checkpoint (and every fall-trace step) is already scheduled server-side (see the
      // `schedule function` calls baked into summon.mcfunction above); we just have to wait
      // comfortably past the LAST one before touching RCON again -- no polling, one fixed sleep.
      const lastTick = Math.max(LAST_CP + 1, doFall ? FALL_TICKS : 0);
      if (lastTick > 0) {
        await sleep(lastTick * 50 + 2000);
        for (let a = 1; ; a++) { const gt = await gametime(); if (gt >= g0 + lastTick) break; if (a >= 20) { notes.push(`gametime only reached +${gt - g0} of +${lastTick} after the fixed wait`); break; } await sleep(500); }
      }
      if (!cps.length) break;
      r = snbtOfReply(await C('data get storage mci:r')) || {};
      if (sane(r)) break;
      notes.push(`attempt ${attempt}: an impossibly-early despawn reading, retrying`);
      console.log(`  retry ${attempt}: an impossibly-early despawn reading (server hiccup, not a real transition)`);
    }

    if (cps.length) {
      for (const l of despawn) {
        const byTick = {};
        for (const cp of DESPAWN_TICKS) { const v = r.d && r.d[skey(l.id)] && r.d[skey(l.id)][`t${cp}`]; if (v !== undefined) byTick[cp] = v; }
        cases.despawn[l.id] = { age: l.age, byTick };
      }
      for (const l of xpDespawn) {
        const byTick = {};
        for (const cp of XP_DESPAWN_TICKS) { const v = r.xd && r.xd[skey(l.id)] && r.xd[skey(l.id)][`t${cp}`]; if (v !== undefined) byTick[cp] = v; }
        cases.xpDespawn[l.id] = { age: l.age, byTick };
      }
      for (const l of mergeDist) {
        const byTick = {};
        for (const cp of MERGE_DIST_TICKS) {
          const t = r.md && r.md[skey(l.id)] && r.md[skey(l.id)][`t${cp}`];
          if (!t) continue;
          byTick[cp] = { n: t.n, counts: [t.a, t.b].filter((x) => x !== undefined) };
        }
        cases.mergeDist[l.id] = { item: l.item, axis: l.axis, gap: l.gap, count0: l.count, byTick };
      }
      for (const l of mergeLimit) {
        const t = r.ml && r.ml[skey(l.id)];
        cases.mergeLimit[l.id] = { item: l.item, item2: l.item2 || l.item, a0: l.a, b0: l.b, named: !!l.nameB, counts: [t && t.a, t && t.b].filter((x) => x !== undefined) };
      }
      for (const lane of [xpSame, xpMixed].filter(Boolean)) {
        const byTick = {};
        for (const cp of XP_TICKS) {
          const t = r.xp && r.xp[skey(lane.id)] && r.xp[skey(lane.id)][`t${cp}`];
          if (!t) continue;
          const orbs = [];
          for (let i = 0; i < lane.values.length; i++) if (t[`v${i}`] !== undefined) orbs.push({ value: t[`v${i}`], count: t[`c${i}`] });
          byTick[cp] = { n: t.n, orbs };
        }
        cases.xp[lane.id] = { values0: lane.values, byTick };
      }
      console.log('  batch groups scheduled+read at ticks:', cps.join(', '));
    }

    if (doFall) {
      const raw = await C('data get storage mci:r fall');
      const ys = snbtOfReply(raw) || [];
      fall = { height: FALL_HEIGHT, ys };
      console.log('  fall trace: y1..y5 =', ys.slice(0, 5).map((v) => v && v.toFixed(3)).join(', '));
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = {
    pack: 'items', version: '1.18.2', generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    clock: 'no player connected; every lane on its own forceloaded 3x3 stone pad, /summon (Motion 0,0,0 unless a fall trace); ' +
      'entity counts via `execute if entity @e[tag]` (success count = matches), field reads via `data get entity ... <path>`',
    cases, fall, notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'items.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runitems: ${golden.seconds} s -> ${join(dir, 'items.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
