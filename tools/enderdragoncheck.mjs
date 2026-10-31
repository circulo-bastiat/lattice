#!/usr/bin/env node
// enderdragoncheck.mjs — D-773 cloud unit (confident-lamport-1851se): the ender dragon's
// registry-level identity (src/07zzl_enderdragon.js) — the 8-part hitbox and the 11 phase
// names, ported verbatim from .decomp. NOT the fight/the renderer — EnderDragon.OWED still
// names those as separate slices; canSpawn/motion (this file's section 5) is wired as of
// loop/enderdragon-wiring (ED.OWED item 1) -- the fuller spawn+tick wire-up test lives in
// enderdragonphasecheck's own section 16, this section is only a light regression check.
//
//   node tools/enderdragoncheck.mjs [--verbose]
//
// Sections:
//   1. EnderDragon.ready
//   2. PARTS — exact count, order, names and EntityDimensions against EnderDragonEntity's own
//      constructor call sites (.decomp/net/minecraft/entity/boss/dragon/EnderDragonEntity.java)
//   3. PHASE_NAMES — exact count and order against PhaseType.java's own register() calls
//   4. OWED — non-empty, every entry a real string (the same shape-only sanity every other
//      *.OWED array in this codebase gets, e.g. usecheck's own Use.OWED audit)
//   5. anti-vacuity — EL.canSpawn('ender_dragon') is now TRUE (loop/enderdragon-wiring) and a
//      spawned dragon's position actually changes over real ticks -- not a statue left behind
//      by a gate flipped with no hook behind it
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('enderdragoncheck -- D-773 cloud unit, the ender dragon\'s registry-level identity');

const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js', '07i_entitylist.js', '07zzl_enderdragon.js'], dom: false });
const ED = M.EnderDragon;

// ============ 1. ready ========================================================================
ok(ED && ED.ready === true, 'EnderDragon.ready is true once the module has loaded');

// ============ 2. PARTS =========================================================================
// Straight off EnderDragonEntity's own constructor: `new EnderDragonPart(this, "<name>", w, h)`
// for head, neck, body, tail1, tail2, tail3, rightWing, leftWing, in that literal source order.
const WANT_PARTS = [
  ['head', 1.0, 1.0], ['neck', 3.0, 3.0], ['body', 5.0, 3.0],
  ['tail', 2.0, 2.0], ['tail', 2.0, 2.0], ['tail', 2.0, 2.0],
  ['wing', 4.0, 2.0], ['wing', 4.0, 2.0]
];
ok(Array.isArray(ED.PARTS) && ED.PARTS.length === 8, `ED.PARTS has exactly 8 entries (got ${ED.PARTS && ED.PARTS.length})`);
WANT_PARTS.forEach(([name, w, h], i) => {
  const p = ED.PARTS[i];
  ok(!!p && p.name === name, `part ${i} is named "${name}" (ctor arg 2), got ${p && p.name}`);
  ok(!!p && p.width === w, `part ${i} (${name}) width is ${w} (ctor arg 3), got ${p && p.width}`);
  ok(!!p && p.height === h, `part ${i} (${name}) height is ${h} (ctor arg 4), got ${p && p.height}`);
});
say(`   parts: ${ED.PARTS.map(p => `${p.name}(${p.width}x${p.height})`).join(' ')}`);

// the decomp source itself, re-read here so a hand-typo in either file cannot agree with itself —
// the ctor call sites for all 8 parts appear on consecutive lines in the SAME order as WANT_PARTS.
const entitySrc = readFileSync(
  join(MCLITE_ROOT, '.decomp/net/minecraft/entity/boss/dragon/EnderDragonEntity.java'), 'utf8');
const ctorCalls = [...entitySrc.matchAll(/new EnderDragonPart\(this, "(\w+)", ([\d.]+)F, ([\d.]+)F\)/g)]
  .map(m => [m[1], parseFloat(m[2]), parseFloat(m[3])]);
okAv(ctorCalls.length === 8, `.decomp still has exactly 8 EnderDragonPart(...) constructor calls (found ${ctorCalls.length}) -- proves this check reads the SAME source it is graded against, not a copy`);
ctorCalls.forEach(([name, w, h], i) => {
  ok(ED.PARTS[i] && ED.PARTS[i].name === name && ED.PARTS[i].width === w && ED.PARTS[i].height === h,
    `ED.PARTS[${i}] (${ED.PARTS[i] && ED.PARTS[i].name}) matches .decomp's own ctor call #${i} (${name} ${w}x${h}) exactly`);
});

// ============ 3. PHASE_NAMES ===================================================================
const phaseSrc = readFileSync(
  join(MCLITE_ROOT, '.decomp/net/minecraft/entity/boss/dragon/phase/PhaseType.java'), 'utf8');
const wantPhases = [...phaseSrc.matchAll(/register\(\w+\.class, "(\w+)"\)/g)].map(m => m[1]);
okAv(wantPhases.length === 11, `.decomp's PhaseType.java still registers exactly 11 phases (found ${wantPhases.length})`);
ok(Array.isArray(ED.PHASE_NAMES) && ED.PHASE_NAMES.length === wantPhases.length,
  `ED.PHASE_NAMES has ${wantPhases.length} entries, same as PhaseType.java's own register() calls`);
wantPhases.forEach((name, i) => {
  ok(ED.PHASE_NAMES[i] === name, `ED.PHASE_NAMES[${i}] is "${name}" (PhaseType's own getTypeId() ${i}), got ${ED.PHASE_NAMES[i]}`);
});
say(`   phases: ${ED.PHASE_NAMES.join(', ')}`);

// ============ 4. OWED ===========================================================================
ok(Array.isArray(ED.OWED) && ED.OWED.length > 0, 'EnderDragon.OWED is a non-empty array');
(ED.OWED || []).forEach((s, i) => ok(typeof s === 'string' && s.length > 10, `OWED[${i}] is a real written-out reason, not a placeholder`));

// ============ 5. anti-vacuity — canSpawn is wired, and a spawned dragon really moves ==========
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init();
ok(M.EntityList.canSpawn('ender_dragon') === true,
  "EL.canSpawn('ender_dragon') is true (loop/enderdragon-wiring — ED.initEntity/ED.tickEntity bridge tickMovement onto a live entity)");
const dsp = M.EntityList.spawn('ender_dragon', 0, 200, 0, {});
ok(!!dsp && !!dsp.dragon, "EL.spawn('ender_dragon', ...) returns a real dragon with the ED.EnderDragonEntity rig attached");
const dsx = dsp.x, dsy = dsp.y, dsz = dsp.z;
for (let i = 0; i < 20; i++) M.EntityList.tickMob(dsp);
okAv(dsp.x !== dsx || dsp.y !== dsy || dsp.z !== dsz,
  'anti-vacuity: 20 real EL.tickMob ticks actually moved the spawned dragon — a gate flipped with no hook behind it would leave it frozen at spawn');

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
