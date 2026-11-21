// phantomlockstepcheck.mjs -- #6669 (G17-L98): lockstep scenario 'phantom': a phantom 20 blocks above a standing dummy, 600 ticks, 20 salts.
// Reference = PhantomEntity.StartAttackGoal / SwoopMovementGoal / CircleMovementGoal / PhantomMoveControl (.decomp) written out independently here, in the engine's yaw frame (D-415),
// fed the same random stream. Per tick: pos, velocity, size, phase (circle/swoop), circle centre, bite tick. OWED: daylight burn and bite damage by size (needs the combat substrate).
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js', '07zz1_phantom.js'], dom: false });
const { Phantom: Ph, Ai } = M;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i), TICKS = 600, ATTACK_DELAY = 20;
const D = Math.PI / 180;
const step = (c, t, s) => (c < t ? Math.min(c + s, t) : Math.max(c - s, t));
const dummy = { x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.8 };
const mk = (salt) => ({ x: 0.5, y: 84, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, width: 0.9, height: 0.5, age: 0, phantomSize: salt % 4, dead: false, silent: true });
let bites;
M.Combat = { mobAttack: () => bites.push(1) };
M.World = { getBlock: () => 0 };
function engine(salt) {
  const r = stream(salt), ctx = { random: r, players: () => [] }, e = mk(salt); bites = [];
  e.flyMove = new Ph.PhantomMoveControl(e);
  const sa = new Ph.StartAttackGoal(e, ctx), sw = new Ph.SwoopMovementGoal(e, ctx), ci = new Ph.CircleMovementGoal(e, ctx);
  let saOn = false, swOn = false, ciOn = false; const rows = [];
  for (let t = 0; t < TICKS; t++) {
    e.age = t;
    if (!e.target && t >= ATTACK_DELAY && (t - ATTACK_DELAY) % 60 === 0) e.target = dummy;   // FindTargetGoal: 20 then every 60
    if (!saOn && sa.canUse()) { sa.start(); saOn = true; }
    if (saOn) { if (sa.canContinueToUse()) sa.tick(); else { sa.stop(); saOn = false; } }
    if (!swOn && sw.canUse()) { sw.start(); swOn = true; }
    if (swOn) { if (sw.canContinueToUse()) sw.tick(); else { sw.stop(); swOn = false; } }
    if (!swOn && !ciOn && ci.canUse()) { ci.start(); ciOn = true; }
    if (ciOn) { if (!swOn && ci.canContinueToUse()) ci.tick(); else ciOn = false; }
    e.flyMove.tick(); e.x += e.vx; e.y += e.vy; e.z += e.vz;
    rows.push([e.x, e.y, e.z, e.vx, e.vy, e.vz, e.phantomSize, e.phantomMovementType, e.circlingX, e.circlingY, e.circlingZ, bites.length]);
  }
  return rows;
}
function reference(salt) {
  const r = stream(salt), p = mk(salt), rows = []; let bite = 0;
  let phase = 'circle', cd = 0, started = false, swOn = false, ciOn = false, cx = 0, cy = 0, cz = 0;
  let ang = 0, rad = 5, yo = 0, dir = 1, tx, ty, tz, spd = 0.1, target = false;
  const startSwoop = () => { cx = 0; cz = 0; cy = 64 + 20 + Math.floor(r() * 20); if (cy < 63) cy = 64; };
  const adjust = () => { ang += dir * 15 * D; tx = cx + rad * Math.cos(ang); ty = cy + (-4 + yo); tz = cz + rad * Math.sin(ang); };
  for (let t = 0; t < TICKS; t++) {
    if (!target && t >= ATTACK_DELAY && (t - ATTACK_DELAY) % 60 === 0) target = true;
    if (started && !target) { cy = cy + 10 + Math.floor(r() * 20); started = false; }   // StartAttackGoal.stop (no heightmap in the stub: top = circling Y)
    else if (!started && target) { started = true; cd = 10; phase = 'circle'; startSwoop(); }
    if (started) { cd--; if (phase === 'circle' && cd <= 0) { phase = 'swoop'; startSwoop(); cd = (8 + Math.floor(r() * 4)) * 20; r(); } }   // r(): the swoop sound's pitch roll
    if (!swOn && target && phase === 'swoop') swOn = true;
    if (swOn) {
      if (!target || phase !== 'swoop') { target = false; phase = 'circle'; swOn = false; }
      else {
        tx = dummy.x; ty = dummy.y + 0.9; tz = dummy.z;
        const ex = p.width * 0.5 + Math.fround(0.2), F = Math.fround(0.2);
        if (p.x - ex < 0.8 && p.x + ex > 0.2 && p.z - ex < 0.8 && p.z + ex > 0.2 && p.y - F < 65.8 && p.y + p.height + F > 64) { bite++; phase = 'circle'; }
      }
    }
    if (!swOn && (!target || phase === 'circle')) {   // CircleMovementGoal
      if (!ciOn) { ciOn = true; rad = 5 + r() * 10; yo = -4 + r() * 9; dir = r() < 0.5 ? 1 : -1; if (cx === 0 && cz === 0 && cy === 0) { cx = Math.floor(p.x); cy = Math.floor(p.y); cz = Math.floor(p.z); } adjust(); }
      if (r() * 350 < 1) yo = -4 + r() * 9;
      if (r() * 250 < 1) { rad++; if (rad > 15) { rad = 5; dir = -dir; } }
      if (r() * 450 < 1) { ang = r() * 2 * Math.PI; adjust(); }
      if ((tx - p.x) ** 2 + (ty - p.y) ** 2 + (tz - p.z) ** 2 < 4) adjust();
    } else ciOn = false;
    // PhantomMoveControl
    let dx = tx - p.x, dy = ty - p.y, dz = tz - p.z, h = Math.sqrt(dx * dx + dz * dz);
    if (Math.abs(h) > 1e-5) {
      const f = 1 - Math.abs(dy * 0.7) / h; dx *= f; dz *= f; h = Math.sqrt(dx * dx + dz * dz);
      const d3 = Math.sqrt(dx * dx + dz * dz + dy * dy), py = p.yaw;
      p.yaw = Ai.rotlerp(p.yaw, Math.atan2(dx, -dz), 4 * D);
      if (Math.abs(Ai.wrapRad(p.yaw - py)) < 3 * D) spd = step(spd, 1.8, 0.005 * (1.8 / spd)); else spd = step(spd, 0.2, 0.025);
      const pitch = Math.atan2(dy, h);
      if (d3 > 1e-5) {
        p.vx += (spd * Math.sin(p.yaw) * Math.abs(dx / d3) - p.vx) * 0.2;
        p.vy += (spd * Math.sin(pitch) * Math.abs(dy / d3) - p.vy) * 0.2;
        p.vz += (-spd * Math.cos(p.yaw) * Math.abs(dz / d3) - p.vz) * 0.2;
      }
    }
    p.x += p.vx; p.y += p.vy; p.z += p.vz;
    rows.push([p.x, p.y, p.z, p.vx, p.vy, p.vz, p.phantomSize, target || phase !== 'circle' || t > ATTACK_DELAY ? phase : undefined, cx, cy, cz, bite]);
  }
  return rows;
}
const diff = (salt) => {
  const A = reference(salt), B = engine(salt);
  for (let t = 0; t < TICKS; t++) for (let k = 0; k < 12; k++) {
    const a = A[t][k], b = B[t][k];
    if (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-9 : a !== b) return 't' + t + ' f' + k + ' ' + a + ' vs ' + b;
  }
  return '';
};
const dirty = () => salts.some(diff);
const res = salts.map(diff);
ok(!res.some(Boolean), 'divergence: ' + res.map((d, i) => d && i + ':' + d).filter(Boolean).slice(0, 3));
const tr = engine(3);
ok(tr.some((x) => x[7] === 'swoop') && tr.some((x) => x[11] > 0), 'a swoop and a bite happen (not vacuous)');
ok(Math.min(...tr.map((x) => x[1])) < 70, 'phantom dives from 84 to the dummy');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ph.INIT_SPEED; Ph.INIT_SPEED = 0.2; brk(dirty(), 'swoop speed 0.1 -> 0.2 caught'); Ph.INIT_SPEED = o; }
{ const o = Ph.RADIUS_SPAN; Ph.RADIUS_SPAN = 8; brk(dirty(), 'circle radius roll 5+r*10 -> 5+r*8 caught'); Ph.RADIUS_SPAN = o; }
console.log(`phantomlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
