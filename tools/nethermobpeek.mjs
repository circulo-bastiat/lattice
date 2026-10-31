// nethermobpeek.mjs -- deep live-browser driver for D-709's nether/other hostile slice
// (enderman, witch, piglin, piglin_brute, hoglin, zoglin, slime, magma_cube, phantom,
// silverfish, endermite, blaze, ghast, and zombified_piglin's piglin-side visuals only).
// D-709 did the light spawn/attribute/console-clean pass; this tool does the still-owed DEEP
// pass: 5-angle screenshots, and real ticked AI movement (blocks/s) in BOTH survival and
// creative, with a clean console throughout. Pattern follows tools/petmobpeek.mjs (D-710).
// Each mob is spawned at the SAME fixed platform anchor (player reset first) so a run can be
// split into batches without mobs drifting off the platform.
//
// MCLITE_PRESET=medium node tools/nethermobpeek.mjs [mob1,mob2,...]
import { open, sleep } from './cdp.mjs';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out', 'nethermob');
mkdirSync(OUT, { recursive: true });
function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const RESULTS_PATH = join(OUT, 'results.json');
let allResults = { results: {}, problems: [], warnings: [] };
if (existsSync(RESULTS_PATH)) {
  try { allResults = JSON.parse(readFileSync(RESULTS_PATH, 'utf8')); } catch (e) {}
}

const ALL_MOBS = ['enderman', 'witch', 'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'slime',
  'magma_cube', 'phantom', 'silverfish', 'endermite', 'blaze', 'ghast', 'zombified_piglin'];
const argMobs = process.argv[2] ? process.argv[2].split(',') : null;
const MOBS = argMobs || ALL_MOBS;

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

const PX = 5000, PZ = 5000, PY = 90;
const buildInfo = await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'var got = 0;' +
  'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'for (var x = ' + PX + ' - 18; x <= ' + PX + ' + 18; x++)' +
  '  for (var z = ' + PZ + ' - 18; z <= ' + PZ + ' + 18; z++) {' +
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
await resetPlayer();
await sleep(400);

async function shot(name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
}

async function lookAt(px, py, pz, tx, ty, tz) {
  await page.evaluate(mkFn(
    'var P = MCL.Player;' +
    'P.x = ' + px + '; P.y = ' + py + '; P.z = ' + pz + ';' +
    'var dx = ' + tx + ' - P.x, dz = ' + tz + ' - P.z, dy = ' + ty + ' - P.y;' +
    'var horiz = Math.hypot(dx, dz);' +
    'P.yaw = Math.atan2(dx, -dz);' +
    'P.pitch = Math.atan2(dy, horiz);' +
    'P.vx = P.vy = P.vz = 0;' +
    'if (P.interpolate) P.interpolate(0);'
  ));
}

async function setMode(mode) {
  await page.evaluate(mkFn('MCL.Commands.run("/gamemode ' + mode + '", MCL.Player, {name:"Dan"});'));
}

async function clearMobs() {
  return page.evaluate(function () { var n = MCL.EntityList.list.length; MCL.EntityList.list.length = 0; return n; });
}

async function spawnMob(type, dx, dz) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var x = ' + PX + ' + (' + dx + '), z = ' + PZ + ' + (' + dz + ');' +
    'var e = EL.spawn("' + type + '", x, ' + PY + ', z);' +
    'if (!e) return null;' +
    'return { id: e.id, x: e.x, y: e.y, z: e.z, width: e.width, height: e.height, hasAi: !!e.ai, maxHealth: e.maxHealth };'
  ));
}

async function entityById(id) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var e = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + id + ') { e = EL.list[i]; break; }' +
    'if (!e) return null;' +
    'return { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, health: e.health, target: e.target ? (e.target.type||"player") : null, removed: !!e.removed, dead: !!e.dead, yaw: e.yaw };'
  ));
}

async function hurtById(id) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var e = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + id + ') { e = EL.list[i]; break; }' +
    'if (!e) return null;' +
    'MCL.Combat.hurt(e, 1, undefined, true);' +
    'return { vx: e.vx, vz: e.vz };'
  ));
}

async function playerHealthTo(hp) {
  await page.evaluate(mkFn('MCL.Player.health = ' + hp + ';'));
}

for (const kind of MOBS) {
  console.log('\n=== ' + kind + ' ===');
  await resetPlayer();
  await clearMobs();
  await setMode('creative');
  const info = await spawnMob(kind, 4, 0);
  const res = { spawn: info };
  allResults.results[kind] = res;
  if (!info) { console.log('  SPAWN REFUSED (no motion/dims data) -- substrate gap'); continue; }
  console.log('  spawned:', JSON.stringify(info));

  const cx = info.x, cz = info.z, cy = info.y + info.height / 2;
  await lookAt(cx, cy, cz - 4, cx, cy, cz); await shot(kind + '_front');
  await lookAt(cx + 4, cy, cz, cx, cy, cz); await shot(kind + '_right');
  await lookAt(cx, cy, cz + 4, cx, cy, cz); await shot(kind + '_back');
  await lookAt(cx - 4, cy, cz, cx, cy, cz); await shot(kind + '_left');
  await lookAt(cx, cy + 6, cz, cx, cy, cz); await shot(kind + '_above');

  // wander test: park player far but still on-platform
  await page.evaluate(mkFn('MCL.Player.x = ' + (PX - 16) + '; MCL.Player.z = ' + (PZ - 16) + '; MCL.Player.y = ' + PY + '; if (MCL.Player.interpolate) MCL.Player.interpolate(0);'));
  let before = await entityById(info.id);
  await sleep(3000);
  let after = await entityById(info.id);
  let wander = (before && after) ? Math.hypot(after.x - before.x, after.z - before.z) / 3.0 : null;
  res.wanderSpeed = wander;
  res.wanderBefore = before; res.wanderAfter = after;
  console.log('  wander 3s speed=' + (wander !== null ? wander.toFixed(3) : 'null') + ' blocks/s  before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after));

  for (const mode of ['survival', 'creative']) {
    await setMode(mode);
    if (mode === 'survival') await playerHealthTo(20);
    await page.evaluate(mkFn('MCL.Player.x = ' + cx + '; MCL.Player.z = ' + (cz - 5) + '; MCL.Player.y = ' + cy + '; if (MCL.Player.interpolate) MCL.Player.interpolate(0);'));
    await sleep(400);
    const b2 = await entityById(info.id);
    await sleep(2500);
    const a2 = await entityById(info.id);
    let chaseSpeed = (b2 && a2) ? Math.hypot(a2.x - b2.x, a2.z - b2.z) / 2.5 : null;
    res['chase_' + mode] = { before: b2, after: a2, speed: chaseSpeed, target: a2 && a2.target };
    console.log('  ' + mode + ' 2.5s near-player: speed=' + (chaseSpeed !== null ? chaseSpeed.toFixed(3) : 'null') + ' target=' + (a2 && a2.target));
  }

  await setMode('survival');
  const kb = await hurtById(info.id);
  res.knockback = kb;
  console.log('  knockback after hit:', JSON.stringify(kb));
  await setMode('creative');

  writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
}

const warnings = await page.evaluate(function () { return window.__warnings || []; });
console.log('\n=== console problems ===', JSON.stringify(page.problems));
console.log('=== console warnings ===', JSON.stringify(warnings));
allResults.problems = (allResults.problems || []).concat(page.problems || []);
allResults.warnings = (allResults.warnings || []).concat(warnings || []);
writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
await page.close?.();
process.exit(0);
