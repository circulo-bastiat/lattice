#!/usr/bin/env node
// spritecheck.mjs — PLAN G17d (D-342): A DROPPED STICK IS ON THE SCREEN, AND IT IS VANILLA'S.
//
//   MCLITE_PRESET=medium node tools/spritecheck.mjs [dist/mclite.html]
//
// ⚠⚠ **WHY A BROWSER CHECK AND NOT A HEADLESS ONE.** Because the thing that was wrong was a
// picture. `ER.OWED_ITEM` named "sprite items (no block model)" as a written-down deviation and
// every headless check stayed green while a dropped stick, apple, ingot and diamond were
// invisible. D-303 and D-304 are the same lesson twice: a stage whose output is a moving picture
// and whose checks hold only numbers is a stage that can ship drawing nothing.
//
// ⚠ EVERY PIXEL CLAIM IS MADE AGAINST A CONTROL. Two frames of a live game are never identical —
// chunks arrive, the sun moves — so "it appeared" is "the frame changed more than doing nothing
// changes it", never a bare threshold (D-234).
//
// ⚠ AND EVERY NUMBER IS GRADED AGAINST THE JAR, not against a literal typed here. The ground
// transforms, the span sides and `java.util.Random`'s output all come out of
// `tools/golden/itemmodel-1.18.2.tsv`, which `tools/extract-itemmodel.mjs` reads from the 1.18.2
// bytecode. D-305: never let a check own a number the code owns — and `guicheck` pinning the
// hotbar selector at 24x24 is what happens when it does. A wrong check turns a bug into a
// requirement and makes the correct value fail.
//
// ⚠⚠ **AND IT ENTERS THROUGH THE GAME, NOT THROUGH THE GENERATOR.** `iconcheck` calls
// `Hud.buildItemIcons()` itself and so proved the builder while the boot chain never called it
// with its input ready — the sheet was empty in the running game for a whole session. A check
// that CALLS the function under test has not tested the thing that is supposed to call it. So
// §3 here spawns an item with `EntityList.spawn` and reads what the FRAME did.

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   x ' + m); } };

// ── the referee table ────────────────────────────────────────────────────────────────────────
const TSV = join(ROOT, 'tools', 'golden', 'itemmodel-1.18.2.tsv');
const rows = readFileSync(TSV, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const REF = {
  ground: Object.fromEntries(rows.filter((r) => r[0] === 'ground')
    .map((r) => [r[1], { ty: Number(r[2]), scale: Number(r[3]) }])),
  sides: rows.filter((r) => r[0] === 'side').map((r) => ({ name: r[1], dir: r[2] })),
  jrand: rows.filter((r) => r[0] === 'jrand').map((r) => [Number(r[1]), r[2].split(',').map(Number)]),
};

function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { differing: a.width * a.height, total: 1 };
  let differing = 0, total = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
              Math.abs(a.data[i + 2] - b.data[i + 2]);
    total++;
    if (d > 12) differing++;
  }
  return { differing, total };
}

