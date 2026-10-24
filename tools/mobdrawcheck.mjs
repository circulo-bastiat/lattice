#!/usr/bin/env node
// mobdrawcheck.mjs — EVERY SPAWNABLE MOB, ISOLATED, FROM MULTIPLE ANGLES, ON BOTH BACKENDS,
// LIT AND UNLIT — D-447.
//
//   MCLITE_PRESET=medium node tools/mobdrawcheck.mjs [dist/mclite.html] [--shots]
//
// ⚠⚠ THIS FILE REPLACES THE SINGLE-ANGLE, SINGLE-BACKEND, REAL-TERRAIN RIG D-425 BUILT AND
// D-447 (Dan, verbatim, mid-session-59) condemned as "genuinely crude." D-425's rig put a mob on
// a spot IT FOUND in real generated terrain ("open air, a solid floor, and real skylight" — its
// own words) and shot it from ONE fixed angle, on ONE backend. That is a confound QUEUE row 0
// item 6's own session-59 note already caught: a spider read brightness 40, dimmest of seven
// mobs, and nobody could tell "correctly very dark" from "a light-sampling bug" because the
// stage itself was never isolated, angled, or dimmed on purpose.
//
// ⚠⚠ THE FOUR PARTS OF D-447'S SPEC, EACH ITS OWN SECTION BELOW:
//   1. AN ISOLATED STAGE — barrier-block floor, in a bubble of AIR CARVED OUT OF THE REAL WORLD
//      (§0). This engine has no separate "void" or "superflat" world type to boot into (STATE —
//      nothing names one), so isolation is built by clearing every block in a radius around the
//      stage to air and flooring only it with `barrier` — invisible and solid. NAMED RULING
//      (harness-only, not a game value): this is the void the spec asks for, built in the live
//      world rather than a second world type, because MC-Lite has one world kind.
//      ⚠ BARRIER DOES NOT BLOCK LIGHT — CHECKED AGAINST THE JAR, NOT ASSUMED. §0 first tried a
//      barrier ROOF for the dark stage too, on the reasonable-sounding assumption that an
//      invisible solid block would be light-opaque like any other full block. It is not: the
//      jar's own extracted light-filter value for barrier (`R.filter['barrier']`, read here via
//      `M.States.atten[stateOf('barrier')]`) is **0**, and `SR.lightSolid[st] = bAtten >= 15`
//      (D-156, `02c_states.js`) is therefore **0** for barrier — confirmed live: a roofed void
//      stage measured skylight 15 under a barrier ceiling, not 0. This is jar-accurate vanilla
//      behaviour (`noOcclusion()` blocks are not solid for light purposes either), not an engine
//      bug — rule 4 ("never invent a number the game owns") cuts the other way here: it is what
//      caught the check author's own wrong assumption before it shipped. The dark stage below
//      roofs with `stone` instead — a real, jar-confirmed light-opaque block — positioned high
//      enough (`by + 6`) to stay out of every camera angle's frame.
//   2. FOUR CAMERA ANGLES per mob — front / side / back / ¾ — computed from the MOB'S OWN yaw,
//      not the player's, using this engine's own forward-vector formula (`sin(yaw), -cos(yaw)`,
//      `14_player.js`'s `lookVec`/`14b_physics.js`'s movement code) and the same "camera yaw
//      that looks at a point" formula `headcheck.mjs` already uses (`atan2(dx, -dz)`), not a
//      new one invented for this file.
//   3. A PRESET×BACKEND MATRIX — booted the way `backendcheck.mjs` boots WebGPU: by asking for
//      it and observing what actually happens, not by assuming an adapter exists. §5's own
//      comment says exactly what this dev box's Chromium can and cannot prove, because
//      `backendcheck.mjs` already documented it: headless Chromium here has `navigator.gpu` and
//      NO ADAPTER, so a real WebGPU RENDER cannot be exercised on this machine full stop. This
//      file does not pretend otherwise.
//   4. A LOW-LIGHT STAGE — skylight 0, roofed like a cave — alongside the well-lit one, to
//      settle exactly the KW-26/D-425 confusion by comparison rather than by eye.
//
// The parts that already worked are kept: `compare()`'s pixel/brightness/colour-spread rule,
// the "floor derived from the run" density rule, and rule 4's "watch, don't wait" polling.

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

/** Changed-pixel count, plus what those pixels LOOK like — kept verbatim from D-425. */
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

/** Boot one page instance, optionally forcing a backend request before MCL's own scripts run. */
async function boot(port, forceBackend) {
  const initScript =
    (forceBackend
      ? 'window.__MCLITE_FORCE_BACKEND = ' + JSON.stringify(forceBackend) + ';' +
        '(function wait(){ if (typeof MCL === "undefined" || !MCL.Settings) { setTimeout(wait,0); return; }' +
        ' try { MCL.Settings.backend = ' + JSON.stringify(forceBackend) + '; } catch (e) {} })();'
      : '') +
    'window.addEventListener("load", function () { setTimeout(function () {' +
    ' if (window.MCL && MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } }, 50); });';
  const page = await open(FILE, { port, width: 960, height: 540, initScript });
  return page;
}

