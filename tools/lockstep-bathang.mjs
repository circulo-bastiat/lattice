#!/usr/bin/env node
// lockstep-bathang -- #6893 (G17-L176): lockstep scenario 'bathang', 20 salts. Two bats in a 12x6x12 cave (ceiling y=70, floor y=64): one born
// roosting under the ceiling, one flying. A player walks to 3 blocks of the roosting bat at tick 200. The engine's real Bat.mobTick/postTick are
// compared per tick with BatEntity.mobTick/tick (.decomp): roosting flag, hangingPos, pos/vel/yaw, headYaw (1/200 nextInt(360)), target re-roll
// (1/30 or within 2), wake (player within 4, sneak-free), roost (1/100 + solid above) and the takeoff sound tick.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 600, H = 0.5;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const solidAt = (x, y, z) => y >= 70 || y <= 63 || x < 0 || x >= 12 || z < 0 || z >= 12;
const playerAt = (t) => t < 200 ? { x: 40, y: 66, z: 40 } : { x: 3.5, y: 68.0, z: 6.5 };
const starts = () => [{ x: 3.5, y: 69 - 0.5 + 0.5, z: 3.5, roost: true }, { x: 8.5, y: 66.2, z: 8.5, roost: false }];

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07zf_bat.js'], dom: false });
  const r = stream(salt), sounds = [];
  let tick = 0;
  M.World = { getBlock: (x, y, z) => solidAt(x, y, z) ? 1 : 0 };
  M.States = { solid: [0, 1] };
  M.Physics = { shapesForState: () => 'F', FULL_CUBE: 'F' };
  M.Sound = { play: (n) => sounds.push(tick) };
  M.Bat.random = r;
  const bats = starts().map((s) => ({ type: 'bat', x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: 0, headYaw: 0, height: H, roosting: s.roost, hangingPos: null, silent: false }));
  const rows = [];
  for (; tick < TICKS; tick++) {
    M.Player = Object.assign({ EYE: 1.62 }, playerAt(tick));
    for (const e of bats) { M.Bat.mobTick(e); e.x += e.vx; e.y += e.vy; e.z += e.vz; M.Bat.postTick(e); }
    rows.push(bats.map((e) => [e.roosting, JSON.stringify(e.hangingPos), e.x, e.y, e.z, e.vx, e.vy, e.vz, e.yaw, e.headYaw].join(',')).join('|') + '#' + sounds.join(','));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), ni = (n) => Math.floor(r() * n), sounds = [];
  const bats = starts().map((s) => ({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: 0, hy: 0, roost: s.roost, hp: null }));
  const rows = [];
  for (let t = 0; t < TICKS; t++) {
    const p = playerAt(t);
    for (const e of bats) {
      const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      if (e.roost) {
        if (solidAt(bx, by + 1, bz)) {
          if (ni(200) === 0) e.hy = ni(360) * Math.PI / 180;
          const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
          if (dx * dx + dy * dy + dz * dz <= 16) { e.roost = false; r(); r(); sounds.push(t); }
        } else { e.roost = false; r(); r(); sounds.push(t); }
      } else {
        if (e.hp && (solidAt(e.hp[0], e.hp[1], e.hp[2]) || e.hp[1] <= -64)) e.hp = null;
        const near = e.hp && ((e.hp[0] + .5 - e.x) ** 2 + (e.hp[1] + .5 - e.y) ** 2 + (e.hp[2] + .5 - e.z) ** 2 < 4);
        if (!e.hp || ni(30) === 0 || near) {
          const a = ni(7), b = ni(7), c = ni(6), d = ni(7), f = ni(7);
          e.hp = [Math.floor(e.x + a - b), Math.floor(e.y + c - 2), Math.floor(e.z + d - f)];
        }
        e.vx += (Math.sign(e.hp[0] + .5 - e.x) * .5 - e.vx) * .1;
        e.vy += (Math.sign(e.hp[1] + .1 - e.y) * .7 - e.vy) * .1;
        e.vz += (Math.sign(e.hp[2] + .5 - e.z) * .5 - e.vz) * .1;
        if (e.vx !== 0 || e.vz !== 0) e.yaw = Math.atan2(e.vx, -e.vz);
        if (ni(100) === 0 && solidAt(bx, by + 1, bz)) e.roost = true;
      }
      e.x += e.vx; e.y += e.vy; e.z += e.vz;
      if (e.roost) { e.vx = e.vy = e.vz = 0; e.y = Math.floor(e.y) + 1 - H; } else e.vy *= 0.6;
    }
    rows.push(bats.map((e) => [e.roost, JSON.stringify(e.hp), e.x, e.y, e.z, e.vx, e.vy, e.vz, e.yaw, e.hy].join(',')).join('|') + '#' + sounds.join(','));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const breaks = [
  ['wake distance 4 -> 3', (f, s) => f === '07zf_bat.js' ? s.replace('ROOST_WAKE_DIST: 4.0,', 'ROOST_WAKE_DIST: 3.0,') : s],
  ['target re-roll 1/30 -> 1/31', (f, s) => f === '07zf_bat.js' ? s.replace('rint(30)', 'rint(31)') : s],
  ['vy damp 0.6 -> 0.7', (f, s) => f === '07zf_bat.js' ? s.replace('VY_DAMP: 0.6,', 'VY_DAMP: 0.7,') : s],
  ['yaw roll 1/200 -> 1/100', (f, s) => f === '07zf_bat.js' ? s.replace('rint(200)', 'rint(100)') : s],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`bathang: ${caught} breaks caught, ${base.bad} divergences${base.first ? " " + base.first : ""}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
