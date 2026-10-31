#!/usr/bin/env node
// lockstep-dolphinjump -- #8717 (G18b-L44): lockstep scenario 'dolphinjump', 20 salts: a dolphin in a 12x12x6 water pool, no treasure, no player.
// Reference = .decomp DolphinJumpGoal (canStart: nextInt(toGoalTicks(10)) roll, water at 0,1,4,5,6,7 ahead with two air cells above; start: v += (0.6*dir, 0.7);
// shouldContinue; tick: lerpAngle(pitch,0,0.2) / atan2 pitch; stop: pitch 0), written independently of the engine. The engine collapses toGoalTicks(10) to a per-tick 1-in-10 (07k_goals.js:2476).
// Compared per tick: position, y velocity, pitch, goal start tick and exit tick. Movement between goal calls is one scripted kinematic step shared by both sides.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14b_physics.js', '14j_combat.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes }); M.Equip.init();
M.Dolphin.init();
const EL = M.EntityList, W = M.World, S = M.States, Dol = M.Dolphin;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
// pool x,z 0..11, water y 1..6 (6 deep), stone floor y 0 and a stone rim around, air above
for (let x = -1; x <= 12; x++) for (let z = -1; z <= 12; z++) for (let y = 0; y <= 12; y++) {
  const inside = x >= 0 && x <= 11 && z >= 0 && z <= 11;
  W.setBlock(x, y, z, y === 0 || !inside ? (y <= 6 ? stone : 0) : (y <= 6 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
const TICKS = 240, SALTS = 20, D2R = Math.PI / 180;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const DIRS = [[0, -1, 0], [1, 0, -Math.PI / 2 * -1], [0, 1, Math.PI], [-1, 0, Math.PI / 2 * -1]];   // dx, dz, engine yaw (forward = (sin y, -cos y))
const wet = (x, y, z) => { const b = W.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return b === water; };
// the shared kinematic step: gravity 0.08 / drag 0.98 in air, 0.9 drag and a mild buoyancy in water, no floor reach
function step(s) {
  const w = wet(s.x, s.y, s.z);
  s.x += s.vx; s.y += s.vy; s.z += s.vz;
  if (w) { s.vx *= 0.9; s.vy = s.vy * 0.9 + 0.005; s.vz *= 0.9; } else { s.vx *= 0.98; s.vy = (s.vy - 0.08) * 0.98; s.vz *= 0.98; }
  s.x = Math.min(Math.max(s.x, 0.3), 11.7); s.z = Math.min(Math.max(s.z, 0.3), 11.7);
}
const mkStart = (salt) => { const d = DIRS[salt % 4]; return { dx: d[0], dz: d[1], yaw: d[2], x: d[0] > 0 ? 0.5 : d[0] < 0 ? 11.5 : 5.5, z: d[1] > 0 ? 0.5 : d[1] < 0 ? 11.5 : 5.5, y: 6.2 }; };
const row = (t, x, y, z, vy, pitchDeg, ev) => JSON.stringify([t, +x.toFixed(9), +y.toFixed(9), +z.toFixed(9), +vy.toFixed(9), +pitchDeg.toFixed(6), ev]);

function engine(salt) {
  const r = stream(salt), p = mkStart(salt), out = [];
  EL.list.length = 0; EL.random = Math.random;
  const e = EL.spawn('dolphin', p.x, p.y, p.z); EL.random = r;   // spawn draws are not part of the lane
  e.yaw = p.yaw; e.vx = e.vy = e.vz = 0; e.pitch = 0; e.onGround = false; e.inWater = true;
  let g = null;
  for (let t = 0; t < TICKS; t++) {
    let ev = '';
    e.inWater = wet(e.x, e.y, e.z);
    if (!g) { const cand = new Dol.DolphinJumpGoal(e, 10); if (cand.canUse()) { g = cand; g.start(); ev = 'start'; } }
    if (g) { g.tick(); if (!g.canContinueToUse()) { g.stop(); g = null; ev += 'stop'; } }
    out.push(row(t, e.x, e.y, e.z, e.vy, e.pitch / D2R, ev));
    step(e);
  }
  return out;
}
function reference(salt) {
  const r = stream(salt), p = mkStart(salt), s = { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0 }, out = [];
  let pitch = 0, active = false, inW = false;
  const isWater = (bx, by, bz) => wet(bx, by, bz);
  const isAir = (bx, by, bz) => W.getBlock(bx, by, bz) === 0;
  for (let t = 0; t < TICKS; t++) {
    let ev = '';
    if (!active) {
      if (Math.floor(r() * 10) === 0) {
        const bx = Math.floor(s.x), by = Math.floor(s.y), bz = Math.floor(s.z); let okc = true;
        for (const m of [0, 1, 4, 5, 6, 7]) if (!isWater(bx + p.dx * m, by, bz + p.dz * m) || !isAir(bx + p.dx * m, by + 1, bz + p.dz * m) || !isAir(bx + p.dx * m, by + 2, bz + p.dz * m)) { okc = false; break; }
        if (okc) { active = true; s.vx += p.dx * 0.6; s.vy += 0.7; s.vz += p.dz * 0.6; ev = 'start'; }
      }
    }
    if (active) {
      if (!inW) inW = wet(s.x, s.y, s.z);
      if (s.vy * s.vy < 0.03 && pitch !== 0) pitch += (0 - pitch) * 0.2;
      else if (Math.hypot(s.vx, s.vy, s.vz) > 1e-5) pitch = Math.atan2(-s.vy, Math.hypot(s.vx, s.vz)) / D2R;
      const cont = (!(s.vy * s.vy < 0.03) || pitch === 0 || !(Math.abs(pitch) < 10) || !wet(s.x, s.y, s.z));
      if (!cont) { active = false; pitch = 0; ev += 'stop'; }
    }
    out.push(row(t, s.x, s.y, s.z, s.vy, pitch, ev));
    step(s);
  }
  return out;
}
function run(label) {
  let starts = 0;
  for (let s = 0; s < SALTS; s++) {
    const a = engine(s), b = reference(s);
    starts += a.filter((x) => x.includes('start')).length;
    for (let t = 0; t < TICKS; t++) if (a[t] !== b[t]) return { starts, err: `salt ${s} tick ${t}: engine ${a[t]} != ref ${b[t]}` };
  }
  return { starts };
}
let fails = 0, breaks = 0;
const base = run();
if (base.err) { fails++; console.log('  FAIL ' + base.err); } else if (base.starts < SALTS) { fails++; console.log('  FAIL vacuous: only ' + base.starts + ' jumps over ' + SALTS + ' salts'); }
const mut = (name, fn) => {
  const Orig = Dol.DolphinJumpGoal; Dol.DolphinJumpGoal = function (e, c) { const g = new Orig(e, c); fn(g, e); return g; };
  const r = run(); Dol.DolphinJumpGoal = Orig;
  if (r.err) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('jump velocity 0.6 -> 0.5', (g, e) => { const s = g.start; g.start = () => { const vx = e.vx || 0, vz = e.vz || 0; s(); e.vx = vx + (e.vx - vx) * 5 / 6; e.vz = vz + (e.vz - vz) * 5 / 6; }; });
mut('no clearance test', (g) => { g.canUse = () => Math.floor(EL.random() * 10) === 0; });
mut('exits one tick late', (g, e) => { const c = g.canContinueToUse; let n = 0; g.canContinueToUse = () => { const v = c(); if (!v && n++ < 1) return true; return v; }; });
console.log(`lockstep-dolphinjump: ${SALTS * TICKS + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.starts} jumps over ${SALTS} salts)`);
process.exit(fails ? 1 : 0);
