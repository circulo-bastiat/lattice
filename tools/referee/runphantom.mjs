#!/usr/bin/env node
// runphantom.mjs — infra W (25 Sept 2026): golden for phantomrefcheck.mjs — the PHANTOM swoop/circle
// AI vs. the real 1.18.2 server (scenarios: phantomscen.mjs). ONE growbot standing on a small floor
// well above sea level (phantomscen.mjs's own header explains FLOOR_Y); one hand-`/summon`ed phantom
// (NBT form, Tags:["ph"], persistent) that finds the bot as its only possible target (FindTargetGoal
// sorts real players by y and takes the first `validTarget`, .decomp PhantomEntity.java:157-183 —
// this bot is the only player in the world). BARE logs it alone; WITH_CAT repeats the same rep with
// a frozen (`NoAI:1b`) cat parked `CAT_DX` blocks away, inside the swoop-abort goal's own 16-block
// check (phantomscen.mjs header cites the exact decomp lines).
//
// Every tick a datapack function appends: the phantom's Pos, the bot's own Pos (it can be nudged by
// a hit's knockback), and the bot's live health (a `health`-criterion scoreboard objective — no
// combat log needed, the criterion tracks it automatically; `execute store result storage ... append`
// samples it into the same per-tick array, tick-exact, same "no RCON-loop timing" method the FIRE and
// KB packs already use, docs/archive/REFEREE.md "Harness facts"). The bot's own max health is raised
// (`/attribute ... base set 200` -- `/data merge entity <player>` is REFUSED by the server, "Unable to
// modify player data", found empirically) and topped back up every rep with `/effect give
// instant_health 1 10 true` (amplifier 255, tried first, OVERFLOWS the server's own `4 << amplifier`
// heal math and heals nothing -- also found empirically; 10 safely clears 200) so a dive's damage
// shows up as a real health DROP instead of the bot dying and the log going ambiguous.
//   node tools/referee/runphantom.mjs        (~REPS x 2 scenes x 25 s)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { SCEN, T, REPS, R, FLOOR_Y, CAT_DX } from './phantomscen.mjs';
import { parsePosList } from './runchase.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseInts = (reply) => { const m = /\[(.*)\]\s*$/.exec(reply.trim()); return m ? m[1].split(',').map((q) => parseInt(q, 10)).filter((v) => !Number.isNaN(v)) : []; };

