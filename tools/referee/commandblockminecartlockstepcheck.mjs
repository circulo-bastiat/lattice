// commandblockminecartlockstepcheck.mjs -- #5387 (G17-L4): the minecartrail lockstep lanes (flat+powered, slope up/down, curve; 20 salts) run on a command_block_minecart (CommandBlockMinecartEntity extends AbstractMinecartEntity: same moveOnRail). Derived from #6600's reference.
// (flat, ascending slope, curve, powered rail on/off); 20 seeds. Per-tick pos + velocity, exact doubles, via compareTraces.
// Reference = .decomp AbstractMinecartEntity.tick/moveOnRail/applyNaturalSlowdown/getMaxSpeed (0.4) + PoweredRailBlock, written here
// independently of src/07zzr_minecart.js (RailShape exit tables, snapPositionToRail, slope energy exchange, power boost, brake).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07zzq_rail.js', '07zzr_minecart.js', '07q_effects.js', '14f_inventory.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Behave.init(M.World); M.Entities.init(); M.EntityList.init();
const Mc = M.Minecart;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const seeds = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 60;
// vanilla ADJACENT_RAIL_POSITIONS_BY_SHAPE (first, second)
const EXITS = { east_west: [[-1, 0, 0], [1, 0, 0]], north_south: [[0, 0, -1], [0, 0, 1]], ascending_east: [[-1, -1, 0], [1, 0, 0]], ascending_west: [[-1, 0, 0], [1, -1, 0]], south_west: [[0, 0, 1], [-1, 0, 0]] };
const PULL = { ascending_east: [-1, 0], ascending_west: [1, 0] };
// layout: cells[x,y,z] = { shape, rail, powered }; lane 0 flat+powered, 1 slope up, 2 slope down, 3 curve
function layout(lane, r) {
  const cells = new Map(), put = (x, y, z, shape, rail = 'rail', powered = false) => cells.set(x + ',' + y + ',' + z, { shape, rail, powered });
  const solid = new Set(), pre = 2 + Math.floor(r() * 3), len = 2 + Math.floor(r() * 4);
  let start = [1.5, 0, 0.5];
  if (lane === 'powered') { const on = r() < 0.5; for (let x = 0; x < 20; x++) put(x, 0, 0, 'east_west', x >= pre && x < pre + len + 3 ? 'powered_rail' : 'rail', on); return { cells, solid, start, on }; }
  if (lane === 'up') { for (let x = 0; x < pre; x++) put(x, 0, 0, 'east_west'); for (let i = 0; i < len; i++) { put(pre + i, i, 0, 'ascending_east'); for (let y = 0; y <= i; y++) solid.add((pre + i) + ',' + (y - 1) + ',0'); } for (let x = pre + len; x < pre + len + 8; x++) put(x, len, 0, 'east_west'); }
  if (lane === 'down') { start = [1.5, len, 0.5]; for (let x = 0; x < pre; x++) put(x, len, 0, 'east_west'); for (let i = 0; i < len; i++) put(pre + i, len - 1 - i, 0, 'ascending_west'); for (let x = pre + len; x < pre + len + 8; x++) put(x, 0, 0, 'east_west'); }
  if (lane === 'curve') { for (let x = 0; x < pre + 2; x++) put(x, 0, 0, 'east_west'); put(pre + 2, 0, 0, 'south_west'); for (let z = 1; z < 12; z++) put(pre + 2, 0, z, 'north_south'); }
  return { cells, solid, start };
}
const speed0 = (r) => 0.1 + r() * 0.3;
function reference(L, v0, lane) {
  const e = { x: L.start[0], y: L.start[1], z: L.start[2], vx: v0, vy: 0, vz: 0 }, rows = [];
  const cell = (x, y, z) => L.cells.get(x + ',' + y + ',' + z);
  const cellOf = (e) => { const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z); return cell(bx, by - 1, bz) ? [bx, by - 1, bz] : [bx, by, bz]; };
  const snap = (x, y, z) => {
    const [bx, by, bz] = cellOf({ x, y, z }), c = cell(bx, by, bz); if (!c) return null;
    const [a, b] = EXITS[c.shape];
    const ax = bx + 0.5 + a[0] * 0.5, ay = by + 0.0625 + a[1] * 0.5, az = bz + 0.5 + a[2] * 0.5;
    const dx = bx + 0.5 + b[0] * 0.5 - ax, dy = (by + 0.0625 + b[1] * 0.5 - ay) * 2, dz = bz + 0.5 + b[2] * 0.5 - az;
    const t = dx === 0 ? z - bz : dz === 0 ? x - bx : ((x - ax) * dx + (z - az) * dz) * 2;
    let ny = ay + dy * t; if (dy < 0) ny += 1; else if (dy > 0) ny += 0.5;
    return { x: ax + dx * t, y: ny, z: az + dz * t };
  };
  const hl = () => Math.sqrt(e.vx * e.vx + e.vz * e.vz);
  const solidAt = (x, y, z) => L.solid.has(x + ',' + y + ',' + z);
  for (let t = 1; t <= TICKS; t++) {
    e.vy += -0.04;
    const [bx, by, bz] = cellOf(e), c = cell(bx, by, bz);
    if (c) {
      const s0 = snap(e.x, e.y, e.z);
      let y = by, boost = false, brake = false;
      if (c.rail === 'powered_rail') { boost = c.powered; brake = !c.powered; }
      let d = 0.0078125;
      const pu = PULL[c.shape]; if (pu) { e.vx += pu[0] * d; e.vz += pu[1] * d; y++; }
      const [a, b] = EXITS[c.shape];
      let dx = b[0] - a[0], dz = b[2] - a[2]; const len = Math.sqrt(dx * dx + dz * dz);
      if (e.vx * dx + e.vz * dz < 0) { dx = -dx; dz = -dz; }
      const sp = Math.min(2.0, hl()); e.vx = sp * dx / len; e.vz = sp * dz / len;
      if (brake) { if (hl() < 0.03) { e.vx = 0; e.vy = 0; e.vz = 0; } else { e.vx *= 0.5; e.vy *= 0; e.vz *= 0.5; } }
      const ax = bx + 0.5 + a[0] * 0.5, az = bz + 0.5 + a[2] * 0.5, cx = bx + 0.5 + b[0] * 0.5, cz = bz + 0.5 + b[2] * 0.5;
      dx = cx - ax; dz = cz - az;
      const k = dx === 0 ? e.z - bz : dz === 0 ? e.x - bx : ((e.x - ax) * dx + (e.z - az) * dz) * 2;
      e.x = ax + dx * k; e.z = az + dz * k; e.y = y;
      const cl = (v) => Math.max(-0.4, Math.min(0.4, v));
      e.x += cl(e.vx); e.z += cl(e.vz);
      if (a[1] !== 0 && Math.floor(e.x) - bx === a[0] && Math.floor(e.z) - bz === a[2]) e.y += a[1];
      else if (b[1] !== 0 && Math.floor(e.x) - bx === b[0] && Math.floor(e.z) - bz === b[2]) e.y += b[1];
      e.vx *= 0.96; e.vy = 0; e.vz *= 0.96;
      const s1 = snap(e.x, e.y, e.z);
      if (s0 && s1) { const h = hl(); if (h > 0) { const m = (h + (s0.y - s1.y) * 0.05) / h; e.vx *= m; e.vz *= m; } e.y = s1.y; }
      const nx = Math.floor(e.x), nz = Math.floor(e.z);
      if (nx !== bx || nz !== bz) { const h = hl(); e.vx = h * (nx - bx); e.vz = h * (nz - bz); }
      if (boost) {
        const h = hl();
        if (h > 0.01) { e.vx += e.vx / h * 0.06; e.vz += e.vz / h * 0.06; }
        else if (c.shape === 'east_west') { if (solidAt(bx - 1, by, bz)) e.vx = 0.02; else if (solidAt(bx + 1, by, bz)) e.vx = -0.02; }
      }
    } else { e.vx = Math.max(-0.4, Math.min(0.4, e.vx)); e.vz = Math.max(-0.4, Math.min(0.4, e.vz)); e.x += e.vx; e.y += e.vy; e.z += e.vz; e.vx *= 0.95; e.vy *= 0.95; e.vz *= 0.95; }
    rows.push({ tick: t, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz] });
  }
  return rows;
}
function engine(L, v0) {
  const S = M.States;
  const states = new Map();
  for (const [k, c] of L.cells) {
    let st = M.Behave.setProp(S.stateOf(c.rail), 'shape', c.shape);
    if (c.rail === 'powered_rail') st = M.Behave.setProp(st, 'powered', c.powered ? 'true' : 'false');
    states.set(k, st);
  }
  Mc.world = { getBlock: (x, y, z) => states.get(x + ',' + y + ',' + z) || (L.solid.has(x + ',' + y + ',' + z) ? S.stateOf('stone') : 0) };
  Mc.mover = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };
  M.EntityList.init(); M.Player = null;
  const e = M.EntityList.spawn('command_block_minecart', L.start[0], L.start[1], L.start[2]); e.silent = true; e.vx = v0; e.vy = 0; e.vz = 0;
  const rows = [];
  for (let n = 1; n <= TICKS; n++) { Mc.tick(e); rows.push({ tick: n, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz] }); }
  return rows;
}
const run = (lane, seed) => { const r = stream(seed * 7 + lane.length), L = layout(lane, r), v0 = speed0(r), R = reference(L, v0, lane); return { R, d: compareTraces(R, engine(L, v0), { fields: ['pos', 'vel'] }) }; };
for (const lane of ['powered', 'up', 'down', 'curve']) {
  const res = seeds.map((s) => ({ s, ...run(lane, s) }));
  ok(res.every((r) => !r.d), lane + ' lane: ' + res.filter((r) => r.d).slice(0, 3).map((r) => `seed ${r.s} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`));
  ok(res.every((r) => Math.abs(r.R[TICKS - 1].pos[0] - 1.5) > 0.1 || r.R[TICKS - 1].pos[2] > 0.6), lane + ' cart travels');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const any = (lanes) => lanes.some((l) => seeds.some((s) => run(l, s).d));
Mc.SLOWDOWN = 0.97; brk(any(['powered', 'up', 'curve']), 'slowdown 0.96 -> 0.97 is reported'); Mc.SLOWDOWN = 0.96;
Mc.SLOPE_PULL = 0.01; brk(any(['up', 'down']), 'slope boost 0.0078125 -> 0.01 is reported'); Mc.SLOPE_PULL = 0.0078125;
console.log(`commandblockminecartlockstepcheck: ${breaks + 8} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
