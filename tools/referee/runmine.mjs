#!/usr/bin/env node
// runmine.mjs — the referee's MINING runner (infra I6, s147). Scenarios + the vanilla sources: minescen.mjs.
//   node tools/referee/runmine.mjs [--only <regex>]      (21 scenes x 3 reps, ~2.5 min; --only merges into mine.json)
// ONE growbot player at (0.5, F, 0.5), yaw 0 / pitch 90. Per rep: the stone box rebuilt, the target cell (0, F-1, 0) set, the
// gamemode + effect set, `clear`, the tool in the main hand (with its Enchantments NBT), then Player Digging START + STOP (0x1a)
// back to back, `time query gametime` at once (G0), then `execute if block ... air run time query gametime` every ~15 ms until it
// answers (G1): k = G1 - G0 is the server's own ticks from START to the break (see minescen.mjs). The RCON read and the packet land in
// the same between-tick window almost always — the check takes the MODE of the reps. Then 0.8 s (the bot picks the drop up), the
// main hand (`data get entity br0 SelectedItem`: id, Damage), each `gets` id counted in the inventory (`clear br0 <id> 0`), and the
// item entities still lying in the box.
// Own port 25880 + work dir (MCLITE_MINE_WORKDIR, default ~/.mclite-referee-mine); golden -> <referee dir>/golden/mine.json.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, REPS } from './minescen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = -58;
const ONLY = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
export const itemArg = (s) => `minecraft:${s.item}${s.ench ? `{Enchantments:[${s.ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}`;
function parseHeld(r) {
  const s = String(r);
  const id = /id: "minecraft:([a-z_]+)"/.exec(s), cnt = /Count: (\d+)b/.exec(s), dmg = /Damage: (\d+)/.exec(s);
  return id ? { id: id[1], n: cnt ? +cnt[1] : 1, dmg: dmg ? +dmg[1] : 0 } : { id: '', n: 0, dmg: 0 };
}
const gt = (r) => { const m = /The time is (\d+)/.exec(String(r)); return m ? +m[1] : null; };
async function main() {
  const workDir = process.env.MCLITE_MINE_WORKDIR || join(homedir(), '.mclite-referee-mine');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25880, rconPort: 26880, xmx: '1024M' });
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
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule doTileDrops true', 'forceload add -16 -16 16 16']) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'br0', confirmTeleports: true });
    await sleep(1500);
    await C('gamemode survival br0');
    await C(`tp br0 0.5 ${F} 0.5 0 90`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, F, 0.5, true); }, 50);
    await sleep(2500);
    for (const s of SCEN.filter((q) => !ONLY || ONLY.test(q.id))) {
      const c = cases[s.id] = { attempts: 0, k: {}, held: {}, gets: {}, loose: 0, broken: 0 };
      for (let r = 0; r < REPS; r++) {
        await C('kill @e[type=!player]');
        await C(`fill -3 ${F - 4} -3 3 ${F + 3} 3 minecraft:air`);
        await C(`fill -2 ${F - 3} -2 2 ${F - 1} 2 minecraft:stone`);
        await C(`setblock 0 ${F - 1} 0 minecraft:${s.block}`);
        await C(`gamemode ${s.mode || 'survival'} br0`);
        await C('effect clear br0');
        if (s.effect) await C(`effect give br0 minecraft:${s.effect[0]} 600 ${s.effect[1]} true`);
        await C(`tp br0 0.5 ${F} 0.5 0 90`);
        await C('clear br0');
        if (s.item !== 'air') await C(`item replace entity br0 weapon.mainhand with ${itemArg(s)} 1`);
        await sleep(300);
        bot.dig(0, 0, F - 1, 0, 1); bot.dig(2, 0, F - 1, 0, 1);
        const g0 = gt(await C('time query gametime'));
        let g1 = null;
        const until = Date.now() + (s.wait || 6) * 1000;
        while (Date.now() < until) {
          const q = gt(await C(`execute if block 0 ${F - 1} 0 minecraft:air run time query gametime`));
          if (q !== null) { g1 = q; break; }
          await sleep(15);
        }
        const kk = g1 === null || g0 === null ? 'never' : String(g1 - g0);
        c.k[kk] = (c.k[kk] || 0) + 1;
        if (g1 !== null) c.broken++;
        await sleep(800);
        const h = parseHeld(await C('data get entity br0 SelectedItem'));
        const hk = `${h.id}x${h.n}${h.dmg ? '@' + h.dmg : ''}`;
        c.held[hk] = (c.held[hk] || 0) + 1;
        for (const g of s.gets || []) {
          const m = /Found (\d+) matching/.exec(await C(`clear br0 minecraft:${g} 0`));
          c.gets[g] = (c.gets[g] || 0) + (m ? +m[1] : 0) - (g === s.item ? 1 : 0);
        }
        const lm = /Test passed, count: (\d+)/.exec(String(await C(`execute if entity @e[type=minecraft:item,x=-3,y=${F - 4},z=-3,dx=6,dy=8,dz=6]`)));
        c.loose += lm ? +lm[1] : 0;
        c.attempts++;
      }
      console.log(`  ${s.id.padEnd(32)} k ${JSON.stringify(c.k)} held ${JSON.stringify(c.held)} gets ${JSON.stringify(c.gets)} loose ${c.loose}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'mine', version: '1.18.2', REPS, F,
    clock: 'growbot at (0.5,F,0.5) pitch 90, target (0,F-1,0) face up, Player Digging START+STOP back to back, k = gametime from START to air; 0.8 s -> main hand, inventory, loose item entities',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  if (ONLY && existsSync(join(dir, 'mine.json'))) {
    const old = JSON.parse(readFileSync(join(dir, 'mine.json'), 'utf8'));
    golden.cases = Object.assign({}, old.cases, cases); golden.seconds += old.seconds || 0;
  }
  writeFileSync(join(dir, 'mine.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runmine: ${golden.seconds} s -> ${join(dir, 'mine.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