async function main() {
  const workDir = process.env.MCLITE_PHANTOM_WORKDIR || join(homedir(), '.mclite-referee-phantom');
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mclitephantom');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mclitephantom', 'functions');
  mkdirSync(fdir, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee phantom' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['mclitephantom:tick'] }));
  writeFileSync(join(fdir, 'arena.mcfunction'), [
    `fill ${-R} ${FLOOR_Y - 1} ${-R} ${R} ${FLOOR_Y + 45} ${R} minecraft:air`,
    `fill ${-R} ${FLOOR_Y - 1} ${-R} ${R} ${FLOOR_Y - 1} ${R} minecraft:stone`].join('\n') + '\n');
  writeFileSync(join(fdir, 'log.mcfunction'), [
    'data modify storage mclite:phantom p append from entity @e[type=phantom,tag=ph,limit=1] Pos',
    'data modify storage mclite:phantom b append from entity @a[limit=1] Pos',
    // `execute store ... storage` has no "append" modifier (that keyword only exists on `data modify`
    // itself) -- a store clause with one there fails to PARSE, which drops the WHOLE function silently
    // (`function ...` then answers "Unknown function", not a runtime error; found empirically, this
    // pack's own harness fact). Store the read into a scratch path first, then append THAT.
    'execute store result storage mclite:phantom hpcur int 1 run scoreboard players get ph0 hp',
    'data modify storage mclite:phantom h append from storage mclite:phantom hpcur'].join('\n') + '\n');
  writeFileSync(join(fdir, 'tick.mcfunction'), ['execute if score #run mc matches 1 if score #t mc matches ..' + (T - 1) + ' run function mclitephantom:log',
    'execute if score #run mc matches 1 run scoreboard players add #t mc 1'].join('\n') + '\n');
  const server = await startServer({ workDir, port: 25699, rconPort: 26699, xmx: '1536M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  for (const s of SCEN) cases[s.id] = { cat: s.cat, plogs: [], blogs: [], hlogs: [] };
  let rcon, bot;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doDaylightCycle false', 'time set 18000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule randomTickSpeed 0', 'gamerule naturalRegeneration false',
      'scoreboard objectives add mc dummy', 'scoreboard objectives add hp health', 'scoreboard players set #run mc 0',
      `forceload add ${-R - 16} ${-R - 16} ${R + 16} ${R + 16}`]) await C(c);
    const a = await C('function mclitephantom:arena');
    if (/Unknown function/i.test(a)) throw new Error('datapack not loaded: ' + a);
    bot = await connectFakePlayer({ port: server.port, name: 'ph0' });
    await C('gamemode survival ph0');
    await C('attribute ph0 minecraft:generic.max_health base set 200');
    await sleep(800);
    for (const s of SCEN) {
      for (let rep = 0; rep < REPS; rep++) {
        await C('scoreboard players set #run mc 0');
        await C('kill @e[type=!player]');
        await C(`tp ph0 0.5 ${FLOOR_Y} 0.5 -90 0`);
        await C('effect give ph0 minecraft:instant_health 1 10 true');   // top back up to the 200 max (amplifier 255 OVERFLOWS the server's own 4<<amplifier math and heals nothing -- found empirically)
        await C('data modify storage mclite:phantom p set value []');
        await C('data modify storage mclite:phantom b set value []');
        await C('data modify storage mclite:phantom h set value []');
        await sleep(300);
        if (s.cat) await C(`summon minecraft:cat ${0.5 + CAT_DX} ${FLOOR_Y} 0.5 {PersistenceRequired:1b,Tags:["cat"],NoAI:1b}`);
        await C(`summon minecraft:phantom 0.5 ${FLOOR_Y + 5} 0.5 {PersistenceRequired:1b,Tags:["ph"]}`);
        await C('scoreboard players set #t mc 0');
        await C('scoreboard players set #run mc 1');
        await sleep(T * 50 + 800);
        let tNow = 0;
        for (let i = 0; i < 40; i++) {                       // bounded: our own server catching up (D-436 allows this)
          tNow = +(/has (-?\d+)/.exec(await C('scoreboard players get #t mc')) || [0, 0])[1];
          if (tNow >= T) break; await sleep(500);
        }
        await C('scoreboard players set #run mc 0');
        const P = parsePosList(await C('data get storage mclite:phantom p'));
        const B = parsePosList(await C('data get storage mclite:phantom b'));
        const H = parseInts(await C('data get storage mclite:phantom h'));
        if (P.length < T) notes.push(`${s.id} rep ${rep}: only ${P.length}/${T} phantom samples (removed/despawned?)`);
        const round = (v) => Math.round(v * 1e4) / 1e4;
        const pl = P.map(([x, y, z]) => [round(x), round(y - FLOOR_Y), round(z)]);
        const bl = B.map(([x, y, z]) => [round(x), round(y - FLOOR_Y), round(z)]);
        cases[s.id].plogs.push(pl); cases[s.id].blogs.push(bl); cases[s.id].hlogs.push(H);
      }
      const h0 = cases[s.id].hlogs.map((h) => h[0]).join('/'), hn = cases[s.id].hlogs.map((h) => h[h.length - 1]).join('/');
      console.log(`  ${s.id.padEnd(10)} reps ${cases[s.id].plogs.length}  hp start ${h0} -> end ${hn}`);
    }
  } finally {
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'phantom', version: '1.18.2', T, REPS, R, FLOOR_Y, CAT_DX,
    clock: 'growbot on a floor at FLOOR_Y; a phantom /summon-ed 5 above it (NBT form); WITH_CAT also parks a frozen ' +
      '(NoAI:1b) cat CAT_DX blocks away first; a datapack tick function appends the phantom\'s Pos, the bot\'s own Pos, ' +
      'and the bot\'s health (a health-criterion scoreboard read) every tick from the same RCON burst that summons the ' +
      'phantom -- entry 0 = the first logged tick, positions relative to the floor corner (bot at 0.5,FLOOR_Y,0.5)',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'phantom.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runphantom: ${golden.seconds} s -> ${join(dir, 'phantom.json')}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
