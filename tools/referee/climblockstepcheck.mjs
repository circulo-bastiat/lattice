// climb lockstep check -- #6607 (G17-L81): lockstep scenario 'climb'.
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
const { EntityList: EL, States: S } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
// Reference = .decomp LivingEntity.handleOnClimbableMovement: x/z clamped to +-0.15, y no lower than -0.15, fallDistance = 0,
// a sneaking player (isSuppressingSlidingDownLadder) on a climbable with y < 0 holds y = 0. Climbable = ladder/vine/scaffolding/twisting+weeping vines.
const C = 0.15, clampRef = (v, k) => Math.max(-C, Math.min(C, v));
const refClamp = (v, sneak) => { const o = { x: clampRef(v.x), z: clampRef(v.z), y: Math.max(v.y, -C) }; if (sneak && o.y < 0) o.y = 0; return o; };
const BLOCKS = ['ladder', 'vine', 'scaffolding', 'twisting_vines', 'weeping_vines', 'stone', 'air'];
const CLIMB = new Set(['ladder', 'vine', 'scaffolding', 'twisting_vines', 'weeping_vines']);
function clampLane(salt) {
  const r = stream(salt), out = [];
  for (const b of BLOCKS) for (const sneak of [false, true]) {
    cells.clear(); if (b !== 'air') w.set(0, 5, 0, S.stateOf(b));
    const v = { x: (r() - 0.5) * 1.2, y: (r() - 0.5) * 1.2, z: (r() - 0.5) * 1.2 };
    const e = { x: 0.5, y: 5.2, z: 0.5, vx: v.x, vy: v.y, vz: v.z, fallDistance: 7, living: true, type: 'zombie' };
    M.Physics.climbClamp(e, { sneak });
    const exp = CLIMB.has(b) ? refClamp(v, sneak) : v;
    const efd = CLIMB.has(b) ? 0 : 7;
    const f = Math.fround, got = [e.vx, e.vy, e.vz, e.fallDistance], want = [exp.x, exp.y, exp.z, efd];
    const i = got.findIndex((g, k) => Math.abs(f(g) - f(want[k])) > 1e-6);
    out.push({ b, sneak, d: i < 0 ? null : { field: ['vx', 'vy', 'vz', 'fd'][i], got: got[i], want: want[i] } });
  }
  return out;
}
let cases = 0;
const all = salts.map(clampLane);
for (const rs of all) for (const x of rs) cases++;
const bad = all.flat().filter((x) => x.d);
ok(!bad.length, `clamp: ${bad.length}/${cases} diverge ${bad[0] ? bad[0].b + ' sneak=' + bad[0].sneak + ' ' + JSON.stringify(bad[0].d) : ''}`);
// onClimbable per block, and a zombie falling down a ladder shaft: never faster than -0.15, fallDistance stays 0 (20 seeds).
for (const b of BLOCKS) { cells.clear(); if (b !== 'air') w.set(0, 5, 0, S.stateOf(b)); ok(M.Physics.onClimbable({ x: 0.5, y: 5.2, z: 0.5 }) === CLIMB.has(b), 'onClimbable ' + b); }
function shaft(salt) {
  cells.clear(); EL.list.length = 0;
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) w.set(x, -1, z, S.stateOf('stone'));
  for (let y = 0; y < 20; y++) w.set(0, y, 0, S.stateOf('ladder'));
  const r = stream(salt); EL.random = r; Math.random = r; M.Player = { x: 30, y: 0, z: 30 };
  const e = EL.spawn('zombie', 0.5, 15, 0.5); e.persistent = true;
  let worst = 0, fd = 0;
  for (let t = 0; t < 40; t++) { EL.tick(); worst = Math.min(worst, e.vy); fd = Math.max(fd, e.fallDistance || 0); }
  return { worst, fd };
}
const sh = salts.map(shaft);
ok(sh.every((s) => s.worst >= -C - 0.0785 - 1e-6 && s.fd <= C + 1e-6), 'ladder shaft: vy >= -0.15 - one tick gravity, fallDistance <= one tick: ' + JSON.stringify(sh[0]));
// breaks
const c0 = M.Physics.CLIMB_CLAMP; M.Physics.CLIMB_CLAMP = 0.2;
brk(salts.map(clampLane).flat().some((x) => x.d), 'clamp 0.15 -> 0.2 caught'); M.Physics.CLIMB_CLAMP = c0;
const cc = M.Physics.climbClamp; M.Physics.climbClamp = (e) => cc(e, null);
brk(salts.map(clampLane).flat().some((x) => x.d), 'sneak hold removed caught'); M.Physics.climbClamp = cc;
console.log(`climblockstepcheck: ${cases + BLOCKS.length + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
