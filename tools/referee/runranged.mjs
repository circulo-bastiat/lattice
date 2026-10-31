#!/usr/bin/env node
// runranged.mjs — the referee's MOB RANGED runner (infra I6, s148, 25 Sept 2026). Scenarios: rangedscen.mjs.
//
//   node tools/referee/runranged.mjs            (~3 min: 3 difficulties x REPS x T ticks)
//
// Per difficulty: every SCENES lane of that difficulty at once. Per rep: heal+clear each lane's bot, give it Resistance
// IV (hits still register as a health drop, the bot survives T ticks), kill the old shooter + arrows, summon a BARE
// shooter DIST blocks down the lane (bare = MobEntity.initialize runs = it holds its bow/crossbow), tag it, then for
// T ticks (wall clock, one bounded wait on the server WE started, D-436): every ~2 ticks tag fresh arrows near the lane
// (`tag @e[type=arrow,tag=!rrseen,...] add rrseen` returns how many = shots this poll), read Health (a drop = a hit),
// re-tp the bot to its spot (knockback), heal it below 10. Golden -> <referee dir>/golden/mob-ranged.json.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { T, REPS, DIST, PITCH, Y, SCENES, DIFFS, EFFECT_RAWID, summarize } from './rangedscen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEBUG = !!process.env.MCLITE_RANGED_DEBUG;

async function main() {
  const workDir = process.env.MCLITE_RANGED_WORKDIR || join(homedir(), '.mclite-referee-ranged');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25653, rconPort: 26653, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  const laneX = (k) => k * PITCH;
  const bot = (k) => `rr${k}`;
  let rcon; const bots = [];
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false', 'gamerule doWeatherCycle false',
      'weather clear', 'gamerule naturalRegeneration false', 'gamerule doPatrolSpawning false', 'gamerule doTraderSpawning false',
      `forceload add -8 -8 ${laneX(SCENES.length) + 8} ${DIST + 8}`]) await C(c);
    // Walled lanes: stone floor under the grass is irrelevant (grass is solid); walls 3 high at x = lane +- 2.
    for (let k = 0; k < SCENES.length; k++) {
      const x = laneX(k);
      await C(`fill ${x - 2} ${Y} -3 ${x - 2} ${Y + 2} ${DIST + 3} minecraft:stone`);
      await C(`fill ${x + 2} ${Y} -3 ${x + 2} ${Y + 2} ${DIST + 3} minecraft:stone`);
      await C(`fill ${x - 1} ${Y} -3 ${x + 1} ${Y + 2} -3 minecraft:stone`);
      await C(`fill ${x - 1} ${Y} ${DIST + 3} ${x + 1} ${Y + 2} ${DIST + 3} minecraft:stone`);
    }
    for (let k = 0; k < SCENES.length; k++) {
      bots.push(await connectFakePlayer({ port: server.port, name: bot(k) }));
      await C(`gamemode survival ${bot(k)}`);
      await C(`tp ${bot(k)} ${laneX(k) + 0.5} ${Y} 0.5 0 0`);
    }
    await sleep(500);
    for (const diff of DIFFS) {
      const lanes = SCENES.map((s, k) => ({ s, k })).filter((q) => q.s.diff === diff);
      if (!lanes.length) continue;
      await C(`difficulty ${diff}`);
      for (let rep = 0; rep < REPS; rep++) {
        await C('kill @e[type=!player]');
        for (const { k } of lanes) {
          await C(`tp ${bot(k)} ${laneX(k) + 0.5} ${Y} 0.5 0 0`);
          await C(`effect clear ${bot(k)}`);
          await C(`effect give ${bot(k)} minecraft:instant_health 1 5`);
          await C(`effect give ${bot(k)} minecraft:resistance 1000 3 true`);
        }
        await sleep(200);
        const st = {};
        for (const { s, k } of lanes) {
          await C(`summon minecraft:${s.mob} ${laneX(k) + 0.5} ${Y} ${DIST + 0.5}`);
          await C(`tag @e[type=minecraft:${s.mob},tag=!rrmob,limit=1,sort=nearest,x=${laneX(k) + 0.5},y=${Y},z=${DIST + 0.5}] add rrmob`);
          const h = /(-?[\d.]+)f?\s*$/.exec((await C(`data get entity ${bot(k)} Health`)).trim());
          st[s.id] = { k, s, shots: [], hits: [], last: h ? Math.round(parseFloat(h[1]) * 100) : null, eff: false };
        }
        const start = Date.now();
        for (;;) {
          const t = Math.round((Date.now() - start) / 50);
          if (t >= T) break;
          await sleep(100);
          for (const q of Object.values(st)) {
            const x = laneX(q.k);
            const r = await C(`tag @e[type=minecraft:arrow,tag=!rrseen,x=${x - 2},y=${Y - 2},z=-3,dx=4,dy=8,dz=${DIST + 6}] add rrseen`);
            const m = /Added tag 'rrseen' to (\d+) entities/.exec(r) || (/Added tag 'rrseen' to /.test(r) ? [0, '1'] : null);
            const n = m ? parseInt(m[1], 10) : 0;
            for (let i = 0; i < n; i++) q.shots.push(t);
            const hr = /(-?[\d.]+)f?\s*$/.exec((await C(`data get entity ${bot(q.k)} Health`)).trim());
            const hv = hr ? Math.round(parseFloat(hr[1]) * 100) : null;
            if (hv !== null && q.last !== null && hv < q.last) q.hits.push([t, q.last - hv]);
            if (q.s.effect && !q.eff) q.eff = /passed/i.test(await C(`execute if entity @a[name=${bot(q.k)},nbt={ActiveEffects:[{Id:${EFFECT_RAWID[q.s.effect]}b}]}]`));
            if (hv !== null && hv < 1000) { await C(`effect give ${bot(q.k)} minecraft:instant_health 1 5`); q.last = null; } else q.last = hv;
            if (q.last === null) { const h2 = /(-?[\d.]+)f?\s*$/.exec((await C(`data get entity ${bot(q.k)} Health`)).trim()); q.last = h2 ? Math.round(parseFloat(h2[1]) * 100) : null; }
            await C(`tp ${bot(q.k)} ${x + 0.5} ${Y} 0.5 0 0`);
          }
        }
        for (const q of Object.values(st)) {
          const c = cases[q.s.id] || (cases[q.s.id] = { mob: q.s.mob, diff, reps: [] });
          c.reps.push({ shots: q.shots, hits: q.hits, effect: q.eff, sum: summarize(q.shots, q.hits) });
          if (DEBUG) console.error(`[dbg] ${q.s.id} rep ${rep}: shots ${q.shots.join(',')} hits ${q.hits.map((h) => h.join(':')).join(',')}`);
        }
      }
    }
  } finally {
    for (const b of bots) b.close();
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const [id, c] of Object.entries(cases)) console.log(`  ${id.padEnd(18)} ${c.reps.map((r) => `shots ${r.sum.nShots} first ${r.sum.first} int ${r.sum.medInterval} hits ${r.sum.nHits}${r.effect ? ' +eff' : ''}`).join(' | ')}`);
  const golden = { pack: 'mob-ranged', version: '1.18.2', T, REPS, DIST, clock: 'wall-clock ticks (50 ms), polled ~every 2-3 ticks: shot/hit ticks are +-3',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mob-ranged.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runranged: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${join(dir, 'mob-ranged.json')}`);
  for (const n of notes) console.log('  - ' + n);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