const page = await boot(9452, null);
if (!page) { console.log('SKIP  mobdrawcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await page.evaluate(function () { if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } });
  // D-660: freezing the weather CYCLE does not stop rain the world booted with — and since D-654 rain
  // is DRAWN (animated streaks + splash particles every frame). Every mob's "best differing frame"
  // then carried a screenful of rain on top of the mob, small hitboxes turned that into a huge
  // density, the median floor rose to ~250k/m², and honestly drawn big mobs (creeper, iron_golem,
  // villager on the 24 Sept 18:10 lane) failed under it. Clear the sky outright.
  const dry = await page.evaluate(function () {
    var S = MCL.Sky; if (!S) return true; var w = S.weather || (S.weather = S.newWeather());
    w.raining = false; w.thundering = false; w.rainLevel = 0; w.oRainLevel = 0; w.thunderLevel = 0; w.oThunderLevel = 0;
    if ('rainTime' in w) w.rainTime = 1e9; if ('thunderTime' in w) w.thunderTime = 1e9;
    return w.rainLevel === 0 && !w.raining;
  });
  ok(dry, 'the stage is dry — no rain drawn over the mobs (D-660)');
  await page.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; });   // D-397
  // D-522: pin the render distance — adaptive distance (D-46) trims the loaded ring whenever frame
  // time rises (a loaded box: 89 -> 49 chunks measured live), repainting the whole background
  // between a control shot and a mob shot. palettecheck/cullcheck/flashcheck already pin it.
  await page.evaluate(function () { if (MCL.Settings) MCL.Settings.adaptive = false; });
  await sleep(2000);
  // D-522: let the chunk streamer SETTLE before any control shot. Measured live (VM, medium): the
  // loaded set shrinks 89 -> 81 -> 49 over the first ~20 s as the boot ring trims to the preset's
  // distance — each trim repaints the background (~50k px mid-§1), and each newly generated chunk
  // runs worldgen's own populateEntities (a chicken wandered into §1's frame: "drawn 2"). Stable =
  // the same chunk count for 150 consecutive frames.
  const settled = await page.waitFor(function () {
    var n = MCL.World.chunks.size, f = MCL.Main.frame | 0;
    if (window.__mdN !== n) { window.__mdN = n; window.__mdF = f; return 0; }
    return (f - window.__mdF) >= 150 ? 1 : 0;
  }, 60000);
  ok(!!settled, 'the chunk streamer settled (same loaded set for 150 frames) before any control shot');

  const ev = (src) => page.evaluate(new Function(src));
  const shot = async () => {
    const s = await page.send('Page.captureScreenshot', { format: 'png' });
    return { rgba: toRgba(decodePng(Buffer.from(s.data, 'base64'))), raw: s.data };
  };
  const frames = (n) => page.waitFor(new Function(
    'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
    'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
    'window.__fb = undefined; return 1;'), 20000);

  /** Rule 4: keep looking until the picture has moved and then stopped; report the best look. */
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
  // D-522: a control shot is only honest once the MESHER has caught up with the stage carve. Seen
  // live (--shots): §1's control and first frames showed the carved bubble with its walls/floor
  // not yet re-meshed (sky through the ground, black holes); the remesh landed seconds later, mid-
  // sweep, and every mob after it "moved" ~287k px. Two identical frames are NOT a settled world
  // while sections are still dirty — wait for zero mesh work within 2 columns of the camera
  // (palettecheck's BACKLOG rule, narrowed to the stage), then take the quiet pair.
  // Whole render disc, not just the stage: a distant column finishing its mesh mid-sweep repaints
  // the background behind the stage (measured: ~54k px between two mobs) exactly as a near one does.
  const meshSettle = () => page.waitFor(new Function(
    'var W = MCL.World, cam = MCL.Gfx.cam, ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4, b = 0;' +
    'var rd = MCL.Settings.renderDistance, rd2 = rd * rd;' +
    'W.chunks.forEach(function (c) { var ax = c.cx - ccx, az = c.cz - ccz; if (ax * ax + az * az > rd2) return;' +
    '  if (W.neighbourhoodReady && !W.neighbourhoodReady(c.cx, c.cz)) return;' +
    '  var m = c.meshDirty[0]; while (m) { b += m & 1; m >>>= 1; } });' +
    'return (b + W.meshInflight + W.genInflight + MCL.Gfx.uploadQueue.length) === 0 ? 1 : 0;'), 90000);
  const quietPair = async () => {
    await meshSettle();
    let prev = null, best = Infinity;
    for (let i = 0; i < 16; i++) {
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

  // ⚠ SECTION 1 OF THE SPEC: THE ISOLATED STAGE. `buildStage` carves a bubble of AIR around a
  // point in front of the player and floors it with `barrier`. `roofed: true` also caps it with
  // `stone` (NOT barrier — barrier does not block light, see the header note and §0's own live
  // check of that fact against the jar) well above head height, out of every camera angle's
  // frame, which is how the low-light stage gets a real skylight of 0. Nothing outside this
  // radius is touched — whatever real terrain, structures or mobs were there are simply gone
  // from the visible picture, which is the isolation the spec asks for.
  // ⚠ `fwd` MATTERS: the lit and dark stages are built from the SAME player position, and
  // `P.lookVec()` does not change between the two calls — using the same forward distance for
  // both would carve the dark stage's stone roof directly over the (already-measured) lit
  // stage's own bubble, silently darkening it for every section that runs after §0. The two
  // stages are placed far enough apart (16 blocks of separation for two radius-6 bubbles) to
  // never overlap, and §0 asserts as much on the RESULT (skylight only drops where it should).
  // ⚠ A FLAT ROOF ALONE IS NOT A CAVE — FOUND LIVE, NOT ASSUMED. The first version of this stage
  // roofed the centre with stone but left the sides open air past `radius`; real open sky just
  // outside the bubble spreads INWARD under the roof's edge (vanilla's own skylight rule: one
  // level lost per block travelled, sideways same as down), so the centre measured skylight 7,
  // not 0 — a real light computation, just not what "cave-like" needs. `roofed` therefore also
  // walls the bubble's four sides with stone from the floor to the roof, sealing it the way an
  // actual cave (or a player-built dark room) is sealed, rather than widening the radius and
  // hoping 15 blocks of falloff is enough.
  const buildStageSrc =
    'function mcliteBuildStage(radius, roofed, fwd) {' +
    '  var P = MCL.Player, W = MCL.World, SR = MCL.States, f = P.lookVec();' +
    '  var bx = Math.floor(P.x + f[0] * fwd), bz = Math.floor(P.z + f[2] * fwd), by = Math.floor(P.y);' +
    '  var barrier = W.B_BARRIER, roofBlock = SR.stateOf("stone");' +
    '  if (!(barrier >= 0)) return { ok: false, why: "no barrier block id" };' +
    '  for (var x = bx - radius; x <= bx + radius; x++) {' +
    '    for (var z = bz - radius; z <= bz + radius; z++) {' +
    '      for (var y = by - 2; y <= by + 9; y++) W.setBlock(x, y, z, 0);' +
    '      W.setBlock(x, by - 1, z, barrier);' +
    '      if (roofed) {' +
    '        W.setBlock(x, by + 6, z, roofBlock);' +
    '        var edge = (x === bx - radius || x === bx + radius || z === bz - radius || z === bz + radius);' +
    '        if (edge) for (var wy = by; wy <= by + 5; wy++) W.setBlock(x, wy, z, roofBlock);' +
    '      }' +
    '    }' +
    '  }' +
    '  return { ok: true, x: bx + 0.5, y: by, z: bz + 0.5 };' +
    '}' +
    'return mcliteBuildStage(' + '__R__' + ', ' + '__ROOF__' + ', ' + '__FWD__' + ');';
  const buildStage = (radius, roofed, fwd) => ev(buildStageSrc
    .replace('__R__', String(radius)).replace('__ROOF__', roofed ? 'true' : 'false')
    .replace('__FWD__', String(fwd)));
  const settleLight = () => page.waitFor(new Function(
    'return (!window.MCL.Light || (MCL.Light.pending | 0) === 0) ? 1 : 0;'), 20000);
  const readSky = (x, y, z) => ev('var lt = MCL.World.getLight(' + Math.floor(x) + ',' + y + ',' + Math.floor(z) + ') | 0;'
    + 'return { sky: lt >> 4, blk: lt & 15 };');

  console.log('\n0. the isolated stage really is isolated, and the jar (not an assumption) says what blocks light');
  const barrierAtten = await ev('return { atten: MCL.States.atten[MCL.World.B_BARRIER], lightSolid: MCL.States.lightSolid[MCL.World.B_BARRIER] };');
  console.log('   barrier, off the jar’s own light-filter table: atten ' + barrierAtten.atten + ', lightSolid ' + barrierAtten.lightSolid);
  ok(barrierAtten.atten === 0 && barrierAtten.lightSolid === 0,
    'barrier does NOT block light per the jar (atten ' + barrierAtten.atten + ') — which is why the dark stage below roofs with stone, not barrier');

  const litStage = await buildStage(6, false, 8);
  ok(litStage && litStage.ok, 'the well-lit isolated stage was carved (barrier floor, no roof)', litStage && litStage.why);
  if (!litStage.ok) throw new Error('no lit stage');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await settleLight();
  const litSky = await readSky(litStage.x, litStage.y, litStage.z);
  ok(litSky.sky >= 12, 'the well-lit stage genuinely has skylight (sky ' + litSky.sky + ') with no roof overhead', JSON.stringify(litSky));

  const darkStage = await buildStage(6, true, 26);
  ok(darkStage && darkStage.ok, 'the low-light isolated stage was carved (barrier floor, STONE roof)', darkStage && darkStage.why);
  await settleLight();
  const darkSky = await readSky(darkStage.x, darkStage.y, darkStage.z);
  // ⚠ THE DECISIVE ASSERTION FOR THE WHOLE LOW-LIGHT STAGE: a stone roof that did not actually
  // block skylight would make "low-light" just "well-lit with an extra block overhead" and §4
  // below would be answering nothing. This is a live measurement, not the jar table read again —
  // it is the CONSEQUENCE of that table being right, checked against the world itself.
  ok(darkSky.sky === 0, 'and the stone-roofed stage genuinely reads skylight 0 (cave-like), not just visually dark (' + JSON.stringify(darkSky) + ')');
  const litSkyAfter = await readSky(litStage.x, litStage.y, litStage.z);
  ok(litSkyAfter.sky >= 12,
    'and building the dark stage did NOT darken the well-lit one (still sky ' + litSkyAfter.sky
    + ') — the two bubbles do not overlap');

  // baseline (mob-free) shot pair for each stage, used as the CONTROL for every comparison
  // against that stage below.
  await ev('MCL.EntityList.list.length = 0; return 1;');

  // ── roster ──────────────────────────────────────────────────────────────────────────────
  const spawnable = await ev('return MCL.EntityList.spawnable().filter(function (n) {' +
    ' return !!MCL.EntityRender.mobLayerFor(n) && MCL.Entities.isLiving(n); });');
  ok(Array.isArray(spawnable) && spawnable.length >= 5,
     'the engine can place at least five drawable mobs: ' + (spawnable || []).join(' '));

  /** Camera yaw that looks at (tx,tz) from (cx,cz) — `headcheck.mjs`'s own formula, not a new one. */
  const lookYaw = (cx, cz, tx, tz) => Math.atan2(tx - cx, -(tz - cz));

  /** Place the player at one of the four D-447 angles around a mob standing at (mx,my,mz)
   *  facing mobYaw, at distance d, looking at the mob's centre. Front = the camera sees the
   *  mob's face (stands where the mob is LOOKING); back = opposite; side = 90°; ¾ = 45°.
   *  The mob's own facing vector uses this engine's forward formula (14_player.js/14b_physics.js:
   *  fx = sin(yaw), fz = -cos(yaw)) — never re-derived a different way (rule 1's lesson, kept). */
  const ANGLES = { front: 0, threeQuarter: Math.PI / 4, side: Math.PI / 2, back: Math.PI };
  const placeCamera = (mx, my, mh, mz, mobYaw, angleRad, d) => {
    const fx = Math.sin(mobYaw), fz = -Math.cos(mobYaw);
    // rotate the facing vector by `angleRad` about Y to get the offset direction
    const ox = fx * Math.cos(angleRad) - fz * Math.sin(angleRad);
    const oz = fx * Math.sin(angleRad) + fz * Math.cos(angleRad);
    const cx = mx + ox * d, cz = mz + oz * d, cy = my + mh * 0.6;
    const yaw = lookYaw(cx, cz, mx, mz);
    const pitch = Math.atan2((my + mh * 0.5) - cy, d);
    return ev('var P = MCL.Player;' +
      'P.x = ' + cx + '; P.y = ' + cy + '; P.z = ' + cz + ';' +
      'P.yaw = ' + yaw + '; P.pitch = ' + (-pitch) + ';' +
      'if (P.interpolate) P.interpolate(1);' +
      'return 1;');
  };

  const spawnMob = (type, x, y, z, yaw) => ev(
    'var EL = MCL.EntityList; EL.list.length = 0;' +
    'var e = EL.spawn("' + type + '", ' + x + ', ' + y + ', ' + z + ');' +
    'if (!e) return { missing: true };' +
    'e.ai = null; e.vx = e.vy = e.vz = 0; e.yaw = ' + yaw + '; e.__mdSubject = true;' +
    // D-522: pin the RANDOM looks (D-520 horse coat, cat skin, sheep wool) to their index-0 light
    // variant — a black horse or black-wool sheep is a real roll, not an unlit mob, and §1b's
    // "drawn LIT" floor must not flip on a coin toss.
    'if (e.type === "horse" && e.variant !== undefined) e.variant = 0;' +
    'if (e.catVariant !== undefined) e.catVariant = 0; if (e.woolColor !== undefined) e.woolColor = 0;' +
    'return { missing: false, w: e.width, h: e.height };');

  // D-522: count the SUBJECT only — a mob worldgen's populateEntities placed in a freshly generated
  // chunk is real game behaviour, not the subject drawing twice; it is dropped before the build.
  const builtInfo = () => ev('var P = MCL.Player, L = MCL.EntityList.list;' +
    'for (var i = L.length - 1; i >= 0; i--) if (!L[i].__mdSubject) L.splice(i, 1);' +
    // #1204: ER.visible also draws a spinning mini-mob for every mob_spawner in range
    // (ER.spawnerDisplays, virtual, never in EntityList). The carved stage sits near world spawners,
    // so every mob read "drawn 6" (+5 zombie/skeleton cages). They are not the subject: stub them out.
    'var ER_ = MCL.EntityRender, sd = ER_.spawnerDisplays; ER_.spawnerDisplays = function () { return []; };' +
    'var b; try { b = ER_.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1); } finally { ER_.spawnerDisplays = sd; }' +
    // D-595: a villager/zombie_villager carries its clothing overlays (type, + profession/badge
    // when employed) as extra draw items since D-580 — how many is `ER.villagerClothingLayers`'s
    // own answer (villagertexcheck proves THAT selection), so the count is read, not owned here.
    'var cl = 0, held = 0; for (var j = 0; j < L.length; j++) { var s = L[j];' +
    ' if (s.type === "villager" || s.type === "zombie_villager") cl += MCL.EntityRender.villagerClothingLayers(s.type, s.villagerType || "plains", s.profession || "none", s.villagerLevel || 1, !!s.isBaby).length;' +
    // s135 (mobdrawcheck bug, not a game bug): a biped mob spawned already holding a weapon
    // (skeleton/stray's bow via Eq.WEAPON_FOR, a zombie's rolled weapon, ...) draws it as a
    // SEPARATE `ER.heldItemsFor`/`ER.bowSpritesFor` item, same shape villager clothing already
    // gets counted here — asked of the SAME renderer functions `ER.visible` itself calls
    // (D-329: never let the check re-derive a number the code already owns), not hand-modelled
    // per species.
    ' var ml = MCL.EntityRender.mobLayerFor(s.type);' +
    ' if (ml) { if (s.bowDrawing !== undefined && MCL.EntityRender.bowSpritesFor(s, s.x, s.y, s.z, 1)) held++;' +
    '   held += MCL.EntityRender.heldItemsFor(s, ml, s.x, s.y, s.z, 1).length; } }' +
    'return { drawn: b ? b.drawn : -1, quads: b ? (b.quads[0] + b.quads[1] + b.quads[2]) : 0, clothing: cl, held: held };');

  // ⚠ D-522: the control is shot from the SAME pose every §1 frame is shot from (front, 4 blocks,
  // mob height 1.8 — §1's placeCamera never varies). It used to be shot from wherever §0 left the
  // player, so every §1 "mob" diff was really a CAMERA diff (~360k of 518k px for every mob alike),
  // and §4a's floor (smallest/10) sat so high that a whole-screen shift passed as "nothing drawn".
  await placeCamera(litStage.x, litStage.y, 1.8, litStage.z, 0, ANGLES.front, 4);
  let quietLit = await quietPair();
  let wantLit = Math.max(60, quietLit.control * 4);
  let refreshes = 0;

  // ── 1. every mob, front angle, well-lit isolated stage — the regression sweep D-425 had ──
  console.log('\n1. every spawnable mob, front angle, on the isolated well-lit stage');
  const seen = [];
  const only = process.env.MOBDRAW_ONLY ? process.env.MOBDRAW_ONLY.split(',') : null;
  for (const type of spawnable) {
    if (only && !only.includes(type)) continue;
    await placeCamera(litStage.x, litStage.y, 1.8, litStage.z, 0, ANGLES.front, 4);
    // s154: `quietLit.base` used to be shot ONCE before this loop and trusted for all 24 mobs
    // (deliberate, for time budget — see the header note this replaces). A background block
    // ticking (grass spread, leaf decay, a distant chunk's late remesh) ONCE, mid-sweep, baked a
    // one-time ~57-58k px shift into every mob's diff AFTER that point (found live,
    // confident-lamport-0vr4pt's findings: cat, spawned first, read ~1200px both runs while every
    // later mob jumped 5-7x between runs). The camera pose here is IDENTICAL to the one `quietLit`
    // was captured from and the entity list is empty (cleared at the end of the previous
    // iteration, or before the loop starts) — so a real diff against `quietLit.base` at this exact
    // point can only be background drift, never the mob (it has not spawned yet). Re-settle
    // instead of trusting a stale base once drift is actually measured, mirroring §3/§4a's own
    // "fresh `quietPair()` per use": this stays cheap (`frames`+one `shot`, not a full
    // `quietPair()`) on every honest iteration, and only pays `quietPair()`'s real cost the one
    // time the background actually moved.
    await frames(3);
    const preShot = await shot();
    const drift = compare(quietLit.base.rgba, preShot.rgba);
    if (drift.differing >= 0 && drift.differing > Math.max(2000, quietLit.control * 20)) {
      refreshes++;
      console.log('   [background drift detected before ' + type + ': ' + drift.differing
        + ' px vs control ' + quietLit.control + ' — re-settling the control]');
      quietLit = await quietPair();
      wantLit = Math.max(60, quietLit.control * 4);
      await placeCamera(litStage.x, litStage.y, 1.8, litStage.z, 0, ANGLES.front, 4);
    }
    const info = await spawnMob(type, litStage.x, litStage.y, litStage.z, 0);
    const d = await watch(quietLit.base, wantLit, 8);
    if (SHOTS && d.shot) {
      try { writeFileSync(ROOT + 'dist/mobdraw-' + type + '.png', Buffer.from(d.shot.raw, 'base64')); } catch { /* ignore */ }
    }
    const built = await builtInfo();
    const area = info.missing ? 0 : info.w * info.h;
    seen.push({ type, px: d.differing, bright: d.bright, colour: d.colour, area,
                drawn: built.drawn, quads: built.quads, w: info.w, h: info.h });
    console.log('   ' + type.padEnd(10) + ' box ' + (info.w + 'x' + info.h).padEnd(11)
      + ' quads ' + String(built.quads).padEnd(4) + ' pixels ' + String(d.differing).padEnd(6)
      + ' brightness ' + d.bright.toFixed(0).padEnd(4) + ' colour ' + d.colour.toFixed(0));
    ok(!info.missing, type + ' spawns');
    // D-567: an UNSHEARED sheep is two draw items since loop/fleece-s97 — body + the fleece layer
    // (SheepWoolFeatureRenderer; mobrendercheck §4 proves the pair). Every other freshly spawned mob is one.
    const wantDrawn = (type === 'sheep' ? 2 : 1) + (built.clothing || 0) + (built.held || 0);
    ok(built.drawn === wantDrawn && built.quads > 0 && (type !== 'villager' || built.clothing >= 1),
       type + ': the frame builds it (drawn ' + built.drawn + ', ' + built.quads + ' quads)');
    await ev('MCL.EntityList.list.length = 0; return 1;');
  }

  console.log('\n1b. every mob that was BUILT is also SEEN, in colour, on the isolated stage');
  const density = (s) => (s.area > 0 ? s.px / s.area : 0);
  const best = seen.reduce((m, s) => Math.max(m, density(s)), 0);
  // s114: the floor is the MEDIAN density / 10, not best / 20. One mob whose hitbox is tiny next to
  // its drawn model (the lane's 09:36 diag: best ~293k px/m² against a median ~20k) set a floor of
  // ~14.7k that a big, honestly drawn ravager (11.7k/m²: a 1.95x2.2 box, most of it off the 4-block
  // frame) failed on. The median cannot be dragged by one outlier; /10 still sits far above the
  // control's own noise (wantLit), which is what "nothing drawn" looks like.
  const dens = seen.map(density).filter((d) => d > 0).sort((a, b) => a - b);
  const median = dens.length ? dens[dens.length >> 1] : 0;
  const floor = median / 10;
  const bestMob = seen.find((s) => density(s) === best);
  console.log('   density: best ' + best.toFixed(0) + '/m² (' + (bestMob && bestMob.type) + '), median '
    + median.toFixed(0) + '/m², floor ' + floor.toFixed(0) + '/m² (' + refreshes + ' background re-settle'
    + (refreshes === 1 ? '' : 's') + ')');
  ok(best > 0, 'at least one mob is visibly drawn at all');
  for (const s of seen) {
    ok(density(s) >= floor && s.px > wantLit,
      s.type + ' is on the screen: ' + s.px + ' px, ' + density(s).toFixed(0)
      + '/m² (floor ' + floor.toFixed(0) + ')');
  }
  // anti-vacuity (s114): the median floor must still reject a mob that is NOT drawn — a synthetic
  // entry carrying only the control's own noise over the median box area, and one at a twentieth of
  // the median density, both fail it; a single 100x-median outlier added to the set moves the floor
  // by at most one rank (the thing best/20 could not survive).
  {
    const medArea = seen.map((s) => s.area).filter((a) => a > 0).sort((a, b) => a - b)[seen.length >> 1] || 1;
    const ghost = { px: quietLit.control, area: medArea };
    okAv(!(density(ghost) >= floor && ghost.px > wantLit), 'a mob with only control-noise pixels fails the median floor', density(ghost).toFixed(0));
    const faint = { px: Math.round(median / 20 * medArea), area: medArea };
    okAv(!(density(faint) >= floor), 'a mob at 1/20 of the median density fails the median floor', density(faint).toFixed(0));
    const withOutlier = dens.concat([median * 100]).sort((a, b) => a - b);
    const floor2 = withOutlier[withOutlier.length >> 1] / 10;
    okAv(floor2 <= (dens[Math.min(dens.length - 1, (dens.length >> 1) + 1)] || 0) / 10 + 1e-9,
      'one 100x outlier moves the median floor by at most one rank (best/20 moved 5x)', floor2.toFixed(0));
  }
  for (const s of seen) {
    ok(s.bright > 25, s.type + ' is drawn LIT, not as a black silhouette (mean brightness '
      + s.bright.toFixed(0) + ' over ' + s.px + ' px)');
  }
  ok(seen.some((s) => s.colour > 8),
    'and at least one mob is drawn with real texture colour, not flat grey (best spread '
    + seen.reduce((m, s) => Math.max(m, s.colour), 0).toFixed(0) + ')');

  // ── 1c. the red hurt-flash — LivingEntityRenderer's overlay, this session's own wiring ──
  // ⚠ .decomp `LivingEntityRenderer.getOverlay` packs `OverlayTexture.getV(hurtTime > 0 ||
  // deathTime > 0)`, and `OverlayTexture`'s ctor bakes that row translucent RED (0xB20000FF,
  // alpha 178/255). `e.hurtTime` was bookkept (14j_combat.js's `Cb.tickEntity`) since D-338 but
  // never READ by anything that draws a pixel until this session (07j_entityrender.js's
  // `emitMobLayer`/`ER.build` wiring it to the packed vertex's spare `flag` bit, w3 bit 16,
  // blended in the fragment shader as a multiplicative tint toward red). Asserted DIRECTLY off
  // the packed vertex buffer `ER.build` hands the GPU — `M.unpackModelVertex` is already
  // provided "for the tests" (05_mesher.js's own doc) — rather than off a screenshot: a live
  // mob's idle-sway animation keeps posing itself every frame with `ai=null` and zero velocity
  // (measured live: ~500-800 px of legitimate frame-to-frame drift from that alone), which
  // swamps a pixel-diff test of a change this small. The buffer is deterministic and free of
  // that confound.
  console.log("\n1c. the red hurt-flash (LivingEntityRenderer's overlay, hurtTime > 0)");
  {
    const flagsOf = (hurtTime) => ev(
      'var EL = MCL.EntityList, ER = MCL.EntityRender, M = MCL.Mesher, P = MCL.Player;' +
      'EL.list.length = 0;' +
      'var e = EL.spawn("zombie", ' + litStage.x + ', ' + litStage.y + ', ' + litStage.z + ');' +
      'if (!e) return { missing: true };' +
      'e.ai = null; e.vx = e.vy = e.vz = 0; e.hurtTime = ' + hurtTime + ';' +
      // #1204: world spawner cages are drawn too and never carry the zombie's hurt flag: stub them out
      'var sd = ER.spawnerDisplays; ER.spawnerDisplays = function () { return []; };' +
      'var b; try { b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1); } finally { ER.spawnerDisplays = sd; }' +
      'if (!b) return { missing: true };' +
      'var hdr = M.readHeader(b.buf);' +
      'var n = b.quads[0] + b.quads[1] + b.quads[2];' +
      'var view = new Uint32Array(b.buf, hdr.modelOff[0], n * 4);' +
      'var flags = [], allSet = true, anySet = false;' +
      'for (var i = 0; i < n; i++) {' +
      '  var f = (view[i * 4 + 3] >>> 16) & 1;' +
      '  flags.push(f); if (f) anySet = true; else allSet = false;' +
      '}' +
      'return { missing: false, n: n, allSet: allSet, anySet: anySet };');

    const idle = await flagsOf(0);
    ok(idle && !idle.missing && idle.n > 0, 'the zombie builds real quads at hurtTime=0 (' + (idle && idle.n) + ')');
    ok(idle && !idle.anySet, 'and none of them carry the hurt flag at hurtTime=0');

    const hurting = await flagsOf(10); // Cb.HURT_DURATION
    ok(hurting && !hurting.missing && hurting.n === (idle && idle.n),
       'the same zombie, same pose, builds the same quad count at hurtTime=10 (' + (hurting && hurting.n) + ')');
    ok(hurting && hurting.allSet,
       'and EVERY one of them carries the hurt flag when hurtTime > 0 (' + (hurting && hurting.n) + ' quads)');

    // anti-vacuity: monkey-patch `emitMobLayer` to drop the `hurt` argument the way this engine
    // did before this session's fix, and prove the assertion above WOULD have caught that —
    // the point of an anti-vacuity pass, not merely re-asserting the fix works.
    const reverted = await ev(
      'var ER = MCL.EntityRender, M = MCL.Mesher, P = MCL.Player, EL = MCL.EntityList;' +
      'var orig = ER.emitMobLayer;' +
      'ER.emitMobLayer = function (out,o,ln,ux,uy,uz,cy,sy,sk,bl,ti,an,ba,tk,hurt) {' +
      '  return orig(out,o,ln,ux,uy,uz,cy,sy,sk,bl,ti,an,ba,tk,false); };' +
      'EL.list.length = 0;' +
      'var e = EL.spawn("zombie", ' + litStage.x + ', ' + litStage.y + ', ' + litStage.z + ');' +
      'e.ai = null; e.vx = e.vy = e.vz = 0; e.hurtTime = 10;' +
      'var b = ER.build(Math.floor(P.x), Math.floor(P.y), Math.floor(P.z), P.x, P.y, P.z, 1);' +
      'ER.emitMobLayer = orig;' +
      'if (!b) return { missing: true };' +
      'var hdr = M.readHeader(b.buf);' +
      'var n = b.quads[0] + b.quads[1] + b.quads[2];' +
      'var view = new Uint32Array(b.buf, hdr.modelOff[0], n * 4);' +
      'var anySet = false;' +
      'for (var i = 0; i < n; i++) if ((view[i * 4 + 3] >>> 16) & 1) anySet = true;' +
      'return { missing: false, n: n, anySet: anySet };');
    okAv(reverted && !reverted.missing && !reverted.anySet,
      'with the wiring reverted (hurt always false), hurtTime=10 no longer sets the flag on any quad — '
      + 'the assertion above WOULD have caught the original silence',
      reverted && JSON.stringify(reverted));

    await ev('MCL.EntityList.list.length = 0; return 1;');
  }


  // ── 2. D-447 SPEC PART 2: four camera angles, spider + a comparator, well-lit stage ──────
  console.log('\n2. four camera angles per mob (front/side/back/¾) — the spider question, part 1');
  const spider = seen.find((s) => s.type === 'spider') ? 'spider' : null;
  const comparator = seen.find((s) => s.type === 'cow') ? 'cow' : (spawnable.find((t) => t !== spider) || spawnable[0]);
  const angleSubjects = [spider, comparator].filter((t, i, a) => t && a.indexOf(t) === i);
  ok(!!spider, 'the roster includes a spider — the mob QUEUE item 6 is actually about');
  const angleResults = {};
  for (const type of angleSubjects) {
    angleResults[type] = {};
    const mobH = (seen.find((s) => s.type === type) || {}).h || 1.8;
    await ev('MCL.EntityList.list.length = 0; return 1;');
    const info = await spawnMob(type, litStage.x, litStage.y, litStage.z, 0);
    for (const [name, rad] of Object.entries(ANGLES)) {
      // fresh camera baseline for THIS angle (the scene looks different from every angle)
      await placeCamera(litStage.x, litStage.y, mobH, litStage.z, 0, rad, 4);
      await ev('MCL.EntityList.list.length = 0; return 1;');
      await frames(6);
      const base = await shot();
      await spawnMob(type, litStage.x, litStage.y, litStage.z, 0);
      const d = await watch(base, 40, 7);
      angleResults[type][name] = d;
      console.log('   ' + type.padEnd(8) + ' ' + name.padEnd(14)
        + ' pixels ' + String(d.differing).padEnd(6) + ' brightness ' + d.bright.toFixed(0));
      ok(d.differing > 40, type + ' ' + name + ': visibly drawn from this angle (' + d.differing + ' px)');
      ok(d.bright > 25, type + ' ' + name + ': lit, not a black silhouette (brightness ' + d.bright.toFixed(0) + ')');
    }
    await ev('MCL.EntityList.list.length = 0; return 1;');
  }
  if (angleResults.spider) {
    const bs = Object.values(angleResults.spider).map((d) => d.bright);
    const spread = Math.max(...bs) - Math.min(...bs);
    console.log('   spider brightness across angles: ' + bs.map((b) => b.toFixed(0)).join(', ')
      + '  (spread ' + spread.toFixed(0) + ')');
    ok(spread < 40, 'the spider’s brightness does not swing wildly with camera angle ('
      + 'spread ' + spread.toFixed(0) + ') — an angle-only black-out would be the light-sampling bug the note asked about');
  }

  // ── 3. D-447 SPEC PART 4: the low-light (skylight 0) stage — the spider question, part 2 ──
  console.log('\n3. the low-light (cave-like) isolated stage vs the well-lit one');
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await placeCamera(darkStage.x, darkStage.y, 1.8, darkStage.z, 0, ANGLES.front, 4);   // D-522: same pose as §3's frames
  const quietDark = await quietPair();
  const wantDark = Math.max(30, quietDark.control * 4);
  const darkResults = {};
  for (const type of angleSubjects) {
    await placeCamera(darkStage.x, darkStage.y, 1.8, darkStage.z, 0, ANGLES.front, 4);
    await ev('MCL.EntityList.list.length = 0; return 1;');
    await frames(6);
    const base = await shot();
    const info = await spawnMob(type, darkStage.x, darkStage.y, darkStage.z, 0);
    const d = await watch(base, wantDark, 9);
    darkResults[type] = d;
    console.log('   ' + type.padEnd(8) + ' low-light   pixels ' + String(d.differing).padEnd(6)
      + ' brightness ' + d.bright.toFixed(0));
    ok(!info.missing, type + ' spawns in the low-light stage too');
    ok(d.differing > wantDark, type + ': still registers as CHANGED pixels in the dark (' + d.differing + ' px) — not simply absent');
    await ev('MCL.EntityList.list.length = 0; return 1;');
  }
  // ⚠ THE ANSWER TO QUEUE ITEM 6'S OPEN QUESTION, MEASURED RATHER THAN ARGUED (see also the
  // stand-alone jar-texture measurement quoted in the D-entry): if the spider's low-light
  // brightness DROP tracks the same stage's comparator mob's drop (both go dark together,
  // proportionally), the darkness is the correctly-applied light multiplier acting on an
  // already-dark texture — not a spider-specific sampling fault. If the spider alone goes to
  // ~0 while the comparator stays visibly lit-ish, THAT would be the bug the note suspected.
  if (darkResults.spider && darkResults[comparator]) {
    const spiderLit = angleResults.spider.front.bright, spiderDark = darkResults.spider.bright;
    const compLit = angleResults[comparator].front.bright, compDark = darkResults[comparator].bright;
    const spiderRatio = spiderLit > 0 ? spiderDark / spiderLit : 0;
    const compRatio = compLit > 0 ? compDark / compLit : 0;
    console.log('   spider: lit ' + spiderLit.toFixed(0) + ' -> dark ' + spiderDark.toFixed(0)
      + '  (ratio ' + spiderRatio.toFixed(2) + ')');
    console.log('   ' + comparator + ': lit ' + compLit.toFixed(0) + ' -> dark ' + compDark.toFixed(0)
      + '  (ratio ' + compRatio.toFixed(2) + ')');
    ok(Math.abs(spiderRatio - compRatio) < 0.35,
      'the spider dims by roughly the SAME lit→dark ratio as ' + comparator
      + ' (' + spiderRatio.toFixed(2) + ' vs ' + compRatio.toFixed(2) + ') — consistent with correct-but-dark texture'
      + ' lighting, not a spider-specific light-sampling fault');
  }

  // ── 4. anti-vacuity — the classic break, plus one for isolation itself ──────────────────
  // ⚠ RUN ON THE SAME `page` THIS FILE ALREADY HAS OPEN, NOT A THIRD BOOT. An earlier version
  // of this section booted a fresh Chromium instance for exactly this check; on this dev box
  // three full boots plus everything else routinely ran past this file's own real-time budget.
  // Nothing here needs a fresh boot: `litStage`, `quietLit` and `spawnable` already exist.
  console.log('\n4. anti-vacuity');
  // 4a. classic: an entity with no model layer changes nothing like a mob.
  await ev('MCL.EntityList.list.length = 0; return 1;');
  await placeCamera(litStage.x, litStage.y, 1.8, litStage.z, 0, ANGLES.front, 4);
  const smallest = seen.reduce((m, s) => Math.min(m, s.px), Infinity);
  await ev('var EL = MCL.EntityList; EL.list.length = 0;' +
    'var e = EL.spawn("' + spawnable[0] + '", ' + litStage.x + ', ' + litStage.y + ', ' + litStage.z + ');' +
    'e.ai = null; e.type = "__no_such_mob_layer__"; e.vx = e.vy = e.vz = 0; e.__mdSubject = true; return 1;');
  // The AUTHORITATIVE half of this assertion: ask `ER.build` itself, the exact function every
  // real mob shot above went through, whether it emitted anything for this entity at all —
  // `ER.mobLayerFor` refuses an unrecognised type (07j_entityrender.js's own `ER.visible`
  // `if (!mobLayer) continue`), so a correctly-behaving renderer returns `null` (drawn -1) here,
  // never a positive `drawn`/`quads` count. This is a direct read of the SAME code path, not a
  // second derivation of it (D-329), and unlike the pixel snapshot below it cannot be confounded
  // by anything else moving in frame.
  const blankBuilt = await builtInfo();
  okAv(blankBuilt.drawn <= 0 && blankBuilt.quads === 0,
    'ER.build itself emits nothing for an entity with no model layer', JSON.stringify(blankBuilt));
  // The PIXEL half: a screenshot diff against a freshly settled control. Found live (this cloud
  // unit, s135): this can read several hundred px above the `smallest/10` floor even though the
  // authoritative check just above proves the entity drew NOTHING — the isolated stage's own
  // background disc reaches real, un-carved terrain past its radius, and something there (not
  // this subject) can still be moving a tick after `quietPair` calls itself settled. Retried
  // (bounded, D-30 style) against a freshly re-settled control rather than loosened, so a genuine
  // draw regression (this entity actually being drawn) still fails outright.
  let blank = null, blankFail = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const blankBase = (await quietPair()).base;   // D-522: a SETTLED control, not 4 frames after a teleport
    blank = await watch(blankBase, wantLit, 8);
    if (blank.differing < smallest / 10) { blankFail = null; break; }
    blankFail = blank.differing;
  }
  okAv(blankFail === null,
    'an entity with no model layer changes nothing like a mob (' + blank.differing
    + ' px against the smallest real mob’s ' + smallest + ')');
  await ev('MCL.EntityList.list.length = 0; return 1;');

  // 4b. break isolation on purpose (a mob standing on the REAL, unmodified generated terrain
  // right next to the stage, the exact D-425 rig shape) and confirm the check machinery would
  // have caught it — that §0's isolation assertions are not vacuously true just because they
  // run in a carved bubble every time.
  const realSpot = await ev(
    'var P = MCL.Player, W = MCL.World, f = P.lookVec();' +
    'for (var d = 20; d <= 40; d += 1) for (var s = -3; s <= 3; s += 1) {' +
    '  var x = P.x + f[0] * d + (-f[2]) * s, z = P.z + f[2] * d + f[0] * s;' +
    '  var bx = Math.floor(x), bz = Math.floor(z);' +
    '  for (var dy = 0; dy <= 4; dy++) {' +
    '    var y = Math.floor(P.y) + dy;' +
    '    if (W.getBlock(bx, y, bz) === 0 && W.getBlock(bx, y + 1, bz) === 0' +
    '        && W.getBlock(bx, y - 1, bz) !== 0) { return { x: x, y: y, z: z }; }' +
    '  }' +
    '}' +
    'return null;');
  if (!realSpot) {
    console.log('   (no real-terrain spot found nearby to stage the confound — this break is skipped here)');
  } else {
    // count non-air, non-barrier blocks in a radius around realSpot: a genuinely isolated
    // rig would read ~0 here; real terrain reads a real number, which is what "isolated"
    // actually has to mean — this is the assertion that would have failed D-425's rig.
    const clutter = await ev(
      'var W = MCL.World, n = 0;' +
      'for (var x = ' + Math.floor(realSpot.x) + ' - 6; x <= ' + Math.floor(realSpot.x) + ' + 6; x++)' +
      ' for (var z = ' + Math.floor(realSpot.z) + ' - 6; z <= ' + Math.floor(realSpot.z) + ' + 6; z++)' +
      '  for (var y = ' + realSpot.y + ' - 2; y <= ' + realSpot.y + ' + 9; y++) {' +
      '    var b = W.getBlock(x, y, z);' +
      '    if (b !== 0 && b !== MCL.World.B_BARRIER) n++;' +
      '  }' +
      'return n;');
    okAv(clutter > 20,
      'a real-generated spot right next to the isolated stage has real clutter in its bubble ('
      + clutter + ' non-air, non-barrier blocks) — proving the isolated stage’s ~0-clutter reading'
      + ' above is a genuine measurement and not a fixed pass');
    const clutterIso = await ev(
      'var W = MCL.World, n = 0;' +
      'for (var x = ' + Math.floor(litStage.x) + ' - 6; x <= ' + Math.floor(litStage.x) + ' + 6; x++)' +
      ' for (var z = ' + Math.floor(litStage.z) + ' - 6; z <= ' + Math.floor(litStage.z) + ' + 6; z++)' +
      '  for (var y = ' + litStage.y + ' - 2; y <= ' + litStage.y + ' + 9; y++) {' +
      '    var b = W.getBlock(x, y, z);' +
      '    if (b !== 0 && b !== MCL.World.B_BARRIER) n++;' +
      '  }' +
      'return n;');
    okAv(clutterIso === 0,
      'the CARVED isolated stage itself has zero non-air, non-barrier blocks in the same-size'
      + ' bubble (' + clutterIso + ') — the isolation this file builds is real, not asserted');
  }
  ok(page.problems.length === 0, 'the page logged no errors (' + page.problems.slice(0, 2).join(' | ') + ')');

  // ── 5. D-447 SPEC PART 3: preset×backend matrix ──────────────────────────────────────────
  console.log('\n5. the backend is actually asked for twice, and the two requests are distinct');
  const diag1 = await ev('return { name: MCL.Gfx ? MCL.Gfx.name : "?", failReason: MCL.GfxGPU ? (MCL.GfxGPU.failReason || "") : "" };');
  console.log('   default boot:  backend ' + diag1.name + '  GfxGPU.failReason: ' + JSON.stringify(diag1.failReason));
  ok(diag1.name === 'webgl2' || diag1.name === 'webgpu', 'the default boot picked a real backend (' + diag1.name + ')');

  await page.close();
  const gpuPage = await boot(9453, 'webgpu');
  let gpuDiag = null, gpuSeen = null;
  if (gpuPage) {
    try {
      await sleep(1200);
      await gpuPage.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
      const up2 = await gpuPage.waitFor(function () {
        return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
      }, 60000);
      ok(up2, 'a webgpu-REQUESTED boot still comes up (falls back cleanly if there is no adapter)');
      await gpuPage.evaluate(function () { if (MCL.Sky) { MCL.Sky.daylightCycle = false; MCL.Sky.weatherCycle = false; var wD660 = MCL.Sky.weather; if (wD660) { wD660.raining = wD660.thundering = false; wD660.rainLevel = wD660.oRainLevel = wD660.thunderLevel = wD660.oThunderLevel = 0; } } });
      await gpuPage.evaluate(function () { if (MCL.Spawn) MCL.Spawn.ready = false; if (MCL.Settings) MCL.Settings.adaptive = false; });
      await sleep(1500);
      const ev2 = (src) => gpuPage.evaluate(new Function(src));
      gpuDiag = await ev2('return { name: MCL.Gfx ? MCL.Gfx.name : "?", failReason: MCL.GfxGPU ? (MCL.GfxGPU.failReason || "") : "" };');
      console.log('   webgpu-requested boot: backend ' + gpuDiag.name + '  GfxGPU.failReason: ' + JSON.stringify(gpuDiag.failReason));
      // Re-run the isolated well-lit stage + a mob under this boot, proving the whole rig
      // (not just "the page loaded") works under a webgpu REQUEST too.
      const stage2 = await ev2('function mcliteBuildStage(radius, roofed) {' +
        ' var P = MCL.Player, W = MCL.World, f = P.lookVec();' +
        ' var bx = Math.floor(P.x + f[0] * 8), bz = Math.floor(P.z + f[2] * 8), by = Math.floor(P.y);' +
        ' var barrier = W.B_BARRIER; if (!(barrier >= 0)) return { ok: false };' +
        ' for (var x = bx - 6; x <= bx + 6; x++) for (var z = bz - 6; z <= bz + 6; z++) {' +
        '   for (var y = by - 2; y <= by + 9; y++) W.setBlock(x, y, z, 0);' +
        '   W.setBlock(x, by - 1, z, barrier);' +
        ' }' +
        ' return { ok: true, x: bx + 0.5, y: by, z: bz + 0.5 }; }' +
        'return mcliteBuildStage(6, false);');
      await gpuPage.waitFor(new Function('return (!window.MCL.Light || (MCL.Light.pending|0) === 0) ? 1 : 0;'), 20000);
      const frames2 = (n) => gpuPage.waitFor(new Function(
        'if (window.__fb === undefined) { window.__fb = MCL.Main.frame | 0; return 0; }' +
        'if (((MCL.Main.frame | 0) - window.__fb) < ' + n + ') return 0;' +
        'window.__fb = undefined; return 1;'), 20000);
      const shot2 = async () => {
        const s = await gpuPage.send('Page.captureScreenshot', { format: 'png' });
        return { rgba: toRgba(decodePng(Buffer.from(s.data, 'base64'))), raw: s.data };
      };
      await ev2('MCL.EntityList.list.length = 0; return 1;');
      await frames2(6);
      const base2 = await shot2();
      await ev2('var EL = MCL.EntityList; EL.list.length = 0;'
        + 'var e = EL.spawn("' + (spider || spawnable[0]) + '", ' + stage2.x + ', ' + stage2.y + ', ' + stage2.z + ');'
        + 'e.ai = null; e.vx = e.vy = e.vz = 0; return 1;');
      let bestGpu = { differing: 0, bright: 0 }, prevGpu = null;
      for (let i = 0; i < 6; i++) {
        await frames2(3);
        const now = await shot2();
        const d = compare(base2.rgba, now.rgba);
        if (d.differing > bestGpu.differing) bestGpu = d;
        prevGpu = now;
      }
      gpuSeen = bestGpu;
      console.log('   ' + (spider || spawnable[0]) + ' on the webgpu-requested boot: '
        + bestGpu.differing + ' px, brightness ' + bestGpu.bright.toFixed(0));
      ok(bestGpu.differing > 40 && bestGpu.bright > 25,
        'the mob is still visibly, litly drawn under a webgpu REQUEST (' + bestGpu.differing + ' px, brightness ' + bestGpu.bright.toFixed(0) + ')');
    } finally {
      await gpuPage.close();
    }
  } else {
    ok(false, 'a second Chromium instance could boot for the backend-matrix stage');
  }
  // ⚠ ANTI-VACUITY FOR THE MATRIX ITSELF: the two boots must actually be DISTINCT REQUESTS, not
  // one run duplicated. §5's own honest limit: this dev box's headless Chromium has
  // `navigator.gpu` and NO ADAPTER (backendcheck.mjs's own finding), so both requests resolve
  // to the SAME rendering backend (webgl2) — what has to differ, and is checked here, is that
  // the webgpu request was actually ATTEMPTED (GfxGPU records a failReason) while the default
  // boot never touched WebGPU at all.
  console.log('\n6. the matrix ran two DISTINCT requests, not one duplicated');
  ok(!diag1.failReason, 'the default boot never attempted WebGPU (no GfxGPU.failReason)');
  okAv(!!(gpuDiag && gpuDiag.failReason),
    'the webgpu-requested boot DID attempt WebGPU and recorded why it fell back ('
    + (gpuDiag && JSON.stringify(gpuDiag.failReason)) + ') — proving this is a second, real request'
    + ' and not the first boot’s result read twice');
  say_gpu_limit();
  function say_gpu_limit() {
    console.log('   ℹ this dev box’s headless Chromium has no WebGPU adapter (backendcheck.mjs’s own'
      + ' finding), so both requests above actually RENDER through webgl2 — the matrix is wired for'
      + ' two real backends and proven to reach GfxGPU’s webgpu path, but a genuine two-backend'
      + ' PIXEL comparison needs a machine with a WebGPU adapter, same limit backendcheck.mjs names.');
  }

} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  try { await page.close(); } catch { /* already closed above in some paths */ }
}

console.log('\n===========================================');
console.log(' mobdrawcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
// D-567: the suite shows only this file's TAIL, so the failures are repeated here — the 23 Sept full
// suite said '3 failed' and nothing that named them survived into the ledger.
for (const f of fails) console.log(' ✗ ' + f);
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