const page = await open(FILE, {
  port: 9441, width: 960, height: 540,
  // the same steadying the entity check needs: a moving sun is worth more pixels than the item
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  spritecheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () {
    if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } }
    // ⚠ D-407 (the D-397 shape): natural spawning is live, and this check counts "one entity
    // drawn". Hold Spawn off and clear what boot already spawned. Found by the first `.chromium/` sweep.
    if (MCL.Spawn) MCL.Spawn.ready = false;
    if (MCL.EntityList) MCL.EntityList.clear();
    // #1677: mob spawners near spawn show virtual cage mobs (#168) that `drawn` counts but EntityList never holds
    if (MCL.EntityRender) MCL.EntityRender.spawnerDisplays = function () { return []; };
  });
  await sleep(6000);

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return toRgba(decodePng(Buffer.from(s.data, 'base64')));
  };
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);

  /**
   * ⚠⚠ **WAIT FOR THE PICTURE TO GO QUIET, NOT FOR A CLOCK AND NOT FOR A PROXY** (D-321).
   * Three versions, and the last one is the point:
   *   1. `sleep(6000)`. The control came out at 0 changed pixels and the stick at 78, and the
   *      check went green. It was a LULL: chunks were still streaming — 234, 278, 331, 378 over
   *      the next twelve frames — and the very next measurement reported 116,345 changed pixels
   *      for a 78-pixel object. A control measured in a lull is not a control; it is a coin that
   *      came up heads.
   *   2. Poll `World.chunks.size` and `Gfx.meshes.size` until both hold still. Those are a
   *      PROXY for "the picture has stopped changing", and at medium the mesh count never
   *      settles at all — it churns as sections are rebuilt — so this timed out after sixty
   *      seconds on a world that was, visually, perfectly still.
   *   3. What is here: compare two actual frames and wait until they agree. The check needs a
   *      still PICTURE, so it waits for a still picture. The proxy was one inference away from
   *      the thing that mattered, and one inference was enough to be wrong.
   */
  /**
   * Two consecutive frames that AGREE, plus the number they disagree by — the control.
   *
   * ⚠⚠ **WAIT FOR THE PICTURE, NOT FOR A CLOCK AND NOT FOR A PROXY** (D-321). Four versions,
   * and the last one is the point:
   *   1. `sleep(6000)`. The control came out at 0 changed pixels and the stick at 78, and the
   *      check went green. It was a LULL: chunks were still streaming — 234, 278, 331, 378 over
   *      the next twelve frames — and the very next measurement reported 116,345 changed pixels
   *      for a 78-pixel object. A control measured in a lull is not a control; it is a coin that
   *      came up heads.
   *   2. Poll `World.chunks.size` and `Gfx.meshes.size` until both hold still. Those are a
   *      PROXY for "the picture has stopped changing", and at medium the mesh count never
   *      settles at all — it churns as sections are rebuilt — so this timed out after sixty
   *      seconds on a world that was, visually, perfectly still.
   *   3. Wait once for two frames to agree, then measure later. The world went quiet, the check
   *      recorded it, and by the time the real control was taken it was drifting by 1,605 px
   *      again. A quiet moment is not a quiet world.
   *   4. What is here: the control IS the wait. It keeps taking pairs until one agrees, and
   *      hands back the second frame of that very pair, so the picture the measurement is made
   *      against is the picture that was just proved still. There is no gap to drift in.
   */
  /**
   * Two consecutive frames that AGREE, plus the number they disagree by — the control.
   *
   * ⚠⚠ **WAIT FOR THE PICTURE, NOT FOR A CLOCK AND NOT FOR A PROXY** (D-321). Four versions,
   * and the last one is the point:
   *   1. `sleep(6000)`. The control came out at 0 changed pixels and the stick at 78, and the
   *      check went green. It was a LULL: chunks were still streaming — 234, 278, 331, 378 over
   *      the next twelve frames — and the very next measurement reported 116,345 changed pixels
   *      for a 78-pixel object. A control measured in a lull is not a control; it is a coin that
   *      came up heads.
   *   2. Poll `World.chunks.size` and `Gfx.meshes.size` until both hold still. Those are a
   *      PROXY for "the picture has stopped changing", and at medium the mesh count never
   *      settles at all — it churns as sections are rebuilt — so this timed out after sixty
   *      seconds on a world that was, visually, perfectly still.
   *   3. Wait once for two frames to agree, then measure later. The world went quiet, the check
   *      recorded it, and by the time the real control was taken it was drifting by 1,605 px
   *      again. A quiet moment is not a quiet world.
   *   4. What is here: the control IS the wait. It keeps taking pairs until one agrees, and
   *      hands back the second frame of that very pair, so the picture the measurement is made
   *      against is the picture that was just proved still. There is no gap to drift in.
   */
  const quietPair = async () => {
    let prev = null, best = Infinity;
    for (let i = 0; i < 40; i++) {
      await frames(4);
      const now = await shot();
      if (prev) {
        const d = compare(prev, now);
        if (d.differing < best) best = d.differing;
        if (d.differing * 2000 < d.total) return { base: now, control: d, tries: i };
      }
      prev = now;
    }
    return { base: prev, control: { differing: best, total: prev ? prev.width * prev.height : 1 }, tries: 40 };
  };

  /**
   * waitMeshSettled() — the honest version of "the world is quiet": ask the ENGINE whether the
   * chunks around the camera still have dirty (unmeshed) sections, the same `c.meshDirty[0]`
   * bitmask soakcheck.mjs's own §5 already reads, rather than inferring settlement from a pair
   * of screenshots. D-234's control-IS-the-wait trick (above) proves two frames AGREE, but a big
   * batch of section meshes can still land in the handful of frames between one `quietPair()` and
   * a later comparison — cdp.mjs's `settleWorld` comment documents that meshing "never settles",
   * it only slows — and no pixel-diff threshold can be sized against a one-off burst like that.
   * This waits for the real signal (dirty sections within a small disc around the camera) to
   * actually reach zero before any reference screenshot is trusted, so a comparison against it
   * later is a comparison against a world that had truly stopped changing, not a world that
   * merely held still for one sampled instant.
   */
  const waitMeshSettled = () => page.waitFor(new Function(
    'var W = MCL.World; if (!W) return 1;' +
    'var cx = Math.floor(MCL.Player.x) >> 4, cz = Math.floor(MCL.Player.z) >> 4;' +
    'var dirty = 0;' +
    'W.chunks.forEach(function (c) {' +
    '  var dx = c.cx - cx, dz = c.cz - cz;' +
    '  if (dx * dx + dz * dz > 36) return;' +
    '  if (c.meshDirty && c.meshDirty[0]) dirty++;' +
    '});' +
    'return dirty === 0 ? 1 : 0;'), 20000);

  // ── 1. the payload is there at all ──────────────────────────────────────────────────────
  console.log('\n1. the sprite models are in the shipped file');
  const p = await ev('return { part0: MCL.DATA.spritePart0 | 0, n: MCL.DATA.spriteParts | 0,' +
    ' parts: MCL.Reg.partCount | 0, alpha: (MCL.DATA.spriteAlpha || []).length,' +
    ' itemTile0: MCL.Atlas.itemTile0 | 0, itemTiles: MCL.Atlas.itemTiles | 0,' +
    ' beParts: MCL.DATA.beParts | 0 };');
  ok(p && p.n > 0, 'the geometry payload carries sprite parts (' + (p ? p.n : '?') + ')');
  // ⚠ NO LONGER "the LAST parts in the array" (PASS 15 JOB 3): `bePart0`/`beParts` are appended
  // AFTER the sprite parts now (D-341's trick a third time), so the sprite range is followed by
  // the be-item range, not by the end of the array. What must still hold — the thing this
  // assertion actually exists to protect — is that NO EARLIER part index moved: the sprite
  // range plus whatever be-item range follows it accounts for every part after `spritePart0`.
  ok(p && p.part0 > 0 && p.part0 + p.n + p.beParts === p.parts,
     'and no EARLIER block part index moved — the sprite range plus whatever follows it (be-items) reaches the end',
     p && p.part0 + '+' + p.n + '+' + p.beParts + ' vs ' + p.parts);
  ok(p && p.alpha === p.n, 'every sprite has a render-pass class (' + (p ? p.alpha : '?') + ')');
  ok(p && p.itemTiles === p.n,
     'and one atlas layer each, appended after the block layers at ' + (p ? p.itemTile0 : '?'));

  // ── 2. the constants, against the jar ───────────────────────────────────────────────────
  console.log('\n2. the numbers match the 1.18.2 bytecode, not a literal in this file');
  const g = await ev('return { block: MCL.EntityRender.GROUND, sprite: MCL.EntityRender.GROUND_SPRITE,' +
    ' liftB: MCL.EntityRender.itemLift(0, 0, 0, MCL.EntityRender.GROUND),' +
    ' liftS: MCL.EntityRender.itemLift(0, 0, 0, MCL.EntityRender.GROUND_SPRITE) };');
  const rb = REF.ground['block/block'], rs = REF.ground['item/generated'];
  ok(!!rb && !!rs, 'the referee table carries both ground transforms');
  ok(g && rb && Math.abs(g.block.scale - rb.scale) < 1e-9 && Math.abs(g.block.ty - rb.ty / 16) < 1e-9,
     'the BLOCK ground transform is the jar\'s (scale ' + (rb && rb.scale) + ', ty ' + (rb && rb.ty) + '/16)',
     g && JSON.stringify(g.block));
  ok(g && rs && Math.abs(g.sprite.scale - rs.scale) < 1e-9 && Math.abs(g.sprite.ty - rs.ty / 16) < 1e-9,
     'the SPRITE ground transform is the jar\'s (scale ' + (rs && rs.scale) + ', ty ' + (rs && rs.ty) + '/16)',
     g && JSON.stringify(g.sprite));
  ok(g && rs && rb && rs.scale !== rb.scale,
     'and they are DIFFERENT — a dropped stick is not a dropped block\'s size');

  // java.util.Random, against a real JVM's output
  const jr = await ev('var out = [];' +
    'var seeds = ' + JSON.stringify(REF.jrand.map((r) => r[0])) + ';' +
    'for (var i = 0; i < seeds.length; i++) {' +
    '  var r = new MCL.EntityRender.JRand(seeds[i]), v = [];' +
    '  for (var j = 0; j < 8; j++) v.push(r.nextFloat());' +
    '  out.push(v); }' +
    'return out;');
  let jrBad = 0, jrN = 0;
  for (let i = 0; i < REF.jrand.length; i++) {
    for (let j = 0; j < 8; j++) { jrN++; if (Math.abs(jr[i][j] - REF.jrand[i][1][j]) > 1e-6) jrBad++; }
  }
  ok(jrN > 0 && jrBad === 0,
     'ER.JRand reproduces java.util.Random exactly (' + jrN + ' draws from a real JVM)',
     jrBad + ' differ');

  // ── 2b. THE LOOK VECTOR IS ONE VECTOR ───────────────────────────────────────────────────
  // ⚠⚠ Found while chasing the invisible stick, and worth more than the stick: the player had
  // THREE hand-written copies of the look vector and one of them had the wrong sign. `retarget`
  // and the entity pick used `+sin(pitch)`, agreeing with `Cam.forward` and with 10_camera.js's
  // own comment ("+pitch looks up"); `dropHeld` used `-sin(pitch)`. A player looking up and
  // pressing Q threw the item at the floor. Nothing reported it, because a dropped item goes
  // SOMEWHERE either way and "somewhere" looks like physics. These assertions are why it cannot
  // come back: the drop velocity must point along the camera's own forward vector.
  console.log('\n2b. the player, the crosshair and a thrown item all agree on which way is forward');
  const look = await ev(
    'var P = MCL.Player, C = MCL.Cam, out = {};' +
    'var poses = [[0, 0], [1.1, 0.4], [-2.3, -0.7], [0.5, 1.2]];' +
    'out.rows = poses.map(function (yp) {' +
    '  P.yaw = yp[0]; P.pitch = yp[1];' +
    '  var f = P.lookVec().slice();' +
    '  var cam = { yaw: yp[0], pitch: yp[1], fwd: [0, 0, 0] };' +
    '  var c = C.forward(cam).slice();' +
    '  return { f: f, c: c };' +
    '});' +
    // and the thrown item: give the player a stack, aim UP, drop it, read the velocity
    'P.yaw = 0; P.pitch = 1.2;' +
    'if (MCL.Commands) { MCL.Commands.run("/give @s stone 4", P, {}); P.syncHotbar(); }' +
    'P.slot = 0;' +
    'var before = MCL.EntityList.list.length;' +
    'var e = P.dropHeld(false);' +
    'var f2 = P.lookVec();' +
    'out.drop = e ? { vx: e.vx, vy: e.vy, vz: e.vz, f: [f2[0], f2[1], f2[2]],' +
    '                 speed: P.DROP_SPEED, lift: P.DROP_LIFT } : null;' +
    'out.spawnedOne = MCL.EntityList.list.length === before + 1;' +
    'MCL.EntityList.list.length = 0;' +
    'P.pitch = 0; P.yaw = 0;' +
    'return out;');
  for (let i = 0; i < (look ? look.rows.length : 0); i++) {
    const r = look.rows[i];
    ok(Math.abs(r.f[0] - r.c[0]) < 1e-9 && Math.abs(r.f[1] - r.c[1]) < 1e-9 &&
       Math.abs(r.f[2] - r.c[2]) < 1e-9,
       'Player.lookVec is the camera\'s own forward vector at pose ' + i,
       JSON.stringify(r));
  }
  ok(look && look.spawnedOne, 'dropping the held stack spawns exactly one item entity');
  const d = look && look.drop;
  ok(!!d, 'and it comes out with a velocity');
  if (d) {
    // the wobble is random and small; the DIRECTION of the deterministic part is what matters
    const along = d.vx * d.f[0] + d.vz * d.f[2];
    ok(along > 0, 'thrown FORWARD along the look vector, not backwards (' + along.toFixed(4) + ')');
    ok(d.f[1] > 0.5, 'the test pose really is looking upwards (' + d.f[1].toFixed(3) + ')');
    // vy = f[1]*speed + lift + a random term in [-0.1, 0.1]; looking up it must clear the lift
    ok(d.vy > d.lift,
       'AND UPWARDS: an item thrown while looking up goes up (vy ' + d.vy.toFixed(4) +
       ' vs a lift of ' + d.lift + ')');
  }

  // ── 3. a dropped stick is ON THE SCREEN ─────────────────────────────────────────────────
  console.log('\n3. a dropped stick reaches the screen');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  // ⚠ THE WAIT LIVES IN `tools/cdp.mjs` NOW (D-345), because `g17cbcheck` had the same fault
  // latent in it and started failing the day the shipped file grew by 240 KB and the boot
  // timing shifted. A control measured in a lull is not a control, and that is true of every
  // picture check here, not just this one.
  const capped = await page.settleWorld();
  console.log('   stream capped at ' + capped + ' columns');
  ok(capped > 100, 'the world finished streaming in');

  // ⚠⚠ **PUT IT WHERE THE CAMERA CAN SEE IT, DO NOT HOPE IT IS IN SHOT** (the spawn-dependence
  // rule). This took three goes and each one is worth writing down:
  //   1. 1.6 m ahead at knee height, camera left at pitch 0 — which points at the HORIZON while
  //      the item lies on the floor. One spawn clipped 78 pixels of it into the bottom of the
  //      frame and the check went green; the next contributed ZERO and it failed on working
  //      code. A check that depends on where the player happened to spawn measures the world.
  //   2. Let it fall, read where it rests, aim at it. Better — and still wrong: from 1.2 m away
  //      the camera pitches almost straight down, the grass block at the player's feet fills the
  //      frame, and the item is BEHIND it. The renderer submitted 500 triangles for a picture
  //      with nothing in it, which is the most misleading combination available: the numbers
  //      said drawn, the pixels said nothing, and both were telling the truth.
  //   3. What is here: `e.gravity = 0` so the item stays in the air at EYE HEIGHT, straight
  //      ahead, against open sky and distant terrain. Gravity is a per-entity field the engine
  //      already honours — the item is held still, not faked — and the camera keeps pitch 0.
  // ⚠ A check may arrange the shot. It may not arrange the answer: the geometry, the atlas
  // layer, the scale and the pass are all exactly what a dropped stick gets in play.
  const spawned = await ev(
    'var P = MCL.Player, IT = MCL.Items, EL = MCL.EntityList, ER = MCL.EntityRender;' +
    'var id = IT.of("stick");' +
    // ⚠⚠ **ASK THE ENGINE WHICH WAY IS FORWARD** (D-343). This read
    // `dx = -sin(yaw), dz = cos(yaw)`, which is forward REVERSED: at yaw 0 the camera looks
    // -Z and that formula points at +Z. So the item was spawned BEHIND the camera, every time.
    // The renderer dutifully built it, submitted a hundred triangles for it and reported them,
    // and the frame was empty — numbers and pixels both telling the truth about different
    // things. An hour went into the renderer before the convention was questioned. A check must
    // never carry its own copy of a convention the engine owns.
    'var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec();' +
    'var e = EL.spawn("item", P.x + f[0] * 1.5, eye - 0.25, P.z + f[2] * 1.5, { item: { i: id, n: 1 } });' +
    'if (!e) return null;' +
    'e.count = 1; e.vx = 0; e.vy = 0; e.vz = 0; e.pickupDelay = 32767; e.gravity = 0;' +
    'window.__stick = e;' +
    'var tiles = ER.itemLayers(id);' +
    'return { id: id, tiles: tiles, part: ER.spritePartOf(tiles[0]),' +
    '         quads: ER.partQuads(ER.spritePartOf(tiles[0])),' +
    '         isBlock: IT.isBlock(id), state: ER.stateOf(e) };');
  ok(!!spawned, 'an item entity holding a stick spawns');
  ok(spawned && spawned.tiles.length === 1, 'a stick has one sprite layer');
  ok(spawned && spawned.part >= 0, 'and a geometry part for it (' + (spawned && spawned.part) + ')');
  ok(spawned && spawned.quads > 2,
     'whose model is more than the two flat faces — it is EXTRUDED (' + (spawned && spawned.quads) + ' quads)');
  ok(spawned && spawned.state === 0,
     'and it has no block state, which is why it used to be invisible');

  // ⚠ WAIT FOR THE STATE — "it has stopped moving" — never for a duration (D-321).
  const rested = await page.waitFor(function () {
    var e = window.__stick;
    if (!e || e.removed) return 0;
    if (window.__ry === e.y) { window.__rn = (window.__rn | 0) + 1; } else { window.__rn = 0; }
    window.__ry = e.y;
    return (window.__rn | 0) >= 3 ? 1 : 0;
  }, 20000);
  ok(!!rested, 'and it holds still in the air where the camera is pointed');

  const aim = await ev(
    'var P = MCL.Player, e = window.__stick;' +
    'var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);' +
    'var dx = e.x - P.x, dz = e.z - P.z, dy = e.y - eye;' +
    'var h = Math.sqrt(dx * dx + dz * dz);' +
    'return { pitch: +P.pitch.toFixed(4), dist: +h.toFixed(3), drop: +dy.toFixed(3) };');
  console.log('   aimed: pitch ' + (aim && aim.pitch) + ' at ' + (aim && aim.dist) +
              ' m, ' + (aim && aim.drop) + ' m from the eye');
  ok(aim && aim.dist > 0.5 && aim.dist < 4, 'it is in front of the camera at a sensible distance');
  ok(aim && Math.abs(aim.drop) < 0.5, 'and level with the eye, not on the floor behind a block');
  await frames(4);

  // control, appearance and removal are all measured HERE, back to back, against one another:
  // the stick is taken out and put back rather than the world being re-measured minutes later.
  // ⚠ ONLY the stick is kept: structure generation keeps adding golems and loot items as chunks
  // load after boot's clear(), and "one entity drawn" counts the stick, not the world.
  await ev('window.__saved = [window.__stick]; MCL.EntityList.list.length = 0; return 1;');
  await waitMeshSettled();
  const quiet = await quietPair();
  const base2 = quiet.base, control = quiet.control;
  console.log('   control: ' + control.differing + ' px of ' + control.total +
              ' (after ' + quiet.tries + ' tries)');
  ok(control.differing * 2000 < control.total,
     'the world is quiet enough to measure a small object against (' + control.differing + ' px)');

  await ev('MCL.EntityList.list.push.apply(MCL.EntityList.list, window.__saved); return 1;');
  await frames(6);

  const built = await ev('var P = MCL.Player; MCL.EntityList.list.length = 0; MCL.EntityList.list.push(window.__stick);' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return b ? { drawn: b.drawn, quads: b.quads, clipped: b.clipped } : null;');
  ok(!!built, 'the frame built geometry for it');
  ok(built && built.drawn === 1, 'one entity drawn (' + (built && built.drawn) + ')');
  const totalQuads = built ? built.quads.reduce((a, b) => a + b, 0) : 0;
  ok(totalQuads > 2, 'and its quads are in the stream (' + totalQuads + ')');
  ok(built && built.clipped === 0, 'nothing was clipped');

  const withStick = await shot();
  const appear = compare(base2, withStick);
  console.log('   appearing: ' + appear.differing + ' px');
  ok(appear.differing > control.differing * 3 && appear.differing > 40,
     'the stick CHANGED THE PICTURE (' + appear.differing + ' px vs a control of ' + control.differing + ')');

  await ev('MCL.EntityList.list.length = 0; return 1;');
  await frames(6);
  const gone = await shot();
  const removal = compare(withStick, gone);
  console.log('   removing:  ' + removal.differing + ' px');
  okAv(removal.differing > control.differing * 3 && removal.differing > 40,
       'taking the stick away changes the picture more than doing nothing does (' +
       removal.differing + ' vs a control of ' + control.differing + ')');
  // ⚠ AN ENGINE-STATE CHECK, NOT A PIXEL ONE (same fix, same reason, as g18ccheck.mjs's and
  // becheck.mjs's identical assertions): `base2` is a stale control by the time `gone` is shot,
  // and this world's own background section-mesh churn (07_world.js's per-frame budget;
  // cdp.mjs's `settleWorld` comment -- it never fully stops, only slows) can repaint an
  // UNBOUNDED number of pixels elsewhere in frame between two shots, up to and including the
  // whole screen on one measured run, no matter how the threshold is scaled. The actual claim
  // -- "removing the stick leaves nothing behind" -- is a fact about the renderer's own state:
  // `EntityList.list` was cleared above, so `ER.build` must now draw nothing at all, which is
  // exactly what it is asked here, directly, with no screenshot in between.
  const afterRemoval = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { built: !!b, drawn: b ? b.drawn : 0 };');
  console.log('   after removal: ER.build ' + (afterRemoval && afterRemoval.built ? ('drawn=' + afterRemoval.drawn) : 'null (nothing to draw)'));
  okAv(afterRemoval && (!afterRemoval.built || afterRemoval.drawn === 0),
       'and with the stick removed, ER.build draws nothing at all — no leftover stick geometry',
       afterRemoval && JSON.stringify(afterRemoval));
  await ev('MCL.EntityList.list.push.apply(MCL.EntityList.list, window.__saved); return 1;');
  await frames(4);

  // ── 3b. a BOAT is on the screen (G18a-1, #209) ─────────────────────────────────────────
  // `ER.OWED` carried 'boat — G17c': a spawned boat was invisible and every headless check stayed
  // green. This spawns one (gravity held 0, straight ahead at eye height, the stick's own recipe),
  // asserts pixels, then that the wood texture and the paddle animation each CHANGE them.
  console.log('\n3b. a boat reaches the screen (BoatEntityRenderer / BoatEntityModel)');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await waitMeshSettled();
  const boatQuiet = await quietPair();
  const boatBase = boatQuiet.base, boatControl = boatQuiet.control;
  const boatSpawn = await ev(
    'var P = MCL.Player, EL = MCL.EntityList, ER = MCL.EntityRender;' +
    'var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec();' +
    'var e = EL.spawn("boat", P.x + f[0] * 3, eye - 0.3, P.z + f[2] * 3);' +
    'if (!e) return null;' +
    'e.vx = 0; e.vy = 0; e.vz = 0; e.gravity = 0; window.__boat = e;' +
    'return { layer: ER.mobLayerFor("boat"), tex: ER.boatTexKey(e), owed: ER.OWED.join("|") };');
  ok(!!boatSpawn, 'a boat entity spawns');
  ok(boatSpawn && boatSpawn.layer === 'boat', 'and has a model layer (' + (boatSpawn && boatSpawn.layer) + ')');
  ok(boatSpawn && !/boat/.test(boatSpawn.owed), "'boat — G17c' is struck from ER.OWED");
  await frames(6);
  const boatBuilt = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'var n = MCL.EntityRender.visible(P.x, P.y, P.z, 1).filter(function (v) { return v.e && v.e.type === "boat"; }).length;' +
    'return b ? { drawn: b.drawn, clipped: b.clipped, boats: n } : null;');
  ok(boatBuilt && boatBuilt.boats === 1 && boatBuilt.drawn >= 1 && boatBuilt.clipped === 0, 'the frame draws the boat (' + JSON.stringify(boatBuilt) + ')');
  const boatShot = await shot();
  const boatAppear = compare(boatBase, boatShot);
  console.log('   boat appearing: ' + boatAppear.differing + ' px (control ' + boatControl.differing + ')');
  ok(boatAppear.differing > boatControl.differing * 3 && boatAppear.differing > 300,
     'the boat CHANGED THE PICTURE (' + boatAppear.differing + ' px vs a control of ' + boatControl.differing + ')');
  // wood is brown: among the pixels that changed, red > green > blue on average
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < boatShot.data.length; i += 4) {
    const d = Math.abs(boatShot.data[i] - boatBase.data[i]) + Math.abs(boatShot.data[i + 1] - boatBase.data[i + 1]) +
              Math.abs(boatShot.data[i + 2] - boatBase.data[i + 2]);
    if (d > 60) { sr += boatShot.data[i]; sg += boatShot.data[i + 1]; sb += boatShot.data[i + 2]; sn++; }
  }
  ok(sn > 100 && sr > sg && sg > sb, 'and the changed pixels are wood-coloured (mean rgb ' +
     (sn ? [sr, sg, sb].map((v) => Math.round(v / sn)).join(',') : 'none') + ' over ' + sn + ' px)');
  // the wood family: dark oak is another sheet of the same layer
  await ev('window.__boat.boatType = 5; return 1;');
  await frames(6);
  const boatDark = await shot();
  const woodDiff = compare(boatShot, boatDark);
  console.log('   oak -> dark oak: ' + woodDiff.differing + ' px');
  ok(woodDiff.differing > 100, 'a dark-oak boat draws different pixels from an oak one (' + woodDiff.differing + ' px)');
  // the paddle animation: a moving paddle changes the picture, a still one does not
  await ev('var b = window.__boat; b.yawDeg = 90; b.prevYawDeg = 90; return 1;');
  await frames(6);
  const boatSide = await shot();
  await ev('var b = window.__boat; b.paddleMoving = [true, true]; b.paddlePhases = [1.3, 2.1]; MCL.Boat.setPaddleMovings = function (e) { e.paddleMoving[0] = true; e.paddleMoving[1] = true; }; MCL.Boat.tickPaddlePhases = function (e) { e.paddlePhases = [1.3, 2.1]; }; return 1;');
  await frames(6);
  const boatPaddling = await shot();
  const paddleDiff = compare(boatSide, boatPaddling);
  console.log('   paddles moving: ' + paddleDiff.differing + ' px');
  okAv(paddleDiff.differing > 20, 'a paddling boat differs from an idle one (' + paddleDiff.differing + ' px)');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await frames(4);
  const boatGone = await ev('var P = MCL.Player;' +
    'return MCL.EntityRender.visible(P.x, P.y, P.z, 1).filter(function (v) { return v.e && v.e.type === "boat"; }).length;');
  okAv(boatGone === 0, 'with the boat removed no boat is drawn (' + boatGone + ')');
  await ev('MCL.EntityList.list.push.apply(MCL.EntityList.list, window.__saved); return 1;');
  await frames(4);

  // ── 4. an item that PLACES a block is still drawn as a sprite ───────────────────────────
  // ⚠⚠ **`IT.isBlock` DOES NOT MEAN "PLACES A BLOCK".** It is `kind === 'block'` out of
  // `extract-items.mjs`, which means "its ITEM MODEL is a block model" — and that is exactly
  // the partition that matters here, but the name reads like the other thing. I wrote this
  // section asserting `isBlock(torch)` was true, on the strength of the name, and it is false:
  // a torch places a block and its item model is `item/generated`. The old `ER.stateOf` asked
  // `isBlock`, so a dropped torch was INVISIBLE along with the sticks — not, as the name
  // suggested, drawn as a solid 3D torch. The check is written against what the code does.
  // ⚠ The section is kept rather than deleted, because the fact it pins is the load-bearing
  // one: these hundred-odd items place a real block state AND are drawn flat, so an engine
  // that routes on "does it place a block" draws the wrong picture for every one of them.
  console.log('\n4. an item that PLACES a block is still drawn as a sprite');
  const flat = await ev(
    'var IT = MCL.Items, ER = MCL.EntityRender, out = {};' +
    'var names = ["torch", "rail", "oak_sapling", "candle", "ladder", "poppy"];' +
    'out.rows = names.map(function (n) {' +
    '  var i = IT.of(n);' +
    '  if (i < 0) return { n: n, missing: true };' +
    '  var t = ER.itemLayers(i);' +
    '  return { n: n, isBlock: IT.isBlock(i), state: IT.stateOf(i), layers: t.length,' +
    '           part: t.length ? ER.spritePartOf(t[0]) : -1 };' +
    '});' +
    'var stone = IT.of("stone");' +
    'out.stone = { isBlock: IT.isBlock(stone), layers: ER.itemLayers(stone).length,' +
    '              state: IT.stateOf(stone) };' +
    'return out;');
  for (const r of (flat ? flat.rows : [])) {
    ok(!r.missing && r.state > 0 && r.layers > 0 && r.part >= 0 && !r.isBlock,
       r.n + ' places a real block state AND is drawn as a sprite, exactly as vanilla does',
       JSON.stringify(r));
  }
  ok(flat && flat.stone.layers === 0 && flat.stone.state > 0 && flat.stone.isBlock,
     'and stone is the other way round: a block model, no sprite layers, a real state');

  // ── 5. the stack pile ───────────────────────────────────────────────────────────────────
  console.log('\n5. a big stack is drawn as several copies (ItemEntityRenderer.getRenderAmount)');
  const pile = await ev('var ER = MCL.EntityRender, id = MCL.Items.of("stick");' +
    'var counts = [1, 2, 17, 33, 49, 64];' +
    'return counts.map(function (c) { return [c, ER.renderAmount(c),' +
    '  ER.pileOffsets(id, 0, c, false, ER.GROUND_SPRITE.scale).length]; });');
  const WANT = { 1: 1, 2: 2, 17: 3, 33: 4, 49: 5, 64: 5 };
  for (const [c, n, offs] of (pile || [])) {
    ok(n === WANT[c] && offs === n, c + ' in the stack -> ' + WANT[c] + ' copies', 'got ' + n + '/' + offs);
  }
  const spread = await ev('var ER = MCL.EntityRender, id = MCL.Items.of("stick");' +
    'var o = ER.pileOffsets(id, 0, 64, false, ER.GROUND_SPRITE.scale);' +
    'var z = o.map(function (v) { return v[2]; });' +
    'var d = []; for (var i = 1; i < z.length; i++) d.push(+(z[i] - z[i - 1]).toFixed(6));' +
    'return { z: z, steps: d, first: z[0], last: z[z.length - 1],' +
    '         step: ER.PILE_STEP * ER.GROUND_SPRITE.scale, zeroDraw: o[0][0] === 0 && o[0][1] === 0 };');
  ok(spread && spread.steps.every((d) => Math.abs(d - spread.step) < 1e-6),
     'the copies are stacked along Z by exactly PILE_STEP * groundScale (' + (spread && spread.step) + ')',
     spread && JSON.stringify(spread.steps));
  ok(spread && Math.abs(spread.first + spread.last) < 1e-6,
     'and the pile is CENTRED on the entity, not hanging off one side',
     spread && (spread.first + ' .. ' + spread.last));
  ok(spread && spread.zeroDraw,
     'copy 0 takes no random draw — the `j > 0` guard, or the whole sequence is off by one');

  // #10252 -- the item's ground SHADOW (ER.shadowQuads, #6739) is constant geometry that does not scale with the pile
  // (52 = 50 + 2, 252 = 5 * 50 + 2), so it is switched off for the count and put back.
  const bigger = await ev(
    'var P = MCL.Player, ER = MCL.EntityRender, EL = MCL.EntityList, S = MCL.Settings, sh = S.entityShadows;' +
    'S.entityShadows = false;' +
    'EL.list.length = 0; EL.list.push(window.__stick);' +
    'var one = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'var q1 = one ? one.quads.reduce(function (a, b) { return a + b; }, 0) : 0;' +
    'window.__stick.count = 64;' +
    'var many = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'var q64 = many ? many.quads.reduce(function (a, b) { return a + b; }, 0) : 0;' +
    'window.__stick.count = 1; S.entityShadows = sh;' +
    'return { q1: q1, q64: q64 };');
  ok(bigger && bigger.q64 === bigger.q1 * 5,
     'and a 64-stack really does submit five times the geometry (' +
     (bigger && bigger.q1) + ' -> ' + (bigger && bigger.q64) + ')');

  // ── 5b. A SPAWN EGG IS COLOURED, AND IT IS THE SAME COLOUR EVERYWHERE ───────────────────
  // ⚠⚠ This is the assertion that would have caught a GREY dropped spawn egg. Vanilla
  // multiplies a sprite layer by a colour from `ItemColors`; the HUD used to do that on a 2D
  // canvas and the world could not do it at all, so the inventory showed a coloured egg and the
  // dropped one was white. D-344 bakes the multiply into its own atlas layer, so there is one
  // set of pixels for an item and the two cannot disagree.
  // ⚠ It checks the PIXELS, not the plumbing: the tinted layer must actually equal base x
  // colour. Asserting only "the tile index differs" would pass on a tile full of anything.
  // ⚠ And it asserts MULTIPLY rather than REPLACE, because the HUD's old path did the latter —
  // `source-in` plus a `fillRect` sets every pixel to one flat colour, so a spawn egg in the
  // inventory was a solid silhouette with its spots erased. Two bugs, one cause: a rule written
  // twice and right neither time.
  console.log('\n5b. a spawn egg is coloured, and the world and the HUD share the pixels');
  const egg = await ev(
    'var IT = MCL.Items, A = MCL.Atlas, D = MCL.DATA, ER = MCL.EntityRender;' +
    'var id = IT.of("zombie_spawn_egg");' +
    'if (id < 0) return null;' +
    'var raw = D.itemTileMap ? D.itemTileMap() : null;' +
    'var layers = ER.itemLayers(id);' +
    'var px = A.mips[0].data, per = 16 * 16 * 4;' +
    'function sample(tile) {' +
    '  if (!(tile >= 0)) return null;' +
    '  var off = (A.itemTile0 + tile) * per;' +
    '  for (var i = 0; i < per; i += 4) {' +
    '    if (px[off + i + 3] === 255) return [px[off + i], px[off + i + 1], px[off + i + 2], i];' +
    '  }' +
    '  return null;' +
    '}' +
    'var base0 = raw ? raw["item/spawn_egg"] : -1, base1 = raw ? raw["item/spawn_egg_overlay"] : -1;' +
    'var other = IT.of("creeper_spawn_egg");' +
    'return { id: id, layers: layers, base: [base0, base1],' +
    '         tint: [IT.tintOf(id, 0), IT.tintOf(id, 1)],' +
    '         lit: [sample(layers[0]), sample(layers[1])],' +
    '         src: [sample(base0), sample(base1)],' +
    '         otherLayers: other >= 0 ? ER.itemLayers(other) : null };');
  ok(!!egg && egg.layers.length === 2, 'a zombie spawn egg has two sprite layers');
  ok(egg && egg.tint[0] >= 0 && egg.tint[1] >= 0,
     'and two tint colours out of the jar');
  ok(egg && egg.base[0] >= 0 && egg.layers[0] !== egg.base[0],
     'its layer 0 is NOT the plain spawn_egg sprite — it has its own baked tile',
     egg && (egg.layers[0] + ' vs ' + egg.base[0]));
  ok(egg && egg.base[1] >= 0 && egg.layers[1] !== egg.base[1],
     'and nor is its overlay');
  for (let L = 0; L < 2; L++) {
    const lit = egg && egg.lit[L], src = egg && egg.src[L], c = egg ? egg.tint[L] : -1;
    const want = src && c >= 0 ? [
      Math.round(src[0] * ((c >> 16) & 255) / 255),
      Math.round(src[1] * ((c >> 8) & 255) / 255),
      Math.round(src[2] * (c & 255) / 255),
    ] : null;
    ok(!!(lit && want && src[3] === lit[3] &&
       Math.abs(lit[0] - want[0]) <= 1 && Math.abs(lit[1] - want[1]) <= 1 && Math.abs(lit[2] - want[2]) <= 1),
       'layer ' + L + " pixels are the sprite MULTIPLIED by the colour, not replaced by it",
       lit && want ? ('got ' + lit.slice(0, 3) + ' want ' + want) : 'no opaque pixel');
    ok(!!(lit && src && (lit[0] !== src[0] || lit[1] !== src[1] || lit[2] !== src[2])),
       'and layer ' + L + ' really differs from the untinted sprite — the bake did something');
  }
  ok(!!(egg && egg.otherLayers && egg.otherLayers[0] !== egg.layers[0]),
     'a creeper egg gets DIFFERENT tiles from a zombie egg — the tint is per item, not per sprite');

  // ── 6. anti-vacuity: break it, and it must be caught ────────────────────────────────────
  console.log('\n6. anti-vacuity: break it, and the break must show');
  const b1 = await ev(
    'var ER = MCL.EntityRender, P = MCL.Player;' +
    'var save = MCL.DATA.spriteParts; MCL.DATA.spriteParts = 0;' +
    'var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'MCL.DATA.spriteParts = save;' +
    'return { drawn: b ? b.drawn : 0, still: MCL.EntityList.list.filter(function (e) { return !e.removed; }).length };');
  okAv(b1 && b1.drawn === 0 && b1.still > 0,
       'with the sprite parts taken away the entity still EXISTS and nothing is drawn for it');
  await frames(4);
  const b2 = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return b ? b.drawn : 0;');
  okAv(b2 === 1, 'and putting them back brings it straight back');

  const b4 = await ev(
    'var ER = MCL.EntityRender, IT = MCL.Items, P = MCL.Player;' +
    'var id = IT.of("stick");' +
    'MCL.EntityList.list.length = 0;' +
    'var e = MCL.EntityList.spawn("item", P.x + 4000, P.y, P.z, { item: { i: id, n: 1 } });' +
    'if (e) e.count = 1;' +
    'var v = ER.visible(P.x, P.y, P.z, 1);' +
    'return { exists: !!e && !e.removed, visible: v.length };');
  okAv(b4 && b4.exists && b4.visible === 0,
       'a stick four thousand blocks away exists and is not drawn');

  const b5 = await ev(
    'var ER = MCL.EntityRender, id = MCL.Items.of("stick");' +
    'var a = ER.pileOffsets(id, 0, 64, false, ER.GROUND_SPRITE.scale);' +
    'var b = ER.pileOffsets(id + 1, 0, 64, false, ER.GROUND_SPRITE.scale);' +
    'return JSON.stringify(a) !== JSON.stringify(b);');
  okAv(b5 === true, 'two different items get two different piles — the seed is really used');

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' spritecheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
