#!/usr/bin/env node
// tntrefcheck.mjs — infra I6 (25 Sept 2026): TNT vs the real 1.18.2 server (golden: runtnt.mjs, tnt.json; scenes: tntscen.mjs).
//
// Part A (blast shape): per case the engine rebuilds the scene in a fresh cell map, spawns a `tnt` entity (EL.spawn,
// fuse 1) at the cell's x+0.5,y,z+0.5 and runs ONE `EL.tick` (-> Tnt.tick -> Tnt.explode -> Explosion.explode, the real
// join), then reads the same (2R+1)^3 box and sums the dropped item entities' counts. ENGINE_N trials. Compared:
//   - per-cell destruction RATE (two-proportion z, pooled variance, |z| > 5 red; a cell both sides never/always break is exact)
//   - mean destroyed-cell count and mean dropped items (Welch, 4 SE; a constant golden must be matched exactly)
// Part B (fuse timeline): 40 stations primed at tick 1 by a redstone block (Behave.changed -> Rs.updateTnt -> Use.primeTnt),
// ticked as the redstone pack does (events, sample, Behave.tick + EL.tick). Compared: station 0's first-blast tick (exact),
// the chained TNT's delay support/mean (10..29 = random(80/4) + 80/8), and station 0's entity Y per tick (x1000, +-2).
// Anti-vacuity (D-30/D-305): power 4 -> 3.5, the chained fuse +5, and a golden cell rate flipped are each caught.
// Mismatches are FINDINGS (red lines, exit 1), not something to fix here. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { R, ENGINE_N, BLAST, S, T, STATION, blastScene, readCells } from './tntscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'tnt.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'tnt.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('tntrefcheck: SKIP (golden not generated -- run node tools/referee/runtnt.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
  '14b_physics.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '07d_mining.js', '07e_loot.js', '14l_use.js',
  '07za_explosion.js', '07zc_tnt.js'];

let seed = 0x7a7a1234;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function makeEngine(hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4; w.clear = () => cells.clear();
  M.World = w;
  M.Behave.init(w);
  M.BlockEntities.init();
  M.Redstone.init();
  M.Entities.init();
  M.EntityList.init();
  M.Use.init(w);
  M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
  M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
  M.Explosion.init();
  M.Tnt.init();
  M.EntityList.random = rng;
  const realRandom = Math.random;
  Math.random = rng;                      // Explosion's rays and the chain fuse default to Math.random: seed them (reproducible reds)
  if (hook) hook(M);
  return { M, w, restore: () => { Math.random = realRandom; } };
}

function engineBlast(c, n, hook) {
  const { M, w, restore } = makeEngine(hook);
  const S_ = M.States, EL = M.EntityList;
  const scene = blastScene(c).map(([x, y, z, b]) => [x, y, z, S_.stateOf(b)]);
  for (const [, , , st] of scene) if (!st) throw new Error(`${c.id}: no engine state for a scene block`);
  const box = readCells();
  const air = new Array(box.length).fill(0), destroyed = [], items = [];
  for (let t = 0; t < n; t++) {
    w.clear(); EL.list.length = 0;
    for (const [x, y, z, st] of scene) w.set(x, y, z, st);
    const e = EL.spawn('tnt', 0.5, 0, 0.5, { fuse: 1 });
    if (!e) { restore(); return { err: 'EL.spawn(tnt) returned null' }; }
    e.vx = e.vy = e.vz = 0; e.noGravity = true;
    EL.tick();
    let a = 0;
    box.forEach(([x, y, z], i) => { if (w.get(x, y, z) === 0) { air[i]++; a++; } });
    destroyed.push(a);
    items.push(EL.list.filter((o) => !o.removed && o.type === 'item').reduce((s, o) => s + (o.count | 0), 0));
  }
  restore();
  return { air, destroyed, items, trials: n };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const vari = (a) => { const m = mean(a); return a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1); };
