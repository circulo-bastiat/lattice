#!/usr/bin/env node
// runattrs.mjs [--per N] [--only zombie,husk] [--merge] — the referee's SPAWN-ATTRIBUTE runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runattrs.mjs           # 14 mobs x 600 NBT-less /summons on the real 1.18.2 server
//
// What a freshly spawned mob's live attributes are after MobEntity.initialize(SpawnReason.COMMAND):
//   * MobEntity.initialize          "Random spawn bonus" follow_range x(1 + nextGaussian()*0.05) (MULTIPLY_BASE), EVERY mob
//   * ZombieEntity.initAttributes   zombie.spawn_reinforcements base = nextDouble()*0.1 (zombified piglin: 0)
//   * ZombieEntity.applyAttributeModifiers(clamped)
//       "Random spawn bonus"        knockback_resistance + nextDouble()*0.05
//       "Random zombie-spawn bonus" follow_range x(1 + d) when d = nextDouble()*1.5*clamped > 1 (MULTIPLY_TOTAL)
//       "Leader zombie bonus"       nextFloat() < clamped*0.05: reinforcements +[0.5,0.75), max_health x(1+[1,4))
//   * ZombieEntity.initialize       CanBreakDoors = shouldBreakDoors() && nextFloat() < clamped*0.1 (leader: always)
// Read back with `/attribute <mob> <attr> get <scale>` (the EFFECTIVE value: base + every modifier, clamped),
// stored through `execute store result`, plus Health and CanBreakDoors. Same scenario as runequip.mjs
// (hard, day 64, full moon, fresh forceloaded chunk) so the check recomputes the same LocalDifficulty.
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/mob-attributes.json
//   { scenario, mobs: { "<id>": { n, samples: [[follow, kbres, maxHealth, health, reinforcements|null, doors|null,
//                                               speed|null, jump|null]] } } }   (speed/jump: horse family only)
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';
import { DAY_TICKS } from './runequip.mjs';

const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const PER = +(argAfter('--per') || 600);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const MERGE = process.argv.includes('--merge');

export const ZOMBIES = ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin'];
// Non-zombie mobs: only MobEntity's own follow_range roll touches them -- one of each family.
export const OTHERS = ['skeleton', 'creeper', 'spider', 'enderman', 'pillager', 'cow', 'wolf', 'villager', 'iron_golem'];
// Horse family: AbstractHorseEntity.initialize -> initAttributes re-rolls max_health (getChildHealthBonus), and
// for horse/skeleton horse speed/jump (donkey/mule/llama keep their builder's flat speed and jump).
export const HORSES = ['horse', 'donkey', 'mule', 'llama', 'skeleton_horse'];
export const MOBS = ZOMBIES.concat(OTHERS, HORSES);
export const SCALE = 1000000;          // /attribute ... get <scale> -> int; the check divides back
const BATCH = 5;

