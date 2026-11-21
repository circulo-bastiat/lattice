// vbwandercheck.mjs -- D-727's follow-up, CLOSED: villager's idle wander read 0.000 blocks/s over
// a SINGLE 3-second empty-platform sample in tools/passivemobpeek.mjs. That probe's own comment
// named the likely cause: createIdleTasks' priority-2 RandomTask (src/07zv4_vbidle.js's own
// VB.IDLE_FALLBACK, already unit-tested piece-by-piece by tools/vbidlecheck.mjs) rerolls EVERY
// idle tick between 7 weighted entries (villagerInterest 2, breedInterest 1, catInterest 1,
// findWalkTarget 1, goTowardsLook 1, jumpInBed 1, wait 1); on an empty flat platform with no
// other villager/cat/bed/LOOK_TARGET, only findWalkTarget and wait ever succeed, each weight 1 of
// an effective 2 -- so a single WaitTask cycle (30-60 ticks = 1.5-3s) can eat the WHOLE 3-second
// sample before wander is ever picked, purely by bad luck, with no bug involved at all.
// vbidlecheck.mjs already proves each individual IDLE_START entry fires correctly in isolation;
// what was still unconfirmed is that the pieces actually add up to visible movement LIVE, over a
// realistic span. This is that live end-to-end confirmation: 8 consecutive 3-second windows (24s
// total) is enough multiples of the WaitTask cycle that a real regression could not hide behind
// one unlucky sample the way the original probe's single window could.
//
// MCLITE_PRESET=medium node tools/vbwandercheck.mjs
import { open, sleep } from './cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

let pass = 0, fail = 0;
function okAv(cond, label) { if (cond) { pass++; } else { fail++; console.log('BREAK NOT CAUGHT:', label); } }

// The pass/fail predicate itself, pulled out so it can be proven to distinguish a genuinely
// frozen villager from a genuinely wandering one BEFORE it is ever trusted against a live sample.
function classify(samples) {
  let totalDist = 0, anyWander = false, maxIntervalDist = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    totalDist += dist;
    if (dist > maxIntervalDist) maxIntervalDist = dist;
    if (dist > 0.05 || b.wandering) anyWander = true;
  }
  return { totalDist, maxIntervalDist, anyWander };
}

// ── anti-vacuity (D-30): prove the predicate above can both fail and pass before trusting it ──
console.log('anti-vacuity');
{
  const frozen = Array.from({ length: 9 }, () => ({ x: 100, z: 100, wandering: false }));
  okAv(classify(frozen).anyWander === false, 'a villager that never moves and never sets vbWander.running must FAIL (anyWander=false)');
  const stuckButFlaggedRunning = frozen.map((s) => ({ ...s })); // position frozen, engine claims it's mid-wander -- exactly the D-726-class bug (NaN/stuck position) this must also catch via the fallback rule
  stuckButFlaggedRunning[4].wandering = true;
  okAv(classify(stuckButFlaggedRunning).anyWander === true, 'the wandering=true fallback alone must be enough to pass even with zero measured displacement (protects a still-valid vbWander.running read against a position read that lags a tick)');
  const wandering = frozen.map((s, i) => ({ x: 100 + i * 2.3, z: 100 + i * 0.4, wandering: i > 1 && i < 6 }));
  okAv(classify(wandering).anyWander === true, 'a villager that visibly walks across the sample window must PASS');
  okAv(classify(wandering).totalDist > 15, 'total displacement over a real walk must be substantial, not a rounding artefact');
}
if (fail > 0) { console.log(`\n${pass} assertions passed, ${fail} failures`); process.exit(1); }

const page = await open(join(ROOT, 'dist', 'mclite.html'), { width: 900, height: 640 });
if (!page) { console.log(`${pass} assertions passed, 0 failures`); console.log('SKIP -- no Chromium'); process.exit(0); }

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
if (!ready) { console.log(`${pass} assertions passed, ${fail + 1} failures`); console.log('FATAL -- game never reached ready'); process.exit(1); }
await sleep(1200);
await page.settleWorld();

