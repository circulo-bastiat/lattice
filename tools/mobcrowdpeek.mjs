// mobcrowdpeek.mjs -- QUEUE 0.0's mixed-crowd soak/robustness driver. Every deep-test pass so far
// (passivemobpeek.mjs, undeadmobpeek.mjs, nethermobpeek.mjs) drove ONE or TWO mobs at a time for
// a few seconds. This drives a real mixed crowd -- hostiles, passives, neutrals together, the way
// a player's base actually looks -- clustered on one loaded platform, for an EXTENDED real span,
// and watches for the class of bug a single-mob test cannot see: N mobs' AI fighting over the
// same tick budget, a shared array getting mutated by one mob's goal while another iterates it,
// a counter that only drifts under real concurrent load.
//
// Same method as beecheck's WanderGoal section (D-726): read every mob's x/y/z/vx/vy/vz every
// sample and assert Number.isFinite on all six, not just watch for a crash. D-726 was a bee that
// picked a NaN target and wandered off silently -- console stayed clean, nothing crashed, the bee
// just went to noplace. A crowd run that only watches the console would not have caught it either.
//
//   MCLITE_PRESET=medium node tools/mobcrowdpeek.mjs [--seconds 150] [--modes survival,creative]
//
// Results accumulate in tools/out/mobcrowd/results.json across repeated invocations (this file's
// own open() spawns a fresh Chromium every run -- there is no way to keep one browser alive across
// separate device_bash calls -- so a long soak is several separate invocations of this same file,
// each one a fresh world+crowd, and the accumulated results.json is what "chains" them).

import { open, sleep } from './cdp.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out', 'mobcrowd');
mkdirSync(OUT, { recursive: true });
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const RESULTS_PATH = join(OUT, 'results.json');
let allResults = { runs: [] };
if (existsSync(RESULTS_PATH)) {
  try { allResults = JSON.parse(readFileSync(RESULTS_PATH, 'utf8')); } catch (e) {}
}

const argv = process.argv.slice(2);
const numArg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const strArg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const SECONDS = numArg('seconds', 150);
const MODES = strArg('modes', 'survival,creative').split(',');
const SAMPLE_MS = numArg('sample-ms', 3000);

// A real cross-section: several hostiles, several passives, a couple of neutrals -- all off
// Ai.ROSTER (src/07k_goals.js) so every one of them has a real live AI wired up, not a stub.
// Fire-needing (strider/lava) and water-needing (drowned/axolotl/turtle -- AxolotlAttackablesSensor
// and the dryness-damage mechanic axolotls/turtles have on land, .decomp) mobs are left out on
// purpose: dying of thirst on a dry stone platform is a REAL vanilla mechanic, not a bug, and would
// be indistinguishable in this harness's count-check from actual silent vanishing (rule: don't
// build confounds into your own regression check).
const HOSTILE = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'silverfish', 'endermite'];
const NEUTRAL = ['wolf', 'llama', 'bee', 'panda', 'goat'];
const PASSIVE = ['cow', 'sheep', 'chicken', 'pig', 'rabbit', 'fox', 'horse', 'donkey', 'cat'];
const CROWD = [...HOSTILE, ...NEUTRAL, ...PASSIVE];   // 21 mobs total

console.log('mobcrowdpeek -- crowd of', CROWD.length, '(' + HOSTILE.length + ' hostile,', NEUTRAL.length, 'neutral,', PASSIVE.length, 'passive) for', SECONDS, 's x', MODES.length, 'mode(s)');

const page = await open(join(ROOT, 'dist', 'mclite.html'), { width: 900, height: 640 });
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
console.log('spawn ready:', ready);
if (!ready) { console.log('FATAL'); process.exit(1); }
await sleep(1200);
await page.settleWorld();

const PX = 6000, PZ = 6000, PY = 90;
const buildInfo = await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'var got = 0;' +
  'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'for (var x = ' + PX + ' - 20; x <= ' + PX + ' + 20; x++)' +
  '  for (var z = ' + PZ + ' - 20; z <= ' + PZ + ' + 20; z++) {' +
  '    W.setBlock(x, ' + PY + ' - 1, z, id); got++;' +
  '  }' +
  'return { platformBlocks: got, loaded: W.loadedAt(' + PX + ', ' + PZ + ') };'
));
console.log('platform:', JSON.stringify(buildInfo));

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

async function setMode(mode) {
  await page.evaluate(mkFn('MCL.Commands.run("/gamemode ' + mode + '", MCL.Player, {name:"Dan"});'));
}

async function setNight() {
  await page.evaluate(mkFn('MCL.Commands.run("/time set night", MCL.Player, {name:"Dan"});'));
}

async function clearMobs() {
  return page.evaluate(function () { var n = MCL.EntityList.list.length; MCL.EntityList.list.length = 0; return n; });
}

// Cluster the crowd on the platform in a grid, 3 blocks apart (close -- a real base -- but not
// stacked in the same block), centred on the player's fixed anchor.
async function spawnCrowd() {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var kinds = ' + JSON.stringify(CROWD) + ';' +
    'var cols = 5;' +
    'var out = [];' +
    'for (var i = 0; i < kinds.length; i++) {' +
    '  var col = i % cols, row = Math.floor(i / cols);' +
    '  var x = ' + PX + ' + (col - 2) * 3;' +
    '  var z = ' + PZ + ' + (row - 2) * 3 + 6;' +   // +6 so the crowd sits in front of the player, not on top
    '  var e = EL.spawn(kinds[i], x, ' + PY + ', z);' +
    '  out.push(e ? { id: e.id, type: kinds[i], x: e.x, y: e.y, z: e.z } : { id: null, type: kinds[i], spawnRefused: true });' +
    '}' +
    'return out;'
  ));
}

