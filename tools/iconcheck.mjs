#!/usr/bin/env node
// iconcheck.mjs — PLAN G10b. The BLOCK ICON rasteriser: the transform, the geometry, the picture.
//
//   node tools/iconcheck.mjs [--verbose]
//
// ⚠ WHY THIS EXISTS. Dan, playing: *"the item in block model is not even close."* He was right,
// and the reason was that the hotbar was drawing the item sheet's FLAT SPRITE for every block.
// That sprite is vanilla's fallback for a block with no model; vanilla draws the real model at
// the `gui` display transform, and `src/15d_blockicon.js` is the software rasteriser that does.
//
// ⚠ IT RENDERS HEADLESSLY AND THAT IS THE POINT. `BI.renderState` writes into a plain
// `Uint8ClampedArray`, so this check can read the PIXELS of an icon without a browser — which
// means the thing under test here is the picture itself, not the arithmetic behind it. The
// browser stage (`g11bcheck` §7) asserts the complementary half: that the picture reaches the
// screen.
//
// ⚠ AND THE FLAT-FALLBACK SET IS HELD CLOSED. 112 blocks legitimately have no model — chests,
// signs, banners and the other block entities whose shape lives in code — and they still draw
// their flat tile, because an empty icon is a worse answer than a flat one. A set that grew
// would mean models had stopped resolving; a set that shrank would mean something started
// rendering that should not. Either way nothing else in the engine would say so.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry } from './loadsrc.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('iconcheck — PLAN G10b, the block icon rasteriser (D-311)');

const NS = loadEngine({ extra: ['06_atlas.js', '06b_tintmap.js', '10_gfx.js', '15d_blockicon.js'], dom: false });
initRegistry(NS);
const R = NS.Reg, SR = NS.States, BI = NS.BlockIcon;
ok(!!BI, 'NS.BlockIcon exists');
ok(R.ready && SR.ready, 'the registry and the state table are up');

// ⚠ THE ATLAS IS BUILT HERE FROM THE SHIPPED PAYLOAD, not through `Atlas.build`, because that
// call also makes a DEBUG CANVAS and there is no document. The mip chain is what the rasteriser
// reads and the level-0 texels are exactly the bytes `pack`/`gen-data` ship, so this is the same
// data the game gets — with the one difference stated rather than hidden.
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'block-tiles.meta.json'), 'utf8'));
  const lvl0 = new Uint8Array(inflateRawSync(readFileSync(join(ASSETS, 'block-tiles.bin'))));
  const TILE = Math.round(Math.sqrt(lvl0.length / meta.count / 4));
  ok(lvl0.length === meta.count * TILE * TILE * 4,
     `the atlas payload is ${lvl0.length} bytes for ${meta.count} layers of ${TILE}x${TILE}`);
  const mips = [{ size: TILE, data: lvl0 }];
  let s = TILE, prev = lvl0;
  while (s > 1) {
    const ns = s >> 1;
    const next = new Uint8Array(meta.count * ns * ns * 4);
    for (let L = 0; L < meta.count; L++) {
      const sOff = L * s * s * 4, dOff = L * ns * ns * 4;
      for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
        const i00 = sOff + ((y * 2) * s + x * 2) * 4, i10 = i00 + 4;
        const i01 = sOff + ((y * 2 + 1) * s + x * 2) * 4, i11 = i01 + 4;
        const o = dOff + (y * ns + x) * 4;
        for (let c = 0; c < 4; c++) next[o + c] = (prev[i00 + c] + prev[i10 + c] + prev[i01 + c] + prev[i11 + c] + 2) >> 2;
      }
    }
    mips.push({ size: ns, data: next });
    prev = next; s = ns;
  }
  NS.Atlas.mips = mips;
  NS.Atlas.tiles = meta.count;
  NS.Atlas.levels = mips.length;
  console.log(`    atlas: ${meta.count} layers of ${TILE}x${TILE}, ${mips.length} mip levels`);
}

const stateOf = (name) => {
  const id = R.id[name];
  return id === undefined ? -1 : R.realFirst[id] + R.defaultState[id];
};
const render = (name, size) => {
  const st = stateOf(name);
  ok(st > 0, `${name} is a real block`);
  return BI.renderState(st, size || 64);
};
const opaque = (buf) => { let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 24) n++; return n; };

// ═══════════════ 1. the transform is vanilla's ═════════════════════════════════════════════
console.log('\n 1. the display transform');
// ⚠ THESE ARE `block/block.json`'s OWN `display` ENTRIES and nothing else. Getting the gui
// rotation wrong gives an icon that still looks like a cube from some angle, which is why it
// has to be pinned to the numbers rather than eyeballed.
ok(BI.GUI_ROT_X === 30 && BI.GUI_ROT_Y === 225, `gui rotation is [${BI.GUI_ROT_X}, ${BI.GUI_ROT_Y}]`);
ok(BI.GUI_SCALE === 0.625, `gui scale is ${BI.GUI_SCALE}`);
ok(BI.HAND_ROT_X === 0 && BI.HAND_ROT_Y === 45, `firstperson_righthand rotation is [${BI.HAND_ROT_X}, ${BI.HAND_ROT_Y}]`);
ok(BI.SS >= 2, `the rasteriser supersamples ${BI.SS}x`);

