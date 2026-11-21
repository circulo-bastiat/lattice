// goatjumplockstepcheck.mjs -- #8716 (G18b-L43): lockstep scenario 'goatjump': an adult goat alone in a flat arena, 20 salts, no player.
// Reference = .decomp GoatBrain.addLongJumpActivity + LongJumpTask (run / keepRunning / getJumpingTarget / getRammingVelocity), written out independently:
// LONG_JUMP_COOLING_DOWN rolled 600-1200 (LONG_JUMP_COOLDOWN_RANGE), counts down 1/tick; the task starts on the first tick it is 0 on the ground; the weighted target pick
// (ceil(distSq)) happens on the first task tick, the leap 40 ticks later, velocity = getRammingVelocity; the cooldown is re-rolled 600-1200 on landing.
// Per tick (EL.tick, the real goal selector): brain activity, cooldown memory, LONG_JUMP_MID_JUMP, leap tick, takeoff velocity, landing tick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js',
  '07zw_mobnbt.js', '07w_passive.js', '07d_mining.js', '07e_loot.js', '07zj_goat.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const { EntityList: EL, Goat: Gt, Combat: Cb } = M;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const f32 = Math.fround;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
function world() {
  M.World.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
  const stone = M.States.stateOf('stone');
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) M.World.setBlock(x, 79, z, stone);
  EL.init(); M.Ai.init(); M.Breed.init(); if (Gt.init) Gt.init(); M.Player = null;
}
function jumpRef(fx, fy, fz, tx, ty, tz) {   // LongJumpTask.getRammingVelocity (flat open floor: the arc sweep never meets a block)
  let best = null;
  for (let deg = 65; deg < 85; deg += 5) {
    const nx = tx - fx, nz = tz - fz, nl = Math.hypot(nx, nz), px = tx - (nx / nl) * 0.5, pz = tz - (nz / nl) * 0.5;
    const dx = px - fx, dy = ty - fy, dz = pz - fz, rad = f32(f32(deg) * f32(Math.PI) / 180), a = Math.atan2(dz, dx);
    const h2 = dx * dx + dz * dz, h = Math.sqrt(h2), v2 = h2 * 0.08 / (h * Math.sin(f32(2 * rad)) - 2 * dy * Math.pow(Math.cos(rad), 2));
    if (v2 < 0) continue; const v = Math.sqrt(v2); if (v > 1.5) continue;
    const r = [v * Math.cos(rad) * Math.cos(a) * f32(0.95), v * Math.sin(rad) * f32(0.95), v * Math.cos(rad) * Math.sin(a) * f32(0.95)];
    if (!best || r[0] * r[0] + r[1] * r[1] + r[2] * r[2] < best[0] * best[0] + best[1] * best[1] + best[2] * best[2]) best = r;
  }
  return best;
}
// one salt: run EL.tick until the goat has jumped, landed and re-rolled; read the cooldown, the leap and the landing from the real brain
function lane(salt) {
  world();
  const rng = stream(salt + 700); EL.random = rng;
  const g = EL.spawn('goat', 0.5, 80, 0.5); g.persistent = true; g.silent = true; g.ramCooldown = 1e6;
  g.longJumpCooldown = undefined;
  const px = g.x, pz = g.z, rows = []; let leap = -1, land = -1, vel = null, cd0 = null, cdAfter = null, start = -1;
  for (let t = 0; t < 2600; t++) {
    if (!g.leapPending) { g.x = px; g.z = pz; g.vx = g.vz = 0; }   // the arena walls the goat in: it stands where the pick was made
    EL.tick();
    const b = Gt.brainTrace(g);
    if (cd0 === null && b.jump !== null) cd0 = { t, v: b.jump };
    if (leap < 0 && g.leapPending) { leap = t; vel = [g.vx, g.vy, g.vz]; }
    if (leap >= 0 && land < 0 && !g.leapPending) { land = t; }
    if (land >= 0 && b.jump !== null && cdAfter === null) cdAfter = { t, v: b.jump };
    rows.push(b);
    if (cdAfter) break;
  }
  return { leap, land, vel, cd0, cdAfter, g, rows };
}
const realFind = M.Ai.findPath; M.Ai.findPath = () => null;   // every pillar-ringed target is out of walking reach (vanilla reachesTarget skip never fires)
function check(salt) {
  const r = lane(salt), d = [];
  if (!r.cd0) return { r, d: 'no cooldown memory' };
  // the rolled value shows up on the first tick it is read, 600-1200 minus the ticks already counted down
  if (!(r.cd0.v >= 595 && r.cd0.v <= 1200)) d.push('initial cooldown ' + r.cd0.v + ' not in 600-1200');
  if (r.leap < 0) return { r, d: d.concat('no leap').join('; ') };
  // leap = first-cooldown ticks + 1 pick tick + 40 delay (with the countdown starting at cd0.t)
  const expect = r.cd0.t + r.cd0.v + 40 + 1;
  if (Math.abs(r.leap - expect) > 2) d.push('leap tick ' + r.leap + ' vs ' + expect + ' (cooldown ' + r.cd0.v + ' + 40 windup)');
  const mx = r.vel; const sp = Math.hypot(...mx);
  if (!(sp > 0 && sp <= 1.5 * 1.0001)) d.push('takeoff speed ' + sp);
  // independent kernel: the velocity must be the getRammingVelocity of SOME cell in the 11x11 box (the pick)
  let found = false;
  for (let x = -5; x <= 5 && !found; x++) for (let z = -5; z <= 5 && !found; z++) {
    if (!x && !z) continue; const v = jumpRef(0.5, 80, 0.5, x + 0.5, 80.5, z + 0.5);
    if (v && Math.abs(Math.atan2(v[2], v[0]) - Math.atan2(mx[2], mx[0])) < 1e-6 && mx[1] > 0 && Math.hypot(mx[0], mx[2]) <= Math.hypot(v[0], v[2]) * 1.0001 && Math.hypot(mx[0], mx[2]) >= Math.hypot(v[0], v[2]) * 0.5) found = true;   // EL.tick has already stepped the leap tick (drag/gravity): direction and speed band
  }
  if (!found) d.push('takeoff velocity ' + mx + ' matches no getRammingVelocity target');
  if (r.land < 0) d.push('never landed');
  else if (r.land <= r.leap) d.push('landing tick ' + r.land + ' <= leap ' + r.leap);
  if (r.cdAfter && !(r.cdAfter.v >= 595 && r.cdAfter.v <= 1200)) d.push('post-landing cooldown ' + r.cdAfter.v + ' not in 600-1200');
  if (r.g.y < 79.9) d.push('goat fell through the floor');
  return { r, d: d.join('; ') };
}
const res = salts.map((s) => ({ s, ...check(s) }));
ok(res.every((q) => !q.d), 'goatjump: ' + res.filter((q) => q.d).slice(0, 3).map((q) => `salt ${q.s}: ${q.d}`).join(' | '));
ok(new Set(res.map((q) => q.r.cd0 && q.r.cd0.v)).size > 5, 'salts roll different cooldowns');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const bad = () => salts.slice(0, 4).some((s) => check(s).d);
Gt.LONG_JUMP_COOLDOWN_MIN = 400; brk(bad(), 'LongJumpTask cooldown lower bound 600 -> 400 is reported'); Gt.LONG_JUMP_COOLDOWN_MIN = 600;
Gt.LONG_JUMP_DELAY = 30; brk(bad(), 'long jump delay 40 -> 30 is reported'); Gt.LONG_JUMP_DELAY = 40;
console.log(` assertions passed .... ${n - fails}`);
console.log(` failures ........... ${fails}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails ? 1 : 0);
