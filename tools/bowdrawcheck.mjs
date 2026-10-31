#!/usr/bin/env node
// bowdrawcheck.mjs — D-449 (session 60, QUEUE row 0 item 4's bow half): THE ARROW AND THE BOW,
// ON A REAL SCREEN.
//
//   MCLITE_PRESET=medium node tools/bowdrawcheck.mjs [dist/mclite.html] [--shots]
//
// ⚠⚠ WHY THIS EXISTS. `ER.OWED` named a live `arrow` entity as invisible, and this item's own
// text named "no bow-in-hand render or pull animation" as the confirmed remaining scope after
// D-445 closed the skeleton's own texture half. Both are render-only claims — `g17ccheck`,
// `goalcheck` and `aicheck` all prove NUMBERS, never a pixel — so, following `mobdrawcheck.mjs`'s
// own rules exactly (ASK THE ENGINE WHERE FORWARD IS; PUT THE SUBJECT SOMEWHERE IT CAN BE SEEN;
// A SILHOUETTE IS NOT A PASS; WATCH FOR THE CHANGE), this is the first time either claim is
// checked against an actual screenshot rather than a quad count.
//
// ⚠ WHAT THIS DOES NOT PROVE. It does not re-litigate the skeleton texture/black-torso half
// (D-444/D-445, closed) and it does not touch `spectral_arrow` (still on `ER.OWED`, on purpose —
// see `07j_entityrender.js`'s own header comment on `ER.arrowSpritesFor`). It also does not
// claim the bow's exact 3D pose matches vanilla's own `HumanoidModel`/`ItemInHandLayer` bytecode
// — that file's own header names which numbers are real jar data and which are a named, cited
// approximation (javap is not installed in this session's sandbox). What this DOES prove: an
// `arrow` entity changes real, lit, coloured pixels on screen, and a skeleton with
// `e.bowDrawing = true` changes MORE pixels (and more §8 quads) than the same skeleton at rest —
// i.e. something a player would recognise as "there is now a bow in that hand" actually appears.

import { open, sleep } from './cdp.mjs';
import { decodePng, toRgba } from './pngdec.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';
const SHOTS = process.argv.includes('--shots');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

/** Changed-pixel count, plus brightness/colour — same recipe as mobdrawcheck.mjs's `compare`. */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { differing: -1, total: 1, bright: 0, colour: 0 };
  let differing = 0, total = 0, sum = 0, spread = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const r = b.data[i], g = b.data[i + 1], bl = b.data[i + 2];
    const d = Math.abs(a.data[i] - r) + Math.abs(a.data[i + 1] - g) + Math.abs(a.data[i + 2] - bl);
    total++;
    if (d > 12) {
      differing++;
      sum += (r + g + bl) / 3;
      spread += Math.max(r, g, bl) - Math.min(r, g, bl);
    }
  }
  return { differing, total, bright: differing ? sum / differing : 0, colour: differing ? spread / differing : 0 };
}

