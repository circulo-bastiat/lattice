#!/usr/bin/env node
// g18ccheck.mjs — G18c step 1: A LIVE GUARDIAN, DRAWN ON A REAL SCREEN.
//
//   MCLITE_PRESET=medium node tools/g18ccheck.mjs [dist/mclite.html]
//
// ⚠⚠ MODELLED ON `becheck.mjs` (PASS 15 JOB 3's own precedent) FOR THE SAME REASON THAT FILE
// gives: every Node-only check up through `mobboxcheck.mjs`/`mobtexcheck.mjs`/`animcheck.mjs`
// proves the GEOMETRY and the DATA a posed, textured mob would need — none of them puts one on
// a SCREEN. `ER.build`'s live loop was wired onto `guardian`/`dolphin`/`llama_spit`/`turtle`
// this session (the only types with both measured motion AND real box geometry today, since
// `EntityList.spawn` refuses every type `tools/golden/entity-motion-1.18.2.tsv` never measured
// — creeper/pig/zombie/cow/skeleton, `mobtexcheck.mjs`'s own 8 anchors, all among them). This
// file is the first thing that asks whether that wiring actually draws a picture.
//
// ⚠ EVERY PIXEL CLAIM IS AGAINST A CONTROL (D-234), the control IS the wait itself (D-321's
// `quietPair`, copied from `becheck.mjs`/`spritecheck.mjs` verbatim rather than reinvented).

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

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
  port: 9448, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  g18ccheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () { if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } });
  // ⚠ D-397: natural spawning is live in the real per-tick loop (D-392/393, session 32) and this
  // check predates it (session 30-31) -- left running, Spawn.tick() populates the world with real
  // cow/zombie/skeleton packs during the several seconds this file spends settling and measuring,
  // and every 'exactly one entity drawn' assertion below (and both anti-vacuity ones) go false on a
  // world that is doing exactly what D-393 says it should. This check is about ER.build's own draw
  // path for ONE known entity, not about Spawn -- so Spawn is held off for the isolated measurement,
  // the same on/off shape spawncheck.mjs itself drives Spawn through (Spawn.ready is the switch
  // 17_main.js's own tick loop already reads). The natural-spawning CLAIM this uncovered (cap 70
  // held to 73 over several hundred ticks -- a pack finishing after the cap is crossed, the same
  // shape vanilla's own NaturalSpawner allows) is not this file's to re-assert; spawncheck.mjs's own
  // JOB 2 acceptance criteria already cover the cap.
  await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; });
  await sleep(6000);

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return { rgba: toRgba(decodePng(Buffer.from(s.data, 'base64'))), raw: s.data };
  };
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);

  // the control IS the wait (D-321) — copied from becheck.mjs verbatim.
  const quietPair = async () => {
    let prev = null, best = Infinity;
    for (let i = 0; i < 40; i++) {
      await frames(4);
      const now = await shot();
      if (prev) {
        const d = compare(prev.rgba, now.rgba);
        if (d.differing < best) best = d.differing;
        if (d.differing * 2000 < d.total) return { base: now, control: d, tries: i };
      }
      prev = now;
    }
    return { base: prev, control: { differing: best, total: prev ? prev.rgba.width * prev.rgba.height : 1 }, tries: 40 };
  };

  // ⚠ THE ENGINE-TRUTH VERSION OF "the world is quiet" (see spritecheck.mjs's identical
  // helper, same fix): `soakcheck.mjs`'s own §5 reads `c.meshDirty[0]` to know whether the
  // chunks around the camera still have unmeshed sections; this waits for that to hit zero
  // BEFORE trusting a quiet screenshot as a reference, so a batch of meshes finishing between
  // two shots doesn't get read as "the guardian left something behind."
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

  // ── 1. this environment can actually spawn the anchor ──────────────────────────────────
  console.log('\n1. guardian has both measured motion and real box geometry');
  const cap = await ev(
    'var EL = MCL.EntityList, ER = MCL.EntityRender;' +
    'return { canSpawn: EL.canSpawn("guardian"), mobLayer: ER.mobLayerFor ? ER.mobLayerFor("guardian") : null,' +
    ' n: ER.mobQuadCount ? ER.mobQuadCount("guardian") : 0 };');
  ok(cap && cap.canSpawn, 'EntityList.canSpawn("guardian") is true — motion was measured');
  ok(cap && cap.mobLayer === 'guardian', 'ER.mobLayerFor("guardian") resolves to its own BE layer');
  ok(cap && cap.n > 0, 'ER.mobQuadCount("guardian") is nonzero (' + (cap && cap.n) + ')');

  // ── 2. a live guardian, spawned in front of the player, IS ON THE SCREEN ───────────────
  console.log('\n2. a live EntityList guardian is drawn — the bar every session since JOB 4.3 named');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  const capped = await page.settleWorld();
  console.log('   stream capped at ' + capped + ' columns');
  ok(capped > 100, 'the world finished streaming in');

  await waitMeshSettled();
  const quiet0 = await quietPair();
  const base0 = quiet0.base, control0 = quiet0.control;
  console.log('   base control: ' + control0.differing + ' px of ' + control0.total +
              ' (after ' + quiet0.tries + ' tries)');
  ok(control0.differing * 2000 < control0.total,
     'the world is quiet enough to measure a small object against (' + control0.differing + ' px)');

  // ⚠ #1667: the world has virtual mob-spawner cage displays (#168, ER.spawnerDisplays) in range;
  // they are drawn by ER.build though never in EntityList. "Exactly one drawn" was stale: count
  // against the baseline of an EMPTY EntityList instead (drawn + quads), and assert the delta.
  const baseB = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { drawn: b ? b.drawn : 0, quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  console.log('   baseline (EntityList empty): drawn=' + baseB.drawn + ' quads=' + baseB.quads);

  const spawned = await ev(
    'var P = MCL.Player, EL = MCL.EntityList;' +
    // look up into the sky: the spawn column can be a leaf corridor that hides a guardian at eye level,
    // and sky is a background the section-mesh churn never repaints
    'P.pitch = 0.6; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec(); if (f[1] < 0) { P.pitch = -0.6; if (P.interpolate) P.interpolate(1); f = P.lookVec(); }' +
    'var e = EL.spawn("guardian", P.x + f[0] * 4, P.y + 1.6 + f[1] * 4 - 0.4, P.z + f[2] * 4);' +
    'if (!e) return { missing: true };' +
    'e.vx = 0; e.vy = 0; e.vz = 0; e.aiDisabled = true; e.noGravity = true;' +
    'window.__mob = e;' +
    'return { missing: false, id: e.id, x: e.x, y: e.y, z: e.z };');
  ok(spawned && !spawned.missing, 'EL.spawn("guardian", ...) returns a live entity in front of the player');

  await frames(6);
  const built = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return b ? { drawn: b.drawn, quads: b.quads, clipped: b.clipped } : null;');
  ok(!!built, 'the frame built geometry for it');
  ok(built && built.drawn === baseB.drawn + 1, 'one entity drawn over the baseline (' + (built && built.drawn) + ' vs ' + baseB.drawn + ')');
  ok(built && built.clipped === 0, 'nothing was clipped');
  ok(built && cap && built.quads[2] >= 0 &&
   (built.quads[0] + built.quads[1] + built.quads[2]) >= cap.n,
     "the buffer holds at least the guardian's own quad count", built && JSON.stringify(built.quads));

  await frames(6);
  await waitMeshSettled();
  const withMob = await shot();
  const appear = compare(base0.rgba, withMob.rgba);
  console.log('   appearing: ' + appear.differing + ' px');
  ok(appear.differing > control0.differing * 3 && appear.differing > 40,
     'THE GUARDIAN CHANGED THE PICTURE (' + appear.differing + ' px vs a control of ' + control0.differing + ')');

  try {
    writeFileSync(ROOT + 'dist/g18c-before.png', Buffer.from(base0.raw, 'base64'));
    writeFileSync(ROOT + 'dist/g18c-guardian.png', Buffer.from(withMob.raw, 'base64'));
    console.log('   screenshots written: dist/g18c-before.png, dist/g18c-guardian.png');
  } catch (e) { console.log('    (could not write screenshots: ' + e.message + ')'); }

  await ev('MCL.EntityList.list.length = 0; return 1;');
  await frames(6);
  const gone = await shot();
  const removal = compare(withMob.rgba, gone.rgba);
  console.log('   removing:  ' + removal.differing + ' px');
  ok(removal.differing > control0.differing * 3 && removal.differing > 40,
     'and taking the guardian away changes the picture back (' + removal.differing + ' px)');

  // ⚠ NOT A PIXEL COMPARISON. This scene is real generated forest, not an isolated void stage,
  // and its OWN background section-mesh churn (07_world.js's per-frame budget; `settleWorld`'s
  // comment in cdp.mjs: it "never settles", only slows) can repaint a large fraction of the
  // frame between two shots on its own -- measured live, from a few thousand pixels up to the
  // WHOLE FRAME on one run, unrelated to the guardian at all. No pixel threshold sized against
  // that noise can also stay tight enough to catch a real leftover ghost. The actual claim this
  // assertion exists to make -- "removing the guardian leaves nothing behind" -- is a fact
  // about the RENDERER'S OWN STATE, not about the picture, and `ER.build` already hands back
  // exactly that fact (`drawn`, the live entity count it put in the buffer): asking it directly
  // is both more precise than any pixel test (a ghost that happens to match the background
  // colour would still show here and would never show in a screenshot) and immune to the world
  // still repainting itself elsewhere in frame.
  const afterRemoval = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { drawn: b ? b.drawn : 0, quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  console.log('   after removal: ER.build drawn=' + (afterRemoval && afterRemoval.drawn) +
              ' quads=' + (afterRemoval && afterRemoval.quads));
  ok(afterRemoval && afterRemoval.drawn === baseB.drawn && afterRemoval.quads === baseB.quads,
     'and with EntityList empty, ER.build is back to its empty-list baseline — no leftover guardian geometry ' +
     '(drawn ' + (afterRemoval && afterRemoval.drawn) + ', ' + (afterRemoval && afterRemoval.quads) + ' quads)');


  // ── 3. anti-vacuity: a type with no BE layer draws nothing, even though it EXISTS ───────
  console.log('\n3. anti-vacuity: a spawned entity with no BE layer is excluded, not defaulted');
  const b1 = await ev(
    'var EL = MCL.EntityList, ER = MCL.EntityRender, P = MCL.Player;' +
    'var e = EL.spawn("guardian", P.x, P.y, P.z);' +
    'e.type = "__no_such_mob_layer__";' +   // exists, but ER.mobLayerFor must refuse it
    'var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { drawn: b ? b.drawn : 0, exists: !e.removed };');
  okAv(b1 && b1.drawn === baseB.drawn && b1.exists,
       'with an unrecognized type name the entity still EXISTS and nothing is drawn for it');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await frames(4);
  const b2 = await ev(
    'var P = MCL.Player, EL = MCL.EntityList;' +
    'EL.spawn("guardian", P.x + 4, P.y, P.z);' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return b ? b.drawn : 0;');
  okAv(b2 === baseB.drawn + 1, 'and a properly-typed guardian right after it draws normally');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  // ── 4. G18e unit 2: THE BABY FLAG REACHES THE LIVE RENDERER ────────────────────────────
  // ⚠ WHY THIS IS GEOMETRY AND NOT PIXELS, AND THE MEASUREMENT THAT DECIDED IT. `babycheck.mjs`
  // proves the transform and what `ER.emitMobLayer` emits; neither knows whether the LIVE
  // per-frame path ever passes `isBaby` down, which is the join D-421's chest hole lived in.
  // A screen test was written first and it could not be made to mean anything: with the same
  // harness, a guardian spawned four blocks ahead changes ~3,100 px and a COW at the identical
  // position changes 111 (zombie 2,395 · skeleton 518 · spider 68 · turtle 54), while
  // `ER.build` reports `drawn: 1` and 58 quads for that cow. That is a REAL and separate fault
  // — KNOWN-WRONG's KW-26 — and hanging this session's assertion on it would have meant either
  // asserting a bug or asserting nothing. So the live proof here reads the live path's own
  // OUTPUT instead, in the page, on the real built file.
  console.log('\n4. G18e unit 2: the baby flag through the live renderer');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await frames(4);
  const babyLive = await ev(
    'var P = MCL.Player, EL = MCL.EntityList, ER = MCL.EntityRender, M = MCL.Mesher;' +
    'var y = P.yaw || 0, f = [-Math.sin(y), 0, Math.cos(y)];' +
    'var e = EL.spawn("cow", P.x + f[0] * 4, P.y, P.z + f[2] * 4);' +
    'if (!e) return { missing: true };' +
    'e.ai = null; e.vx = e.vy = e.vz = 0;' +
    'function bounds() {' +
    '  var anim = ER.animOf(e, 1);' +                      // the LIVE anim, not a hand-made one
    '  var n = ER.mobQuadCount("cow"), out = new Uint32Array(n * 16);' +
    '  ER.emitMobLayer(out, 0, "cow", 0, 0, 0, 1, 0, 15, 0, 3, anim);' +
    '  var minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;' +
    '  for (var q = 0; q < n; q++) for (var c = 0; c < 4; c++) {' +
    '    var v = M.unpackModelVertex(out[q*16+c*4], out[q*16+c*4+1], out[q*16+c*4+2], out[q*16+c*4+3]);' +
    '    if (v.py < minY) minY = v.py; if (v.py > maxY) maxY = v.py;' +
    '    if (v.px < minX) minX = v.px; if (v.px > maxX) maxX = v.px; }' +
    '  return { baby: !!anim.baby, minY: minY, maxY: maxY, w: maxX - minX };' +
    '}' +
    'var adult = bounds();' +
    'var boxA = [e.width, e.height];' +
    'MCL.Breed.setBaby(e, true);' +
    'var baby = bounds();' +
    'var boxB = [e.width, e.height];' +
    'var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { missing: false, adult: adult, baby: baby, boxA: boxA, boxB: boxB, drawn: b ? b.drawn : -1 };');
  ok(babyLive && !babyLive.missing, 'a cow spawns in the live game');
  if (babyLive && !babyLive.missing) {
    console.log('   adult ' + JSON.stringify(babyLive.adult) + '\n   baby  ' + JSON.stringify(babyLive.baby));
    ok(babyLive.adult.baby === false && babyLive.baby.baby === true,
       'ER.animOf carries isBaby into the renderer, both ways — the live join, not a hand-made anim');
    ok(babyLive.boxB[1] < babyLive.boxA[1],
       'the live box shrank (' + babyLive.boxA[1] + ' -> ' + babyLive.boxB[1] + ')');
    ok(babyLive.baby.maxY < babyLive.adult.maxY,
       'the live geometry is SHORTER as a baby (' + babyLive.adult.maxY + ' -> ' + babyLive.baby.maxY + ')');
    ok(babyLive.baby.minY === babyLive.adult.minY,
       'and its feet are on the same floor (' + babyLive.adult.minY + ' vs ' + babyLive.baby.minY + ')');
    ok(babyLive.drawn === baseB.drawn + 1, 'and the frame still builds it (' + babyLive.drawn + ')');
  }
  // ANTI-VACUITY: the same read with the flag forced off must give the ADULT geometry back, so
  // the three assertions above are the flag and not two different calls.
  const forcedOff = await ev(
    'var P = MCL.Player, ER = MCL.EntityRender, M = MCL.Mesher;' +
    'var e = MCL.EntityList.list[0];' +
    'var anim = ER.animOf(e, 1); anim.baby = false;' +
    'var n = ER.mobQuadCount("cow"), out = new Uint32Array(n * 16);' +
    'ER.emitMobLayer(out, 0, "cow", 0, 0, 0, 1, 0, 15, 0, 3, anim);' +
    'var maxY = -1e9;' +
    'for (var q = 0; q < n; q++) for (var c = 0; c < 4; c++) {' +
    '  var v = M.unpackModelVertex(out[q*16+c*4], out[q*16+c*4+1], out[q*16+c*4+2], out[q*16+c*4+3]);' +
    '  if (v.py > maxY) maxY = v.py; }' +
    'return maxY;');
  okAv(babyLive && !babyLive.missing && forcedOff === babyLive.adult.maxY,
       'a baby cow emitted with the flag forced OFF is the adult again (' + forcedOff + ')');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' g18ccheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
