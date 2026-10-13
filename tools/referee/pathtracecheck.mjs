// pathtracecheck.mjs -- #6217 (G17-L12): serverRow fills 'path' from the agent's navigation path nodes.
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { START, DIST } from './chasescen.mjs';
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const brk = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const nodes = [[1, 4, 2], [2, 4, 2], [3, 5, 2]];
const S = serverRow(9, { PathNodes: nodes.map(([x, y, z]) => ({ x: x + 'i', y: y + 'i', z: z + 'i' })) });
ok(JSON.stringify(S.path) === JSON.stringify(nodes), 'serverRow parses compound path nodes');
ok(serverRow(9, {}).path === null, 'no PathNodes -> path null');
ok(JSON.stringify(serverRow(1, { PathNodes: nodes }).path) === JSON.stringify(nodes), 'array nodes accepted');
const eng = (p) => engineRow(9, {}, { path: p });
ok(compareTraces([S], [eng(nodes)], { fields: ['path'] }) === null, 'equal paths agree');
const bad = nodes.map((q) => q.slice()); bad[1][0] += 1;
const d = compareTraces([S], [eng(bad)], { fields: ['path'] });
brk(d && d.field === 'path' && d.tick === 9, 'engine path node shifted by 1 reported as field path');
const live = engineRow(9, { navPath: nodes.map(([x, y, z]) => ({ x, y, z })) });
ok(compareTraces([S], [live], { fields: ['path'] }) === null, '#6256: engineRow derives path from e.navPath');
const liveBad = engineRow(9, { navPath: nodes.map(([x, y, z], i) => ({ x: x + (i === 1 ? 1 : 0), y, z })) });
brk(compareTraces([S], [liveBad], { fields: ['path'] })?.field === 'path', '#6256: live navPath node shifted by 1');

// #6952: the live zombie round the 1-block wall (chasescen zombie_wall) vs the path the REAL server's EntityNavigation held each tick
// (SeedAgent -Dmclite.lockstep.pathlog, runchase -> golden/pathwall.json; regenerate: lockstep/run.mjs runLane({ full: true })).
const fx = JSON.parse(readFileSync(join(MCLITE_ROOT, 'tools', 'referee', 'golden', 'pathwall.json'), 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07m_breed.js', '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOBS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE.includes(f)).sort();
const M = loadEngine({ extra: BASE.concat(MOBS), dom: false, initReg: true });
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
if (M.Goat && M.Goat.init) M.Goat.init();
M.Player.init(); M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
let sd = 0x0c4a5e01; const rng = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
M.EntityList.random = rng; Math.random = rng;
const stone = M.States.stateOf('stone');
for (let x = -4; x <= DIST + 4; x++) {
  for (let z = -1; z <= 1; z++) w.set(x, -1, z, stone);
  for (let y = 0; y <= 1; y++) { w.set(x, y, -2, stone); w.set(x, y, 2, stone); }
}
for (let z = -1; z <= 1; z++) for (let y = 0; y <= 1; y++) { w.set(-4, y, z, stone); w.set(DIST + 4, y, z, stone); }
for (let z = -1; z <= 0; z++) w.set(START + 5, 0, z, stone);   // the 1-high wall (runchase: z -1..0, z 1 open)
const P = M.Player;
P.x = DIST + 0.5; P.y = 0; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false;
const ez = M.EntityList.spawn('zombie', START + 0.5, 0, 0.5);
ez.persistent = true;
const rowsE = [];
for (let t = 0; t < fx.path.length; t++) {
  rowsE.push(engineRow(t, ez, { goals: null }));
  P.x = DIST + 0.5; P.z = 0.5; P.y = 0; P.health = P.maxHealth || 20; P.dead = false;
  M.EntityList.tick();
  if (process.env.DBG && t % 4 === 0) console.log(t, ez.x.toFixed(2), ez.target && ez.target.type, ez.navPath && ez.navPath.length);
}
const firstS = fx.path.findIndex(Boolean), firstE = rowsE.findIndex((r) => r.path && r.path.length > 2)   // skips the short wander path before the zombie targets the player;
const SP = fx.path[firstS];
console.log(`  live wall: server first path at tick ${firstS} (${SP.length} nodes), engine first path at tick ${firstE}`);
ok(firstE >= 0, 'engine computed a path round the wall');
const engP = firstE >= 0 ? rowsE[firstE].path : null;
ok(JSON.stringify(engP) === JSON.stringify(SP), 'live zombie path == recorded server path (' + JSON.stringify(engP) + ' vs ' + JSON.stringify(SP) + ')');
const pick = (path) => [{ tick: 0, path }];
ok(compareTraces(pick(SP), pick(engP), { fields: ['path'] }) === null, 'compareTraces agrees on the live path');
const shifted = (engP || SP).map((q) => q.slice()); shifted[Math.min(3, shifted.length - 1)][0] += 1;
brk(compareTraces(pick(SP), pick(shifted), { fields: ['path'] })?.field === 'path', 'live path with one node shifted by 1 is a first divergence on path');
console.log(`pathtracecheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
