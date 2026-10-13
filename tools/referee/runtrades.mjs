#!/usr/bin/env node
// runtrades.mjs [--per N] [--only farmer,mason] [--merge] — the referee's VILLAGER TRADE runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runtrades.mjs                 # 13 professions x levels 1-5, 150 fresh villagers each
//
// Asks the REAL 1.18.2 server which offers a villager of profession P summoned straight at level L rolls.
// VillagerEntity.fillRecipes (VillagerEntity.java) fills ONLY the current level's pool (2 of N,
// MerchantEntity.fillRecipesFromPool), lazily, the first time getOffers() runs — which `/data ... from
// entity` does (writeCustomDataToNbt -> getOffers). So each summoned villager = one independent draw of
// level L's pool, exactly what the engine's Trade.rollLevel(P, L) models.
//
// World: the referee's flat plains world (server.mjs) — so the villager type is plains (fisherman L5's
// boat = oak) and SellMapFactory finds no monument/mansion (locateStructure -> null -> the offer is
// dropped, MerchantEntity.fillRecipesFromPool skips a null create). The check compares the engine under
// the same two facts.
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/villager-trades.json
//   { cells: { "<prof>/<level>": { villagers, offers: [[offer...] per villager] } } }
//   offer = { a:[id,count], b:[id,count]|null, s:[id,count], u:maxUses, x:xp, m:priceMultiplier, t:[features] }
//   features (the sell stack's tag): book:<ench>:<lvl> · ench:<ench>:<lvl> · potion:<id> · color:<rgb> · stew:<effectId>:<dur>
//
// A single foreground run against a server WE started -- not a queued job we poll (D-436).
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { snbtOfReply } from './snbt.mjs';

const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const PER = +(argAfter('--per') || 150);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const MERGE = process.argv.includes('--merge');

// VillagerProfession's 13 working professions (none/nitwit have no trades) -- the registry order.
export const PROFESSIONS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'];
const BATCH = 3;   // villagers per read: one RCON reply is split into 4096-byte packets; keep it small.

const bare = (id) => String(id || '').replace(/^minecraft:/, '');

/** A sell/buy stack's tag -> the comparable feature strings (shared with the check's engine side). */
export function featuresOfTag(tag) {
  const f = [];
  if (!tag) return f;
  for (const e of tag.StoredEnchantments || []) f.push(`book:${bare(e.id)}:${e.lvl}`);
  for (const e of tag.Enchantments || []) f.push(`ench:${bare(e.id)}:${e.lvl}`);
  if (tag.Potion) f.push(`potion:${bare(tag.Potion)}`);
  if (tag.display && tag.display.color !== undefined) f.push(`color:${tag.display.color}`);
  for (const e of tag.Effects || []) f.push(`stew:${e.EffectId}:${e.EffectDuration}`);
  return f.sort();
}

/** One `Offers.Recipes[]` compound from the server -> the golden's compact offer. */
export function compactOffer(r) {
  const st = (x) => (x && x.id && bare(x.id) !== 'air' ? [bare(x.id), x.Count] : null);
  return { a: st(r.buy), b: st(r.buyB), s: st(r.sell), u: r.maxUses, x: r.xp, m: Math.round((r.priceMultiplier || 0) * 1e4) / 1e4,
    t: featuresOfTag(r.sell && r.sell.tag) };
}

async function main() {
  const profs = PROFESSIONS.filter((p) => !ONLY.length || ONLY.includes(p));
  console.log(`referee/runtrades: ${profs.length} professions x 5 levels x ${PER} fresh villagers on the real 1.18.2 server`);
  await lockReferee();
  const dp = join(refereeWorkDir(), 'world', 'datapacks', 'mclitetrade');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mclitetrade', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee villager trades' } }));
  const fn = (p, l) => `v_${p}_${l}`;
  for (const p of profs) for (let l = 1; l <= 5; l++) {
    const lines = [];
    for (let k = 0; k < BATCH; k++) {
      lines.push(`summon minecraft:villager 0 -60 0 {Tags:["v${k}"],NoAI:1b,Silent:1b,Invulnerable:1b,` +
        `VillagerData:{profession:"minecraft:${p}",level:${l},type:"minecraft:plains"}}`);
    }
    for (let k = 0; k < BATCH; k++) {
      lines.push('data modify storage mclitetrade:o l append value {R:1b}');
      // /data from entity -> writeCustomDataToNbt -> getOffers(): the lazy fillRecipes happens HERE.
      lines.push(`data modify storage mclitetrade:o l append from entity @e[tag=v${k},limit=1] Offers.Recipes[]`);
      lines.push(`tag @e[tag=v${k}] remove v${k}`);
    }
    lines.push('tp @e[type=minecraft:villager] 0 -200 0');   // into the void: gone without a death/loot path
    writeFileSync(join(dp, 'data', 'mclitetrade', 'functions', fn(p, l) + '.mcfunction'), lines.join('\n') + '\n');
  }

  const server = await startServer({});
  const cells = {};
  const notes = [];
  let rcon;
  const t0 = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    await rcon.command('forceload add 0 0');
    await rcon.command('gamerule doMobLoot false');
    for (const p of profs) for (let l = 1; l <= 5; l++) {
      const cell = { villagers: 0, offers: [] };
      let dropped = 0;
      while (cell.villagers < PER && dropped < 20) {
        await rcon.command('data modify storage mclitetrade:o l set value []');
        const r = await rcon.command(`function mclitetrade:${fn(p, l)}`);
        if (/Unknown|Invalid|Incorrect|error/i.test(r)) { notes.push(`${p}/${l}: ${r.trim().slice(0, 140)}`); break; }
        const reply = await rcon.command('data get storage mclitetrade:o l');
        let list;
        try { list = snbtOfReply(reply); } catch (e) { dropped++; notes.push(`${p}/${l}: batch dropped (${e.message.slice(0, 80)})`); continue; }
        const per = [];
        for (const c of list) { if (c.R === 1) per.push([]); else if (per.length) per[per.length - 1].push(compactOffer(c)); }
        if (per.length !== BATCH) { dropped++; notes.push(`${p}/${l}: batch read ${per.length}/${BATCH} villagers -- dropped`); continue; }
        for (const v of per) { cell.villagers++; cell.offers.push(v); }
      }
      cells[`${p}/${l}`] = cell;
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'villager-trades.json');
  let prev = null;
  if (MERGE && existsSync(out)) prev = JSON.parse(readFileSync(out, 'utf8'));
  const golden = { pack: 'villager-trades', version: '1.18.2', world: 'flat plains (type plains; no structures for maps)',
    per: PER, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    cells: Object.assign({}, prev ? prev.cells : {}, cells), notes: (prev ? prev.notes : []).concat(notes) };
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runtrades: ${Object.keys(cells).length} cells in ${golden.seconds} s -> ${out}`);
  for (const n of notes.slice(0, 30)) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
