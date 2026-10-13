// 15d_blockicon.js — PLAN G10b: A BLOCK AS AN ITEM IS A 3D MODEL, NOT A TILE.
// Runs on: MAIN THREAD ONLY. Uses a 2D canvas; no GL.
//
// ⚠⚠ **WHY THIS FILE EXISTS.** Dan, 14 Sept 2026: *"there is no hand model, the item in block
// model is not even close, and many blocks have wrong textures in hotbar and in world."*
// `tools/texaudit.mjs` then compared 789 of the 900 blocks against a fresh reading of the jar and
// found **no wrong textures in the world at all**. The world was right; the ITEM was not, and
// all three complaints are one missing thing (D-311).
//
// In vanilla, a block in the inventory is its MODEL, rendered in three dimensions through the
// `gui` display transform — `"rotation": [30, 225, 0], "scale": [0.625, 0.625, 0.625]` on
// `block/block` — and the same model through `firstperson_righthand` when it is in your hand.
// MC-Lite drew **one flat atlas tile**, chosen by `States.iconTile` as *"the first quad of the
// first part"*, which is an arbitrary internal face. What that produced:
//
//     grass_block -> block/dirt          lever    -> block/cobblestone
//     cake        -> block/cake_bottom   bell     -> block/dark_oak_planks
//     composter   -> block/composter_bottom        cauldron -> block/cauldron_inner
//     chest       -> nothing at all
//
// **The grass block showed as dirt**, which is the most-placed block in the game.
//
// ⚠ IT IS A SOFTWARE RASTERISER AND THAT IS DELIBERATE. The alternative is a second GL pass with
// its own render target, readback and device-loss path — in a project whose renderer has just
// been found to die on real hardware (D-310), a picture the GUI can draw without touching the GPU
// at all is worth more than the speed. It runs ONCE, over ~900 blocks, at boot, into one sheet.
//
// ⚠ AND IT DRAWS FROM THE SAME BAKED QUADS THE WORLD USES — `Reg.qPos`, `Reg.qUv`, `Reg.qTile` —
// so an icon can never disagree with the block it depicts. A second geometry source for icons is
// how you get a hotbar that is subtly not the game.

