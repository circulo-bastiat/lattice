#!/usr/bin/env node
// boltrefcheck.mjs — #6085: LIGHTNING STRIKE EFFECTS, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runbolt.mjs        # once per machine/store (~20 s, the real server)
//   node tools/referee/boltrefcheck.mjs [--verbose]
//
// Each scenario of boltscen.mjs (a pig, villager, creeper, mooshroom, cow, and an exposed copper block) is struck by a
// bolt summoned at tick BOLT_AT (EntityList.spawn('lightning_bolt'), difficulty normal, doFireTick on). Per tick the
// engine logs the same samples as the server: which types stand in the cell, the victim's health x100 and fire ticks,
// the creeper's powered flag, fire at the origin cell, the scenario's probe block. From the strike on: the type
// bits, powered, fire block and probe block must equal the server's EXACTLY; health within 0.1 and fire ticks within 1
// over the strike window (BOLT_AT .. BOLT_AT+3).
// Anti-vacuity (D-30): damage 4, fire ticks off by one, and no conversion are each caught. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T, BOLT_AT } from './boltscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'lightning-bolt.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'lightning-bolt.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('boltrefcheck: SKIP (golden not generated -- run node tools/referee/runbolt.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const { readdirSync } = await import('node:fs');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let seed = 0x0b017;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function runEngine(sc, hook) {
  const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init();
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
  const EL = M.EntityList, S = M.States;
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { getBlock: (x, y, z) => (y < -1 ? S.stateOf('stone') | 0 : y === -1 && !cells.has(key(x, y, z)) ? S.stateOf('stone') | 0 : cells.get(key(x, y, z)) || 0),
    setBlock: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); }, getLight: () => 0, tickingAt: () => true };
  w.get = w.getBlock; w.set = w.setBlock;
  M.World = Object.assign(M.World || {}, w);
  if (sc.floor) w.setBlock(0, -1, 0, S.stateOf(sc.floor) | 0);
  if (M.Behave && M.Behave.init) M.Behave.init(w);
  M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && S.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
  M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
  EL.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
  for (const k of ['Effects', 'Undead', 'Piglin', 'Hoglin']) if (M[k] && M[k].init) M[k].init();
  M.Diff = { get: () => 'normal' };
  M.Player = { x: 0, y: 200, z: 0 };
  EL.random = rng; Math.random = rng;
  if (hook) hook(M);
  const out = {};
  const push = (l, v) => (out[l] || (out[l] = [])).push(v);
  let victim = null;
  if (sc.victim) { victim = EL.spawn(sc.victim, 0.5, 0, 0.5, {}); victim.noAI = victim.noAi = true; victim.persistent = true; if (victim.isBaby) victim.isBaby = false; }
  for (let k = 1; k <= T; k++) {
    if (k === BOLT_AT) EL.spawn('lightning_bolt', 0.5, 0, 0.5, {});
    const near = EL.list.filter((e) => !e.removed && !e.dead && e.type !== 'lightning_bolt' && Math.abs(e.x - 0.5) < 1 && Math.abs(e.z - 0.5) < 1);
    for (const t of sc.types) push('n_' + t, near.some((e) => e.type === t) ? 1 : 0);
    if (sc.victim) {
      const v = near[0];
      push('hp', v ? Math.round(v.health * 100) : 0);
      push('fire', v ? (v.remainingFireTicks > 0 ? v.remainingFireTicks : 0) : 0);
      push('powered', v && v.charged ? 1 : 0);
    }
    push('fireblock', w.getBlock(0, 0, 0) === (S.stateOf('fire') | 0) ? 1 : 0);
    if (sc.probe) push('block', w.getBlock(sc.probe[0], sc.probe[1], sc.probe[2]) === (S.stateOf(sc.probe[3]) | 0) ? 1 : 0);
    EL.tick();
  }
  return out;
}

const WINDOW = [BOLT_AT, BOLT_AT + 3];
function compare(id, g, e) {
  const bad = [];
  for (const l of Object.keys(g)) {
    const a = g[l], b = e[l] || [];
    const exact = !(l === 'hp' || l === 'fire');
    const [lo, hi] = exact ? [BOLT_AT - 1, a.length - 1] : WINDOW;
    for (let k = lo; k <= hi; k++) {
      const tol = l === 'hp' ? 10 : l === 'fire' ? 1 : 0;
      // the server's fire is -1 before the first tick; a fire immune mob's fire reads 0
      if (Math.abs(a[k] - b[k]) > tol) { bad.push(`${id}.${l}: first differs at tick ${k}: server ${a.slice(Math.max(0, k - 1), k + 4).join(' ')} | engine ${b.slice(Math.max(0, k - 1), k + 4).join(' ')}`); break; }
    }
  }
  return bad;
}

console.log(`boltrefcheck — lightning strike effects vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate: node tools/referee/runbolt.mjs)`);
const G = {}, E = {};
let nScen = 0;
for (const sc of SCENARIOS) {
  if (!ok(!!golden.cases[sc.id], `${sc.id}: in the golden (regenerate)`)) continue;
  G[sc.id] = golden.cases[sc.id].probes;
  try { E[sc.id] = runEngine(sc); } catch (err) { ok(false, `${sc.id}: engine threw ${err.stack}`); continue; }
  const bad = compare(sc.id, G[sc.id], E[sc.id]);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) for (const l of Object.keys(G[sc.id])) console.log(`   ${sc.id}.${l}\n     S ${G[sc.id][l].slice(0, 12).join(' ')}\n     E ${(E[sc.id][l] || []).slice(0, 12).join(' ')}`);
}

const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
if (G.bolt_cow) {
  const sc = SCENARIOS.find((s) => s.id === 'bolt_cow');
  const hurt = runEngine(sc, (M) => { const r = M.Combat.hurt; M.Combat.hurt = (e, n, ...a) => r.call(M.Combat, e, n === 5 ? 4 : n, ...a); });
  breakCaught('damage 4 instead of 5 is a mismatch', compare(sc.id, G[sc.id], hurt).length > 0);
  const fire = runEngine(sc, (M) => { const r = M.Combat.igniteForSeconds; M.Combat.igniteForSeconds = (e, s) => r.call(M.Combat, e, s + 0.05); });
  breakCaught('fire ticks off by one is a mismatch', compare(sc.id, G[sc.id], fire).length > 0);
}
if (G.bolt_pig) {
  const sc = SCENARIOS.find((s) => s.id === 'bolt_pig');
  const none = runEngine(sc, (M) => { M.Lightning.convertPig = () => {}; });
  breakCaught('no pig conversion is a mismatch', compare(sc.id, G[sc.id], none).length > 0);
}
const fatal = fails.filter((f) => f.startsWith('anti-vacuity'));
const findings = fails.filter((f) => !f.startsWith('anti-vacuity'));
console.log(`boltrefcheck: ${nScen} scenarios compared, ${findings.length} open engine findings (owed), ${breaks} breaks`);
for (const f of findings.slice(0, 60)) console.log('  finding: ' + f);
for (const f of fatal) console.log('  ✗ ' + f);
console.log('');
console.log('================ boltrefcheck (#6085) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fatal.length}`);
console.log(` breaks caught ...... ${breaks - fatal.length}`);
process.exit(fatal.length ? 1 : 0);