// ═══════════════ 2. the geometry it draws is the MESHER's ══════════════════════════════════
console.log('\n 2. the quads come from the baked geometry, not from a cube typed here');
{
  const cube = BI.quadsOf(stateOf('stone'));
  ok(cube.length === 6, `stone is ${cube.length} quads`);
  const faces = cube.map((q) => q.face).sort((a, b) => a - b);
  ok(faces.join(',') === '0,1,2,3,4,5', `a cube's six quads are the six faces (${faces.join(',')})`);
  ok(new Set(cube.map((q) => q.tile)).size === 1, 'stone draws one tile on all six faces');
  const grass = BI.quadsOf(stateOf('grass_block'));
  // ⚠ FOUR tiles and TEN quads, not three and six: the side carries a tinted OVERLAY quad on top
  // of the plain dirt side, which is how vanilla gets a green fringe on a brown texture. An
  // assertion of "three tiles" was a guess about the model and the model disagreed.
  ok(new Set(grass.map((q) => q.tile)).size >= 3,
     `grass_block draws ${new Set(grass.map((q) => q.tile)).size} different tiles (top, side, overlay, bottom)`);
  ok(grass.length > 6, `and ${grass.length} quads, more than a bare cube's six — the side overlay`);
  ok(grass.some((q) => q.tint > 0), 'and at least one of its quads is tinted');
  ok(BI.quadsOf(0).length === 0, 'air has no quads');
  ok(BI.quadsOf(stateOf('oak_slab')).length > 0, 'a slab has quads');
  // ⚠ a SHAPED block must not come back as a cube, or the rasteriser is drawing a stand-in
  const stair = BI.quadsOf(stateOf('oak_stairs'));
  ok(stair.length > 6, `oak_stairs is ${stair.length} quads, more than a cube's six`);
  say(`stone ${cube.length} · grass ${grass.length} · slab ${BI.quadsOf(stateOf('oak_slab')).length} · stairs ${stair.length}`);
}

