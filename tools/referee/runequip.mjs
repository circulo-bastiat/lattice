#!/usr/bin/env node
// runequip.mjs [--per N] [--only zombie,skeleton] — the referee's MOB SPAWN-EQUIPMENT runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runequip.mjs            # every equipment-bearing mob, 600 command spawns each
//   (split a run that would not fit one 10-min call: --only a,b ... then --only c,d --merge)
//
// Asks the REAL 1.18.2 server what a freshly spawned mob is holding and wearing: `/summon <mob> x y z`
// with NO NBT argument, which is the only form that runs MobEntity.initialize(SpawnReason.COMMAND)
// (SummonCommand: initialize = no nbt given) -> initEquipment(LocalDifficulty) + updateEnchantments,
// the left-handed roll, baby/jockey rolls. Read back: HandItems, ArmorItems (ids + enchantments),
// LeftHanded, IsBaby.
//
// The scenario pins LocalDifficulty (World.getLocalDifficulty -> LocalDifficulty.java): difficulty HARD,
// timeOfDay = DAY_TICKS (64 whole days, so moon phase 0 = full moon, size 1.0), a fresh forceloaded chunk
// (inhabited time <= the ticks this run lasts). clamped = (3 * 1.25 - 2) / 2 = 0.875 (+ < 0.001 from
// inhabited time) -- the golden records the inputs; the check recomputes the value from them.
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/mob-equipment.json
//   { scenario: { difficulty, timeOfDay, moonSize, inhabitedMax }, mobs: { "<id>": { n, samples: [[features]] } } }
//   features: main:<item> off:<item> feet:|legs:|chest:|head:<item> · ench:<slot>:<id>:<lvl> · lefthanded · baby
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';

const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const PER = +(argAfter('--per') || 600);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const MERGE = process.argv.includes('--merge');   // add these mobs to an existing golden (split a long run)

// Every mob whose initialize/initEquipment gives it gear in 1.18.2 (MobEntity subclasses overriding
// initEquipment, or reaching MobEntity's own armour roll through initialize).
export const MOBS = ['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton',
  'vindicator', 'pillager', 'zombified_piglin', 'piglin', 'piglin_brute', 'vex', 'evoker', 'illusioner', 'witch'];
export const DAY_TICKS = 64 * 24000;          // 1,536,000: moon phase (64 % 8) = 0 -> full moon
const BATCH = 5;
const SLOTS_ARMOR = ['feet', 'legs', 'chest', 'head'];   // ArmorItems order (EquipmentSlot FEET..HEAD)
const bare = (id) => String(id || '').replace(/^minecraft:/, '');

/** A mob's read-back compound {H, A, L, B} -> sorted feature strings (shared with the check's engine side). */
export function featuresOf(c) {
  const f = [];
  const add = (slot, st) => {
    if (!st || !st.id || bare(st.id) === 'air') return;
    f.push(`${slot}:${bare(st.id)}`);
    for (const e of (st.tag && st.tag.Enchantments) || []) f.push(`ench:${slot}:${bare(e.id)}:${e.lvl}`);
  };
  const H = c.H || [], A = c.A || [];
  add('main', H[0]); add('off', H[1]);
  for (let i = 0; i < 4; i++) add(SLOTS_ARMOR[i], A[i]);
  if (c.L === 1) f.push('lefthanded');
  if (c.B === 1) f.push('baby');
  return f.sort();
}

async function main() {
  const mobs = MOBS.filter((m) => !ONLY.length || ONLY.includes(m));
  console.log(`referee/runequip: ${mobs.length} mobs x ${PER} command spawns on the real 1.18.2 server (hard, day ${DAY_TICKS / 24000}, full moon)`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteequip');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mcliteequip', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee spawn equipment' } }));
  for (const m of mobs) {
    const lines = [];
    for (let k = 0; k < BATCH; k++) lines.push(`summon minecraft:${m} 0 -60 0`);   // NO nbt: initialize runs
    for (let k = 0; k < BATCH; k++) {
      const sel = `@e[type=minecraft:${m},tag=!s,limit=1]`;
      lines.push('data modify storage mcliteequip:o c set value {}');
      lines.push(`data modify storage mcliteequip:o c.H set from entity ${sel} HandItems`);
      lines.push(`data modify storage mcliteequip:o c.A set from entity ${sel} ArmorItems`);
      lines.push(`data modify storage mcliteequip:o c.L set from entity ${sel} LeftHanded`);
      lines.push(`data modify storage mcliteequip:o c.B set from entity ${sel} IsBaby`);
      lines.push('data modify storage mcliteequip:o l append from storage mcliteequip:o c');
      lines.push(`tag ${sel} add s`);
    }
    // Riders/jockey mounts summoned by initialize (chicken jockeys, spider jockeys) go too.
    lines.push('tp @e[type=!minecraft:player] 0 -200 0');
    writeFileSync(join(dp, 'data', 'mcliteequip', 'functions', `e_${m}.mcfunction`), lines.join('\n') + '\n');
  }

  const server = await startServer({});
  const out = {};
  const notes = [];
  let rcon, inhabitedMax = 0;
  const t0 = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    await rcon.command('forceload add 0 0');
    await rcon.command('difficulty hard');
    await rcon.command('gamerule doDaylightCycle false');   // timeOfDay stays DAY_TICKS for the whole run
    await rcon.command('gamerule doMobLoot false');
    await rcon.command(`time set ${DAY_TICKS}`);
    for (const m of mobs) {
      const rec = { n: 0, samples: [] };
      let dropped = 0;
      while (rec.n < PER && dropped < 20) {
        await rcon.command('data modify storage mcliteequip:o l set value []');
        const r = await rcon.command(`function mcliteequip:e_${m}`);
        if (/Unknown|Invalid|Incorrect|error/i.test(r)) { notes.push(`${m}: ${r.trim().slice(0, 140)}`); break; }
        let list;
        try { list = snbtOfReply(await rcon.command('data get storage mcliteequip:o l')); }
        catch (e) { dropped++; notes.push(`${m}: batch dropped (${e.message.slice(0, 80)})`); continue; }
        if (list.length !== BATCH) { dropped++; notes.push(`${m}: batch read ${list.length}/${BATCH} -- dropped`); continue; }
        for (const c of list) { rec.n++; rec.samples.push(featuresOf(c)); }
      }
      out[m] = rec;
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    const g1 = +(/(\d+)/.exec(await rcon.command('time query gametime')) || [0, 0])[1];
    inhabitedMax = g1;   // this world may be older than this run: its whole game time bounds the chunk's inhabited time
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  const file = join(dir, 'mob-equipment.json');
  const prev = MERGE && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (prev) inhabitedMax = Math.max(inhabitedMax, prev.scenario.inhabitedMax);
  const golden = { pack: 'mob-equipment', version: '1.18.2',
    scenario: { difficulty: 'hard', difficultyId: 3, timeOfDay: DAY_TICKS, moonSize: 1.0, inhabitedMax,
      note: 'World.getLocalDifficulty inputs; inhabited time of the forceloaded chunk is at most the world game time' },
    per: PER, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    mobs: Object.assign({}, prev ? prev.mobs : {}, out), notes: (prev ? prev.notes : []).concat(notes) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(golden) + '\n');
  console.log(`referee/runequip: ${Object.keys(out).length} mobs in ${golden.seconds} s -> ${file}`);
  for (const n of notes.slice(0, 30)) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
