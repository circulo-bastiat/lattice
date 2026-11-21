#!/usr/bin/env node
// runplayerarmor.mjs — the referee's PLAYER ARMOR runner (infra I6, s142). Scenarios: armorscen.mjs's skeleton scenes,
// worn by a real survival PLAYER (a growbot, growbot.mjs) instead of a mob: `/item replace entity <bot> armor.*`, Resistance by
// `/effect give`, health topped up with instant_health, then ONE owner-less arrow (same position/velocity/damage NBT as the
// mob pack) and the bot's Health read back. Difficulty normal (an owner-less arrow is not difficulty-scaled either way:
// its attacker is null), naturalRegeneration false (a joined player's saturation would heal 1 every 10 ticks).
// Own port 25645 + work dir (MCLITE_PARMOR_WORKDIR, default ~/.mclite-referee-parmor); golden -> <referee dir>/golden/player-armor.json.
//   node tools/referee/runplayerarmor.mjs     (~16 scenes x REPS x 3 s)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN as ALL, REPS, HIT_Y, START_DZ } from './armorscen.mjs';

export const PSCEN = ALL.filter((s) => s.mob === 'skeleton');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOOR = -60;
const SLOT = ['armor.feet', 'armor.legs', 'armor.chest', 'armor.head'];
const itemArg = (a) => `minecraft:${a.item}${a.ench ? `{Enchantments:[${a.ench.map(([id, l]) => `{id:"minecraft:${id}",lvl:${l}s}`).join(',')}]}` : ''}`;
async function main() {
  const workDir = process.env.MCLITE_PARMOR_WORKDIR || join(homedir(), '.mclite-referee-parmor');
  const server = await startServer({ workDir, port: 25645, rconPort: 26645, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of PSCEN) cases[s.id] = { before: [], after: [] };
  let rcon, bot;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule naturalRegeneration false', 'forceload add -16 -16 16 16',
      `fill -3 ${FLOOR - 1} -5 3 ${FLOOR + 4} 5 minecraft:air`, `fill -3 ${FLOOR - 1} -5 3 ${FLOOR - 1} 5 minecraft:stone`]) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'pa0' });
    await sleep(4000);                                      // past any join grace
    await C('gamemode survival pa0');
    const health = async () => { const m = /data:\s*([-0-9.Ee]+)f/.exec(await C('data get entity pa0 Health')); return m ? parseFloat(m[1]) : NaN; };
    for (const s of PSCEN) {
      for (let rep = 0; rep < REPS; rep++) {
        await C('kill @e[type=arrow]');
        await C(`tp pa0 0.5 ${FLOOR} 0.5 180 0`);
        for (let i = 0; i < 4; i++) await C(`item replace entity pa0 ${SLOT[i]} with minecraft:air`);
        for (const a of s.armor) await C(`item replace entity pa0 ${SLOT[a.slot]} with ${itemArg(a)}`);
        await C('effect clear pa0');
        if (s.resist !== undefined) await C(`effect give pa0 minecraft:resistance 1000 ${s.resist} true`);
        await C('effect give pa0 minecraft:instant_health 1 5 true');
        await sleep(1300);                                  // > 20 ticks: the previous hit's invulnerability is over
        const b = await health();
        await C(`summon minecraft:arrow 0.5 ${FLOOR + HIT_Y} ${0.5 + START_DZ} {Motion:[0.0d,0.0d,${s.v}d],damage:${s.d}d,pickup:0b}`);
        await sleep(1000);
        const a = await health();
        cases[s.id].before.push(b); cases[s.id].after.push(a);
      }
    }
  } finally {
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  for (const s of PSCEN) { const c = cases[s.id]; console.log(`  ${s.id.padEnd(28)} health before ${c.before.join('/')} after ${c.after.join('/')}`); }
  const golden = { pack: 'player-armor', version: '1.18.2', REPS, clock: 'growbot survival, armour by /item replace, full health -> one arrow -> 1 s -> Health',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'player-armor.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runplayerarmor: ${golden.seconds} s -> ${join(dir, 'player-armor.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
