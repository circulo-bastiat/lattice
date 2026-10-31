#!/usr/bin/env node
// netherstructcheck.mjs — #259: the Nether structure rows (04r registry) and what the Nether actually produces.
// Fortress: every piece family of NetherFortressGenerator appears across starts. Bastion / fossil: the rows
// are registered, Nether-gated, at the right generation step. Nothing but nether structures start in the Nether.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures;
const NEED = ['Start', 'BridgePlatform', 'BridgeCrossing', 'Bridge', 'BridgeSmallCrossing', 'BridgeStairs', 'BridgeEnd',
  'CorridorExit', 'CorridorLeftTurn', 'SmallCorridor', 'CorridorCrossing', 'CorridorRightTurn',
  'CorridorNetherWartsRoom', 'CorridorBalcony', 'CorridorStairs'];
const ALLOWED = ['fortress', 'bastion_remnant', 'nether_fossil'];

function run(tag) {
  M.Dim.cur = 'the_nether';
  const kinds = new Set(), names = new Set();
  for (let cz = -160; cz <= 160; cz += 8) for (let cx = -160; cx <= 160; cx += 8)
    for (const s of ST.startsNear(cx, cz)) { names.add(s.def.name); for (const p of s.pieces) kinds.add(p.kind); }
  M.Dim.cur = 'overworld';
  for (const k of NEED) ok(kinds.has(k), tag + 'fortress piece kind never produced: ' + k);
  for (const n of names) ok(ALLOWED.includes(n), tag + 'non-nether structure started in the Nether: ' + n);
  ok(names.has('fortress'), tag + 'no fortress start in the Nether');
  const d = ST.defs;
  for (const n of ALLOWED) ok(d[n] && d[n].dim === 'the_nether', tag + n + ' row missing or not Nether-gated');
  ok(d.nether_fossil && d.nether_fossil.step === ST.STEP_OF.nether_fossil, tag + 'nether_fossil step');
  ok(d.fortress && d.fortress.step === ST.STEP_OF.fortress, tag + 'fortress step');
  M.Dim.cur = 'overworld';
  let ow = 0;
  for (let cz = -80; cz <= 80; cz += 8) for (let cx = -80; cx <= 80; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (ALLOWED.includes(s.def.name)) ow++;
  ok(ow === 0, tag + 'nether structure started in the overworld: ' + ow);
}
run('');
let caught = 0;
function breakIt(name, mut, restore) {
  const before = fails.length; mut();
  try { run('[' + name + '] '); } catch (e) { fails.push('x'); }
  restore();
  if (fails.length > before) { caught++; fails.length = before; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
}
const dimSave = ST.sets.map((s) => s.dim);
breakIt('sets ungated', () => ST.sets.forEach((s) => { s.dim = 'overworld'; }), () => ST.sets.forEach((s, i) => { s.dim = dimSave[i]; }));
const g = ST.defs.fortress.grammar, ex = g.expand;
breakIt('bridge pieces dropped', () => { g.expand = (st, r) => ex(st, r).filter((p) => p.kind !== 'BridgeStairs'); ST.dropCache(); }, () => { g.expand = ex; ST.dropCache(); });
const bd = ST.defs.bastion_remnant.dim;
breakIt('bastion row ungated', () => { ST.defs.bastion_remnant.dim = 'overworld'; }, () => { ST.defs.bastion_remnant.dim = bd; });
const fs = ST.defs.nether_fossil.step;
breakIt('fossil wrong step', () => { ST.defs.nether_fossil.step = 0; }, () => { ST.defs.nether_fossil.step = fs; });
console.log(`${caught} breaks caught`);
if (caught !== 4) fails.push('not every break caught');
for (const f of fails) console.log('   ✗ ' + f);
console.log('netherstructcheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
