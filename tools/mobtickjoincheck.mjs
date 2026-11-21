#!/usr/bin/env node
// mobtickjoincheck.mjs — cloud referee-mob-hoglin-ram (27 Sept 2026): every per-mob mobTick hook REACHES a live,
// rostered mob. The hoglin/piglin/blaze/strider/wandering-trader/trader-llama hooks had drifted into `EL.tickOne`'s
// NO-AI tail, which a mob with a goal selector never reaches (`if (mob) return EL.tickMob(e)`) — so in the game a
// hoglin never sensed a repellent (hoglinrefcheck: "engine does not flee"), a piglin never zombified, etc. Every
// module check drove its hook DIRECTLY, so none saw it (rule 7: the bugs live in the joins).
// Spawns each type through `EL.spawn` (so `e.ai` is attached exactly as in the game), ticks the WHOLE list N times,
// and asserts each type's hook ran N times on it. Anti-vacuity (D-30/D-305): the hoglin and the piglin module each
// switched off (`.ready = false`, the dispatch's own gate) must drop that type's count to 0 and be caught.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
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
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
let seed = 0x6d746a63;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
M.EntityList.random = rng; Math.random = rng;
const { EntityList: EL, States: S } = M;
const stone = S.stateOf('stone');
for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) w.set(x, -1, z, stone);
M.Player.x = 0.5; M.Player.y = 200; M.Player.z = 0.5;

// type -> [module, hook name]: exactly the dispatch lines in EL.tickMob's mobTick slot.
const HOOKS = {
  hoglin: ['Hoglin', 'tickEntity'], zoglin: ['Hoglin', 'tickEntity'],
  piglin: ['Piglin', 'tickEntity'], piglin_brute: ['Piglin', 'tickEntity'],
  blaze: ['Blaze', 'mobTick'], strider: ['Strider', 'tickEntity'],
  wandering_trader: ['WT', 'tickEntity'], trader_llama: ['Llama', 'tickTraderLlamaDespawn'],
};
const N = 5;
const counts = new Map();
for (const [modName, fnName] of Object.values(HOOKS)) {
  const mod = M[modName];
  if (!mod || typeof mod[fnName] !== 'function' || mod[fnName].__spy) continue;
  const orig = mod[fnName];
  const spy = function (e) { counts.set(e, (counts.get(e) || 0) + 1); return orig.apply(this, arguments); };
  spy.__spy = true; mod[fnName] = spy;
}

function run() {
  EL.list.length = 0; counts.clear();
  const ents = [];
  let i = 0;
  for (const type of Object.keys(HOOKS)) {
    const e = EL.spawn(type, -20 + 5 * i++, 0, 0.5);
    if (e) { e.persistent = true; ents.push(e); }
  }
  for (let t = 0; t < N; t++) { M.Player.y = 200; EL.tick(); }
  return ents;
}

let assertions = 0, failures = 0, breaks = 0, caught = 0;
const fail = (m) => { failures++; console.log('  ✗ ' + m); };
const ents = run();
for (const type of Object.keys(HOOKS)) {
  assertions++;
  const e = ents.find((q) => q.type === type);
  if (!e) { fail(`${type}: EL.spawn gave nothing`); continue; }
  if (!e.ai && !EL.WATER_TICK_ONLY[type]) { fail(`${type}: spawned without a goal selector -- this check would not test the AI path`); continue; }
  const n = counts.get(e) || 0;
  if (n < N) fail(`${type}: ${HOOKS[type].join('.')} ran ${n}/${N} ticks on a live, rostered ${type} -- the hook is not in EL.tickMob`);
}
// anti-vacuity: each dispatch's own gate switched off must be seen (two different hooks, two modules)
function gateOffCount(modName, type) {
  M[modName].ready = false;
  const e2 = run().find((q) => q.type === type);
  M[modName].ready = true;
  return e2 ? (counts.get(e2) || 0) : -1;
}
function brk(label, fired) { breaks++; if (fired) caught++; else fail(`anti-vacuity: break "${label}" was NOT caught`); }
brk('Hoglin.ready=false drops the live hoglin hook count to 0', gateOffCount('Hoglin', 'hoglin') === 0);
brk('Piglin.ready=false drops the live piglin hook count to 0', gateOffCount('Piglin', 'piglin') === 0);
console.log(`mobtickjoincheck: ${Object.keys(HOOKS).length} rostered mob types, their mobTick hooks through a live EL.tick`);
console.log(` ${assertions} assertions, ${failures} failures, ${caught}/${breaks} breaks caught`);
process.exit(failures ? 1 : 0);
