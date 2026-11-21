#!/usr/bin/env node
// runfire.mjs [--rolls N] — the referee's ON-FIRE LOOT runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runfire.mjs        # every entity table with an is_on_fire row, burning and not, 400 rolls
//
// `/loot ... kill <entity>` (LootCommand.executeKill) rolls the mob's OWN getLootTable() with THIS_ENTITY =
// the mob, DAMAGE_SOURCE, ORIGIN -- and no killer when the source is RCON. So unlike runloot's `loot <table>`
// (ORIGIN only) the entity_properties{this} rows are live: the cooked-when-burning rule (furnace_smelt under
// flags.is_on_fire) for every table that has one (read from the jar). Each mob is summoned once per state with
// NoAI + Invulnerable (+ Fire:32000s when burning) and never actually dies; `kill` only rolls its table.
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/mob-fire-loot.json
//   { cases: { "<mob>|fire" | "<mob>|cold": { mob, table, fire, rolls, empty, items } } }
// A single foreground run against a server WE started -- not a queued job we poll (D-436).
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { parseRollLog } from './runloot.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const ROLLS = +(argAfter('--rolls') || 400);
const BATCH = 25;
/** The table vanilla's getLootTable() picks for our summon: a sheep with Color:0b is sheep/white. */
export const FIRE_TABLE = (mob) => (mob === 'sheep' ? 'sheep/white' : mob);

export function jarFireMobs(jar = join(ROOT, 'jars', '1.18.2', '1.18.2.jar')) {
  const list = execFileSync('unzip', ['-Z1', jar], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')
    .map((l) => /^data\/minecraft\/loot_tables\/entities\/([a-z_]+)\.json$/.exec(l.trim())).filter(Boolean).map((m) => m[1]);
  return list.filter((m) => /is_on_fire/.test(execFileSync('unzip', ['-p', jar, `data/minecraft/loot_tables/entities/${m}.json`], { encoding: 'utf8' }))).sort();
}

async function main() {
  const mobs = jarFireMobs();
  console.log(`referee/runfire: ${mobs.length} mobs with an is_on_fire row x burning/not x ${ROLLS} rolls`);
  const P = '0 -60 0';
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mcliteref', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee fire loot' } }));
  const lines = [];
  for (let k = 0; k < BATCH; k++) {
    lines.push(`loot replace block ${P} container.0 27 kill @e[tag=mclref,limit=1]`);
    lines.push('data modify storage mcliteref:o l append value {R:1b}');
    lines.push(`data modify storage mcliteref:o l append from block ${P} Items[]`);
  }
  writeFileSync(join(dp, 'data', 'mcliteref', 'functions', 'kill.mcfunction'), lines.join('\n') + '\n');
  const server = await startServer({});
  const cases = {}, notes = [];
  let rcon;
  const t0 = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    await rcon.command('forceload add 0 0');
    await rcon.command('gamerule doMobLoot false');
    await rcon.command(`setblock ${P} minecraft:chest`);
    for (const mob of mobs) for (const fire of [false, true]) {
      await rcon.command('kill @e[tag=mclref]');
      const nbt = `{NoAI:1b,Invulnerable:1b,Silent:1b,PersistenceRequired:1b,Tags:["mclref"]${mob === 'sheep' ? ',Color:0b' : ''}${fire ? ',Fire:32000s' : ''}}`;
      const s = await rcon.command(`summon minecraft:${mob} 8 -60 8 ${nbt}`);
      if (!/Summoned/.test(s)) { notes.push(`${mob}: ${s.trim().slice(0, 140)}`); continue; }
      const rec = { mob, table: FIRE_TABLE(mob), fire, rolls: 0, empty: 0, items: {} };
      for (let b = 0; b * BATCH < ROLLS; b++) {
        await rcon.command('data modify storage mcliteref:o l set value []');
        const r = await rcon.command('function mcliteref:kill');
        if (/Unknown|Invalid|Incorrect|error|No entity/i.test(r)) { notes.push(`${mob}: ${r.trim().slice(0, 140)}`); break; }
        const rolls = parseRollLog(await rcon.command('data get storage mcliteref:o l'));
        if (rolls.length !== BATCH) { notes.push(`${mob}|${fire}: batch ${b} read ${rolls.length}/${BATCH} (reply cut) -- dropped`); continue; }
        for (const items of rolls) {
          rec.rolls++;
          if (!items.length) rec.empty++;
          const per = {};
          for (const it of items) per[it.id] = (per[it.id] || 0) + it.count;
          for (const [id, n] of Object.entries(per)) {
            const x = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0, max: 0 });
            x.total += n; x.sq += n * n; x.hits++; x.max = Math.max(x.max, n);
          }
        }
      }
      if (fire) {  // still burning after the rolls? (a burning check that reads a cold mob proves nothing)
        const f = await rcon.command('data get entity @e[tag=mclref,limit=1] Fire');
        const m = /(-?\d+)s/.exec(f);
        if (!m || +m[1] <= 0) notes.push(`${mob}: Fire read ${f.trim().slice(0, 80)} after rolling -- NOT burning`);
      }
      cases[`${mob}|${fire ? 'fire' : 'cold'}`] = rec;
    }
    await rcon.command('kill @e[tag=mclref]');
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'mob-fire-loot', version: '1.18.2', context: '/loot ... kill <mob>: THIS_ENTITY, DAMAGE_SOURCE, ORIGIN, no killer',
    rolls: ROLLS, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'mob-fire-loot.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runfire: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
