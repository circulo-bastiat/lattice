#!/usr/bin/env node
// reinfrefcheck.mjs — infra I6 (s152, 25 Sept 2026): ZOMBIE REINFORCEMENTS vs the real 1.18.2 server (golden: runreinf.mjs,
// zombie-reinf.json; scenes: reinfscen.mjs). The engine: the same roofed 85x85 grass arena in a cell map (light: sky 0 under
// the roof, 15 in the open noon scene), the REAL player (survival) landing ONE bare-hand Combat.attack on a NoAI caller
// (health 100, reinforceBase = the scene's base, no leader roll) 2 blocks +z, REPS seeded runs per scene.
// Compared per scene: (1) CALL RATE — engine calls / reps inside the server's binomial band (a 0% or 100% server scene must
// be matched exactly); (2) the CALLEE TYPE — every reinforcement a plain zombie (vanilla `new ZombieEntity(world)`, even
// for a husk); (3) the caller's spawn_reinforcements after a call = base - 0.05 (the caller charge), untouched without one;
// (4) the callee spawns >= 7 blocks from the caller horizontally (nextInt(7,40) per axis). Mismatches are FINDINGS (red,
// exit 1). No golden -> SKIP. Anti-vacuity (D-30/D-305): forged golden rates / callee type / caller charge flip the verdict.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { HALF, DZ, SWEEP_DX, SCENES } from './reinfscen.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLD = [join(refDir, 'golden', 'zombie-reinf.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'zombie-reinf.json')].find((f) => existsSync(f));
if (!GOLD) { console.log('reinfrefcheck: SKIP (golden not generated -- run node tools/referee/runreinf.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLD, 'utf8'));
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x7e1f0c5;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
// the weapon attribute table (the sweep scene's diamond sword) — the pmeleerefcheck recipe (D-335)
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('reinfrefcheck: empty item attribute table'); process.exit(1); }
}
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
let open = false;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.tickingAt = () => true; w.loadedAt = () => true;
w.getLight = (x, y, z) => ((open || y >= 2 ? 15 : 0) << 4);             // packed (sky << 4) | block; no block light anywhere
w.canSeeSky = (x, y, z) => open || y >= 2;
w.biomeAt = () => M.Biomes.index('plains');
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Combat.init) M.Combat.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
M.Spawn.init(); M.Spawn.ready = true;
let noSpawn = false;
M.Commands = Object.assign(M.Commands || {}, { ruleGet: (k) => (k === 'doMobSpawning' ? String(!noSpawn) : (M.Commands && M.Commands._rg ? M.Commands._rg(k) : undefined)) });
if (M.Sky) { M.Sky.isThundering = () => false; }
M.EntityList.random = rng; Math.random = rng;
const { EntityList: EL, States: S, Undead: U } = M;
const P = M.Player;