function compareBlast(id, g, e) {
  const bad = [], box = readCells();
  const nG = g.trials, nE = e.trials;
  let cellReds = 0; const worst = [];
  for (let i = 0; i < box.length; i++) {
    const pg = g.air[i] / nG, pe = e.air[i] / nE;
    if ((pg === 0 || pg === 1) && pg === pe) continue;
    const p = (g.air[i] + e.air[i]) / (nG + nE);
    const se = Math.sqrt(p * (1 - p) * (1 / nG + 1 / nE));
    const z = se > 0 ? (pe - pg) / se : (pe === pg ? 0 : Infinity);
    if (Math.abs(z) > 5) { cellReds++; worst.push([Math.abs(z), `(${box[i].join(',')}) server ${pg.toFixed(2)} engine ${pe.toFixed(2)}`]); }
  }
  if (cellReds) { worst.sort((a, b) => b[0] - a[0]); bad.push(`${id}: ${cellReds}/${box.length} cells break at a different rate (worst ${worst.slice(0, 3).map((w) => w[1]).join('; ')})`); }
  for (const [what, gv, ev] of [['destroyed cells', g.destroyed, e.destroyed], ['dropped items', g.items, e.items]]) {
    const mg = mean(gv), me = mean(ev);
    if (Math.min(...gv) === Math.max(...gv)) { if (ev.some((x) => x !== gv[0])) bad.push(`${id}: ${what} server always ${gv[0]}, engine mean ${me.toFixed(1)} [${Math.min(...ev)}..${Math.max(...ev)}]`); continue; }
    const se = Math.sqrt(vari(gv) / gv.length + vari(ev) / ev.length);
    if (Math.abs(me - mg) > 4 * se) bad.push(`${id}: ${what} mean server ${mg.toFixed(1)} engine ${me.toFixed(1)} (4 SE = ${(4 * se).toFixed(1)})`);
  }
  return bad;
}

function engineFuse(hook) {
  const { M, w, restore } = makeEngine(hook);
  const S_ = M.States, B = M.Behave, EL = M.EntityList;
  const BX = (k) => k * 16, BY = 0;
  const setblock = (x, y, z, name) => { w.set(x, y, z, name === 'air' ? 0 : S_.stateOf(name)); B.changed(x, y, z); };
  for (let k = 0; k < S; k++) for (let x = BX(k) - 8; x < BX(k) + 8; x++) for (let z = -8; z <= 8; z++) w.set(x, BY - 1, z, S_.stateOf('grass_block'));
  for (let k = 0; k < S; k++) { setblock(BX(k), BY, 0, 'tnt'); setblock(BX(k) + STATION.second[0], BY, STATION.second[2], 'tnt'); }
  for (let i = 0; i < 5; i++) { B.tick(); EL.tick(); }
  const probes = {};
  for (let k = 0; k < S; k++) { probes[`s${k}.n`] = []; probes[`s${k}.b2`] = []; }
  probes['s0.y'] = [];
  const tntId = M.Reg.id.tnt;
  for (let t = 1; t <= T; t++) {
    if (t === 1) for (let k = 0; k < S; k++) setblock(BX(k) + STATION.power[0], BY, STATION.power[2], 'redstone_block');
    for (let k = 0; k < S; k++) {
      const x0 = BX(k);
      probes[`s${k}.n`].push(EL.list.some((o) => !o.removed && o.type === 'tnt' && o.x >= x0 - 4 && o.x < x0 + 8) ? 1 : 0);
      const st = w.get(x0 + STATION.second[0], BY, STATION.second[2]);
      probes[`s${k}.b2`].push(st && S_.block[st] === tntId ? 1 : 0);
    }
    const e0 = EL.list.find((o) => !o.removed && o.type === 'tnt' && Math.abs(o.x - 0.5) < 3);
    probes['s0.y'].push(e0 ? Math.floor((e0.y - 60) * 1000) : 0);   // the server's stations stand at y -60
    B.tick(); EL.tick();
  }
  restore();
  return probes;
}

