// elytralockstepcheck.mjs -- #6614 (G17-L88): lockstep scenario 'elytra': a player with a usable elytra jumps from y=200, glides along pitches -60..60,
// fires rockets, hits a wall, lands. 20 salts (yaw + launch speed). Reference = .decomp LivingEntity.travel isFallFlying branch (:2076-2110) written
// independently in vanilla's convention (pitch degrees, positive DOWN, float-free doubles): gravity 0.08*(-1+0.75*cos^2), lift 0.1 * ..., pitch-up
// bonus 0.04 / 3.2, horizontal pull 0.1, drag 0.99/0.98, collision damage (hv0 - hv1)*10 - 3 (FLY_INTO_WALL); FireworkRocketEntity.tick boost
// v += look*0.1 + (look*1.5 - v)*0.5; the glide stops on ground. Per-tick pos+vel via lockstep/trace.mjs. Elytra durability (every 20 glide ticks,
// 14_player.js) is not covered here: it needs the whole player, not Physics.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js',
  '07i_entitylist.js', '14b_physics.js', '14c_raycast.js', '14f_inventory.js', '14l_use.js', '14j_combat.js', '07za_explosion.js', '07zzy_firework.js', '07zv_villagerbrain.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const W = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(key(x, y, z), s); return true; }, blockLightAt: () => 15, clear() {} };
M.World = W; M.Behave.init(W); M.BlockEntities.init(); M.Entities.init(); M.EntityList.init(); M.Use.init(W);
if (M.Explosion.init) M.Explosion.init();
const S = M.States, Ph = M.Physics, EL = M.EntityList;
Ph.shapeAt = (x, y, z) => { const id = W.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return id && S.solid[id] === 1 ? Ph.shapesFor(id) : null; };
Ph.solidAt = (x, y, z) => Ph.shapeAt(x, y, z) !== null;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const RAD = Math.PI / 180, FL = { fields: ['pos', 'vel'], tol: { pos: 1e-6, vel: 1e-6 } };
const NOJ = { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false }, JUMP = Object.assign({}, NOJ, { jump: true });
const CONST = { lift: 0.04, drag: 0.99, dmgMul: 10, dmgSub: 3 };   // the reference constants; the breaks perturb them

// vanilla travel() fall-flying branch; v = [x,y,z]; yawDeg/pitchDeg vanilla (pitch positive down); returns new v and the pre-tick horizontal speed
function refGlide(v, yawDeg, pitchDeg) {
  const p = pitchDeg * RAD, y = yawDeg * RAD;
  const cx = Math.cos(p), lx = Math.sin(y) * cx, ly = -Math.sin(p), lz = -Math.cos(y) * cx;
  const hl = Math.sqrt(lx * lx + lz * lz), hv = Math.hypot(v[0], v[2]), ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
  let c = Math.cos(p); c = c * c * Math.min(1, ll / 0.4);
  let [vx, vy, vz] = v; vy += -0.08 * (1 - c * 0.75);
  if (vy < 0 && hl > 0) { const d = vy * -0.1 * c; vx += lx * d / hl; vy += d; vz += lz * d / hl; }
  if (p < 0 && hl > 0) { const u = hv * -Math.sin(p) * CONST.lift; vx += -lx * u / hl; vy += u * 3.2; vz += -lz * u / hl; }
  if (hl > 0) { vx += (lx / hl * hv - vx) * 0.1; vz += (lz / hl * hv - vz) * 0.1; }
  return { v: [vx * CONST.drag, vy * 0.98, vz * CONST.drag], hv };
}
const look = (yawDeg, pitchDeg) => { const p = pitchDeg * RAD, y = yawDeg * RAD, c = Math.cos(p); return [Math.sin(y) * c, -Math.sin(p), -Math.cos(y) * c]; };

