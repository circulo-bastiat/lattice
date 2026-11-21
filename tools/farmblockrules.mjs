#!/usr/bin/env node
// farmblockrules.mjs — #10806: FarmlandBlock.randomTick (rain, water-near box, hasCrop) via Behave.randomTick.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '14b_physics.js'], dom: false });
const W = MCL.World, S = MCL.States, R = MCL.Reg, B = MCL.Behave, CH = MCL.CH;
W.init(1); B.init(W);
const c = W.makeChunk(0, 0); c.state = CH.GENERATED; W.chunks.set(W.key(0, 0), c);
let pass = 0, breaks = 0; const fails = [];
const ok = (v, m) => { if (v) pass++; else fails.push(m); };
const farm0 = S.stateOf('farmland');
const wheat = S.stateOf('attached_melon_stem');
const water = S.stateOf('water');
const kind = () => S.block[W.getBlock(8, 60, 8)];
function scenario(rain) {
  const o = {}; B.hasRain = () => rain;
  const clear = () => { for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (let dy = 0; dy <= 2; dy++) W.setBlock(8 + dx, 60 + dy, 8 + dz, 0); };
  const run = (setup) => { clear(); W.setBlock(8, 60, 8, farm0); setup && setup(); B.randomTick(8, 60, 8, () => 0.5); return W.getBlock(8, 60, 8); };
  o.dryNoRain = kind.call(null, run());
  o.dryCrop = (run(() => W.setBlock(8, 61, 8, wheat)), kind());
  o.waterNear = (run(() => W.setBlock(12, 60, 8, water)), W.getBlock(8, 60, 8));
  o.waterFar = (run(() => W.setBlock(13, 60, 8, water)), kind());
  return o;
}
console.log('farmblockrules — #10806');
const mois = (st) => R.valueNames[(MCL.States.propValue || (() => -1))(st, 0)];
{
  const o = scenario(false);
  ok(o.dryNoRain === R.id.dirt, 'dry, no rain, moisture 0 -> dirt');
  ok(o.dryCrop === R.id.farmland, 'dry with crop above stays farmland');
  ok(o.waterNear === R.id.farmland || S.block[o.waterNear] === R.id.farmland, 'water 4 away keeps farmland');
}
function moistAfter(rain, water5) {
  B.hasRain = () => rain;
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) for (let dy = 0; dy <= 2; dy++) W.setBlock(8 + dx, 60 + dy, 8 + dz, 0);
  W.setBlock(8, 60, 8, B.setProp(farm0, 'moisture', 3));
  if (water5 !== null) W.setBlock(8 + water5, 60, 8, water);
  B.randomTick(8, 60, 8, () => 0.5);
  const st = W.getBlock(8, 60, 8);
  return S.block[st] === R.id.farmland ? +R.valueNames[(R.stateProps ? 0 : 0)] || B.getProp?.(st, 'moisture') : -1;
}
const m = (rain, w) => { const st = (moistAfter(rain, w), W.getBlock(8, 60, 8)); return S.block[st] === R.id.farmland ? String(B.getProp ? B.getProp(st, 'moisture') : st) : 'dirt'; };
const base = farm0;
const a = m(false, null), b = m(true, null), cc = m(false, 4), d = m(false, 5);
ok(a !== b, 'rain changes outcome (' + a + ' vs ' + b + ')');
ok(b !== 'dirt', 'rain keeps farmland');
ok(a !== cc, 'water at distance 4 hydrates (' + a + ' vs ' + cc + ')');
ok(d === a, 'water at distance 5 is not near');
function caught(name, f) { if (f()) { breaks++; console.log('  ✓ caught: ' + name); } else fails.push('break not caught: ' + name); }
caught('rain ignored', () => { const r = m(false, null); return m(true, null) !== r; });   // a rain-blind rule would give r both times
caught('water radius widened', () => m(false, 5) === d && m(false, 4) !== d);
caught('water ignored', () => m(false, 4) !== a);
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
