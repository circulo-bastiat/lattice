#!/usr/bin/env node
// noteblockcheck.mjs — G19ef: NoteBlock / Instrument (.decomp NoteBlock.java, Instrument.java).
//   node tools/noteblockcheck.mjs [--quiet]
// Expected instruments are DERIVED from tools/golden/block-materials-1.18.2.tsv (material letters J stone,
// w aggregate, G glass, z wood, A nether wood — identified by stone/sand/glass/oak_planks/crimson_planks rows)
// and the special-block list of Instrument.fromBlockState; the enum order is parsed from Instrument.java and
// compared with the registry's `instrument` property. Every section proves it can fail (breaks its own data).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const say = (...a) => { if (!QUIET) console.log(...a); };
/** anti-vacuity: `bad` is a deliberately broken run; the check MUST reject it. */
const caught = (rejected, m) => { if (rejected) { breaks++; say('   ✓ break caught: ' + m); } else fails.push('NOT caught: ' + m); };

const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '07f_redstone.js',
  '07fn_noteblock.js', '07zx_particle.js'], dom: false });
const S = M.States, B = M.Behave, R = M.Reg, Note = M.Note;
const N = 64, MID = 32, cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const w = { get: (x, y, z) => cells[idx(x, y, z)], set: (x, y, z, s) => { cells[idx(x, y, z)] = s; } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
B.init(w); if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init(); M.Redstone.init();
const put = (x, y, z, n) => { w.set(x, y, z, typeof n === 'number' ? n : S.stateOf(n)); B.changed(x, y, z); };
const prop = (x, y, z, p) => B.propName(w.get(x, y, z), p);

// ── 1. the instrument table vs the decomp enum + the material tsv ───────────────────────────────
const inst = readFileSync(join(ROOT, '.decomp/net/minecraft/block/enums/Instrument.java'), 'utf8');
const enumNames = [...inst.matchAll(/^\s+field_\d+\("([a-z_]+)",/gm)].map((m) => m[1]);
ok(enumNames.length === 16, 'Instrument.java lists 16 instruments, saw ' + enumNames.length);
const regVals = [];
for (let v = 0; v < 16; v++) { const s = S.stateOf('note_block'); regVals.push(B.propName(B.setProp(s, 'instrument', enumNames[v]), 'instrument')); }
ok(JSON.stringify(regVals) === JSON.stringify(enumNames), 'registry `instrument` values are the decomp enum: ' + regVals);
const SPECIAL = { clay: 'flute', gold_block: 'bell', packed_ice: 'chime', bone_block: 'xylophone', iron_block: 'iron_xylophone',
  soul_sand: 'cow_bell', pumpkin: 'didgeridoo', emerald_block: 'bit', hay_block: 'banjo', glowstone: 'pling' };
const rows = readFileSync(join(ROOT, 'tools/golden/block-materials-1.18.2.tsv'), 'utf8').split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
const letter = Object.fromEntries(rows.map((r) => [r[0], r[1]]));
const MATCLASS = { [letter.stone]: 'basedrum', [letter.sand]: 'snare', [letter.glass]: 'hat', [letter.oak_planks]: 'bass', [letter.crimson_planks]: 'bass' };
const WOOLS = new Set(rows.map((r) => r[0]).filter((n) => /_wool$/.test(n)));
ok(WOOLS.size === 16, '16 wools in the registry');
const expected = (name) => SPECIAL[name] || (WOOLS.has(name) ? 'guitar' : (MATCLASS[letter[name]] || 'harp'));
function drift(fn) { const bad = []; for (const r of rows) if (fn(r[0]) !== expected(r[0])) bad.push(r[0]); return bad; }
const drifted = drift((n) => Note.instrumentOfName(n));
ok(drifted.length === 0, 'instrument drift vs tsv/Instrument: ' + drifted.slice(0, 8));
for (const [b, i] of Object.entries(SPECIAL)) ok(Note.instrumentOfName(b) === i, b + ' -> ' + i);
ok(Note.instrumentOf(0) === 'harp', 'air below -> harp');
const counts = {}; for (const r of rows) counts[expected(r[0])] = (counts[expected(r[0])] || 0) + 1;
say('   instruments over ' + rows.length + ' blocks: ' + JSON.stringify(counts));
for (const i of ['basedrum', 'snare', 'hat', 'bass', 'guitar', 'harp']) ok(counts[i] > 0, i + ' is reachable');
// breaks: (a) a corrupted engine answer, (b) a corrupted tsv letter, (c) the stone rule dropped
caught(drift((n) => (n === 'stone' ? 'harp' : Note.instrumentOfName(n))).length > 0, 'stone answering harp');
caught(drift((n) => (/_wool$/.test(n) ? 'harp' : Note.instrumentOfName(n))).length > 0, 'wool answering harp');
caught(drift((n) => (n === 'oak_planks' ? 'basedrum' : Note.instrumentOfName(n))).length > 0, 'planks answering basedrum');
caught(drift((n) => (SPECIAL[n] ? 'harp' : Note.instrumentOfName(n))).length > 0, 'special blocks ignored');

// ── 2. circuits: placement, neighbour update, power edge, air-above rule, use, punch ───────────
const X = 0, Y = 0, Z = 0;
put(X, Y - 1, Z, 'stone'); put(X, Y, Z, 'note_block');
ok(prop(X, Y, Z, 'instrument') === 'basedrum', 'placed on stone -> basedrum, got ' + prop(X, Y, Z, 'instrument'));
put(X, Y - 1, Z, 'oak_planks');
ok(prop(X, Y, Z, 'instrument') === 'bass', 'planks swapped in below -> bass (getStateForNeighborUpdate DOWN)');
put(X, Y - 1, Z, 'white_wool');
ok(prop(X, Y, Z, 'instrument') === 'guitar', 'wool below -> guitar');
put(X, Y - 1, Z, 0);
ok(prop(X, Y, Z, 'instrument') === 'harp', 'air below -> harp');
put(X, Y - 1, Z, 'gold_block');
ok(prop(X, Y, Z, 'instrument') === 'bell', 'gold below -> bell');
// a side block changing must NOT touch the instrument
put(X + 1, Y, Z, 'stone');
ok(prop(X, Y, Z, 'instrument') === 'bell', 'a side neighbour does not change the instrument');
w.set(X + 1, Y, Z, 0);
// power edge: a redstone block beside it plays once (air above), and not again while it stays powered
Note.events.length = 0;
const before = M.Particle.list.length;
put(X + 1, Y, Z, 'redstone_block');
ok(Note.events.length === 1, 'rising edge plays once, events=' + Note.events.length);
ok(Note.events[0] && Note.events[0].instrument === 'bell' && Note.events[0].note === 0, 'event carries instrument+note');
ok(prop(X, Y, Z, 'powered') === 'true', 'powered recorded');
ok(M.Particle.list.some((p) => p.type === 'note'), 'a NOTE particle was spawned (' + (M.Particle.list.length - before) + ')');
B.changed(X + 1, Y, Z);
ok(Note.events.length === 1, 'no replay while it stays powered');
w.set(X + 1, Y, Z, 0); B.changed(X + 1, Y, Z);
ok(prop(X, Y, Z, 'powered') === 'false', 'unpowered recorded, and falling edge is silent: ' + Note.events.length);
ok(Note.events.length === 1, 'falling edge silent');
// block above -> silent (playNote's isAir test), still records POWERED
put(X, Y + 1, Z, 'stone'); Note.events.length = 0;
put(X + 1, Y, Z, 'redstone_block');
ok(Note.events.length === 0, 'block above -> no sound');
ok(prop(X, Y, Z, 'powered') === 'true', 'still records powered with a block above');
w.set(X + 1, Y, Z, 0); B.changed(X + 1, Y, Z);
// use cycles NOTE and wraps 24 -> 0; plays only with air above
w.set(X, Y + 1, Z, 0);
Note.events.length = 0;
for (let i = 0; i < 25; i++) Note.use(X, Y, Z);
ok(prop(X, Y, Z, 'note') === '0', '25 uses wrap 24 -> 0, got ' + prop(X, Y, Z, 'note'));
ok(Note.events.length === 25 && Note.events[0].note === 1 && Note.events[23].note === 24 && Note.events[24].note === 0, 'each use plays the NEW note');
// punch plays without changing
Note.events.length = 0; Note.use(X, Y, Z); Note.use(X, Y, Z); Note.events.length = 0;
ok(Note.punch(X, Y, Z) && Note.events.length === 1 && prop(X, Y, Z, 'note') === '2', 'punch plays note 2 and leaves it');
put(X, Y + 1, Z, 'stone'); Note.events.length = 0;
ok(!Note.punch(X, Y, Z) && Note.events.length === 0, 'punch with a block above is silent');
w.set(X, Y + 1, Z, 0);
// pitch table 2^((n-12)/12)
ok(Note.pitch(12) === 1 && Note.pitch(0) === 0.5 && Note.pitch(24) === 2, 'pitch table 0.5 / 1 / 2');
ok(Math.abs(Note.pitch(18) - Math.SQRT2) < 1e-12, 'pitch(18) = 2^(1/2)');
caught(Note.pitch(13) !== Math.pow(2, 13 / 12), 'a shifted pitch table (n/12) differs from the real one');
// particle colours: NoteParticle hue = note/24
{
  M.Particle.list.length = 0; M.Particle.spawn('note', 0, 0, 0, 0 / 24, 0, 0);
  const p = M.Particle.list[0], TAU = Math.PI * 2;
  ok(p && p.maxAge === 6 && p.velocityMultiplier === 0.66 && Math.abs(p.red - Math.max(0, Math.sin(0) * 0.65 + 0.35)) < 1e-9, 'note particle: maxAge 6, x0.66, red(0)=0.35');
  ok(p && Math.abs(p.green - (Math.sin(0.33333334 * TAU) * 0.65 + 0.35)) < 1e-6, 'note particle green(0)');
  ok(p && p.vy > 0.2 && p.vy < 0.21, 'note particle rises at ~0.2');
  caught(Math.abs(1 - p.red) > 1e-9, 'a white (unhued) particle would fail the colour assertion');
}
// the on-use engine path in 14l_use is gone from the harp-only shape
const use = readFileSync(join(ROOT, 'src/14l_use.js'), 'utf8');
ok(!/note_block\.harp/.test(use), '14l_use.js no longer hard-codes the harp');
caught(/note_block\.harp/.test(use.replace('NS.Note.use(x, y, z)', "'block.note_block.harp'")), 'a harp-only Use would be flagged');

console.log('');
console.log('================= noteblockcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