(function (NS) {
  'use strict';

  var BI = NS.BlockIcon = { ready: false };

  /**
   * Vanilla's `gui` display transform for `block/block`, verbatim.
   * ⚠ THE ORDER IS Y THEN X, and the Y angle is 225 rather than 45 — the two together are what
   * put the block's south-east corner toward the viewer with its top face showing. Swapping them
   * gives a block seen from a plausible-looking wrong corner, which is the kind of wrongness
   * nobody reports and everybody feels.
   */
  BI.GUI_ROT_X = 30;
  BI.GUI_ROT_Y = 225;
  BI.GUI_SCALE = 0.625;

  /** `firstperson_righthand` for `block/block`: rotation [0, 45, 0], scale 0.40. */
  BI.HAND_ROT_X = 0;
  BI.HAND_ROT_Y = 45;
  BI.HAND_SCALE = 0.40;

  /**
   * ⚠ THE ICON SHEET IS RENDERED AT 4x THE ATLAS TILE and drawn down. A 16x16 icon of a
   * three-dimensional block loses the top face to rounding — vanilla renders its GUI items into
   * a framebuffer far larger than 16px for exactly this reason. 64 is enough that the diagonal
   * edges read as edges and small enough that 900 of them are 14 MB of canvas, transient.
   */
  BI.SS = 4;

  function deg(d) { return d * Math.PI / 180; }

  /**
   * The 3x3 the transform comes to. Each ROW is the image of one model axis, as
   * `[screen x, screen up, depth toward the viewer]`, and `apply` reads it as a row-vector
   * multiply — so row 0 is where +X (east) ends up on screen, row 1 +Y (up), row 2 +Z (south).
   *
   * ⚠⚠ **THE FIRST VERSION OF THIS FUNCTION WAS Rx·Ry AND ITS OWN COMMENT SAID Ry·Rx.** The
   * arithmetic and the sentence above it disagreed, and at vanilla's own 225 degrees the product
   * is DEGENERATE: it sends +X and +Z to the SAME screen x (both cos225 and sin225 are -0.707),
   * so the two side faces collapse onto one another and the top face slides off to the left. The
   * icon still looked like a solid shaded lump of the right block — which is why nothing noticed.
   *
   * ⚠ **AND 225 IS NOT 45.** Both give a symmetric hexagon, and they show DIFFERENT FACES: 45
   * shows top, east and south; 225 shows top, NORTH and WEST. Vanilla's icons show the north
   * face — it is why a furnace's front opening and a carved pumpkin's face are both visible in
   * the inventory — so a "fix" that flipped the sign to make the picture symmetric would have
   * produced a plausible hexagon of the wrong three faces, with the furnace showing its back.
   * `iconcheck` asserts the furnace's FRONT tile is drawn and is on the left.
   *
   * The derivation, once, so the next person does not have to redo it: rotate the model about
   * Y by `rotY`, tilt it toward the viewer about X by `rotX`, then look along -Z with screen x
   * = +X and screen up = +Y.
   */
  function matrix(rotX, rotY, scale) {
    var cx = Math.cos(deg(rotX)), sx = Math.sin(deg(rotX));
    var cy = Math.cos(deg(rotY)), sy = Math.sin(deg(rotY));
    return [
      cy * scale,      -sy * sx * scale,   sy * cx * scale,
      0,                cx * scale,        sx * scale,
      -sy * scale,     -cy * sx * scale,   cy * cx * scale
    ];
  }

  function apply(m, x, y, z, out) {
    out[0] = x * m[0] + y * m[3] + z * m[6];
    out[1] = x * m[1] + y * m[4] + z * m[7];
    out[2] = x * m[2] + y * m[5] + z * m[8];
    return out;
  }

  /**
   * The quads of a state, as [{tile, tint, face, p:[12], uv:[8]}]. One source: the baked
   * geometry the mesher reads, so the icon is the block.
   */
  BI.quadsOf = function (state) {
    var R = NS.Reg, SR = NS.States;
    var out = [];
    if (!R || !R.ready || !SR || !SR.ready || state <= 0) return out;
    var v = SR.vis[state];
    if (!R.groupCount || !R.groupCount(v)) return out;
    var part = R.partFor(v, 0, 0, 0, 0);
    // ⚠ `face` IS CONVERTED TO ARCH §3 ORDER HERE (D-314). The baked `dir` is vanilla's
    // `Direction` order — down, up, north, south, west, east — and `Gfx.SHADE.FACE` is indexed
    // by ARCH's +X, -X, +Y, -Y, +Z, -Z. Handing the raw number to the shade table gives an icon
    // whose TOP is lit like a side wall and whose north face is lit like the sky, which is the
    // same bug the mesher had next door.
    var MAP = (NS.Mesher && NS.Mesher.MESH_OF_DIR) || [3, 2, 5, 4, 1, 0];
    for (var q = R.partOff[part]; q < R.partOff[part + 1]; q++) {
      var fl = R.qFlags[q];
      out.push({ tile: R.qTile[q], face: MAP[fl & 7], tint: (fl >>> 7) & 7, q: q });
    }
    return out;
  };

  /**
   * #4982 -- an ITEM's picture: its own model quads (`Items.mPos` ...), its own `gui` display
   * transform (a stair is [30,135,0], a fence gate [30,45,0] and lower, a big dripleaf lower
   * still) and its ItemColors tint on the quads that carry `tintindex` 0. Returns the RGBA
   * buffer, or null when the item has no model of its own (the caller falls back to the block).
   */
  BI.itemModel = function (itemIdx) {
    var IT = NS.Items;
    if (!IT || !IT.ready || !IT.modelPartOf) return null;
    var part = IT.modelPartOf(itemIdx);
    if (part < 0) return null;
    var MAP = (NS.Mesher && NS.Mesher.MESH_OF_DIR) || [3, 2, 5, 4, 1, 0];
    var quads = [];
    for (var q = IT.mPartOff[part]; q < IT.mPartOff[part + 1]; q++) {
      var fl = IT.mFlags[q];
      quads.push({ tile: IT.mTile[q], face: MAP[fl & 7], tint: (fl >>> 7) & 7, q: q });
    }
    var g = IT.guiTransform(itemIdx) || [BI.GUI_ROT_X, BI.GUI_ROT_Y, 0, 0, 0, 0, BI.GUI_SCALE, BI.GUI_SCALE, BI.GUI_SCALE];
    var col = IT.tint0 ? IT.tint0[itemIdx] : -1;
    return {
      quads: quads, pos: IT.mPos, uv: IT.mUv,
      rotX: g[0], rotY: g[1], scale: g[6], tx: g[3], ty: g[4],
      rgb: col >= 0 ? [((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255] : null
    };
  };
  BI.renderItem = function (itemIdx, size) {
    var M = BI.itemModel(itemIdx);
    return M ? BI.renderState(0, size, M) : null;
  };

  var v0 = [0, 0, 0], v1 = [0, 0, 0], v2 = [0, 0, 0], v3 = [0, 0, 0];

  /**
   * Render one state's model into an RGBA buffer of `size` x `size`.
   *
   * ⚠ A Z-BUFFER, NOT A PAINTER'S SORT. A stair, a fence post and a cauldron all have quads that
   * interpenetrate in screen space from this angle; sorting by centroid picks a wrong order for
   * exactly the shapes whose icons are hardest to read. Per-pixel depth is twenty more lines and
   * always right.
   *
   * ⚠ BACK FACES ARE CULLED BY WINDING, not by the quad's face id. A model element rotated 45
   * degrees has a face id that no longer says which way it points — that is how a cross-shaped
   * plant ends up drawn from behind and looking hollow.
   */
  BI.renderState = function (state, size, M) {
    var R = NS.Reg, SR = NS.States, A = NS.Atlas, G = NS.Gfx;
    var out = new Uint8ClampedArray(size * size * 4);
    if (!A || !A.mips || !A.mips[0]) return out;
    // #4982: `M` renders an ITEM's own model instead (BI.renderItem): its quad arrays, its `gui`
    // transform and its ItemColors tint. Without it this is the block state's picture as ever.
    var quads = M ? M.quads : BI.quadsOf(state);
    if (!quads.length) return out;
    var POS = M ? M.pos : R.qPos, UV = M ? M.uv : R.qUv;
    var tx0 = M ? M.tx : 0, ty0 = M ? M.ty : 0;

    var m = M ? matrix(M.rotX, M.rotY, M.scale) : matrix(BI.GUI_ROT_X, BI.GUI_ROT_Y, BI.GUI_SCALE);
    var zbuf = new Float32Array(size * size);
    for (var i = 0; i < zbuf.length; i++) zbuf[i] = -1e9;

    var SH = G && G.SHADE ? G.SHADE : { FACE: [0.6, 0.6, 1, 0.5, 0.8, 0.8], TINT: [[1, 1, 1]] };
    var T = A.TILE, src = A.mips[0].data;
    var px = [0, 0, 0, 0], py = [0, 0, 0, 0], pz = [0, 0, 0, 0];
    var us = [0, 0, 0, 0], vs = [0, 0, 0, 0];
    var half = size * 0.5;
    // the model is 16 units; scaled by GUI_SCALE it spans 10, and the icon is drawn to fill
    var unit = size / 16;

    for (var k = 0; k < quads.length; k++) {
      var Q = quads[k], qi = Q.q;
      var layer = Q.tile;
      var tintIdx = Q.tint & 3;
      var tint = SH.TINT[tintIdx] || SH.TINT[0];
      if (M) tint = Q.tint === 1 && M.rgb ? M.rgb : [1, 1, 1];   // the item's quad tint is `tintindex + 1`
      var shade = SH.FACE[Q.face] !== undefined ? SH.FACE[Q.face] : 1;

      // ⚠ THE CORNERS ARE READ IN REVERSE, exactly as `Mesher.emitModelBlock` does, and for the
      // same reason (D-133): the bakery keeps Mojang's own corner order, which is the opposite
      // winding from the one the renderer culls by. Reading them forwards here made the winding
      // test below keep the BACK faces — so the icon drew a furnace's bottom and its two far
      // sides, and looked like a perfectly good furnace with its front hidden.
      for (var c = 0; c < 4; c++) {
        var rc = 3 - c;
        // qPos is in 1/16 of a model unit, centred on the block's own 0..16 box
        var x = POS[qi * 12 + rc * 3] / 16 - 8;
        var y = POS[qi * 12 + rc * 3 + 1] / 16 - 8;
        var z = POS[qi * 12 + rc * 3 + 2] / 16 - 8;
        apply(m, x, y, z, v0);
        px[c] = half + (v0[0] + tx0) * unit;
        py[c] = half - (v0[1] + ty0) * unit;      // screen y grows downward
        pz[c] = v0[2];
        us[c] = UV[qi * 8 + rc * 2] / 16;
        vs[c] = UV[qi * 8 + rc * 2 + 1] / 16;
      }
      // winding in screen space: positive area faces the viewer
      var area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
      if (area >= 0) continue;

      rasterTri(out, zbuf, size, src, T, layer, shade, tint,
                px[0], py[0], pz[0], us[0], vs[0], px[1], py[1], pz[1], us[1], vs[1],
                px[2], py[2], pz[2], us[2], vs[2]);
      rasterTri(out, zbuf, size, src, T, layer, shade, tint,
                px[0], py[0], pz[0], us[0], vs[0], px[2], py[2], pz[2], us[2], vs[2],
                px[3], py[3], pz[3], us[3], vs[3]);
    }
    return out;
  };

  /** One textured, depth-tested triangle. Affine UVs: an icon is 64px and orthographic. */
  function rasterTri(out, zbuf, size, src, T, layer, shade, tint,
                     ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv) {
    var minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    var maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    var minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    var maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    var d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) return;
    var base = layer * T * T * 4;
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var sx = x + 0.5, sy = y + 0.5;
        var w0 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / d;
        var w1 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / d;
        var w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        var z = w0 * az + w1 * bz + w2 * cz;
        var o = y * size + x;
        if (z <= zbuf[o]) continue;
        var u = w0 * au + w1 * bu + w2 * cu;
        var v = w0 * av + w1 * bv + w2 * cv;
        var tx = u | 0, ty = v | 0;
        if (tx < 0) tx = 0; else if (tx >= T) tx = T - 1;
        if (ty < 0) ty = 0; else if (ty >= T) ty = T - 1;
        var si = base + (ty * T + tx) * 4;
        var a = src[si + 3];
        if (a < 24) continue;                       // a cutout hole stays a hole
        zbuf[o] = z;
        var oi = o * 4;
        out[oi]     = src[si]     * shade * tint[0];
        out[oi + 1] = src[si + 1] * shade * tint[1];
        out[oi + 2] = src[si + 2] * shade * tint[2];
        out[oi + 3] = 255;
      }
    }
  }

  // == the first-person hand ===============================================================
  //
  // WHY THERE IS A HAND AT ALL. `Hud.drawHand` drew the flat hotbar icon in the corner of the
  // screen with a swing curve on it, and nothing else - no arm, and the held block was a
  // picture of one face. Vanilla draws the player's RIGHT ARM as a 3D box from the skin, and
  // the held item as its model through `firstperson_righthand` (D-311).
  //
  // **THIS BOX LIVES IN MOJANG'S MODEL SPACE, WHERE +Y RUNS FROM THE SHOULDER TO THE HAND.**
  // Dan, 14 Sept 2026: *"the hand I can see is reversed: the sleeve is where the arm should be
  // and vice versa."* He was right, and it was not a mirrored texture. The UV table below is
  // `PlayerModel`'s own - `texOffs(40, 16).addBox(-3, -2, -2, 4, 12, 4)` - and Mojang writes
  // that table in a space whose +Y points DOWN, because the humanoid model is built upside
  // down and turned over at render time. The old code read the very same table in a +Y-UP
  // space. Two consequences, and both of them are what Dan saw: the shoulder cap `(u+d, v)`
  // was pinned to the BOTTOM of the box, and the side faces ran their texture from hand to
  // shoulder instead of shoulder to hand. The sleeve came out at the top of the screen, where
  // the fist belongs (D-320).
  //
  // THE RIGHTING IS VANILLA'S OWN, NOT A MINUS SIGN. `ItemInHandRenderer.renderPlayerArm` for
  // the right hand, read out of the 1.18.2 jar (class `eqo`, `a(dtm, eqs, int, float, float,
  // axt)`) rather than remembered:
  //     translate(0.64, -0.6, -0.72);   rotateY(45);
  //     rotateY(f6 *  70);              rotateZ(f5 * -20);      // the swing
  //     translate(-1, 3.6, 3.5);
  //     rotateZ(120);  rotateX(200);  rotateY(-135);            // <-- the 200 is the turn-over
  //     translate(5.6, 0, 0);
  // `rotateX(200)` is what stands in for the entity renderer's `scale(-1, -1, 1)`. Drop it and
  // the arm is upside down; round it to 180 and the arm is upside down by twenty degrees, which
  // reads as bad art rather than as a bug. The translations are vanilla's way of putting the
  // arm in the corner of the screen; `Hud.drawHand` does that part, so only the ROTATION is
  // ported here - and it is ported as the four numbers, not as an angle that looked right.
  BI.ARM = {
    // PlayerModel: rightArm = texOffs(40, 16).addBox(-3, -2, -2, 4, 12, 4)
    x0: -3, y0: -2, z0: -2, w: 4, h: 12, d: 4, u: 40, v: 16,
    // rightSleeve = texOffs(40, 32).addBox(-3, -2, -2, 4, 12, 4, new CubeDeformation(0.25))
    sleeveU: 40, sleeveV: 32, sleeveInflate: 0.25
  };

  /** `renderPlayerArm`'s rotation, in the order it is applied. Pinned by `iconcheck` S8. */
  BI.ARM_ROT = { yOuter: 45, swingY: 70, swingZ: -20, z: 120, x: 200, y: -135 };

  /**
   * The six faces of a Mojang box, as [corner indices] + [u, v] per corner.
   *
   * THIS IS `ModelPart.Cube`'s CONSTRUCTOR, TRANSCRIBED. Every face's vertex order and every
   * corner's texel is the jar's, because a box unwrap is exactly the kind of thing that can be
   * rebuilt from intuition, look plausible, and be mirrored. The corners are numbered
   *     0 (x0,y0,z0)  1 (x1,y0,z0)  2 (x1,y1,z0)  3 (x0,y1,z0)
   *     4 (x0,y0,z1)  5 (x1,y0,z1)  6 (x1,y1,z1)  7 (x0,y1,z1)
   * and `Polygon` hands its four vertices the texels (maxU,minV) (minU,minV) (minU,maxV)
   * (maxU,maxV) in that order - note that `UP` passes its V arguments the other way round, so
   * the cap is flipped, and that is Mojang's, not a slip.
   */
  BI.boxFaces = function (u, v, w, h, d) {
    var u0 = u, u1 = u + d, u2 = u + d + w, u3 = u + d + w + d, u4 = u3 + w;
    var v0 = v, v1 = v + d, v2 = v + d + h;
    var f = function (c, aU, aV, bU, bV) {
      return { c: c, uv: [bU, aV, aU, aV, aU, bV, bU, bV] };
    };
    return [
      f([5, 4, 0, 1], u1, v0, u2, v1),   // the y0 cap - the SHOULDER. Mojang calls it DOWN.
      f([2, 3, 7, 6], u2, v1, u3, v0),   // the y1 cap - the HAND.     Mojang calls it UP.
      f([0, 4, 7, 3], u0, v1, u1, v2),   // x0
      f([1, 0, 3, 2], u1, v1, u2, v2),   // z0 - the front
      f([5, 1, 2, 6], u2, v1, u3, v2),   // x1
      f([4, 5, 6, 7], u3, v1, u4, v2)    // z1 - the back
    ];
  };

  function mul3(a, b) {
    var o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    return o;
  }
  function rotX3(a) { var c = Math.cos(deg(a)), s = Math.sin(deg(a)); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY3(a) { var c = Math.cos(deg(a)), s = Math.sin(deg(a)); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotZ3(a) { var c = Math.cos(deg(a)), s = Math.sin(deg(a)); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function xform(m, x, y, z, out) {
    out[0] = m[0] * x + m[1] * y + m[2] * z;
    out[1] = m[3] * x + m[4] * y + m[5] * z;
    out[2] = m[6] * x + m[7] * y + m[8] * z;
    return out;
  }

  /**
   * `renderPlayerArm`, TRANSFORM AND ALL, as a rotation + a translation that take a point of
   * Mojang's arm-model space (pixels) to VIEW space (+X right, +Y up, -Z forward, camera at the
   * origin).
   *
   * THE TRANSLATIONS ARE NOT DECORATION AND LEAVING THEM OUT IS HOW THE ARM CAME OUT LEANING
   * THE WRONG WAY. In three dimensions vanilla's right arm points up, away, and slightly to the
   * RIGHT - and on screen it leans up and to the LEFT, because it sits right of centre and
   * recedes, so perspective walks its far end back toward the vanishing point. An orthographic
   * rasteriser centred on the arm cannot produce that, and the old code papered over the
   * difference with a hand-picked `ctx.rotate(-0.55)` in the HUD. That fudge is what let an
   * UPSIDE-DOWN arm look plausible for a whole session: with a free rotation in the drawing
   * layer, almost any orientation can be talked into the corner of the screen (D-320).
   *
   * So the whole chain is here, in vanilla's order, and the projection below is vanilla's too.
   * Nothing downstream is allowed to rotate the result.
   */
  BI.armPose = function (swing, equipped) {
    var R = BI.ARM_ROT, s = Math.max(0, Math.min(1, swing || 0)), e = equipped || 0;
    var f1 = Math.sqrt(s);
    var f2 = -0.3 * Math.sin(f1 * Math.PI);
    var f3 = 0.4 * Math.sin(f1 * Math.PI * 2);
    var f4 = -0.4 * Math.sin(s * Math.PI);
    var f5 = Math.sin(s * s * Math.PI);
    var f6 = Math.sin(f1 * Math.PI);

    var T = [f2 + 0.64000005, f3 - 0.6 + e * -0.6, f4 - 0.71999997];
    var m = rotY3(R.yOuter);
    m = mul3(m, rotY3(R.swingY * f6));
    m = mul3(m, rotZ3(R.swingZ * f5));
    var t = [0, 0, 0];
    xform(m, -1.0, 3.6, 3.5, t); T[0] += t[0]; T[1] += t[1]; T[2] += t[2];
    m = mul3(m, rotZ3(R.z));
    m = mul3(m, rotX3(R.x));
    m = mul3(m, rotY3(R.y));
    xform(m, 5.6, 0, 0, t); T[0] += t[0]; T[1] += t[1]; T[2] += t[2];
    // ModelPart rightArm.setPos(-5, 2, 0); the part's own rotations are zeroed by `renderHand`.
    xform(m, -5 / 16, 2 / 16, 0, t); T[0] += t[0]; T[1] += t[1]; T[2] += t[2];
    return { r: m, t: T };
  };

  /**
   * SHADE FOLLOWS THE ROTATED NORMAL, NOT THE FACE'S NAME. D-314's lesson wearing a different
   * hat: after a 200-degree turn-over the box's model-space "up" face points at the floor, and a
   * shade table indexed by the model-space name lights the underside of the arm like the sky.
   * The normal is carried through the same rotation as the geometry, so the brightest face is
   * whichever one actually ends up pointing up - at every swing angle, for free.
   */
  var SHADE_AXIS = [0.6, 0.6, 0.5, 1.0, 0.8, 0.8];   // -X +X -Y +Y -Z +Z
  var ARM_NRM = [[0, -1, 0], [0, 1, 0], [-1, 0, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1]];

  /**
   * The largest sprite the arm is ever allowed to cost, in pixels a side.
   *
   * ⚠ THE REAL BOUND IS THE VIEWPORT — the projected box is clipped to it before this applies —
   * and at 1080p the arm is about 670 x 380, so a 512 cap would have CROPPED THE FIST off at
   * every resolution above 720p while looking perfect in the checks, which run at 854 x 480.
   * This is a safety net for a pathological FOV, not a size. At 4K the arm wants 1217 px across,
   * so 1024 cropped the fist there too; the net is set where nothing real reaches it.
   */
  BI.ARM_MAX = 2048;

  /** How many times the arm has actually been rasterised, since the page loaded. */
  BI.armRasters = 0;

  /**
   * The player's right arm, rendered where vanilla puts it.
   *
   * Returns `{ data, w, h, x, y }` - an RGBA buffer and the top-left corner it belongs at, in
   * the same pixel space as the viewport it was given - or `null` when the arm is entirely off
   * screen. THE CALLER DOES NOT GET TO CHOOSE THE PLACE. Position, size and angle are all the
   * projection's, which is the only way the picture can be checked against the jar rather than
   * against somebody's eye.
   */
  BI.armSprite = function (skinData, skinW, viewW, viewH, fov, swing, equipped) {
    BI.armRasters = (BI.armRasters | 0) + 1;   // D-328: the number a cache regression moves
    if (!skinData || !(viewW > 0) || !(viewH > 0)) return null;
    var A = BI.ARM, pose = BI.armPose(swing, equipped);
    var inf = A.sleeveInflate;
    var f = 1 / Math.tan((fov || 70) * Math.PI / 360);
    var aspect = viewW / viewH;
    var t = [0, 0, 0];

    // project a model-space point to viewport pixels; z comes back as 1/(-view z)
    var proj = function (x, y, z, o) {
      xform(pose.r, x, y, z, t);
      var vx = t[0] + pose.t[0], vy = t[1] + pose.t[1], vz = t[2] + pose.t[2];
      if (vz > -0.01) return false;                 // behind or on the camera plane
      var iw = -1 / vz;
      o[0] = (f / aspect * vx * iw * 0.5 + 0.5) * viewW;
      o[1] = (0.5 - f * vy * iw * 0.5) * viewH;
      o[2] = iw;
      return true;
    };

    // ⚠ A PORTRAIT VIEWPORT LEGITIMATELY HAS NO HAND IN IT. The FOV is VERTICAL — vanilla's
    // `getProjectionMatrix` puts `f / aspect` in [0][0] and `f` in [1][1] — so a tall narrow
    // window narrows the HORIZONTAL field until the arm, which sits well right of centre, is
    // outside it. Returning `null` is the honest answer; clamping the sprite back on screen
    // would invent a hand vanilla does not draw.
    var p = [0, 0, 0];
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, ok = true;
    var X0 = (A.x0 - inf) / 16, X1 = (A.x0 + A.w + inf) / 16;
    var Y0 = (A.y0 - inf) / 16, Y1 = (A.y0 + A.h + inf) / 16;
    var Z0 = (A.z0 - inf) / 16, Z1 = (A.z0 + A.d + inf) / 16;
    for (var i = 0; i < 8; i++) {
      if (!proj(i & 1 ? X1 : X0, i & 2 ? Y1 : Y0, i & 4 ? Z1 : Z0, p)) { ok = false; break; }
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    if (!ok) return null;

    // THE SHOULDER PROJECTS WELL BELOW THE SCREEN and that is correct - vanilla's arm comes in
    // from off the bottom edge. Only the visible part is rasterised, or an arm that is mostly
    // off screen would cost a buffer several times the size of the one on it.
    var x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
    var x1 = Math.min(viewW, Math.ceil(maxX)), y1 = Math.min(viewH, Math.ceil(maxY));
    var bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return null;
    if (bw > BI.ARM_MAX) { bw = BI.ARM_MAX; x1 = x0 + bw; }
    if (bh > BI.ARM_MAX) { bh = BI.ARM_MAX; y1 = y0 + bh; }

    var out = new Uint8ClampedArray(bw * bh * 4);
    var zbuf = new Float32Array(bw * bh);
    for (i = 0; i < zbuf.length; i++) zbuf[i] = -1e9;

    // the bare arm, then the sleeve over it. The overlay is inflated, so the depth buffer puts
    // it in front wherever the skin has one: Steve's is empty, Alex's and every custom skin's
    // are not, and vanilla's `renderHand` draws both.
    drawArmBox(out, zbuf, bw, bh, x0, y0, skinData, skinW, proj, pose.r, A.u, A.v, 0);
    drawArmBox(out, zbuf, bw, bh, x0, y0, skinData, skinW, proj, pose.r, A.sleeveU, A.sleeveV, inf);
    return { data: out, w: bw, h: bh, x: x0, y: y0 };
  };

  function drawArmBox(out, zbuf, bw, bh, ox, oy, src, srcW, proj, rot, u, v, inf) {
    var A = BI.ARM;
    var X0 = (A.x0 - inf) / 16, X1 = (A.x0 + A.w + inf) / 16;
    var Y0 = (A.y0 - inf) / 16, Y1 = (A.y0 + A.h + inf) / 16;
    var Z0 = (A.z0 - inf) / 16, Z1 = (A.z0 + A.d + inf) / 16;
    var C = [
      [X0, Y0, Z0], [X1, Y0, Z0], [X1, Y1, Z0], [X0, Y1, Z0],
      [X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1]
    ];
    var S = [];
    for (var i = 0; i < 8; i++) {
      var q = [0, 0, 0];
      if (!proj(C[i][0], C[i][1], C[i][2], q)) return;
      S.push([q[0] - ox, q[1] - oy, q[2]]);
    }
    var faces = BI.boxFaces(u, v, A.w, A.h, A.d);
    var n = [0, 0, 0], vtx = [null, null, null, null];
    for (var fi = 0; fi < 6; fi++) {
      var face = faces[fi], c;
      for (c = 0; c < 4; c++) {
        var s = S[face.c[c]];
        vtx[c] = [s[0], s[1], s[2], face.uv[c * 2], face.uv[c * 2 + 1]];
      }
      var area = (vtx[1][0] - vtx[0][0]) * (vtx[2][1] - vtx[0][1])
               - (vtx[2][0] - vtx[0][0]) * (vtx[1][1] - vtx[0][1]);
      if (area >= 0) continue;                   // screen y is down, so a front face is negative
      // the normal rides the same rotation the corners did
      xform(rot, ARM_NRM[fi][0], ARM_NRM[fi][1], ARM_NRM[fi][2], n);
      var ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      var idx = ay >= ax && ay >= az ? (n[1] >= 0 ? 3 : 2)
              : ax >= az ? (n[0] >= 0 ? 1 : 0) : (n[2] >= 0 ? 5 : 4);
      var shade = SHADE_AXIS[idx];
      tri(out, zbuf, bw, bh, src, srcW, shade, vtx[0], vtx[1], vtx[2]);
      tri(out, zbuf, bw, bh, src, srcW, shade, vtx[0], vtx[2], vtx[3]);
    }
  }

  /**
   * One textured triangle of the skin, PERSPECTIVE-CORRECT.
   *
   * THE ARM IS THE ONE THING IN THIS FILE THAT NEEDS THE DIVIDE. Its near end is about half the
   * distance of its far end, and texture coordinates interpolated straight across the screen
   * over a 2:1 depth range slide by several texels - enough to bend the cuff and put a seam
   * through the knuckles. `u/w`, `v/w` and `1/w` interpolate linearly; `u` and `v` do not.
   */
  function tri(out, zbuf, bw, bh, src, srcW, shade, a, b, c) {
    var minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    var maxX = Math.min(bw - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    var minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    var maxY = Math.min(bh - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    var d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-9) return;
    var aw = a[2], bw2 = b[2], cw = c[2];
    var au = a[3] * aw, av = a[4] * aw;
    var bu = b[3] * bw2, bv = b[4] * bw2;
    var cu = c[3] * cw, cv = c[4] * cw;
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var sx = x + 0.5, sy = y + 0.5;
        var w0 = ((b[1] - c[1]) * (sx - c[0]) + (c[0] - b[0]) * (sy - c[1])) / d;
        var w1 = ((c[1] - a[1]) * (sx - c[0]) + (a[0] - c[0]) * (sy - c[1])) / d;
        var w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        var iw = w0 * aw + w1 * bw2 + w2 * cw;
        if (iw <= 0) continue;
        var o = y * bw + x;
        if (iw <= zbuf[o]) continue;
        var u = ((w0 * au + w1 * bu + w2 * cu) / iw) | 0;
        var v = ((w0 * av + w1 * bv + w2 * cv) / iw) | 0;
        var si = (v * srcW + u) * 4;
        if (si < 0 || si + 3 >= src.length) continue;
        if (src[si + 3] < 24) continue;
        zbuf[o] = iw;
        var oi = o * 4;
        out[oi]     = src[si]     * shade;
        out[oi + 1] = src[si + 1] * shade;
        out[oi + 2] = src[si + 2] * shade;
        out[oi + 3] = 255;
      }
    }
  }

  /**
   * The held block, rendered through `firstperson_righthand` rather than `gui`.
   * ⚠ A DIFFERENT TRANSFORM, NOT A BIGGER ICON. The hand sees the block from 45 degrees with no
   * X tilt; the inventory sees it from 30/225. Drawing the inventory picture larger is what
   * "not even close" looked like.
   */
  BI.renderHeld = function (state, size) {
    var save = [BI.GUI_ROT_X, BI.GUI_ROT_Y, BI.GUI_SCALE];
    BI.GUI_ROT_X = BI.HAND_ROT_X; BI.GUI_ROT_Y = BI.HAND_ROT_Y; BI.GUI_SCALE = 0.9;
    var buf = BI.renderState(state, size);
    BI.GUI_ROT_X = save[0]; BI.GUI_ROT_Y = save[1]; BI.GUI_SCALE = save[2];
    return buf;
  };

  /**
   * One block's icon, rasterised AT THE SIZE IT WILL BE DRAWN, on its own canvas.
   *
   * ⚠⚠ **THIS EXISTS BECAUSE THE SHEET IS 16 PIXELS A TILE AND THE SCREEN IS NOT.** Dan, session
   * 11: *"most hotbar/inventory icons are incredibly pixelated, some like campfires arent for
   * some reason"*. The reason is that a campfire has no block model, so it falls through to
   * `Hud.beCanvas`, which renders **at the requested size**; everything with a model came off
   * `Hud.icons`, a sheet of 16x16 tiles blown up to 16 x guiScale with smoothing off. At Dan's
   * scale that is a 16-pixel picture magnified three or four times — every silhouette edge a
   * staircase — while the block entity beside it is drawn at full resolution.
   *
   * ⚠ **VANILLA HAS NO ICON SHEET AT ALL.** `ItemRenderer.renderGuiItem` draws the real model
   * through the real pipeline into the real framebuffer, so a block icon's edges are as sharp as
   * the display is. A 16x16 SPRITE item magnified with nearest-neighbour is a different thing and
   * is faithful — vanilla's item sprites are 16x16 textures and they are meant to be chunky. The
   * bug was never "icons are pixel art"; it was **one of the two producers of the same picture
   * being resolution-aware and the other not** (D-314's rule, a third time).
   *
   * ⚠ **THE SUPERSAMPLE IS A FACTOR OF THE TARGET, NOT A CONSTANT.** `BI.SS` is 4 against a
   * 16-pixel tile because 16 pixels need it; at 64 they do not, and rendering 900 blocks at 256
   * to throw away three quarters of it would cost sixteen times what the sheet costs today.
   * `BI.superFor` keeps the rasterised size at twice the target with a floor at the sheet's own
   * 64, so **the 16-pixel case is bit-for-bit what it was** and the big ones cost 4x, not 16x.
   */
  BI.superFor = function (size) {
    var big = size * 2;
    var floor = 16 * BI.SS;
    return big < floor ? floor : big;
  };

  /**
   * `BI.stateCanvas(state, size)` — that icon, that many pixels across, or null if the block has
   * no model to render (the caller falls back to the flat tile or the block-entity path).
   * ⚠ IT IS NOT CACHED HERE. The caller owns the cache because the caller knows when the GUI
   * scale changed; a cache in this file would hold every size the window has ever been.
   */
  BI.stateCanvas = function (state, size) {
    var R = NS.Reg, SR = NS.States, A = NS.Atlas;
    if (!R || !R.ready || !SR || !SR.ready || !A || !A.mips) return null;
    if (typeof document === 'undefined') return null;
    var T = Math.max(1, Math.round(size));
    var big = BI.superFor(T);
    var buf = BI.renderState(state, big);
    var any = false;
    for (var p = 3; p < buf.length; p += 4) if (buf[p]) { any = true; break; }
    if (!any) return null;
    var tmp = document.createElement('canvas');
    tmp.width = big; tmp.height = big;
    var tg = tmp.getContext('2d', { alpha: true });
    var img = tg.createImageData(big, big);
    img.data.set(buf);
    tg.putImageData(img, 0, 0);
    if (big === T) return tmp;
    var out = document.createElement('canvas');
    out.width = T; out.height = T;
    var og = out.getContext('2d', { alpha: true });
    og.imageSmoothingEnabled = true;                 // the downsample IS the antialiasing
    og.drawImage(tmp, 0, 0, big, big, 0, 0, T, T);
    return out;
  };

  /**
   * Build the whole icon sheet: one 3D-rendered icon per BLOCK.
   *
   * ⚠ A BLOCK WITH NO MODEL FALLS BACK TO ITS FLAT TILE RATHER THAN TO NOTHING. Chests, signs and
   * banners are block entities whose shape lives in code, not in a model, and an empty icon is a
   * worse answer than a flat one. `BI.flat` records which blocks took that path so the count is
   * visible and `iconcheck` can hold it closed.
   */
  BI.flat = null;
  BI.build = function () {
    var R = NS.Reg, SR = NS.States, A = NS.Atlas;
    if (!R || !R.ready || !SR || !SR.ready || !A || !A.mips) return null;
    if (typeof document === 'undefined') return null;
    var n = R.blockCount, cols = NS.Hud.iconCols, T = NS.Hud.iconSize;
    var SS = BI.SS, big = T * SS;
    var rows = Math.ceil(n / cols);
    var sheet = document.createElement('canvas');
    sheet.width = cols * T; sheet.height = rows * T;
    var g = sheet.getContext('2d', { alpha: true });
    g.imageSmoothingEnabled = true;

    var tmp = document.createElement('canvas');
    tmp.width = big; tmp.height = big;
    var tg = tmp.getContext('2d', { alpha: true });
    var img = tg.createImageData(big, big);

    BI.flat = [];
    for (var id = 1; id < n; id++) {
      var st = R.realFirst[id] + R.defaultState[id];
      var buf = BI.renderState(st, big);
      var any = false;
      for (var p = 3; p < buf.length; p += 4) if (buf[p]) { any = true; break; }
      if (!any) { BI.flat.push(id); continue; }        // the caller paints the flat tile instead
      img.data.set(buf);
      tg.putImageData(img, 0, 0);
      g.drawImage(tmp, 0, 0, big, big, (id % cols) * T, ((id / cols) | 0) * T, T, T);
    }
    BI.ready = true;
    return sheet;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
