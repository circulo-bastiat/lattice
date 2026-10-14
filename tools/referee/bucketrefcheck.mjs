#!/usr/bin/env node
// bucketrefcheck.mjs — infra I6 (s146, 25 Sept 2026): a player's BUCKET right-click at a block vs the real 1.18.2 server (golden:
// runbucket.mjs, bucket.json; scenarios: bucketscen.mjs). Engine side, the join a real right-click takes: the player (14_player.js)
// at (0.5, F, 0.5) looking straight down (engine pitch -PI/2 = vanilla pitch 90), `P.retarget()` (its own crosshair ray,
// 14c_raycast.js), then `Use.rightClick(P)` (14l_use.js) with exactly n of the item in hotbar slot 0 — never Use.itemUseOn on a
// hand-picked cell, which would skip the question of WHICH cell a bucket aims at (the crosshair ray skips fluids; vanilla's
// BucketItem.use re-casts SOURCE_ONLY for an empty bucket). Judged exactly, per click: the main-hand stack after (id x count), each
// `gets` item in the whole inventory, each block predicate, each counted entity type.
// `--pack useon` (useonscen.mjs, golden useon.json) and `--pack blockuse` (blockusescen.mjs, blockuse.json) judge tool/block-item right-clicks on a block through the SAME join.
// Anti-vacuity (D-30/D-305), per pack (AV below): a golden main hand swapped, the engine's Use.rightClick no-op'd for one scene,
// a golden count/predicate zeroed.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { parseState } from './bucketscen.mjs';
const PACK = process.argv.includes('--pack') ? process.argv[process.argv.indexOf('--pack') + 1] : 'bucket';
if (!/^(bucket|useon|blockuse|itemuse)$/.test(PACK)) { console.error('bucketrefcheck: --pack bucket|useon|blockuse|itemuse'); process.exit(2); }
const { SCEN } = await import(`./${PACK}scen.mjs`);
const ME = PACK === 'bucket' ? 'bucketrefcheck' : PACK + 'refcheck';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', PACK + '.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', PACK + '.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log(`${ME}: golden not generated -- run node tools/referee/runbucket.mjs --pack ${PACK} (skipped)`); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js',
  '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js', '14_player.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: true, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; } };   // World.setBlock answers true (P.placeBlock's second cell reads it)
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
const REAL_DIFF = M.Diff;   // 07l_spawn.js's own Diff (its closure keeps it; the stub below only replaces NS.Diff)
M.Diff = { get: () => 'normal' };
M.Use.init(w);
if (PACK === 'itemuse') M.BlockEntities.init();   // spawner readout below needs Reg + BE
const { EntityList: EL, Items: IT, States: S, Behave: B, Gamemode: GM } = M;
const P = M.Player;
P.init();
const F = 64;
const nameOf = (st) => (st && st.i !== undefined && (st.n | 0) > 0 ? IT.nameOf(st.i) || '' : '');
function stateFrom(str) {
  const { name, props } = parseState(str);
  let st = S.stateOf(name);
  if (!st && name !== 'air') throw new Error('no engine block ' + name);
  for (const [k, v] of Object.entries(props)) { const n = B.setProp(st, k, v); if (n === undefined || n === null || n < 0) throw new Error(`no engine prop ${k}=${v} on ${name}`); st = n; }
  return st;
}
function matches(st, str) {
  const { name, props } = parseState(str);
  if (name === 'air') return !(st > 0);
  if (!(st > 0) || S.name(st) !== name) return false;
  for (const [k, v] of Object.entries(props)) if (String(B.propName(st, k)) !== v) return false;
  return true;
}
function engineRun(s, hook) {
  const out = { attempts: 0, held: {}, gets: {}, test: {}, count: {}, spawner: {} };
  for (let r = 0; r < golden.REPS; r++) {
    cells.clear(); EL.list.length = 0;
    const stone = S.stateOf('stone');
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = F - 3; y <= F - 1; y++) w.set(x, y, z, stone);
    try { for (const [dy, st] of Object.entries(s.set || {})) w.set(0, F + +dy, 0, stateFrom(st)); } catch (e) { return { err: e.message }; }
    if (GM && GM.set) GM.set(P, s.mode === 'creative' ? GM.CREATIVE : GM.SURVIVAL);
    P.x = P.px = 0.5; P.y = P.py = F; P.z = P.pz = 0.5; P.ex = 0.5; P.ey = F; P.ez = 0.5;
    // runbucket's `tp br0 .. 0 90`: vanilla yaw 0 faces SOUTH, which is the engine's yaw PI (engine 0 = -Z north)
    P.yaw = Math.PI; P.pitch = -Math.PI / 2; P.crouching = false; P.targetEntity = null;
    P.inventory.slots.fill(null);
    if (s.item !== 'air') {
      const it = IT.of(s.item);
      if (!(it >= 0)) return { err: `no engine item ${s.item}` };
      P.inventory.slots[0] = { i: it, n: s.n };
    }
    P.slot = 0; if (P.inventory.selected !== undefined) P.inventory.selected = 0;
    if (P.syncHotbar) P.syncHotbar();
    P.retarget();
    if (hook) hook(P); else M.Use.rightClick(P);
    // itemuse: runbucket's server is on PEACEFUL and reads 0.4 s (8 ticks) after the click — a spawn-egg zombie is discarded by
    // MobEntity.checkDespawn's peaceful branch on its first tick. The engine owns that rule too (Spawn.despawnTick, 07l_spawn.js),
    // so the harness runs ONE despawn pass on the same difficulty rather than judging a rule the harness skipped (s147 merge fix).
    if (PACK === 'itemuse' && REAL_DIFF && REAL_DIFF.set && M.Spawn && M.Spawn.despawnTick) { REAL_DIFF.set('peaceful'); M.Spawn.despawnTick(); REAL_DIFF.set('normal'); }
    out.attempts++;
    const h = P.inventory.slots[0];
    const hn = nameOf(h);
    const k = `${hn}x${hn ? h.n : 0}${hn && h.d ? '@' + h.d : ''}`;
    out.held[k] = (out.held[k] || 0) + 1;
    for (const g of s.gets || []) { out.gets[g] = out.gets[g] || 0; for (const st of P.inventory.slots) if (nameOf(st) === g) out.gets[g] += st.n; }
    for (const t of s.test || []) { const [dy, st] = t.split(':'); out.test[t] = (out.test[t] || 0) + (matches(w.get(0, F + +dy, 0), st) ? 1 : 0); }
    for (const e of s.count || []) out.count[e] = (out.count[e] || 0) + EL.list.filter((q) => q.type === e && !q.removed).length;
    // itemuse pack only -- mirrors runbucket.mjs's own `data get block ... SpawnData.id` readout,
    // engine-side: SpawnEggItem's spawner branch (14l_use.js:622-634) leaves its result on the
    // block entity (`Spawner.assign` -> `BE.get(x,y,z).entity`), not on a vanilla block-state prop.
    if (s.spawner) { const be = M.BlockEntities && M.BlockEntities.get(0, F - 1, 0); out.spawner[(be && be.entity) || ''] = (out.spawner[(be && be.entity) || ''] || 0) + 1; }
  }
  return out;
}
// itemuse pack only -- `prob: true` scenes roll real randomness on BOTH sides (BoneMealItem's
// `canGrow`/CropBlock's `getGrowthAmount`/SaplingBlock's 45% roll), so an exact fraction match
// (every other pack's `compare()` below) is never expected even from a correct engine -- a
// two-sided binomial 4-sigma tolerance, floored so a near-zero-variance sample still allows a
// little slack, same spirit as growthrefcheck.mjs's `tolMean`/`tolFrac` but sized for this pack's
// REPS (20), not that pack's much larger sample.
// ⚠ TWO-SAMPLE (cloud zealous-dirac): both fractions are samples, so the variance is the POOLED p's over both n — a
// one-sided variance taken from the golden alone called a correct engine red whenever the server's own 20 rolls
// happened to miss a bucket entirely (bonemeal_creative_wheat0: server age=5 0/20 where 5/20 is expected, a ~0.3% draw).
function tolFrac(gp, ep, n) { const p = (gp + ep) / 2, v = Math.max(p * (1 - p), 0.02); return 4 * Math.sqrt(2 * v / n) + 1 / n; }
const reds = [];
let pass = 0;
const fmt = (m, n) => Object.entries(m).map(([k, v]) => `${k === 'x0' ? 'empty' : k} ${(100 * v / n).toFixed(0)}%`).join(', ') || '-';
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [], what = `${s.mode === 'creative' ? 'CREATIVE ' : ''}right-click ${s.n} ${s.item} straight down at ${Object.values(s.set || {}).join('/') || 'stone'}`;
  const keys = new Set([...Object.keys(g.held), ...Object.keys(e.held)]);
  for (const k of keys) if ((g.held[k] || 0) / g.attempts !== (e.held[k] || 0) / e.attempts) {
    out.push(`${s.id}: ${what}: main hand after — server ${fmt(g.held, g.attempts)} · engine ${fmt(e.held, e.attempts)}`); break;
  }
  for (const k of s.gets || []) if ((g.gets[k] || 0) / g.attempts !== (e.gets[k] || 0) / e.attempts)
    out.push(`${s.id}: ${what}: ${k} in the inventory per click — server ${((g.gets[k] || 0) / g.attempts).toFixed(2)} · engine ${((e.gets[k] || 0) / e.attempts).toFixed(2)}`);
  for (const k of s.test || []) {
    const gp = (g.test[k] || 0) / g.attempts, ep = (e.test[k] || 0) / e.attempts;
    const bad = s.prob ? Math.abs(gp - ep) > tolFrac(gp, ep, g.attempts) : gp !== ep;
    if (bad) out.push(`${s.id}: ${what}: block ${k} after — server ${(g.test[k] || 0)}/${g.attempts} · engine ${(e.test[k] || 0)}/${e.attempts}`);
  }
  for (const k of s.count || []) if ((g.count[k] || 0) / g.attempts !== (e.count[k] || 0) / e.attempts)
    out.push(`${s.id}: ${what}: ${k} entities per click — server ${((g.count[k] || 0) / g.attempts).toFixed(2)} · engine ${((e.count[k] || 0) / e.attempts).toFixed(2)}`);
  if (s.spawner) {
    const keys = new Set([...Object.keys(g.spawner || {}), ...Object.keys(e.spawner || {})]);
    for (const k of keys) if (((g.spawner || {})[k] || 0) / g.attempts !== ((e.spawner || {})[k] || 0) / e.attempts) {
      out.push(`${s.id}: ${what}: spawner assigned id — server ${fmt(g.spawner || {}, g.attempts)} · engine ${fmt(e.spawner || {}, e.attempts)}`); break;
    }
  }
  return out;
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`${ME} — ${{ bucket: 'bucket right-clicks at a block', useon: 'tool/block-item right-clicks on a block', blockuse: 'right-clicks on a block that answers them', itemuse: 'spawn-egg/bone-meal right-clicks on a block' }[PACK]} vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g || !g.attempts) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engineRun(s);
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(32)} server ${fmt(g.held, g.attempts)} | engine ${e.err || fmt(e.held, e.attempts)}`);
}
// §2 (blockuse only) — the container blocks. Vanilla ChestBlock/BarrelBlock/EnderChestBlock.onUse open their screen on a plain
// right-click (not a server-observable NBT change, so not in the golden): the engine's own join must reach `Hud.openChest` once
// per click. The Hud is a counting stub here (no DOM); a crafting table (already open-able) is the control row.
if (PACK === 'blockuse') {
  const realHud = M.Hud;
  let opened = 0;
  M.Hud = Object.assign({}, realHud || {}, { openChest: () => { opened++; return true; }, openCraftingTable: () => { opened++; return true; } });
  for (const name of ['chest', 'trapped_chest', 'barrel', 'ender_chest', 'crafting_table']) {
    const s = { id: 'open_' + name, item: 'air', n: 0, set: { '-1': name } };
    opened = 0;
    const e = engineRun(Object.assign({}, s), null);
    if (e.err) { reds.push(`${s.id}: ${e.err}`); continue; }
    if (opened !== e.attempts) reds.push(`${s.id}: right-click a ${name} with an empty hand opens its screen in vanilla (${name === 'crafting_table' ? 'CraftingTableBlock' : 'ChestBlock/BarrelBlock/EnderChestBlock'}.onUse) — engine opened it ${opened}/${e.attempts} times`);
    else pass++;
  }
  M.Hud = realHud;
}
const AV = PACK === 'bucket'
  ? { hand: 'water_source_bucket', handTo: 'bucketx1', noop: 'water_bucket_on_stone', zero: ['cod_bucket_on_stone', 'count', 'cod'] }
  : PACK === 'useon' ? { hand: 'hoe_dirt', handTo: 'iron_hoex1', noop: 'axe_oak_log', zero: ['torch_on_stone', 'test', '0:torch'] }
  : PACK === 'itemuse' ? { hand: 'egg_pig_on_stone', handTo: 'diamondx64', noop: 'egg_cow_on_stone', zero: ['bonemeal_wheat_mature', 'test', '-1:wheat[age=7]'] }
  : { hand: 'cauldron_water_bucket', handTo: 'water_bucketx1', noop: 'oak_trapdoor', zero: ['lever_floor', 'test', '-1:lever[powered=true]'] };
{ const s = SCEN.find((q) => q.id === AV.hand); const g0 = golden.cases[s.id];
  brk(`golden ${AV.hand} main hand swapped to ${AV.handTo}`, compare(s, Object.assign({}, g0, { held: { [AV.handTo]: g0.attempts } }), g0).length > 0); }
{ const s = SCEN.find((q) => q.id === AV.noop);
  brk(`engine Use.rightClick no-op (${AV.noop})`, compare(s, golden.cases[s.id], engineRun(s, () => {})).length > 0); }
{ const [id, f, k] = AV.zero; const s = SCEN.find((q) => q.id === id); const g0 = golden.cases[s.id];
  brk(`golden ${id} ${k} zeroed`, compare(s, Object.assign({}, g0, { [f]: Object.assign({}, g0[f], { [k]: 0 }) }), g0).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`${ME}: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
