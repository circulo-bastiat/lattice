#!/usr/bin/env node
// noteblock11591check.mjs — #11591: proves 07fn_noteblock.js (NoteBlock + Instrument) through real entry points:
// Behave.changed (below-block -> instrument), Note.use (cycle/wrap/play), Note.punch, Redstone rising edge.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '07f_redstone.js',
    '07fn_noteblock.js', '07zx_particle.js'], dom: false, ...(patch ? { patch } : {}) });
  const S = M.States, B = M.Behave, Note = M.Note, o = {};
  const N = 64, MID = 32, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const w = { get: (x, y, z) => cells[idx(x, y, z)], set: (x, y, z, s) => { cells[idx(x, y, z)] = s; } };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  B.init(w); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init(); M.Redstone.init();
  const put = (x, y, z, n) => { w.set(x, y, z, S.stateOf(n)); B.changed(x, y, z); };
  const prop = (x, y, z, p) => B.propName(w.get(x, y, z), p);
  const below = (n) => { put(0, 0, 0, 'note_block'); put(0, -1, 0, n); Note.refresh(0, 0, 0); return prop(0, 0, 0, 'instrument'); };
  // instrument by below-block, including the neighbour-update hook
  put(0, 0, 0, 'note_block'); put(0, -1, 0, 'stone');
  o.hook = prop(0, 0, 0, 'instrument') === 'basedrum';
  o.sand = below('sand') === 'snare';
  o.glass = below('glass') === 'hat';
  o.planks = below('oak_planks') === 'bass';
  o.nether = below('crimson_planks') === 'bass';
  o.wool = below('white_wool') === 'guitar';
  o.clay = below('clay') === 'flute';
  o.gold = below('gold_block') === 'bell';
  o.glow = below('glowstone') === 'pling';
  o.dirt = below('dirt') === 'harp';
  o.air = Note.instrumentOf(0) === 'harp';
  o.pitch = Note.pitch(12) === 1 && Note.pitch(24) === 2 && Note.pitch(0) === 0.5;
  // use: cycle, wrap, event
  put(0, 0, 0, 'note_block'); put(0, -1, 0, 'stone'); Note.events.length = 0;
  Note.use(0, 0, 0);
  o.use1 = prop(0, 0, 0, 'note') === '1' && Note.events.length === 1 && Note.events[0].note === 1 && Note.events[0].instrument === 'basedrum';
  for (let i = 0; i < 23; i++) Note.use(0, 0, 0);
  o.use24 = prop(0, 0, 0, 'note') === '24';
  Note.use(0, 0, 0); o.wrap = prop(0, 0, 0, 'note') === '0';
  // air above required
  put(0, 1, 0, 'stone'); Note.events.length = 0;
  o.blocked = Note.playNote(0, 0, 0) === false && Note.events.length === 0;
  put(0, 1, 0, 'air');
  o.punch = Note.punch(0, 0, 0) === true && prop(0, 0, 0, 'note') === '0';
  // redstone rising edge
  Note.events.length = 0; put(1, 0, 0, 'redstone_block');
  o.edge = Note.events.length === 1;
  put(1, 0, 0, 'air'); put(1, 0, 0, 'redstone_block');
  o.edge2 = Note.events.length === 2;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const F = '07fn_noteblock.js';
const BR = [
  ['hook', "if (B.propName(st, 'instrument') === inst) return false;", 'return false;', ['hook', 'sand']],
  ['sand', "put(MAT_AGGREGATE, 'snare');", '', ['sand']],
  ['glass', "put(MAT_GLASS, 'hat');", '', ['glass']],
  ['planks', "put(MAT_WOOD, 'bass');", '', ['planks']],
  ['nether', "put(MAT_NETHER_WOOD, 'bass');", '', ['nether']],
  ['wool', "'guitar'", "'harp'", ['wool']],
  ['clay', "clay: 'flute'", "clay: 'harp'", ['clay']],
  ['pitch', '(note - 12) / 12', '(note - 11) / 12', ['pitch']],
  ['wrap', '% 25', '% 26', ['use24', 'wrap']],
  ['blocked', 'if (w.get(x, y + 1, z) !== 0) return false;', '', ['blocked']],
  ['punch', 'var pr = Note.playNote(x, y, z);', 'var pr = false;', ['punch']],
  ['use', "String(((+B.propName(st, 'note') | 0) + 1)", "String(((+B.propName(st, 'note') | 0) + 2)", ['use1']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((f, s) => { if (f === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((k) => !X[k]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `noteblock11591check: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
