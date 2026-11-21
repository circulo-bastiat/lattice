#!/usr/bin/env node
// runranged2.mjs — the referee's MOB RANGED II runner (infra I6, s151). Scenes: ranged2scen.mjs (witch, blaze, trident
// drowned, evoker, illusioner). All lanes run at once, one survival growbot per lane, normal, night frozen. Every poll
// (~2 ticks, server gametime) tags each new projectile/spell entity in each lane and records [tick, kind, sub] (sub = the
// thrown potion's Potion id). The player is kept at its spot, topped up with instant_health; Blindness is sampled.
//
//   node tools/referee/runranged2.mjs       (~4 min)
//
// Own port 25883 / rcon 26883, work dir $MCLITE_RANGED2_WORKDIR or ~/.mclite-referee-ranged2; golden -> golden/mob-ranged2.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { T, REPS, DIST, PITCH, Y, SCENES, summarize } from './ranged2scen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBUG = !!process.env.MCLITE_RANGED2_DEBUG;

async function main() {
  const workDir = process.env.MCLITE_RANGED2_WORKDIR || join(homedir(), '.mclite-referee-ranged2');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  // A datapack TICK function does the recording (an RCON poll was ~40-60 ticks coarse under load): each new entity of a
  // lane's kinds appends the gametime to storage r2:log L<k>_<j> (a potion also appends its Potion id to P<k>), and a
  // blinded bot sets #b<k>. The bots are held on their spot every tick.
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliter2');
  mkdirSync(join(dp, 'data', 'r2', 'functions'), { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee ranged2' } }));
  const on = 'execute if score #on r2 matches 1 ';
  const tick = [];
  SCENES.forEach((s, k) => {
    const x = s.open ? k * PITCH + 40 : k * PITCH;
    const bx = s.open ? `x=${x - 16},y=${Y - 2},z=-12,dx=32,dy=40,dz=${(s.dist || DIST) + 24}` : `x=${x - 2},y=${Y - 2},z=-3,dx=4,dy=12,dz=${DIST + 6}`;
    s.kinds.forEach((kind, j) => {
      tick.push(`${on}as @e[type=minecraft:${kind},tag=!r2seen,${bx}] run function r2:rec_${k}_${j}`);
      const rec = ['execute store result storage r2:log t int 1 run time query gametime', `data modify storage r2:log L${k}_${j} append from storage r2:log t`];
      if (kind === 'potion') rec.push(`data modify storage r2:log P${k} append from entity @s Item.tag.Potion`);
      rec.push('tag @s add r2seen');
      writeFileSync(join(dp, 'data', 'r2', 'functions', `rec_${k}_${j}.mcfunction`), rec.join('\n') + '\n');
    });
    if (s.blind) tick.push(`${on}if entity @a[name=r2${k},nbt={ActiveEffects:[{Id:15b}]}] run scoreboard players set #b${k} r2 1`);
    tick.push(`${on}run tp r2${k} ${x + 0.5} ${Y} 0.5`);
  });
  writeFileSync(join(dp, 'data', 'r2', 'functions', 'tick.mcfunction'), tick.join('\n') + '\n');
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['r2:tick'] }));
  const server = await startServer({ workDir, port: 25883, rconPort: 26883, xmx: '1280M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  const laneX = (k) => (SCENES[k] && SCENES[k].open ? k * PITCH + 40 : k * PITCH);
  const bot = (k) => `r2${k}`;
  const box = (k) => `x=${laneX(k) - 2},y=${Y - 2},z=-3,dx=4,dy=12,dz=${DIST + 6}`;
  let rcon; const bots = [];
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'gamerule naturalRegeneration false', 'gamerule doPatrolSpawning false', 'gamerule doTraderSpawning false',
      'gamerule doMobLoot false', 'gamerule mobGriefing false', 'difficulty normal', 'scoreboard objectives add r2 dummy', 'scoreboard players set #on r2 0',
      'datapack enable "file/mcliter2"', `forceload add -8 -24 120 40`]) await C(c);
    for (let k = 0; k < SCENES.length; k++) {
      const x = laneX(k);
      if (SCENES[k].open) continue;
      await C(`fill ${x - 2} ${Y} -3 ${x - 2} ${Y + 2} ${DIST + 3} minecraft:stone`);
      await C(`fill ${x + 2} ${Y} -3 ${x + 2} ${Y + 2} ${DIST + 3} minecraft:stone`);
      await C(`fill ${x - 1} ${Y} -3 ${x + 1} ${Y + 2} -3 minecraft:stone`);
      await C(`fill ${x - 1} ${Y} ${DIST + 3} ${x + 1} ${Y + 2} ${DIST + 3} minecraft:stone`);
    }
    for (let k = 0; k < SCENES.length; k++) {
      bots.push(await connectFakePlayer({ port: server.port, name: bot(k), confirmTeleports: true }));
      await C(`gamemode survival ${bot(k)}`);
      await C(`tp ${bot(k)} ${laneX(k) + 0.5} ${Y} 0.5 0 0`);
    }
    await sleep(500);
    const gametime = async () => { const m = /(-?[0-9]+)\s*$/.exec(await C('time query gametime')); return m ? parseInt(m[1], 10) : NaN; };
    for (let rep = 0; rep < REPS; rep++) {
      await C('kill @e[type=!player]');
      for (let k = 0; k < SCENES.length; k++) {
        await C(`tp ${bot(k)} ${laneX(k) + 0.5} ${Y} 0.5 0 0`);
        await C(`effect clear ${bot(k)}`);
        await C(`effect give ${bot(k)} minecraft:instant_health 1 5`);
        await C(`effect give ${bot(k)} minecraft:resistance 1000 3 true`);
        await C(`effect give ${bot(k)} minecraft:fire_resistance 1000 0 true`);
      }
      await sleep(200);
      const st = SCENES.map((s, k) => ({ s, k, shots: [], blind: false }));
      for (let k = 0; k < SCENES.length; k++) { for (let j = 0; j < SCENES[k].kinds.length; j++) await C(`data modify storage r2:log L${k}_${j} set value []`); await C(`data modify storage r2:log P${k} set value []`); await C(`scoreboard players set #b${k} r2 0`); }
      for (const q of st) {
        if (q.s.target) await C(`summon minecraft:${q.s.target.mob} ${laneX(q.k) + 0.5} ${Y} ${q.s.target.at + 0.5} ${q.s.target.nbt}`);
        const r = await C(`summon minecraft:${q.s.mob} ${laneX(q.k) + 0.5} ${Y + (q.s.up || 0)} ${(q.s.dist || DIST) + 0.5}${q.s.nbt ? ' ' + q.s.nbt : ''}`);
        if (!/Summoned/i.test(r)) notes.push(`${q.s.id}: summon said ${r.trim()}`);
      }
      await C('scoreboard players set #on r2 1');
      const g0 = await gametime();
      for (;;) {
        const t = (await gametime()) - g0;
        if (t >= T) break;
        for (const q of st) {
          const hr = /(-?[\d.]+)f?\s*$/.exec((await C(`data get entity ${bot(q.k)} Health`)).trim());
          if (hr && parseFloat(hr[1]) < 12) await C(`effect give ${bot(q.k)} minecraft:instant_health 1 5`);
        }
        await sleep(Math.min(1000, (T - t) * 50));
      }
      await C('scoreboard players set #on r2 0');
      const list = (r) => { const m = /(?:data|contents): \[(.*)\]\s*$/.exec(r.trim()); return m && m[1].trim() ? m[1].split(',').map((v) => v.trim().replace(/^"|"$/g, '')) : []; };
      if (DEBUG) console.error('[dbg] raw', (await C('data get storage r2:log L0_0')).slice(0, 200), '|', (await C('datapack list enabled')).slice(0, 200), '|', (await C('scoreboard players get #on r2')));
      for (const q of st) {
        for (let j = 0; j < q.s.kinds.length; j++) for (const g of list(await C(`data get storage r2:log L${q.k}_${j}`))) q.shots.push([parseInt(g, 10) - g0, q.s.kinds[j], null]);
        if (q.s.kinds[0] === 'potion') { const ps = list(await C(`data get storage r2:log P${q.k}`)); let i = 0; for (const sh of q.shots) if (sh[1] === 'potion') sh[2] = (ps[i++] || '?').replace('minecraft:', ''); }
        q.shots.sort((a, b) => a[0] - b[0]);
        q.blind = /has 1\b/.test(await C(`scoreboard players get #b${q.k} r2`));
      }
      for (const q of st) {
        const c = cases[q.s.id] || (cases[q.s.id] = { mob: q.s.mob, reps: [] });
        c.reps.push({ shots: q.shots, blind: q.blind, sum: summarize(q.s, q.shots) });
        if (DEBUG) console.error(`[dbg] ${q.s.id} rep ${rep}: ${q.shots.map((s) => s[0] + ':' + s[1][0] + (s[2] ? '/' + s[2] : '')).join(' ')}`);
      }
    }
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const [id, c] of Object.entries(cases)) console.log(`  ${id.padEnd(16)} ${c.reps.map((r) => `vol ${r.sum.nVolleys} first ${r.sum.first} cyc ${r.sum.medCycle} size ${r.sum.medSize} ${JSON.stringify(r.sum.counts)}${r.sum.subs.length ? ' ' + r.sum.subs.join(',') : ''}${r.blind ? ' +blind' : ''}`).join(' | ')}`);
  const golden = { pack: 'mob-ranged2', version: '1.18.2', T, REPS, DIST, clock: 'server gametime, recorded by a datapack tick function the tick each entity first exists (exact)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mob-ranged2.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runranged2: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${join(dir, 'mob-ranged2.json')}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
