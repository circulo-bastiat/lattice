// blockslow lockstep check -- #6606 (G17-L80): lockstep scenario 'blockslow'.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
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
M.Reg.buildPhysics(rdj('block-physics.json'));
M.Use.init(w);
const { EntityList: EL, States: S, Physics: Ph } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp Entity.makeStuckInBlock (cobweb 0.25/0.05/0.25, sweet_berry_bush 0.8/0.75/0.8, powder snow 0.9/1.5/0.9; applied by the NEXT move(),
// which scales the displacement and zeroes velocity), LivingEntity.travel (move, then vy = (vy - 0.08) * 0.98), Block.getSpeedFactor (soul_sand, honey_block 0.4)
// and Entity.getBlockSpeedFactor (block at pos; if exactly 1.0, the block at y - 0.500001). A falling cow is stepped independently per tick.
const MULT = { cobweb: [0.25, 0.05, 0.25], sweet_berry_bush: [0.8, 0.75, 0.8], powder_snow: [Math.fround(0.9), 1.5, Math.fround(0.9)] };
const TICKS = 40;
function lane(salt, block) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone'));
  for (let y = 20; y <= 29; y++) w.set(0, y, 0, S.stateOf(block));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('cow', 0.5, 36, 0.5); e.persistent = true; M.Player = { x: 30, y: 0, z: 30 };
  const hw = 0.45, h = 1.4, m = MULT[block];
  let y = e.y, vy = 0, pend = null; const R = [], E = [];
  for (let t = 0; t < TICKS; t++) {
    EL.tick();
    let dy = vy; if (pend) { dy *= pend[1]; vy = 0; pend = null; }
    y += dy; vy = (vy - 0.08) * 0.98;
    if (y + h > 20 + 1e-3 && y < 30 - 1e-3 && (block !== 'powder_snow' || Math.floor(y) >= 20)) pend = m;
    R.push(serverRow(t, { Pos: [0.5, y, 0.5], Motion: [0, vy, 0] })); E.push(engineRow(t, { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz }));
  }
  return { e, d: compareTraces(R, E, { fields: ['pos', 'vel'], tol: { pos: 1e-6, vel: 1e-6 } }) };
}
let cases = 0;
for (const b of Object.keys(MULT)) {
  const rs = salts.map((s) => lane(s, b)); cases++;
  const bad = rs.filter((x) => x.d);
  ok(!bad.length, `${b}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
}
// getBlockSpeedFactor: in the block, or (when that is exactly 1) on the block below at y - 0.500001.
function factors() {
  cells.clear(); w.set(0, 0, 0, S.stateOf('honey_block')); w.set(2, 0, 0, S.stateOf('soul_sand')); w.set(4, -1, 0, S.stateOf('soul_sand'));
  return [Ph.speedFactorOf({ x: 0.5, y: 0, z: 0.5 }), Ph.speedFactorOf({ x: 2.5, y: 0, z: 0.5 }), Ph.speedFactorOf({ x: 0.5, y: 0.5, z: 0.5 }),
    Ph.speedFactorOf({ x: 4.5, y: 0.5, z: 0.5 }), Ph.speedFactorOf({ x: 6.5, y: 0, z: 0.5 })];
}
const WANT = [0.4, 0.4, 0.4, 1, 1];   // honey/soul sand inside; y 0.5 -> lookup at -1e-7 -> block -1 (4: soul sand at -1 -> 0.4 expected below)
WANT[2] = 1; WANT[3] = 0.4;            // (0.5,0.5): block 0 is honey -> in-block read 0.4; fixed below
WANT[2] = 0.4;
const fok = (F) => F.every((v, i) => Math.abs(v - WANT[i]) < 1e-6);
ok(fok(factors()), 'speed factors ' + JSON.stringify(factors()));
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const sm = Ph.slowMovement;
Ph.slowMovement = (e, mm, c) => sm(e, c ? [0.3, 0.06, 0.3] : mm, c);
brk(!!lane(0, 'cobweb').d, 'cobweb factor 0.25 -> 0.3 caught'); Ph.slowMovement = sm;
const ba = Ph.blockAt;
Ph.blockAt = (x, y, z) => ba(x, y + 1e-7, z);
brk(!fok(factors()), 'below-block lookup y-0.5000001 -> y-0.5 caught'); Ph.blockAt = ba;
console.log(`blockslowlockstepcheck: ${cases + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
