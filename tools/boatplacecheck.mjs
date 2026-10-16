#!/usr/bin/env node
// boatplacecheck.mjs -- #5230 (G17-B4): BoatItem.use (Use.boatUse in src/14l_use.js), headless.
//   node tools/boatplacecheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
  '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14c_raycast.js', '14f_inventory.js',
  '14l_use.js', '07zzt_boat.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const S = M.States, B = M.Behave, EL = M.EntityList, Iv = M.Inventory, It = M.Items, Use = M.Use, Ray = M.Ray;
const N = 48, MID = 24, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; }, blockLightAt: () => 15 };
M.World = W; B.init(W); M.BlockEntities.init(); M.Entities.init(); EL.init(); Use.init(W);
const PHYS = rdj('block-physics.json');
M.Reg.buildPhysics({ defaults: PHYS.defaults, exceptions: PHYS.exceptions });
M.Physics.shapeAt = (x, y, z) => { const id = W.getBlock(x, y, z); return id === 0 || S.solid[id] !== 1 ? null : M.Physics.shapesFor(id); };
const st = (n) => S.stateOf(n) | 0;
// stone floor at y=-2, water at y=-1 (surface y=0), a stone wall at z=-4
const world = () => {
  cells.fill(0); EL.init();
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { cells[idx(x, -2, z)] = st('stone'); cells[idx(x, -1, z)] = st('water'); }
  for (let x = -8; x <= 8; x++) for (let y = 0; y <= 4; y++) cells[idx(x, y, -4)] = st('stone');
};
const mkP = (o) => Object.assign({ instabuild: false, ex: 0.5, ey: 0, ez: 0.5, eyeHeight: 1.62, reach: 4.5, yaw: 0, pitch: -1.2, syncHotbar() {},
  lookVec() { const cp = Math.cos(this.pitch); return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; } }, o);
const stack = (nm) => ({ i: It.of(nm), n: 3, d: 0 });
const woods = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
const boats = () => EL.list.filter((e) => e.type === 'boat');

function scenario() {
  const r = {};
  for (const w of woods) {
    world(); const P = mkP({ yaw: 0.8 }), s = stack(w + '_boat');
    const used = Use.boatUse(P, s), b = boats();
    r[w] = { used, n: b.length, type: b[0] && b[0].boatType, yaw: b[0] && b[0].yaw, left: s.n };
  }
  world(); { const P = mkP({ instabuild: true }), s = stack('oak_boat'); Use.boatUse(P, s); r.creative = { n: boats().length, left: s.n }; }
  world(); { const P = mkP({ pitch: 1.2 }), s = stack('oak_boat'); r.sky = { used: Use.boatUse(P, s), n: boats().length, left: s.n }; }
  world(); { const P = mkP({ pitch: 0, yaw: 0 }), s = stack('oak_boat'); r.wall = { used: Use.boatUse(P, s), n: boats().length, left: s.n }; }
  world(); { const P = mkP(), s = stack('oak_boat'); EL.spawn('boat', 0.5, 1.2, 0.5, { boatType: 'oak' });
    r.entity = { used: Use.boatUse(P, s), n: boats().length, left: s.n }; }
  return r;
}
function verify(r, tag) {
  woods.forEach((w) => ok(r[w].used && r[w].n === 1 && r[w].type === w && Math.abs(r[w].yaw - 0.8) < 1e-9 && r[w].left === 2,
    `${tag}${w}: boat of that wood at player yaw, one consumed (${JSON.stringify(r[w])})`));
  ok(r.creative.n === 1 && r.creative.left === 3, tag + 'creative keeps the stack');
  ok(!r.sky.used && r.sky.n === 0 && r.sky.left === 3, tag + 'sky places nothing');
  ok(!r.wall.used && r.wall.n === 0 && r.wall.left === 3, tag + 'wall places nothing');
  ok(!r.entity.used && r.entity.n === 1 && r.entity.left === 3, tag + 'entity around the eye blocks it');
}
verify(scenario(), '');

// anti-vacuity: each break must change the outcome
const bad = (fn, restore, msg) => { fn(); const r = scenario(); restore(); okAv(!(function () { const f = fails.length; verify(r, 'brk:'); const x = fails.length > f; fails.length = f; return !x; })(), msg); };
{ const sp = EL.spawn; bad(() => { EL.spawn = (t, x, y, z, o) => sp(t, x, y, z, Object.assign({}, o, { boatType: 'oak' })); }, () => { EL.spawn = sp; }, 'ignoring the wood is noticed'); }
{ const sh = Iv.shrink; bad(() => { Iv.shrink = (s) => s; }, () => { Iv.shrink = sh; }, 'no decrement is noticed'); }
{ const c = Ray.cast; bad(() => { Ray.cast = () => null; }, () => { Ray.cast = c; }, 'no raycast is noticed'); }
{ const ub = Use.boatUse; bad(() => { Use.boatUse = (P, s) => { const R = ub(P, s); if (!R) EL.spawn('boat', 0, 0, 0, {}); return R; }; }, () => { Use.boatUse = ub; }, 'a boat placed on refusal is noticed'); }

console.log(`boatplacecheck (#5230): ${pass} passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