function mkPlayer(x, y, z, yawDeg, pitchDeg, v) {
  return { x, y, z, vx: v[0], vy: v[1], vz: v[2], px: x, py: y, pz: z, yaw: yawDeg * RAD, pitch: -pitchDeg * RAD, onGround: false, flying: false, noclip: false,
    sprinting: false, inWater: false, eyeInWater: false, inLava: false, EYE: 1.62, HEIGHT: 1.8, WIDTH: 0.6, width: 0.6, height: 1.8, type: 'player',
    elytraUsable: true, fallFlying: false };
}
// scene: open air from y=200 (or a wall / the floor); ticks T; rockets fired at the given ticks. Returns first divergence and facts.
function lane(salt, pitchDeg, o) {
  o = o || {}; cells.clear(); EL.list.length = 0;
  const r = stream(salt), yaw = Math.floor(r() * 360) - 180, y0 = o.floor ? 40 : 200, sp = 0.3 + r() * 0.6;
  const yawE = yaw;   // engine yaw = -yawDeg*RAD
  const lk = look(yaw, 0);
  const v0 = [lk[0] * sp, -0.2 - r() * 0.2, lk[2] * sp];
  let x0 = 0, z0 = 0;
  if (o.floor) for (let x = -80; x <= 80; x++) for (let z = -80; z <= 80; z++) W.setBlock(x, 0, z, S.stateOf('stone'));
  if (o.wall) {   // a stone plane 24 blocks ahead along the look direction (yaw 0 looks -z)
    for (let x = -20; x <= 20; x++) for (let y = 120; y <= 260; y++) W.setBlock(x, y, -24, S.stateOf('stone'));
  }
  const yawUse = o.wall ? 0 : yawE;
  const lk2 = look(yawUse, 0), vv = o.wall ? [0, -0.1, -1.2] : v0;
  const P = mkPlayer(x0 + 0.5, y0, z0 + 0.5, yawUse, pitchDeg, vv);
  M.Player = P;
  Ph.tick(P, NOJ);   // a tick in the air, jump not held
  // reference starts from the engine state after that plain tick; the jump tick then starts the glide
  let rv = [P.vx, P.vy, P.vz], rp = [P.x, P.y, P.z];
  const R = [], E = []; let dmg = null, refDmg = null, exitTick = -1, shooter = P, rockets = o.rockets || [];
  for (let t = 1; t <= (o.T || 60); t++) {
    P.px = P.x; P.py = P.y; P.pz = P.z;
    if (rockets.includes(t)) {   // FireworkRocketEntity.tick boost, before the player's travel (rocket entities tick first in the entity list)
      const L = look(yawUse, pitchDeg);
      for (let i = 0; i < 3; i++) rv[i] = rv[i] + L[i] * 0.1 + (L[i] * 1.5 - rv[i]) * 0.5;
      const rk = EL.spawn('firework_rocket', P.x, P.y, P.z, { tag: { Fireworks: { Flight: 3, Explosions: [] } } }); rk.shooter = P; EL.tickOne(rk);
    }
    const g = refGlide(rv, yawUse, pitchDeg); rv = g.v;
    Ph.tick(P, t === 1 ? JUMP : NOJ);
    rp = [rp[0] + rv[0], rp[1] + rv[1], rp[2] + rv[2]];
    if (P.horizontalCollision || P.onGround) {   // the move was clipped: resync position to the engine, the collision rules are under test next
      if (P.horizontalCollision) {
        refDmg = (g.hv - Math.hypot(P.vx, P.vz)) * CONST.dmgMul - CONST.dmgSub; dmg = P.flyIntoWall || 0;
        if (refDmg <= 0) refDmg = 0;
      }
      if (P.onGround) exitTick = P.fallFlying ? -2 : t;
      break;
    }
    R.push({ tick: t, pos: rp.slice(), vel: rv.slice() }); E.push({ tick: t, pos: [P.x, P.y, P.z], vel: [P.vx, P.vy, P.vz] });
  }
  let d = compareTraces(R, E, FL);
  if (!d && o.wall && Math.abs((refDmg || 0) - (dmg || 0)) > 1e-6) d = { tick: R.length, field: 'flyIntoWall', a: refDmg, b: dmg };
  if (!d && o.floor && exitTick < 0) d = { tick: R.length, field: 'landingExit', a: 'ground reached', b: exitTick };
  return { d, R, E, dmg, refDmg, exitTick, P };
}
const PITCHES = [-60, -30, 0, 30, 60];
let cases = 0, wallDmg = 0;
for (const p of PITCHES) {
  const rs = salts.map((s) => lane(s, p)); cases++;
  const bad = rs.filter((x) => x.d); ok(!bad.length, `glide pitch ${p}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
  const rk = salts.map((s) => lane(s, p, { rockets: [5, 12, 20, 21, 33] })); cases++;
  const bk = rk.filter((x) => x.d); ok(!bk.length, `glide+rockets pitch ${p}: ${bk.length}/20 diverge ${bk[0] ? JSON.stringify(bk[0].d) : ''}`);
}
{
  const rs = salts.map((s) => lane(s, 0, { wall: true, T: 60 })); cases++;
  const bad = rs.filter((x) => x.d); ok(!bad.length, `wall impact: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
  wallDmg = rs.filter((x) => x.refDmg > 0).length; ok(wallDmg >= 15, 'wall damage exercised: ' + wallDmg + '/20');
  const fl = salts.map((s) => lane(s, 60, { floor: true, T: 400 })); cases++;
  const bf = fl.filter((x) => x.d); ok(!bf.length, `landing exit: ${bf.length}/20 diverge ${bf[0] ? JSON.stringify(bf[0].d) : ''}`);
  ok(fl.every((x) => x.exitTick > 0 && !x.P.fallFlying), 'landing clears fallFlying');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
// the reference's constants are perturbed: if the engine still matched, the check could not see a wrong engine
CONST.lift = 0.05; brk(!!lane(0, -30).d, 'lift 0.04 -> 0.05 caught'); CONST.lift = 0.04;
CONST.drag = 0.98; brk(!!lane(0, 0).d, 'horizontal drag 0.99 -> 0.98 caught'); CONST.drag = 0.99;
CONST.dmgMul = 8; brk(!!lane(0, 0, { wall: true }).d, 'collision damage multiplier 10 -> 8 caught'); CONST.dmgMul = 10;
CONST.dmgSub = 2; brk(!!lane(0, 0, { wall: true }).d, 'collision damage offset 3 -> 2 caught'); CONST.dmgSub = 3;
const ob = M.Firework.BOOST; M.Firework.BOOST = 1.4; brk(!!lane(0, 0, { rockets: [5] }).d, 'rocket boost 1.5 -> 1.4 caught'); M.Firework.BOOST = ob;
console.log(`elytralockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
