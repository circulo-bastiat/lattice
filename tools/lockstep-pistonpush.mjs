#!/usr/bin/env node
// lockstep-pistonpush.mjs -- #6711 (G17-L115): lockstep scenario 'pistonpush'. A real piston (lever, block events, PistonBlockEntity ticks) extends
// east, shoving a stone / slime / honey block with a cow, a zombie, an item and a player body in the way, on top of it and beside it. 20 seeds vary
// the start offsets. Every tick the entity pos and velocity are compared with an independent transcription of PistonBlockEntity.pushEntities +
// moveEntitiesInHoneyBlock + Entity.adjustMovementForPiston (.decomp PistonBlockEntity.java, Entity.java): stretch the moved shape by the progress
// delta, move by min(overlap,delta)+0.01, slime sets the axis velocity (never a player), honey drags onGround entities on its top, 0.51 per axis per tick.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = 20, TICKS = 6;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const BLOCKS = ['stone', 'slime_block', 'honey_block'];

function scen(seed) {
  const r = rng(seed * 104729 + 3), blk = BLOCKS[seed % 3];
  const mk = (type, w, h, y, onGround) => ({ type, x: 1.1 + r() * 1.6, y, z: 0.15 + r() * 0.7, width: w, height: h, vx: 0, vy: 0, vz: 0, onGround });
  const top = blk === 'honey_block' ? 0.9375 : 1;
  const ents = [mk('cow', 0.9, 1.4, 0, true), mk('zombie', 0.6, 1.95, seed % 2 ? top : 0, true), mk('item', 0.25, 0.25, 0, true)];
  const player = mk('player', 0.6, 1.8, seed % 4 ? top : 0, true);
  ents[0].z = 0.5 + (r() - 0.5) * 0.2;   // keep one entity squarely on the line
  return { blk, ents, player };
}
const clone = (s) => ({ blk: s.blk, ents: s.ents.map((e) => ({ ...e })), player: { ...s.player } });
const snap = (s) => [...s.ents, s.player].map((e) => [e.x, e.y, e.z, e.vx, e.vy, e.vz].map((v) => +v.toFixed(9)).join(',')).join('|');

function engine(s, clampPatch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07g_piston.js'], dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const N = 64, MID = 32, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const w = { get: (x, y, z) => cells[idx(x, y, z)], set: (x, y, z, v) => { cells[idx(x, y, z)] = v; } };
  w.getBlock = w.get; w.setBlock = w.set;
  const S = M.States, B = M.Behave, P = M.Piston, BE = M.BlockEntities;
  M.Behave.init(w); BE.init(); M.Redstone.init(); P.init();
  if (clampPatch) P.PISTON_CLAMP = clampPatch;
  const put = (x, y, z, n, props) => { let st = S.stateOf(n); for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]); w.set(x, y, z, st); M.Redstone.update(x, y, z); };
  for (let x = -3; x <= 6; x++) for (let z = -2; z <= 3; z++) w.set(x, -1, z, S.stateOf('stone'));
  put(0, 0, 0, 'piston', { facing: 'east', extended: 'false' });
  put(1, 0, 0, s.blk);
  put(-1, 0, 0, 'lever', { face: 'floor', facing: 'east', powered: 'false' });
  M.Physics.move = (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; };
  M.EntityList = { list: s.ents }; M.Player = s.player;
  const calls = [], real = P.pushEntities;
  P.pushEntities = function (x, y, z, e, np) {
    calls.push({ t, name: M.Reg.names[S.block[e.movedState]], prev: e.progress, np, ext: e.extending, dir: e.dir, x, y, z });
    return real.apply(P, arguments);
  };
  let t = 0; const rows = [];
  M.Redstone.setPowered(-1, 0, 0, true);
  for (t = 0; t < TICKS; t++) { B.gameTime = t; B.tick(); BE.tick(); rows.push(snap(s)); }
  return { rows, calls };
}

