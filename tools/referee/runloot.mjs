#!/usr/bin/env node
// runloot.mjs [--rolls N] [--only a,b] — the referee's LOOT runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runloot.mjs              # every entities/* table in the 1.18.2 jar, 300 rolls each
//
// Asks the REAL 1.18.2 server what each mob loot table drops: for every `data/minecraft/loot_tables/
// entities/**.json` in the client jar (the list is read from the jar, never typed), `/loot replace
// block <chest> container.0 27 loot minecraft:entities/<t>` N times from a generated datapack function,
// each roll's Items appended to a storage list that RCON reads once per 100 rolls. The context `/loot ... loot <table>` gives a table is
// ORIGIN only (LootCommand.executeLoot): no killer, no looting, not on fire, not killed by a player
// -- mobrefloot check rolls the engine with the SAME empty context, so the two are comparable.
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/mob-loot.json
//   { tables: { "<t>": { rolls, empty, items: { "<id>": { total, sq, hits, max } } } } }
//
// A single foreground run against a server WE started -- not a queued job we poll (D-436).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const ROLLS = +(argAfter('--rolls') || 300);
const FIRE_ONLY = process.argv.includes('--fire-only');   // keep the existing golden's tables, add only fireTables
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);

/** Every entity loot table in the vanilla client jar, e.g. "sheep/white", "zombie". */
export function jarEntityTables(jar = join(ROOT, 'jars', '1.18.2', '1.18.2.jar')) {
  if (!existsSync(jar)) throw new Error(`runloot: no ${jar} (bootstrap the store first)`);
  let list;
  try { list = execFileSync('unzip', ['-Z1', jar], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch { list = execFileSync('jar', ['tf', jar], { encoding: 'utf8', maxBuffer: 64 << 20 }); }
  return list.split('\n').map((l) => l.trim())
    .map((l) => /^data\/minecraft\/loot_tables\/(entities|gameplay)\/(.+)\.json$/.exec(l)).filter(Boolean)
    .map((m) => (m[1] === 'entities' ? m[2] : 'gameplay/' + m[2])).sort();
}

/** Entity tables whose JSON carries a furnace_smelt function (the on_fire cooked drops). */
export function jarSmeltTables(tables, jar = join(ROOT, 'jars', '1.18.2', '1.18.2.jar')) {
  return tables.filter((t) => {
    if (t.startsWith('gameplay/')) return false;
    try { return /furnace_smelt/.test(execFileSync('unzip', ['-p', jar, `data/minecraft/loot_tables/entities/${t}.json`], { encoding: 'utf8' })); }
    catch { return false; }
  });
}

/** Parse `/data get block ... Items` -> [{id, count}]. Tags (potions, enchants) are ignored here. */
export function parseItems(reply) {
  const out = [];
  const re = /id:\s*"minecraft:([a-z0-9_]+)"/g; let m;
  // Each compound is {Slot: 0b, id: "minecraft:x", Count: 2b, ...}; key order is not guaranteed, so
  // split on compounds first.
  const body = (reply.match(/entity data:|block data:/) ? reply.slice(reply.indexOf(':', reply.search(/data:/)) + 1) : reply);
  for (const comp of body.split(/\},\s*\{/)) {
    re.lastIndex = 0; m = re.exec(comp);
    if (!m) continue;
    const c = /Count:\s*(\d+)b/.exec(comp);
    out.push({ id: m[1], count: c ? +c[1] : 1 });
  }
  return out;
}

/** Split `data get storage` output of the roll log into rolls: {R:1b} marks the start of each roll. */
export function parseRollLog(reply) {
  const body = reply.slice(reply.indexOf('[') >= 0 ? reply.indexOf('[') : 0);
  const rolls = [];
  for (const comp of body.split(/\},\s*\{/)) {
    if (/\bR:\s*1b/.test(comp)) { rolls.push([]); continue; }
    const m = /id:\s*"minecraft:([a-z0-9_]+)"/.exec(comp);
    if (!m || !rolls.length) continue;
    const c = /Count:\s*(\d+)b/.exec(comp);
    rolls[rolls.length - 1].push({ id: m[1], count: c ? +c[1] : 1 });
  }
  return rolls;
}

const BATCH = 25;    // rolls per function call; one RCON read per batch (each RCON command costs ~1 tick).
                     // A vanilla RCON reply is ONE 4096-byte packet -- 100 sheep rolls overflowed it.

async function main() {
  const tables = jarEntityTables().filter((t) => !ONLY.length || ONLY.includes(t));
  console.log(`referee/runloot: ${tables.length} entity loot tables x ${ROLLS} rolls on the real 1.18.2 server`);
  // A datapack, written before the server starts: one function per table that rolls BATCH times into
  // one chest and appends a marker + that chest's Items to a storage list after each roll (commands
  // in a function run in order, so the one chest is reused). RCON then reads the list ONCE per batch.
  const P = '0 -60 0';
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mcliteref', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee loot rolls' } }));
  const fn = (t) => 'loot_' + t.replace(/[^a-z0-9_]/g, '_');
  for (const t of tables) {
    const lines = [];
    for (let k = 0; k < BATCH; k++) {
      lines.push(`loot replace block ${P} container.0 27 loot minecraft:${t.startsWith('gameplay/') ? t : 'entities/' + t}`);
      lines.push('data modify storage mcliteref:o l append value {R:1b}');
      lines.push(`data modify storage mcliteref:o l append from block ${P} Items[]`);
    }
    writeFileSync(join(dp, 'data', 'mcliteref', 'functions', fn(t) + '.mcfunction'), lines.join('\n') + '\n');
  }
  // FIRE pass (#7860): `/loot ... loot` has no this_entity, so a burning mob is summoned (Fire:200s) and its
  // table rolled with `/loot ... kill <it>` (this_entity = the mob, is_on_fire true), then removed.
  const smelt = jarSmeltTables(tables), ffn = (t) => 'fire_' + fn(t);
  for (const t of smelt) {
    const lines = [];
    for (let k = 0; k < BATCH; k++) {
      lines.push(`summon minecraft:${t.split('/')[0]} 0 -59 0 {Tags:["mcf"],Fire:200s,NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
      lines.push(`loot replace block ${P} container.0 27 kill @e[tag=mcf,limit=1]`);
      lines.push('kill @e[tag=mcf]');
      lines.push('kill @e[type=minecraft:item]');
      lines.push('data modify storage mcliteref:o l append value {R:1b}');
      lines.push(`data modify storage mcliteref:o l append from block ${P} Items[]`);
    }
    writeFileSync(join(dp, 'data', 'mcliteref', 'functions', ffn(t) + '.mcfunction'), lines.join('\n') + '\n');
  }
  const server = await startServer({});
  const fireResult = {};
  const result = {};
  const notes = [];
  let rcon;
  const t0 = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    await rcon.command('forceload add 0 0');
    await rcon.command(`setblock ${P} minecraft:chest`);
    for (const t of [...(FIRE_ONLY ? [] : tables), ...smelt.map((x) => 'FIRE:' + x)]) {
      const isFire = t.startsWith('FIRE:'), tn = isFire ? t.slice(5) : t;
      const rec = { rolls: 0, empty: 0, items: {} };
      for (let b = 0; b * BATCH < ROLLS; b++) {
        await rcon.command('data modify storage mcliteref:o l set value []');
        const r = await rcon.command(`function mcliteref:${isFire ? ffn(tn) : fn(tn)}`);
        if (/Unknown|Invalid|Incorrect|error/i.test(r)) { notes.push(`${t}: ${r.trim().slice(0, 140)}`); break; }
        const rolls = parseRollLog(await rcon.command('data get storage mcliteref:o l'));
        // A cut reply (4096-byte RCON packet) would count its last roll short: the whole batch is DROPPED.
        if (rolls.length !== BATCH) { notes.push(`${t}: batch ${b} read ${rolls.length}/${BATCH} rolls (reply cut) -- batch dropped`); continue; }
        for (const items of rolls) {
          rec.rolls++;
          if (!items.length) rec.empty++;
          const per = {};
          for (const it of items) per[it.id] = (per[it.id] || 0) + it.count;
          for (const [id, n] of Object.entries(per)) {
            const s = rec.items[id] || (rec.items[id] = { total: 0, sq: 0, hits: 0, max: 0 });
            s.total += n; s.sq += n * n; s.hits++; s.max = Math.max(s.max, n);
          }
        }
      }
      (isFire ? fireResult : result)[tn] = rec;
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  let prev = null;
  if (FIRE_ONLY) { try { prev = JSON.parse(readFileSync(join(refereeWorkDir(), 'golden', 'mob-loot.json'), 'utf8')); } catch {} }
  const golden = prev ? { ...prev, fireRolls: ROLLS, fireTables: fireResult, fireNotes: notes } : { pack: 'mob-loot', version: '1.18.2', context: 'ORIGIN only (no killer, no looting, not on fire)',
    rolls: ROLLS, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), tables: result, fireTables: fireResult, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'mob-loot.json');
  writeFileSync(out, JSON.stringify(golden, null, 1) + '\n');
  console.log(`referee/runloot: ${Object.keys(golden.tables).length} tables + ${Object.keys(golden.fireTables).length} fireTables in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
