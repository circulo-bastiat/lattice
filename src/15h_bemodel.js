// 15h_bemodel.js — PLAN G10c: THE BLOCK-ENTITY ITEM MODELS.
//
// MAIN THREAD. Software-rasterised, like the block icons next door in 15d.
//
// ⚠⚠ **SIXTY ITEMS DREW NOTHING BEFORE THIS FILE.** Every chest, all seventeen shulker boxes,
// all sixteen beds, all sixteen banners, the six heads, the conduit and the shield are
// `builtin/entity` in vanilla: they have NO item sprite and NO block model, and the game draws
// each one by running its BLOCK-ENTITY RENDERER into the slot. That renderer needs boxes and a
// texture, and MC-Lite had neither.
//
// ⚠ **THE BOXES ARE THE JAR'S** (D-317). `tools/extract-models.mjs` reads every model layer in
// the game out of `CubeListBuilder.create().texOffs(0, 19).addBox(1, 0, 1, 14, 10, 14)` — there
// is no JSON for a chest's lid anywhere, in any version, so compiled Java is the only source of
// truth there has ever been. 70 layers, 310 boxes, five kilobytes deflated.
//
// ⚠⚠ **AND THE UV LAYOUT IS DERIVED FROM A CASE NOBODY CAN ARGUE WITH.** A box at `texOffs(u, v)`
// with size `w x h x d` lays its six faces out as
//     up     (u+d,       v)      w x d      down  (u+d+w,   v)        w x d
//     west   (u,         v+d)    d x h      north (u+d,     v+d)      w x h
//     east   (u+d+w,     v+d)    d x h      south (u+d+w+d, v+d)      w x h
// and that is not a rule read off a wiki: it is the rule that reproduces the PLAYER SKIN's own
// documented coordinates. The right arm is `texOffs(40, 16)` with `4 x 12 x 4`, and the formula
// above puts its outer side at (40, 20), its front at (44, 20), its inner at (48, 20), its back
// at (52, 20), its top cap at (44, 16) and its bottom at (48, 16) — all six of which are the
// numbers `15d_blockicon.js`'s arm table already uses and the hand is already drawn with.
// `bemodelcheck` asserts the formula against that table, which makes the skin the referee.