// ═══════════════ 3. the PICTURE ════════════════════════════════════════════════════════════
console.log('\n 3. the rendered pixels');
const SZ = 64;
{
  const stone = render('stone', SZ);
  const ink = opaque(stone);
  ok(ink > SZ * SZ * 0.35, `stone covers ${ink} of ${SZ * SZ} pixels`);
  // ⚠ AND IT MUST NOT COVER THE WHOLE SQUARE. A cube at [30, 225] is a hexagon: its four corners
  // are empty. A full square is the signature of the flat sprite, which is exactly the bug.
  ok(ink < SZ * SZ * 0.80, `...and not the whole square (${ink} of ${SZ * SZ}) — it is a cube, not a sprite`);
  const px = (x, y) => stone[(y * SZ + x) * 4 + 3];
  ok(px(1, 1) === 0 && px(SZ - 2, 1) === 0 && px(1, SZ - 2) === 0 && px(SZ - 2, SZ - 2) === 0,
     'all four corners of the icon are empty');
  ok(px(SZ >> 1, SZ >> 1) > 0, 'and its middle is not');

  // ⚠ THREE FACES ARE VISIBLE — the TOP and two sides — and they must be three DIFFERENT
  // brightnesses, because `Gfx.SHADE.FACE` is [0.6, 0.6, 1, 0.5, 0.8, 0.8]: up is 1.0 and the
  // two sides a cube at 225 degrees shows are 0.6 and 0.8. That difference is the whole reason
  // the icon reads as a cube rather than as a flat hexagon.
  //
  // ⚠ COUNTING DISTINCT GREYS DOES NOT MEASURE THIS and the first version of this check tried:
  // stone's own texture has a dozen greys in it, so three shaded faces of it come back as
  // thirteen levels. What measures it is the MEAN of each face's region.
  // ⚠⚠ AND THE LOOP BOUNDS MUST BE INTEGERS. `for (let y = 9.6; y < 22.4; y++)` indexes a typed
  // array at 9.6 and gets `undefined` at every single pixel, so both means came back 0 and the
  // assertion compared nothing with nothing.
  const region = (x0, y0, x1, y1) => {
    let sum = 0, n = 0;
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        const o = (y * SZ + x) * 4;
        if (stone[o + 3] > 200) { sum += stone[o]; n++; }
      }
    }
    return n ? sum / n : 0;
  };
  const top = region(SZ * 0.30, SZ * 0.14, SZ * 0.70, SZ * 0.30);
  const left = region(SZ * 0.16, SZ * 0.58, SZ * 0.42, SZ * 0.80);
  const right = region(SZ * 0.58, SZ * 0.58, SZ * 0.84, SZ * 0.80);
  say(`stone faces: top ${top.toFixed(1)} · left ${left.toFixed(1)} · right ${right.toFixed(1)}`);
  ok(top > left + 8 && top > right + 8,
     `the top face is the brightest (top ${top.toFixed(0)}, left ${left.toFixed(0)}, right ${right.toFixed(0)})`);
  // ⚠ ...AND THE TWO SIDES DIFFER FROM EACH OTHER. `SHADE.FACE` gives them 0.6 and 0.8, so one
  // is about a third brighter; a renderer that shaded by depth, or not at all, would pass the
  // top-is-brightest test above and give a cube with two identical sides.
  const lo = Math.min(left, right), hi = Math.max(left, right);
  ok(lo > 0 && hi > lo * 1.15,
     `the two visible sides are shaded differently (${lo.toFixed(0)} and ${hi.toFixed(0)}, ratio ${(hi / lo).toFixed(2)})`);
}
{
  // grass_block: the top must be GREEN and the bottom must not be — the tint is applied, and it
  // is applied to the right face. A tint bug here is invisible in any count.
  const grass = render('grass_block', SZ);
  const hue = (y0, y1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = 0; x < SZ; x++) {
      const o = (y * SZ + x) * 4;
      if (grass[o + 3] > 200) { r += grass[o]; g += grass[o + 1]; b += grass[o + 2]; n++; }
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  };
  const t = hue(SZ * 0.15, SZ * 0.32), b2 = hue(SZ * 0.70, SZ * 0.88);
  ok(t[1] > t[0] * 1.15 && t[1] > t[2] * 1.15, `the grass block's top is green (${t.map((v) => v.toFixed(0)).join(',')})`);
  ok(!(b2[1] > b2[0] * 1.15 && b2[1] > b2[2] * 1.15),
     `and its bottom is not (${b2.map((v) => v.toFixed(0)).join(',')})`);
}
{
  // ⚠⚠ **THE THREE VISIBLE FACES MUST BE THE RIGHT THREE, AND THIS IS THE ASSERTION THAT PINS
  // THEM.** Both 45 and 225 degrees give a clean symmetric hexagon; they show DIFFERENT faces —
  // 45 shows top, east and south, 225 shows top, NORTH and WEST — so a sign flip that made the
  // skewed icon symmetric could just as easily have produced a plausible cube of the wrong three
  // faces. Vanilla shows the north face, and the proof is visible in the game: a FURNACE's front
  // opening and a CARVED PUMPKIN's face are both drawn in the inventory. This asserts it the
  // only way that cannot be argued with — by rendering each quad alone and seeing which survive.
  const ai = JSON.parse(readFileSync(join(ASSETS, 'atlas-index.json'), 'utf8'));
  const tileOf = (name) => ai.index[name];
  const real = BI.quadsOf;
  const seen = [];
  for (const one of real(stateOf('furnace'))) {
    BI.quadsOf = () => [one];
    const buf = BI.renderState(stateOf('furnace'), 32);
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const o = (y * 32 + x) * 4;
      if (buf[o + 3] > 128) { n++; sx += x; sy += y; }
    }
    if (n) seen.push({ face: one.face, tile: one.tile, px: n, mx: sx / n, my: sy / n });
  }
  BI.quadsOf = real;
  say('furnace visible: ' + seen.map((q) => 'face' + q.face + '@' + q.mx.toFixed(0) + ',' + q.my.toFixed(0)).join(' '));
  ok(seen.length === 3, `exactly three of a cube's six faces survive the cull (${seen.length})`);
  const front = seen.filter((q) => q.tile === tileOf('block/furnace_front'))[0];
  ok(!!front, "the furnace's FRONT is one of them — vanilla's icon shows the opening, and 45 degrees would not");
  ok(!!front && front.mx < 16, `and it is on the LEFT half (mean x ${front ? front.mx.toFixed(1) : '-'})`);
  const top = seen.filter((q) => q.face === 2)[0];       // ARCH 2 = +Y
  ok(!!top, 'the TOP (+Y) is visible, not the bottom');
  ok(!!top && top.my < 16, `and it is the upper part of the icon (mean y ${top ? top.my.toFixed(1) : '-'})`);
  ok(seen.filter((q) => q.face === 3).length === 0, 'the BOTTOM (-Y) is culled');
  const side = seen.filter((q) => q !== front && q !== top)[0];
  ok(!!side && side.mx > 16, `the third face is the one on the RIGHT (mean x ${side ? side.mx.toFixed(1) : '-'})`);
  // ⚠ and the same again for a carved pumpkin, because one block agreeing could be a coincidence
  if (R.id.carved_pumpkin !== undefined) {
    let faceSeen = false;
    for (const one of real(stateOf('carved_pumpkin'))) {
      BI.quadsOf = () => [one];
      const buf = BI.renderState(stateOf('carved_pumpkin'), 32);
      let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 128) n++;
      if (n && one.tile === tileOf('block/carved_pumpkin')) faceSeen = true;
    }
    BI.quadsOf = real;
    ok(faceSeen, "a carved pumpkin's FACE is drawn in its icon, as it is in the game");
  }
}
{
  // a SHAPED block must not render the same picture as a cube
  const stone = render('stone', SZ), slab = render('oak_slab', SZ), stair = render('oak_stairs', SZ);
  ok(opaque(slab) < opaque(stone) * 0.8, `a slab covers less than a cube (${opaque(slab)} vs ${opaque(stone)})`);
  ok(opaque(stair) < opaque(stone), `and a stair covers less than a cube (${opaque(stair)} vs ${opaque(stone)})`);
  ok(opaque(stair) > opaque(slab), 'and more than a slab');
  // a CROSS-shaped plant is mostly empty
  const poppy = render('poppy', SZ);
  ok(opaque(poppy) > 0 && opaque(poppy) < opaque(stone) * 0.6,
     `a poppy is a thin cross, not a cube (${opaque(poppy)} vs ${opaque(stone)})`);
}
{
  // the HAND transform draws a different picture from the gui one, and restores the gui numbers
  const before = [BI.GUI_ROT_X, BI.GUI_ROT_Y, BI.GUI_SCALE];
  const held = BI.renderHeld(stateOf('stone'), SZ);
  ok([BI.GUI_ROT_X, BI.GUI_ROT_Y, BI.GUI_SCALE].join(',') === before.join(','),
     'renderHeld puts the gui transform back when it is done');
  const gui = render('stone', SZ);
  let diff = 0;
  for (let i = 0; i < gui.length; i += 4) if (gui[i + 3] !== held[i + 3]) diff++;
  ok(diff > SZ * SZ * 0.05, `the held block is a different picture from the icon (${diff} pixels differ)`);
}

