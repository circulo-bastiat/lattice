#!/usr/bin/env node
// fishtickcheck.mjs — G17-F2: FishingBobberEntity.tick (07zzq_fishing.js). Steps a bobber 200 ticks over
// water, land and a block edge and compares position/velocity/state per tick with an independent reference
// written from the .decomp constants (0.92 drag, 0.03 gravity, 0.3/0.2/0.3 water entry, 0.9 bobbing, 1024).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
console.log('fishtickcheck — G17-F2: bobber tick state machine');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07zzq_fishing.js'], dom: false });
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
MCL.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
const Fi = MCL.Fishing;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// scenes: ground top y=64 (land); water surface 63.875 in x>=3 (height .875 in block y=63, floor y=60); wall at x=8 for 'edge'
const SCENES = {
  land:  { fluid: () => 0, floor: 64, wall: 1e9, v: [0.3, 0.2, 0.1], p: [0.5, 66, 0.5] },
  water: { fluid: (x, y) => (y === 63 ? 0.875 : 0), floor: 60, wall: 1e9, v: [0.2, -0.1, 0.05], p: [0.5, 66, 0.5] },
  edge:  { fluid: () => 0, floor: 64, wall: 2, v: [0.5, 0.3, 0], p: [0.5, 66, 0.5] },
};
const mkEnv = (S, seq) => ({
  fluidHeight: S.fluid, rnd: () => seq(),
  move(e, dx, dy, dz) {
    e.horizontalCollision = false;
    let x = e.x + dx; if (x > S.wall) { x = S.wall; e.horizontalCollision = true; }
    let y = e.y + dy; e.onGround = false; if (y < S.floor) { y = S.floor; e.onGround = true; }
    e.x = x; e.y = y; e.z += dz;
  },
});
function ref(S, n, seq) {
  const s = { x: S.p[0], y: S.p[1], z: S.p[2], vx: S.v[0], vy: S.v[1], vz: S.v[2], st: 0, g: false, hc: false }, out = [];
  for (let t = 0; t < n; t++) {
    const by = Math.floor(s.y), h = S.fluid(0, by), w = h > 0; let ret = false;
    if (s.st === 0) { if (w) { s.vx *= .3; s.vy *= .2; s.vz *= .3; s.st = 2; ret = true; } }
    else if (s.st === 2) {
      let d = s.y + s.vy - by - h; if (Math.abs(d) < .01) d += Math.sign(d) * .1;
      s.vx *= .9; s.vz *= .9; s.vy -= d * seq() * .2;
    }
    if (!ret) {
      if (!w) s.vy -= .03;
      s.hc = false; s.g = false; s.x += s.vx; if (s.x > S.wall) { s.x = S.wall; s.hc = true; }
      s.y += s.vy; if (s.y < S.floor) { s.y = S.floor; s.g = true; } s.z += s.vz;
      if (s.st === 0 && (s.g || s.hc)) s.vx = s.vy = s.vz = 0;
      s.vx *= .92; s.vy *= .92; s.vz *= .92;
    }
    out.push([s.x, s.y, s.z, s.vx, s.vy, s.vz, s.st]);
  }
  return out;
}
const lcg = () => { let a = 7; return () => (a = (a * 48271) % 2147483647) / 2147483647; };
function player() {
  const P = { x: 0.5, y: 65, z: 0.5, removed: false, dead: false, slot: 0, inventory: MCL.Inventory.create() };
  MCL.Inventory.setItem(P.inventory, 0, MCL.Inventory.stack('fishing_rod', 1, 0)); return P;
}
function run() {
  const bad = [];
  for (const [name, S] of Object.entries(SCENES)) {
    const exp = ref(S, 200, lcg()), P = player(), seq = lcg(), env = mkEnv(S, seq);
    const e = { owner: P, x: S.p[0], y: S.p[1], z: S.p[2], vx: S.v[0], vy: S.v[1], vz: S.v[2], removed: false };
    for (let t = 0; t < 200; t++) {
      Fi.tick(e, env);
      const g = [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.state], x = exp[t];
      if (g.some((v, i) => !(Math.abs(v - x[i]) < 1e-9))) { bad.push(name + '@' + t); break; }
    }
  }
  // removeIfInvalid: owner dead, rod not held, distance > 32 (1024 sq), and the kept case
  const mk = () => ({ owner: player(), x: 0.5, y: 65, z: 0.5, vx: 0, vy: 0, vz: 0, removed: false });
  const env = mkEnv(SCENES.land, lcg());
  for (const [nm, f, want] of [['dead', (e) => { e.owner.dead = true; }, true], ['norod', (e) => { MCL.Inventory.setItem(e.owner.inventory, 0, null); }, true],
    ['far', (e) => { e.x = 33.5; }, true], ['near', (e) => { e.x = 32.4; }, false]]) {
    const e = mk(); f(e); Fi.tick(e, env); if (e.removed !== want) bad.push('invalid:' + nm);
  }
  // hooked entity follows, and falls back to FLYING when it is removed
  const H = { id: 4, x: 3, y: 70, z: 2, height: 2, removed: false }, e = mk();
  e.state = 0; Fi.setHooked(e, H); Fi.tick(e, env);
  if (e.state !== 1 || e.hookedId !== 5) bad.push('hook1');
  Fi.tick(e, env); if (e.x !== 3 || Math.abs(e.y - 71.6) > 1e-9) bad.push('follow');
  H.removed = true; Fi.tick(e, env); if (e.state !== 0 || e.hookedEntity) bad.push('unhook');
  return bad;
}
const bad0 = run(); ok(bad0.length === 0, 'baseline: ' + bad0.join(','));
let caught = 0;
const faults = {
  'drag 0.98': () => { Fi.DRAG = 0.98; },
  'gravity 0.04': () => { Fi.GRAVITY = 0.04; },
  'wrong state transition': () => { Fi.BOBBING = 1; },
  'no removeIfInvalid': () => { Fi.removeIfInvalid = () => false; },
};
for (const [nm, inject] of Object.entries(faults)) {
  const keep = { d: Fi.DRAG, g: Fi.GRAVITY, b: Fi.BOBBING, r: Fi.removeIfInvalid };
  inject(); const b = run(); if (b.length) { caught++; console.log('  ✓ fault caught: ' + nm); } else fails.push('fault not caught: ' + nm);
  Fi.DRAG = keep.d; Fi.GRAVITY = keep.g; Fi.BOBBING = keep.b; Fi.removeIfInvalid = keep.r;
}
ok(caught === Object.keys(faults).length, 'faults');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `OK  ${pass} checks passed, 0 failures; bobber tick matches the .decomp constants; ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
