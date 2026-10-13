// petmobpeek.mjs - throwaway live-browser driver for the D-707 leftover group (cat, ocelot,
// parrot, dolphin, glow_squid, illusioner, ravager). NOT wired into suite.mjs (villagepeek.mjs
// pattern) -- one-off first-pass verification, kept for re-run convenience only.
import { open, sleep } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'out', 'petmob');
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

// Build a private stone platform far from natural spawn/mobs, at fixed coords.
const PX = 4000, PZ = 4000, PY = 90;
const buildInfo = await page.evaluate(mkFn(
  'var W = MCL.World, St = MCL.States;' +
  'var id = St.stateOf("stone");' +
  'var got = 0;' +
  'for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) {' +
  '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
  '  c.state = MCL.CH.GENERATED;' +
  '  W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
  '}' +
  'for (var x = ' + PX + ' - 12; x <= ' + PX + ' + 12; x++)' +
  '  for (var z = ' + PZ + ' - 12; z <= ' + PZ + ' + 12; z++) {' +
  '    W.setBlock(x, ' + PY + ' - 1, z, id); got++;' +
  '  }' +
  'return { platformBlocks: got, loaded: W.loadedAt(' + PX + ', ' + PZ + ') };'
));
console.log('platform:', JSON.stringify(buildInfo));

await page.evaluate(mkFn(
  'var P = MCL.Player;' +
  'P.flying = false; P.noclip = false;' +
  'P.x = ' + PX + '; P.y = ' + PY + '; P.z = ' + PZ + ';' +
  'P.vx = P.vy = P.vz = 0; P.yaw = 0; P.pitch = 0;' +
  'if (P.interpolate) P.interpolate(0);' +
  'MCL.Input.locked = true; MCL.Input.uiOpen = false;'
));
await sleep(600);

async function shot(name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
}

/** Look from (px,pz) at eye height toward (tx,tz) at target eye height, using this engine's own
 *  yaw convention (Ai.stepToward's own comment: yaw = atan2(dx, -dz), yaw 0 = north). */
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
  await page.evaluate(mkFn(
    'MCL.Commands.run("/gamemode ' + mode + '", MCL.Player, {name:"Dan"});'
  ));
}

async function clearMobs() {
  return page.evaluate(function () {
    var EL = MCL.EntityList;
    var n = EL.list.length;
    EL.list.length = 0;
    return n;
  });
}

async function spawnMob(type, dx, dz) {
  return page.evaluate(mkFn(
    'var P = MCL.Player, EL = MCL.EntityList;' +
    'var x = P.x + (' + dx + '), z = P.z + (' + dz + ');' +
    'var e = EL.spawn("' + type + '", x, ' + PY + ', z);' +
    'if (!e) return null;' +
    'return { id: e.id, x: e.x, y: e.y, z: e.z, width: e.width, height: e.height, hasAi: !!e.ai, maxHealth: e.maxHealth, tamed: e.tamed };'
  ));
}

async function entityById(id) {
  return page.evaluate(mkFn(
    'var EL = MCL.EntityList;' +
    'var e = null;' +
    'for (var i=0;i<EL.list.length;i++) if (EL.list[i].id === ' + id + ') { e = EL.list[i]; break; }' +
    'if (!e) return null;' +
    'return { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, health: e.health, target: e.target ? e.target.type||"player" : null, removed: !!e.removed, yaw: e.yaw };'
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

const MOBS = ['cat', 'ocelot', 'parrot', 'dolphin', 'glow_squid', 'illusioner', 'ravager'];
const results = {};

for (const kind of MOBS) {
  console.log('\n=== ' + kind + ' ===');
  await clearMobs();
  const info = await spawnMob(kind, 3, 0);
  results[kind] = { spawn: info };
  if (!info) { console.log('  SPAWN REFUSED (no motion/dims data) -- substrate gap'); continue; }
  console.log('  spawned:', JSON.stringify(info));

  const cx = info.x, cz = info.z, cy = info.y + info.height / 2;
  // front, right, back, left, above
  await lookAt(cx, cy, cz - 4, cx, cy, cz); await shot(kind + '_front');
  await lookAt(cx + 4, cy, cz, cx, cy, cz); await shot(kind + '_right');
  await lookAt(cx, cy, cz + 4, cx, cy, cz); await shot(kind + '_back');
  await lookAt(cx - 4, cy, cz, cx, cy, cz); await shot(kind + '_left');
  await lookAt(cx, cy + 5, cz, cx, cy, cz); await shot(kind + '_above');

  // measured speed: track position over 3s of real ticking, whatever AI is doing
  const before = await entityById(info.id);
  await sleep(3000);
  const after = await entityById(info.id);
  let dist = null, speed = null;
  if (before && after) {
    dist = Math.hypot(after.x - before.x, after.z - before.z);
    speed = dist / 3.0;
  }
  results[kind].move3s = { before, after, dist, speed };
  console.log('  3s move: dist=' + (dist && dist.toFixed(3)) + ' speed=' + (speed && speed.toFixed(3)) + ' blocks/s');

  // knockback
  const kb = await hurtById(info.id);
  results[kind].knockback = kb;
  console.log('  knockback after hit:', JSON.stringify(kb));

  // gamemode-target test for illusioner/ravager only (attack AI)
  if (kind === 'illusioner' || kind === 'ravager') {
    for (const mode of ['survival', 'creative']) {
      await setMode(mode);
      await lookAt(cx, cy, cz - 3, cx, cy, cz);
      await page.evaluate(mkFn('MCL.Player.x = ' + (cx) + '; MCL.Player.z = ' + (cz - 3) + '; MCL.Player.y = ' + cy + ';'));
      await sleep(2500);
      const t = await entityById(info.id);
      results[kind]['target_' + mode] = t && t.target;
      console.log('  ' + mode + ' target after 2.5s near player:', t && t.target);
    }
    await setMode('creative');
  }
}

const warnings = await page.evaluate(function () { return window.__warnings || []; });
console.log('\n=== console problems ===', JSON.stringify(page.problems));
console.log('=== console warnings ===', JSON.stringify(warnings));
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, problems: page.problems, warnings }, null, 2));
await page.close?.();
process.exit(0);