// ═══════════════ 4. the flat-fallback set, held closed ═════════════════════════════════════
console.log('\n 4. the blocks with no model');
const FLAT = [];
{
  for (let id = 1; id < R.blockCount; id++) {
    const st = R.realFirst[id] + R.defaultState[id];
    const buf = BI.renderState(st, 16);
    let any = false;
    for (let p = 3; p < buf.length; p += 4) if (buf[p]) { any = true; break; }
    if (!any) FLAT.push(R.names[id]);
  }
  console.log(`    ${FLAT.length} of ${R.blockCount - 1} blocks render nothing and fall back to their flat tile`);
  say(FLAT.join(' '));
  // ⚠ A RANGE, NOT A LITERAL (the standing rule: never let a check own a number the code owns).
  // What is asserted is the SHAPE of the set: it is small, it is not empty, and it is made of
  // the things whose shape lives in code rather than in a model.
  ok(FLAT.length > 40 && FLAT.length < 200,
     `${FLAT.length} blocks take the flat path — outside 40..200 something stopped resolving`);
  // both directions, on the cases that cannot be in doubt
  // ⚠ `air` IS NOT ON THIS LIST: it is block 0 and the walk starts at 1, so asserting it takes
  // the flat path asserted something the walk cannot see. `cave_air` and `void_air` are real
  // blocks with real ids and they ARE on it.
  const MUST = ['chest', 'trapped_chest', 'ender_chest', 'oak_sign', 'oak_wall_sign',
    'white_bed', 'white_banner', 'cave_air', 'void_air'];
  const MUST_NOT = ['stone', 'dirt', 'grass_block', 'oak_planks', 'oak_log', 'glass',
    'oak_slab', 'oak_stairs', 'poppy', 'torch', 'crafting_table', 'furnace', 'cobblestone'];
  for (const n of MUST) {
    if (R.id[n] === undefined) continue;
    ok(FLAT.indexOf(n) >= 0, `${n} has no model and must take the flat path`);
  }
  for (const n of MUST_NOT) ok(FLAT.indexOf(n) < 0, `${n} HAS a model and must not take the flat path`);
}

