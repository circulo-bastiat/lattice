// leashknotlockstepcheck.mjs -- #6855 (G17-L154): lockstep scenario 'leashknot': lead used on a fence -> knot at block+(0.5,0.375,0.5), fence removed -> knot discarded by the 101st-tick poll
// (AbstractDecorationEntity.tick: obstructionCheckCounter++ == 100), the cow sees it next tick (MobEntity.updateLeash) and drops a lead. 20 salts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
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
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Tame: T } = M;
const FENCE = 777, FX = 3, FY = 0, FZ = 3;
M.Tags = { ready: true, blockTag: () => 1, stateInCol: (c, st) => st === FENCE };
T._fencesCol = 1;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 260;
const params = (salt) => { const r = stream(salt); return { attach: 1 + Math.floor(r() * 5), brk: 1 + Math.floor(r() * 230) }; };
// Reference (decomp): knot ticks from the tick after creation; poll when counter (pre-increment) == 100, i.e. ticks 101, 202, ...; drop one tick later.
function reference(p) {
  const rows = []; let knot = false, fence = true, leash = true, drops = 0, cnt = 0, pend = false;
  for (let t = 1; t <= TICKS; t++) {
    if (t === p.attach) { knot = true; cnt = 0; }
    if (leash && pend) { leash = false; drops++; pend = false; }
    if (t === p.brk) fence = false;
    if (knot && t > p.attach) { if (cnt++ === 100) { cnt = 0; if (!fence) { knot = false; if (leash) pend = true; } } }
    rows.push({ tick: t, entities: knot ? [['leash_knot', FX + 0.5, FY + 0.375, FZ + 0.5, 0, 0, 0]] : [], goals: [[0, leash ? 'leashed' : 'free'], [1, 'drops' + drops]] });
  }
  return rows;
}
function engine(salt, p) {
  cells.clear(); EL.list.length = 0; T.knots.length = 0;
  const r = stream(salt + 100); EL.random = r; Math.random = r;
  const e = EL.spawn('cow', 0.5, 0, 0.5); e.persistent = true; T.leashToPlayer(e);
  w.set(FX, FY, FZ, FENCE); M.Player.x = 0.5; M.Player.y = 0; M.Player.z = 1.5;
  const rows = [];
  for (let t = 1; t <= TICKS; t++) {
    e.x = 0.5; e.y = 0; e.z = 0.5; e.vx = e.vy = e.vz = 0;
    T.tickLeash();   // entity pass first: a knot made this tick (player use, later in the tick) is first ticked NEXT tick
    if (t === p.attach) T.attachHeldMobsToBlock(FX, FY, FZ);
    if (t === p.brk) w.set(FX, FY, FZ, 0);
    rows.push({ tick: t, entities: T.knots.filter((k) => !k.removed).map((k) => ['leash_knot', k.x, k.y, k.z, 0, 0, 0]),
      goals: [[0, e.leashHolder ? 'leashed' : 'free'], [1, 'drops' + EL.list.filter((q) => q.type === 'item').length]] });
  }
  return rows;
}
const run = (salt) => { const p = params(salt); return { p, d: compareTraces(reference(p), engine(salt, p), { fields: ['entities', 'goals'] }), R: reference(p) }; };
const res = salts.map((salt) => ({ salt, ...run(salt) }));
ok(res.every((r) => !r.d), 'no divergence: ' + JSON.stringify(res.filter((r) => r.d).slice(0, 3).map((r) => [r.salt, r.d])));
ok(res.filter((r) => r.R[TICKS - 1].goals[0][1] === 'free').length >= 8, 'enough salts break the knot');
ok(res.some((r) => r.R[TICKS - 1].goals[0][1] === 'leashed'), 'some salt keeps it (fence outlives the run)');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyD = () => salts.some((s) => run(s).d);
T.KNOT_CHECK_INTERVAL = 99; brk(anyD(), 'poll interval 99 reported'); T.KNOT_CHECK_INTERVAL = 100;
const cf = T.knotCanStayAttached; T.knotCanStayAttached = () => true; brk(anyD(), 'a knot that survives its fence is reported'); T.knotCanStayAttached = cf;
const ou = T.unleash; T.unleash = (e) => ou(e, false); brk(anyD(), 'no lead dropped is reported'); T.unleash = ou;
const gk = T.getOrCreateKnot; T.getOrCreateKnot = (x, y, z) => { const k = gk(x, y, z); k.y += 0.125; return k; }; brk(anyD(), 'knot y off by 0.125 reported'); T.getOrCreateKnot = gk;
console.log(`leashknotlockstepcheck: ${23 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
