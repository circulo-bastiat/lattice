#!/usr/bin/env node
// run.mjs <pack.json> — the referee's scenario runner (unit I4).
//
//   node tools/referee/run.mjs tools/referee/packs/mob-defaults.json
//
// For each mob in the pack: forceload one chunk, summon it tagged on a flat platform,
// `/attribute ... base get` each requested attribute, `/data get entity ... <path>` each
// requested NBT field, parse the replies, then kill it. Writes the golden JSON — GENERATED,
// never committed (D-6) — into the referee work dir (MCLITE_REFEREE_DIR or
// ~/.mclite-referee/1.18.2), as golden/<pack name>.json.
//
// This is a single foreground run against a server WE started and are watching for our own
// replies — not a queued job we poll (D-436).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';

const packPath = process.argv[2];
if (!packPath) { console.error('usage: node tools/referee/run.mjs <pack.json>'); process.exit(2); }
const pack = JSON.parse(readFileSync(packPath, 'utf8'));

const TAG = 'mcliteref';
const X = 0, Y = -60, Z = 0; // one block above the flat world's grass top (bedrock@-64,dirt,dirt,grass)

function parseAttributeBase(reply) {
  // Actual 1.18.2 wording: "Base value of attribute Max Health for entity Zombie is 20.0"
  // (verified against the real server -- not the generic "single_zombie has base value" wording
  // some other MC versions use). Match the trailing number regardless of exact phrasing.
  const m = reply.match(/is\s+(-?\d+(?:\.\d+)?)\s*$/);
  return m ? parseFloat(m[1]) : null;
}

function parseDataGet(reply) {
  // "single_zombie has the following entity data: 20.0f"  /  "...: 1b"  /  "...: 0"
  const m = reply.match(/entity data:\s*(.+)$/s);
  if (!m) return { raw: reply.trim(), value: null };
  let v = m[1].trim();
  let value;
  if (/^-?\d+b$/.test(v)) value = parseInt(v, 10) !== 0 && v !== '0b'; // byte -> boolean-ish, kept numeric too
  const numMatch = v.match(/^(-?\d+(?:\.\d+)?)[bslfd]?$/i);
  if (numMatch) value = parseFloat(numMatch[1]);
  else if (/^true|false$/i.test(v)) value = /true/i.test(v);
  return { raw: v, value: value === undefined ? v : value };
}

async function main() {
  console.log(`referee/run: starting 1.18.2 server for pack "${pack.name}" (${pack.mobs.length} mobs)`);
  const server = await startServer({});
  const results = {};
  const notes = [];
  let rcon;
  try {
    // The dedicated server's RCON listener can come up a beat after the "Done" line (it starts
    // in ServerConnectionListener's own init, not gated on world load) -- a short bounded retry
    // on a connection we are actively establishing right now, not a queued-job poll (D-436).
    // Inside the SAME try/finally as everything else, so a server we started never leaks a
    // process if this retry itself is what fails.
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) {
        if (attempt >= 15) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await rcon.command(`forceload add ${X} ${Z}`);
    // I5 (gate, 24 Sept): freeze the clock at midnight. The first golden read zombie/skeleton
    // Health 19 (max 20) -- a freshly summoned undead in daylight under open sky starts burning
    // (MobEntity.tickMovement -> isAffectedByDaylight) before the next RCON read. Night + no
    // daylight cycle keeps every sample at its spawn state; nothing else in a pack reads the time.
    await rcon.command('gamerule doDaylightCycle false');
    await rcon.command('time set 18000');
    await rcon.command('weather clear 1000000');
    for (const mob of pack.mobs) {
      await rcon.command(`kill @e[tag=${TAG}]`);
      const summonReply = await rcon.command(`summon minecraft:${mob.id} ${X} ${Y} ${Z} {Tags:["${TAG}"]}`);
      if (/Unknown or incomplete command|Unable to summon entity|No entity/i.test(summonReply)) {
        notes.push(`${mob.id}: could not summon (${summonReply.trim().slice(0, 120)})`);
        continue;
      }
      const sel = `@e[tag=${TAG},limit=1,sort=nearest]`;
      const attrs = {};
      for (const attr of mob.attrs) {
        const reply = await rcon.command(`attribute ${sel} ${attr} base get`);
        attrs[attr] = parseAttributeBase(reply);
        if (attrs[attr] === null) notes.push(`${mob.id}.${attr}: unparsed reply "${reply.trim().slice(0, 120)}"`);
      }
      const nbt = {};
      for (const field of mob.nbt) {
        const reply = await rcon.command(`data get entity ${sel} ${field}`);
        nbt[field] = parseDataGet(reply);
      }
      // Health, separately: current health should equal max_health for a freshly-summoned mob.
      const healthReply = await rcon.command(`data get entity ${sel} Health`);
      results[mob.id] = { attrs, nbt, health: parseDataGet(healthReply) };
      await rcon.command(`kill @e[tag=${TAG}]`);
      // infra I6 (25 Sept): the SAME reads on a NO-NBT summon beside it -- the only /summon form that runs
      // MobEntity.initialize (SummonCommand.execute: initialize only when the NBT argument is absent), i.e. what a natural or
      // spawn-egg spawn looks like. e.g. WitherSkeletonEntity.initialize sets attack_damage base 4 (the NBT summon reads 2).
      // mobdefaultscheck prefers this `init` sample; no tag is possible without NBT, so the selector is type + position.
      const iz = Z + 4, isel = `@e[type=minecraft:${mob.id},x=${X},y=${Y},z=${iz},distance=..3,limit=1,sort=nearest]`;
      const ir = await rcon.command(`summon minecraft:${mob.id} ${X} ${Y} ${iz}`);
      if (/Summoned/.test(ir)) {
        const ia = {}, inb = {};
        for (const attr of mob.attrs) ia[attr] = parseAttributeBase(await rcon.command(`attribute ${isel} ${attr} base get`));
        for (const field of mob.nbt) inb[field] = parseDataGet(await rcon.command(`data get entity ${isel} ${field}`));
        results[mob.id].init = { attrs: ia, nbt: inb, health: parseDataGet(await rcon.command(`data get entity ${isel} Health`)) };
      } else notes.push(`${mob.id}: no-NBT summon failed (${ir.trim().slice(0, 100)})`);
      await rcon.command(`kill @e[type=!player,x=${X},y=${Y},z=${iz},distance=..12]`);
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }

  const golden = {
    pack: pack.name,
    version: pack.version,
    generatedAt: new Date().toISOString(),
    mobs: results,
    notes,
  };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${pack.name}.json`);
  writeFileSync(out, JSON.stringify(golden, null, 2) + '\n');
  console.log(`referee/run: wrote golden for ${Object.keys(results).length}/${pack.mobs.length} mobs -> ${out}`);
  if (notes.length) { console.log('referee/run: notes:'); for (const n of notes) console.log('  - ' + n); }
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