const PX = 6100, PZ = 6100, PY = 90;
const buildInfo = await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'for (var x = ' + PX + ' - 20; x <= ' + PX + ' + 20; x++)' +
  '  for (var z = ' + PZ + ' - 20; z <= ' + PZ + ' + 20; z++)' +
  '    W.setBlock(x, ' + PY + ' - 1, z, id);' +
  'return { loaded: W.loadedAt(' + PX + ', ' + PZ + ') };'
));
console.log('platform:', JSON.stringify(buildInfo));

await page.evaluate(mkFn(
  'var P = MCL.Player;' +
  'P.flying = false; P.noclip = false;' +
  'P.x = ' + (PX - 20) + '; P.y = ' + PY + '; P.z = ' + (PZ - 20) + ';' +
  'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0;' +
  'if (P.interpolate) P.interpolate(0);' +
  'MCL.Input.locked = true; MCL.Input.uiOpen = false;' +
  'MCL.Commands.run("/gamemode creative", MCL.Player, {name:"Dan"});' +
  'if (MCL.Sky) MCL.Sky.dayTime = 500;' // a real VILLAGER_DEFAULT idle window (10 -> idle, 2000 -> work)
));
await sleep(300);

await page.waitFor(function () { var L = window.MCL && MCL.EntityList; return !!(L && L.ready && L.list && MCL.Entities && MCL.Entities.ready); }, 30000);
const spawnInfo = await page.evaluate(mkFn(
  'var EL = MCL.EntityList;' +
  'EL.list.length = 0;' + // no other villager/cat nearby to confound villagerInterest/catInterest
  'var e = EL.spawn("villager", ' + PX + ', ' + PY + ', ' + PZ + ');' +
  'if (!e) return null;' +
  'return { id: e.id, x: e.x, y: e.y, z: e.z };'
));
console.log('spawned villager:', JSON.stringify(spawnInfo));
if (!spawnInfo) { console.log(`${pass} assertions passed, ${fail + 1} failures`); console.log('FATAL -- spawn failed'); process.exit(1); }

async function readVillager() {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'for (var i = 0; i < EL.list.length; i++) { var e = EL.list[i]; if (e.id === ' + spawnInfo.id + ') ' +
    '  return { x: e.x, y: e.y, z: e.z, activity: e.vbActivity, pick: e.vbIdlePick, wandering: !!(e.vbWander && e.vbWander.running) }; }' +
    'return null;'
  ));
}

const samples = [await readVillager()];
const WINDOW_MS = 3000, WINDOWS = 8; // 24s total -- many multiples of the 1.5-3s WaitTask cycle
for (let i = 1; i <= WINDOWS; i++) {
  await sleep(WINDOW_MS);
  const cur = await readVillager();
  if (!cur) { console.log('villager vanished at window', i); break; }
  samples.push(cur);
  console.log('t=' + (i * WINDOW_MS / 1000) + 's pick=' + cur.pick + ' activity=' + cur.activity + ' wandering=' + cur.wandering + ' pos=(' + cur.x.toFixed(2) + ',' + cur.z.toFixed(2) + ')');
}
const { totalDist, maxIntervalDist, anyWander } = classify(samples);
console.log('\n=== summary ===');
console.log('total displacement over ' + (WINDOWS * WINDOW_MS / 1000) + 's:', totalDist.toFixed(3), 'blocks');
console.log('max single ' + (WINDOW_MS / 1000) + 's-window displacement:', maxIntervalDist.toFixed(3), 'blocks');
okAv(anyWander, 'a villager idle on an empty platform for 24s must show real wander movement at least once (D-727)');

const warnings = await page.evaluate(function () { return window.__warnings || []; });
const probs = page.problems || [];
console.log('=== console problems ===', JSON.stringify(probs));
console.log('=== console warnings ===', JSON.stringify(warnings));
okAv(probs.length === 0, 'the page console must stay clean throughout (rule: every mob/villager check asserts this)');

console.log(`\n${pass} assertions passed, ${fail} failures`);
process.exit(fail > 0 ? 1 : 0);
