#!/usr/bin/env node
// bubblecolumncheck.mjs — G17-E1: BubbleColumnBlock / SoulSandBlock / MagmaBlock behaviour on a headless World.
//   node tools/bubblecolumncheck.mjs
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

console.log('bubblecolumncheck — soul sand / magma grow and clear bubble columns');
const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js'] });
const S = M.States, B = M.Behave, R = M.Reg;
const SAND = S.stateOf('soul_sand'), MAGMA = S.stateOf('magma_block'), WATER = S.stateOf('water'), STONE = S.stateOf('stone');
const DRAG = S.withLocal('bubble_column', 0), NODRAG = S.withLocal('bubble_column', 1);
const FLOW = S.withLocal('water', 1);
const w = B.w;

function build(base, top, flowAt) {
  const mem = new Map();
  B.init({
    getBlock: (x, y, z) => mem.get(x + ',' + y + ',' + z) || 0,
    setBlock: (x, y, z, s) => { const old = mem.get(x + ',' + y + ',' + z) || 0; if (old === s) return false; mem.set(x + ',' + y + ',' + z, s); B.changed(x, y, z, old); return true; },
  });
  B.clearSchedule();
  w.set(0, 10, 0, base);
  for (let y = 11; y <= top; y++) w.set(0, y, 0, y === flowAt ? FLOW : WATER);
  return mem;
}
function run(n, opt) { for (let i = 0; i < n; i++) { B.tick(); } }

function scenario(delaySand, dragWant, baseSt, flowAt, expectTopY, label, ticks) {
  build(baseSt, 14, flowAt);
  run(ticks);
  const got = [11, 12, 13, 14].map((y) => w.get(0, y, 0));
  return got;
}
const sameAs = (a, st) => a.every((v) => v === st);

function suite(tag, ticks, off) {
  let g = scenario(0, 0, SAND, 0, 0, '', ticks);
  ok(sameAs(g, NODRAG), tag + ': soul sand makes drag=false column to the surface');
  g = scenario(0, 0, MAGMA, 0, 0, '', ticks);
  ok(sameAs(g, DRAG), tag + ': magma makes drag=true column');
  build(SAND, 14, 0); run(ticks);
  w.set(0, 10, 0, STONE); run(6);
  ok(sameAs([11, 12, 13, 14].map((y) => w.get(0, y, 0)), WATER), tag + ': removing the base clears the column');
  g = scenario(0, 0, SAND, 13, 0, '', ticks);
  ok(g[0] === NODRAG && g[1] === NODRAG && g[2] !== NODRAG && g[3] !== NODRAG, tag + ': flowing water stops the column');
}
suite('real', 30);

// ── G17-E2: entities in a column (Use.entityCollide -> BubbleColumnBlock.onEntityCollision) ──
const E = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '14b_physics.js', '14l_use.js'], dom: false });
const eS = E.States, eB = E.Behave, eU = E.Use;
const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
const eW = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock: (x, y, z, s) => { cells.set(k(x, y, z), s); return true; } };
E.World = eW; eB.init(eW); eU.init(eW);
let column = function(drag, airAbove) {
  cells.clear();
  const st = eS.withLocal('bubble_column', drag ? 0 : 1);
  cells.set(k(0, 10, 0), st);
  cells.set(k(0, 11, 0), airAbove ? 0 : eS.stateOf('water'));
  return st;
};
// a pig-like entity and a player-like one: only x/y/z/size/vy/fallDistance are read
function mk(vy) { return { x: 0.5, y: 10.1, z: 0.5, width: 0.4, height: 0.4, vx: 0, vy, vz: 0, fallDistance: 5 }; }
function sim(drag, air, n, start) {
  column(drag, air); const e = mk(start || 0);
  for (let i = 0; i < n; i++) eU.entityCollide(e);
  return e;
}
function entitySuite(tag) {
  let e = sim(false, false, 40);
  ok(Math.abs(e.vy - 0.7) < 1e-9, tag + ': inside an up column vy reaches the 0.7 cap (got ' + e.vy + ')');
  ok(e.fallDistance === 0, tag + ': inside the column fallDistance is zeroed');
  e = sim(true, false, 40);
  ok(Math.abs(e.vy + 0.3) < 1e-9, tag + ': inside a drag column vy sinks to the -0.3 floor (got ' + e.vy + ')');
  e = sim(false, false, 3);
  ok(Math.abs(e.vy - 0.18) < 1e-9, tag + ': up column adds 0.06 per tick');
  e = sim(false, true, 40);
  ok(Math.abs(e.vy - 1.8) < 1e-9, tag + ': at the surface vy reaches the 1.8 cap (got ' + e.vy + ')');
  ok(e.fallDistance === 5, tag + ': the surface branch does not touch fallDistance');
  e = sim(true, true, 40);
  ok(Math.abs(e.vy + 0.9) < 1e-9, tag + ': at the surface a drag column sinks to -0.9 (got ' + e.vy + ')');
}
entitySuite('entity');
const nTrue = fails.length;
for (const f of fails) console.log('   ✗ ' + f);
if (fails.length) process.exit(1);
// anti-vacuity: re-run broken variants and assert each is noticed
const real = { sched: B.schedule, upd: B.bubbleUpdate };
function broken(name, patch) {
  const f0 = fails.length; patch();
  suite('break:' + name, 30);
  const caught = fails.length > f0;
  fails.length = f0; B.schedule = real.sched; B.bubbleUpdate = real.upd;
  breaks++; if (caught) pass++; else fails.push('break not caught: ' + name);
}
const realCollide = eU.entityCollide, realColumn = column;
function brokenE(name, patch) {
  const f0 = fails.length; patch(); entitySuite('break:' + name);
  const caught = fails.length > f0; fails.length = f0; eU.entityCollide = realCollide; column = realColumn;
  breaks++; if (caught) pass++; else fails.push('break not caught: ' + name);
}
// the breaks re-run the real collide against a tampered world/entity: flip drag, flip surface/inside, bad clamp
brokenE('drag sign', () => { const o = column; column = (d, a) => o(!d, a); });
brokenE('surface/inside', () => { const o = column; column = (d, a) => o(d, !a); });
brokenE('clamp', () => { eU.entityCollide = (e) => { realCollide(e); e.vy = Math.min(e.vy, 0.5); }; });
broken('drag flag', () => { const u = real.upd; B.bubbleUpdate = (x, y, z, b) => u(x, y, z, b === SAND ? MAGMA : b === MAGMA ? SAND : b); });
broken('delay', () => { const s = real.sched; B.schedule = (x, y, z, d, p) => s(x, y, z, 200, p); });
broken('base test', () => { B.bubbleUpdate = (x, y, z, b) => real.upd(x, y, z, SAND); });
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${pass} checks, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