function arena() {
  cells.clear();
  const grass = S.stateOf('grass_block'), dirt = S.stateOf('dirt'), stone = S.stateOf('stone');
  for (let x = -HALF - 1; x <= HALF + 1; x++) for (let z = -HALF - 1; z <= HALF + 1; z++) {
    w.set(x, -1, z, grass); w.set(x, -2, z, dirt); w.set(x, -3, z, S.stateOf('bedrock'));
    if (!open) w.set(x, 2, z, stone);
  }
}
function engineRun(sc, rep) {
  seed = (0x2e1f0000 + rep * 7919 + sc.id.length * 131) >>> 0;
  open = !!sc.open; noSpawn = !!sc.noSpawn;
  if (M.Sky) M.Sky.darknessNow = () => (open ? 0 : 11);
  arena();
  EL.list.length = 0;
  M.Diff.set(sc.diff);
  P.x = 0.5; P.y = 0; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.health = 20; P.yaw = 0; P.pitch = 0;
  P.inventory.slots[P.inventory.selected] = sc.sweep ? { i: M.Items.of('diamond_sword'), n: 1 } : null;
  P.onGround = true; P.fallDistance = 0; P.sprinting = false;
  const pig = sc.sweep ? EL.spawn('pig', 0.5, 0, 0.5 + DZ) : null;
  if (pig) { pig.persistent = true; pig.noAI = true; pig.maxHealth = 100; pig.health = 100; }
  const e = EL.spawn(sc.mob, 0.5 + (sc.sweep ? SWEEP_DX : 0), 0, 0.5 + DZ);
  if (!e) return { err: `EL.spawn(${sc.mob}) gives nothing` };
  e.persistent = true; e.noAI = true; e.maxHealth = 100; e.health = 100; e.target = null;
  e.reinforceBase = sc.base; e.reinforceMods = 0;
  for (const sl of [M.Items.FEET, M.Items.LEGS, M.Items.CHEST, M.Items.HEAD, M.Items.MAINHAND]) M.Equip.setEquipped(e, sl, null);   // the server's NBT summon skips initialize: no gear
  for (const q of EL.list) if (q !== e && q !== pig) q.removed = true;
  const before = new Set(EL.list);
  if (M.Hand) M.Hand.attackStrengthTicker = 1000;
  M.Combat.attack(P, pig || e);
  if (sc.sweep && e.health >= 100) return { err: 'the sweep never reached the caller (harness)' };
  const news = EL.list.filter((q) => !before.has(q) && !q.removed && q.maxHealth !== undefined);
  const callee = news[0] || null;
  return { called: news.length > 0, n: news.length, types: news.map((q) => q.type), dist: callee ? Math.max(Math.abs(callee.x - Math.floor(e.x)), Math.abs(callee.z - Math.floor(e.z))) : null,
    caller: U.spawnReinforcementsOf(e), hit: 100 - e.health };
}
const close = (a, b) => Math.abs(a - b) < 1e-3;
function serverSummary(g) {
  const n = g.reps.length, k = g.reps.filter((q) => q.zombies + q.husks > 0).length;
  const types = [...new Set(g.reps.flatMap((q) => [q.zombies ? 'zombie' : null, q.husks ? 'husk' : null]).filter(Boolean))];
  const called = g.reps.filter((q) => q.zombies + q.husks > 0).map((q) => q.caller), idle = g.reps.filter((q) => q.zombies + q.husks === 0).map((q) => q.caller);
  return { n, k, rate: n ? k / n : null, types, chargeCalled: called.length ? called[0] : null, chargeIdle: idle.length ? idle[0] : null, base: g.base };
}
function compare(sc, s, runs) {
  const out = [];
  const n = runs.length, k = runs.filter((r) => r.called).length;
  if (s.rate === 0 || s.rate === 1) { if (k / n !== s.rate) out.push(`${sc.id}: server calls a reinforcement on ${s.k}/${s.n} hits, engine ${k}/${n}`); }
  else {   // two-sample: 3 pooled standard errors (a 24-hit server sample of a 0.5 chance swings 7..17)
    const pp = (s.k + k) / (s.n + n), sd = 3 * Math.sqrt(pp * (1 - pp) * (1 / s.n + 1 / n));
    if (Math.abs(k / n - s.rate) > sd) out.push(`${sc.id}: server call rate ${s.k}/${s.n}, engine ${k}/${n}`);
  }
  const et = [...new Set(runs.flatMap((r) => r.types))];
  if (s.types.length && et.length && et.join() !== s.types.join()) out.push(`${sc.id}: reinforcement type ${s.types.join('/')} on the server, engine ${et.join('/')}`);
  if (runs.some((r) => r.n > 1)) out.push(`${sc.id}: engine spawned ${Math.max(...runs.map((r) => r.n))} mobs from one hit (vanilla: at most 1)`);
  const ec = runs.find((r) => r.called), ei = runs.find((r) => !r.called);
  if (ec && s.chargeCalled !== null && !close(ec.caller, s.chargeCalled)) out.push(`${sc.id}: caller spawn_reinforcements after a call ${s.chargeCalled} on the server, engine ${ec.caller}`);
  if (ei && s.chargeIdle !== null && !close(ei.caller, s.chargeIdle)) out.push(`${sc.id}: caller spawn_reinforcements with no call ${s.chargeIdle} on the server, engine ${ei.caller}`);
  const dmin = Math.min(...runs.filter((r) => r.dist !== null).map((r) => r.dist));   // measured from the caller's BLOCK corner (vanilla offsets floor(pos))
  if (isFinite(dmin) && dmin < 7 - 1e-6) out.push(`${sc.id}: engine reinforcement ${dmin.toFixed(2)} blocks from the caller (vanilla >= 7)`);
  return out;
}

const reds = []; let pass = 0; const SV = {}, EN = {};
console.log(`reinfrefcheck — zombie reinforcements vs the real 1.18.2 server (${golden.generatedAt})`);
for (const sc of SCENES) {
  const g = golden.cases[sc.id];
  if (!g || !g.reps.length) { reds.push(`${sc.id}: no golden case (rerun runreinf.mjs)`); continue; }
  SV[sc.id] = serverSummary(g);
  const runs = Array.from({ length: Math.max(sc.reps, 16) }, (_, r) => engineRun(sc, r));
  if (runs.some((r) => r.err)) { reds.push(`${sc.id}: ${runs.find((r) => r.err).err}`); continue; }
  EN[sc.id] = runs;
  const bad = compare(sc, SV[sc.id], runs);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${sc.id.padEnd(22)} server ${JSON.stringify(SV[sc.id])}\n  ${''.padEnd(22)} engine ${runs.filter((r) => r.called).length}/${runs.length} ${JSON.stringify([...new Set(runs.flatMap((r) => r.types))])} caller ${[...new Set(runs.map((r) => Math.round(r.caller * 1e4) / 1e4))].join('/')} dist ${runs.filter((r) => r.dist !== null).map((r) => r.dist.toFixed(1)).join(',')} hit ${[...new Set(runs.map((r) => r.hit))].join('/')}`);
}
for (const r of reds) console.log('  ✗ ' + r);
let breaks = 0, caught = 0;
const brk = (name, id, forge) => {
  const sc = SCENES.find((s) => s.id === id); if (!SV[id] || !EN[id]) return;
  breaks++;
  const base = compare(sc, SV[id], EN[id]).join(), f = compare(sc, Object.assign({}, SV[id], forge(SV[id])), EN[id]).join();
  if (f !== base) { caught++; console.log(`  ✓ anti-vacuity: ${name} caught`); } else reds.push(`anti-vacuity: break "${name}" was NOT caught`);
};
brk('golden hard b1 never calls', 'zombie_hard_b1', () => ({ k: 0, rate: 0 }));
brk('golden normal b1 always calls', 'zombie_normal_b1', (s) => ({ k: s.n, rate: 1 }));
brk('golden husk calls a husk', 'husk_hard_b1', () => ({ types: ['husk'] }));
brk('golden caller charge -0.10', 'zombie_hard_b1', (s) => ({ chargeCalled: (s.chargeCalled || 1) - 0.05 }));
console.log(`reinfrefcheck: ${pass}/${SCENES.length} scenes match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