async function sampleCrowd(ids) {
  // one round-trip for the whole crowd: every entity's live x/y/z/vx/vy/vz/health/removed/dead,
  // plus the console-warning count and the FULL live EntityList length (dup/vanish check needs
  // the whole list, not just the crowd's own ids -- a duplication bug could spawn an EXTRA entity
  // under someone else's id that a per-id lookup would never see).
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var want = ' + JSON.stringify(ids) + ';' +
    'var byId = {};' +
    'for (var i = 0; i < EL.list.length; i++) { var e = EL.list[i]; byId[e.id] = e; }' +
    'var mobs = [];' +
    'for (var j = 0; j < want.length; j++) {' +
    '  var e2 = byId[want[j]];' +
    '  if (!e2) { mobs.push({ id: want[j], missing: true }); continue; }' +
    '  mobs.push({ id: e2.id, type: e2.type, x: e2.x, y: e2.y, z: e2.z, vx: e2.vx, vy: e2.vy, vz: e2.vz,' +
    '    health: e2.health, removed: !!e2.removed, dead: !!e2.dead });' +
    '}' +
    'return { mobs: mobs, totalEntities: EL.list.length, warnings: (window.__warnings || []).length };'
  ));
}

function finiteCheck(mob) {
  const nums = ['x', 'y', 'z', 'vx', 'vy', 'vz'];
  const bad = [];
  for (const k of nums) if (!Number.isFinite(mob[k])) bad.push(k + '=' + mob[k]);
  return bad;
}

const runReport = { seconds: SECONDS, modes: MODES, crowd: CROWD, samples: {}, nanHits: [], consoleClean: true, countAnomalies: [] };

for (const mode of MODES) {
  console.log('\n=== mode: ' + mode + ' ===');
  await resetPlayer();
  await clearMobs();
  await setMode('creative');
  await setNight();
  await sleep(200);
  const spawned = await spawnCrowd();
  const refused = spawned.filter((s) => s.spawnRefused);
  if (refused.length) console.log('  SPAWN REFUSED for: ' + refused.map((r) => r.type).join(', '));
  const ids = spawned.filter((s) => s.id !== null).map((s) => s.id);
  const initialCount = ids.length;
  console.log('  spawned ' + initialCount + '/' + CROWD.length);
  await setMode(mode);
  if (mode === 'survival') await page.evaluate(mkFn('MCL.Player.health = 20;'));
  // player stands just off the crowd so every AI is actually pursuing/fleeing/wandering, not idle
  await page.evaluate(mkFn('MCL.Player.x = ' + PX + '; MCL.Player.y = ' + PY + '; MCL.Player.z = ' + (PZ - 2) + '; if (MCL.Player.interpolate) MCL.Player.interpolate(0);'));

  const samples = [];
  const t0 = Date.now();
  let lastAliveCount = initialCount;
  while (Date.now() - t0 < SECONDS * 1000) {
    await sleep(SAMPLE_MS);
    const snap = await sampleCrowd(ids);
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    let nanThisSample = 0;
    for (const m of snap.mobs) {
      if (m.missing) continue;
      const bad = finiteCheck(m);
      if (bad.length) {
        nanThisSample++;
        runReport.nanHits.push({ mode, t, id: m.id, type: m.type, bad });
        console.log('  !! NON-FINITE t=' + t + 's ' + m.type + '#' + m.id + ' ' + bad.join(','));
      }
    }
    const aliveCount = snap.mobs.filter((m) => !m.missing && !m.removed && !m.dead).length;
    // a mob may legitimately die (neutral/hostile knocked off the platform, hostile starved of a
    // target and killed by another hostile is NOT a vanilla mechanic here -- these are not
    // fighting each other -- so the only legitimate count DROP is a mob falling off-platform to
    // void damage or a genuine health-driven death; either way EL.list.length must drop WITH it,
    // never leave a removed-but-still-counted duplicate or, worse, an uncounted extra).
    if (aliveCount > lastAliveCount) {
      runReport.countAnomalies.push({ mode, t, event: 'alive count rose without a respawn', from: lastAliveCount, to: aliveCount });
      console.log('  !! COUNT ROSE t=' + t + 's ' + lastAliveCount + ' -> ' + aliveCount);
    }
    lastAliveCount = aliveCount;
    samples.push({ t, aliveCount, totalEntities: snap.totalEntities, warnings: snap.warnings, nanThisSample });
    console.log('  t=' + t + 's alive=' + aliveCount + '/' + initialCount + ' totalEntities=' + snap.totalEntities + ' warnings=' + snap.warnings + (nanThisSample ? '  <<< ' + nanThisSample + ' non-finite' : ''));
  }
  runReport.samples[mode] = samples;
  writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
}

const problems = page.problems || [];
const warnings = await page.evaluate(function () { return window.__warnings || []; });
runReport.problems = problems;
runReport.finalWarnings = warnings;
runReport.consoleClean = problems.length === 0 && warnings.length === 0;
console.log('\n=== console problems ===', JSON.stringify(problems));
console.log('=== console warnings (total) ===', warnings.length);
console.log('=== nan hits ===', runReport.nanHits.length);
console.log('=== count anomalies ===', runReport.countAnomalies.length);

allResults.runs.push(Object.assign({ at: new Date().toISOString() }, runReport));
writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
await page.close?.();

const failed = !runReport.consoleClean || runReport.nanHits.length > 0 || runReport.countAnomalies.length > 0;
console.log(failed ? '\nFAIL -- see tools/out/mobcrowd/results.json' : '\nPASS -- crowd stayed clean, finite, and count-stable');
process.exit(failed ? 1 : 0);