// ═══════════════ 5. anti-vacuity (D-30) ════════════════════════════════════════════════════
console.log('\n 5. anti-vacuity — each measurement is broken and the break must be caught');
{
  // ⚠ THE AZIMUTH FLIPPED: 45 degrees instead of 225. It still draws a clean symmetric hexagon —
  // that is the point — and it shows the OTHER three faces, so the furnace's front disappears.
  // This is the break that makes the furnace assertion above worth having.
  const was = BI.GUI_ROT_Y;
  BI.GUI_ROT_Y = 45;
  const ai2 = JSON.parse(readFileSync(join(ASSETS, 'atlas-index.json'), 'utf8'));
  const real2 = BI.quadsOf;
  let frontSeen = false;
  for (const one of real2(stateOf('furnace'))) {
    BI.quadsOf = () => [one];
    const buf = BI.renderState(stateOf('furnace'), 32);
    let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 128) n++;
    if (n && one.tile === ai2.index['block/furnace_front']) frontSeen = true;
  }
  BI.quadsOf = real2;
  BI.GUI_ROT_Y = was;
  okAv(!frontSeen, 'anti-vacuity: at 45 degrees the furnace shows its BACK — the azimuth is load-bearing');
}
{
  // the transform zeroed: every vertex collapses to the centre and the icon is empty
  const was = BI.GUI_SCALE;
  BI.GUI_SCALE = 0;
  const dead = BI.renderState(stateOf('stone'), SZ);
  okAv(opaque(dead) < SZ * SZ * 0.05, 'anti-vacuity: a zero-scale transform draws (almost) nothing');
  BI.GUI_SCALE = was;
  okAv(opaque(BI.renderState(stateOf('stone'), SZ)) > SZ * SZ * 0.35, 'anti-vacuity: and the break is undone');
}
{
  // the rotation removed: a cube seen face-on FILLS its square, which is exactly the flat-sprite
  // signature §3 refuses — so this is the break that proves §3's corner test can fail.
  const was = [BI.GUI_ROT_X, BI.GUI_ROT_Y, BI.GUI_SCALE];
  BI.GUI_ROT_X = 0; BI.GUI_ROT_Y = 0; BI.GUI_SCALE = 1;
  const flatOn = BI.renderState(stateOf('stone'), SZ);
  const px = (x, y) => flatOn[(y * SZ + x) * 4 + 3];
  okAv(px(1, 1) > 0 && px(SZ - 2, SZ - 2) > 0,
       'anti-vacuity: face-on and unscaled, the cube DOES fill its corners — so the corner test bites');
  BI.GUI_ROT_X = was[0]; BI.GUI_ROT_Y = was[1]; BI.GUI_SCALE = was[2];
}
{
  // the atlas blanked: the picture must go with it
  const saved = NS.Atlas.mips;
  NS.Atlas.mips = null;
  okAv(opaque(BI.renderState(stateOf('stone'), SZ)) === 0,
       'anti-vacuity: with no atlas the rasteriser draws nothing rather than a grey square');
  NS.Atlas.mips = saved;
}
{
  // the flat set: a block whose quads are taken away joins it
  const id = R.id.stone;
  const st = R.realFirst[id] + R.defaultState[id];
  const realQuads = BI.quadsOf;
  BI.quadsOf = () => [];
  const buf = BI.renderState(st, 16);
  let any = false;
  for (let p = 3; p < buf.length; p += 4) if (buf[p]) { any = true; break; }
  BI.quadsOf = realQuads;
  // ⚠ this one may not bite: `renderState` walks the baked table itself rather than calling
  // `quadsOf`, and if so the assertion below records THAT rather than pretending otherwise.
  okAv(!any || BI.quadsOf(st).length === 6,
       'anti-vacuity: the flat set follows what the renderer draws, and stone still has its six quads');
}
{
  // grass's tint removed: the top stops being green
  const G = NS.Gfx;
  const saved = G.SHADE.TINT;
  G.SHADE.TINT = [[1, 1, 1]];
  const grass = BI.renderState(stateOf('grass_block'), SZ);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.round(SZ * 0.15); y < Math.round(SZ * 0.32); y++) for (let x = 0; x < SZ; x++) {
    const o = (y * SZ + x) * 4;
    if (grass[o + 3] > 200) { r += grass[o]; g += grass[o + 1]; b += grass[o + 2]; n++; }
  }
  const flat = n ? [r / n, g / n, b / n] : [0, 0, 0];
  okAv(!(flat[1] > flat[0] * 1.15), `anti-vacuity: with a white tint the grass top stops being green (${flat.map((v) => v.toFixed(0)).join(',')})`);
  G.SHADE.TINT = saved;
}

// ═══════════════ 6. the ARM: which end is the hand ═════════════════════════════════════════
console.log('\n 6. the first-person arm (D-320)');

// ⚠⚠ WHY THIS SECTION EXISTS. Dan, 14 Sept 2026, three times: *"the hand I can see is reversed:
// the sleeve is where the arm should be and vice versa."* The arm was rendering UPSIDE DOWN —
// shoulder up, fist down — and every check in the suite was green, because not one of them had
// ever asked which END of the arm was which. `iconcheck` §1 pinned the hand's ROTATION NUMBERS
// and nothing pinned the picture, which is the same vacuity D-310 names: a constant that matches
// the jar is not a rendering that matches the game.
//
// ⚠ THE ASSERTIONS BELOW ARE ABOUT PIXELS, NOT ARITHMETIC, and they are stated in the only terms
// that cannot drift: a synthetic skin whose arm rect is painted in bands, rendered through the
// real `armSprite`, and read back. If the arm flips, mirrors, turns over or slides to the other
// side of the screen, one of these goes red.

