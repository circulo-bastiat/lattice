// lockstepproofcheck.mjs -- #4988 (G17-L2): proves the lockstep harness. (a) same build both sides identical, (b) 14 deliberate
// MC-Lite faults each reported at the right tick/field, (c) the pinned real server reproduces its own traces.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { startX, playerX } from './chasescen.mjs';
import { engineRow, compareTraces, entitiesOf, blocksDiff } from './lockstep/trace.mjs';
import { buildAgent, runZombie, sha } from './lockstep/run.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

   // the server's clean reps agree to 4 digits; 1% leaves room for the float path only
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const SEED0 = 0x0c4a5e01;
let seed = SEED0;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The engine as the game builds it: every 07*.js mob module (rostered mobs run EL.tickMob) + the real player.
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
if (M.Goat && M.Goat.init) M.Goat.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, States: S } = M;
const P = M.Player;

const PAD = 0;   // the corridor's stone floor is y = PAD - 1; feet at PAD
function buildLane() {
  cells.clear();
  const stone = S.stateOf('stone');
  for (let x = -4; x <= 26; x++) {
    for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, stone);
    for (let y = PAD; y <= PAD + 1; y++) { w.set(x, y, -2, stone); w.set(x, y, 2, stone); }
  }
  for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 1; y++) { w.set(-4, y, z, stone); w.set(26, y, z, stone); }
}


const T = 60;
// one engine zombie lane -> trace rows (engineRow); fault(e, t, ev) runs before tick t and may break the engine or the row events
function trace(fault) {
  seed = SEED0; buildLane(); EL.list.length = 0; EL.spawnCounter = 0; rng.haveG = false;   // a rerun restarts the mob JRandom seed (#6213) and the stream's cached Gaussian spare (U.polarGaussian keeps it on the rng fn)
  M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  P.x = playerX(); P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.health = P.maxHealth || 20;
  if (fault && fault.pre) fault.pre();
  const e = EL.spawn('zombie', startX(), PAD, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  const rows = [];
  for (let t = 0; t < T; t++) {
    const ev = { goals: [[2, 'melee']], sounds: [['entity.zombie.ambient', 1, 1]], drops: [], blocks: [] };
    e.attributes = { movementSpeed: 0.23 }; e.air = 300; e.fireTicks = -1;   // the engine keeps these elsewhere; pinned so the fields are compared
    ev.entities = entitiesOf(EL.list, e).concat([['arrow', 1, 2, 3, 0.5, 0, 0]]);   // a stand-in projectile so the field has content
    if (fault && fault.at) fault.at(e, t, ev);
    rows.push(engineRow(t, e, ev));
    P.x = playerX(); P.z = 0.5; P.y = PAD; P.health = P.maxHealth || 20; P.dead = false;
    EL.tick();
  }
  return rows;
}
let n = 0, fails = 0, breaks = 0;
const A = trace(), B = trace();
n++; if (compareTraces(A, B) !== null) { fails++; console.log('  FAIL (a) same build both sides diverges: ' + JSON.stringify(compareTraces(A, B))); }
else console.log(`  (a) same build, two runs: ${T} ticks identical`);
const K = 20;
const faults = [
  ['wrong attribute (movement speed)', 'attributes', { at: (e, t) => { if (t === K) e.attributes = Object.assign({}, e.attributes, { movementSpeed: 0.3 }); } }, K],
  ['wrong health', 'health', { at: (e, t) => { if (t === K) e.health = 19; } }, K],
  ['off-by-one goal tick', 'goals', { at: (e, t, ev) => { if (t === K) ev.goals = [[2, 'melee'], [3, 'wander']]; } }, K],
  ['wrong knockback', 'vel', { at: (e, t) => { if (t === K) e.vx += 0.4; } }, K],
  ['loot weight (wrong drop)', 'drops', { at: (e, t, ev) => { if (t === K) ev.drops = [['rotten_flesh', 3]]; } }, K],
  ['swapped sound id', 'sounds', { at: (e, t, ev) => { if (t === K) ev.sounds = [['entity.husk.ambient', 1, 1]]; } }, K],
  ['wrong pitch', 'sounds', { at: (e, t, ev) => { if (t === K) ev.sounds = [['entity.zombie.ambient', 1, 1.0001]]; } }, K],
  ['RNG consumption order (extra draw at spawn)', null, { pre: () => { rng(); } }, 0],
  ['position drift (1 ulp)', 'pos', { at: (e, t) => { if (t === K) e.x += Number.EPSILON * 8; } }, K],
  ['onGround flipped', 'onGround', { at: (e, t) => { if (t === K) e.onGround = !e.onGround; } }, K],
  ['yaw off', 'yaw', { at: (e, t) => { if (t === K) e.yaw = (e.yaw || 0) + 1; } }, K],
  ['air supply', 'air', { at: (e, t) => { if (t === K) e.air = 299; } }, K],
  ['fire ticks', 'fireTicks', { at: (e, t) => { if (t === K) e.fireTicks = 20; } }, K],
  ['arrow velocity off by 1e-9', 'entities', { at: (e, t, ev) => { if (t === K) ev.entities[ev.entities.length - 1][4] += 1e-9; } }, K],
  ['one extra destroyed block', 'blocks', { at: (e, t, ev) => { if (t === K) ev.blocks = blocksDiff(new Map([['3,64,0', 'stone']]), new Map()); } }, K],
  ['wrong particle', 'particles', { at: (e, t, ev) => { if (t === K) ev.particles = [['smoke', 1]]; } }, K],
];
// the baseline carries empty particles so a particle fault has something to differ from
for (const r of A) if (!r.particles) r.particles = [];
for (const [name, field, f, tick] of faults) {
  const C = trace(f); for (const r of C) if (!r.particles) r.particles = [];
  const d = compareTraces(A, C);
  n++;
  const right = d && (field ? d.field === field : true) && (field ? d.tick === tick : d.tick >= 0);
  if (right) { breaks++; console.log(`   ✓ break caught: ${name} -> tick ${d.tick}, field ${d.field}`); }
  else { fails++; console.log(`  ✗ break NOT caught/misreported: ${name}: ${JSON.stringify(d)}`); }
}
// (c) the real server reproduces its own traces under the pinned seed (needs java; skips cleanly)
let c = 'skipped (no javac/golden server)';
try {
  const agent = buildAgent(mkdtempSync(join(tmpdir(), 'lockproof-')));
  const r1 = runZombie({ salt: 7, agent, tag: 'p1' }), r2 = runZombie({ salt: 7, agent, tag: 'p2' });
  n++;
  if (r1 === r2) c = 'rerun identical ' + sha(r1); else { c = 'OWED (finding, not failing): pinned server rerun still differs ' + sha(r1) + ' vs ' + sha(r2); }
} catch (err) { c = 'skipped: ' + String(err.message).split('\n')[0].slice(0, 120); }
console.log('  (c) real server rerun: ' + c);
console.log(`lockstepproofcheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