async function main() {
  const mobs = MOBS.filter((m) => !ONLY.length || ONLY.includes(m));
  console.log(`referee/runattrs: ${mobs.length} mobs x ${PER} command spawns on the real 1.18.2 server (hard, day ${DAY_TICKS / 24000}, full moon)`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteattrs');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mcliteattrs', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee spawn attributes' } }));
  for (const m of mobs) {
    const z = ZOMBIES.includes(m);
    const lines = [];
    for (let k = 0; k < BATCH; k++) lines.push(`summon minecraft:${m} 0 -60 0`);   // NO nbt: initialize runs
    for (let k = 0; k < BATCH; k++) {
      const sel = `@e[type=minecraft:${m},tag=!s,limit=1]`;
      const st = (key, attr) => `execute store result storage mcliteattrs:o c.${key} int 1 run attribute ${sel} ${attr} get ${SCALE}`;
      lines.push('data modify storage mcliteattrs:o c set value {}');
      lines.push(st('F', 'minecraft:generic.follow_range'));
      lines.push(st('K', 'minecraft:generic.knockback_resistance'));
      lines.push(st('M', 'minecraft:generic.max_health'));
      lines.push(`data modify storage mcliteattrs:o c.H set from entity ${sel} Health`);
      if (z) {
        lines.push(st('R', 'minecraft:zombie.spawn_reinforcements'));
        lines.push(`data modify storage mcliteattrs:o c.D set from entity ${sel} CanBreakDoors`);
      }
      if (HORSES.includes(m)) {
        lines.push(st('S', 'minecraft:generic.movement_speed'));
        lines.push(st('J', 'minecraft:horse.jump_strength'));
      }
      lines.push('data modify storage mcliteattrs:o l append from storage mcliteattrs:o c');
      lines.push(`tag ${sel} add s`);
    }
    lines.push('tp @e[type=!minecraft:player] 0 -200 0');     // jockey mounts go too
    writeFileSync(join(dp, 'data', 'mcliteattrs', 'functions', `a_${m}.mcfunction`), lines.join('\n') + '\n');
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
    await rcon.command('gamerule doDaylightCycle false');
    await rcon.command('gamerule doMobLoot false');
    await rcon.command(`time set ${DAY_TICKS}`);
    const r0 = await rcon.command('reload');
    if (/error|fail/i.test(r0)) notes.push('reload: ' + r0.trim().slice(0, 120));
    for (const m of mobs) {
      const z = ZOMBIES.includes(m);
      const rec = { n: 0, samples: [] };
      let dropped = 0;
      while (rec.n < PER && dropped < 20) {
        await rcon.command('data modify storage mcliteattrs:o l set value []');
        const r = await rcon.command(`function mcliteattrs:a_${m}`);
        if (/Unknown|Invalid|Incorrect|error/i.test(r)) { notes.push(`${m}: ${r.trim().slice(0, 140)}`); break; }
        let list;
        try { list = snbtOfReply(await rcon.command('data get storage mcliteattrs:o l')); }
        catch (e) { dropped++; notes.push(`${m}: batch dropped (${e.message.slice(0, 80)})`); continue; }
        if (list.length !== BATCH) { dropped++; notes.push(`${m}: batch read ${list.length}/${BATCH} -- dropped`); continue; }
        for (const c of list) {
          if (c.F === undefined || c.M === undefined) { dropped++; notes.push(`${m}: a sample had no follow_range/max_health`); continue; }
          rec.n++;
          rec.samples.push([c.F / SCALE, (c.K || 0) / SCALE, c.M / SCALE, +c.H,
            z ? (c.R || 0) / SCALE : null, z ? (c.D === 1 ? 1 : 0) : null,
            HORSES.includes(m) ? c.S / SCALE : null, HORSES.includes(m) ? c.J / SCALE : null]);
        }
      }
      out[m] = rec;
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    inhabitedMax = +(/(\d+)/.exec(await rcon.command('time query gametime')) || [0, 0])[1];
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  const file = join(dir, 'mob-attributes.json');
  const prev = MERGE && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (prev) inhabitedMax = Math.max(inhabitedMax, prev.scenario.inhabitedMax);
  const golden = { pack: 'mob-attributes', version: '1.18.2',
    scenario: { difficulty: 'hard', difficultyId: 3, timeOfDay: DAY_TICKS, moonSize: 1.0, inhabitedMax,
      note: 'World.getLocalDifficulty inputs; inhabited time of the forceloaded chunk is at most the world game time' },
    fields: ['follow_range', 'knockback_resistance', 'max_health', 'Health', 'zombie.spawn_reinforcements', 'CanBreakDoors', 'movement_speed', 'horse.jump_strength'],
    per: PER, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    mobs: Object.assign({}, prev ? prev.mobs : {}, out), notes: (prev ? prev.notes : []).concat(notes) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(golden) + '\n');
  console.log(`referee/runattrs: ${Object.keys(out).length} mobs in ${golden.seconds} s -> ${file}`);
  for (const n of notes.slice(0, 30)) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
