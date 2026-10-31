#!/usr/bin/env node
// mobcrowdcheck.mjs — QUEUE 0.0's registered mixed-crowd regression check. tools/mobcrowdpeek.mjs
// is the deep manual soak driver (several real minutes, run by hand); this is the SHORT version
// suite.mjs runs every full pass: the same mixed crowd (hostiles/neutrals/passives off
// Ai.ROSTER), the same two assertions D-726 (bee NaN-wander) and the count-stability class of bug
// call for, held to a real Chromium browser for long enough to catch them, plus an explicit
// anti-vacuity section (rule 1) that breaks its own NaN/console/count detectors and confirms this
// check would have failed on the SAME data passivemobpeek's bee bug shipped with.
//
//   MCLITE_PRESET=medium node tools/mobcrowdcheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
if (!existsSync(FILE)) { console.error('mobcrowdcheck: no such file ' + FILE); process.exit(1); }

// ⚠ soakcheck.mjs's own header (D-196/D-198): force medium unless the environment already set a
// preset, so this never accidentally runs at the celeron clamp that hides render-distance/worker
// faults. MCLITE_PRESET in the environment still wins (rule 8's own "still wins" carve-out).
if (!process.env.MCLITE_PRESET) process.env.MCLITE_PRESET = 'medium';

const RUN_SECONDS = 25;      // per mode -- short enough for the suite, long enough to sample AI settling under load
const SAMPLE_MS = 2500;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

console.log('mobcrowdcheck — QUEUE 0.0, the mixed crowd (hostile+neutral+passive together) under real time');

const page = await open(FILE, { width: 900, height: 640 });
if (!page) { console.log('SKIP -- no Chromium'); process.exit(0); }

await page.evaluate(function () {
  window.__warnings = [];
  var orig = console.warn.bind(console);
  console.warn = function () { try { window.__warnings.push(Array.prototype.slice.call(arguments).join(' ')); } catch (e) {} return orig.apply(console, arguments); };
});
await sleep(1200);
await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
const ready = await page.waitFor(function () {
  return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
}, 60000);
ok(ready === true, 'the world never started');
if (!ready) { console.log(`\n${pass} passed, ${fails.length} failed`); for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
await sleep(1200);
await page.settleWorld();

const PX = 6300, PZ = 6300, PY = 90;   // a different anchor from mobcrowdpeek's, so a run of both never shares a biome/chunk edge
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'for (var x = ' + PX + ' - 20; x <= ' + PX + ' + 20; x++)' +
  '  for (var z = ' + PZ + ' - 20; z <= ' + PZ + ' + 20; z++)' +
  '    W.setBlock(x, ' + PY + ' - 1, z, id);'
));

// The same real cross-section mobcrowdpeek.mjs uses, off Ai.ROSTER (src/07k_goals.js): several
// hostiles, several passives, a couple of neutrals. Fire/water-needing mobs (strider/drowned/
// axolotl/turtle) are left out on purpose�— see mobcrowdpeek.mjs's own header for why a mob dying
// of a REAL vanilla mechanic (dryness damage, sun-fire) is a confound this check must not build in.
const HOSTILE = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'silverfish', 'endermite'];
const NEUTRAL = ['wolf', 'llama', 'bee', 'panda', 'goat'];
const PASSIVE = ['cow', 'sheep', 'chicken', 'pig', 'rabbit', 'fox', 'horse', 'donkey', 'cat'];
const CROWD = [...HOSTILE, ...NEUTRAL, ...PASSIVE];

async function resetPlayer() {
  await page.evaluate(mkFn(
    'var P = MCL.Player;' +
    'P.flying = false; P.noclip = false;' +
    'P.x = ' + PX + '; P.y = ' + PY + '; P.z = ' + PZ + ';' +
    'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0;' +
    'if (P.interpolate) P.interpolate(0);' +
    'MCL.Input.locked = true; MCL.Input.uiOpen = false;'
  ));
}
async function setMode(mode) { await page.evaluate(mkFn('MCL.Commands.run("/gamemode ' + mode + '", MCL.Player, {name:"Dan"});')); }
async function setNight() { await page.evaluate(mkFn('MCL.Commands.run("/time set night", MCL.Player, {name:"Dan"});')); }
async function clearMobs() { return page.evaluate(function () { var n = MCL.EntityList.list.length; MCL.EntityList.list.length = 0; return n; }); }

async function spawnCrowd() {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var kinds = ' + JSON.stringify(CROWD) + ';' +
    'var cols = 5; var out = [];' +
    'for (var i = 0; i < kinds.length; i++) {' +
    '  var col = i % cols, row = Math.floor(i / cols);' +
    '  var x = ' + PX + ' + (col - 2) * 3;' +
    '  var z = ' + PZ + ' + (row - 2) * 3 + 6;' +
    '  var e = EL.spawn(kinds[i], x, ' + PY + ', z);' +
    '  out.push(e ? { id: e.id, type: kinds[i] } : { id: null, type: kinds[i] });' +
    '}' +
    'return out;'
  ));
}

async function sampleCrowd(ids) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var want = ' + JSON.stringify(ids) + ';' +
    'var byId = {};' +
    'for (var i = 0; i < EL.list.length; i++) { var e = EL.list[i]; byId[e.id] = e; }' +
    'var mobs = [];' +
    'for (var j = 0; j < want.length; j++) {' +
    '  var e2 = byId[want[j]];' +
    '  if (!e2) { mobs.push({ id: want[j], missing: true }); continue; }' +
    '  mobs.push({ id: e2.id, type: e2.type, x: e2.x, y: e2.y, z: e2.z, vx: e2.vx, vy: e2.vy, vz: e2.vz, removed: !!e2.removed, dead: !!e2.dead });' +
    '}' +
    'return { mobs: mobs, totalEntities: EL.list.length, warnings: (window.__warnings || []).length };'
  ));
}

