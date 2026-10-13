#!/usr/bin/env node
// redrefcheck.mjs — infra I6 (24 Sept 2026): REDSTONE TIMING, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/runredstone.mjs     # once per machine/store (~1 min, the real server)
//   node tools/referee/redrefcheck.mjs [--verbose]
//
// Each scenario of redstonescen.mjs (repeaters 1-4 + pulse extension, a repeater chain, comparators, torch
// inverters, lamps, an observer, normal/sticky pistons held and 1-tick-pulsed) is built in the engine on a stone
// floor, settled like the server's 30 idle ticks, then run on the SAME clock as the server's tick function:
// toggles for tick k -> sample every probe -> one world tick (Behave.tick = scheduled ticks, then
// BlockEntities.tick = the moving piston, as Main.worldTick orders them). Every probe's 40-tick 0/1 timeline must
// equal the server's EXACTLY -- a tick early or late is a different circuit.
// Anti-vacuity (D-30/D-305): three breaks -- a golden timeline shifted one tick, the engine's scheduler forced to
// delay 1, and the lamp's turn-off tick removed -- must each turn a comparison red. Every golden probe must
// change at least once (a probe that never changes on the server proves nothing). No golden -> SKIP, exit 0.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T } from './redstonescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'redstone-timing.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'redstone-timing.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('redrefcheck: SKIP (golden not generated -- run node tools/referee/runredstone.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const ROOT = MCLITE_ROOT;
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07g_piston.js'];

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

/** Run one scenario in a fresh engine; returns { label: '0101..' }. `hook(M)` may break the engine. */
function runEngine(sc, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const N = 32, MID = 16;
  const cells = new Uint16Array(N * N * N);
  const inside = (x, y, z) => x + MID >= 0 && x + MID < N && y + MID >= 0 && y + MID < N && z + MID >= 0 && z + MID < N;
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const w = { get: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0), set: (x, y, z, s) => { if (inside(x, y, z)) cells[idx(x, y, z)] = s; } };
  w.getBlock = w.get; w.setBlock = w.set;
  w.getLight = () => 15 << 4;
  M.Behave.init(w);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.Redstone.init();
  if (M.Piston && M.Piston.init) M.Piston.init();
  const S = M.States, B = M.Behave, BE = M.BlockEntities;
  if (hook) hook(M);
  const state = (name, props) => {
    let st = S.stateOf(name);
    if (!st) throw new Error('no state ' + name);
    for (const [k, v] of Object.entries(props || {})) if (v !== null && v !== undefined) st = B.setProp(st, k, v);
    return st;
  };
  // setblock: write, then the neighbour update every placement funnels through (Behave.changed)
  const setblock = (x, y, z, st) => { w.set(x, y, z, st); B.changed(x, y, z); };
  const tick = () => { B.tick(); if (BE && BE.tick) BE.tick(); };
  for (let x = -1; x <= 8; x++) for (let z = -2; z <= 2; z++) w.set(x, -1, z, S.stateOf('stone'));
  for (const [x, y, z, name, props] of sc.blocks) setblock(x, y, z, state(name, props));
  for (let i = 0; i < 30; i++) tick();
  const nameAt = (x, y, z) => { const st = w.get(x, y, z); return st === 0 ? 'air' : M.Reg.names[S.block[st]]; };
  const out = {};
  for (const p of sc.probes) out[p[0]] = '';
  for (let k = 1; k <= T; k++) {
    for (const [t, v] of sc.events) if (t === k) setblock(0, 0, 0, v ? S.stateOf('redstone_block') : 0);
    for (const [label, x, y, z, name, prop, val] of sc.probes) {
      const hit = nameAt(x, y, z) === name && (!prop || B.propName(w.get(x, y, z), prop) === val);
      out[label] += hit ? '1' : '0';
    }
    tick();
  }
  return out;
}

const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };

function compare(id, van, eng) {
  const bad = [];
  for (const [label, g] of Object.entries(van)) {
    const e = eng[label];
    if (e !== g) bad.push(`${id}.${label}: first differs at tick ${firstDiff(g, e || '')}\n        server ${g}\n        engine ${e}`);
  }
  return bad;
}

console.log(`redrefcheck — redstone timing vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = scenario T ${T} (regenerate the golden after editing redstonescen.mjs)`);
const results = {};
let nScen = 0;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!ok(!!g, `${sc.id}: in the golden (regenerate: node tools/referee/runredstone.mjs)`)) continue;
  for (const [label, bits] of Object.entries(g.probes)) {
    ok(bits.length === T && /0/.test(bits) && /1/.test(bits), `${sc.id}.${label}: the server's timeline changes at least once (${bits})`);
  }
  let eng;
  try { eng = runEngine(sc); } catch (e) { ok(false, `${sc.id}: engine threw ${e.message}`); continue; }
  results[sc.id] = eng;
  const bad = compare(sc.id, g.probes, eng);
  for (const b of bad) ok(false, b);
  if (!bad.length) pass++;
  nScen++;
  if (VERBOSE) for (const [l, b] of Object.entries(eng)) console.log(`   ${sc.id}.${l}\n     S ${g.probes[l]}\n     E ${b}`);
}

// ── anti-vacuity ─────────────────────────────────────────────────────────────────────────────
const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
{
  // 1. a golden timeline shifted one tick later
  const sc = SCENARIOS.find((s) => s.id === 'repeater_d2');
  const g = golden.cases[sc.id].probes;
  const shifted = { ...g, rep: '0' + g.rep.slice(0, -1) };
  breakCaught('repeater_d2 golden shifted one tick is a mismatch', compare(sc.id, shifted, runEngine(sc)).length > 0);
}
{
  // 2. every scheduled tick forced to delay 1 (a repeater that ignores its delay)
  const sc = SCENARIOS.find((s) => s.id === 'repeater_d4');
  const eng = runEngine(sc, (M) => { const real = M.Behave.schedule; M.Behave.schedule = (x, y, z, d, p) => real(x, y, z, 1, p); });
  breakCaught('scheduler forced to delay 1 breaks repeater_d4', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}
{
  // 3. the lamp turns off at once (no 4-tick scheduled turn-off)
  const sc = SCENARIOS.find((s) => s.id === 'lamp_direct');
  const eng = runEngine(sc);
  eng.lamp = eng.lamp.replace(/1+/, (m) => m.slice(0, Math.max(1, m.length - 4)).padEnd(m.length, '0'));
  breakCaught('a lamp without its turn-off delay is a mismatch', compare(sc.id, golden.cases[sc.id].probes, eng).length > 0);
}

console.log(`redrefcheck: ${nScen} scenarios compared, ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
