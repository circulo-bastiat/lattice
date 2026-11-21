#!/usr/bin/env node
// runbucket.mjs — the referee's BUCKET runner (infra I6, s146). Scenarios: bucketscen.mjs.
//   node tools/referee/runbucket.mjs [--pack bucket|useon|blockuse|itemuse] [--only <regex>]   (bucket: 15 scenes x 3 reps, ~70 s; useon: useonscen.mjs,
//   19 scenes x 3, ~80 s; blockuse: blockusescen.mjs, 18 scenes x 3, ~75 s; itemuse: itemusescen.mjs, 12 scenes x 20, ~90 s; --only merges into <pack>.json)
// ONE growbot player standing at (0.5, F, 0.5), teleported with yaw 0 / pitch 90 (straight down) so BucketItem.use's own raycast
// from the eye hits the column's cell F-1. Per click: the stone box rebuilt, the scene's cells set, the gamemode set, `clear`, n of
// the item in the main hand, one Use Item packet (0x2f), 0.4 s, then: the main hand (`data get entity br0 SelectedItem`), each
// `gets` id counted in the whole inventory (`clear br0 <id> 0`), each `test` predicate (`execute if block`), each `count` entity.
// Own port 25873 + work dir (MCLITE_BUCKET_WORKDIR, default ~/.mclite-referee-bucket); golden -> <referee dir>/golden/bucket.json.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
const PACK = process.argv.includes('--pack') ? process.argv[process.argv.indexOf('--pack') + 1] : 'bucket';
if (!/^(bucket|useon|blockuse|itemuse)$/.test(PACK)) { console.error('runbucket: --pack bucket|useon|blockuse|itemuse'); process.exit(2); }
const { SCEN, REPS } = await import(`./${PACK}scen.mjs`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = -58;
const ONLY = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
function parseHeld(r) {
  const s = String(r);
  const id = /id: "minecraft:([a-z_]+)"/.exec(s), cnt = /Count: (\d+)b/.exec(s), dmg = /Damage: (\d+)/.exec(s);
  return id ? { id: id[1], n: cnt ? +cnt[1] : 1, dmg: dmg ? +dmg[1] : 0 } : { id: '', n: 0, dmg: 0 };
}
async function main() {
  const workDir = process.env.MCLITE_BUCKET_WORKDIR || join(homedir(), '.mclite-referee-' + PACK);
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25873 + ['bucket', 'useon', 'blockuse', 'itemuse'].indexOf(PACK), rconPort: 26873 + ['bucket', 'useon', 'blockuse', 'itemuse'].indexOf(PACK), xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty peaceful', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule doTileDrops false', 'forceload add -16 -16 16 16']) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'br0', confirmTeleports: true });
    await sleep(1500);
    await C('gamemode survival br0');
    await C(`tp br0 0.5 ${F} 0.5 0 90`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, F, 0.5, true); }, 50);
    await sleep(2500);
    for (const s of SCEN.filter((q) => !ONLY || ONLY.test(q.id))) {
      const c = cases[s.id] = { attempts: 0, held: {}, gets: {}, test: {}, count: {}, spawner: {} };
      for (let r = 0; r < REPS; r++) {
        await C('kill @e[type=!player]');
        await C(`fill -3 ${F - 4} -3 3 ${F + 3} 3 minecraft:air`);
        await C(`fill -2 ${F - 3} -2 2 ${F - 1} 2 minecraft:stone`);
        for (const [dy, st] of Object.entries(s.set || {})) await C(`setblock 0 ${F + +dy} 0 minecraft:${st}`);
        await C(`gamemode ${s.mode || 'survival'} br0`);
        await C('effect give br0 minecraft:fire_resistance 1000 0 true');   // lava poured at its own feet must not kill it (a lost stack, rep 1 of 3)
        await C('effect give br0 minecraft:instant_health 1 10 true');
        await C(`tp br0 0.5 ${F} 0.5 0 90`);
        await C('clear br0');
        if (s.item !== 'air') await C(`item replace entity br0 weapon.mainhand with minecraft:${s.item} ${s.n}`);
        await sleep(250);
        if (s.via === 'block') bot.useOnBlock(0, F - 1, 0, 1, 0.5, 1, 0.5); else bot.useItem(0);
        await sleep(400);
        const h = parseHeld(await C('data get entity br0 SelectedItem'));
        const k = `${h.id}x${h.n}${h.dmg ? '@' + h.dmg : ''}`;
        c.held[k] = (c.held[k] || 0) + 1;
        for (const g of s.gets || []) { const m = /Found (\d+) matching/.exec(await C(`clear br0 minecraft:${g} 0`)); c.gets[g] = (c.gets[g] || 0) + (m ? +m[1] : 0); }
        for (const t of s.test || []) {
          const [dy, st] = t.split(':');
          const res = String(await C(`execute if block 0 ${F + +dy} 0 minecraft:${st}`));
          c.test[t] = (c.test[t] || 0) + (/Test passed/.test(res) ? 1 : 0);
        }
        for (const e of s.count || []) {
          const res = String(await C(`execute if entity @e[type=minecraft:${e},x=-3,y=${F - 4},z=-3,dx=6,dy=8,dz=6]`));
          const m = /Test passed, count: (\d+)/.exec(res);
          c.count[e] = (c.count[e] || 0) + (m ? +m[1] : 0);
        }
        // itemuse pack only -- SpawnEggItem on a mob_spawner sets SpawnData/entity, not a
        // vanilla block-state property, so it has no `test` predicate to read back.
        if (s.spawner) {
          const res = String(await C(`data get block 0 ${F - 1} 0 SpawnData.entity.id`));
          const idm = /minecraft:([a-z_]+)/.exec(res);
          const id = idm ? idm[1] : '';
          c.spawner[id] = (c.spawner[id] || 0) + 1;
        }
        c.attempts++;
      }
      console.log(`  ${s.id.padEnd(32)} held ${JSON.stringify(c.held)} gets ${JSON.stringify(c.gets)} test ${JSON.stringify(c.test)} count ${JSON.stringify(c.count)}${s.spawner ? ' spawner ' + JSON.stringify(c.spawner) : ''}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: PACK, version: '1.18.2', REPS, F,
    clock: 'growbot at (0.5,F,0.5) yaw 0 pitch 90, stone box rebuilt, n of the item in the main hand, one Use Item packet, 0.4 s -> main hand, inventory, block predicates, entities',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  if (ONLY && existsSync(join(dir, PACK + '.json'))) {
    const old = JSON.parse(readFileSync(join(dir, PACK + '.json'), 'utf8'));
    golden.cases = Object.assign({}, old.cases, cases); golden.seconds += old.seconds || 0;
  }
  writeFileSync(join(dir, PACK + '.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runbucket: ${golden.seconds} s -> ${join(dir, PACK + '.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