function delays(p) {
  const out = [];
  for (let k = 0; k < S; k++) { const n = p[`s${k}.n`], b2 = p[`s${k}.b2`]; const t1 = b2.indexOf(0); out.push(t1 < 0 ? -1 : n.lastIndexOf(1) + 1 - t1); }
  return out;
}
function compareFuse(g, e) {
  const bad = [];
  const g1 = g['s0.b2'].indexOf(0), e1 = e['s0.b2'].indexOf(0);
  if (g1 !== e1) bad.push(`fuse: the redstone-primed TNT explodes at sample ${g1} on the server, ${e1} in the engine (-1 = never)`);
  const dg = delays(g), de = delays(e);
  const sg = [...new Set(dg)].sort((a, b) => a - b), se_ = [...new Set(de)].sort((a, b) => a - b);
  if (Math.min(...de) < Math.min(...dg) || Math.max(...de) > Math.max(...dg) || de.includes(-1)) bad.push(`fuse: chained TNT delay server ${sg[0]}..${sg[sg.length - 1]}, engine ${se_[0]}..${se_[se_.length - 1]}`);
  const s = Math.sqrt(vari(dg) / dg.length + vari(de) / de.length);
  if (Math.abs(mean(de) - mean(dg)) > 4 * s) bad.push(`fuse: chained delay mean server ${mean(dg).toFixed(1)} engine ${mean(de).toFixed(1)}`);
  const yg = g['s0.y'], ye = e['s0.y'];
  // only the LIT TNT's own flight (samples before the first blast): the server probe's `distance=..3` also reaches the
  // chained TNT 3 blocks away, drifting in and out of that sphere, so later samples are not one entity's path.
  const i = yg.findIndex((v, k) => k < g1 && Math.abs(v - ye[k]) > 2);
  if (i >= 0) bad.push(`fuse: station 0 entity y(x1000) first differs at sample ${i}: server ${yg.slice(i, i + 6).join(',')} | engine ${ye.slice(i, i + 6).join(',')}`);
  return bad;
}

const reds = [];
let pass = 0;
console.log(`tntrefcheck — TNT vs the real 1.18.2 server (${Object.keys(golden.blast || {}).length} blast cases, ${golden.fuse && golden.fuse.S} fuse stations, ${golden.generatedAt})`);
const engBlast = {};
for (const c of BLAST) {
  const g = golden.blast && golden.blast[c.id];
  if (!g) { reds.push(`${c.id}: no golden case (re-run runtnt.mjs)`); continue; }
  const e = engineBlast(c, ENGINE_N);
  if (e.err) { reds.push(`${c.id}: ${e.err}`); continue; }
  engBlast[c.id] = e;
  const bad = compareBlast(c.id, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${c.id.padEnd(16)} destroyed server ${mean(g.destroyed).toFixed(1)} engine ${mean(e.destroyed).toFixed(1)} · items server ${mean(g.items).toFixed(1)} engine ${mean(e.items).toFixed(1)}`);
}
let engF = null;
if (golden.fuse && golden.fuse.probes) {
  engF = engineFuse();
  const bad = compareFuse(golden.fuse.probes, engF);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  fuse: server delays ${delays(golden.fuse.probes).join(',')}\n        engine delays ${delays(engF).join(',')}`);
} else reds.push('fuse: no golden part B');

// anti-vacuity: each break must turn a green comparison red (or add reds to an already-red one)
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ const c = BLAST.find((b) => b.id === 'cube:stone');
  const e = engineBlast(c, ENGINE_N, (M) => { const f = M.Explosion.explode; M.Explosion.explode = (s, x, y, z, p, g, r) => f(s, x, y, z, p * 0.875, g, r); });
  const base = compareBlast(c.id, golden.blast[c.id], engBlast[c.id]).length;
  brk('explosion power 4 -> 3.5', !e.err && compareBlast(c.id, golden.blast[c.id], e).length > base || !!e.err); }
if (engF) {
  const shifted = JSON.parse(JSON.stringify(engF));
  for (let k = 0; k < S; k++) { const n = shifted[`s${k}.n`], last = n.lastIndexOf(1); for (let j = last + 1; j < Math.min(T, last + 6); j++) n[j] = 1; }
  brk('chained fuse +5', compareFuse(golden.fuse.probes, shifted).length > compareFuse(golden.fuse.probes, engF).length); }
{ const c = BLAST.find((b) => b.id === 'cube:dirt');
  const g = JSON.parse(JSON.stringify(golden.blast[c.id]));
  const box = readCells(); const i = box.findIndex(([x, y, z]) => x === 1 && y === 0 && z === 0);
  g.air[i] = g.air[i] > g.trials / 2 ? 0 : g.trials;
  brk('golden cell (1,0,0) flipped', compareBlast(c.id, g, engBlast[c.id]).join('|').length > compareBlast(c.id, golden.blast[c.id], engBlast[c.id]).join('|').length); }

for (const r of reds) console.log('  ✗ ' + r);
console.log(`tntrefcheck: ${pass} green comparison(s), ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
