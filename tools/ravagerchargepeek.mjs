// ravagerchargepeek.mjs - throwaway live-browser driver, session 141 (orchestrator's own unit).
// Chases down D-710's flagged-not-confirmed finding: "One browser run showed a ravager drifting
// instead of charging its target, but a clean node-level replication of the same AI converged
// correctly". Samples a live-spawned ravager's position/velocity/target every 400ms for 6s while
// a survival player stands nearby, to see whether it closes distance (charging, correct) or
// wanders without closing distance (a real bug). NOT wired into suite.mjs -- one-off repro tool,
// same throwaway-driver pattern as tools/petmobpeek.mjs (D-710).
import { open, sleep } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out', 'ravagercharge');
mkdirSync(OUT, { recursive: true });
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

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
await sleep(1500);
await page.settleWorld();

const PX = 4200, PZ = 4200, PY = 90;
const buildInfo = await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'var got = 0;' +
  'for (var x = ' + PX + ' - 16; x <= ' + PX + ' + 16; x++)' +
  '  for (var z = ' + PZ + ' - 16; z <= ' + PZ + ' + 16; z++) {' +
  '    W.setBlock(x, ' + PY + ' - 1, z, id); got++;' +
  '  }' +
  'return { platformBlocks: got, loaded: W.loadedAt(' + PX + ', ' + PZ + ') };'
));
console.log('platform:', JSON.stringify(buildInfo));

async function setMode(mode) {
  await page.evaluate(mkFn('MCL.Commands.run("/gamemode ' + mode + '", MCL.Player, {name:"Dan"});'));
}
async function clearMobs() {
  return page.evaluate(function () { var EL = MCL.EntityList; var n = EL.list.length; EL.list.length = 0; return n; });
}
async function placePlayer(x, y, z) {
  await page.evaluate(mkFn(
    'var P = MCL.Player;' +
    'P.flying = false; P.noclip = false;' +
    'P.x = ' + x + '; P.y = ' + y + '; P.z = ' + z + ';' +
    'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0;' +
    'if (P.interpolate) P.interpolate(0);' +
    'MCL.Input.locked = true; MCL.Input.uiOpen = false;'
  ));
}
async function spawnRavager(dx, dz) {
  return page.evaluate(mkFn(
    'var P = MCL.Player, EL = MCL.EntityList;' +
    'var x = P.x + (' + dx + '), z = P.z + (' + dz + ');' +
    'var e = EL.spawn("ravager", x, ' + PY + ', z);' +
    'if (!e) return null;' +
    'return { id: e.id, x: e.x, y: e.y, z: e.z, hasAi: !!e.ai, maxHealth: e.maxHealth };'
  ));
}
async function sampleById(id) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList, P = MCL.Player;' +
    'var e = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + id + ') { e = EL.list[i]; break; }' +
    'if (!e) return null;' +
    'var dist = Math.hypot(e.x - P.x, e.z - P.z);' +
    'return { x: e.x, z: e.z, vx: e.vx, vz: e.vz, distToPlayer: dist, target: e.target ? (e.target.type||"player") : null, ravagerAttackTick: e.ravagerAttackTick||0, ravagerStunTick: e.ravagerStunTick||0 };'
  ));
}

await setMode('survival');
await clearMobs();
await placePlayer(PX, PY, PZ);
const info = await spawnRavager(10, 0);
console.log('spawned:', JSON.stringify(info));
if (!info) { console.log('FATAL: spawn refused'); process.exit(1); }

const samples = [];
for (let i = 0; i < 16; i++) {
  const s = await sampleById(info.id);
  samples.push(s);
  await sleep(400);
}

const distStart = samples[0] && samples[0].distToPlayer;
const distEnd = samples[samples.length - 1] && samples[samples.length - 1].distToPlayer;
const minDist = Math.min(...samples.filter(Boolean).map(s => s.distToPlayer));
const everTargeted = samples.some(s => s && s.target);
console.log('\n=== ravager charge summary ===');
console.log('distStart:', distStart, 'distEnd:', distEnd, 'minDist:', minDist, 'everTargeted:', everTargeted);
console.log('verdict:', (everTargeted && minDist < distStart - 2) ? 'CHARGES CORRECTLY (closed distance while targeting)' : 'DID NOT CLOSE DISTANCE -- possible real bug');

const warnings = await page.evaluate(function () { return window.__warnings || []; });
console.log('=== console problems ===', JSON.stringify(page.problems));
console.log('=== console warnings ===', JSON.stringify(warnings));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ info, samples, distStart, distEnd, minDist, everTargeted, problems: page.problems, warnings }, null, 2));
await page.close?.();
process.exit(0);
