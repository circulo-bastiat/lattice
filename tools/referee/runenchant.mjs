#!/usr/bin/env node
// runenchant.mjs [--per N] [--only <case>,…] [--merge] — the referee's ENCHANTING runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runenchant.mjs          # 38 cases x 1000 rolls on the real 1.18.2 server (~3 min)
//
// EnchantmentHelper.enchant(random, stack, level, treasure=false) is the ONE algorithm behind the enchanting
// table's result, a librarian/armorer/toolsmith/weaponsmith/fisherman "enchanted tool" trade
// (SellEnchantedToolFactory: level 5 + nextInt(15)) and a mob's spawn gear (MobEntity.enchantEquipment /
// enchantMainHandItem: level 5 + (int)(clamped * nextInt(18))). The real server runs it through the loot
// function `enchant_with_levels` (EnchantWithLevelsLootFunction -> EnchantmentHelper.enchant), which a
// datapack loot table can call on any item with any level (a UniformLootNumberProvider's nextInt is
// MathHelper.nextInt(min, max) — the same 5 + nextInt(15) distribution the trade draws).
//
// Cases:
//   trade:<item>        levels uniform 5..19 (the villager trade's own draw) — the engine side is
//                       Trade.resolveOffers on a sell_enchanted_tool_for_emeralds row
//   mob:<item>:<level>  a fixed level (5, 13, 22 span a spawned mob's 5..22) — the engine side is
//                       Equip.rollEnchants, the mob-gear roll
// Rolls land in a chest (27 per `data get`), read back as the stack's Enchantments.
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/enchanting.json
//   { cases: { "<case>": { item, levels: [min,max], n, samples: [["<id>:<lvl>", …]] } } }
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';

const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const PER = +(argAfter('--per') || 1000);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const MERGE = process.argv.includes('--merge');

export const TRADE_ITEMS = ['fishing_rod', 'bow', 'crossbow', 'iron_sword', 'diamond_sword', 'iron_axe', 'diamond_axe',
  'iron_shovel', 'iron_pickaxe', 'diamond_pickaxe', 'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'];
export const MOB_ITEMS = ['leather_boots', 'golden_helmet', 'chainmail_chestplate', 'iron_leggings', 'diamond_boots',
  'iron_axe', 'bow', 'crossbow'];
export const MOB_LEVELS = [5, 13, 22];
export const CASES = [
  ...TRADE_ITEMS.map((item) => ({ key: `trade:${item}`, item, levels: [5, 19] })),
  ...MOB_ITEMS.flatMap((item) => MOB_LEVELS.map((l) => ({ key: `mob:${item}:${l}`, item, levels: [l, l] }))),
];
const SLOTS = 27;
const bare = (id) => String(id || '').replace(/^minecraft:/, '');
const fileOf = (key) => key.replace(/:/g, '_');

async function main() {
  const cases = CASES.filter((c) => !ONLY.length || ONLY.includes(c.key));
  console.log(`referee/runenchant: ${cases.length} cases x ${PER} rolls of EnchantmentHelper.enchant on the real 1.18.2 server`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mcliteench');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mcliteench', 'functions'), { recursive: true });
  mkdirSync(join(dp, 'data', 'mcliteench', 'loot_tables'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee enchanting' } }));
  for (const c of cases) {
    const levels = c.levels[0] === c.levels[1] ? c.levels[0] : { type: 'minecraft:uniform', min: c.levels[0], max: c.levels[1] };
    writeFileSync(join(dp, 'data', 'mcliteench', 'loot_tables', `${fileOf(c.key)}.json`), JSON.stringify({
      type: 'minecraft:generic',
      pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: `minecraft:${c.item}`,
        functions: [{ function: 'minecraft:enchant_with_levels', levels, treasure: false }] }] }] }));
    const lines = [];
    for (let k = 0; k < SLOTS; k++) lines.push(`loot insert 0 -60 0 loot mcliteench:${fileOf(c.key)}`);
    writeFileSync(join(dp, 'data', 'mcliteench', 'functions', `${fileOf(c.key)}.mcfunction`), lines.join('\n') + '\n');
  }

  const server = await startServer({});
  const out = {};
  const notes = [];
  let rcon;
  const t0 = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    await rcon.command('forceload add 0 0');
    await rcon.command('setblock 0 -60 0 minecraft:chest replace');
    for (const c of cases) {
      const rec = { item: c.item, levels: c.levels, n: 0, samples: [] };
      let dropped = 0;
      while (rec.n < PER && dropped < 20) {
        await rcon.command('data modify block 0 -60 0 Items set value []');
        const r = await rcon.command(`function mcliteench:${fileOf(c.key)}`);
        if (/Unknown|Invalid|Incorrect|error/i.test(r)) { notes.push(`${c.key}: ${r.trim().slice(0, 140)}`); break; }
        let items;
        try { items = snbtOfReply(await rcon.command('data get block 0 -60 0 Items')); }
        catch (e) { dropped++; notes.push(`${c.key}: read dropped (${e.message.slice(0, 80)})`); continue; }
        if (!Array.isArray(items) || items.length !== SLOTS) { dropped++; notes.push(`${c.key}: read ${items && items.length}/${SLOTS} -- dropped`); continue; }
        for (const st of items) {
          if (bare(st.id) !== c.item) { notes.push(`${c.key}: got ${st.id}`); continue; }
          rec.n++;
          rec.samples.push(((st.tag && st.tag.Enchantments) || []).map((e) => `${bare(e.id)}:${e.lvl}`).sort());
        }
      }
      out[c.key] = rec;
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  const file = join(dir, 'enchanting.json');
  const prev = MERGE && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const golden = { pack: 'enchanting', version: '1.18.2',
    note: 'EnchantmentHelper.enchant via loot function enchant_with_levels, treasure false',
    per: PER, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    cases: Object.assign({}, prev ? prev.cases : {}, out), notes: (prev ? prev.notes : []).concat(notes) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(golden) + '\n');
  console.log(`referee/runenchant: ${Object.keys(out).length} cases in ${golden.seconds} s -> ${file}`);
  for (const n of notes.slice(0, 30)) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