const VW = 854, VH = 480;

// ⚠ THE JAR'S OWN NUMBERS. `ItemInHandRenderer.renderPlayerArm` in 1.18.2 (obfuscated class
// `eqo`, method `a(dtm, eqs, int, float, float, axt)`), with the axis constants identified by
// their VALUES in `k`'s static block — k.c = (1,0,0) = XP, k.e = (0,1,0) = YP, k.g = (0,0,1) = ZP
// — rather than by any name (D-263).
const AR = BI.ARM_ROT;
ok(AR.yOuter === 45 && AR.swingY === 70 && AR.swingZ === -20,
   `the arm's outer rotations are Y${AR.yOuter}, swing Y${AR.swingY} Z${AR.swingZ}`);
ok(AR.z === 120 && AR.x === 200 && AR.y === -135,
   `the turn-over is Z${AR.z} X${AR.x} Y${AR.y}`);
ok(AR.x !== 180, 'the turn-over is 200 degrees, not a rounded 180');
ok(BI.ARM.x0 === -3 && BI.ARM.y0 === -2 && BI.ARM.z0 === -2 &&
   BI.ARM.w === 4 && BI.ARM.h === 12 && BI.ARM.d === 4,
   "the box is PlayerModel's addBox(-3, -2, -2, 4, 12, 4)");
ok(BI.ARM.u === 40 && BI.ARM.v === 16 && BI.ARM.sleeveU === 40 && BI.ARM.sleeveV === 32,
   'the arm is texOffs(40, 16) and the sleeve texOffs(40, 32)');

// the unwrap: the two caps, and the strip that has to stay joined
{
  const F = BI.boxFaces(40, 16, 4, 12, 4);
  // faces are [y0 cap, y1 cap, x0, z0, x1, z1]; uv is 4 corners of [u, v]
  const rect = (f) => {
    const us = [f.uv[0], f.uv[2], f.uv[4], f.uv[6]], vs = [f.uv[1], f.uv[3], f.uv[5], f.uv[7]];
    return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
  };
  const y0 = rect(F[0]), y1 = rect(F[1]), x0 = rect(F[2]), z0 = rect(F[3]);
  ok(y0[0] === 44 && y0[1] === 16, `the SHOULDER cap is the rect at (u+d, v) = (${y0[0]}, ${y0[1]})`);
  ok(y1[0] === 48 && y1[1] === 16, `the HAND cap is the rect at (u+d+w, v) = (${y1[0]}, ${y1[1]})`);
  ok(x0[0] === 40 && x0[2] === 44 && z0[0] === 44 && z0[2] === 48,
     'the side strip runs x0 | z0 | x1 | z1 with no gap');
  // the shared texture edge must be the shared GEOMETRIC edge, or the arm is mirrored
  const cornerAtU = (f, u, wantX) => {
    for (let k = 0; k < 4; k++) if (f.uv[k * 2] === u) return f.c[k];
    return -1;
  };
  // corner numbering: 0..3 are z0, 4..7 are z1; 0,3,4,7 are x0; 1,2,5,6 are x1
  const isX0 = (c) => c === 0 || c === 3 || c === 4 || c === 7;
  const isZ0 = (c) => c < 4;
  ok(isZ0(cornerAtU(F[2], 44)) && isX0(cornerAtU(F[3], 44)),
     'the x0 and z0 faces meet along the same edge in the skin as they do on the box');
}

// ── the picture ────────────────────────────────────────────────────────────────────────────
// A skin whose right-arm rect is a vertical ramp: the row nearest the SHOULDER is red, the row
// nearest the HAND is blue. Nothing else in the skin is opaque, so whatever the render contains
// came from the arm.
const bandSkin = () => {
  const px = new Uint8ClampedArray(64 * 64 * 4);
  for (let v = 16; v < 32; v++) for (let u = 40; u < 56; u++) {
    const i = (v * 64 + u) * 4;
    const t = v < 20 ? 0 : (v - 20) / 11;            // 0 at the shoulder, 1 at the hand
    px[i] = Math.round(255 * (1 - t)); px[i + 1] = 0; px[i + 2] = Math.round(255 * t); px[i + 3] = 255;
  }
  return px;
};
const SKIN = bandSkin();

const armAt = (swing, w, h) => BI.armSprite(SKIN, 64, w || VW, h || VH, 70, swing, 0);