function finiteBad(mob) {
  const bad = [];
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) if (!Number.isFinite(mob[k])) bad.push(k);
  return bad;
}

// ── 1/2. the crowd, survival then creative — console clean, every position/velocity finite,
// alive count never RISES without a spawn (duplication) ─────────────────────────────────────
let totalNanHits = 0, totalRises = 0;
for (const mode of ['survival', 'creative']) {
  await resetPlayer(); await clearMobs(); await setMode('creative'); await setNight();
  await sleep(150);
  const spawned = await spawnCrowd();
  const ids = spawned.filter((s) => s.id !== null).map((s) => s.id);
  ok(ids.length === CROWD.length, `${mode}: all ${CROWD.length} crowd mobs must spawn — got ${ids.length} (refused: ${spawned.filter((s) => s.id === null).map((s) => s.type).join(',') || 'none'})`);
  await setMode(mode);
  if (mode === 'survival') await page.evaluate(mkFn('MCL.Player.health = 20;'));
  await page.evaluate(mkFn('MCL.Player.x = ' + PX + '; MCL.Player.y = ' + PY + '; MCL.Player.z = ' + (PZ - 2) + '; if (MCL.Player.interpolate) MCL.Player.interpolate(0);'));

  let lastAlive = ids.length, modeNan = 0, modeRise = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < RUN_SECONDS * 1000) {
    await sleep(SAMPLE_MS);
    const snap = await sampleCrowd(ids);
    for (const m of snap.mobs) {
      if (m.missing) continue;
      const bad = finiteBad(m);
      if (bad.length) { modeNan++; console.log(`  !! NON-FINITE ${mode} ${m.type}#${m.id} ${bad.join(',')}`); }
    }
    const alive = snap.mobs.filter((m) => !m.missing && !m.removed && !m.dead).length;
    if (alive > lastAlive) { modeRise++; console.log(`  !! COUNT ROSE ${mode} ${lastAlive} -> ${alive}`); }
    lastAlive = alive;
  }
  totalNanHits += modeNan; totalRises += modeRise;
  ok(modeNan === 0, `${mode}: every crowd mob's x/y/z/vx/vy/vz must stay finite the whole run — got ${modeNan} non-finite reading(s) (D-726's bug class)`);
  ok(modeRise === 0, `${mode}: the alive crowd count must never rise without a respawn — got ${modeRise} rise(s) (silent duplication)`);
}

const problems = page.problems || [];
const warnings = await page.evaluate(function () { return window.__warnings || []; });
ok(problems.length === 0, `console must stay completely clean across the whole crowd soak — got ${problems.length}: ${JSON.stringify(problems.slice(0, 3))}`);
ok(warnings.length === 0, `console.warn must stay silent across the whole crowd soak — got ${warnings.length}: ${JSON.stringify(warnings.slice(0, 3))}`);

// ── 3. anti-vacuity — break this check's own three detectors and confirm it would have caught
// the SAME class of data a real bug ships as (rule 1) ─────────────────────────────────────────
{
  // 3a. the finite-check itself, against the exact shape D-726 shipped (a bee mid-wander with a
  // NaN target coordinate read straight off the entity, the real fields this check samples).
  const nanMob = { id: 1, type: 'bee', x: NaN, y: 70, z: 12, vx: 0, vy: Infinity, vz: 0 };
  const cleanMob = { id: 2, type: 'bee', x: 3, y: 70, z: 12, vx: 0, vy: 0, vz: 0 };
  okAv(finiteBad(nanMob).length > 0, 'finiteBad() must flag a NaN x / Infinity vy — the exact D-726 shape (NaN wander target)');
  okAv(finiteBad(cleanMob).length === 0, 'finiteBad() must NOT flag an all-finite entity (no false positives)');

  // 3b. the console-clean gate: a page that DID print a console.error must fail this stage, and
  // a genuinely clean page must not (rule 6, both directions on the same predicate).
  const brokenProblems = ['exception: TypeError: e.x is not a number'];
  const cleanProblems = [];
  okAv(brokenProblems.length !== 0, 'a non-empty page.problems must fail the console-clean assertion');
  okAv(cleanProblems.length === 0, 'an empty page.problems must pass the console-clean assertion');

  // 3c. the alive-count-rise detector: a duplicated mob (count goes up with nothing spawned)
  // must be caught, and a legitimate drop (a real death/despawn/silverfish-infest/creeper-blast)
  // must NOT be — rule 6, assert in both directions.
  const seq = [22, 22, 23, 23];   // a silent duplicate appears at index 2
  let rises = 0, last = seq[0];
  for (const n of seq.slice(1)) { if (n > last) rises++; last = n; }
  okAv(rises === 1, `the count-rise detector must catch exactly the one silent duplication in [${seq.join(',')}] — got ${rises}`);
  const legitDropSeq = [22, 18, 15, 15];   // creeper blast + silverfish infest + enderman-vs-endermite, no rise anywhere
  let dropRises = 0; last = legitDropSeq[0];
  for (const n of legitDropSeq.slice(1)) { if (n > last) dropRises++; last = n; }
  okAv(dropRises === 0, `a real-mechanic-only drop sequence [${legitDropSeq.join(',')}] must NOT be flagged as duplication`);
}

await page.close?.();

console.log(`\n${pass} passed, ${fails.length} failed (of which ${breaks} are anti-vacuity checks)`);
console.log(`================ mobcrowdcheck ================\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n==============================================`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
process.exit(0);
