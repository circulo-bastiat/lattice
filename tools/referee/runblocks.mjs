#!/usr/bin/env node
// runblocks.mjs [--rolls N] [--only a,b] [--jobs K] — the referee's BLOCK-DROPS runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/runblocks.mjs            # every non-trivial blocks/* table, 200 rolls per case, 3 servers
//
// Asks the REAL 1.18.2 server what breaking a block with a tool drops: `/loot replace block <chest>
// container.0 27 mine <pos> [<tool>]` (LootCommand "mine": Block.getDroppedStacks with ORIGIN, TOOL,
// BLOCK_STATE, BLOCK_ENTITY -- no player, no explosion). The CASES are read from the jar, never typed:
//   tables  every data/minecraft/loot_tables/blocks/*.json. One that can vary with the roll, the tool or the
//           state (apply_bonus, table_bonus, random_chance, match_tool, uniform, binomial,
//           block_state_property, limit_count) gets the full case grid below; a FIXED one gets one
//           batch (40 rolls) with a bare hand and one with a pickaxe.
//   states  the block's default state + every `properties` object its own block_state_property
//           conditions name (wheat age=7, snow layers=1..8, candles=1..4, slab type=double ...)
//   tools   hand; + diamond_pickaxe fortune I / fortune III when the table has a bonus; + shears,
//           plain diamond_pickaxe, diamond_pickaxe silk touch when it has match_tool.
// `mine` does NOT apply the "needs the correct tool" rule (that is PlayerEntity.canHarvest, outside the
// table) -- so both sides compare the TABLE: the engine side is Loot.drops, not Loot.breakDrops.
//
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/block-drops.json
//   { cases: { "<block>|<props>|<tool>": { block, props, tool, rolls, empty, items: {id: {total,sq,hits,max}} } } }
//
// --jobs K runs K servers side by side (own work dir + ports each), one foreground call -- not a
// queued job we poll (D-436).
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir, lockReferee } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { parseRollLog } from './runloot.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const argAfter = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const ROLLS = +(argAfter('--rolls') || 200);
const ONLY = (argAfter('--only') || '').split(',').filter(Boolean);
const JOBS = +(argAfter('--jobs') || 3);
const PART = argAfter('--part');            // "i/n" -- a child of --jobs
const SLICE = argAfter('--slice');          // "s/S": only cases k % S === s, MERGED into an existing golden
                                            // (keeps each foreground call under the 10-minute tool cap)

const VARIES = /apply_bonus|table_bonus|random_chance|match_tool|"uniform"|binomial|block_state_property|limit_count/;
export const TOOLS = {
  hand: null,
  shears: 'minecraft:shears',
  pick: 'minecraft:diamond_pickaxe',
  fortune1: 'minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:fortune",lvl:1s}]}',
  fortune3: 'minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:fortune",lvl:3s}]}',
  silk: 'minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:silk_touch",lvl:1s}]}',
  shovel: 'minecraft:diamond_shovel',
};
/** The engine-side context of each tool name (Loot.drops' ctx). */
export const TOOL_CTX = {
  hand: { item: '' }, shears: { item: 'shears' }, pick: { item: 'diamond_pickaxe' },
  fortune1: { item: 'diamond_pickaxe', fortune: 1 }, fortune3: { item: 'diamond_pickaxe', fortune: 3 },
  silk: { item: 'diamond_pickaxe', silkTouch: 1 }, shovel: { item: 'diamond_shovel' },
};

