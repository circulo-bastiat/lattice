#!/usr/bin/env node
// mobhazardrefcheck.mjs -- #6091: Entity.baseTick fire, LivingEntity.baseTick drowning and the void vs the real 1.18.2
// server (golden: runmobhazard.mjs, mobhazard.json; scenarios: mobhazardscen.mjs). Per scenario the engine logs Health,
// remainingFireTicks and air for every EL.tick and they must equal the server's Health / Fire / Air series tick by tick
// (the log phase can differ by one tick, so a series passes when it equals the server's at shift 0 or +-1).
// Anti-vacuity: fire damage 2, air 299, void threshold off by one each must fail.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, T } from './mobhazardscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mobhazard.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mobhazard.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('mobhazardrefcheck: golden not generated -- run node tools/referee/runmobhazard.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0d40b1e6;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the hazardrefcheck loader, same BASE_MODS + every 07*.js mob module).
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
// Squid/Fish gate their own per-tick air-drowning behind a `.ready` flag `07i_entitylist.js`'s
// tick loop checks (`Sq.ready`/`Fish.ready`, set only by `Sq.init`/`Fish.init` -- `src/17_main.js`'s
// own real boot sequence calls both; the hazardrefcheck loader this file was modelled on never
// spawns a squid or a fish, so it never needed them). Axolotl and turtle set `.ready` true at
// module load unconditionally and need no such call.
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES } = M;

const PAD = 0;
const stateOf = (spec) => S.stateOf(spec);
function engineSeries(s) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 4; y++) if (x || z) w.set(x, y, z, glass);
  if (s.floor) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, S.stateOf('stone'));
  for (const [k, y] of [['floor', PAD], ['at', PAD + 1], ['head', PAD + 2], ['lid', PAD + 3]]) if (s[k]) w.set(0, y, 0, stateOf(s[k]));
  const e = EL.spawn(s.mob, 0.5, s.ty !== undefined ? s.ty : s.y !== undefined ? s.y : PAD + 1, 0.5);
  if (!e) return { err: 'EL.spawn gives nothing' };
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (s.y !== undefined) e.noGravity = true;
  for (const sl of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(e, sl, null);
  if (s.fire) M.Combat.igniteForSeconds(e, s.fire);
  const hp = [e.health], fire = [Math.max(0, e.remainingFireTicks || 0)], air = [e.air === undefined ? 300 : e.air];
  for (let t = 0; t < s.t; t++) {
    EL.tick();
    if (e.removed || e.dead || !(e.health > 0)) break;
    hp.push(e.health); fire.push(Math.max(0, e.remainingFireTicks || 0)); air.push(e.air === undefined ? 300 : e.air);
  }
  return { hp, fire, air };
}
// engine series a equals server series g at a shift of -1/0/+1 ticks over the overlap (server fire <0 is "not burning")
const same = (g, a) => [0, 1, -1].some((sh) => {
  let n = 0;
  for (let i = 0; i < g.length; i++) { const j = i + sh; if (j < 0 || j >= a.length) continue; n++; if (g[i] !== a[j]) return false; }
  return n > 0 && Math.abs(g.length - a.length) <= 3;
});
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [];
  const gh = g.series[0], gf = (g.fireSeries[0] || []).map((v) => Math.max(0, v)), ga = g.airSeries[0];
  if (!same(gh, e.hp)) out.push(`${s.id}: health server ${gh.slice(0, 40)}.. engine ${e.hp.slice(0, 40)}..`);
  if (gf.length && !same(gf, e.fire)) out.push(`${s.id}: fireTicks server ${gf.slice(0, 30)}.. engine ${e.fire.slice(0, 30)}..`);
  if (!same(ga, e.air)) out.push(`${s.id}: air server ${ga.slice(0, 30)}.. engine ${e.air.slice(0, 30)}..`);
  return out;
}
const reds = [];
let pass = 0, caught = 0, breaks = 0;
const brk = (name, fired) => { breaks++; if (fired) { caught++; console.log(`  ✓ anti-vacuity: ${name} is caught`); } else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
console.log(`mobhazardrefcheck -- mob fire / drowning / void vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  ENG[s.id] = engineSeries(s);
  const bad = compare(s, g, ENG[s.id]);
  if (bad.length) reds.push(...bad); else pass++;
}
const C = M.Combat, EL_ = EL;
{ const o = C.FIRE_DAMAGE_PER_TICK; C.FIRE_DAMAGE_PER_TICK = 2; const s = SCEN.find((q) => q.id === 'cow_fire');
  const e = engineSeries(s); C.FIRE_DAMAGE_PER_TICK = o; brk('fire damage 2', compare(s, golden.cases[s.id], e).length > 0); }
{ const o = EL_.tickMobAir; EL_.tickMobAir = function (e) { o(e); if (!e.brk299 && e.eyeInWater) { e.brk299 = 1; e.air--; } }; const s = SCEN.find((q) => q.id === 'cow_submerged');
  const e = engineSeries(s); EL_.tickMobAir = o; brk('air 299', compare(s, golden.cases[s.id], e).length > 0); }
{ const o = EL_.VOID_Y; EL_.VOID_Y = -126; const s = SCEN.find((q) => q.id === 'cow_above_void');
  const e = engineSeries(s); EL_.VOID_Y = o; brk('void threshold off by one', compare(s, golden.cases[s.id], e).length > 0); }
for (const r of reds) console.log('  x ' + r);
console.log(`mobhazardrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red - anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` ${caught} breaks caught`);
process.exit(reds.length ? 1 : 0);