(function (NS) {
  'use strict';

  var BE = NS.BEModel = { ready: false, layers: null, gui: null, dye: null };

  /** Decode `models.bin` — the same deflated-JSON shape the rest of NS.DATA travels in. */
  BE.init = function (data) {
    if (!data || !data.models || !NS.Z) { BE.ready = false; return false; }
    var b = NS.Z.unpack(data.models, data.modelsBytes);
    var CH = 8192, parts = [];
    for (var i = 0; i < b.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, b.subarray(i, Math.min(i + CH, b.length))));
    }
    var payload = JSON.parse(parts.join(''));
    BE.layers = payload.layers || payload;
    // ⚠ THE `gui` DISPLAY TRANSFORM OF EVERY `builtin/entity` ITEM, out of the jar's own item
    // models. It is also the AUTHORITATIVE ROSTER of the items that have no sprite and no block
    // model: a `builtin/entity` parent chain is exactly what "nothing can draw this" means.
    BE.gui = payload.gui || Object.create(null);
    // the sixteen `DyeColor.textureDiffuseColors`, for the one family that is tinted rather than
    // given its own texture
    BE.dye = payload.dye || Object.create(null);
    BE.ready = true;
    return true;
  };

  BE.layer = function (name) { return (BE.layers && BE.layers[name]) || null; };

  /**
   * ⚠ WHICH LAYER AND WHICH TEXTURE EACH ITEM USES.
   *
   * This is the one table in the file that is not read out of the jar, and it is worth saying
   * exactly why: vanilla's own answer lives in `BlockEntityWithoutLevelRenderer.renderByItem`,
   * a switch over block types inside a rendering method, and reading a switch's arms out of
   * obfuscated bytecode is a different and much weaker exercise than reading a constructor's
   * arguments. What IS held closed is the result: `bemodelcheck` asserts that every entry names a
   * layer the golden table has and a texture the payload ships, that the set of items covered is
   * exactly `Creative.NO_ICON` minus the named exceptions, and that the sixteen colours come from
   * the DYE TABLE rather than from a list typed here.
   */
  BE.RULES = [
    { re: /^chest$/,             layer: 'chest',    tex: 'be_chest' },
    { re: /^trapped_chest$/,     layer: 'chest',    tex: 'be_trapped_chest' },
    { re: /^ender_chest$/,       layer: 'chest',    tex: 'be_ender_chest' },
    { re: /^shulker_box$/,       layer: 'shulker',  tex: 'be_shulker_box' },
    { re: /^(\w+)_shulker_box$/, layer: 'shulker',  tex: 'be_$1_shulker_box' },
    { re: /^(\w+)_bed$/,         layer: 'bed_head', tex: 'be_$1_bed', second: 'bed_foot' },
    { re: /^(\w+)_banner$/,      layer: 'banner',   tex: 'be_banner', tintBy: '$1' },
    { re: /^shield$/,            layer: 'shield',   tex: 'be_shield' },
    // ⚠ THE FIVE HEADS (D-324). Each is one 8x8x8 cube at texOffs(0, 0) — the layers say so —
    // and the only thing separating them is the sheet: a mob skull is 64x32 and a player or
    // zombie head 64x64, which is why vanilla has two factories rather than one. The player's
    // head reuses the `steve` sheet the inventory preview and the arm already ship.
    { re: /^player_head$/,           layer: 'player_head',           tex: 'steve' },
    { re: /^zombie_head$/,           layer: 'zombie_head',           tex: 'be_zombie_head' },
    { re: /^creeper_head$/,          layer: 'creeper_head',          tex: 'be_creeper_head' },
    { re: /^skeleton_skull$/,        layer: 'skeleton_skull',        tex: 'be_skeleton_skull' },
    { re: /^wither_skeleton_skull$/, layer: 'wither_skeleton_skull', tex: 'be_wither_skeleton_skull' },
    // #109: the last two `builtin/entity` items. Both layers are built in `pack-models.mjs`
    // from the decompiled `DragonHeadEntityModel` and `ConduitBlockEntityRenderer`.
    { re: /^dragon_head$/,           layer: 'dragon_head',           tex: 'be_dragon_head' },
    { re: /^conduit$/,               layer: 'conduit',               tex: 'be_conduit' }
  ];

  /**
   * Items with no model yet. EMPTY since #109: the dragon head and the conduit, the last two, are
   * built in `pack-models.mjs` from the decompiled classes (the walk cannot register either).
   * `bemodelcheck` still fails an item that is neither ruled nor named here.
   */
  BE.OWED = [];

  /**
   * ⚠ WHICH FAMILIES ARE DRAWN UPSIDE DOWN, one line per vanilla renderer that scales Y by -1
   * before it draws. `BannerRenderer` does `scale(0.667, -0.667, 0.667)`; `BedRenderer` rolls
   * 180 degrees about Z; `ShulkerBoxRenderer` turns 180 about Y and drops a block. `ChestRenderer`
   * and the shield's do neither. Getting one wrong gives a model that renders INSIDE OUT — hollow
   * and lit from within — which is loud enough that `bemodelcheck` can see it in the pixels.
   */
  BE.FLIP = { shulker: true, chest: false };

  /**
   * #7652 -- THE ITEM PATH IS NOT THE PLACED PATH. `BannerBlockEntityRenderer` scales the item by
   * `(0.6667, -0.6667, -0.6667)` and `BuiltinModelItemRenderer` draws the shield with `scale(1, -1, -1)`:
   * two negated axes are a ROTATION of 180 degrees about X (winding kept), not the mirror `FLIP` is,
   * so both belong in `TURN`. A bed (`BedBlockEntityRenderer.renderPart`, facing south) is `rotX(90)` after
   * `rotZ(180)`: (x, y, z) -> (-x, -z, -y), also a rotation, listed in `BED`.
   */
  BE.BED = { bed_head: true, bed_foot: true };

  /**
   * #591 -- THE SIX SKULLS ARE TURNED, NOT FLIPPED. `BuiltinModelItemRenderer` draws every skull item with
   * `renderSkull(null, 180, ...)`: `scale(-1, -1, 1)` and a head yaw of 180 degrees, which multiply out to
   * a rotation of 180 degrees about X (`x, -y, -z`). The boxes hang below the origin with the face on -Z,
   * so drawn raw the icon shows the skull's underside and its back. A rotation keeps the winding, unlike
   * `BE.FLIP`'s mirror. `dragon_head` also runs `DragonHeadEntityModel.render`'s uniform 0.75 (the fit
   * makes that invisible in an icon).
   */
  BE.TURN = { banner: true, shield: true, player_head: true, zombie_head: true, creeper_head: true, skeleton_skull: true,
              wither_skeleton_skull: true, dragon_head: true };

  /** Is this item a `builtin/entity` one — no sprite, no block model? Straight from the jar. */
  BE.isEntityItem = function (name) { return !!(BE.gui && BE.gui[name]); };

  /** The `{ layer, tex, second, tint }` for an item name, or null. */
  BE.forItem = function (name) {
    for (var i = 0; i < BE.RULES.length; i++) {
      var r = BE.RULES[i], m = r.re.exec(name);
      if (!m) continue;
      var sub = function (s) { return s.replace(/\$(\d)/g, function (_, k) { return m[+k] || ''; }); };
      var out = { layer: r.layer, tex: sub(r.tex), second: r.second || null, tint: -1 };
      if (r.tintBy) out.tintName = sub(r.tintBy);
      if (!BE.layer(out.layer)) return null;
      return out;
    }
    return null;
  };

  // ── the box UV layout ─────────────────────────────────────────────────────────────────────
  /**
   * The six faces of one box, as `[u, v, w, h]` rectangles in the sheet, in the engine's ARCH §3
   * face order: `+X -X +Y -Y +Z -Z`.
   *
   * ⚠ `mirror` SWAPS THE TWO SIDE FACES, which is what vanilla's `CubeListBuilder.mirror()` does
   * and why a left arm and a right arm can share one patch of skin.
   */
  BE.faceRects = function (p) {
    // #633 (KW-49b): a dilated box (`p.g`, the CubeDeformation) is stored GROWN, but
    // ModelPart.Cuboid lays the texture out from the UN-grown size: w-2g.
    var g = p.g || 0, u = p.tu, v = p.tv, w = Math.round((p.w - 2 * g) * 1000) / 1000, h = Math.round((p.h - 2 * (g + (p.gy || 0))) * 1000) / 1000, d = Math.round((p.d - 2 * g) * 1000) / 1000;
    var west = [u, v + d, d, h];
    var east = [u + d + w, v + d, d, h];
    if (p.m) { var t = west; west = east; east = t; }
    return [
      east,                       // +X
      west,                       // -X
      // D-773 (beautiful-allen-7isws6): `ModelPart.Cuboid` (.decomp lines 212-213) gives
      // `sides[2]` (DOWN, the box's MIN-y face) `(u+d, v)` and `sides[3]` (UP, MAX-y)
      // `(u+d+w, v)`. These two were the other way round: every living mob (model flipped,
      // min-y = world top) showed its underside patch on top -- a closed shulker's hollow
      // lid-underside, a zombie's chin where its hair is.
      [u + d + w, v, w, d],       // +Y  (max-y: UP)
      [u + d, v, w, d],           // -Y  (min-y: DOWN -- a living mob's world TOP)
      [u + d + w + d, v + d, w, h], // +Z
      [u + d, v + d, w, h]          // -Z
    ];
  };

  /**
   * D-773 (beautiful-allen-7isws6) -- WHICH WAY a face's texture runs, vanilla's, per face.
   * `ModelPart.Cuboid`'s vertex->uv pairing (.decomp lines 195-219 with `Quad`'s
   * `[u2,v1] [u1,v1] [u1,v2] [u2,v2]` remap, lines 256-259) read corner by corner: texture u
   * runs along `+z -z +x +x -x +x` (ARCH order `+X -X +Y -Y +Z -Z`, u axis per `ARCH_AXES`),
   * texture v along `+y +y -z -z +y +y`, and `mirror` (which swaps the box's x0/x1 before any
   * of that) reverses u on EVERY face, not only the side-rect swap `faceRects` does.
   * `BE.faceUV` fills a face's four corners (in `FACE_CORNERS`/`MOB_FACE_CORNERS` order, whose
   * natural runs are u `+z -z +x +x -x +x`, v `+y +y +z -z +y +y`) to match -- +Y's v and a
   * mirrored box's u were the two that differed; `BE.faceDir` places a >16-texel face's
   * atlas slices along the axis the same way (a slice at texture offset 0 sits at the LOW end
   * of the axis only where the texture runs toward +axis).
   */
  var VAN_U = [1, -1, 1, 1, -1, 1], VAN_V = [1, 1, -1, -1, 1, 1];
  var NAT_V = [1, 1, 1, -1, 1, 1];
  BE.faceDir = function (f, m) { return [m ? -VAN_U[f] : VAN_U[f], VAN_V[f]]; };
  BE.faceUV = function (f, m, u0, v0, u1, v1, us, vs) {
    if (m) { var tu = u0; u0 = u1; u1 = tu; }
    if (NAT_V[f] !== VAN_V[f]) { var tv = v0; v0 = v1; v1 = tv; }
    us[0] = u0; vs[0] = v0; us[1] = u1; vs[1] = v0;
    us[2] = u1; vs[2] = v1; us[3] = u0; vs[3] = v1;
  };

  // ── geometry ──────────────────────────────────────────────────────────────────────────────
  function deg(x) { return x * Math.PI / 180; }

  /**
   * The rotation core alone -- `ModelPart.translateAndRotate`'s `Z then Y then X` order,
   * applied to one vector, with NO translation and NO pivot added. `corners()` uses it per
   * corner (then adds the pivot); `BE.poseAxis` (below) uses it on a pure direction, which is
   * the thing a corner-position trick cannot always give (see that function's own header).
   */
  function rotateZYX(p, X, Y, Z, out) {
    var cz = Math.cos(p.rz), sz = Math.sin(p.rz);
    var cy = Math.cos(p.ry), sy = Math.sin(p.ry);
    var cx = Math.cos(p.rx), sx = Math.sin(p.rx);
    // ⚠ Z THEN Y THEN X, which is `ModelPart.translateAndRotate`'s order and not a choice:
    // `mulPose(ZP).mulPose(YP).mulPose(XP)` applied to a column vector means X runs first.
    var ax = X, ay = Y * cx - Z * sx, az = Y * sx + Z * cx;
    var bx = ax * cy + az * sy, by = ay, bz = -ax * sy + az * cy;
    out[0] = bx * cz - by * sz; out[1] = bx * sz + by * cz; out[2] = bz;
    return out;
  }

  /** The eight corners of a box, already posed and rotated, in model units. */
  var _c3 = new Float64Array(3);
  function corners(p, out) {
    var x0 = p.x, y0 = p.y, z0 = p.z;
    var x1 = x0 + p.w, y1 = y0 + p.h, z1 = z0 + p.d;
    var k = 0;
    for (var i = 0; i < 8; i++) {
      var X = (i & 1) ? x1 : x0, Y = (i & 2) ? y1 : y0, Z = (i & 4) ? z1 : z0;
      rotateZYX(p, X, Y, Z, _c3);
      out[k++] = _c3[0] + p.px; out[k++] = _c3[1] + p.py; out[k++] = _c3[2] + p.pz;
    }
    return out;
  }

  /**
   * ⚠⚠ **WHY A SEPARATE FUNCTION FROM `corners()`, RATHER THAN DERIVING A FACE'S OUTWARD
   * NORMAL FROM ITS CORNERS.** A flat "card" part -- one dimension zero, e.g. axolotl's
   * `body` (`w:0`) or a leg/gill/fin (`d:0`) -- has its `+axis` and `-axis` faces at the
   * EXACT SAME POSITION along that axis: their corners coincide there, so "face centroid minus
   * box centroid" is the zero vector and cannot tell +X from -X even though BOTH faces are
   * real, visible geometry (the front and back of the card). The distinction is not a fact
   * about POSITION at all -- it is a fact about which LOCAL AXIS the box was authored with,
   * rotated the same way `corners()` rotates a position, minus the translation a direction
   * does not have. `07j_entityrender.js`'s `ER.emitMobLayer` uses this to pick BOTH the
   * winding order and the shading face for every quad, not only the degenerate ones, because a
   * THICK box's corner-centroid trick and this one agree exactly (by construction, an
   * axis-aligned box's face-centroid offset from its own centroid IS that local axis, scaled)
   * and a single method that is always right beats two that quietly disagree on which boxes
   * are "thin enough" to need the exception.
   */
  BE.poseAxis = function (p, ax0, ay0, az0, out) { return rotateZYX(p, ax0, ay0, az0, out); };

  /**
   * Exported so `07j_entityrender.js` (PASS 15 JOB 4.3, the world-space mob box renderer) can
   * pose the SAME box -- one pivot, one rotation order (Z then Y then X, D-317) -- as this
   * file's own icon rasteriser, rather than growing a second copy of the corner math (D-314's
   * lesson, applied here before it could be forgotten a second time).
   */
  BE.poseBoxCorners = corners;

  // the eight corners of a unit cube, indexed as (i&1)=x1 (i&2)=y1 (i&4)=z1; each face lists its
  // four corner indices in an order whose winding faces OUTWARD along that axis
  var FACE_CORNERS = [
    [1, 5, 7, 3],   // +X
    [4, 0, 2, 6],   // -X
    [2, 3, 7, 6],   // +Y
    [4, 5, 1, 0],   // -Y
    [5, 4, 6, 7],   // +Z
    [0, 1, 3, 2]    // -Z
  ];

  /**
   * Render one layer into an RGBA buffer of `size` x `size`.
   *
   * ⚠ SOME OF THESE MODELS ARE BUILT UPSIDE DOWN AND SOME ARE NOT, and that is vanilla's doing
   * rather than something to correct in the extracted table. A CHEST's boxes are right way up —
   * `ChestRenderer` draws them straight. A BANNER's are not: `BannerRenderer` scales by
   * `(0.667, -0.667, 0.667)` before drawing, so the flag's `y = 0..40` hangs DOWNWARD. Each
   * renderer has its own preamble, so `BE.FLIP` names the families that need one and
   * `bemodelcheck` asserts each against the picture.
   *
   * ⚠⚠ **THE ROTATION IS VANILLA'S AND THE FRAMING IS NOT — A DECLARED DEVIATION (D-317).**
   * Vanilla positions each of these by its renderer's own `translate`, then applies the item's
   * `gui` translation and scale on top. MC-Lite reproduces the ROTATION exactly, because that is
   * what decides which faces you see, and then CENTRES the model on its measured extent instead
   * of reproducing five renderers' preambles. The cost is that an icon is framed to fill its
   * slot rather than to vanilla's exact scale; the benefit is that nothing is ever cropped, which
   * is the failure mode a per-renderer translate would produce whenever one was slightly wrong.
   */
  BE.render = function (layerName, texName, size, opts) {
    var o = opts || {};
    var out = new Uint8ClampedArray(size * size * 4);
    var L = BE.layer(layerName);
    var g = NS.Gui;
    var sheet = g && g.sheets ? g.sheets[texName] : null;
    if (!L || !sheet || !sheet.canvas || !sheet.canvas.getContext) return out;
    var tex = o.texData || BE.texData(texName);
    if (!tex) return out;

    // ⚠⚠ **THE ROTATION IS THE ITEM'S OWN, OUT OF THE JAR.** A chest is `[30, 45, 0]`, a shulker
    // box the same, a bed `[30, 160, 0]` and a banner `[30, 20, 0]` — nearly front-on, because a
    // flag seen at 45 degrees is a line. Drawing all of them at the block icon's `[30, 225, 0]`
    // is what the first version did and the banner's flag came out FOUR PIXELS WIDE.
    var rotX = o.rotX === undefined ? 30 : o.rotX;
    var rotY = o.rotY === undefined ? 45 : o.rotY;
    var rotZ = o.rotZ === undefined ? 0 : o.rotZ;
    var zbuf = new Float32Array(size * size);
    for (var i = 0; i < zbuf.length; i++) zbuf[i] = -1e9;

    // ⚠ FIT THE MODEL TO THE ICON rather than assuming sixteen units. A bed is 16 x 16 x 6, a
    // banner is 42 tall, a shield is 22: one scale for all of them either crops the banner or
    // leaves the chest a speck. The extent is measured from the posed corners.
    var parts = (o.parts || L.parts);
    var flip = o.flip ? -1 : 1;
    // #591 -- a 180 degree turn about X (`o.turn`): y AND z negate, winding untouched
    var ty = o.turn ? -1 : 1, tz = o.turn ? -1 : 1;
    // #7652 -- a bed's (x, y, z) -> (-x, -z, -y); `pre` writes the oriented offset from the centre
    var bed = !!o.bed;
    var pre = function (dx, dy, dz, out) {
      if (bed) { out[0] = -dx; out[1] = -dz; out[2] = -dy; }
      else { out[0] = dx; out[1] = flip * ty * dy; out[2] = tz * dz; }
      return out;
    };
    var pq = [0, 0, 0];
    var c8 = new Float64Array(24);
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    var k, j;
    for (k = 0; k < parts.length; k++) {
      corners(parts[k], c8);
      for (j = 0; j < 8; j++) {
        for (var a = 0; a < 3; a++) {
          var v = c8[j * 3 + a];
          if (v < lo[a]) lo[a] = v;
          if (v > hi[a]) hi[a] = v;
        }
      }
    }
    var cx = (lo[0] + hi[0]) * 0.5, cy = (lo[1] + hi[1]) * 0.5, cz = (lo[2] + hi[2]) * 0.5;

    // ⚠⚠ **FIT THE PROJECTED PICTURE, NOT THE MODEL'S LONGEST AXIS.** The first version divided
    // by the largest of the three extents times a 1.42 fudge for the rotation, which is right for
    // a cube and wrong for everything else: a banner is 70 units tall and 20 wide, so "fit the
    // longest axis" drew the flag at a third of the width it had room for. Projecting the corners
    // ONCE at unit scale and measuring the screen box costs one more pass over eight corners per
    // part and is exact for every shape and every angle — and it deletes the fudge factor, which
    // is the kind of constant nobody can ever justify later.
    var unit = matrix(rotX, rotY, rotZ, 1);
    var sLo = [1e9, 1e9], sHi = [-1e9, -1e9];
    var probe = [0, 0, 0];
    for (k = 0; k < parts.length; k++) {
      corners(parts[k], c8);
      for (j = 0; j < 8; j++) {
        pre(c8[j * 3] - cx, c8[j * 3 + 1] - cy, c8[j * 3 + 2] - cz, pq);
        apply(unit, pq[0], pq[1], pq[2], probe);
        if (probe[0] < sLo[0]) sLo[0] = probe[0];
        if (probe[0] > sHi[0]) sHi[0] = probe[0];
        if (probe[1] < sLo[1]) sLo[1] = probe[1];
        if (probe[1] > sHi[1]) sHi[1] = probe[1];
      }
    }
    var screenSpan = Math.max(sHi[0] - sLo[0], sHi[1] - sLo[1], 1e-6);
    var fit = (o.scale === undefined ? 0.94 : o.scale) / screenSpan;
    var m = matrix(rotX, rotY, rotZ, fit);
    // ...and recentre on the PROJECTED box, so a model whose picture is off to one side (a banner
    // is: its pole is at x=0 and its flag hangs to one side of it) sits in the middle of the slot.
    // The scale is uniform, so the projected midpoint simply scales with it.
    var sMidX = (sLo[0] + sHi[0]) * 0.5 * fit, sMidY = (sLo[1] + sHi[1]) * 0.5 * fit;

    var SH = (NS.Gfx && NS.Gfx.SHADE) ? NS.Gfx.SHADE : { FACE: [0.6, 0.6, 1, 0.5, 0.8, 0.8] };
    var tint = o.tint || null;
    var half = size * 0.5;
    var px = [0, 0, 0, 0], py = [0, 0, 0, 0], pz = [0, 0, 0, 0];
    var us = [0, 0, 0, 0], vs = [0, 0, 0, 0];
    var v3 = [0, 0, 0];

    for (k = 0; k < parts.length; k++) {
      var p = parts[k];
      if (p.hidden) continue; // framing only (beorientcheck): counted in the extent above, never drawn
      corners(p, c8);
      var rects = BE.faceRects(p);
      for (var f = 0; f < 6; f++) {
        var idx = FACE_CORNERS[f], r = rects[f];
        for (var q = 0; q < 4; q++) {
          var ci = idx[q] * 3;
          // ⚠ the -1,-1,1 flip, here and nowhere else
          pre(c8[ci] - cx, c8[ci + 1] - cy, c8[ci + 2] - cz, pq);
          apply(m, pq[0], pq[1], pq[2], v3);
          px[q] = half + (v3[0] - sMidX) * size;
          py[q] = half - (v3[1] - sMidY) * size;
          pz[q] = v3[2];
        }
        // the face's own rectangle, with v running down the sheet
        BE.faceUV(f, p.m, r[0], r[1], r[0] + r[2], r[1] + r[3], us, vs);
        var area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
        // ⚠ A FLIP REVERSES WINDING. Mirroring one axis turns every front face into a back face,
        // so the cull has to flip with it or a flipped model renders inside out and hollow.
        if (flip > 0 ? (area <= 0) : (area >= 0)) continue;
        var shade = SH.FACE[f] === undefined ? 1 : SH.FACE[f];
        raster(out, zbuf, size, tex.data, tex.w, shade, tint,
               px[0], py[0], pz[0], us[0], vs[0], px[1], py[1], pz[1], us[1], vs[1],
               px[2], py[2], pz[2], us[2], vs[2]);
        raster(out, zbuf, size, tex.data, tex.w, shade, tint,
               px[0], py[0], pz[0], us[0], vs[0], px[2], py[2], pz[2], us[2], vs[2],
               px[3], py[3], pz[3], us[3], vs[3]);
      }
    }
    return out;
  };

  // ── the transform, the same one the block icons use ───────────────────────────────────────
  /**
   * Rotate about Y by `rotY`, tilt toward the viewer about X by `rotX`, roll about Z by `rotZ`,
   * then look along -Z with screen x = +X and screen up = +Y. Rows are the images of the axes,
   * as in `15d_blockicon.js` — same convention, same derivation, and the same reason the two are
   * written out rather than shared: one is a block model and one is a box list, and the day they
   * diverge a shared helper would quietly serve the wrong one.
   */
  function matrix(rotX, rotY, rotZ, scale) {
    var cx = Math.cos(deg(rotX)), sx = Math.sin(deg(rotX));
    var cy = Math.cos(deg(rotY)), sy = Math.sin(deg(rotY));
    var cz = Math.cos(deg(rotZ)), sz = Math.sin(deg(rotZ));
    var base = [
      cy, -sy * sx, sy * cx,
      0, cx, sx,
      -sy, -cy * sx, cy * cx
    ];
    if (rotZ) {
      // roll happens in SCREEN space, after the other two — a banner's gui transform has no z
      // roll, but `template_skull` and the shield do, and dropping it tips them.
      for (var i = 0; i < 3; i++) {
        var a = base[i * 3], b = base[i * 3 + 1];
        base[i * 3] = a * cz - b * sz;
        base[i * 3 + 1] = a * sz + b * cz;
      }
    }
    for (var k = 0; k < 9; k++) base[k] *= scale;
    return base;
  }
  function apply(m, x, y, z, out) {
    out[0] = x * m[0] + y * m[3] + z * m[6];
    out[1] = x * m[1] + y * m[4] + z * m[7];
    out[2] = x * m[2] + y * m[5] + z * m[8];
    return out;
  }

  // ── the texture, read back once per sheet ─────────────────────────────────────────────────
  var texCache = Object.create(null);
  BE.texData = function (name) {
    if (texCache[name] !== undefined) return texCache[name];
    var g = NS.Gui, sh = g && g.sheets ? g.sheets[name] : null;
    if (!sh || !sh.canvas || !sh.canvas.getContext) { texCache[name] = null; return null; }
    var ctx = sh.canvas.getContext('2d', { willReadFrequently: true });
    var img = ctx.getImageData(0, 0, sh.w, sh.h);
    texCache[name] = { w: sh.w, h: sh.h, data: img.data };
    return texCache[name];
  };
  BE.clearCache = function () { texCache = Object.create(null); };

  /**
   * #891 (KW-49-4c) -- BANNER PATTERN LAYERS. `BannerPattern` constants (.decomp `BannerPattern.java`,
   * `tools/golden/banner-patterns-1.18.2.tsv`): NBT `Pattern` is the short id code, the sheet is
   * `bp_<name>` (`entity/banner/<name>.png`, baked by build-gui). `DyeColor.getId()` order is the NBT
   * `Color`. `Patterns` may name a pattern by name too (older `getOminousBanner` entries do).
   */
  BE.PATTERN_CODES = {
    bl: 'square_bottom_left', br: 'square_bottom_right', tl: 'square_top_left', tr: 'square_top_right',
    bs: 'stripe_bottom', ts: 'stripe_top', ls: 'stripe_left', rs: 'stripe_right', cs: 'stripe_center',
    ms: 'stripe_middle', drs: 'stripe_downright', dls: 'stripe_downleft', ss: 'small_stripes', cr: 'cross',
    sc: 'straight_cross', bt: 'triangle_bottom', tt: 'triangle_top', bts: 'triangles_bottom',
    tts: 'triangles_top', ld: 'diagonal_left', rd: 'diagonal_up_right', lud: 'diagonal_up_left',
    rud: 'diagonal_right', mc: 'circle', mr: 'rhombus', vh: 'half_vertical', hh: 'half_horizontal',
    vhr: 'half_vertical_right', hhb: 'half_horizontal_bottom', bo: 'border', cbo: 'curly_border',
    gra: 'gradient', gru: 'gradient_up', bri: 'bricks', glb: 'globe', cre: 'creeper', sku: 'skull',
    flo: 'flower', moj: 'mojang', pig: 'piglin'
  };
  BE.DYE_IDS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray',
                'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

  /** `{ tex, rgb }` layers for a stack tag's `BlockEntityTag.Patterns` (unknown entries dropped). */
  BE.patternLayers = function (tag, prefix) {
    prefix = prefix || 'bp_';
    var P = tag && tag.BlockEntityTag && tag.BlockEntityTag.Patterns, out = [];
    if (!P) return out;
    for (var i = 0; i < P.length && i < 16; i++) {
      var id = P[i].Pattern, name = BE.PATTERN_CODES[id] || id;
      var dye = BE.DYE_IDS[P[i].Color], rgb = BE.dye ? BE.dye[dye] : undefined;
      if (!name || rgb === undefined || !BE.texData(prefix + name)) continue;
      out.push({ tex: prefix + name, rgb: rgb });
    }
    return out;
  };

  /**
   * #892 (KW-49-4d) -- a SHIELD stack's look (`BannerRenderer.renderShield`): with a `BlockEntityTag`
   * the base is `shield_base` tinted by `Base` (`ShieldItem.getColor`; a missing Base is dye 0) under
   * `entity/shield/<name>` layers; without one it is the plain `shield_base_nopattern`.
   * Returns `{ tex, tint, layers }` or null for the plain shield.
   */
  BE.shieldLook = function (tag) {
    var bet = tag && tag.BlockEntityTag;
    if (!bet || !BE.texData('be_shield_base')) return null;
    var rgb = BE.dye ? BE.dye[BE.DYE_IDS[bet.Base | 0]] : undefined;
    return { tex: 'be_shield_base',
             tint: rgb === undefined ? null : [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255],
             layers: BE.patternLayers(tag, 'sp_') };
  };

  /**
   * The banner sheet with its layers composited on: base x `tint`, then each pattern's texture x its
   * dye, source-over (`BannerBlockEntityRenderer.renderCanvas`'s order). The result is already tinted,
   * so `BE.render` must be handed it as `texData` with no tint.
   */
  BE.composite = function (baseTex, tint, layers) {
    var base = BE.texData(baseTex);
    if (!base) return null;
    var d = new Uint8ClampedArray(base.data), t = tint || [1, 1, 1], n = d.length, i, k;
    for (i = 0; i < n; i += 4) { d[i] *= t[0]; d[i + 1] *= t[1]; d[i + 2] *= t[2]; }
    for (k = 0; k < layers.length; k++) {
      var L = BE.texData(layers[k].tex);
      if (!L || L.w !== base.w || L.h !== base.h) continue;
      var r = ((layers[k].rgb >> 16) & 255) / 255, g = ((layers[k].rgb >> 8) & 255) / 255, b = (layers[k].rgb & 255) / 255;
      for (i = 0; i < n; i += 4) {
        var a = L.data[i + 3] / 255;
        if (!a) continue;
        d[i] = L.data[i] * r * a + d[i] * (1 - a);
        d[i + 1] = L.data[i + 1] * g * a + d[i + 1] * (1 - a);
        d[i + 2] = L.data[i + 2] * b * a + d[i + 2] * (1 - a);
        d[i + 3] = Math.max(d[i + 3], L.data[i + 3]);
      }
    }
    return { w: base.w, h: base.h, data: d };
  };

  /** One textured, depth-tested triangle. Affine UVs — an icon is 64 px and orthographic. */
  function raster(out, zbuf, size, src, texW, shade, tint,
                  ax, ay, az, au, av, bx, by, bz, bu, bv, cx2, cy2, cz2, cu, cv) {
    var minX = Math.max(0, Math.floor(Math.min(ax, bx, cx2)));
    var maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx2)));
    var minY = Math.max(0, Math.floor(Math.min(ay, by, cy2)));
    var maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy2)));
    var d = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
    if (Math.abs(d) < 1e-9) return;
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var pxc = x + 0.5, pyc = y + 0.5;
        var l0 = ((by - cy2) * (pxc - cx2) + (cx2 - bx) * (pyc - cy2)) / d;
        var l1 = ((cy2 - ay) * (pxc - cx2) + (ax - cx2) * (pyc - cy2)) / d;
        var l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        var z = l0 * az + l1 * bz + l2 * cz2;
        var o = y * size + x;
        if (z <= zbuf[o]) continue;
        var u = (l0 * au + l1 * bu + l2 * cu) | 0;
        var v = (l0 * av + l1 * bv + l2 * cv) | 0;
        var si = (v * texW + u) * 4;
        var alpha = src[si + 3];
        if (alpha < 24) continue;
        zbuf[o] = z;
        var oo = o * 4;
        var tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
        out[oo] = src[si] * shade * tr;
        out[oo + 1] = src[si + 1] * shade * tg;
        out[oo + 2] = src[si + 2] * shade * tb;
        out[oo + 3] = 255;
      }
    }
  }

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
