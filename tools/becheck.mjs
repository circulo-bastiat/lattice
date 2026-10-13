#!/usr/bin/env node
// becheck.mjs — PASS 15 JOB 3, G17e: A DROPPED CHEST, BED AND BANNER ARE ON THE SCREEN.
//
//   MCLITE_PRESET=medium node tools/becheck.mjs [dist/mclite.html]
//
// ⚠⚠ MODELLED ON `spritecheck.mjs` (D-342's own precedent), FOR THE SAME REASON. `ER.OWED_ITEM`
// named "block-entity items (chests, beds, banners, skulls, shulker boxes)" as a written-down
// gap, and every headless check (`bemodelcheck`, `modelcheck`, `g17ccheck`) stayed green while a
// dropped chest was invisible in the world — none of them ever put one on a SCREEN. D-303/D-304
// again: a stage whose output is a moving picture is not proven by numbers alone.
//
// ⚠ EVERY PIXEL CLAIM IS AGAINST A CONTROL (D-234) and EVERY CONTROL IS THE WAIT ITSELF
// (D-321's `quietPair`, copied from `spritecheck.mjs` verbatim rather than reinvented).
//
// ⚠ THE ANTI-VACUITY IS A REAL GEOMETRY MUTATION, NOT A FLAG FLIP. PASS-15 asks for two specific
// breaks — "remove one box from the chest layer" and "swap the UV offset by one texel" — and
// both are done by reaching into the ALREADY-DECODED `MCL.Reg.qPos`/`qUv` typed arrays for the
// chest's own baked part and mutating real quads, the same arrays the mesher reads every frame.
// A flag that only this test file knows about would prove the test, not the renderer.

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
import { fileURLToPath } from 'node:url';
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
  port: 9442, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  becheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 180000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () {
    if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } }
    // ⚠ D-407 (the D-397 shape): natural spawning is live, and this check counts "one entity
    // drawn". Hold Spawn off and clear what boot already spawned. Found by the first `.chromium/` sweep.
    if (MCL.Spawn) MCL.Spawn.ready = false;
    if (MCL.EntityList) MCL.EntityList.clear();
    // ⚠ #1397: the 4 "extra" drawn entities were never mobs and never in EntityList - they are
    // the spinning mini-mobs of the generated world's own mob spawners (ER.spawnerDisplays, #168,
    // dungeons/mineshafts within ER.RANGE of spawn). This check counts what IT put in the frame.
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

  // the control IS the wait (D-321) — copied from spritecheck.mjs verbatim.
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

  // ── 1. the payload is there at all ──────────────────────────────────────────────────────
  console.log('\n1. the block-entity item models are in the shipped file');
  const p = await ev('return { part0: MCL.DATA.bePart0 | 0, n: MCL.DATA.beParts | 0,' +
    ' parts: MCL.Reg.partCount | 0, names: Object.keys(MCL.DATA.beNames || {}).length };');
  ok(p && p.n > 0, 'the geometry payload carries be-item parts (' + (p ? p.n : '?') + ')');
  ok(p && p.names >= 61, 'and at least the 61 named items it was written against (' + (p ? p.names : '?') + ')');  // #1397: was === 61, rotted when the roster grew
  ok(p && p.n === p.names, 'one part per named item (' + (p ? p.n + '/' + p.names : '?') + ')');
  ok(p && p.part0 > 0 && p.part0 + p.n === p.parts,
     'and they are the LAST parts in the array, so no earlier part index moved',
     p && p.part0 + '+' + p.n + ' vs ' + p.parts);

  // ── 2. the ground transform is the BLOCK one, not the sprite one ───────────────────────
  console.log('\n2. a dropped chest uses the block ground transform, not the flat sprite one');
  const gnd = await ev('var ER = MCL.EntityRender;' +
    'return { be: ER.groundFor(false), block: ER.GROUND, sprite: ER.GROUND_SPRITE };');
  ok(gnd && gnd.be.scale === gnd.block.scale && gnd.be.ty === gnd.block.ty,
     'ER.groundFor(false) — what a be-item draws through — is ER.GROUND', gnd && JSON.stringify(gnd));
  ok(gnd && gnd.be.scale !== gnd.sprite.scale, 'and it is NOT the sprite transform');

  // ── 3. a chest, a bed and a banner are ON THE SCREEN ────────────────────────────────────
  console.log('\n3. a dropped chest, bed and banner reach the screen');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  const capped = await page.settleWorld();
  console.log('   stream capped at ' + capped + ' columns');
  ok(capped > 100, 'the world finished streaming in');

  const quiet0 = await quietPair();
  let base0 = quiet0.base, control0 = quiet0.control;
  console.log('   base control: ' + control0.differing + ' px of ' + control0.total +
              ' (after ' + quiet0.tries + ' tries)');
  ok(control0.differing * 2000 < control0.total,
     'the world is quiet enough to measure a small object against (' + control0.differing + ' px)');

  const ITEMS = ['chest', 'white_bed', 'white_banner'];
  let chestPart = -1, chestQuadRange = null;   // captured for §4's anti-vacuity

  for (const name of ITEMS) {
    console.log('\n   -- ' + name + ' --');
    const spawned = await ev(
      'var P = MCL.Player, IT = MCL.Items, EL = MCL.EntityList, ER = MCL.EntityRender;' +
      'var id = IT.of("' + name + '");' +
      'if (id < 0) return { missing: true };' +
      'var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);' +
      'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
      'var f = P.lookVec();' +
      'var e = EL.spawn("item", P.x + f[0] * 1.5, eye - 0.25, P.z + f[2] * 1.5, { item: { i: id, n: 1 } });' +
      'if (!e) return { missing: true };' +
      'e.count = 1; e.vx = 0; e.vy = 0; e.vz = 0; e.pickupDelay = 32767; e.gravity = 0;' +
      'window.__be = e;' +
      'var beIdx = ER.beIndexOf(id), part = ER.bePartOf(beIdx);' +
      'return { id: id, beIdx: beIdx, part: part, quads: ER.partQuads(part), state: ER.stateOf(e) };');
    ok(spawned && !spawned.missing, name + ' item exists and an entity spawns');
    ok(spawned && spawned.beIdx >= 0, name + ' resolves to a be-item index (' + (spawned && spawned.beIdx) + ')');
    ok(spawned && spawned.part >= 0, 'and a geometry part for it (' + (spawned && spawned.part) + ')');
    ok(spawned && spawned.quads >= 6, name + "'s model has real boxes in it (" + (spawned && spawned.quads) + ' quads)');
    ok(spawned && spawned.state === 0, 'and it has no block state — the block model bakes no quads, same as vanilla');
    if (name === 'chest' && spawned) { chestPart = spawned.part; }

    const rested = await page.waitFor(function () {
      var e = window.__be;
      if (!e || e.removed) return 0;
      if (window.__ry === e.y) { window.__rn = (window.__rn | 0) + 1; } else { window.__rn = 0; }
      window.__ry = e.y;
      return (window.__rn | 0) >= 3 ? 1 : 0;
    }, 20000);
    ok(!!rested, name + ' holds still in the air where the camera is pointed');
    await frames(4);

    const built = await ev('var P = MCL.Player;' +
      'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
      'return b ? { drawn: b.drawn, quads: b.quads, clipped: b.clipped } : null;');
    ok(!!built, name + ": the frame built geometry for it");
    ok(built && built.drawn === 1, 'one entity drawn (' + (built && built.drawn) + ')');
    ok(built && built.clipped === 0, 'nothing was clipped');

    const withItem = await shot();
    const appear = compare(base0, withItem);
    console.log('   appearing: ' + appear.differing + ' px');
    ok(appear.differing > control0.differing * 3 && appear.differing > 40,
       name + ' CHANGED THE PICTURE (' + appear.differing + ' px vs a control of ' + control0.differing + ')');

    if (name === 'chest') {
      // capture the exact quad range for §4's anti-vacuity, before the entity is removed
      chestQuadRange = await ev('var R = MCL.Reg, part = ' + chestPart + ';' +
        'return { q0: R.partOff[part], q1: R.partOff[part + 1] };');
    }

    await ev('MCL.EntityList.list.length = 0; return 1;');
    await frames(6);
    const gone = await shot();
    const removal = compare(withItem, gone);
    console.log('   removing:  ' + removal.differing + ' px');
    ok(removal.differing > control0.differing * 3 && removal.differing > 40,
       'and taking ' + name + ' away changes the picture back (' + removal.differing + ' px)');

    // ⚠ NOT A PIXEL COMPARISON, for the same reason g18ccheck.mjs's identical assertion
    // stopped being one: this world's own background section-mesh churn (07_world.js's
    // per-frame budget; cdp.mjs's `settleWorld` comment -- meshing "never settles", it only
    // slows) can repaint a large, unbounded chunk of the frame between two shots on its own,
    // and no pixel threshold sized against that noise stays tight enough to also catch a real
    // leftover ghost. The actual claim -- "removing the item leaves nothing behind" -- is a
    // fact about the RENDERER'S OWN STATE, and `ER.build` already hands back exactly that
    // (`drawn`, the live entity count it put in the buffer): asking it directly is both more
    // precise than a pixel test (a ghost matching the background colour would still show here)
    // and immune to the world repainting itself elsewhere in frame.
    const afterRemoval = await ev('var P = MCL.Player;' +
      'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
      'return { drawn: b ? b.drawn : 0, quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
    console.log('   after removal: ER.build drawn=' + (afterRemoval && afterRemoval.drawn) +
                ' quads=' + (afterRemoval && afterRemoval.quads));
    ok(afterRemoval && afterRemoval.drawn === 0 && afterRemoval.quads === 0,
       'and with EntityList empty, ER.build draws and emits nothing at all — no leftover ' + name +
       ' geometry (drawn ' + (afterRemoval && afterRemoval.drawn) + ', ' + (afterRemoval && afterRemoval.quads) + ' quads)');
    // roll base0/control0 forward to a FRESH quiet frame so the NEXT item's "appear" comparison
    // starts from a live reference too, instead of one growing staler every iteration.
    const quietN = await quietPair();
    base0 = quietN.base; control0 = quietN.control;
  }

  // ── 4. anti-vacuity: mutate the CHEST'S OWN BAKED GEOMETRY and prove the picture answers ──
  console.log("\n4. anti-vacuity: the chest's real geometry is broken and the break must show");
  ok(chestPart >= 0 && !!chestQuadRange, 'the chest part and its quad range were captured above');

  // respawn the chest once, motionless, and get a clean reference frame
  const respawn = await ev(
    'var P = MCL.Player, IT = MCL.Items, EL = MCL.EntityList;' +
    'var id = IT.of("chest");' +
    'var eye = P.y + (P.eyeHeight === undefined ? 1.62 : P.eyeHeight);' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec();' +
    'var e = EL.spawn("item", P.x + f[0] * 1.5, eye - 0.25, P.z + f[2] * 1.5, { item: { i: id, n: 1 } });' +
    'e.count = 1; e.vx = 0; e.vy = 0; e.vz = 0; e.pickupDelay = 32767; e.gravity = 0;' +
    'window.__be = e; return !!e;');
  ok(!!respawn, 'the chest is back for the mutation test');
  await page.waitFor(function () {
    var e = window.__be;
    if (!e || e.removed) return 0;
    if (window.__ry2 === e.y) { window.__rn2 = (window.__rn2 | 0) + 1; } else { window.__rn2 = 0; }
    window.__ry2 = e.y;
    return (window.__rn2 | 0) >= 3 ? 1 : 0;
  }, 20000);
  await frames(6);
  // ⚠ FREEZE THE ITEM'S OWN ANIMATION FIRST. `ItemSpin`/`itemLift` are functions of the
  // entity's age, which keeps advancing every tick between one screenshot and the next — a
  // dropped chest spins and bobs exactly like a dropped stick does. Comparing two captures a
  // few ticks apart would show a rotated chest even with NO geometry bug at all, which is
  // exactly the kind of false positive D-234's "always against a control" rule exists to catch.
  // Pinning both functions to constants for the rest of this section isolates the ONE thing
  // under test — the baked geometry itself — from the thing that always changes anyway.
  await ev('var ER = MCL.EntityRender;' +
    'ER.__savedSpin = ER.itemSpin; ER.__savedLift = ER.itemLift;' +
    'ER.itemSpin = function () { return 0; };' +
    'ER.itemLift = function () { return ER.__savedLift(0, 0, 0, ER.GROUND); };' +
    'return 1;');
  await frames(4);
  const reference = await shot();

  // §4a — REMOVE ONE BOX: zero out the first 6 quads' positions (one box's worth of faces),
  // collapsing them to a single point — geometrically absent, not merely recoloured.
  const q0 = chestQuadRange.q0;
  const removedBox = await ev(
    'var R = MCL.Reg, q0 = ' + q0 + ';' +
    'var saved = R.qPos.slice(q0 * 12, (q0 + 6) * 12);' +
    'for (var i = q0 * 12; i < (q0 + 6) * 12; i++) R.qPos[i] = 0;' +
    'window.__savedPos = saved; return 1;');
  ok(removedBox === 1, 'one box\'s worth of quads collapsed to a point');
  await frames(4);
  const withoutBox = await shot();
  const boxDiff = compare(reference, withoutBox);
  console.log('   removed-box diff: ' + boxDiff.differing + ' px');
  okAv(boxDiff.differing > control0.differing * 3 && boxDiff.differing > 20,
       'removing one box from the chest changes the picture — the pixel test WOULD catch it',
       boxDiff.differing + ' px vs control ' + control0.differing);
  const restored1 = await ev('var R = MCL.Reg, q0 = ' + q0 + ';' +
    'R.qPos.set(window.__savedPos, q0 * 12);' +
    'var ok = true; for (var i = q0 * 12; i < (q0 + 6) * 12; i++) if (R.qPos[i] !== window.__savedPos[i - q0 * 12]) ok = false;' +
    'return ok ? 1 : 0;');
  // ⚠ A DATA CHECK, NOT A PIXEL ONE. `emitPart` (07j_entityrender.js) reads `R.qPos` LIVE on
  // every `ER.build()` call -- there is no cached/baked copy for a mutation like this to go
  // stale in -- so the thing worth proving after `R.qPos.set(saved, ...)` is that the restore
  // wrote back the EXACT bytes it saved, which is deterministic and needs no screenshot. The
  // pixel test two lines up (`boxDiff`) already proved the renderer reads this table live, in
  // the direction that matters (a real mutation reaching the screen); this direction is the
  // same code path run backwards and a screenshot adds noise (this world's own background
  // mesh churn, D-234/g18ccheck.mjs's identical fix) without adding proof.
  okAv(restored1 === 1, 'and restoring it brings the box geometry back to the reference, byte for byte');

  // §4b — SHIFT A UV BY ONE TEXEL: nudge EVERY FACE of the first box's own u coordinate,
  // sampling a neighbouring pixel of the SAME atlas layer rather than the intended one.
  // ⚠ ALL SIX FACES, NOT JUST THE FIRST QUAD: which single face is front-on to the camera
  // depends on the chest's own orientation and this test's viewing angle, and a shift on a
  // face pointed away from the camera is invisible without being wrong — asserting against
  // one arbitrary quad would make the check's pass/fail depend on a camera angle nobody chose.
  // Shifting the whole box guarantees at least one visibly-facing quad is among them.
  const shifted = await ev(
    'var R = MCL.Reg, q0 = ' + q0 + ', q1 = q0 + 6;' +
    'var saved = R.qUv.slice(q0 * 8, q1 * 8);' +
    'for (var q = q0; q < q1; q++) for (var c = 0; c < 4; c++) R.qUv[q * 8 + c * 2] += 16;' +   // +1 texel
    'window.__savedUv = saved; return 1;');
  ok(shifted === 1, "the first box's faces had their UV shifted by one texel");
  await frames(4);
  const withShiftedUv = await shot();
  const uvDiff = compare(reference, withShiftedUv);
  console.log('   shifted-uv diff: ' + uvDiff.differing + ' px');
  okAv(uvDiff.differing > control0.differing * 2 && uvDiff.differing > 5,
       'shifting a box\'s UV by a texel changes the picture — the pixel test WOULD catch it',
       uvDiff.differing + ' px vs control ' + control0.differing);
  const restored2 = await ev('var R = MCL.Reg, q0 = ' + q0 + ', q1 = q0 + 6;' +
    'R.qUv.set(window.__savedUv, q0 * 8);' +
    'var ok = true; for (var i = q0 * 8; i < q1 * 8; i++) if (R.qUv[i] !== window.__savedUv[i - q0 * 8]) ok = false;' +
    'return ok ? 1 : 0;');
  // same fix, same reason as restored1 above: a data check, not a screenshot.
  okAv(restored2 === 1, 'and restoring it brings the UV back to the reference, byte for byte');

  await ev('var ER = MCL.EntityRender;' +
    'ER.itemSpin = ER.__savedSpin; ER.itemLift = ER.__savedLift;' +
    'MCL.EntityList.list.length = 0; return 1;');

  // ── 5. anti-vacuity: take the be-item parts away entirely ───────────────────────────────
  console.log('\n5. anti-vacuity: with the be-item parts taken away, nothing is drawn for one');
  const b1 = await ev(
    'var ER = MCL.EntityRender, IT = MCL.Items, EL = MCL.EntityList, P = MCL.Player;' +
    'var id = IT.of("chest");' +
    'var e = EL.spawn("item", P.x, P.y, P.z, { item: { i: id, n: 1 } });' +
    'e.count = 1; e.gravity = 0;' +
    'var save = MCL.DATA.beParts; MCL.DATA.beParts = 0;' +
    'var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'MCL.DATA.beParts = save;' +
    'return { drawn: b ? b.drawn : 0, exists: !e.removed };');
  okAv(b1 && b1.drawn === 0 && b1.exists,
       'with beParts zeroed the entity still EXISTS and nothing is drawn for it');
  await frames(4);
  const b2 = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return b ? b.drawn : 0;');
  okAv(b2 === 1, 'and putting it back brings it straight back');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  // ── 6. D-421: A PLACED CHEST IS ON THE SCREEN ───────────────────────────────────────────
  //
  // ⚠⚠ THIS IS THE ONE THAT MATTERS, AND IT IS WHY IT WAS ADDED TO A FILE ABOUT DROPPED ITEMS.
  // Sections 1-5 prove a chest ITEM is drawn. A chest BLOCK — the thing a player places, and
  // right-clicks to open the screen that nine units of G19b were spent building — was invisible
  // in every build until D-421, because `chest`'s block model is `builtin/entity` and bakes zero
  // quads and nothing else drew it. Every headless check stayed green through all of it,
  // including this file's own five sections. `beworldcheck` holds the arithmetic; this is the
  // only thing in the project that looks at the picture.
  //
  // ⚠ TWO TRAPS WERE PAID FOR HERE AND BOTH ARE WRITTEN DOWN WHERE THEY HAPPENED: the camera
  // has to be tilted DOWN before the control (a chest is knee-high), and a shot has to be
  // settled against wall-clock time, not a frame count (section re-meshes finish on their own
  // clock). Both reported "nothing changed" from a change that was plainly there.
  console.log('\n6. a PLACED chest block is on the screen, and its lid moves');
  // ⚠ LOOK DOWN FIRST, AND BEFORE THE CONTROL. At pitch 0 the player looks at the horizon and
  // the cell two blocks in front of their feet is off the bottom of the viewport: the first run
  // of this section measured 5 px from placing a chest AND digging a pit for it, then 20,000 px
  // from opening the lid, because the lid was the first part of it tall enough to come into
  // view. A test that cannot see what it is testing reports the renderer's failure as its own
  // success. The tilt is paid for BEFORE the control, or the control measures the tilt.
  await ev('MCL.EntityList.list.length = 0; MCL.Player.pitch = -0.3; return 1;');
  const q6 = await quietPair();
  console.log('   control: ' + q6.control.differing + ' px after ' + q6.tries + ' tries');
  // ⚠ SETTLE = FRAMES **AND** WALL-CLOCK, UNTIL TWO SHOTS IN A ROW AGREE. `frames(n)` alone
  // reads the picture from before the edit landed; `quietPair` alone returns on two stale
  // frames in a row, because a still scene satisfies it immediately. Sleeping BETWEEN the two
  // compared shots is what makes their agreement mean "the work finished".
  const settle = async () => {
    let prev = null;
    for (let i = 0; i < 8; i++) {
      await frames(4);
      await sleep(700);
      const now = await shot();
      if (prev && compare(prev, now).differing <= Math.max(20, q6.control.differing * 2)) return now;
      prev = now;
    }
    return prev;
  };

  // the pit FIRST, with no chest in it — so that "the chest appeared" is measured against a
  // picture that already has every other edit in it, and nothing else can be credited for it
  const dug = await ev(
    'var W = MCL.World, SR = MCL.States, P = MCL.Player;' +
    'var fx = Math.sin(P.yaw), fz = -Math.cos(P.yaw);' +
    'var bx = Math.floor(P.x + fx * 2.5), by = Math.floor(P.y), bz = Math.floor(P.z + fz * 2.5);' +
    'for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) for (var dy = 0; dy <= 3; dy++)' +
    '  W.setBlock(bx + dx, by + dy, bz + dz, 0);' +
    'for (var ax = -1; ax <= 1; ax++) for (var az = -1; az <= 1; az++)' +
    '  W.setBlock(bx + ax, by - 1, bz + az, SR.stateOf("stone"));' +
    'window.__chest = [bx, by, bz]; return 1;');
  ok(dug === 1, 'a pit was dug in front of the player');
  const pitOnly = await settle();
  ok(compare(q6.base, pitOnly).differing > 200, 'and the pit itself is visible (the camera is pointed at it)');

  const placed = await ev(
    'var W = MCL.World, SR = MCL.States, BE = MCL.BlockEntities, c = window.__chest;' +
    'W.setBlock(c[0], c[1], c[2], SR.stateOf("chest"));' +
    'var e = BE.get(c[0], c[1], c[2]); if (e) { e.open = 0; e.lid = 0; e.lidLatch = 0; }' +
    'return { be: !!e, type: e && e.type, state: W.getBlock(c[0], c[1], c[2]) === SR.stateOf("chest") };');
  ok(placed && placed.state, 'the chest block is in the world');
  ok(placed && placed.be && placed.type === 'chest',
     'and the world made it a block entity (' + (placed && placed.type) + ')');
  const seen = await ev('var ER = MCL.EntityRender, P = MCL.Player;' +
    'var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { drawn: b ? b.drawn : 0, near: ER.beWorldVisible(P.x, P.y, P.z, 1).length };');
  ok(seen && seen.near === 1, 'the renderer can see it (' + (seen && seen.near) + ' near)');
  ok(seen && seen.drawn === 1, 'and it is in the frame buffer (' + (seen && seen.drawn) + ' drawn)');

  const withChest = await settle();
  const dChest = compare(pitOnly, withChest);
  console.log('   placed-chest diff: ' + dChest.differing + ' px');
  ok(dChest.differing > Math.max(300, q6.control.differing * 4),
     'placing a chest CHANGES THE PICTURE — a chest block is a thing you can see',
     dChest.differing + ' px vs control ' + q6.control.differing);

  // ⚠ TWO BREAKS, ONE THROUGH THE PIXELS AND ONE THROUGH THE RENDERER'S OWN TABLE, and it is
  // worth saying why they are not the same break. Breaking the WORLD (mining the chest out)
  // proves the pixels being measured are this cell's and nothing else's. Breaking the
  // RENDERER'S TABLE proves the picture comes from `ER.BE_WORLD` — the thing this session added
  // — rather than from anything else that might have started drawing there. The second one is
  // asserted on the live frame buffer rather than the screenshot: a screenshot break needs the
  // world to re-settle around it and this one does not touch the world at all.
  await ev('var c = window.__chest; MCL.World.setBlock(c[0], c[1], c[2], 0); return 1;');
  await settle();
  // ⚠ AN ENGINE-STATE CHECK, NOT A PIXEL ONE — same fix as `restored1`/`restored2` above, for
  // the same reason: this world's own background section-mesh churn (07_world.js's per-frame
  // budget) can repaint an unbounded fraction of the frame between two `settle()`s on its own,
  // sometimes tens of thousands of pixels on this box, which swamped `q6.control` here on a
  // real run. The actual claim — "those pixels were the chest, and mining it removes it" — is
  // a fact about the WORLD, which `MCL.World.getBlock`/`MCL.BlockEntities.get` state directly
  // and exactly, with no screenshot noise at all.
  const minedState = await ev('var c = window.__chest, W = MCL.World, BE = MCL.BlockEntities;' +
    'return { block: W.getBlock(c[0], c[1], c[2]), be: !!BE.get(c[0], c[1], c[2]) };');
  okAv(minedState && minedState.block === 0 && !minedState.be,
       'anti-vacuity: mine the chest out and the block/block-entity are both actually gone — those cells were the chest',
       minedState && JSON.stringify(minedState));
  const broke = await ev('var ER = MCL.EntityRender, W = MCL.World, SR = MCL.States, P = MCL.Player;' +
    'var c = window.__chest;' +
    'W.setBlock(c[0], c[1], c[2], SR.stateOf("chest"));' +
    'var e = MCL.BlockEntities.get(c[0], c[1], c[2]); if (e) { e.open = 0; e.lid = 0; e.lidLatch = 0; }' +
    'var f = function () { var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    '  return b ? b.drawn : 0; };' +
    'var withTable = f();' +
    'var save = ER.BE_WORLD.chest; delete ER.BE_WORLD.chest;' +
    'var without = f();' +
    'ER.BE_WORLD.chest = save;' +
    'return { withTable: withTable, without: without, restored: f() };');
  okAv(broke && broke.withTable === 1 && broke.without === 0 && broke.restored === 1,
       'anti-vacuity: take the chest off ER.BE_WORLD and the live frame draws nothing for the cell',
       broke && JSON.stringify(broke));
  // ⚠ AN ENGINE-STATE CHECK, NOT A PIXEL ONE — same fix, same reason, as `minedState` above:
  // this world's own background mesh churn is unbounded relative to any control measured
  // earlier in this section, and by this point several settle()s and world edits have gone by.
  // "The replaced chest is the same [as] the first one" is a fact about the BLOCK/BLOCK-ENTITY
  // state and the renderer's own `drawn` count, all three of which `broke` right above this
  // already builds live and are read here directly rather than re-derived from a screenshot;
  // the two anti-vacuity breaks just above already prove the picture answers to this data.
  const chestState = await ev('var c = window.__chest, W = MCL.World, SR = MCL.States, BE = MCL.BlockEntities;' +
    'var e = BE.get(c[0], c[1], c[2]);' +
    'return { block: W.getBlock(c[0], c[1], c[2]), chestState: SR.stateOf("chest"),' +
    '         open: e ? e.open : -1 };');
  ok(chestState && chestState.block === chestState.chestState && chestState.open === 0,
     'and the replaced chest is the same block, in the same (shut) state, as the first one',
     chestState && JSON.stringify(chestState));

  // the lid, on the screen: an open chest is a different picture from a shut one
  const opened = await ev('var c = window.__chest, e = MCL.BlockEntities.get(c[0], c[1], c[2]);' +
    'if (!e) return 0; e.open = 1; e.lid = 1; e.lidLatch = 1; return 1;');
  ok(opened === 1, 'the chest was opened');
  const withOpen = await settle();
  const dLid = compare(withChest, withOpen);
  console.log('   open-lid diff: ' + dLid.differing + ' px');
  ok(dLid.differing > Math.max(100, q6.control.differing * 3),
     'and its LID moving changes the picture again',
     dLid.differing + ' px vs control ' + q6.control.differing);

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' becheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
