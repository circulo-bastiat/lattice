#!/usr/bin/env node
// lockstep-chest_minecart -- #5386 (G17-L4): the engine-side chest_minecart trace on a rail layout (straight, slope up/down, curve,
// powered on/off), 20 salts (0..19): per tick pos, velocity, yaw and the rail shape under the cart. Same salt = same trace, the cart
// moves, and compareTraces (tolerance never loosened) reports a 1e-9 drift in any field. The real-1.18.2-server side of the comparison
// is owed (cartscen/runcart place a plain 'minecart'; the chest_minecart summon + lockstep agent lane is not wired yet).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07zzq_rail.js', '07zzr_minecart.js', '07q_effects.js', '14f_inventory.js'];
const M = loadEngine({ extra: EXTRA, dom: false, initReg: true });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Behave.init(M.World); M.Entities.init(); M.EntityList.init();
const Mc = M.Minecart, S = M.States;
const TICKS = 60, SALTS = Array.from({ length: 20 }, (_, i) => i), F = ['pos', 'vel', 'yaw', 'shape'];
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const LANES = ['straight', 'up', 'down', 'curve', 'powered'];
function layout(lane, r) {
  const cells = new Map(), solid = new Set(), put = (x, y, z, shape, rail = 'rail', powered = false) => cells.set(x + ',' + y + ',' + z, { shape, rail, powered });
  const pre = 2 + Math.floor(r() * 3), len = 2 + Math.floor(r() * 4);
  let start = [1.5, 0, 0.5];
  if (lane === 'straight') for (let x = 0; x < 20; x++) put(x, 0, 0, 'east_west');
  if (lane === 'powered') { const on = r() < 0.5; for (let x = 0; x < 20; x++) put(x, 0, 0, 'east_west', x >= pre && x < pre + len + 3 ? 'powered_rail' : 'rail', on); }
  if (lane === 'up') { for (let x = 0; x < pre; x++) put(x, 0, 0, 'east_west'); for (let i = 0; i < len; i++) { put(pre + i, i, 0, 'ascending_east'); for (let y = 0; y <= i; y++) solid.add((pre + i) + ',' + (y - 1) + ',0'); } for (let x = pre + len; x < pre + len + 8; x++) put(x, len, 0, 'east_west'); }
  if (lane === 'down') { start = [1.5, len, 0.5]; for (let x = 0; x < pre; x++) put(x, len, 0, 'east_west'); for (let i = 0; i < len; i++) put(pre + i, len - 1 - i, 0, 'ascending_west'); for (let x = pre + len; x < pre + len + 8; x++) put(x, 0, 0, 'east_west'); }
  if (lane === 'curve') { for (let x = 0; x < pre + 2; x++) put(x, 0, 0, 'east_west'); put(pre + 2, 0, 0, 'south_west'); for (let z = 1; z < 12; z++) put(pre + 2, 0, z, 'north_south'); }
  return { cells, solid, start };
}
function engineTrace(salt) {
  const r = stream(salt), lane = LANES[salt % LANES.length], L = layout(lane, r), v0 = 0.1 + r() * 0.3;
  const states = new Map();
  for (const [k, c] of L.cells) {
    let st = M.Behave.setProp(S.stateOf(c.rail), 'shape', c.shape);
    if (c.rail === 'powered_rail') st = M.Behave.setProp(st, 'powered', c.powered ? 'true' : 'false');
    states.set(k, st);
  }
  Mc.world = { getBlock: (x, y, z) => states.get(x + ',' + y + ',' + z) || (L.solid.has(x + ',' + y + ',' + z) ? S.stateOf('stone') : 0) };
  Mc.mover = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };
  M.EntityList.init(); M.Player = null;
  const e = M.EntityList.spawn('chest_minecart', L.start[0], L.start[1], L.start[2]); e.silent = true; e.vx = v0; e.vy = 0; e.vz = 0;
  const rows = [];
  for (let n = 1; n <= TICKS; n++) {
    Mc.tick(e);
    const c = L.cells.get(Math.floor(e.x) + ',' + Math.floor(e.y) + ',' + Math.floor(e.z)) || L.cells.get(Math.floor(e.x) + ',' + (Math.floor(e.y) - 1) + ',' + Math.floor(e.z));
    rows.push({ tick: n, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz], yaw: e.yaw || 0, shape: c ? c.shape : 'none' });
  }
  return rows;
}
const traces = SALTS.map(engineTrace);
traces.forEach((R, i) => {
  const s = SALTS[i];
  ok(R.length === TICKS, `salt ${s}: ${R.length} rows`);
  ok(R.every((r) => r.pos.every(Number.isFinite) && r.vel.every(Number.isFinite) && Number.isFinite(r.yaw)), `salt ${s}: finite fields`);
  ok(Math.hypot(R[TICKS - 1].pos[0] - 1.5, R[TICKS - 1].pos[2] - 0.5) > 0.5, `salt ${s}: cart never travelled`);
  const d = compareTraces(R, engineTrace(s), { fields: F });
  ok(d === null, `salt ${s}: not repeatable: tick ${d?.tick} ${d?.field} ${d?.a} vs ${d?.b}`);
});
const mut = (f, fn) => traces[0].map((r, t) => (t === 30 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.field === 'pos', 'pos 1e-9');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0], v[1], v[2] + 1e-9]), { fields: F })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('shape', () => 'north_south'), { fields: F })?.field === 'shape', 'shape');
console.log(`${SALTS.length * 4 + 4} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${TICKS} ticks)`);
process.exit(bad ? 1 : 0);