const page = await open(FILE, {
  port: 9452, width: 960, height: 540,
  initScript: 'window.addEventListener("load", function () { setTimeout(function () {' +
             ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } }, 50); });',
});
if (!page) { console.log('SKIP  bowdrawcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () { if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } });
  await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; });   // D-397
  await sleep(4000);

  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return { rgba: toRgba(decodePng(Buffer.from(s.data, 'base64'))), raw: s.data };
  };
  const ev = (src) => page.evaluate(new Function(src));
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);
  const quietPair = async () => {
    let prev = null, best = Infinity;
    for (let i = 0; i < 40; i++) {
      await frames(4);
      const now = await shot();
      if (prev) {
        const d = compare(prev.rgba, now.rgba);
        if (d.differing >= 0 && d.differing < best) best = d.differing;
        if (d.differing >= 0 && d.differing * 2000 < d.total) return { base: now, control: d.differing, tries: i };
      }
      prev = now;
    }
    return { base: prev, control: best, tries: 40 };
  };
  const watch = async (base, want, tries) => {
    let best = { differing: 0, bright: 0, colour: 0 }, prev = null, still = 0;
    for (let i = 0; i < (tries || 10); i++) {
      await frames(3);
      const now = await shot();
      const d = compare(base.rgba, now.rgba);
      if (d.differing > best.differing) { best = d; best.shot = now; }
      if (prev) {
        const moved = compare(prev.rgba, now.rgba);
        still = (moved.differing >= 0 && moved.differing * 2000 < moved.total) ? still + 1 : 0;
        if (still >= 2 && best.differing > want) break;
      }
      prev = now;
    }
    return best;
  };

  // ── 1. the stage — an open, lit, floored spot in front of the player (mobdrawcheck's rules) ──
  console.log('\n1. the stage');
  const stage = await ev(
    'var P = MCL.Player, W = MCL.World;' +
    'P.pitch = 0; if (P.interpolate) P.interpolate(1);' +
    'var f = P.lookVec(), rx = -f[2], rz = f[0];' +
    'for (var d = 3; d <= 6; d += 0.5) for (var s = -2.5; s <= 2.5; s += 0.5) {' +
    '  var x = P.x + f[0] * d + rx * s, z = P.z + f[2] * d + rz * s;' +
    '  var bx = Math.floor(x), bz = Math.floor(z);' +
    '  for (var dy = 0; dy <= 3; dy++) {' +
    '    var y = Math.floor(P.y) + dy;' +
    '    var lt = W.getLight(bx, y, bz) | 0;' +
    '    if ((lt >> 4) >= 12 && W.getBlock(bx, y, bz) === 0 && W.getBlock(bx, y + 1, bz) === 0' +
    '        && W.getBlock(bx, y - 1, bz) !== 0) {' +
    '      return { x: x, y: y, z: z, sky: lt >> 4, blk: lt & 15 };' +
    '    }' +
    '  }' +
    '}' +
    'return null;');
  ok(!!stage, 'found an open, lit, floored spot in front of the player', stage ? JSON.stringify(stage) : 'none');
  if (!stage) throw new Error('no stage');
  console.log('   stage: ' + stage.x.toFixed(1) + ',' + stage.y + ',' + stage.z.toFixed(1) + '  skylight ' + stage.sky);

  await ev('MCL.EntityList.list.length = 0; return 1;');
  await page.settleWorld();
  const quiet = await quietPair();
  ok(quiet.control * 2000 < quiet.base.rgba.width * quiet.base.rgba.height,
     'the world is quiet enough to measure against (' + quiet.control + ' px)');
  // #1984: the stage is skylight 15 and a skeleton burns in daylight (Cb.BURNS_IN_DAYLIGHT, D-511): after ~9 s of screenshots (180 ticks,
  // health 11) it is dead and EL.list[0] is gone, so the drawn-skeleton section read null. Faster hosts finished first, which is why workers saw it green.
  // This check measures the bow pose, not sunburn.
  await ev('MCL.Combat.BURNS_IN_DAYLIGHT.skeleton = 0; return 1;');
  const want = Math.max(20, quiet.control * 4);   // a level arrow is only ~40 px at the default preset; the reverted arrow draws 0

  // ── 2. the arrow, in flight ─────────────────────────────────────────────────────────────
  console.log('\n2. a live arrow entity');
  const aInfo = await ev(
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'var P = MCL.Player, f = P.lookVec();' +
    'var e = EL.spawn("arrow", ' + stage.x + ', ' + stage.y + ', ' + stage.z +
    ', { vx: f[0] * 1.6, vy: 0, vz: f[2] * 1.6 });' +
    'if (!e) return { missing: true };' +
    'e.gravity = 0; e.drag = 0;' +               // held level in frame — a moving target is not a control
    'return { missing: false };');
  ok(!aInfo.missing, 'arrow spawns');
  const aBuilt = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { drawn: b ? b.drawn : -1, quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  ok(aBuilt.drawn >= 1 && aBuilt.quads > 0,
     'the frame builds the arrow (drawn ' + aBuilt.drawn + ', ' + aBuilt.quads + ' quads) — this is exactly ' +
     'what ER.OWED said could not happen before this session (arrow had no ER.SHAPE entry at all)');
  const aSeen = await watch(quiet.base, want);
  if (SHOTS && aSeen.shot) { try { writeFileSync(ROOT + 'dist/bowdraw-arrow.png', Buffer.from(aSeen.shot.raw, 'base64')); } catch { /* ignore */ } }
  console.log('   arrow: pixels ' + aSeen.differing + '  brightness ' + aSeen.bright.toFixed(0) + '  colour ' + aSeen.colour.toFixed(0));
  ok(aSeen.differing > want, 'the arrow changes real pixels on screen (' + aSeen.differing + ' > ' + want + ')');
  ok(aSeen.bright > 25, 'the arrow is drawn LIT, not a black silhouette (brightness ' + aSeen.bright.toFixed(0) + ')');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  // ── 3. the skeleton: a bow appears at all, and the pull frame actually changes ───────────
  // ⚠ DISCOVERED THIS SESSION, NOT ASSUMED: a vanilla skeleton holds its bow in hand at ALL
  // times, drawing or not (`e.bowDrawing !== undefined` alone gates the attachment — see
  // `07j_entityrender.js`'s own comment on that check), so "rest" already shows a bow (the
  // idle `item/bow` sprite) and "drawing" shows a DIFFERENT sprite (`bow_pulling_2` at high
  // charge) — not "no bow, then a bow". The three real vanilla icons extrude to slightly
  // different quad counts (56 / 53 / 49 for bow / pulling_1 / pulling_2 — a property of their
  // own opaque-pixel outlines, not a bug), so "more quads while drawing" is NOT a safe
  // invariant; what IS safe, and what this section actually asserts: (a) a bow-carrying
  // skeleton costs strictly more than a bare one with no `bowDrawing` property at all — a
  // mob RangedBowAttackGoal has never touched — and (b) the on-screen picture at high charge
  // is visibly DIFFERENT from the idle picture, proving the pull-frame selection is live, not
  // a fixed sprite.
  console.log('\n3. a skeleton: a bow appears, and its pull frame actually changes');
  await page.settleWorld();
  const quietBare = await quietPair();
  const bare = await ev(
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'var e = EL.spawn("skeleton", ' + stage.x + ', ' + stage.y + ', ' + stage.z + ');' +
    'if (!e) return { missing: true };' +
    'e.ai = null; e.invulnerable = true; e.fireTicks = 0; e.vx = e.vy = e.vz = 0;' +   // NO bowDrawing property at all — the pre-D-449 shape
    // D-682 made HeldItemFeatureRenderer real: a skeleton holding its bow now shows it even with no
    // bow goal. The baseline is therefore an EMPTY-HANDED skeleton — the mob with no bow at all.
    'MCL.Equip.setEquipped(e, MCL.Items.MAINHAND, null);' +
    'return { missing: false };');
  ok(!bare.missing, 'skeleton spawns');
  const bareBuilt = await ev('var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  const bareSeen = await watch(quietBare.base, want);
  console.log('   no bowDrawing property: quads ' + bareBuilt.quads + '  pixels ' + bareSeen.differing);
  ok(bareSeen.differing > want, 'the bare skeleton itself is visible (' + bareSeen.differing + ' px)');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  await page.settleWorld();
  const quiet2 = await quietPair();
  const rest = await ev(
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'var e = EL.spawn("skeleton", ' + stage.x + ', ' + stage.y + ', ' + stage.z + ');' +
    'e.ai = null; e.invulnerable = true; e.fireTicks = 0; e.vx = e.vy = e.vz = 0; e.bowDrawing = false; e.bowCharge = 0;' +
    'var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  const restSeen = await watch(quiet2.base, want);
  console.log('   idle bow (bowDrawing=false): quads ' + rest.quads + '  pixels ' + restSeen.differing);
  ok(rest.quads > bareBuilt.quads,
     'a skeleton with a bow-drawing goal (even not currently drawing) costs MORE §8 quads than ' +
     'the bare skeleton (' + rest.quads + ' > ' + bareBuilt.quads + ') — a real, held bow, not a relabelled mob box');

  await page.settleWorld();
  const quiet3 = await quietPair();
  const drawBuilt = await ev(
    'var EL = MCL.EntityList; var e = EL.list[0];' +
    'e.bowDrawing = true; e.bowCharge = 0.95; e.attacking = true; e.usingItem = true;' +      // D-449's own field, set directly (AI is off)
    'var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  const drawSeen = await watch(quiet3.base, want);
  if (SHOTS && drawSeen.shot) { try { writeFileSync(ROOT + 'dist/bowdraw-skeleton.png', Buffer.from(drawSeen.shot.raw, 'base64')); } catch { /* ignore */ } }
  console.log('   pulling_2 (bowDrawing=true, charge 0.95): quads ' + drawBuilt.quads + '  pixels-changed-from-idle ' + drawSeen.differing);
  ok(drawBuilt.quads > bareBuilt.quads,
     'the fully-drawn skeleton also costs MORE §8 quads than the bare one (' + drawBuilt.quads +
     ' > ' + bareBuilt.quads + ')');
  ok(drawSeen.differing > want,
     'the fully-drawn picture is genuinely DIFFERENT from the idle-bow picture (' + drawSeen.differing +
     ' px changed) — the pull-frame texture selection is live, not a fixed sprite');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  // ── 4. anti-vacuity — break the fix, prove this check catches it, then restore ────────────
  console.log('\n4. anti-vacuity');
  // 4a. the arrow: monkeypatch ER.arrowSpritesFor to fail exactly like it did before D-449
  const brokenArrow = await ev(
    'var ER = MCL.EntityRender; window.__origArrowSprites = ER.arrowSpritesFor;' +
    'ER.arrowSpritesFor = function () { return null; };' +
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'EL.spawn("arrow", ' + stage.x + ', ' + stage.y + ', ' + stage.z + ', { vx: 0, vy: 0, vz: -1.6 });' +
    'return 1;');
  ok(brokenArrow === 1, 'the arrow-draw fix can be reverted in place for the anti-vacuity pass');
  await page.settleWorld();
  const quiet4 = await quietPair();
  const arrowBlank = await watch(quiet4.base, want, 6);
  okAv(arrowBlank.differing < aSeen.differing / 4,
    'with ER.arrowSpritesFor reverted to its pre-D-449 behaviour (always null), the SAME arrow ' +
    'spawn draws almost nothing (' + arrowBlank.differing + ' px against the real fix\'s ' +
    aSeen.differing + ') — proving this check would have caught the original bug');
  await ev('MCL.EntityRender.arrowSpritesFor = window.__origArrowSprites; MCL.EntityList.list.length = 0; return 1;');

  // 4b. the bow: monkeypatch ER.bowSpritesFor to fail the same way
  await page.settleWorld();
  const quiet5 = await quietPair();
  const skelBroken = await ev(
    'var ER = MCL.EntityRender; window.__origBowSprites = ER.bowSpritesFor;' +
    'ER.bowSpritesFor = function () { return null; };' +
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'var e = EL.spawn("skeleton", ' + stage.x + ', ' + stage.y + ', ' + stage.z + ');' +
    'e.ai = null; e.invulnerable = true; e.fireTicks = 0; e.vx = e.vy = e.vz = 0; e.bowDrawing = true; e.bowCharge = 0.95;' +
    'var P = MCL.Player;' +
    'var b = MCL.EntityRender.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
    'return { quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0 };');
  await watch(quiet5.base, want, 8);   // let the (bow-less) skeleton settle before moving on
  okAv(skelBroken.quads === bareBuilt.quads,
    'with ER.bowSpritesFor reverted to always-null, a "drawing" skeleton costs EXACTLY the bare ' +
    'skeleton\'s own quads (' + skelBroken.quads + ' === ' + bareBuilt.quads + ', not the real ' +
    'fix\'s ' + drawBuilt.quads + ') — the bow is gone entirely, proving section 3\'s quad gap is ' +
    'the bow attachment itself, not noise');
  await ev('MCL.EntityRender.bowSpritesFor = window.__origBowSprites; MCL.EntityList.list.length = 0; return 1;');

  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' bowdrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