/** Every block_state_property `properties` object in a table that names this block. */
function stateProps(node, block, out) {
  if (Array.isArray(node)) { for (const x of node) stateProps(x, block, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (node.condition === 'minecraft:block_state_property' && node.properties && (!node.block || node.block === 'minecraft:' + block)) {
    const p = {};
    for (const [k, v] of Object.entries(node.properties)) {
      if (v && typeof v === 'object') { if (v.min !== undefined) p[k] = String(v.min); else if (v.max !== undefined) p[k] = String(v.max); }
      else p[k] = String(v);
    }
    if (Object.keys(p).length) out.push(p);
  }
  for (const v of Object.values(node)) stateProps(v, block, out);
  return out;
}

/** The case list, from the vanilla client jar. */
export function jarBlockCases(jar = join(ROOT, 'jars', '1.18.2', '1.18.2.jar')) {
  if (!existsSync(jar)) throw new Error(`runblocks: no ${jar} (bootstrap the store first)`);
  const tmp = join(refereeWorkDir(), 'blocktables-' + process.pid);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync('unzip', ['-q', '-o', jar, 'data/minecraft/loot_tables/blocks/*', '-d', tmp]);
  const dir = join(tmp, 'data', 'minecraft', 'loot_tables', 'blocks');
  const names = execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  const cases = [];
  for (const block of names) {
    const txt = readFileSync(join(dir, block + '.json'), 'utf8');
    const varies = VARIES.test(txt);
    if (!varies) {   // a fixed table: one batch each with a bare hand and a pickaxe -- every table is covered
      for (const tool of ['hand', 'pick']) cases.push({ block, props: {}, tool, fixed: true, key: `${block}|{}|${tool}` });
      continue;
    }
    const json = JSON.parse(txt);
    const seen = new Set(['{}']);
    const states = [{}];
    for (const p of stateProps(json, block, [])) { const k = JSON.stringify(p); if (!seen.has(k)) { seen.add(k); states.push(p); } }
    const tools = ['hand'];
    if (/apply_bonus|table_bonus/.test(txt)) tools.push('fortune1', 'fortune3');
    if (/match_tool/.test(txt)) tools.push('shears', 'pick', 'silk');
    if (/shovel/.test(txt)) tools.push('shovel');
    for (const props of states) for (const tool of tools) cases.push({ block, props, tool, key: `${block}|${JSON.stringify(props)}|${tool}` });
  }
  rmSync(tmp, { recursive: true, force: true });
  return cases;
}

const BATCH = 40;   // block rolls are small (1-3 stacks); a cut 4096-byte RCON reply drops the batch, never miscounts

async function runPart(cases, idx) {
  const base = refereeWorkDir();
  const workDir = join(base, 'blocks-w' + idx);
  const P = '0 -60 0', T = '8 -60 8';
  mkdirSync(workDir, { recursive: true });
  // The world dir is per work dir; the datapack goes in before the server starts.
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'mcliteref');
  rmSync(dp, { recursive: true, force: true });
  mkdirSync(join(dp, 'data', 'mcliteref', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee block drops' } }));
  const fnames = [];
  cases.forEach((c, i) => {
    const props = Object.entries(c.props).map(([k, v]) => `${k}=${v}`).join(',');
    const lines = [`setblock ${T} minecraft:air`, `setblock ${T} minecraft:${c.block}${props ? '[' + props + ']' : ''}`];
    for (let k = 0; k < BATCH; k++) {
      lines.push(`loot replace block ${P} container.0 27 mine ${T}${TOOLS[c.tool] ? ' ' + TOOLS[c.tool] : ''}`);
      lines.push('data modify storage mcliteref:o l append value {R:1b}');
      lines.push(`data modify storage mcliteref:o l append from block ${P} Items[]`);
    }
    fnames.push('c' + i);
    writeFileSync(join(dp, 'data', 'mcliteref', 'functions', 'c' + i + '.mcfunction'), lines.join('\n') + '\n');
  });
  const server = await startServer({ workDir, port: 25600 + idx * 10, rconPort: 26600 + idx * 10 });
  const result = {}, notes = [];
  let rcon;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    await rcon.command('forceload add 0 0');
    await rcon.command('gamerule doTileDrops false');       // the setblock air swap must not litter item entities
    await rcon.command(`setblock ${P} minecraft:chest`);
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const rec = { block: c.block, props: c.props, tool: c.tool, rolls: 0, empty: 0, items: {} };
      for (let b = 0; b * BATCH < (c.fixed ? BATCH : ROLLS); b++) {
        await rcon.command('data modify storage mcliteref:o l set value []');
        const r = await rcon.command(`function mcliteref:${fnames[i]}`);
        if (/Unknown|Invalid|Incorrect|error|Expected/i.test(r)) { notes.push(`${c.key}: ${r.trim().slice(0, 160)}`); break; }
        const rolls = parseRollLog(await rcon.command('data get storage mcliteref:o l'));
        if (rolls.length !== BATCH) { notes.push(`${c.key}: batch ${b} read ${rolls.length}/${BATCH} rolls (reply cut) -- dropped`); continue; }
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
      result[c.key] = rec;
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  return { result, notes };
}

async function main() {
  let all = jarBlockCases().filter((c) => !ONLY.length || ONLY.includes(c.block));
  if (SLICE) { const [s, S] = SLICE.split('/').map(Number); all = all.filter((_, k) => k % S === s); }
  if (PART) {
    const [i, n] = PART.split('/').map(Number);
    const mine = all.filter((_, k) => k % n === i);
    const out = await runPart(mine, i);
    writeFileSync(join(refereeWorkDir(), `blocks-part${i}.json`), JSON.stringify(out));
    return;
  }
  const t0 = Date.now();
  console.log(`referee/runblocks: ${all.length} cases (${new Set(all.map((c) => c.block)).size} tables) x ${ROLLS} rolls on ${JOBS} real 1.18.2 servers`);
  const extra = [];
  if (ONLY.length) extra.push('--only', ONLY.join(','));
  if (SLICE) extra.push('--slice', SLICE);
  await Promise.all(Array.from({ length: JOBS }, (_, i) => new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--part', `${i}/${JOBS}`, '--rolls', String(ROLLS), ...extra], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`part ${i} exited ${code}`))));
  })));
  const dir = join(refereeWorkDir(), 'golden');
  const out = join(dir, 'block-drops.json');
  const prev = SLICE && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  const keep = prev && prev.rolls === ROLLS;
  const cases = keep ? prev.cases : {}, notes = keep ? prev.notes : [];
  for (let i = 0; i < JOBS; i++) {
    const f = join(refereeWorkDir(), `blocks-part${i}.json`);
    const o = JSON.parse(readFileSync(f, 'utf8'));
    Object.assign(cases, o.result); notes.push(...o.notes);
    rmSync(f);
  }
  const golden = { pack: 'block-drops', version: '1.18.2', context: '/loot ... mine <pos> [tool]: ORIGIN, TOOL, BLOCK_STATE (no player, no explosion)',
    rolls: ROLLS, generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) + (keep ? prev.seconds : 0), cases, notes };
  mkdirSync(dir, { recursive: true });
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/runblocks: ${Object.keys(cases).length} cases in ${golden.seconds} s -> ${out}`);
  for (const n of notes.slice(0, 60)) console.log('  - ' + n);
  if (notes.length > 60) console.log(`  ... and ${notes.length - 60} more notes`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