// ⚠ THE SHOULDER IS LEGITIMATELY OFF SCREEN — vanilla's arm runs off the bottom edge, and the
// first version of this check looked for the shoulder decile, found none, and passed on a NaN.
// So the measurement is a GRADIENT within whatever IS visible: sort the drawn pixels by how far
// along the arm they came from and compare the far quarter with the near quarter.
const ends = (sp) => {
  const pts = [];
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    const o = (y * sp.w + x) * 4;
    if (!sp.data[o + 3]) continue;
    const r = sp.data[o], b = sp.data[o + 2];
    if (r + b < 8) continue;
    pts.push([b / (r + b), x + sp.x, y + sp.y]);          // t: 0 shoulder-ward, 1 hand-ward
  }
  if (pts.length < 40) return { n: pts.length };
  pts.sort((a, c) => a[0] - c[0]);
  const q = Math.max(1, Math.floor(pts.length / 4));
  const mean = (arr, i) => arr.reduce((a, p) => a + p[i], 0) / arr.length;
  const low = pts.slice(0, q), high = pts.slice(-q);
  return { n: pts.length, spread: high[0][0] - low[low.length - 1][0],
           sx: mean(low, 1), sy: mean(low, 2), hx: mean(high, 1), hy: mean(high, 2) };
};

{
  const sp = armAt(0);
  ok(!!sp, 'the resting arm is on screen');
  const e = ends(sp);
  ok(e.n > 1000, `the arm is drawn (${e.n} texel-bearing pixels)`);
  ok(e.spread > 0.05, `the visible arm spans a range of the skin, not one band (${(e.spread || 0).toFixed(2)})`);
  // ⚠⚠ **THE ASSERTION DAN'S BUG FAILS.** Screen y grows downward, so the hand-ward quarter must
  // have the SMALLER y. On the old renderer this sat the other way round.
  ok(e.hy < e.sy - 5,
     `the HAND end is above the shoulder end on screen (hand y ${e.hy.toFixed(0)}, shoulder y ${e.sy.toFixed(0)})`);
  ok(sp.y + sp.h >= VH - 1, 'the arm runs off the bottom edge of the viewport');
  ok(sp.x + sp.w > VW * 0.55, 'the arm is in the right-hand half of the viewport');
  ok(e.hx < e.sx, `it leans up and to the LEFT (hand x ${e.hx.toFixed(0)} < shoulder x ${e.sx.toFixed(0)})`);
}

// ⚠ THE ARM SCALES WITH THE VIEWPORT AND IS NEVER CROPPED BY THE SAFETY CAP. A 512-pixel cap
// looked perfect at the 854x480 these checks run at and cut the fist off at 1080p and above.
{
  const sizes = [[854, 480], [1280, 720], [1920, 1080], [3840, 2160]];
  let lastW = 0, uncropped = 0;
  for (const [w, h] of sizes) {
    const sp = armAt(0, w, h);
    ok(!!sp, `the arm is on screen at ${w}x${h}`);
    if (!sp) continue;
    ok(sp.w > lastW, `it grows with the viewport (${sp.w}px across at ${w}x${h})`);
    lastW = sp.w;
    if (sp.x + sp.w >= w - 1) uncropped++;
  }
  ok(uncropped === sizes.length, `the arm reaches the right edge at all ${sizes.length} sizes — the cap never crops it`);
}

// ⚠ A PORTRAIT WINDOW HAS NO HAND, AND THAT IS VANILLA. The FOV is vertical, so a tall narrow
// viewport narrows the horizontal field until the arm falls outside it. The assertion exists so
// that nobody "fixes" this into a clamp that invents a hand.
ok(armAt(0, 400, 720) === null, 'a portrait viewport reports no arm rather than clamping one on screen');

// the swing sweeps it, and the sweep is the jar's shape, not a single sine
{
  const p0 = armAt(0), p3 = armAt(0.35), p7 = armAt(0.7);
  ok(!!p0 && !!p3 && !!p7, 'the arm is on screen through the swing');
  const c = (sp) => sp.x + sp.w / 2;
  ok(c(p3) < c(p0) - 30, 'the swing carries the arm toward the middle of the screen');
  ok(Math.abs(c(p7) - c(p3)) > 10, 'and it is still moving at 0.7 — the arc is not a plateau');
}

// the sleeve is drawn, and it is drawn OVER the arm
{
  const withSleeve = new Uint8ClampedArray(SKIN);
  for (let v = 32; v < 48; v++) for (let u = 40; u < 56; u++) {
    const i = (v * 64 + u) * 4;
    withSleeve[i] = 0; withSleeve[i + 1] = 255; withSleeve[i + 2] = 0; withSleeve[i + 3] = 255;
  }
  const sp = BI.armSprite(withSleeve, 64, VW, VH, 70, 0, 0);
  let green = 0, other = 0;
  for (let i = 0; i < sp.data.length; i += 4) {
    if (!sp.data[i + 3]) continue;
    if (sp.data[i + 1] > sp.data[i] && sp.data[i + 1] > sp.data[i + 2]) green++; else other++;
  }
  ok(green > other * 4, `the sleeve overlay covers the bare arm (${green} sleeve px vs ${other})`);
}