const hit = (a, b) => a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];
const ebox = (e) => [e.x - e.width / 2, e.y, e.z - e.width / 2, e.x + e.width / 2, e.y + e.height, e.z + e.width / 2];
function shapeOf(name) {
  if (name === 'honey_block') return [[1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16]];
  if (name === 'piston_head') return [[0.75, 0, 0, 1, 1, 1], [0, 0.375, 0.375, 0.75, 0.625, 0.625]];
  return [[0, 0, 0, 1, 1, 1]];
}
function oracle(s, calls, o = {}) {
  const rows = [], all = [...s.ents, s.player], CL = o.clamp || 0.51;
  let run = new Map();
  const shove = (e, d) => {   // Entity.move(PISTON) along +x: the per-tick running total is clamped
    const tot = Math.max(-CL, Math.min(CL, d + (run.get(e) || 0))), r = tot - (run.get(e) || 0);
    run.set(e, tot); if (Math.abs(r) > 1e-5) e.x += r;
  };
  const byTick = [];
  for (const c of calls) (byTick[c.t] = byTick[c.t] || []).push(c);
  for (let k = 0; k < TICKS; k++) {
    run = new Map();
    for (const c of byTick[k] || []) {
      const delta = c.np - c.prev, shapes = shapeOf(c.name);   // = c.prev-1 before; head moves with np
      const at = (sh, p) => [sh[0] + c.x + p - 1, sh[1] + c.y, sh[2] + c.z, sh[3] + c.x + p - 1, sh[4] + c.y, sh[5] + c.z];
      const str = (b) => [b[0], b[1], b[2], b[3] + delta, b[4], b[5]];
      for (const e of all) {
        const eb = ebox(e), sx = shapes.map((sh) => str(at(sh, c.prev)));
        const hb = at([Math.min(...shapes.map((a) => a[0])), Math.min(...shapes.map((a) => a[1])), Math.min(...shapes.map((a) => a[2])),
                       Math.max(...shapes.map((a) => a[3])), Math.max(...shapes.map((a) => a[4])), Math.max(...shapes.map((a) => a[5]))], c.prev);
        const area = [hb[0], hb[1], hb[2], hb[3] + delta, hb[4], hb[5]];
        if (!hit(area, eb)) continue;
        if (c.name === 'slime_block') { if (e === s.player) continue; e.vx = 1; }   // a ServerPlayerEntity is skipped entirely
        let best = 0;
        for (const b of sx) if (hit(b, eb)) { best = Math.max(best, b[3] - eb[0]); if (best >= delta) break; }
        if (best > 0) shove(e, Math.min(best, delta) + 0.01);
      }
      if (c.name === 'honey_block') {
        const hb = [c.x + c.prev - 1, c.y + 15 / 16, c.z, c.x + c.prev, c.y + 1.5000000999999998, c.z + 1];
        for (const e of all) if (e.onGround && e.x >= hb[0] && e.x <= hb[3] && e.z >= hb[2] && e.z <= hb[5] && hit(hb, ebox(e))) shove(e, delta);
      }
    }
    rows.push(snap(s));
  }
  return rows;
}
function run(o = {}) {
  let bad = 0, first = '', moved = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = engine(clone(scen(seed)), o.engineClamp), sc = clone(scen(seed));
    const b = oracle(sc, a.calls, o);
    if (a.rows[TICKS - 1] !== snap(clone(scen(seed)))) moved++;
    for (let i = 0; i < TICKS; i++) if (a.rows[i] !== b[i]) { bad++; if (!first) first = `seed ${seed} tick ${i}: engine ${a.rows[i]} oracle ${b[i]}`; break; }
  }
  return { bad, first, moved };
}
let fails = 0, breaks = 0; const notes = [];
const base = run();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
if (base.moved < SEEDS / 2) { fails++; console.log(`  FAIL vacuous: only ${base.moved} seeds moved anything`); }
for (const [name, o] of [['oracle clamp 0.5', { clamp: 0.5 }], ['engine clamp 0.5', { engineClamp: 0.5 }]]) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${3 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