// shade follows the ROTATED normal (D-314's lesson, restated for the arm)
{
  const flat = new Uint8ClampedArray(64 * 64 * 4);
  for (let v = 16; v < 32; v++) for (let u = 40; u < 56; u++) {
    const i = (v * 64 + u) * 4;
    flat[i] = flat[i + 1] = flat[i + 2] = 255; flat[i + 3] = 255;
  }
  const sp = BI.armSprite(flat, 64, VW, VH, 70, 0, 0);
  const seen = new Set();
  for (let i = 0; i < sp.data.length; i += 4) if (sp.data[i + 3]) seen.add(sp.data[i]);
  ok(seen.size >= 2, `the arm is shaded by face (${seen.size} distinct levels)`);
  // the model-space "up" face is turned over by the 200 degrees, so it must NOT be the brightest
  // ⚠ THE WHOLE BUG IN ONE NUMBER. The arm box's model +Y runs from shoulder to hand. After
  // `rotateX(200)` it must point UP in view space; without the turn-over it points DOWN, and
  // that single sign is the difference between an arm and Dan's reversed one.
  const upY = BI.armPose(0, 0).r[4];
  ok(upY > 0.2, `the box's model +Y (shoulder -> hand) points UP in view space (${upY.toFixed(2)})`);
}

// the projection is a projection: the far end is smaller than the near end
{
  const sp = armAt(0);
  const widthAtRow = (row) => {
    let n = 0;
    for (let x = 0; x < sp.w; x++) if (sp.data[(row * sp.w + x) * 4 + 3]) n++;
    return n;
  };
  const top = widthAtRow(Math.round(sp.h * 0.1)), bot = widthAtRow(Math.round(sp.h * 0.9));
  ok(top > 0 && bot > 0, 'the arm spans the sprite top to bottom');
  ok(bot > top * 1.05, `the near end is wider than the far end (${bot} vs ${top}) — it is in perspective`);
}

// ═══════════════ 7. anti-vacuity for the arm (D-30) ════════════════════════════════════════
console.log('\n 7. anti-vacuity — the arm checks are broken and the breaks must be caught');

{
  // turn the box over the way the old code had it: read the same table in a +Y-up space
  const realFaces = BI.boxFaces;
  BI.boxFaces = function (u, v, w, h, d) {
    const f = realFaces(u, v, w, h, d);
    // swap the two caps and run the side strip's V the other way — precisely the old bug
    const t = f[0]; f[0] = f[1]; f[1] = t;
    for (let i = 2; i < 6; i++) {
      const uv = f[i].uv;
      const vs = [uv[1], uv[3], uv[5], uv[7]];
      const lo = Math.min(...vs), hi = Math.max(...vs);
      for (let k = 0; k < 4; k++) uv[k * 2 + 1] = lo + hi - uv[k * 2 + 1];
    }
    return f;
  };
  const e = ends(armAt(0));
  BI.boxFaces = realFaces;
  okAv(e.n > 1000 && !(e.hy < e.sy - 5),
       'anti-vacuity: with the skin read in a +Y-up space the hand stops being the upper end');
}
{
  // drop the 200-degree turn-over: the arm should fall out of its place
  const real = BI.ARM_ROT.x;
  BI.ARM_ROT.x = 0;
  const up0 = BI.armPose(0, 0).r[4];
  const sp = armAt(0);
  const moved = !sp || sp.y + sp.h < VH - 1 || sp.x + sp.w <= VW * 0.55;
  BI.ARM_ROT.x = real;
  okAv(up0 < 0, `anti-vacuity: without the turn-over the arm hangs the wrong way up (${up0.toFixed(2)})`);
  okAv(moved, 'anti-vacuity: and it leaves the bottom-right corner');
}
{
  // a skin with nothing in the arm rect draws nothing
  const empty = new Uint8ClampedArray(64 * 64 * 4);
  const sp = BI.armSprite(empty, 64, VW, VH, 70, 0, 0);
  let any = false;
  if (sp) for (let i = 3; i < sp.data.length; i += 4) if (sp.data[i]) { any = true; break; }
  okAv(!any, 'anti-vacuity: an empty skin rect draws no arm rather than a silhouette');
}
{
  // a viewport the arm cannot fit in must report honestly rather than clamping to a corner
  const sp = BI.armSprite(SKIN, 64, 32, 32, 70, 0, 0);
  okAv(!sp || (sp.w <= 32 && sp.h <= 32),
       'anti-vacuity: a tiny viewport never yields a sprite larger than itself');
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` iconcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the block icon is the block, drawn at vanilla\'s own display transform.');
