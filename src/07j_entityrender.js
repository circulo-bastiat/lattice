// 07j_entityrender.js — PLAN G17c: THE ENTITIES YOU CAN SEE.
// Runs on: MAIN THREAD ONLY. Reads the live entity list; writes one §8 mesh buffer a frame.
//
// ⚠⚠ **WHY THIS FILE EXISTS.** G17a read the entity table and G17b built the motion, and both
// are behind green checks — and **nothing in the game has ever drawn an entity**. `NEXT.md` says
// it plainly: *"no entity is spawned during play, so there is no play-test item for G17b."*
// That is the exact shape PLAN §23 names: a stage whose output is a moving picture, tested only
// by numbers, ships drawing nothing and every assertion stays green (D-303, D-304).
//
// ⚠ **IT REUSES THE MODEL STREAM RATHER THAN ADDING A RENDERER.** A falling sand block is a
// block: the same baked quads, the same atlas layer, the same shade table, the same fog. The
// §8 mesh format already carries a model stream and both backends already draw it, so an
// entity is a §8 buffer with no greedy quads in it and an origin that is not a section's. **No
// shader changed, no vertex format changed, no backend method was added.** Model positions are
// signed 16-bit in 1/256 of a block — ±128 blocks — which is twice the range an entity is ever
// drawn at, and `uOrigin` is a float vec3, so the sub-block part of an entity's position is
// carried exactly by the uniform rather than quantised into the vertex.
//
// ⚠ **THE BUFFER IS REBUILT EVERY FRAME AND THAT IS THE CHEAP OPTION, NOT THE LAZY ONE.**
// Entities move every frame, so a cached mesh would have to be re-uploaded every frame anyway;
// the only question is whether the transform runs on the CPU or as a per-entity uniform. A
// uniform means one draw call per entity and a second code path in both backends. One buffer
// means one draw call for ALL of them and no backend change at all. At the sizes this is ever
// asked for — tens of entities, six quads each — the pack loop is a few thousand words of
// arithmetic, which is less than one section of terrain costs when it is remeshed.
//
// ⚠ **WHAT IS DRAWN IS A CLOSED LIST AND WHAT IS NOT IS NAMED.** `ER.OWED` carries every
// spawnable type with no picture yet, and `g17ccheck` fails if an undrawn type is not on it.
// A renderer that silently draws nothing for a type it does not know is how G17b passed.

(function (NS) {
  'use strict';

  var ER = NS.EntityRender = { ready: false };
  var CFG = NS.CFG;

  /**
   * How far an entity is drawn, in blocks.
   *
   * ⚠ IT IS ALSO A FORMAT LIMIT, NOT ONLY A BUDGET. A model position is i16 in 1/256 of a
   * block, so anything past 128 blocks of the origin WRAPS rather than disappears — an entity
   * at 130 blocks would be drawn at −126. The range is half the limit so a large model on a
   * distant entity still cannot reach it.
   */
  ER.RANGE = 64;

  /** Options.entityDistanceScaling (0.5..5, default 1); Entity.shouldRender's `renderDistanceMultiplier`. */
  ER.renderDistanceMultiplier = 1;

  /**
   * Entity.shouldRender(distanceSq): `d = box.getAverageSideLength(); if NaN d = 1; d *= 64 * mult;
   * return distanceSq < d * d`. The box is width x height x width. An entity with no size (a virtual
   * spawner display) is not culled here.
   */
  ER.shouldRender = function (e, distSq) {
    var w = e.width, h = e.height;
    if (w === undefined || h === undefined) return true;
    var d = (w + h + w) / 3;
    if (d !== d) d = 1;
    d *= 64 * ER.renderDistanceMultiplier;
    return distSq < d * d;
  };

  /** A frame's entity geometry is capped, so a spawn storm degrades rather than corrupts. */
  ER.MAX_QUADS = 8192;

  /**
   * The types this engine can draw, and what shape they are.
   *
   * ⚠ `block` MEANS "IT IS LITERALLY A BLOCK MODEL" — a falling block and primed TNT are the
   * two, and vanilla draws both by handing the block state to the ordinary block renderer.
   * Everything else needs either an entity model (the boxes are in `models.bin` already) or an
   * item display transform, and neither is this stage's first job.
   */
  // D-449 (session 60, QUEUE row 0 item 4's bow half): `arrow` gets its own shape — it is
  // neither a block model nor a ground-pile sprite item, it is a flying projectile that needs
  // its own orientation matrix (`ER.arrowMatrix`, keyed off the live velocity, not a spin/bob).
  // loop/xporbsprite (G21) -- 'orb' marks the type as drawn for g17ccheck's own roster
  // scan (it counts ER.SHAPE truthiness, not ER.build participation) without routing it
  // through the shared block-atlas §8 mesh path below: `ER.stateOf` returns 0 for any shape
  // that is not 'block'/'item', and `ER.visible`'s own `else if (!state) continue` already
  // skips it there on purpose -- the orb is drawn by `ER.renderOrbs`, this file's own
  // self-contained pass (own texture, own shaders, own buffers), the SAME shape
  // 07zx_particle.js/07u_leash.js already use for a camera-facing billboard that is not a
  // block model.
  // loop/throwables-s116 -- the live snowball/egg/ender-pearl/potion, drawn the SAME
  // "real jar item icon, flat billboard" way a dropped item already is (`ER.spritesFor`) --
  // named on `Throw.OWED`/`Po.OWED` as cheap rather than a dedicated in-flight model, the
  // SAME standing ruling `ER.arrowSpritesFor`'s own header already documents for the arrow.
  ER.SHAPE = { falling_block: 'block', tnt: 'block', item: 'item', arrow: 'arrow', spectral_arrow: 'arrow', experience_orb: 'orb',
    snowball: 'item', egg: 'item', ender_pearl: 'item', experience_bottle: 'item', potion: 'item', firework_rocket: 'item',
    fireball: 'fireball', small_fireball: 'fireball', lightning_bolt: 'bolt', painting: 'painting', item_frame: 'item_frame', glow_item_frame: 'item_frame', fishing_bobber: 'bobber' };

  /**
   * The spawnable types with no picture yet, each naming the stage that closes it
   * (`name — Gxx`), the way `Use.OWED` does (PASS 15 §1, stagecheck's citation sweep).
   * ⚠ THIS LIST IS HELD CLOSED BY THE CHECK: a type that `EntityList` will spawn and this
   * file will not draw must be named here, so that "nothing appeared" is always either a
   * failure or a written-down deviation.
   */
  // ⚠ Corrected D-407 (first browser sweep on `.chromium/`): dolphin, guardian and turtle had
  // been DRAWN through the mob path (`ER.mobLayerFor`) since G18a and were still listed here, while
  // `arrow`/`spectral_arrow` became spawnable at D-402 with no picture and no entry — a live arrow
  // was invisible and nothing said so. g17ccheck and g17cbcheck now count the mob path as drawn.
  // D-449 (session 60): `arrow` closed — it draws as an extruded `item/arrow` sprite oriented
  // along its own live velocity (`ER.arrowSpritesFor`/`ER.arrowMatrix`). loop/bow (this pass)
  // closed `spectral_arrow` the same way — `ER.arrowTile`/`ER.arrowSpritesFor` are now keyed
  // by TYPE and select the real jar `item/spectral_arrow` tile; the outline-on-hit render
  // (vanilla's Glowing effect) is still not built — see `bowcheck.mjs`'s own header.
  ER.OWED = [
    // #1666: G17b-6 (#206) made these six spawnable as no-motion rows; none has a shape or a mob
    // layer yet. marker draws nothing in vanilla either, area_effect_cloud draws only particles.
    'area_effect_cloud — G23',
    'marker — G17c'
    // struck loop/bow -- 'spectral_arrow — G18b': ER.SHAPE.spectral_arrow now shares the
    // 'arrow' shape and ER.arrowSpritesFor(type) selects the real jar 'item/spectral_arrow'
    // tile (Glowing's OUTLINE is built, #5623: ER.renderOutlines, a depth-off bounding-box outline).
  ];
  // struck loop/xporbsprite: 'experience_orb — G21' -- ER.renderOrbs (below) now draws it,
  // ER.SHAPE.experience_orb marks it, xporbdrawcheck.mjs proves the sprite/index/colour math.

  /**
   * ⚠ AND A SECOND OWED LIST, FOR THE HALF OF `item` THAT IS NOT DRAWN. An item entity holding a
   * BLOCK is that block's model, which this file already has; an item entity holding a SPRITE
   * item — a stick, an ingot — is a flat billboard of the ITEM atlas, which the model shader does
   * not sample at all. Naming it here means "a dropped stick is invisible" is a written-down
   * deviation rather than a silence.
   * ⚠ The stack PILE is the other one: vanilla draws 2, 3, 4 or 5 copies of the model at seeded
   * random offsets as the count passes 1, 16, 32 and 48 (`ItemEntityRenderer.getRenderAmount`),
   * and reproducing the offsets means reproducing `java.util.Random` exactly. One copy is drawn.
   */
  // ---- G17-F6: FishingBobberEntityRenderer (.decomp ...render/entity/FishingBobberEntityRenderer.java) ----
  // PURE geometry, shared by the WebGL2 and WebGPU paths (so they cannot differ): ER.bobberGeometry returns the
  // 2x2 billboard (4 verts, texture entity/fishing_hook, uv (0,1)(1,1)(1,0)(0,0)) and the 17-vertex line strip,
  // both RELATIVE TO THE BOBBER'S LERPED POSITION. o = owner {x,y,z,px,py,pz,bodyYaw,prevBodyYaw,swing (getHandSwingProgress),
  // rightArm, rodInMain, sneaking, eyeHeight}; b = bobber {x,y,z,px,py,pz}; opts.camRot = 3x3 row-major billboard rotation,
  // opts.firstPerson + opts.projPos(x,y) (camera projection getPosition) + opts.fov for the own-player view.
  ER.bobberGeometry = function (b, o, t, opts) {
    opts = opts || {};
    var lerp = function (a, c, d) { return c + (d - c) * a; };
    var R = opts.camRot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var quad = [];
    var QV = [[0, 0, 0, 1], [1, 0, 1, 1], [1, 1, 1, 0], [0, 1, 0, 0]];
    for (var i = 0; i < 4; i++) {
      var x = -(QV[i][0] - 0.5) * 0.5, y = (QV[i][1] - 0.5) * 0.5;   // scale 0.5, then rotateY(180): x,z negate
      quad.push({ x: R[0] * x + R[1] * y, y: R[3] * x + R[4] * y, z: R[6] * x + R[7] * y, u: QV[i][2], v: QV[i][3] });
    }
    var side = o.rightArm ? 1 : -1;
    if (!o.rodInMain) side = -side;
    var sw = o.swing || 0, sw14 = Math.sin(Math.sqrt(sw) * Math.PI);
    var by = lerp(t, o.prevBodyYaw, o.bodyYaw) * (Math.PI / 180);
    var sn = Math.sin(by), cs = Math.cos(by), w = side * 0.35, hx, hy, hz, dy;
    if (opts.firstPerson) {
      var k = 960 / opts.fov, v = opts.projPos(side * 0.525, -0.1);
      var vx = v[0] * k, vy = v[1] * k, vz = v[2] * k, a = sw14 * 0.5, c, d;
      c = Math.cos(a); d = Math.sin(a); var tx = vx * c + vz * d; vz = -vx * d + vz * c; vx = tx;   // rotateY
      a = -sw14 * 0.7; c = Math.cos(a); d = Math.sin(a); var ty = vy * c - vz * d; vz = vy * d + vz * c; vy = ty;   // rotateX
      hx = lerp(t, o.px, o.x) + vx; hy = lerp(t, o.py, o.y) + vy; hz = lerp(t, o.pz, o.z) + vz; dy = o.eyeHeight;
    } else {
      hx = lerp(t, o.px, o.x) - cs * w - sn * 0.8;
      hy = o.py + o.eyeHeight + (o.y - o.py) * t - 0.45;
      hz = lerp(t, o.pz, o.z) - sn * w + cs * 0.8;
      dy = o.sneaking ? -0.1875 : 0;
    }
    var f = Math.fround;
    var dx = f(hx - lerp(t, b.px, b.x)), ey = f(f(hy - (lerp(t, b.py, b.y) + 0.25)) + f(dy)), dz = f(hz - lerp(t, b.pz, b.z));
    var line = [];
    for (var n = 0; n <= 16; n++) {
      var p = n / 16, q = (n + 1) / 16;
      var X = dx * p, Y = ey * (p * p + p) * 0.5 + 0.25, Z = dz * p;
      var nx = dx * q - X, ny = ey * (q * q + q) * 0.5 + 0.25 - Y, nz = dz * q - Z, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      line.push({ x: X, y: Y, z: Z, nx: nx / l, ny: ny / l, nz: nz / l });
    }
    return { quad: quad, line: line, hand: [hx, hy, hz] };
  };
  // ---- #326 G24j: the rod's `cast` model predicate and the bobber + line draw list ----
  /** fishing_rod.json: `cast` -> item/fishing_rod_cast, else item/fishing_rod. */
  ER.rodTileName = function (cast) { return cast ? 'item/fishing_rod_cast' : 'item/fishing_rod'; };
  /** FishingRodItem's `cast` predicate: the holder is a player whose bobber is out and the held item is a fishing_rod. */
  ER.rodIsCast = function (p, itemIdx) {
    var IT = NS.Items;
    if (!p || !p.fishHook || p.fishHook.removed || !IT || !IT.nameOf) return false;
    return IT.nameOf(itemIdx | 0) === 'fishing_rod';
  };
  ER.BOBBER_HALF = 0.25;   // the 0.5 x 0.5 billboard
  ER.BOBBER_LINE_W = 0.015;   // line half-width (vanilla: GL line, 2px wide, black)
  /**
   * The bobber's untextured draw list, flat [x,y,z,r,g,b,a] x4 per quad, world space, riding the crystal-beam pass
   * (no sampler for entity/fishing_hook.png there, so the billboard is its two-tone: red top half, white bottom half).
   * Line: 16 segments of the `bobberGeometry` strip, each a camera-facing black quad. Returns { out, ends } where ends =
   * [rodTip, bobber] world positions. cam.right/cam.up are the billboard axes.
   */
  ER.bobberVerts = function (e, cam, partial, out) {
    var P = e.owner || (NS.Player && NS.Player.fishHook === e ? NS.Player : null);
    if (!P) return null;
    var t = partial === undefined ? 1 : partial;
    var yawDeg = ((P.yaw || 0) - Math.PI) * 180 / Math.PI;
    var o = { x: P.ex, y: P.ey, z: P.ez, px: P.ex, py: P.ey, pz: P.ez, bodyYaw: yawDeg, prevBodyYaw: yawDeg, swing: 0,
              rightArm: P.mainArm !== 'left', rodInMain: true, sneaking: !!P.sneaking, eyeHeight: P.eyeHeight || P.EYE || 1.62 };
    o.py = o.y;
    var rx = cam.right || [1, 0, 0], ry = cam.up || [0, 1, 0];   // billboard axes (bobberGeometry negates x itself)
    var b = { x: e.x, y: e.y, z: e.z, px: e.px, py: e.py, pz: e.pz };
    var g = ER.bobberGeometry(b, o, t, { camRot: [rx[0], ry[0], 0, rx[1], ry[1], 0, rx[2], ry[2], 0] });
    var bx = b.px + (b.x - b.px) * t, by = b.py + (b.y - b.py) * t, bz = b.pz + (b.z - b.pz) * t;
    var q = g.quad, i, k;
    for (i = 0; i < 2; i++) {   // two halves: top (v 0..0.5) red, bottom white
      var A = i ? q[0] : q[3], B = i ? q[1] : q[2], mA = i ? q[3] : q[0], mB = i ? q[2] : q[1];
      var top = !i, c = top ? [0.8, 0.1, 0.1, 1] : [1, 1, 1, 1];
      var mid = [[(q[0].x + q[3].x) / 2, (q[0].y + q[3].y) / 2, (q[0].z + q[3].z) / 2], [(q[1].x + q[2].x) / 2, (q[1].y + q[2].y) / 2, (q[1].z + q[2].z) / 2]];
      var pts = top ? [q[3], q[2], { x: mid[1][0], y: mid[1][1], z: mid[1][2] }, { x: mid[0][0], y: mid[0][1], z: mid[0][2] }]
                    : [{ x: mid[0][0], y: mid[0][1], z: mid[0][2] }, { x: mid[1][0], y: mid[1][1], z: mid[1][2] }, q[1], q[0]];
      for (k = 0; k < 4; k++) out.push(bx + pts[k].x, by + pts[k].y, bz + pts[k].z, c[0], c[1], c[2], c[3]);
    }
    var L = g.line, w = ER.BOBBER_LINE_W;
    for (i = 0; i < 16; i++) {
      var s0 = L[i], s1 = L[i + 1];
      for (k = 0; k < 4; k++) {
        var s = k < 2 ? s0 : s1, sg = (k === 0 || k === 3) ? -1 : 1;
        out.push(bx + s.x + ry[0] * w * sg, by + s.y + ry[1] * w * sg, bz + s.z + ry[2] * w * sg, 0, 0, 0, 1);
      }
    }
    return { out: out, ends: [[bx + L[16].x, by + L[16].y, bz + L[16].z], [bx + L[0].x, by + L[0].y, bz + L[0].z]] };
  };
  ER.OWED_ITEM = [];

  /**
   * G18a-1 (#209): what the boat's draw still does not do, named (now nothing). `BoatEntityRenderer`
   * draws the `water_patch` box through `RenderLayer.getWaterMask()` when the boat is not submerged
   * (#5723: `ER.buildWaterMask`, a depth-only 'watermask' pass on both backends). 1.18.2 has no chest boat (ChestBoatEntity is 1.19), so there is no second layer.
   */
  ER.OWED_BOAT = [];   // #5723: water_patch is ER.emitWaterPatch, drawn depth-only by G.entityMask

  /**
   * ⚠ D-342 TOOK TWO ENTRIES OFF THAT LIST AND PASS 15 JOB 3 (G17e) TOOK THE LAST ONE — ALL
   * DELETED, NOT COMMENTED (D-139). "sprite items (no block model)" is gone because a stick is
   * now vanilla's EXTRUDED sprite, baked at build time through the same baker every block goes
   * through; "the 2-5 copy stack pile" is gone because `java.util.Random` is a 48-bit LCG and
   * this file reproduces it exactly; "block-entity items" is gone because `ER.beIndexOf`,
   * `ER.bePartOf` and `ER.beFor` now draw the 58 `builtin/entity` items (`pack-blockentity.mjs`,
   * D-341's trick a third time) — a chest is drawn from its OWN baked part, not from any model
   * in the block-state geometry, exactly as vanilla draws it from a block-entity renderer and
   * not from its (empty) block model. `becheck` is the picture proof, `stagecheck`'s scan still
   * finds this symbol (kept, empty — the array names the class of gap, not just its members).
   */

  ER.init = function () {
    ER.ready = !!(NS.Reg && NS.Reg.ready && NS.States && NS.States.ready &&
                  NS.Mesher && NS.Mesher.packModelVertex);
    ER.tntState = 0;
    return ER;
  };

  /**
   * The block state an entity is drawn as, or 0 for "this engine has no picture for it".
   *
   * ⚠ A FALLING BLOCK WITHOUT A STATE IS NOT DRAWN AS STONE. `EntityList.spawn` takes the
   * state in its options; an entity that arrived without one is a caller bug, and drawing a
   * default would hide it behind a plausible grey cube for ever.
   */
  ER.stateOf = function (e) {
    if (!e || e.removed) return 0;
    var shape = ER.SHAPE[e.type];
    if (shape === 'item') {
      // ⚠⚠ **THE MODEL DECIDES, NOT `isBlock`** (D-342). This used to ask whether the item
      // places a block, and that is the wrong question: `rail`, `torch`, `ladder`, every
      // sapling, every flower and every candle DO place a block and vanilla still draws them
      // as a flat sprite, because their item model's parent is `item/generated`. Asking
      // `isBlock` drew a dropped torch as a solid 3D torch model — a different picture from
      // the one the inventory shows, for 100-odd items.
      // The engine already knows: an item with sprite LAYERS is a generated model, and an item
      // with none is a block model. That is the same fact the item table was built from.
      var IT = NS.Items;
      if (!IT || !IT.ready) return 0;
      var idx = ER.itemIdOf(e);
      if (!(idx >= 0)) return 0;
      if (ER.spriteTileOf(idx) >= 0) return 0;          // drawn by its sprite part instead
      if (ER.beIndexOf(idx) >= 0) return 0;             // drawn by its be-item part instead (JOB 3)
      var st = IT.stateOf(idx);
      return st > 0 ? st : 0;
    }
    if (shape !== 'block') return 0;
    if (e.type === 'tnt') {
      if (!ER.tntState) ER.tntState = NS.States.stateOf('tnt') | 0;
      return ER.tntState;
    }
    return e.state | 0;
  };

  /**
   * D-KW (Dan: "a thrown potion is invisible") -- a THROWN projectile whose entity type IS its
   * own item (snowball/egg/ender_pearl/potion) never gets `opts.item` -- `EL.DEFAULTS.item`'s
   * own `if (opts.item !== undefined) e.item = opts.item` (07i_entitylist.js:435) is the ONLY
   * place any entity is ever given one, and none of `EL.DEFAULTS.potion`/`.snowball`/`.egg`/
   * `.ender_pearl` call it -- so `ER.spritesFor`'s `!(idx >= 0)` early-out fired for every one
   * of them, not only the potion Dan happened to be looking at (this file's own `ER.SHAPE`
   * already marks all four as shape 'item', the "flat billboard" ruling `ER.SHAPE`'s own
   * header names). A `potion` entity's item icon depends on `e.lingering` (splash vs lingering
   * potion, two different real items, `Th.throwPotion`'s own field) exactly the way its splash
   * radius/effects already do (07z_potion.js) -- everything else just IS its own item name.
   */
  ER.THROWN_ITEM_NAME = { snowball: 'snowball', egg: 'egg', ender_pearl: 'ender_pearl', experience_bottle: 'experience_bottle', firework_rocket: 'firework_rocket', fireball: 'fire_charge', small_fireball: 'fire_charge' };
  /**
   * #3806 FireballEntityRenderer: FlyingItemEntityRenderer(scale 3 ghast / 0.75 small, lit) draws the
   * fire_charge item in GROUND mode (display scale 0.5) as a camera-facing billboard.
   * full camera-facing basis (pitch included) and the ground display y lift (`.lift`).
   */
  ER.FIREBALL_SCALE = { fireball: 3, small_fireball: 0.75 };
  ER.fireballMatrix = function (type, dx, dz, dy) {
    // full camera-facing basis (dispatcher.getRotation()): n toward the camera, r horizontal, u = n x r
    dy = dy || 0;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, h = Math.sqrt(dx * dx + dz * dz), s = 0.5 * ER.FIREBALL_SCALE[type];
    var nx = -dx / L, ny = -dy / L, nz = -dz / L, rx, rz;
    if (h < 1e-9) { rx = 1; rz = 0; } else { rx = nz / (h / L); rz = -nx / (h / L); }
    var ux = ny * rz, uy = nz * rx - nx * rz, uz = -ny * rx;
    var m = [rx * s, ux * s, nx * s, 0, uy * s, ny * s, rz * s, uz * s, nz * s];
    m.lift = [ux * 0.125 * ER.FIREBALL_SCALE[type], uy * 0.125 * ER.FIREBALL_SCALE[type], uz * 0.125 * ER.FIREBALL_SCALE[type]];   // display.ground translation (0,2,0)/16
    return m;
  };
  /** The item index an item entity is holding, or -1. Accepts a bare index or a stack. */
  ER.itemIdOf = function (e) {
    if (!e) return -1;
    if (e.item !== undefined && e.item !== null) {
      if (typeof e.item === 'number') return e.item;
      return e.item.i !== undefined ? e.item.i : (e.item.id !== undefined ? e.item.id : -1);
    }
    var IT = NS.Items;
    if (!IT || !IT.ready || !IT.of) return -1;
    var name = ER.THROWN_ITEM_NAME[e.type];
    if (name === undefined && e.type === 'potion') name = e.lingering ? 'lingering_potion' : 'splash_potion';
    return name ? IT.of(name) : -1;
  };

  /**
   * The ITEM ATLAS TILE of item `idx`'s first sprite layer, or -1 when it has none — which is
   * exactly "this item is drawn as a block model, not as a sprite".
   *
   * ⚠ LAYER 0 ONLY, AND THE REST ARE NOT SILENTLY DROPPED: `ER.itemLayers` returns all of
   * them and `ER.build` emits one part per layer, so a zombie spawn egg draws its base and its
   * overlay as two coincident sprite models the way vanilla draws two elements.
   */
  ER.spriteTileOf = function (idx) {
    var IT = NS.Items;
    if (!IT || !IT.ready || !(idx >= 0)) return -1;
    var s = IT.layerOff[idx], e = IT.layerOff[idx + 1];
    return e > s ? IT.layerTile[s] : -1;
  };

  /** Every sprite layer tile of an item, in draw order. Empty for a block-model item. */
  ER.itemLayers = function (idx) {
    var IT = NS.Items, out = [];
    if (!IT || !IT.ready || !(idx >= 0)) return out;
    for (var k = IT.layerOff[idx]; k < IT.layerOff[idx + 1]; k++) out.push(IT.layerTile[k]);
    return out;
  };

  /**
   * The geometry PART holding item tile `t`'s extruded sprite model, or -1.
   *
   * ⚠ THE PARTS ARE APPENDED TO THE BLOCK PARTS, so this is a base plus the tile index and
   * nothing more. `DATA.spritePart0` is shipped by `gen-data` rather than derived from a part
   * count here, because the runtime must not have to know how the packer laid the array out
   * (D-305: never let the reader own a number the writer owns).
   */
  ER.spritePartOf = function (tile) {
    var D = NS.DATA;
    if (!D || !(D.spriteParts > 0) || !(tile >= 0) || tile >= D.spriteParts) return -1;
    return (D.spritePart0 | 0) + tile;
  };

  /** The render pass one item tile belongs in, from the atlas's own alpha class. */
  ER.spriteLayerOf = function (tile) {
    var D = NS.DATA, C = CFG;
    var a = D && D.spriteAlpha ? (D.spriteAlpha[tile] | 0) : 1;
    return a === 2 ? C.LAYER_TRANSLUCENT : (a === 1 ? C.LAYER_CUTOUT : C.LAYER_OPAQUE);
  };

  /**
   * ⚠⚠ **THE THIRD KIND OF ITEM (PASS 15 JOB 3, G17e).** A dropped stick has no block state and
   * a sprite part (`ER.spritePartOf`); a dropped stone has a block state and `ER.emit` draws it;
   * a dropped CHEST has neither — its block model (`builtin/entity`) bakes no quads at all, the
   * same way vanilla's does, because the chest is drawn by a block-entity renderer instead. That
   * renderer's own world-space geometry is exactly the `bePart0 + beNames[name]` part
   * `pack-blockentity.mjs` baked (D-341's trick a third time), keyed by the item's OWN registry
   * NAME because that is the only thing a chest item, a bed item and a `chest` block state do
   * not have in common with each other.
   */
  ER.beIndexOf = function (idx) {
    var D = NS.DATA, IT = NS.Items;
    if (!D || !D.beNames || !IT || !IT.ready || !(idx >= 0)) return -1;
    var name = IT.nameOf(idx);
    var i = D.beNames[name];
    return i === undefined ? -1 : (i | 0);
  };

  /**
   * #8080 -- `BuiltinModelItemRenderer`'s shield branch: the passes the shield model is drawn in.
   * Pass 0 is `shield_base` (tinted by `Base`) or the plain `shield_base_nopattern`; with a
   * `BlockEntityTag` every `entity/shield/<name>` pattern layer is one more pass of the same model
   * parts (`BannerBlockEntityRenderer.renderCanvas`). Returns `[{ tex, rgb|null }]`.
   */
  ER.shieldPasses = function (tag) {
    var BE = NS.BEModel, look = BE && BE.shieldLook ? BE.shieldLook(tag) : null;
    if (!look) return [{ tex: 'be_shield', rgb: null }];
    var out = [{ tex: look.tex, rgb: look.tint }];
    for (var i = 0; i < look.layers.length; i++) out.push({ tex: look.layers[i].tex, rgb: look.layers[i].rgb });
    return out;
  };

  /** The geometry PART holding block-entity item `beIdx`'s world-space model, or -1. */
  ER.bePartOf = function (beIdx) {
    var D = NS.DATA;
    if (!D || !(D.beParts > 0) || !(beIdx >= 0) || beIdx >= D.beParts) return -1;
    return (D.bePart0 | 0) + beIdx;
  };

  // ── THE STACK PILE (D-342) ──────────────────────────────────────────────────────────────
  /**
   * `ItemEntityRenderer.getRenderAmount` — how many copies of the model a stack is drawn as.
   * Straight off the bytecode's own thresholds: 48, 32, 16 and 1, tested in that order.
   */
  ER.RENDER_AMOUNT_STEPS = [48, 32, 16, 1];
  ER.renderAmount = function (count) {
    var n = count | 0, st = ER.RENDER_AMOUNT_STEPS;
    if (n > st[0]) return 5;
    if (n > st[1]) return 4;
    if (n > st[2]) return 3;
    if (n > st[3]) return 2;
    return 1;
  };

  /**
   * ⚠⚠ **`java.util.Random`, EXACTLY** — not "a random number generator", and not this
   * engine's own. The copy offsets of a stack pile are drawn from a Random seeded with the
   * item's id, so reproducing the picture means reproducing the LCG: a 48-bit state,
   * `state = state * 0x5DEECE66D + 0xB`, and `nextFloat() = next(24) / 2^24`.
   *
   * JavaScript has no 64-bit integers in Number, so the multiply is done in two 24-bit halves
   * — the same trick the seed scrambler uses — rather than with BigInt, which would allocate
   * on every call and this is called up to twelve times per dropped stack per frame.
   *
   * `jrandcheck` in `tools/spritecheck.mjs` pins the first values against the sequence a real
   * JVM produces, so "exactly" is an assertion and not a claim.
   */
  function JRand(seed) { this.setSeed(seed); }
  JRand.MUL_HI = 0x5DE;        // 0x5DEECE66D = MUL_HI<<24 | MUL_LO
  JRand.MUL_LO = 0xECE66D;
  JRand.prototype.setSeed = function (seed) {
    // (seed ^ 0x5DEECE66D) & ((1<<48)-1), in two 24-bit halves
    var lo = (seed >>> 0) & 0xFFFFFF;
    var hi = ((seed / 0x1000000) | 0) & 0xFFFFFF;
    this.lo = (lo ^ JRand.MUL_LO) & 0xFFFFFF;
    this.hi = (hi ^ JRand.MUL_HI) & 0xFFFFFF;
  };
  JRand.prototype.next = function (bits) {
    // (hi:lo) * (MUL_HI:MUL_LO) + 0xB, keeping 48 bits
    var lo = this.lo * JRand.MUL_LO + 0xB;
    var carry = Math.floor(lo / 0x1000000);
    var newLo = lo % 0x1000000;
    var hi = this.hi * JRand.MUL_LO + this.lo * JRand.MUL_HI + carry;
    this.lo = newLo;
    this.hi = hi % 0x1000000;
    // the top `bits` bits of the 48-bit state, as an unsigned int
    var v = this.hi * 0x1000000 + this.lo;
    return Math.floor(v / Math.pow(2, 48 - bits));
  };
  JRand.prototype.nextFloat = function () { return this.next(24) / 0x1000000; };
  /** `Random.nextInt(bound)`, exactly (power-of-two shortcut, else the rejection loop). */
  JRand.prototype.nextInt = function (bound) {
    var r = this.next(31);
    if ((bound & (bound - 1)) === 0) return Math.floor(bound * r / 0x80000000);
    var u = r, v;
    while (u - (v = u % bound) + (bound - 1) >= 0x80000000) u = this.next(31);
    return v;
  };
  ER.JRand = JRand;

  /**
   * StuckObjectsFeatureRenderer's placement loop (arrows / bee stingers in a living entity). `parts` is the model's
   * non-empty part list, each `{ cuboids: [{minX,maxX,minY,maxY,minZ,maxZ}] }` (model units). RNG order is vanilla's:
   * nextInt(parts), nextInt(cuboids), then three nextFloat. Returns per object the part/cuboid index, the translate in
   * blocks and the three `-(f*2-1)` factors renderObject gets.
   */
  ER.stuckObjectPlacements = function (entityId, count, parts) {
    var r = new JRand(entityId), out = [];
    for (var i = 0; i < count; i++) {
      var pi = r.nextInt(parts.length), cs = parts[pi].cuboids, ci = r.nextInt(cs.length), c = cs[ci];
      var f1 = r.nextFloat(), f2 = r.nextFloat(), f3 = r.nextFloat();
      out.push({ part: pi, cuboid: ci,
        t: [(c.minX + (c.maxX - c.minX) * f1) / 16, (c.minY + (c.maxY - c.minY) * f2) / 16, (c.minZ + (c.maxZ - c.minZ) * f3) / 16],
        f: [-1 * (f1 * 2 - 1), -1 * (f2 * 2 - 1), -1 * (f3 * 2 - 1)] });
    }
    return out;
  };

  /** StuckArrowsFeatureRenderer / StuckStingersFeatureRenderer getObjectCount: the live counters Cb.tickStuckObjects maintains. */
  ER.stuckObjectCount = function (e, kind) {
    var n = e ? (kind === 'stinger' ? e.stingerCount : e.stuckArrows) : 0;
    return n > 0 ? n | 0 : 0;
  };
  /** A baked mob layer's parts as `ER.stuckObjectPlacements` wants them: one cuboid per part, from the part's own box (model units, pivot-local). */
  ER.stuckPartsOf = function (layerParts) {
    var out = [];
    for (var i = 0; i < layerParts.length; i++) {
      var p = layerParts[i];
      if (!(p.w > 0 || p.h > 0 || p.d > 0)) continue;
      out.push({ name: p.n, cuboids: [{ minX: p.x, maxX: p.x + p.w, minY: p.y, maxY: p.y + p.h, minZ: p.z, maxZ: p.z + p.d }] });
    }
    return out;
  };

  /**
   * G18a-R1 -- StuckArrows/StuckStingersFeatureRenderer drawn: one 'arrow' sprite item per stuck object, at the
   * `ER.stuckObjectPlacements` point on the part's posed pivot frame, heading along the placement's `f` vector
   * (tip inward). The model is the D-449 stand-in (`item/arrow` tile, `ER.arrowMatrix`), not vanilla's arrow.png
   * quads; a stinger uses the same tile at half size. Baby scaling of the host is not applied.
   */
  ER.stuckObjectItems = function (e, mobLayer, px, py, pz, partial) {
    var out = [], BE = NS.BEModel;
    var na = ER.stuckObjectCount(e, 'arrow'), ns = ER.stuckObjectCount(e, 'stinger');
    if (!(na + ns) || !BE || !BE.ready) return out;
    var L = BE.layer(mobLayer);
    if (!L) return out;
    var parts = ER.stuckPartsOf(L.parts);
    if (!parts.length) return out;
    var sp = ER.arrowSpritesFor('arrow');
    if (!sp) return out;
    var anim = ER.animOf(e, partial), bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy, 0, bs * sy, 0, bs, 0, -sy, 0, cy];
    for (var kind = 0; kind < 2; kind++) {
      var n = kind ? ns : na;
      if (!n) continue;
      var pl = ER.stuckObjectPlacements(e.id | 0, n, parts);
      for (var i = 0; i < pl.length; i++) {
        var q = pl[i], src = null;
        for (var k = 0; k < L.parts.length; k++) if (L.parts[k].n === parts[q.part].name) { src = L.parts[k]; break; }
        if (!src) continue;
        var po = ER.posedPart(src, anim, mobLayer);
        var R = m3mul(m3mul(rZ(po.rz), rY(po.ry)), rX(po.rx));
        var lt = m3v(R, q.t), d = m3v(B, m3v(R, q.f));
        var o = m3v(B, [po.px / 16 + lt[0], po.py / 16 + lt[1], po.pz / 16 + lt[2]]);
        var hy = Math.atan2(d[0], -d[2]), hp = Math.atan2(d[1], Math.hypot(d[0], d[2]));
        out.push({ e: e, state: 0, x: px + o[0] * sc, y: py + (bp.yOffsetFixed || 0) / U * sc + o[1] * sc, z: pz + o[2] * sc, shape: 'arrow',
                   layer: sp.layer, sprites: sp.parts, copies: sp.copies, flatSprite: true, mobLayer: null,
                   m: ER.arrowMatrix(hy, hp, ER.ARROW_SCALE * sc * (kind ? 0.5 : 1)), stuck: true });
      }
    }
    return out;
  };

  /**
   * The seed `ItemEntityRenderer` gives that Random: 187 for an empty stack, otherwise the
   * item's registry id plus its damage value. Both read off the bytecode; the 187 is a real
   * constant in the jar and not a placeholder.
   */
  ER.PILE_SEED_EMPTY = 187;
  ER.pileSeed = function (idx, damage) {
    if (!(idx >= 0)) return ER.PILE_SEED_EMPTY;
    var IT = NS.Items;
    var id = IT && IT.id ? (IT.id[idx] | 0) : idx;
    return id + (damage | 0);
  };

  /**
   * The per-copy offsets of a pile, in BLOCKS, as `[x, y, z]` triples — copy 0 first.
   *
   * ⚠ THE FLAT AND THE 3D CASES ARE DIFFERENT AND BOTH ARE HERE. A block-model item ("gui3d")
   * jitters in all three axes by +-0.15; a flat sprite jitters in X and Y ONLY, by half that,
   * and its copies are STACKED along Z by 0.09375 * the ground scale, centred by an initial
   * -0.09375 * (n-1) * 0.5 * scaleZ. That stacking is what makes a pile of sticks read as a
   * pile rather than as one stick with a fringe.
   * ⚠ Copy 0 takes NO random draw — the `j > 0` guard — so the sequence must not be advanced
   * for it, and this loop does not.
   */
  ER.JITTER = 0.15;
  ER.PILE_STEP = 0.09375;
  ER.pileOffsets = function (idx, damage, count, gui3d, scale) {
    var n = ER.renderAmount(count), r = new JRand(ER.pileSeed(idx, damage)), out = [];
    var sx = scale, sy = scale, sz = scale;
    var baseZ = gui3d ? 0 : -ER.PILE_STEP * (n - 1) * 0.5 * sz;
    var z = baseZ;
    for (var j = 0; j < n; j++) {
      var ox = 0, oy = 0, oz = 0;
      if (j > 0) {
        if (gui3d) {
          ox = (r.nextFloat() * 2 - 1) * ER.JITTER;
          oy = (r.nextFloat() * 2 - 1) * ER.JITTER;
          oz = (r.nextFloat() * 2 - 1) * ER.JITTER;
        } else {
          ox = (r.nextFloat() * 2 - 1) * ER.JITTER * 0.5;
          oy = (r.nextFloat() * 2 - 1) * ER.JITTER * 0.5;
        }
      }
      out.push([ox, oy, z + oz]);
      if (!gui3d) z += ER.PILE_STEP * sz;
    }
    return out;
  };

  /** The render layer a state belongs in — the mesher's own answer, not a second opinion. */
  ER.layerOf = function (state) {
    var SR = NS.States;
    return SR.layer[SR.block[state]] | 0;
  };

  /**
   * Where an entity's MODEL ORIGIN sits relative to its position, in blocks.
   *
   * ⚠ AN ENTITY'S POSITION IS THE CENTRE OF ITS FOOTPRINT AND A BLOCK MODEL'S IS A CORNER.
   * `FallingBlockEntity` is at `(x + 0.5, y, z + 0.5)` of the block it left and its renderer
   * opens with `translate(-0.5, 0, -0.5)`; primed TNT does the same thing in two steps
   * (`translate(-0.5, -0.5, -0.5)` then `translate(0, 0.5, 0)`). Drop the half and every
   * falling block is drawn one corner off its own shadow.
   */
  ER.MODEL_OFFSET = [-0.5, 0, -0.5];

  /**
   * An ITEM entity, out of `ItemEntityRenderer.render` (obfuscated class `ewf`) and
   * `block/block.json`'s own `display.ground`, both read rather than remembered:
   *
   *     bob  = sin((age + partial) / 10 + bobOffs) * 0.1 + 0.1
   *     spin = (age + partial) / 20 + bobOffs                      // ItemEntity.getSpin, radians
   *     translate(0, bob + 0.25 * groundScale.y, 0);  rotateY(spin)
   *     [ground] translate(0, 3/16, 0);  scale(0.25)
   *     translate(-0.5, -0.5, -0.5)
   *
   * ⚠ **THE TWO DIVISORS ARE DIFFERENT AND IT IS NOT A TYPO.** The bob is on a ten-tick period
   * and the spin on a twenty-tick one, so an item turns once for every two bobs; make them the
   * same and the motion reads as a single mechanical wobble.
   *
   * ⚠ Composed, and because a Y rotation fixes the Y axis, all of it collapses to
   *     local = 0.25 * Ry(spin) * (p - 0.5) + (0, 0.25 + bob, 0)
   * with the vertical term being `3/16 + 0.25 * 0.25` — the ground translation plus the
   * renderer's own quarter-of-the-scale lift. `g17ccheck` asserts that identity against the
   * uncollapsed chain rather than trusting the algebra here.
   */
  ER.GROUND = { ty: 3 / 16, scale: 0.25 };

  /**
   * ⚠⚠ **AND A SPRITE ITEM'S GROUND TRANSFORM IS NOT A BLOCK'S** (D-342). `block/block.json`
   * puts a dropped block at translation (0,3,0) scale 0.25; `item/generated.json` puts a
   * dropped sprite at (0,2,0) scale **0.5** — twice as big and lifted less. This file carried
   * only the block pair, so every sprite would have come out half the size vanilla draws it,
   * and half-size is a perfectly plausible picture: nothing would have reported it.
   * ⚠ `item/handheld.json` does NOT override `ground`, so a sword uses this one too; the
   * referee asserts that it still does not, because the day it does this needs a third entry.
   * Both pairs are graded against `tools/golden/itemmodel-1.18.2.tsv` by `spritecheck`.
   * ⚠ The two happen to give the SAME vertical lift — 0.25*0.25 + 3/16 and 0.25*0.5 + 2/16 are
   * both 0.25 — and that coincidence is not relied on anywhere: `ER.itemLift` takes the ground
   * transform and computes it.
   */
  ER.GROUND_SPRITE = { ty: 2 / 16, scale: 0.5 };

  /** The ground transform a drawn item uses: the sprite one for a flat item, else the block's. */
  ER.groundFor = function (sprite) { return sprite ? ER.GROUND_SPRITE : ER.GROUND; };

  /**
   * #635 the `ground` display of a block-entity item's own model (jar 1.18.2 `models/item/*`), in 1/16 units:
   * template_skull and conduit (0,3,0)/0.5, chest (0,3,0)/0.25, template_bed (0,1,2)/0.25, template_banner
   * (0,1,0)/0.25, shield (4,4,2)/0.25. Only scale and ty are applied: the tx/tz terms need a translation
   * beyond the 3x3 itemMatrix and are still owed. `tools/begroundcheck.mjs` grades this against the jar.
   */
  ER.beGroundFor = function (name) {
    if (/(^|_)(skull|head)$/.test(name) || name === 'conduit') return { ty: 3 / 16, scale: 0.5 };
    if (/_bed$/.test(name)) return { ty: 1 / 16, scale: 0.25 };
    if (/_banner$/.test(name)) return { ty: 1 / 16, scale: 0.25 };
    if (name === 'shield') return { ty: 4 / 16, scale: 0.25 };
    return ER.GROUND;
  };
  ER.BOB_PERIOD = 10;
  ER.SPIN_PERIOD = 20;
  ER.BOB_AMP = 0.1;

  /** `bob + 0.25 * groundScale.y + groundTranslate.y`, the whole vertical offset of an item. */
  ER.itemLift = function (age, partial, bobOffs, ground) {
    var g = ground || ER.GROUND;
    var f = (age + (partial === undefined ? 1 : partial)) / ER.BOB_PERIOD + (bobOffs || 0);
    var bob = Math.sin(f) * ER.BOB_AMP + ER.BOB_AMP;
    return bob + 0.25 * g.scale + g.ty;
  };

  /** `ItemEntity.getSpin` — radians, and on a DIFFERENT period from the bob. */
  ER.itemSpin = function (age, partial, bobOffs) {
    return (age + (partial === undefined ? 1 : partial)) / ER.SPIN_PERIOD + (bobOffs || 0);
  };

  /**
   * The interpolated position of an entity at a partial tick.
   * ⚠ `px/py/pz` ARE THE PREVIOUS TICK (D-79). Drawing `e.x` directly gives 20 Hz motion on a
   * 60 Hz screen, which reads as a stutter nobody can point at.
   */
  ER.posAt = function (e, partial, out) {
    var t = partial === undefined ? 1 : partial;
    var c = e.boatC;
    if (c) { out[0] = c.px + (c.x - c.px) * t; out[1] = c.py + (c.y - c.py) * t; out[2] = c.pz + (c.z - c.pz) * t; return out; }
    out[0] = e.px + (e.x - e.px) * t;
    out[1] = e.py + (e.y - e.py) * t;
    out[2] = e.pz + (e.z - e.pz) * t;
    return out;
  };

  /**
   * Everything needed to draw one item entity as SPRITE parts, or null if it is not one.
   *
   * Returns `{ parts: [partIndex...], layer, copies: [[x,y,z]...] }`:
   *   - one part per sprite LAYER, in draw order, so a spawn egg's base and its overlay are
   *     two coincident models exactly as vanilla stacks two elements;
   *   - the render pass of the FIRST layer, because all layers of one item are drawn together
   *     and a §8 buffer sorts by pass, not by quad;
   *   - one offset per copy of the pile, from `java.util.Random` seeded the way vanilla seeds
   *     it. A stack of one is one copy at the origin and costs no random draw.
   */
  ER.spritesFor = function (e) {
    var idx = ER.itemIdOf(e);
    if (!(idx >= 0)) return null;
    var tiles = ER.itemLayers(idx);
    if (!tiles.length) return null;
    var parts = [];
    for (var i = 0; i < tiles.length; i++) {
      var pt = ER.spritePartOf(tiles[i]);
      if (pt >= 0) parts.push(pt);
    }
    if (!parts.length) return null;
    var count = e.count === undefined ? 1 : (e.count | 0);
    var dmg = e.damage | 0;
    return {
      parts: parts,
      layer: ER.spriteLayerOf(tiles[0]),
      copies: ER.pileOffsets(idx, dmg, count, false, ER.GROUND_SPRITE.scale)
    };
  };

  /**
   * D-449 (session 60, QUEUE row 0 item 4) — THE LIVE ARROW, DRAWN.
   *
   * ⚠ THIS IS A NAMED "RENDERING MAY BE CHEAP" SUBSTITUTION, NOT A NEW TEXTURE EXTRACTION.
   * Vanilla's real `ArrowRenderer` samples a dedicated in-flight texture
   * (`textures/entity/projectiles/arrow.png`, confirmed 32x32 in the 1.18.2 jar) on a small
   * hand-built quad model, which this engine has never extracted (no bytecode reader for
   * `ArrowRenderer`'s own quad geometry exists in `tools/`, and `javap` is not installed in
   * this session's sandbox — JRE-only, no sudo to add a JDK — so the extractor pattern
   * `extract-handrender.mjs` uses could not be run here). Rather than invent quad coordinates
   * from memory (rule 3), this reuses the ALREADY-BAKED, ALREADY-VERIFIED `item/arrow` sprite
   * tile — the same real jar icon a dropped arrow item already draws with (`mobtexcheck`'s
   * sibling pipeline, `pack-items.mjs`) — as an extruded billboard oriented along the arrow's
   * own live velocity instead of vanilla's dedicated shaft texture. The governing rule
   * explicitly allows rendering to be cheap with a named ruling; this is that ruling, named:
   * a flying arrow shows the real vanilla arrow icon, correctly oriented and moving, instead
   * of vanilla's own thinner in-flight silhouette. loop/bow: `spectral_arrow` now gets this
   * SAME treatment, off its own real `item/spectral_arrow` tile (`ER.arrowTile(type)` below).
   */
  // loop/bow -- keyed by TYPE, not a single cache, since `spectral_arrow` reuses this exact
  // shape with its own real jar tile ('item/spectral_arrow', confirmed present in
  // `D.itemTileMap()` the same pipeline baked 'item/arrow' from) rather than a second file.
  ER._arrowTiles = {};
  ER.arrowTile = function (type) {
    var key = type === 'spectral_arrow' ? 'spectral_arrow' : 'arrow';
    if (ER._arrowTiles[key] === undefined) {
      var D = NS.DATA;
      var m = D && D.itemTileMap ? D.itemTileMap() : null;
      var name = key === 'spectral_arrow' ? 'item/spectral_arrow' : 'item/arrow';
      ER._arrowTiles[key] = (m && m[name] !== undefined) ? m[name] : -1;
    }
    return ER._arrowTiles[key];
  };
  ER.arrowSpritesFor = function (type) {
    var tile = ER.arrowTile(type);
    if (tile < 0) return null;
    var part = ER.spritePartOf(tile);
    if (part < 0) return null;
    return { parts: [part], layer: ER.spriteLayerOf(tile), copies: [[0, 0, 0]] };
  };
  /**
   * The heading/pitch a live arrow points, off its OWN current velocity — the same
   * `atan2(dx, -dz)` heading convention `Ai.RangedBowAttackGoal` already uses for a mob's own
   * yaw (`07k_goals.js`), so "forward" means the same thing in both files.
   */
  ER.arrowYaw = function (e) {
    // loop/arrows -- a STUCK arrow has zero velocity (`Cb.embedArrow`, 14j_combat.js), so the
    // live formula below would flatten it to yaw 0 the instant it landed; that file freezes the
    // real impact heading into `e.stuckYaw`/`e.stuckPitch` once, read back here instead.
    if (e.stuck && e.stuckYaw !== undefined) return e.stuckYaw;
    var vx = e.vx || 0, vz = e.vz || 0;
    return (vx || vz) ? Math.atan2(vx, -vz) : (e.yaw || 0);
  };
  ER.arrowPitch = function (e) {
    if (e.stuck && e.stuckPitch !== undefined) return e.stuckPitch;
    var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
    var h = Math.hypot(vx, vz);
    return (h || vy) ? Math.atan2(vy, h) : 0;
  };
  /**
   * A general yaw-then-pitch 3x3, scaled — `Ry(yaw)` composed with `Rx(pitch)`, in the same
   * row-major layout `ER.itemMatrix`'s own `Ry`-only matrix already feeds `ER.emitPart`. Shared
   * by the arrow (pitch = its own flight angle) and the drawn bow (pitch reused as a fixed
   * "idle vs. raised" tilt — see `ER.bowSpritesFor`).
   */
  ER.arrowMatrix = function (yaw, pitch, scale) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [
      cy * scale, 0, sy * scale,
      sp * sy * scale, cp * scale, -sp * cy * scale,
      -cp * sy * scale, sp * scale, cp * cy * scale
    ];
  };
  ER.ARROW_SCALE = 0.65;   // a named stand-in size, not a jar-measured one — see the header above

  /**
   * D-449 — THE BOW IN A DRAWING SKELETON'S HAND, plus the pull-frame texture.
   *
   * ⚠ WHAT IS REAL JAR DATA HERE. Three things, and only three:
   *   1. The pull-frame TEXTURES AND THEIR THRESHOLDS: `assets/minecraft/models/item/bow.json`,
   *      read directly out of the 1.18.2 jar (a resource file, not bytecode) — `pulling: 1`
   *      alone selects `item/bow_pulling_0`, `+ pull: 0.65` selects `item/bow_pulling_1`,
   *      `+ pull: 0.9` selects `item/bow_pulling_2`. `0.65`/`0.9` below are those two numbers,
   *      not a guess.
   *   2. The skeleton's own `right_arm` PIVOT (`tools/golden/models-1.18.2.tsv`, bytecode-
   *      extracted): `pivotX=-5, pivotY=2` (in Minecraft's own 1/16-block model units), and the
   *      arm box itself is `h=12` units long — the shoulder attachment point and arm length
   *      used below to place the hand are the jar's own numbers, divided by 16 into blocks.
   *   3. `bow.json`'s `thirdperson_righthand.scale` (0.9) — used as `ER.BOW_SCALE`.
   * ⚠ WHAT IS NOT. The arm's DRAW ROTATION (`rightArm.xRot = -PI/2 + head.xRot` when
   * `ArmPose.BOW_AND_ARROW`) is `HumanoidModel.setupAnim`'s own bytecode; this session could
   * not `javap` the class to re-walk it (same missing-JDK blocker as the arrow's own header
   * comment), so the constant below is transcribed from public MCP/Yarn-mapped decompiles —
   * the SAME discipline (and the same caveat) `Ai.RANGED_ATTACK_RADIUS`/`Cb.ARROW_SHOOT_SPEED`
   * already carry (D-396/D-402). Nor is `bow.json`'s own `thirdperson_righthand` ROTATION
   * triple (`-80, 260, -40`) applied as an exact three-axis matrix — composing it correctly
   * without a live screen to check the sign/order against was judged more likely to ship a
   * confidently-wrong pose than the simpler yaw-facing + arm-swing this file actually draws;
   * the real triple is recorded here so whoever wires the full transform does not re-derive
   * it: `rotation:[-80,260,-40] translation:[-1,-2,2.5] scale:[0.9,0.9,0.9]` off
   * `assets/minecraft/models/item/bow.json`'s `thirdperson_righthand` block. And the
   * ATTACHMENT itself is a fixed offset from the body rotated by the mob's own yaw, not a
   * chain through `ER.emitMobLayer`'s per-part pose matrices — a real vanilla client parents
   * the held item to the ARM's own rotated space. Both simplifications are the "rendering may
   * be cheap" ruling again, named rather than silent.
   */
  ER.SKELETON_ARM_PIVOT = [-5 / 16, 2 / 16, 0];   // right_arm pivot, models-1.18.2.tsv, /16 into blocks
  ER.SKELETON_ARM_LEN = 12 / 16;                  // right_arm box height (h=12), /16 into blocks
  ER.BOW_DRAW_XROT = -Math.PI / 2;                // HumanoidModel.BOW_AND_ARROW's own rightArm.xRot term — transcribed, not bytecode-verified this session
  ER.BOW_SCALE = 0.9;                             // bow.json thirdperson_righthand.scale — real jar resource data
  ER.BOW_PULL_1 = 0.65;                           // bow.json overrides — real jar resource data
  ER.BOW_PULL_2 = 0.9;                            // bow.json overrides — real jar resource data
  ER.bowTileName = function (charge, drawing) {
    if (!drawing) return 'item/bow';
    var c = charge || 0;
    return c >= ER.BOW_PULL_2 ? 'item/bow_pulling_2' : (c >= ER.BOW_PULL_1 ? 'item/bow_pulling_1' : 'item/bow_pulling_0');
  };
  /** The X of the arm that holds the MAIN hand (D-675): right_arm's pivot, mirrored for a left-handed mob. */
  ER.mainArmPivotX = function (e) {
    return e && e.leftHanded ? -ER.SKELETON_ARM_PIVOT[0] : ER.SKELETON_ARM_PIVOT[0];
  };
  ER.bowTile = function (e) {
    var m = NS.DATA && NS.DATA.itemTileMap ? NS.DATA.itemTileMap() : null;
    if (!m) return -1;
    var name = ER.bowTileName(e.bowCharge, !!e.bowDrawing);
    return m[name] !== undefined ? m[name] : m['item/bow'];
  };
  /** The bow in a bow-user's hand: HeldItemFeatureRenderer's chain through the POSED arm bone (ER.heldItemsFor, bowOnly). */
  ER.bowSpritesFor = function (e, px, py, pz, partial) {
    var t = ER.bowTile(e);
    if (t === undefined || t < 0) return null;
    var r = ER.heldItemsFor(e, ER.mobLayerFor(e.type), px, py, pz, partial, true);
    return r.length ? r[0] : null;
  };

  /**
   * s134 -- `HeldItemFeatureRenderer` (.decomp feature/HeldItemFeatureRenderer.java, read whole) for
   * the BipedEntityModel mobs (ER.BIPED_SWING): per hand, in the model's own (flipped) space —
   *   [baby: translate(0, 0.75, 0), scale 0.5] · arm.rotate (pivot/16, Rz·Ry·Rx of the POSED arm) ·
   *   rotX(-90°) · rotY(180°) · translate(±1/16, 0.125, -0.625) · the item model's
   *   thirdperson_{right,left}hand (Transformation.apply: translate(±t/16), Quaternion(x, ±y, ±z) =
   *   Rx·Ry·Rz, scale) · translate(-0.5, -0.5, -0.5).
   * The MAIN hand goes on getMainArm() (left when LeftHanded), the offhand on the other; a left arm
   * uses the left-hand mode (the mirrored right-hand transform when the model has no lefthand one).
   * Then the same flip/lift/yaw/scale emitMobLayer gives every box, so the item rides the arm.
   * The skeleton's drawn BOW keeps ER.bowSpritesFor (its pull frames); block items are ER.HELD_OWED.
   */
  ER.HELD_OWED = [];   // #6734: player/player_slim now ride the held-item path
  function m3mul(A, B) {
    var C = new Array(9);
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return C;
  }
  function m3v(A, v) { return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]]; }
  function rX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rZ(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  /** An affine {R, t}; `ER.affineThen(A, B)` = A·B (B applied first, the MatrixStack's own order). */
  ER.affineThen = function (A, B) { var tb = m3v(A.R, B.t); return { R: m3mul(A.R, B.R), t: [A.t[0] + tb[0], A.t[1] + tb[1], A.t[2] + tb[2]] }; };
  function aff(R, t) { return { R: R || [1, 0, 0, 0, 1, 0, 0, 0, 1], t: t || [0, 0, 0] }; }

  /**
   * G17-HG8 (#5708): ItemFrameEntityRenderer.render's matrix chain for the HELD item, as an affine
   * (R row-major 3x3, t), frame-local -> world offset from the entity position. facing is
   * Hanging's horizontal index (0 S, 1 W, 2 N, 3 E; yaw = facing*90), rotation 0..7 is
   * ItemRotation (45 degrees per step, `rotation * 360 / 8`); a map keeps rotation%4*2.
   * Chain (.decomp ItemFrameEntityRenderer): translate(-(0.3*fx, -0.25, 0.3*fz)); translate(f*0.46875);
   * Rx(pitch 0); Ry(180-yaw); translate z 0.4375 (0.5 invisible); Rz(rot*360/8); scale 0.5.
   * The frame MODEL itself is the block state of the same name, drawn on the mushroom path in ER.build.
   */
  ER.FRAME_DX = [0, -1, 0, 1]; ER.FRAME_DZ = [1, 0, -1, 0];
  ER.ITEM_FRAME_STEP = 360 / 8;
  ER.itemFrameItemAffine = function (facing, rotation, invisible, isMap, step) {
    var fx = ER.FRAME_DX[facing & 3], fz = ER.FRAME_DZ[facing & 3], d = Math.PI / 180;
    var rot = isMap ? (rotation % 4) * 2 : rotation;
    var A = aff(null, [-Math.fround(fx * 0.3), 0.25, -Math.fround(fz * 0.3)]);
    A = ER.affineThen(A, aff(null, [fx * 0.46875, 0, fz * 0.46875]));
    A = ER.affineThen(A, aff(rY(Math.fround((180 - facing * 90) * d))));
    A = ER.affineThen(A, aff(null, [0, 0, invisible ? 0.5 : 0.4375]));
    A = ER.affineThen(A, aff(rZ(Math.fround(rot * (step || ER.ITEM_FRAME_STEP) * d))));
    return ER.affineThen(A, aff([0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]));
  };
  /** Light for the held item/frame: glow frame item light is the constant 15728880 (0xF000F0). */
  ER.GLOW_FRAME_BLOCK_LIGHT = 5;
  ER.itemFrameBlockLight = function (type, blk) { return type === 'glow_item_frame' ? Math.max(5, blk | 0) : blk | 0; };
  ER.itemFrameItemLight = function (type, packed) { return type === 'glow_item_frame' ? 15728880 : packed; };
  /** The model-space (blocks, after the base flip) affine of one held item, v in [0,1]^3 -> model. */
  ER.heldItemAffine = function (armPosed, left, xf, baby) {
    var M = aff();
    if (baby) M = ER.affineThen(ER.affineThen(M, aff(null, [0, 0.75, 0])), aff([0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]));
    M = ER.affineThen(M, aff(m3mul(m3mul(rZ(armPosed.rz), rY(armPosed.ry)), rX(armPosed.rx)), [armPosed.px / 16, armPosed.py / 16, armPosed.pz / 16]));
    M = ER.affineThen(M, aff(rX(-Math.PI / 2)));
    M = ER.affineThen(M, aff(rY(Math.PI)));
    M = ER.affineThen(M, aff(null, [(left ? -1 : 1) / 16, 0.125, -0.625]));
    if (xf) {
      var D2R = Math.PI / 180, i = left ? -1 : 1;
      var ry = left ? -xf[1] : xf[1], rz = left ? -xf[2] : xf[2];
      M = ER.affineThen(M, aff(null, [i * xf[3] / 16, xf[4] / 16, xf[5] / 16]));
      M = ER.affineThen(M, aff(m3mul(m3mul(rX(xf[0] * D2R), rY(ry * D2R)), rZ(rz * D2R))));
      M = ER.affineThen(M, aff([xf[6], 0, 0, 0, xf[7], 0, 0, 0, xf[8]]));
    }
    return M;   // the trailing translate(-0.5) is emitPart's own centre pivot
  };
  /**
   * #723 -- `SnowmanPumpkinFeatureRenderer.render` (.decomp): head.rotate, translate(0,-0.34375,0), rotY 180,
   * scale(.625,-.625,-.625), then the carved_pumpkin item (HEAD mode: block/block declares no `head` display,
   * so identity). Same model -> world map `ER.heldItemsFor` uses; the block is drawn through `ER.emit`'s `m`.
   */
  ER.snowPumpkinFor = function (e, mobLayer, px, py, pz, partial) {
    return ER.headBlockFor(e, mobLayer, px, py, pz, partial, 'carved_pumpkin', -0.34375, false, false);
  };
  /**
   * G18a-HD1 -- `HeadFeatureRenderer.render` + `translate` (.decomp) for a BLOCK item worn on the head:
   * [baby non-villager: translate(0,.03125,0) scale(.7) translate(0,1,0)] head.rotate, translate(0,-0.25,0),
   * rotY 180, scale(.625,-.625,-.625), [villager/zombie villager: translate(0,.1875,0)]. `dy` is the first
   * translate (-0.25 here, -0.34375 for the snow golem). Skull items need a full matrix the `beworld` path
   * cannot carry and are not drawn here.
   */
  ER.headFeatureMatrix = function (posed, dy, villager, baby) {
    var M = aff();
    if (baby) {
      M = ER.affineThen(M, aff(null, [0, 0.03125, 0]));
      M = ER.affineThen(M, aff([0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7]));
      M = ER.affineThen(M, aff(null, [0, 1, 0]));
    }
    M = ER.affineThen(M, aff(m3mul(m3mul(rZ(posed.rz), rY(posed.ry)), rX(posed.rx)), [posed.px / 16, posed.py / 16, posed.pz / 16]));
    M = ER.affineThen(M, aff(null, [0, dy, 0]));
    M = ER.affineThen(M, aff(rY(Math.PI)));
    M = ER.affineThen(M, aff([0.625, 0, 0, 0, -0.625, 0, 0, 0, -0.625]));
    if (villager) M = ER.affineThen(M, aff(null, [0, 0.1875, 0]));
    return M;
  };
  /** The item worn on the head of `e` as a block, or null (empty slot, head armour, skull, non-block item). */
  ER.headBlockFor = function (e, mobLayer, px, py, pz, partial, forceName, dy, villager, baby) {
    var BE = NS.BEModel, S = NS.States, IT = NS.Items;
    if (!BE || !BE.ready || !S || !S.stateOf) return null;
    var st;
    if (forceName) st = S.stateOf(forceName) | 0;
    else {
      var h = e.equip && IT && IT.HEAD !== undefined ? e.equip[IT.HEAD] : null;
      if (!h || !(h.i >= 0) || (IT.isArmor(h.i) && IT.equipSlot(h.i) === IT.HEAD)) return null;
      if (ER.SKULL_BLOCKS[IT.nameOf(h.i)]) return null;
      st = IT.stateOf(h.i) | 0;
      var t = e.type;
      villager = t === 'villager' || t === 'zombie_villager' || t === 'witch' || t === 'pillager' || t === 'evoker' || t === 'vindicator' || t === 'illusioner';
      baby = !!(e.isBaby || e.baby) && t !== 'villager';
      dy = -0.25;
    }
    if (!(st > 0)) return null;
    var L = BE.layer(mobLayer);
    if (!L) return null;
    var head = null;
    for (var k = 0; k < L.parts.length; k++) if (L.parts[k].n === 'head') { head = L.parts[k]; break; }
    if (!head) return null;
    var posed = ER.posedPart(head, ER.animOf(e, partial), mobLayer);
    var M = ER.headFeatureMatrix(posed, dy, villager, baby);
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, M.t);
    return { e: e, state: st, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2], shape: 'arrow',
             layer: ER.layerOf(st), sprites: null, copies: null, flatSprite: false, mobLayer: null,
             m: m3mul(B, M.R), pumpkin: true };
  };
  /**
   * G18a-HD1 -- `HeadFeatureRenderer.render`'s SKULL branch (.decomp): head.rotate, scale(1.1875,-1.1875,-1.1875),
   * [villager: translate(0,.0625,0)], translate(-.5,0,-.5), renderSkull(null, 180): translate(.5,0,.5),
   * scale(-1,-1,1), head.yaw = 180. Inside the entity renderer's own (-1,-1,1) frame the two Ry(180)s cancel, so
   * the skull model is drawn exactly like a skull block at yaw 0 on the head pivot, scaled 1.1875 (the dragon's
   * own 0.75 on top), as a `beworld` item. Head yaw is carried; head pitch/roll are owed (the path has no pitch).
   */
  ER.headSkullFor = function (e, mobLayer, px, py, pz, partial) {
    var BE = NS.BEModel, IT = NS.Items;
    if (!BE || !BE.ready || !IT || !e.equip || IT.HEAD === undefined) return null;
    var h = e.equip[IT.HEAD];
    if (!h || !(h.i >= 0)) return null;
    var rule = ER.SKULL_BLOCKS[IT.nameOf(h.i)];
    if (!rule || rule[1]) return null;
    var layer = rule[0], dragon = layer === 'dragon_head';
    var L = BE.layer(mobLayer);
    if (!L || !BE.layer(layer)) return null;
    var head = null;
    for (var k = 0; k < L.parts.length; k++) if (L.parts[k].n === 'head') { head = L.parts[k]; break; }
    if (!head) return null;
    var t = e.type, villager = t === 'villager' || t === 'zombie_villager';
    var baby = !!(e.isBaby || e.baby) && t !== 'villager';
    var posed = ER.posedPart(head, ER.animOf(e, partial), mobLayer);
    var M = aff();
    if (baby) {
      M = ER.affineThen(M, aff(null, [0, 0.03125, 0]));
      M = ER.affineThen(M, aff([0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7]));
      M = ER.affineThen(M, aff(null, [0, 1, 0]));
    }
    M = ER.affineThen(M, aff(null, [posed.px / 16, posed.py / 16, posed.pz / 16]));
    if (villager) M = ER.affineThen(M, aff(null, [0, -0.0625 * 1.1875, 0]));
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, M.t);
    var k2 = baby ? 0.7 : 1;
    return { e: e, state: 0, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2], shape: 'beworld',
             layer: CFG.LAYER_OPAQUE, sprites: null, copies: null, flatSprite: false,
             mobLayer: layer, beYaw: ER.dragonYaw(e, partial) + ER.SKULL_YAW_SIGN * posed.ry, beOpen: 0, texKey: null,
             beRaw: true, beBase: dragon ? ER.SKULL_DRAGON_BASE : ER.BASE_MIRROR,
             beScale: { sxz: 1.1875 * k2 * sc * (dragon ? 0.75 : 1), sy: 1.1875 * k2 * sc * (dragon ? 0.75 : 1) },
             beHide: null, beAnim: null, conduitKey: null, headSkull: true };
  };
  /**
   * #720 -- DolphinHeldItemFeatureRenderer (.decomp): translate(0, 1 - a*0.5, -1 + a*0.5) for a
   * nose-up pitch (pitch < 0), else (0, 1 + a*0.8, -1 + a*0.2), a = |pitch|/60, then the main-hand
   * (off-hand for a left-handed mob) stack in ModelTransformation.Mode.field_4318 = GROUND
   * (enum order NONE, TP_LEFT, TP_RIGHT, FP_LEFT, FP_RIGHT, HEAD, GUI, GROUND, FIXED). No arm
   * compensation: the item stays in the renderer's flipped (-1,-1,1) frame. A sprite's ground
   * transform is `ER.GROUND_SPRITE` (translate y 2/16, scale 0.5).
   */
  ER.dolphinHeldItems = function (e, mobLayer, px, py, pz, partial) {
    var out = [], IT = NS.Items, Eq = NS.Equip;
    var st = Eq.getEquipped(e, e.leftHanded ? IT.OFFHAND : IT.MAINHAND);
    if (!st || !(st.i >= 0)) return out;
    var tiles = ER.itemLayers(st.i);
    if (!tiles || !tiles.length) return out;
    var parts = [];
    for (var ti = 0; ti < tiles.length; ti++) { var sp = ER.spritePartOf(tiles[ti]); if (sp >= 0) parts.push(sp); }
    if (!parts.length) return out;
    var anim = ER.animOf(e, partial), pitch = anim.headPitch;
    var a = Math.abs(pitch) / 60, G = ER.GROUND_SPRITE;
    var fy = pitch < 0 ? 1 - a * 0.5 : 1 + a * 0.8, fz = pitch < 0 ? -1 + a * 0.5 : -1 + a * 0.2;
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, [0, fy + G.ty, fz]);
    out.push({ e: e, state: 0, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2], shape: 'arrow',
               layer: ER.spriteLayerOf(tiles[0]), sprites: parts, copies: [[0, 0, 0]], flatSprite: true,
               mobLayer: null, m: m3mul(B, [G.scale, 0, 0, 0, G.scale, 0, 0, 0, G.scale]), held: true });
    return out;
  };
  /**
   * #1136 -- PandaHeldItemFeatureRenderer.render (.decomp, read whole): only while isSitting() and not
   * isScaredByThunderstorm(), translate(0.1, 1.4, -0.6) (eating: z -= 0.2*sin(age*0.6)+0.2, y -= 0.09*sin(age*0.6)),
   * then the MAIN-hand stack in GROUND mode. Same renderer frame as the dolphin's mouth item (no arm compensation).
   */
  ER.pandaHeldItems = function (e, mobLayer, px, py, pz, partial) {
    var out = [], IT = NS.Items, Eq = NS.Equip;
    if (!e.sitting || e.scaredByThunderstorm) return out;
    var st = Eq.getEquipped(e, IT.MAINHAND);
    if (!st || !(st.i >= 0)) return out;
    var tiles = ER.itemLayers(st.i);
    if (!tiles || !tiles.length) return out;
    var parts = [];
    for (var ti = 0; ti < tiles.length; ti++) { var sp = ER.spritePartOf(tiles[ti]); if (sp >= 0) parts.push(sp); }
    if (!parts.length) return out;
    var fy = 1.4, fz = -0.6;
    if (e.eating) {
      var sn = Math.sin(((e.age || 0) + partial) * 0.6);
      fz -= 0.2 * sn + 0.2; fy -= 0.09 * sn;
    }
    var G = ER.GROUND_SPRITE;
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, [0.1, fy + G.ty, fz]);
    out.push({ e: e, state: 0, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2], shape: 'arrow',
               layer: ER.spriteLayerOf(tiles[0]), sprites: parts, copies: [[0, 0, 0]], flatSprite: true,
               mobLayer: null, m: m3mul(B, [G.scale, 0, 0, 0, G.scale, 0, 0, 0, G.scale]), held: true });
    return out;
  };
  /**
   * #1327 -- FoxHeldItemFeatureRenderer.render (.decomp, read whole): the MAIN-hand stack in GROUND mode at the mouth.
   * Baby: scale .75, translate(0,.5,.209375). Then head pivot/16 (the posed pivot, so the sleeping offset rides),
   * rotZ headRoll, rotY netHeadYaw, rotX headPitch, translate (.06,.27,-.5) [baby .06,.26,-.5; sleeping .46,.26,.22
   * / baby .4,.26,.15], rotX 90, and rotZ 90 while sleeping. Model -> world map is `ER.witchHeldItems`'s.
   */
  ER.foxHeldItems = function (e, mobLayer, px, py, pz, partial) {
    var out = [], IT = NS.Items, Eq = NS.Equip, BE = NS.BEModel;
    var st = Eq.getEquipped(e, IT.MAINHAND);
    if (!st || !(st.i >= 0)) return out;
    var tiles = ER.itemLayers(st.i);
    if (!tiles || !tiles.length) return out;
    var parts = [];
    for (var ti = 0; ti < tiles.length; ti++) { var sp = ER.spritePartOf(tiles[ti]); if (sp >= 0) parts.push(sp); }
    if (!parts.length) return out;
    var L = BE.layer(mobLayer), head = null;
    if (!L) return out;
    for (var k = 0; k < L.parts.length; k++) if (L.parts[k].n === 'head') { head = L.parts[k]; break; }
    if (!head) return out;
    var G = ER.GROUND_SPRITE, D2R = Math.PI / 180;
    var anim = ER.animOf(e, partial), ph = ER.posedPart(head, anim, mobLayer);
    var baby = !!anim.baby, sleeping = !!e.sleeping, M = aff();
    if (baby) {
      M = ER.affineThen(M, aff([0.75, 0, 0, 0, 0.75, 0, 0, 0, 0.75]));
      M = ER.affineThen(M, aff(null, [0, 0.5, 0.209375]));
    }
    M = ER.affineThen(M, aff(null, [ph.px / 16, ph.py / 16, ph.pz / 16]));
    M = ER.affineThen(M, aff(m3mul(m3mul(rZ(anim.fox ? anim.fox.headRoll : 0), rY((anim.netHeadYaw || 0) * D2R)), rX((anim.headPitch || 0) * D2R))));
    M = ER.affineThen(M, aff(null, baby ? (sleeping ? [0.4, 0.26, 0.15] : [0.06, 0.26, -0.5])
                                        : (sleeping ? [0.46, 0.26, 0.22] : [0.06, 0.27, -0.5])));
    M = ER.affineThen(M, aff(rX(90 * D2R)));
    if (sleeping) M = ER.affineThen(M, aff(rZ(90 * D2R)));
    M = ER.affineThen(M, aff(null, [0, G.ty, 0]));
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, M.t);
    out.push({ e: e, state: 0, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2], shape: 'arrow',
               layer: ER.spriteLayerOf(tiles[0]), sprites: parts, copies: [[0, 0, 0]], flatSprite: true,
               mobLayer: null, m: m3mul(B, m3mul(M.R, [G.scale, 0, 0, 0, G.scale, 0, 0, 0, G.scale])), held: true });
    return out;
  };
  /**
   * #1282 -- WitchHeldItemFeatureRenderer (VillagerHeldItemFeatureRenderer super, .decomp read whole): translate(0,0.4,-0.4),
   * rotX 180, main-hand stack in GROUND mode; a POTION first goes head.rotate, nose.rotate, translate(0.0625,0.25,0),
   * rotZ 180, rotX 140, rotZ 10, translate(0,-0.4,0.4). Model -> world map is `ER.snowPumpkinFor`'s.
   */
  ER.witchHeldItems = function (e, mobLayer, px, py, pz, partial) {
    var out = [], IT = NS.Items, Eq = NS.Equip, BE = NS.BEModel;
    var st = Eq.getEquipped(e, IT.MAINHAND);
    if (!st || !(st.i >= 0)) return out;
    var tiles = ER.itemLayers(st.i);
    if (!tiles || !tiles.length) return out;
    var parts = [];
    for (var ti = 0; ti < tiles.length; ti++) { var sp = ER.spritePartOf(tiles[ti]); if (sp >= 0) parts.push(sp); }
    if (!parts.length) return out;
    var G = ER.GROUND_SPRITE, D2R = Math.PI / 180;
    var M = aff();
    if (IT.nameOf(st.i) === 'potion' && String(mobLayer).split('#')[0] === 'witch') {   // only the witch subclass tilts the potion to the nose
      var L = BE.layer(mobLayer), head = null, nose = null;
      if (!L) return out;
      for (var k = 0; k < L.parts.length; k++) { if (L.parts[k].n === 'head') head = L.parts[k]; else if (L.parts[k].n === 'nose') nose = L.parts[k]; }
      if (!head || !nose) return out;
      var anim = ER.animOf(e, partial);
      var ph = ER.posedPart(head, anim, mobLayer), pn = ER.posedPart(nose, anim, mobLayer);
      M = ER.affineThen(M, aff(m3mul(m3mul(rZ(ph.rz), rY(ph.ry)), rX(ph.rx)), [ph.px / 16, ph.py / 16, ph.pz / 16]));
      M = ER.affineThen(M, aff(m3mul(m3mul(rZ(pn.rz), rY(pn.ry)), rX(pn.rx)), [pn.px / 16, pn.py / 16, pn.pz / 16]));
      M = ER.affineThen(M, aff(null, [0.0625, 0.25, 0]));
      M = ER.affineThen(M, aff(rZ(Math.PI)));
      M = ER.affineThen(M, aff(rX(140 * D2R)));
      M = ER.affineThen(M, aff(rZ(10 * D2R)));
      M = ER.affineThen(M, aff(null, [0, -0.4, 0.4]));
    } else {
      M = ER.affineThen(M, aff(null, [0, 0.4, -0.4]));
      M = ER.affineThen(M, aff(rX(Math.PI)));
    }
    M = ER.affineThen(M, aff(null, [0, G.ty, 0]));
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw);
    var sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, M.t);
    out.push({ e: e, state: 0, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2], shape: 'arrow',
               layer: ER.spriteLayerOf(tiles[0]), sprites: parts, copies: [[0, 0, 0]], flatSprite: true,
               mobLayer: null, m: m3mul(B, m3mul(M.R, [G.scale, 0, 0, 0, G.scale, 0, 0, 0, G.scale])), held: true });
    return out;
  };
  /** ItemStack.hasGlint: Enchantments / StoredEnchantments, or an always-glowing item (same rule as the GUI slot glint). */
  ER.stackHasGlint = function (st) {
    if (!st || !(st.i >= 0)) return false;
    var t = st.t;
    if (t && ((t.Enchantments && t.Enchantments.length) || (t.StoredEnchantments && t.StoredEnchantments.length))) return true;
    var n = NS.Items && NS.Items.nameOf(st.i);
    return n === 'enchanted_book' || n === 'enchanted_golden_apple' || n === 'nether_star' || n === 'experience_bottle' || n === 'end_crystal';
  };
  ER.heldItemsFor = function (e, mobLayer, px, py, pz, partial, bowOnly) {
    var out = [], IT = NS.Items, Eq = NS.Equip, BE = NS.BEModel;
    if (!e || !mobLayer || !IT || !IT.ready || !Eq || !Eq.getEquipped || !BE || !BE.ready) return out;
    var base = String(mobLayer).split('#')[0];
    if (base === 'dolphin') return ER.dolphinHeldItems(e, mobLayer, px, py, pz, partial);
    if (base === 'panda') return ER.pandaHeldItems(e, mobLayer, px, py, pz, partial);
    if (base === 'witch' || base === 'villager' || base === 'wandering_trader') return ER.witchHeldItems(e, mobLayer, px, py, pz, partial);
    if (base === 'fox') return ER.foxHeldItems(e, mobLayer, px, py, pz, partial);
    var illa = ER.ILLAGERS[base] ? ER.illagerStateOf(e) : null;
    // IllagerEntityRenderer's held-item features: pillager always; vindicator attacking; evoker spellcasting; illusioner both.
    if (illa && !(base === 'pillager' || (base === 'vindicator' && e.attacking) || (base === 'evoker' && illa === 'SPELLCASTING') ||
                  (base === 'illusioner' && (illa === 'SPELLCASTING' || e.attacking)))) return out;
    if (!illa && !ER.BIPED_SWING[base]) return out;
    var L = BE.layer(mobLayer);
    if (!L) return out;
    var anim = null;
    var hands = [{ slot: IT.MAINHAND, left: !!e.leftHanded }, { slot: IT.OFFHAND, left: !e.leftHanded }];
    for (var h = 0; h < 2; h++) {
      var st = Eq.getEquipped(e, hands[h].slot);
      if (!st || !(st.i >= 0)) continue;
      var nm = IT.nameOf(st.i);
      var isBow = nm === 'bow' && e.bowDrawing !== undefined;
      if (isBow !== !!bowOnly) continue;   // ER.bowSpritesFor draws a bow-user's bow (bowOnly), through this same arm chain
      var tiles = isBow ? [ER.bowTile(e)] : ER.itemLayers(st.i), bst = 0;
      var bePart = -1;
      if (!tiles || !tiles.length) {
        bePart = ER.bePartOf(ER.beIndexOf(st.i));   // #5915: a block-ENTITY item (chest has a state too) draws its baked BE part
        if (bePart < 0) { bst = IT.stateOf(st.i); if (!(bst > 0)) continue; }
        tiles = [0];   // a block item: its block model
      }
      var parts = [];
      for (var ti = 0; !bst && bePart < 0 && ti < tiles.length; ti++) { var sp = ER.spritePartOf(tiles[ti]); if (sp >= 0) parts.push(sp); }
      if (!bst && bePart < 0 && !parts.length) continue;
      var armName = hands[h].left ? 'left_arm' : 'right_arm', arm = null;
      for (var k = 0; k < L.parts.length; k++) if (L.parts[k].n === armName) { arm = L.parts[k]; break; }
      if (!arm) continue;
      if (!anim) anim = ER.animOf(e, partial);
      var posed = ER.posedPart(arm, anim, mobLayer);
      var xf = IT.thirdPersonTransform ? IT.thirdPersonTransform(st.i) : null;
      var A = ER.heldItemAffine(posed, hands[h].left, xf, !!anim.baby);
      // emitMobLayer's own model -> world map: flip x/y (bs = -1), yaw, the renderer scale, the lift
      // #5725 -- the held item rides the body pose (setupTransforms runs before the feature layers): the Dinnerbone
      // base pose, and the sleeping/death pose matrix + offsets in place of the plain yaw (as emitMobLayer does)
      var bp = ER.shouldFlipUpsideDown(e, mobLayer) ? ER.dinnerbonePoseFor(e.height) : ER.basePoseFor(mobLayer);
      var bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
      var sp0 = anim.sleepPose, yaw = ER.bodyYawAt(e, partial);
      var RP = sp0 ? sp0.R : rY(yaw);
      var sc = ER.renderScaleOf(e) || 1;
      var B = m3mul([bs * sc, 0, 0, 0, bs * sc, 0, 0, 0, sc], RP);
      var o = m3v(B, A.t);
      var qx = px + (sp0 ? sp0.dx : 0), qy = py + (sp0 && sp0.dy || 0), qz = pz + (sp0 ? sp0.dz : 0);
      if (bst) {
        out.push({ e: e, state: bst, x: qx + o[0], y: qy + (bp.yOffsetFixed || 0) / U * sc + o[1], z: qz + o[2], shape: 'arrow',
                   layer: ER.layerOf(bst), sprites: null, copies: null, flatSprite: false,
                   mobLayer: null, m: m3mul(B, A.R), held: true, heldBlock: true });
        continue;
      }
      if (bePart >= 0) {
        out.push({ e: e, state: 0, x: qx + o[0], y: qy + (bp.yOffsetFixed || 0) / U * sc + o[1], z: qz + o[2], shape: 'arrow',
                   layer: CFG.LAYER_OPAQUE, sprites: [bePart], copies: [[0, 0, 0]], flatSprite: false,
                   mobLayer: null, m: m3mul(B, A.R), held: true, heldBE: true });
        continue;
      }
      out.push({ e: e, state: 0, x: qx + o[0], y: qy + (bp.yOffsetFixed || 0) / U * sc + o[1], z: qz + o[2], shape: 'arrow',
                 layer: ER.spriteLayerOf(tiles[0]), sprites: parts, copies: [[0, 0, 0]], flatSprite: true,
                 mobLayer: null, m: m3mul(B, A.R), held: true, glint: ER.stackHasGlint(st) ? 'item' : null });
    }
    return out;
  };

  /**
   * #733 -- `IronGolemFlowerFeatureRenderer.render` (.decomp, read whole): when getLookingAtVillagerTicks() != 0,
   * in the right arm's frame (arm.rotate) translate(-1.1875, 1.0625, -0.9375), translate(.5), scale .5,
   * rotX(-90deg), translate(-.5): a Blocks.POPPY block. The trailing translate is `emitPart`'s own centre
   * pivot; the model -> world map is the one `ER.heldItemsFor` uses.
   */
  ER.ironGolemFlowerFor = function (e, mobLayer, px, py, pz, partial) {
    var BE = NS.BEModel, L = BE && BE.ready ? BE.layer(mobLayer) : null, arm = null;
    if (!L || !NS.States || !NS.States.stateOf) return null;
    for (var k = 0; k < L.parts.length; k++) if (L.parts[k].n === 'right_arm') { arm = L.parts[k]; break; }
    var state = NS.States.stateOf('poppy') | 0;
    if (!arm || !state) return null;
    var anim = ER.animOf(e, partial), posed = ER.posedPart(arm, anim, mobLayer);
    var A = aff(m3mul(m3mul(rZ(posed.rz), rY(posed.ry)), rX(posed.rx)), [posed.px / 16, posed.py / 16, posed.pz / 16]);
    A = ER.affineThen(A, aff(null, [-1.1875 + 0.5, 1.0625 + 0.5, -0.9375 + 0.5]));
    A = ER.affineThen(A, aff([0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]));
    A = ER.affineThen(A, aff(rX(-Math.PI / 2)));
    var bp = ER.basePoseFor(mobLayer), bs = bp.flip ? -1 : 1, U = CFG.MODEL_UNITS_PER_BLOCK;
    var yaw = ER.bodyYawAt(e, partial), cy = Math.cos(yaw), sy = Math.sin(yaw), sc = ER.renderScaleOf(e) || 1;
    var B = [bs * cy * sc, 0, bs * sy * sc, 0, bs * sc, 0, -sy * sc, 0, cy * sc];
    var o = m3v(B, A.t);
    return { e: e, state: state, x: px + o[0], y: py + (bp.yOffsetFixed || 0) / U * sc + o[1], z: pz + o[2],
             shape: 'arrow', layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
             mobLayer: null, m: m3mul(B, A.R), held: true, golemFlower: true };
  };

  /**
   * Everything needed to draw one item entity as a BLOCK-ENTITY part, or null if it is not one
   * (PASS 15 JOB 3, G17e). One part, not one per layer — `pack-blockentity.mjs` already baked a
   * chest/bed/banner/etc.'s whole model as a single part, the same way one block state is one
   * part. The pile is a GUI-3D one (`gui3d: true`): a dropped chest jitters on all three axes
   * the way a dropped block does, not the two-axis flat stack a sprite item uses.
   */
  ER.beFor = function (e) {
    var idx = ER.itemIdOf(e);
    if (!(idx >= 0)) return null;
    var beIdx = ER.beIndexOf(idx);
    if (beIdx < 0) return null;
    var part = ER.bePartOf(beIdx);
    if (part < 0) return null;
    var count = e.count === undefined ? 1 : (e.count | 0);
    var dmg = e.damage | 0;
    return {
      part: part,
      layer: CFG.LAYER_OPAQUE,
      copies: ER.pileOffsets(idx, dmg, count, true, ER.GROUND.scale)
    };
  };

  /**
   * The `BE.layers` key this entity type draws as, when it is a MOB with real posed-box
   * geometry (JOB 4.3/4.2) rather than a block or item (`ER.SHAPE`'s own two shapes).
   *
   * ⚠ G18c's OWN GATE, not this function's: a type `EntityList.spawn` refuses (no measured
   * gravity/drag, `tools/golden/entity-motion-1.18.2.tsv`) can never reach `EL.list` at all,
   * so it can never reach here either -- this only answers "does a LIVE entity of this type
   * have a picture", never "can this type be spawned". Today `guardian`, `dolphin`,
   * `llama_spit` and `turtle` are the only types where both are true at once.
   */
  ER.mobLayerFor = function (type) {
    var BE = NS.BEModel;
    if (!BE || !BE.ready) return null;
    if (ER.SHAPE[type]) return null;              // block/item shapes take that path instead
    var L = BE.layer(type);
    return (L && L.parts && L.parts.length) ? type : null;
  };

  /**
   * #584 -- pufferfish and tropical fish have NO model layer named after their type (the jar's
   * layers are pufferfish_small/medium/big and tropical_fish_small/large), so `ER.mobLayerFor`
   * answered null and neither was ever drawn. `PufferfishEntityRenderer.render` picks the model
   * by puff state (0 small, 1 medium, else big); `TropicalFishEntityRenderer` by variant shape
   * (0 = model A = tropical_a.png = `tropical_fish_small`, else B = `tropical_fish_large`).
   */
  ER.fishLayerFor = function (e) {
    var BE = NS.BEModel, name = null;
    if (!BE || !BE.ready) return null;
    if (e.type === 'pufferfish') name = ['pufferfish_small', 'pufferfish_medium', 'pufferfish_big'][Math.min(e.puffState | 0, 2)];
    else if (e.type === 'tropical_fish') name = (e.fishVariant & 0xFF) === 0 ? 'tropical_fish_small' : 'tropical_fish_large';
    if (!name) return null;
    var L = BE.layer(name);
    return (L && L.parts && L.parts.length) ? name : null;
  };
  /** `TropicalFishEntityRenderer`'s base-colour tint (`getBaseColorComponents`), [0..1]x3, or null. */
  function fishDyeRGB_(idx) {
    var Tm = NS.Tame, BE = NS.BEModel, dn = Tm && Tm.DYES ? Tm.DYES[idx & 0xFF] : null;
    var rgb = dn && BE && BE.dye ? BE.dye[dn] : undefined;
    return rgb === undefined ? null : [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
  }
  ER.fishTintFor = function (e) {
    if (e.type !== 'tropical_fish' || e.fishVariant === undefined) return null;
    return fishDyeRGB_(e.fishVariant >> 16);
  };
  /** #1760 -- `TropicalFishColorFeatureRenderer`: the pattern pass, `{ texKey, tint }` or null. Texture =
   *  `getVarietyId` (shape 0 -> tropical_a_pattern_N, else tropical_b_pattern_N, N = min(variant>>8 & 255, 5) + 1),
   *  tint = `getPatternColorComponents` (variant>>24). Family sheet 0 is the bare key, like every `#n` family. */
  ER.fishPatternFor = function (e) {
    if (e.type !== 'tropical_fish' || e.fishVariant === undefined) return null;
    var v = e.fishVariant, pat = Math.min((v >> 8) & 0xFF, 5);
    return { texKey: ((v & 0xFF) === 0 ? 'tropical_fish_small_pattern' : 'tropical_fish_large_pattern') + (pat ? '#' + pat : ''),
             tint: fishDyeRGB_(v >>> 24) };
  };

  // loop/villager-tex -- THE VILLAGER/ZOMBIE_VILLAGER CLOTHING OVERLAYS.
  // `VillagerClothingFeatureRenderer.method_17151` (.decomp net/minecraft/client/render/
  // entity/feature/VillagerClothingFeatureRenderer.java:44-65, read in full): three overlay
  // passes over the SAME box list the base skin already draws -- TYPE (biome robe/hat), then
  // PROFESSION (skipped for `none`, .java:59), then PROFESSION_LEVEL badge (skipped for
  // `nitwit`, .java:62-64; drawn at EVERY level 1..5, including the "stone" badge at level 1
  // -- `LEVEL_TO_ID.get(1) == "stone"`, .java:28, not gated on level >= 2) -- plus a hat-
  // visibility toggle that is IN FORCE ONLY for the type pass (reset to true before the
  // profession pass, .java:52/57): `hatVisible = (profHat==FULL) || (profHat==PARTIAL &&
  // typeHat!=FULL)` (.java:50-53). `HatType` per (type|profession) name is read off each
  // PNG's own `.mcmeta` in `jars/1.18.2/1.18.2.jar` this session
  // (`VillagerResourceMetadataReader.java:9`, key "hat", default "none" when the mcmeta is
  // absent -- `VillagerResourceMetadata.HatType.from`) -- the exact 8 files that carry one,
  // transcribed verbatim, not guessed (`node --input-type=module` one-liner against the real
  // jar this session, not assumed from the profession/type list alone):
  //   villager/type: desert=full, snow=full (every other type -- jungle/plains/savanna/swamp/
  //     taiga -- has no mcmeta, so NONE); zombie_villager/type: no mcmeta on ANY type at all
  //     (NONE across the board -- confirmed against the real jar listing, not assumed
  //     symmetric with the live-villager set above).
  //   profession (BOTH entityType folders, same 6 files, same values): butcher=partial,
  //     farmer=full, fisherman=full, fletcher=full, librarian=full, shepherd=full (every
  //     other profession -- armorer/cartographer/cleric/leatherworker/mason/nitwit/
  //     toolsmith/weaponsmith/none -- has no mcmeta, NONE).
  // Sheet indices below are `tools/extract-mob-textures.mjs`'s own `FAMILY.villager`/
  // `FAMILY.zombie_villager` order (that file's own header comment carries the citation for
  // the order itself -- `VillagerType.java`'s declaration order for type, `Prof.ALL`'s order
  // for profession, `LEVEL_TO_ID`'s own map-literal order for the badge): index 0 is the base
  // skin (the plain texKey, unchanged), 1..7 the 7 types, 8..21 the 14 real professions,
  // 22..26 the 5 level badges.
  var VILLAGER_TYPE_HAT = { villager: { desert: 'full', snow: 'full' }, zombie_villager: {} };
  var VILLAGER_PROF_HAT = { butcher: 'partial', farmer: 'full', fisherman: 'full',
    fletcher: 'full', librarian: 'full', shepherd: 'full' };
  var VILLAGER_TYPE_ORDER = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];
  var VILLAGER_PROF_ORDER = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer',
    'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd',
    'toolsmith', 'weaponsmith'];
  var VILLAGER_LEVEL_ORDER = ['stone', 'iron', 'gold', 'emerald', 'diamond'];

  /** Ordered overlay passes (the base skin's own bare texKey is NOT included -- the caller
   *  already draws that as `it`'s own base pass) for a villager/zombie_villager entity.
   *  `entityType` is 'villager' or 'zombie_villager' (the FeatureRenderer's own `entityType`
   *  field, .java:38/70 -- also this engine's own `e.type` and `mobLayer`, unchanged).
   *  `[]` for a baby (.java:58's `!isBaby()` gate covers profession+badge; the type pass is
   *  NOT baby-gated in vanilla, matching the array always carrying at least the type entry).
   *  Exposed as its own pure function, not inlined at the push site, so a Node-only check can
   *  assert the layer selection with no live entity, no canvas, no BE model table at all. */
  ER.villagerClothingLayers = function (entityType, villagerType, profession, level, isBaby) {
    var typeHatMap = VILLAGER_TYPE_HAT[entityType] || {};
    var typeHat = typeHatMap[villagerType] || 'none';
    var profHat = VILLAGER_PROF_HAT[profession] || 'none';
    var hatVisible = (profHat === 'full') || (profHat === 'partial' && typeHat !== 'full');
    var ti = VILLAGER_TYPE_ORDER.indexOf(villagerType);
    var typeIdx = 1 + (ti >= 0 ? ti : VILLAGER_TYPE_ORDER.indexOf('plains'));
    var out = [{ texKey: entityType + '#' + typeIdx,
                 hideParts: hatVisible ? null : { hat: 1, hat_rim: 1 } }];
    if (isBaby || !profession || profession === 'none') return out;
    var pi = VILLAGER_PROF_ORDER.indexOf(profession);
    if (pi < 0) return out;   // unknown profession string -- no overlay to draw, D-139
    out.push({ texKey: entityType + '#' + (8 + pi), hideParts: null });
    if (profession !== 'nitwit') {
      var li = Math.max(0, Math.min(VILLAGER_LEVEL_ORDER.length - 1, (level || 1) - 1));
      out.push({ texKey: entityType + '#' + (22 + li), hideParts: null });
    }
    return out;
  };

  /**
   * `LivingEntityRenderer.render`'s own two animation arguments, interpolated for THIS frame
   * (D-415). Vanilla:
   *
   *     f5 = lerp(partialTicks, entity.animationSpeedOld, entity.animationSpeed);   // amount
   *     f6 = entity.animationPosition - entity.animationSpeed * (1 - partialTicks); // swing
   *     if (f5 > 1) f5 = 1;
   *
   * ⚠ THE SWING IS WOUND BACK, NOT LERPED. `animationPosition` already has this tick's whole
   * step added to it, so the frame's value is that total MINUS the unplayed part of the step —
   * which is why a mob's legs move smoothly between ticks instead of stepping 20 times a second.
   *
   * ⚠ `netHeadYaw`/`headPitch` ARE ZERO AND THAT IS NAMED, NOT FORGOTTEN. They are the head's
   * offset from the BODY's heading, which vanilla's `LookControl` supplies; nothing in this
   * engine turns a mob's head independently of its body yet (`Ai.OWED`), so a mob looks where it
   * faces. Feeding it the body yaw instead would rotate every head by the absolute heading —
   * a mob permanently looking over its own shoulder — which is worse than a head that is
   * straight. `riding` is false for the same reason: nothing rides anything.
   */
  /**
   * `Mth.rotLerp(delta, start, end)` — D-430. In RADIANS here, because every angle this engine
   * stores is; vanilla's is in degrees and the wrap constant is the only difference.
   *
   * ⚠⚠ **THE WRAP IS THE WHOLE FUNCTION.** A plain `a + (b - a) * t` between 179° and −179°
   * sweeps the mob 358 degrees the long way round in one tick — a spin, not a turn — and it
   * happens exactly at the heading a mob walking north keeps crossing. `wrapDegrees` on the
   * DIFFERENCE is what makes it take the 2-degree path instead.
   */
  ER.rotLerp = function (t, a, b) {
    var d = b - a;
    d = d % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d <= -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  };

  /** A mob's BODY heading at a partial tick (D-430). The one place the renderer reads a yaw. */
  /**
   * s134 -- `LivingEntityRenderer.setupTransforms` (.decomp :174-176): a SHAKING mob's body yaw gains
   * `cos(age * 3.25) * PI * 0.4` DEGREES. isShaking = isFrozen (no powder snow here) OR, for
   * HoglinEntityRenderer, canConvert() and, for PiglinEntityRenderer, AbstractPiglinEntity.shouldZombify()
   * — the shiver before an overworld conversion (Piglin.OWED's SHAKING row).
   */
  ER.isShaking = function (e) {
    if (!e) return false;
    if (e.type === 'hoglin') return !!(NS.Hoglin && NS.Hoglin.canConvert && NS.Hoglin.canConvert(e));
    if (e.type === 'piglin' || e.type === 'piglin_brute') return !!(NS.Piglin && NS.Piglin.shouldZombify && NS.Piglin.shouldZombify(e));
    // ZombieBaseEntityRenderer.isShaking: CONVERTING_IN_WATER (zombie/husk/drowned countdown running)
    if ((e.type === 'zombie' || e.type === 'husk' || e.type === 'drowned') &&
        e.convertCountdown !== undefined && e.convertCountdown !== null) return true;
    if (e.type === 'zombie_villager') return !!e.converting;   // ZombieVillagerEntityRenderer.isShaking: super || isConverting()
    if (e.type === 'skeleton' && NS.Undead && NS.Undead.isStrayConverting) return NS.Undead.isStrayConverting(e);   // SkeletonEntity.isShaking
    // StriderEntityRenderer.isShaking: super.isShaking || isCold() (#932)
    if (e.type === 'strider') return !!(NS.Strider && NS.Strider.isCold && NS.Strider.isCold(e));
    return false;
  };
  ER.shakeYaw = function (e) { return Math.cos((e.age || 0) * 3.25) * Math.PI * 0.4 * DEG2RAD; };
  ER.bodyYawAt = function (e, partial) { return ER.yawAt(e, partial) + (ER.isShaking(e) ? ER.shakeYaw(e) : 0); };
  ER.yawAt = function (e, partial) {
    var t = (partial === undefined) ? 1 : partial;
    if (e.boatC) return ER.rotLerp(t, e.boatC.pyaw * DEG2RAD, e.boatC.yaw * DEG2RAD);
    if (e.yBodyRot !== undefined) {   // D-422: a mob draws its BODY yaw, not its aim yaw
      return ER.rotLerp(t, e.yBodyRotO === undefined ? e.yBodyRot : e.yBodyRotO, e.yBodyRot);
    }
    var a = (e.yawO === undefined) ? (e.yaw || 0) : e.yawO;
    return ER.rotLerp(t, a, e.yaw || 0);
  };

  /**
   * `ChickenEntityRenderer.method_3893` (.decomp/net/minecraft/client/render/entity/
   * ChickenEntityRenderer.java lines 20-23), the WING-ROLL curve fed to `setAngles` as its
   * `ageInTicks`-shaped argument: `(sin(lerp(flapProgress)) + 1) * lerp(maxWingDeviation)`.
   * Both halves are `MathHelper.lerp(tickDelta, prev, cur)` -- plain linear, not `ER.rotLerp`
   * (neither value ever wraps past +-PI the way a heading does). Returns `undefined` for a
   * non-chicken so `ER.animOf` can hand it straight to the anim object unconditionally.
   */
  ER.chickenWingRoll = function (e, partial) {
    if (!e || e.type !== 'chicken') return undefined;
    var t = partial === undefined ? 1 : partial;
    var flap = (e.prevFlapProgress || 0) + ((e.flapProgress || 0) - (e.prevFlapProgress || 0)) * t;
    var dev = (e.prevMaxWingDeviation || 0) + ((e.maxWingDeviation || 0) - (e.prevMaxWingDeviation || 0)) * t;
    return (Math.sin(flap) + 1.0) * dev;
  };

  /**
   * #1226 -- `ParrotEntityModel.getPose` (.decomp ParrotEntityModel.java): songPlaying -> PARTY, sitting -> SITTING,
   * else `isInAir()` (`!onGround`) -> FLYING, else STANDING; `flap` is `ParrotEntityRenderer.getFlapAngle`
   * (`(sin(lerp flapProgress) + 1) * lerp maxWingDeviation`, plain lerps like the chicken's).
   */
  ER.parrotAnim = function (e, partial) {
    if (!e || e.type !== 'parrot') return null;
    var t = partial === undefined ? 1 : partial;
    var flap = (e.prevFlapProgress || 0) + ((e.flapProgress || 0) - (e.prevFlapProgress || 0)) * t;
    var dev = (e.prevMaxWingDeviation || 0) + ((e.maxWingDeviation || 0) - (e.prevMaxWingDeviation || 0)) * t;
    return { pose: e.shoulder ? 'shoulder' : e.songPlaying ? 'party' : e.sitting ? 'sitting' : e.onGround ? 'standing' : 'flying',
             age: e.age | 0, flap: e.shoulder ? 0 : (Math.sin(flap) + 1.0) * dev };
  };

  /**
   * `SheepEntity.getNeckAngle`/`getHeadAngle` (.decomp/net/minecraft/entity/passive/
   * SheepEntity.java lines 198-213), read whole -- `$$0` there is the PARTIAL TICK itself,
   * not a lerp of two stored values (`eatGrassTimer` is a live int, ticked once per game tick
   * by `Passive.EatGrassGoal.tick`, 07w_passive.js; vanilla gets its own sub-tick smoothness
   * by subtracting the fractional tick straight off the int, the same trick `ER.animOf`'s
   * `limbSwing` line above already uses).
   * `headOverride` is `undefined` on the `eatGrassTimer <= 0` branch on purpose: that branch's
   * own vanilla formula (`getPitch() * PI/180`) is bit-for-bit `ER.setupAnimDelta`'s existing
   * default head-pitch rule, so leaving it undefined and falling through to that rule (rather
   * than recomputing the identical number a second way) is the same pose by the same code path
   * `mobrendercheck.mjs`'s existing head-pitch assertions already cover.
   */
  ER.sheepEatGrass = function (e, partial) {
    if (!e || e.type !== 'sheep') return null;
    var timer = e.eatGrassTimer | 0;
    var t = partial === undefined ? 1 : partial;
    var neck;
    if (timer <= 0) neck = 0;
    else if (timer >= 4 && timer <= 36) neck = 1;
    else neck = timer < 4 ? (timer - t) / 4 : -((timer - 40) - t) / 4;
    var headOverride;
    if (timer > 4 && timer <= 36) {
      var f1 = ((timer - 4) - t) / 32;
      headOverride = Math.PI / 5 + 0.21991149 * Math.sin(f1 * 28.7);
    } else if (timer > 0) {
      headOverride = Math.PI / 5;
    }
    return { neckAngle: neck, headOverride: headOverride };
  };

  // ── loop/vsleep -- the SLEEPING render pose (VB.OWED's "no renderer SLEEPING POSE exists"
  // and part of its "movement OUTPUT is cancelled... but the goal SELECTOR itself... keeps
  // turning a sleeping villager's head", 07zv_villagerbrain.js) ─────────────────────────────
  //
  // `LivingEntityRenderer.render`/`setupTransforms` (.decomp/net/minecraft/client/render/
  // entity/LivingEntityRenderer.java, read in full this session):
  //   :84-90   a WORLD-SPACE translate, before setupTransforms: -getSleepingDirection()'s own
  //            offset (Direction.java's unit vector, .decomp lines 25-28) times
  //            (getEyeHeight(STANDING) - 0.1).
  //   :194-199 the sleeping branch of setupTransforms itself: multiply(Y, getYaw(direction)),
  //            then multiply(Z, getLyingAngle()=90, :214-216), then multiply(Y, 270) -- in
  //            THAT order, which (MatrixStack.multiply post-multiplies the stack's top matrix)
  //            means, applied to a column vector v: Ry(yaw) * (Rz(90) * (Ry(270) * v)).
  //   :154-166 getYaw(direction): NORTH=90, SOUTH=0, WEST=270, EAST=180.
  // `LivingEntity.getSleepingDirection`/`BedBlock.getDirection` (.decomp/net/minecraft/entity/
  // LivingEntity.java:3173-3176, net/minecraft/block/BedBlock.java:66-69): the bed's own
  // `facing` property AT THE SLEEPING POSITION, which `07zv_villagerbrain.js`'s own `sleepIn`
  // already reads once and hands across as `e.vbSleepFacing` -- a real registry value id
  // (`R.PROP.facing`'s own value), not a compass string this file would have to re-derive.
  // `Entity.getEyeHeight` default (.decomp/net/minecraft/entity/Entity.java:2564-2566):
  // height*0.85 off the STANDING dimensions; VillagerEntity declares no override
  // (LivingEntity.java:3184-3189 just forwards to it), so this is the real number.
  //
  // A general 3x3 matrix multiply (not a hand-derived closed form for each of the four
  // directions) is used on purpose: the three `multiply` calls above are exactly three
  // standard axis rotations composed in a fixed order, and composing them IN CODE the same
  // way the decompiled method does is less to get wrong than re-deriving one fixed matrix per
  // direction by hand and hoping the algebra survives four repetitions.
  function mulMat3(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    return r;
  }
  function rotY(deg) {
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  }
  function rotZ(deg) {
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  }
  ER.LYING_ANGLE = 90;   // LivingEntityRenderer.getLyingAngle default (.decomp :214-216)

  /** The sleeping-branch rotation matrix for one `getYaw(direction)` value, in degrees --
   *  `LivingEntityRenderer.setupTransforms` (.decomp :194-199), read as `M*v = Ry(yaw) *
   *  (Rz(90) * (Ry(270) * v))` (see this section's own header for why). Only ever called with
   *  one of the four `ER.sleepDirData` values (90/0/270/180), never a live body yaw. */
  ER.sleepMatrix = function (yawDeg) {
    return mulMat3(mulMat3(rotY(yawDeg), rotZ(ER.LYING_ANGLE)), rotY(270));
  };

  /** `getLyingAngle` overrides (.decomp Silverfish/Endermite/Spider EntityRenderer): 180, else 90. */
  ER.lyingAngleOf = function (type) {
    return (type === 'silverfish' || type === 'endermite' || type === 'spider' || type === 'cave_spider') ? 180 : 90;
  };

  /** `LivingEntityRenderer.setupTransforms`' deathTime roll (.decomp :182-190): Rz(min(sqrt((deathTime +
   *  pt - 1)/20*1.6), 1) * lyingAngle) after the yaw. Returned in `sleepPose`'s shape (R = Ry(yaw)*Rz(d),
   *  applied before the engine's Z180 flip, which commutes with Rz) so the mob emitter needs no new branch. */
  ER.deathPoseOf = function (e, partial) {
    if (!e || !(e.deathTime > 0)) return null;
    var f = Math.sqrt(Math.max(0, (e.deathTime + partial - 1) / 20 * 1.6));
    if (f > 1) f = 1;
    var yawDeg = ER.bodyYawAt(e, partial) * 180 / Math.PI;
    return { R: mulMat3(rotY(yawDeg), rotZ(f * ER.lyingAngleOf(e.type))), dx: 0, dz: 0 };
  };

  /** The bed FACING value id (`e.vbSleepFacing`, `07zv_villagerbrain.js`) as the direction
   *  data `LivingEntityRenderer` needs -- compared against the LIVE registry ids
   *  (`R.PVAL.north/south/west/east`), never a hardcoded 0/1/2/3 this file's own load order
   *  does not guarantee. `dx/dz` are `Direction`'s own unit offsets (.decomp
   *  net/minecraft/util/math/Direction.java lines 25-28); `yawDeg` is `getYaw` (.decomp
   *  LivingEntityRenderer.java :154-166). Returns `null` for an unset/unrecognised facing
   *  (a broken bed, or this engine's registry not hot yet) rather than guessing a direction. */
  ER.sleepDirData = function (facingId) {
    var R = NS.Reg;
    if (!R || !R.PVAL || facingId === undefined || facingId < 0) return null;
    if (facingId === R.PVAL.north) return { dx: 0, dz: -1, yawDeg: 90 };
    if (facingId === R.PVAL.south) return { dx: 0, dz: 1, yawDeg: 0 };
    if (facingId === R.PVAL.west) return { dx: -1, dz: 0, yawDeg: 270 };
    if (facingId === R.PVAL.east) return { dx: 1, dz: 0, yawDeg: 180 };
    return null;
  };

  /** `Entity.getEyeHeight` default (.decomp :2564-2566), off the mob's own STANDING
   *  dimensions (`Ent.height`, 07h_entities.js) -- see this section's own header for why
   *  villager needs no override lookup. `null` (not a guessed constant) for a type this
   *  engine's own entity table does not carry. */
  ER.eyeHeightStanding = function (type) {
    if (type === 'giant') return Math.fround(10.440001);   // #912 GiantEntity.getActiveEyeHeight
    var Ent = NS.Entities;
    var h = Ent && Ent.height ? Ent.height(type) : null;
    if (h === null || h === undefined) return null;
    var Cb = NS.Combat;   // #4784 one table: Cb.eyeHeightOf carries every getActiveEyeHeight override (snow_golem 1.7, ...)
    return Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf({ type: type, height: h }) : h * 0.85;
  };

  // loop/nameplate -- EntityRenderer.hasLabel (.decomp/net/minecraft/client/render/entity/
  // EntityRenderer.java:68-70: `shouldRenderName() && hasCustomName()`), overridden twice:
  // LivingEntityRenderer.method_4055 (.decomp same dir/LivingEntityRenderer.java:222-248 --
  // distance gate at 32/64 blocks squared by isSneaky(), scoreboard-team visibility (SB.nametagRule), `MinecraftClient.isHudEnabled()` (`NS.Settings.hideGui`, inverted),
  // never the camera entity itself, `!isInvisibleTo(player)` (`NS.Effects` 'invisibility',
  // no ally-team exemption for the same no-teams reason), `!hasPassengers()` (`Mnt.isRidden`
  // -- a RIDDEN mob draws no label)), then MobEntityRenderer.hasLabel (.decomp same dir/
  // MobEntityRenderer.java:26: `super.method_4055(e) && (e.shouldRenderName() ||
  // (e.hasCustomName() && e == dispatcher.targetedEntity))`). `shouldRenderName()` is
  // `Entity.isCustomNameVisible()` (LivingEntity.java:1969/Entity.java:2493), the
  // `CustomNameVisible` NBT byte -- this engine has no `/data merge entity` or command block
  // to ever SET that tag, so it is always false and the OR's left half never fires; only the
  // crosshair-target half is reachable, named here rather than silently dropped. The extra
  // flat `getSquaredDistanceToCamera(e) > 4096.0` gate `EntityRenderer.renderLabelIfPresent`
  // (.decomp EntityRenderer.java:76) applies ON TOP of this is never tighter than the 32/64
  // gate below (64*64 == 4096 exactly), so it is not re-checked -- asserted redundant, not
  // silently skipped, by namecheck.mjs.
  ER.LABEL_RANGE_SNEAK = 32;    // LivingEntityRenderer.java:223
  ER.LABEL_RANGE_NORMAL = 64;   // LivingEntityRenderer.java:223
  ER.LABEL_SCALE = 0.025;      // EntityRenderer.field_32921 / .java:87 `$$2.scale(-0.025F,-0.025F,0.025F)`
  ER.hasLabel = function (e, camX, camY, camZ, targetEntity, hideGui) {
    if (!e || e.removed || e.dead || !e.customName) return false;
    var dx = e.x - camX, dy = e.y - camY, dz = e.z - camZ;
    var distSq = dx * dx + dy * dy + dz * dz;
    // no mob in this engine ever sets `.sneaking` (only players do, `P.sneaking`,
    // 14_player.js) -- read as a real field rather than hard-coded false, so a future
    // sneaking mob gets the tighter 32-block range for free rather than needing this touched
    // again.
    var sneaky = !!e.sneaking;
    var range = sneaky ? ER.LABEL_RANGE_SNEAK : ER.LABEL_RANGE_NORMAL;
    if (distSq >= range * range) return false;
    if (hideGui) return false;
    var Mn = NS.Mount;
    if (Mn && Mn.isRidden && Mn.isRidden(e)) return false;
    var ST = NS.Effects;
    var invis = !!(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'));
    var tr = NS.Scoreboard && NS.Player ? NS.Scoreboard.nametagRule(e, NS.Player, !invis) : null;
    if (tr === false) return false;
    if (invis) return false;
    return e === targetEntity;   // `e.isCustomNameVisible()` is unreachably false -- see above
  };

  /** `LivingEntityRenderer.shouldFlipUpsideDown` (.decomp/net/minecraft/client/render/entity/
   *  LivingEntityRenderer.java:258-266): a LIVING entity named exactly "Dinnerbone" or "Grumm"
   *  renders upside down. `Formatting.strip($$0.getName().getString())` is a no-op here -- no
   *  path in this engine ever attaches a formatting code to `e.customName` (the name-tag
   *  branch, 14l_use.js, copies `display.Name` verbatim) -- so an exact match is the whole
   *  jar rule, not a simplification of it. Gated to `NS.Entities.isLiving` the same way
   *  `ER.basePoseFor` already is: the jar method lives on `LivingEntityRenderer`, never called
   *  for a block-entity/leash-knot render. */
  ER.shouldFlipUpsideDown = function (e, layerName) {
    if (!e || !e.customName) return false;
    var E = NS.Entities;
    if (E && E.ready && E.isLiving && !E.isLiving(layerName || e.type)) return false;
    return e.customName === 'Dinnerbone' || e.customName === 'Grumm';
  };

  /**
   * The base pose a Dinnerbone/Grumm-named mob draws with, derived (not guessed) from
   * `LivingEntityRenderer.render`/`setupTransforms` (.decomp lines 79-95, 200-202) composed
   * with this engine's own `ER.BASE_LIVING` preamble (D-415) every OTHER living mob already
   * draws through:
   *
   *   vanilla's per-vertex transform is, innermost first: translate(0,-1.501,0);
   *   scale(-1,-1,1) [[ D-415's own baseline, ALWAYS applied ]]; then, upside-down only:
   *   rotate(Z,180); translate(0, height+0.1, 0); then the shared yaw rotate
   *   (LivingEntityRenderer.java:79-95, read outer-to-inner in the matrix-stack order the jar
   *   calls them).
   *
   *   `rotate(Z,180)` on (x,y,z) is exactly `(-x,-y,z)` -- algebraically IDENTICAL to the
   *   `scale(-1,-1,1)` baseline already inside it, so the two CANCEL (scale-of-scale is
   *   identity): the Dinnerbone draw needs `bs=+1` (no flip at all -- D-415's own preamble
   *   undone) with a translate of `height + 0.1 - ER.LIVING_Y_OFFSET` in its place (the
   *   baseline's own `-1.501` folds into that difference rather than applying separately).
   *   Checked point-for-point against a from-scratch matrix expansion by namecheck.mjs (a
   *   known model part's world Y, flipped vs plain, at a fixed yaw) -- not asserted from this
   *   comment's arithmetic alone.
   */
  ER.dinnerbonePoseFor = function (heightBlocks) {
    var h = (typeof heightBlocks === 'number' && heightBlocks > 0) ? heightBlocks : 0;
    return { flip: false, yOffsetFixed: (h + 0.1 - ER.LIVING_Y_OFFSET) * CFG.MODEL_UNITS_PER_BLOCK };
  };

  /** `null` unless `e.vbSleeping` (07zv_villagerbrain.js's own pose flag) and its bed's own
   *  FACING resolves to a real direction -- see this section's own header for every number
   *  cited here. `R` feeds `ER.emitMobLayer`'s own vertex/normal transform (in place of the
   *  plain yaw rotation); `dx/dz` feed `ER.build`'s own world-space translate of the entity's
   *  position before it is quantised (LivingEntityRenderer.java :84-90's own translate, which
   *  runs in WORLD space, outside/before the model's own local rotation). */
  ER.sleepPoseOf = function (e, partial) {
    if (e && e.type === 'drowned') return ER.drownedSwimPoseOf(e, partial);
    if (e && (e.type === 'player' || e.type === 'player_slim')) return ER.playerPoseOf(e, partial);
    if (!e || !e.vbSleeping) return null;
    var dir = ER.sleepDirData(e.vbSleepFacing);
    if (!dir) return null;
    var eyeH = ER.eyeHeightStanding(e.type);
    if (eyeH === null) return null;
    var off = eyeH - 0.1;
    return { R: ER.sleepMatrix(dir.yawDeg), dx: -dir.dx * off, dz: -dir.dz * off };
  };

  /** #994 -- `DrownedEntityRenderer.setupTransforms`: after the yaw, rotX(lerp(leaning, pitch, -10 - pitch)) degrees
   *  while `getLeaningPitch(partial) > 0` (pitch = `e.swimPitch`, vanilla degrees, up negative). Folded into the
   *  `anim.sleepPose` slot (R = yaw * Rx(-p): the engine draws Z180 * R * v for vanilla's Ry * Rx * Z180 * v). */
  ER.drownedSwimPoseOf = function (e, partial) {
    var t = partial === undefined ? 1 : partial;
    var k = (e.lastLeaningPitch || 0) + ((e.leaningPitch || 0) - (e.lastLeaningPitch || 0)) * t;
    if (!(k > 0)) return null;
    var pitch = e.swimPitch || 0, p = pitch + (-10 - pitch - pitch) * k;
    var yaw = ER.bodyYawAt(e, partial), c = Math.cos(yaw), sn = Math.sin(yaw);
    var Y = [c, 0, sn, 0, 1, 0, -sn, 0, c];
    return { R: mulMat3(Y, rotX(-p)), dx: 0, dy: 0, dz: 0 };
  };

  /** #6733 -- `PlayerEntityRenderer.setupTransforms` (.decomp): fall flying = rotX(clamp(roll^2/100) * (-90 - pitch))
   *  then rotY(sign(cross) * acos(velocity . look)) on the horizontal plane; else while swimAmount > 0 =
   *  rotX(lerp(k, 0, inWater ? -90 - pitch : -90)) and, in the swimming pose, translate(0, -1, 0.3). Pitch is vanilla
   *  degrees (down positive: `e.xHeadRot`). Same slot shape as drownedSwimPoseOf (R = yaw * Rx(-p)). */
  /** #6737 TridentRiptideFeatureRenderer: three `box` (-8,-16,-8, 16x32x16) passes, each rotY(ageT * -(45 + 5i)),
   *  scale 0.75i, translate(0, -0.2 + 0.6i, 0); [] unless the player is riptiding. */
  ER.riptidePasses = function (e, partial) {
    if (!e || !(e.riptideTicks > 0)) return [];
    var a = (e.age || 0) + (partial === undefined ? 1 : partial), out = [];
    for (var i = 0; i < 3; i++) out.push({ rotYDeg: a * -(45 + i * 5), scale: 0.75 * i, ty: -0.2 + 0.6 * i });
    return out;
  };
  ER.playerPoseOf = function (e, partial) {
    var t = partial === undefined ? 1 : partial, pitch = e.xHeadRot || 0;
    var yaw = ER.bodyYawAt(e, partial), c = Math.cos(yaw), sn = Math.sin(yaw);
    var Y = [c, 0, sn, 0, 1, 0, -sn, 0, c], R, dy = 0, dz = 0;
    if (e.riptideTicks > 0 && !e.fallFlying) {   // #6737 LivingEntityRenderer.setupTransforms isUsingRiptide: Rx(-90 - pitch) * Ry((age + t) * -75)
      var sp = ((e.age || 0) + t) * 75 * DEG2RAD, cs = Math.cos(sp), ss = Math.sin(sp);
      return { R: mulMat3(mulMat3(Y, rotX(90 + pitch)), [cs, 0, ss, 0, 1, 0, -ss, 0, cs]), dx: 0, dy: 0, dz: 0 };
    }
    if (e.fallFlying) {
      var roll = (e.fallFlyTicks || 0) + t, f = Math.min(1, Math.max(0, roll * roll / 100));
      R = mulMat3(Y, rotX(-(f * (-90 - pitch))));
      var yr = (e.yaw || 0), lx = Math.sin(yr), lz = -Math.cos(yr), vx = e.vx || 0, vz = e.vz || 0;
      var v2 = vx * vx + vz * vz, l2 = lx * lx + lz * lz;
      if (v2 > 0 && l2 > 0) {
        var d = Math.max(-1, Math.min(1, (vx * lx + vz * lz) / Math.sqrt(v2 * l2))), x = vx * lz - vz * lx;
        var a = (x > 0 ? 1 : x < 0 ? -1 : 0) * Math.acos(d), ca = Math.cos(a), sa = Math.sin(a);
        R = mulMat3(R, [ca, 0, -sa, 0, 1, 0, sa, 0, ca]);
      }
      return { R: R, dx: 0, dy: 0, dz: 0 };
    }
    var k = (e.lastSwimAmount || 0) + ((e.swimAmount || 0) - (e.lastSwimAmount || 0)) * t;
    if (!(k > 0)) return null;
    var ang = k * (e.inWater ? -90 - pitch : -90);
    R = mulMat3(Y, rotX(-ang));
    if (e.swimming) {   // translate(0, -1, 0.3) in the post-rotation frame
      var o = [0, 1, -0.3], m = R;   // engine y/z are flipped against vanilla's model frame
      return { R: R, dx: m[0] * o[0] + m[1] * o[1] + m[2] * o[2], dy: m[3] * o[0] + m[4] * o[1] + m[5] * o[2],
               dz: m[6] * o[0] + m[7] * o[1] + m[8] * o[2] };
    }
    return { R: R, dx: 0, dy: 0, dz: 0 };
  };

  // ── G18a-1 (#209): THE BOAT — BoatEntityRenderer.render + BoatEntityModel.setAngles ─────────────
  // The renderer's PoseStack, outermost first: translate(0, .375, 0); rotY(180 - yaw); [damage
  // wobble: rotX(sin(t) * t * strength / 10 * side) while t = wobbleTicks - partial > 0]; [bubble
  // wobble: rotate(axis (1,0,1), lerp(bubble))]; scale(-1, -1, 1); rotY(90). The model draws
  // through `emitMobLayer`'s `anim.sleepPose` slot, which is exactly "replace the yaw rotation with
  // this whole model->world matrix": `R` below is every rotation/scale in that list folded, `dy`
  // the .375 lift. `rotY(180 - yaw)` is `rotY(-engineYaw)` here (the engine's mob path draws
  // `Z180 * rotY(engineYaw)` for vanilla's `rotY(180 - yaw) * Z180`, so the two headings differ by
  // that sign and 180, and the boat's own prefix is the same 180 - yaw).
  function rotX(deg) {
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  }
  /** Rodrigues rotation about the (normalised) axis -- `new Quaternion(Vec3f(1,0,1), deg, true)`. */
  function rotAxis(ax, ay, az, deg) {
    var l = Math.sqrt(ax * ax + ay * ay + az * az); ax /= l; ay /= l; az /= l;
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
    return [c + ax * ax * k, ax * ay * k - az * s, ax * az * k + ay * s,
            ay * ax * k + az * s, c + ay * ay * k, ay * az * k - ax * s,
            az * ax * k - ay * s, az * ay * k + ax * s, c + az * az * k];
  }
  function clampedLerp(a, b, t) { return t < 0 ? a : t > 1 ? b : a + (b - a) * t; }

  /** `BoatEntity.Type` ordinal -> `FAMILY.boat` index; `e.boatType` is that ordinal or the wood's name. */
  ER.BOAT_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
  ER.boatTypeIndex = function (e) {
    var t = e && e.boatType;
    if (typeof t === 'string') { var i = ER.BOAT_TYPES.indexOf(t); return i < 0 ? 0 : i; }
    return (t | 0) >= 0 && (t | 0) < ER.BOAT_TYPES.length ? (t | 0) : 0;
  };
  /** The texture key of a boat: "boat" (oak) or "boat#1".."boat#5". */
  ER.boatTexKey = function (e) { var i = ER.boatTypeIndex(e); return i ? 'boat#' + i : null; };

  /** `BoatEntity.interpolatePaddlePhase(paddle, partial)`; `e.paddlePhases[i]` / `e.paddleMoving[i]`. */
  ER.boatPaddlePhase = function (e, i, partial) {
    var ph = e.paddlePhases ? (e.paddlePhases[i] || 0) : 0;
    var mv = e.paddleMoving ? !!e.paddleMoving[i] : false;
    return mv ? clampedLerp(ph - Math.PI / 8, ph, partial) : 0;
  };
  /** `BoatEntityModel.setPaddleAngle`: the paddle's ABSOLUTE pitch/yaw (radians) for one blade. */
  ER.boatPaddleAngles = function (phase, i) {
    var pitch = clampedLerp(-Math.PI / 3, -Math.PI / 12, (Math.sin(-phase) + 1) / 2);
    var yaw = clampedLerp(-Math.PI / 4, Math.PI / 4, (Math.sin(-phase + 1) + 1) / 2);
    if (i === 1) yaw = Math.PI - yaw;
    return { pitch: pitch, yaw: yaw };
  };
  /** The whole model->world rotation of the boat's PoseStack (see the section header). */
  ER.boatMatrix = function (e, partial) {
    var yawE = ER.yawAt(e, partial) * RAD2DEG;
    var R = rotY(-yawE);
    var wt = (e.damageWobbleTicks || 0) - partial;
    var ws = (e.damageWobbleStrength || 0) - partial;
    if (ws < 0) ws = 0;
    if (wt > 0) R = mulMat3(R, rotX(Math.sin(wt) * wt * ws / 10 * (e.damageWobbleSide || 0)));
    var lb = e.lastBubbleWobble || 0, bw = e.bubbleWobble || 0;
    var bub = lb + (bw - lb) * partial;
    if (Math.abs(bub) > 1e-5) R = mulMat3(R, rotAxis(1, 0, 1, bub));
    R = mulMat3(R, [-1, 0, 0, 0, -1, 0, 0, 0, 1]);
    return mulMat3(R, rotY(90));
  };
  /** #3032 ShulkerBulletEntityRenderer.render: translate(0,0.15), Ry(sin(a*.1)*180) Rx(cos(a*.1)*180)
   *  Rz(sin(a*.15)*360), scale(-.5,-.5,.5) (= the living mirror + RENDER_SCALE 0.5), then the model's
   *  `main` part takes yaw/pitch. The engine flips AFTER `sleepPose.R`, vanilla before it, so R is
   *  conjugated by the flip. ponytail: yaw/pitch come straight off the velocity (vanilla lerps them
   *  0.2 per tick), and the translucent x1.5 halo pass (alpha 0.15) is not drawn: no per-vertex alpha. */
  ER.bulletAnimOf = function (e, partial) {
    var a = (e.age || 0) + partial, D = [-1, 0, 0, 0, -1, 0, 0, 0, 1];
    var R = mulMat3(mulMat3(rotY(Math.sin(a * 0.1) * 180), rotX(Math.cos(a * 0.1) * 180)), rotZ(Math.sin(a * 0.15) * 360));
    var vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
    var yaw = Math.atan2(vx, vz), pitch = Math.atan2(vy, Math.hypot(vx, vz));
    return {
      sleepPose: { R: mulMat3(mulMat3(D, R), D), dx: 0, dy: 0.15, dz: 0 },
      deltaFor: function (n) { return n === 'main' ? { rx: pitch, ry: yaw, rz: 0 } : null; }
    };
  };
  /** WitherSkullEntityRenderer.render: head yaw = lerpAngle(prevYaw, yaw, t), pitch = lerp(prevPitch, pitch, t), both degrees ->
   *  SkullEntityModel.setHeadRotation (x pi/180) on `head`, under the same scale(-1,-1,1) mirror as the bullet. */
  ER.skullAnimOf = function (e, partial) {
    var y = e.yaw || 0, yo = e.prevYaw === undefined ? y : e.prevYaw, p = e.pitch || 0, po = e.prevPitch === undefined ? p : e.prevPitch;
    var d = (((y - yo) % 360) + 360) % 360; if (d >= 180) d -= 360;
    var yaw = (yo + d * partial) * (Math.PI / 180), pitch = (po + (p - po) * partial) * (Math.PI / 180);
    return { sleepPose: { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], dx: 0, dy: 0, dz: 0 }, deltaFor: function (n) { return n === 'head' ? { rx: pitch, ry: yaw, rz: 0 } : null; } };
  };
  /** BoatEntity.isSubmergedInWater(): location UNDER_WATER or UNDER_FLOWING_WATER. */
  ER.boatSubmerged = function (e) { return e.location === 'under_water' || e.location === 'under_flowing_water'; };
  /** Every boat part but `bottom`: water_patch is the same 28x16x3 box as `bottom`, pivot y -3 instead of +3 (BoatEntityModel). */
  ER.WATER_PATCH_HIDE = { back: 1, front: 1, right: 1, left: 1, left_paddle: 1, right_paddle: 1 };
  /** The quads of one boat's water_patch, emitted from the `bottom` box lifted 6 model px along the boat's own up axis. */
  ER.emitWaterPatch = function (out, o, r) {
    var R = r.anim.sleepPose.R, k = -6 / 16, U = CFG.MODEL_UNITS_PER_BLOCK, an = r.anim;
    return ER.emitMobLayer(out, o, r.it.mobLayer, r.ux + Math.round(R[1] * k * U), r.uy + Math.round(R[4] * k * U), r.uz + Math.round(R[7] * k * U),
                           Math.cos(r.mobYaw), Math.sin(r.mobYaw),
                           r.sky, r.blk, 0, an, undefined, r.it.texKey, false, null, r.scale, ER.WATER_PATCH_HIDE);
  };
  /** #5723: one depth-only §8 buffer (model layer 3) holding every un-submerged boat's water_patch; null when none. */
  ER.buildWaterMask = function (recs) {
    if (!recs.length) return null;
    var M = NS.Mesher, n = 0, i, o = 0;
    var probe = new Uint32Array(recs.length * 16 * 16);
    for (i = 0; i < recs.length; i++) o = ER.emitWaterPatch(probe, o, recs[i]);
    n = o / 16;
    if (!n) return null;
    var buf = M.allocBuffer(0, 0, 0, [0, 0, 0, n]);
    var hdr = M.readHeader(buf);
    new Uint32Array(buf, hdr.modelOff[3], n * 16).set(probe.subarray(0, n * 16));
    return buf;
  };
  /** #1589: one model-layer-3 §8 buffer of the dragon geometry in its own skin (DRAGON_DECAL); null when no dragon is dying. */
  ER.buildDragonDecal = function (recs) {
    if (!recs.length) return null;
    var M = NS.Mesher, i, o = 0, probe = new Uint32Array(recs.length * 4096 * 16);
    for (i = 0; i < recs.length; i++) o = recs[i](probe, o, null);
    var n = o / 16;
    if (!n) return null;
    var buf = M.allocBuffer(0, 0, 0, [0, 0, 0, n]);
    new Uint32Array(buf, M.readHeader(buf).modelOff[3], n * 16).set(probe.subarray(0, n * 16));
    return buf;
  };
  ER.boatAnimOf = function (e, partial) {
    var REST_RY = { left_paddle: 0, right_paddle: Math.PI };
    return {
      sleepPose: { R: ER.boatMatrix(e, partial), dx: 0, dy: 0.375, dz: 0 },
      deltaFor: function (name) {
        var i = name === 'left_paddle' ? 0 : name === 'right_paddle' ? 1 : -1;
        if (i < 0) return null;
        var a = ER.boatPaddleAngles(ER.boatPaddlePhase(e, i, partial), i);
        return { rx: a.pitch, ry: a.yaw - REST_RY[name], rz: 0 };
      }
    };
  };

  /** #731 -- `IronGolemEntityRenderer.setupTransforms` (.decomp :25-33): a walking golem rocks
   *  side to side, a Z rotation of `6.5 * f7` degrees (0 when limbDistance < 0.01). */
  ER.golemRoll = function (e, partial) {
    if (!e || e.type !== 'iron_golem') return 0;
    var d = e.animSpeed || 0;
    if (d < 0.01) return 0;
    var f6 = (e.animPos || 0) - d * (1 - partial) + 6;
    return 6.5 * ((Math.abs(f6 % 13 - 6.5) - 3.25) / 3.25);
  };
  /** The roll as a 2x2 (cos, sin) pair, or null when there is none. */
  ER.golemRollCS = function (deg) {
    if (!deg) return null;
    var t = deg * Math.PI / 180;
    return { c: Math.cos(t), s: Math.sin(t) };
  };

  /** #919 -- `PandaEntityRenderer.setupTransforms` (.decomp :34-87) as ops on a pose-stack matrix M
   *  (`M v = R v + t`, t in BLOCKS). `pr` = {sit, lie, playingTicks, partial, baby, thunder, age}. Entity
   *  pitch is 0 (sitting forces it, `PandaEntity.tick` :364). */
  ER.pandaPoseOf = function (pr) {
    var R = [1, 0, 0, 0, 1, 0, 0, 0, 1], t = [0, 0, 0];
    function tr(x, y, z) {
      t = [R[0] * x + R[1] * y + R[2] * z + t[0], R[3] * x + R[4] * y + R[5] * z + t[1],
           R[6] * x + R[7] * y + R[8] * z + t[2]];
    }
    function rot(m) { R = mulMat3(R, m); }
    function ang(a, b, n, end) { return n < end ? a + (b - a) * pr.partial : a; }
    var pt = pr.playingTicks | 0, n1 = pt + 1, h = pr.baby ? 0.3 : 0.8, a;
    if (pt > 0) {
      if (pt < 8) {
        a = ang(90 * pt / 7, 90 * n1 / 7, n1, 8);
        tr(0, (h + 0.2) * (a / 90), 0); rot(rotX(-a));
      } else if (pt < 16) {
        a = ang(90 + 90 * (pt - 8) / 7, 90 + 90 * (n1 - 8) / 7, n1, 16);
        tr(0, h + 0.2 + (h - 0.2) * (a - 90) / 90, 0); rot(rotX(-a));
      } else if (pt < 24) {
        a = ang(180 + 90 * (pt - 16) / 7, 180 + 90 * (n1 - 16) / 7, n1, 24);
        tr(0, h + h * (270 - a) / 90, 0); rot(rotX(-a));
      } else if (pt < 32) {
        a = ang(270 + 90 * (pt - 24) / 7, 270 + 90 * (n1 - 24) / 7, n1, 32);
        tr(0, h * ((360 - a) / 90), 0); rot(rotX(-a));
      }
    }
    if (pr.sit > 0) {
      tr(0, 0.8 * pr.sit, 0); rot(rotX(90 * pr.sit)); tr(0, -1 * pr.sit, 0);
      if (pr.thunder) {
        rot(rotY(Math.cos(pr.age * 1.25) * Math.PI * 0.05));
        if (pr.baby) tr(0, 0.8, 0.55);
      }
    }
    if (pr.lie > 0) { tr(0, (pr.baby ? 0.5 : 1.3) * pr.lie, 0); rot(rotX(180 * pr.lie)); }
    return { R: R, t: t };
  };
  /** #1317 -- `CatEntityRenderer.setupTransforms`: translate(0.4,0.15,0.1)*s, then Rz(90*s). Pose {R,t} like the panda's, or null. */
  ER.catPoseOf = function (e, partial) {
    if (!e || e.type !== 'cat') return null;
    var s = ER.catAnim(e, 'sleepAnim', partial);
    if (!(s > 0)) return null;
    return { pose: { R: rotZ(90 * s), t: [0.4 * s, 0.15 * s, 0.1 * s] } };
  };
  /** #1761 -- Cod/Salmon/TropicalFishEntityRenderer.setupTransforms (.decomp): Ry(wobble) with wobble = k*4.3*sin(m*0.6*age)
   *  (salmon k,m = 1,1 in water, 1.3,1.7 out; cod/tropical 1,1), salmon translate(0,0,-0.4); out of water translate
   *  (0.2,0.1,0) [cod (0.1,0.1,-0.1)] then Rz(90). Pose {R,t} in the `catPose` slot, or null. */
  ER.fishPoseOf = function (e, partial) {
    if (!e || (e.type !== 'cod' && e.type !== 'salmon' && e.type !== 'tropical_fish')) return null;
    var age = (e.age || 0) + partial, dry = !e.inWater, sal = e.type === 'salmon';
    var k = sal && dry ? 1.3 : 1, m = sal && dry ? 1.7 : 1;
    var w = k * 4.3 * Math.sin(m * 0.6 * age);
    var t = [0, 0, sal ? -0.4 : 0], rz = 0;
    if (dry) {
      var d = e.type === 'cod' ? [0.1, 0.1, -0.1] : [0.2, 0.1, 0];
      t = [t[0] + d[0], t[1] + d[1], t[2] + d[2]]; rz = 90;
    }
    var Ry = rotY(w), R = rz ? mulMat3(Ry, rotZ(rz)) : Ry;
    return { pose: { R: R, t: [Ry[0] * t[0] + Ry[2] * t[2], Ry[3] * t[0] + Ry[5] * t[2] + t[1], Ry[6] * t[0] + Ry[8] * t[2]] } };
  };
  /** #1569 -- `SquidEntityRenderer.setupTransforms` (.decomp :23-31): translate(0,.5,0), Ry(180-yaw) [the engine's
   *  own yaw], Rx(tilt), Ry(roll), translate(0,-1.2,0) -- tilt/roll lerped prev->cur, degrees. Pose {R,t} in the
   *  `catPose` slot (applied after the flip+lift, before the yaw): R = Rx(tilt)*Ry(roll), t = R*(0,-1.2,0) + (0,.5,0). */
  ER.squidPoseOf = function (e, partial) {
    if (!e || (e.type !== 'squid' && e.type !== 'glow_squid')) return null;
    var tilt = ER.squidAngles(e, partial);
    var R = mulMat3(rotX(tilt.tilt), rotY(tilt.roll));
    return { pose: { R: R, t: [-1.2 * R[1] , -1.2 * R[4] + 0.5, -1.2 * R[7]] } };
  };
  /** #4785 -- `PhantomEntityRenderer.setupTransforms`: after the yaw, Rx(getPitch) (e.pitch is radians, vanilla's
   *  degrees * pi/180). Pose {R,t:0} in the `catPose` slot (after flip+lift, before yaw). Not lerped: the engine keeps no prev pitch. */
  ER.phantomPoseOf = function (e) {
    if (!e || e.type !== 'phantom' || !e.pitch) return null;
    return { pose: { R: rotX(e.pitch * 180 / Math.PI), t: [0, 0, 0] } };
  };
  /** #1757/#1957 -- Wither/Vex/Blaze renderers' getBlockLight override: always 15. */
  ER.fullBrightBlockLight = function (e) { return !!e && (e.type === 'wither' || e.type === 'wither_skull' || e.type === 'vex' || e.type === 'blaze' || e.type === 'magma_cube' || e.type === 'shulker_bullet' || e.type === 'dragon_fireball'); };
  /** #1570 -- `GlowSquidEntityRenderer.getBlockLight`: (int)clampedLerp(0,15,1-darkTicks/10); 15 if that is 15, else
   *  max(that, the ordinary block light `base`). Non-glow-squid: `base` unchanged. */
  ER.glowSquidBlockLight = function (e, base) {
    if (!e || e.type !== 'glow_squid') return base;
    var f = Math.fround(1 - Math.fround((e.darkTicksRemaining | 0) / 10));
    var v = Math.trunc(15 * (f < 0 ? 0 : f > 1 ? 1 : f));
    return v === 15 ? 15 : Math.max(v, base);
  };
  /** #2022 -- the inputs `GuardianEntityModel.setAngles` reads, from the entity's client animation fields. */
  ER.guardianAnim = function (e, partial) {
    var t = partial === undefined ? 1 : partial, Gd = NS.Guardian;
    var lp = function (a, b) { return (a || 0) + ((b || 0) - (a || 0)) * t; };
    var ext = lp(e.prevSpikesExtension, e.spikesExtension);
    var o = { age: (e.age || 0) + t, spikeK: (1 - ext) * 0.55, tail: lp(e.prevTailAngle, e.tailAngle), eyeX: 0, eyeY: 0 };
    var tgt = Gd && Gd.hasBeamTarget(e) ? Gd.getBeamTarget(e) : null, Ent = NS.Entities;
    var eyeOf = function (x) { return (x.y || 0) + (x === e ? (Ent && Ent.height ? Ent.height(e.type) : 0) * 0.5 : ER.eyeHeightStanding(x.type) || 0); };
    var c = tgt ? [tgt.x, eyeOf(tgt), tgt.z] : ER.camPos;
    if (c) {
      o.eyeY = c[1] - eyeOf(e) > 0 ? 0 : 1;
      var cp = Math.cos(e.xHeadRot || 0), fx = Math.sin(e.yaw || 0) * cp, fz = -Math.cos(e.yaw || 0) * cp, dx = e.x - c[0], dz = e.z - c[2], n = Math.sqrt(dx * dx + dz * dz) || 1;
      var d = fx * (dz / n) + fz * (-dx / n);   // rotateY(PI/2) of (dx,dz)/n = (dz,-dx)/n
      o.eyeX = Math.sqrt(Math.abs(d)) * 2 * Math.sign(d);
    }
    return o;
  };
  /** The lerped tilt/roll (degrees) and tentacle angle (radians) `SquidEntityRenderer` reads. */
  ER.squidAngles = function (e, partial) {
    var t = partial === undefined ? 1 : partial;
    var lp = function (a, b) { return (a || 0) + ((b || 0) - (a || 0)) * t; };
    return { tilt: lp(e.prevTiltAngle, e.tiltAngle), roll: lp(e.prevRollAngle, e.rollAngle),
             tentacle: lp(e.prevTentacleAngle, e.tentacleAngle) };
  };
  ER.pandaAnimOf = function (e, partial) {
    if (!e || e.type !== 'panda') return null;
    var lerp = function (a, b) { return (a || 0) + ((b || 0) - (a || 0)) * partial; };
    var baby = !!e.isBaby;
    var thunder = !!(NS.Panda && NS.Panda.isWorried(e) && NS.Sky && NS.Sky.isThundering && NS.Sky.isThundering());
    var o = { sit: lerp(e.lastSitProg, e.sitProg), lie: lerp(e.lastLieProg, e.lieProg),
              roll: baby ? 0 : lerp(e.lastRollProg, e.rollProg), sneezing: !!e.sneezing,
              sneezeProgress: e.sneezeProgress | 0, eating: !!e.eating, thunder: thunder,
              ask: e.askForBambooTicks | 0, playingTicks: e.playingTicks | 0, partial: partial,
              baby: baby, age: e.age || 0 };
    o.pose = ER.pandaPoseOf(o);
    return o;
  };
  function interpAngle(a, b, t) {
    // ModelUtil.interpolateAngle is float maths: (float) Math.PI is slightly above pi, so a pitch of exactly -90 deg meeting pi/2 wraps
    var f = Math.fround, d = f(f(b) - f(a)), P = f(Math.PI), T = f(2 * Math.PI);
    while (d < -P) d = f(d + T);
    while (d >= P) d = f(d - T);
    return f(f(a) + f(f(t) * d));
  }
  /** #1310 -- `PolarBearEntityModel.setAngles` (.decomp): the warning stand-up, ASSIGNMENTS made into deltas off the
   *  rest pose. `p` is progress^2; `base` is the generic quadruped delta (head pitch, leg swing). */
  ER.polarBearDelta = function (partName, base, p, baby, rest) {
    var q = 1 - p, P = Math.PI, o = base ? { rx: base.rx, ry: base.ry, rz: base.rz, dpx: base.dpx, dpy: base.dpy, dpz: base.dpz }
                                          : { rx: 0, ry: 0, rz: 0 };
    if (partName === 'body') {
      o.rx = (P / 2 - p * P * 0.35) - (rest.rx || 0); o.dpy = 9 * q + 11 * p - (rest.py || 0);
    } else if (partName === 'left_front_leg' || partName === 'right_front_leg') {
      o.rx -= p * P * 0.45; o.dpy = 14 * q - 6 * p - (rest.py || 0); o.dpz = -8 * q - 4 * p - (rest.pz || 0);
    } else if (partName === 'head') {
      o.rx += p * P * 0.15;
      o.dpy = (baby ? 10 * q - 9 * p : 10 * q - 14 * p) - (rest.py || 0);
      o.dpz = (baby ? -16 * q - 7 * p : -16 * q - 3 * p) - (rest.pz || 0);
    }
    return o;
  };
  /** #4629 -- `RabbitEntityModel.setAngles` (.decomp method_17117): ASSIGNED angles made into deltas off the rest pose.
   *  `jump` is getJumpProgress; null for parts the model leaves alone (body, tail, hind foot yaw...). */
  ER.rabbitDelta = function (partName, jump, netHeadYaw, headPitch, rest, base) {
    var jp = Math.sin(jump * Math.PI), y = netHeadYaw * DEG2RAD, P = headPitch * DEG2RAD, a;
    switch (partName) {
      case 'head': case 'nose': return { rx: P - (rest.rx || 0), ry: y - (rest.ry || 0), rz: 0 };
      case 'right_ear': case 'left_ear':
        return { rx: P - (rest.rx || 0), ry: y + (partName === 'left_ear' ? 1 : -1) * Math.PI / 12 - (rest.ry || 0), rz: 0 };
      case 'left_haunch': case 'right_haunch': a = (jp * 50 - 21) * DEG2RAD; break;
      case 'left_hind_foot': case 'right_hind_foot': a = jp * 50 * DEG2RAD; break;
      case 'left_front_leg': case 'right_front_leg': a = (jp * -40 - 11) * DEG2RAD; break;
      default: return base;
    }
    return { rx: a - (rest.rx || 0), ry: 0, rz: 0 };
  };
  /** #919 -- `PandaEntityModel.setAngles` (.decomp :60-125), ASSIGNMENTS made into deltas off the rest pose. */
  ER.pandaDelta = function (partName, base, netHeadYaw, headPitch, ctx) {
    var px = ctx.panda, age = ctx.ageInTicks || 0, rest = ctx.rest || {};
    var A = { head: Math.fround(headPitch * Math.fround(Math.PI / 180)), headYaw: netHeadYaw * DEG2RAD, headRoll: 0,
              body: rest.rx || 0, rfp: NaN, lfp: NaN, rhp: NaN, lhp: NaN, rfr: 0, lfr: 0, rhr: 0, lhr: 0 };
    if (partName === 'body') { A.body = rest.rx || 0; }
    var lsFront = base ? base.rx : 0;
    if (px.ask > 0) {
      A.headYaw = 0.35 * Math.sin(0.6 * age); A.headRoll = 0.35 * Math.sin(0.6 * age);
      A.rfp = -0.75 * Math.sin(0.3 * age); A.lfp = 0.75 * Math.sin(0.3 * age);
    }
    if (px.sneezing) {
      if (px.sneezeProgress < 15) A.head = -Math.PI / 4 * px.sneezeProgress / 14;
      else if (px.sneezeProgress < 20) A.head = -Math.PI / 4;   // (p-15)/5 is int division = 0
    }
    if (px.sit > 0) {
      A.body = interpAngle(A.body, 1.7407963, px.sit);
      A.head = interpAngle(A.head, Math.PI / 2, px.sit);
      A.rfr = -0.27079642; A.lfr = 0.27079642; A.rhr = 0.5707964; A.lhr = -0.5707964;
      if (px.eating) {
        A.head = Math.PI / 2 + 0.2 * Math.sin(age * 0.6);
        A.rfp = -0.4 - 0.2 * Math.sin(age * 0.6); A.lfp = A.rfp;
      }
      if (px.thunder) { A.head = 2.1707964; A.rfp = -0.9; A.lfp = -0.9; }
    }
    if (px.lie > 0) {
      A.rhp = -0.6 * Math.sin(age * 0.15); A.lhp = 0.6 * Math.sin(age * 0.15);
      A.rfp = 0.3 * Math.sin(age * 0.25); A.lfp = -0.3 * Math.sin(age * 0.25);
      A.head = interpAngle(A.head, Math.PI / 2, px.lie);
    }
    if (px.roll > 0) {
      A.head = interpAngle(A.head, 2.0561945, px.roll);
      A.rhp = -0.5 * Math.sin(age * 0.5); A.lhp = 0.5 * Math.sin(age * 0.5);
      A.rfp = 0.5 * Math.sin(age * 0.5); A.lfp = -0.5 * Math.sin(age * 0.5);
    }
    var rx0 = rest.rx || 0, rz0 = rest.rz || 0, v;
    function pick(p, r) {
      return { rx: (isNaN(p) ? (base ? base.rx : 0) : p - rx0) + 0, ry: 0, rz: r - rz0 };
    }
    switch (partName) {
      case 'head': return { rx: A.head - rx0, ry: A.headYaw - (rest.ry || 0), rz: A.headRoll - rz0 };
      case 'body': return { rx: A.body - rx0, ry: 0, rz: 0 };
      case 'right_front_leg': return pick(A.rfp, A.rfr);
      case 'left_front_leg': return pick(A.lfp, A.lfr);
      case 'right_hind_leg': return pick(A.rhp, A.rhr);
      case 'left_hind_leg': return pick(A.lhp, A.lhr);
    }
    return base;
  };

  ER.animOf = function (e, partial) {
    if (e && e.type === 'boat') return ER.boatAnimOf(e, partial);   // G18a-1 (#209)
    if (e && e.type === 'shulker_bullet') return ER.bulletAnimOf(e, partial);   // #3032
    if (e && e.type === 'wither_skull') return ER.skullAnimOf(e, partial);
    if (e && e.type === 'llama_spit') return ER.spitAnimOf(e, partial);   // #4599
    if (e && NS.MinecartRender && NS.MinecartRender.is(e.type)) return NS.MinecartRender.animOf(e, partial);   // #1564
    if (!e || e.maxHealth === undefined) return null;
    var so = e.animSpeedO || 0, sp = e.animSpeed || 0;
    var amount = so + (sp - so) * partial;
    if (amount > 1) amount = 1;
    // ⚠ D-422 — THESE TWO WERE HARD ZEROS AND THE COMMENT ABOVE SAID WHY: nothing turned a
    // mob's head. `Ai.LookControl` does now, so they are the real angles — `netHeadYaw` is the
    // head's offset FROM THE BODY (which is what the zero used to mean, correctly, when the two
    // could never differ) and `headPitch` is the head's own, in vanilla's sign, positive down.
    // ⚠ IN DEGREES. `setupAnim`'s two rotation arguments are degrees in vanilla and every
    // formula in `ER.setupAnimDelta` multiplies them by `DEG2RAD` on the way in; handing it
    // radians would rotate a head by a fifty-seventh of the angle it asked for, which is a bug
    // that looks exactly like "the head barely moves" rather than like a unit error.
    // D-430 — BOTH ENDS INTERPOLATED, and it has to be both: `netHeadYaw` is the head's offset
    // FROM THE BODY, so lerping the head against a body yaw that is still snapping would make
    // the head jerk by exactly the amount the body did, in the opposite direction.
    var head = ER.rotLerp(partial, (e.yHeadRotO === undefined) ? (e.yHeadRot || 0) : e.yHeadRotO,
                          e.yHeadRot || 0) - ER.yawAt(e, partial);
    head = head % (2 * Math.PI);
    if (head > Math.PI) head -= 2 * Math.PI;
    if (head <= -Math.PI) head += 2 * Math.PI;
    var an = {
      limbSwing: (e.animPos || 0) - sp * (1 - partial),
      limbSwingAmount: amount,
      netHeadYaw: head * RAD2DEG,
      headPitch: ER.rotLerp(partial, (e.xHeadRotO === undefined) ? (e.xHeadRot || 0) : e.xHeadRotO,
                            e.xHeadRot || 0) * RAD2DEG,
      // s98 -- `EntityModel.riding = entity.hasVehicle()` (LivingEntityRenderer.render): a raid
      // rider on its ravager (`Rd.startRiding` sets `e.riding`) sits; s116 -- generic for any
      // mob-on-mob pair now (jockeys, the lightning trap's skeleton_horse riders): whoever sets it.
      riding: !!e.riding,
      // G18e unit 2 — `LivingEntityRenderer` hands the model `entity.isBaby()` through
      // `AgeableListModel.young`, and the model draws its head and body groups with two
      // DIFFERENT transforms. The flag rides the anim object because that is already the
      // per-entity thing every emission path passes down; a second argument on
      // `emitMobLayer` would be a parallel channel for the same fact.
      baby: !!e.isBaby,
      // D-429 — what `animateZombieArms` needs. `ageInTicks` is vanilla's
      // `entity.tickCount + partialTick`, which is why the idle bob keeps running between ticks
      // instead of stepping twenty times a second. `attackTime` is QUEUE 0.2's
      // `ER.getHandSwingProgress(e, partial)` — real once `Ai.MeleeAttackGoal` swings it.
      ageInTicks: (e.age || 0) + partial,
      attackTime: ER.getHandSwingProgress(e, partial),
      leftHanded: !!e.leftHanded,   // s133: BipedEntityModel.getPreferredArm for animateArms
      // #7795 -- PlayerEntityModel (BipedEntityModel.setAngles) inputs: sneaking pose, getLeaningPitch (swimAmount lerp), swimming pose,
      // getRoll() > 4 (fall flying ticks) and the velocity for its arm/leg divisor.
      player: (e.type === 'player' || e.type === 'player_slim') ? { sneaking: !!e.sneaking, swimPose: !!e.swimming,
        lp: (e.lastSwimAmount || 0) + ((e.swimAmount || 0) - (e.lastSwimAmount || 0)) * partial, flying: !!e.fallFlying && (e.fallFlyTicks | 0) > 4,
        v2: (e.vx || 0) * (e.vx || 0) + (e.vy || 0) * (e.vy || 0) + (e.vz || 0) * (e.vz || 0), usingItem: !!e.usingItem } : null,
      aggressive: !!e.aggressive,
      // #1749 -- EndermanEntityRenderer: model.carryingBlock = getCarriedBlock() != null; model.angry = isAngry() (ANGRY tracker == has a target).
      enderman: e.type === 'enderman' ? { carrying: e.carriedBlock !== undefined && e.carriedBlock !== null, angry: !!e.target } : null,
      // #1291 -- SkeletonEntityModel.setAngles: isAttacking() with no bow in the main hand.
      // #2907 -- DrownedEntityModel THROW_SPEAR: trident in the main hand while isAttacking().
      trident: e.type === 'drowned' && !!e.attacking && ER.holdsTrident(e),
      // DrownedEntityModel.setAngles leaning block: getLeaningPitch(partial) (lerp of lastLeaningPitch/leaningPitch)
      drownedLp: e.type === 'drowned' ? (e.lastLeaningPitch || 0) + ((e.leaningPitch || 0) - (e.lastLeaningPitch || 0)) * partial : 0,
      drownedSwim: e.type === 'drowned' && !!e.swimming,
      // SkeletonEntityModel.animateModel: bow in the main hand + isAttacking() -> ArmPose.BOW_AND_ARROW
      skelBow: !!e.attacking && /^(skeleton|stray|player|player_slim)$/.test(e.type) && !!(NS.Ai && NS.Ai.holdsBow && NS.Ai.holdsBow(e)),
      skelMelee: !!e.attacking && /^(skeleton|stray|wither_skeleton)$/.test(e.type) && !(NS.Ai && NS.Ai.holdsBow && NS.Ai.holdsBow(e)),
      // #651 -- `IllagerEntity.getState() == SPELLCASTING` (`SpellcastingIllagerEntity.isSpellcasting`,
      // spellTicks > 0): `ER.illagerSpellArm` poses the arms and `ER.ILLAGER_ARM_HIDE` swaps parts.
      spellcasting: !!(NS.Spell && NS.Spell.isSpellcasting(e)),
      illager: ER.illagerStateOf(e), illagerCharge: e.crossbowCharge || 0,
      mainEmpty: ER.illagerMainEmpty(e),
      vex: e.type === 'vex' ? { charging: !!e.charging, leftHanded: !!e.leftHanded, mainEmpty: ER.mainHandEmpty(e) } : null,   // #760
      // loop/renderres-s104 -- chicken wing roll / sheep eat-grass neck+head pose,
      // computed once here (not per-part in `ER.setupAnimDelta`) because both read
      // interpolated ENTITY state, the same reason `netHeadYaw`/`headPitch` above do.
      chickenWingRoll: ER.chickenWingRoll(e, partial),
      feline: (e.type === 'cat' || e.type === 'ocelot') ? { crouch: !!e.crouching, sprint: !!e.sprinting,
        sitting: e.type === 'cat' && !!e.sitting && !e.sleeping,   // CatEntity.isInSittingPose (sleeping cats lie, not sit)
        sleep: ER.catAnim(e, 'sleepAnim', partial), tail: ER.catAnim(e, 'tailCurlAnim', partial), headDown: ER.catAnim(e, 'headDownAnim', partial) } : null,
      catPose: ER.catPoseOf(e, partial) || ER.squidPoseOf(e, partial) || ER.phantomPoseOf(e) || ER.fishPoseOf(e, partial),
      squid: (e.type === 'squid' || e.type === 'glow_squid') ? ER.squidAngles(e, partial) : null,
      sheepEatGrass: ER.sheepEatGrass(e, partial),
      // #1226 -- ParrotEntityModel's Pose (getPose) + ParrotEntityRenderer.getFlapAngle.
      parrot: ER.parrotAnim(e, partial),
      bat: e.type === 'bat' ? { roosting: !!e.roosting } : null,
      // #4741 -- BeeEntityModel: animateModel's bodyPitch (lerped) + hasStung; setAngles' grounded-and-still / anger branches.
      bee: e.type === 'bee' ? { still: !!e.onGround && ((e.vx || 0) * (e.vx || 0) + (e.vy || 0) * (e.vy || 0) + (e.vz || 0) * (e.vz || 0)) < 1.0E-7,
        angry: e.angerTime > 0, stung: !!e.hasStung,
        bodyPitch: (e.lastBodyPitch || 0) + ((e.bodyPitch || 0) - (e.lastBodyPitch || 0)) * partial } : null,
      // #584 -- Cod/Salmon/Tropical*/Pufferfish `setAngles` read isTouchingWater + ageInTicks only.
      fish: (e.type === 'cod' || e.type === 'salmon' || e.type === 'pufferfish' || e.type === 'tropical_fish')
        ? { water: !!e.inWater, puffer: e.type === 'pufferfish' } : null,
      // s134 -- HoglinEntityModel.setAngles reads getMovementCooldownTicks() (an int, not lerped).
      slime: e.type === 'magma_cube' ? { stretch: ER.slimeStretch(e, partial) } : null,
      hoglin: (e.type === 'hoglin' || e.type === 'zoglin') ? { cd: e.movementCooldown | 0 } : null,
      phantomId: e.type === 'phantom' ? (e.id | 0) : 0,
      dragon: (e.type === 'ender_dragon' && e.dragon && e.dragon.latestSegment >= 0) ? ER.dragonAnim(e.dragon, partial) : null,   // #1567
      witch: e.type === 'witch' ? { id: e.id | 0, drinking: !!e.witchDrinking || !!(NS.Equip && NS.Items && NS.Items.ready && NS.Equip.getEquipped(e, NS.Items.MAINHAND)) } : null,
      // #933 -- StriderEntityModel.setAngles reads hasPassengers() (body pitch/yaw 0 while ridden).
      // #7788 -- AxolotlEntityModel.setAngles mixes toward the pose with the entity's cached angles (getModelAngles).
      axolotl: e.type === 'axolotl' ? ER.axolotlAnim(e, (e.age || 0) + partial, head * RAD2DEG, ER.rotLerp(partial, (e.xHeadRotO === undefined) ? (e.xHeadRot || 0) : e.xHeadRotO, e.xHeadRot || 0) * RAD2DEG) : null,
      strider: e.type === 'strider' ? { ridden: !!(NS.Mount && NS.Mount.isRidden && NS.Mount.isRidden(e)) } : null,
      // #843 -- RavagerEntityModel.animateModel reads getAttackTick/getStunTick/getRoarTick + tickDelta.
      // #1310 -- PolarBearEntityModel.setAngles: p = getWarningAnimationProgress(partial)^2.
      polarBear: (e.type === 'polar_bear' && NS.PolarBear && NS.PolarBear.getWarningAnimationProgress)
        ? (function (w) { return { p: w * w }; })(NS.PolarBear.getWarningAnimationProgress(e, partial)) : null,
      ravager: e.type === 'ravager' ? { at: e.ravagerAttackTick | 0, st: e.ravagerStunTick | 0, rt: e.ravagerRoarTick | 0, pt: partial || 0 } : null,
      // #727 -- PiglinEntityModel.setAngles: ATTACKING_WITH_MELEE_WEAPON is the brute's
      // `isAttacking() && isHoldingTool()` (PiglinBruteEntity.getActivity).
      piglinDance: e.type === 'piglin' && !!(NS.Piglin && NS.Piglin.isDancing(e)),   // PiglinActivity.DANCING (getActivity's first test)
      piglinPose: (e.type === 'piglin' && !(NS.Piglin && NS.Piglin.isDancing(e)) && NS.Piglin && NS.Piglin.isAdmiring && NS.Piglin.isAdmiring(e)) ? 'admire' : null,   // ADMIRING_ITEM (crossbow hold/charge states: ER.piglinPoseDelta, not wired to entities yet)
      piglinMelee: e.type === 'piglin_brute' && !!(e.aggressive || e.target) && ER.holdsTool(e),
      // #2022 -- GuardianEntityModel.setAngles inputs (spikesExtension/tailAngle lerped, eye pivot toward camera/beam target).
      guardian: (e.type === 'guardian' || e.type === 'elder_guardian') ? ER.guardianAnim(e, partial) : null,
      // #720 -- DolphinEntityModel.setAngles: `getVelocity().horizontalLengthSquared() > 1.0E-7`.
      dolphin: (e.type === 'dolphin')
        ? { moving: ((e.vx || 0) * (e.vx || 0) + (e.vz || 0) * (e.vz || 0)) > 1.0E-7 } : null,
      // #1256 -- TurtleEntityModel.setAngles: touchingWater/onGround/isDiggingSand, plastron = !child && hasEgg.
      // #4629 -- RabbitEntity.getJumpProgress(delta) = jumpDuration == 0 ? 0 : (jumpTicks + delta) / jumpDuration.
      rabbit: (e.type === 'rabbit')
        ? { jump: e.rabbitJumpDuration ? ((e.rabbitJumpTicks || 0) + partial) / e.rabbitJumpDuration : 0 } : null,
      turtle: (e.type === 'turtle')
        ? { inWater: !!e.inWater, onGround: !!e.onGround, digging: !!e.diggingSand, belly: !e.isBaby && !!e.hasEgg } : null,
      // #910 -- WolfEntityModel's inputs: sitting pose, hasAngerTime, getTailAngle (the renderer's
      // getAnimationProgress), getBegAnimationProgress (lerped, ticked by ER.wolfBegTick).
      wolf: (e.type === 'wolf') ? ER.wolfAnim(e, partial) : null,
      // #1284 -- FoxEntityModel's inputs (sleeping/sitting/sneaking flags, getHeadRoll, getBodyRotationHeightOffset).
      fox: (e.type === 'fox') ? ER.foxAnim(e, partial) : null,
      // #1352 -- HorseEntityModel (horse/donkey/mule/zombie_horse/skeleton_horse) inputs.
      horse: ER.HORSE_MODEL[e.type] ? ER.horseAnim(e, partial) : null,
      // D-773 cloud unit (tender-carson-7zokog) -- ShulkerEntityModel.setAngles' inputs (lid open
      // progress, age, the raw head yaw) and setupTransforms' attached-face matrix (07zzl).
      shulker: (e.type === 'shulker' && NS.ShulkerDraw && NS.ShulkerDraw.ready)
        ? NS.ShulkerDraw.animOf(e, partial, (e.age || 0) + partial,
            ER.rotLerp(partial, (e.yHeadRotO === undefined) ? (e.yHeadRot || 0) : e.yHeadRotO, e.yHeadRot || 0))
        : null,
      // D-787 residue (G18 leftover, QUEUE 0.00 part 2) -- \`WitherEntityModel.method_17128\`'s
      // \`rotateHead\`: \`getHeadYaw(i) - bodyYaw\` (degrees, already relative). No AI unit has
      // built \`WitherEntity.tickMovement\`'s own \`sideHeadYaws\`/\`sideHeadPitches\` tracking yet
      // (\`07zzm_wither.js\`'s own OWED note) -- \`e.witherSideYawRel\`/\`e.witherSidePitch\` are read
      // if a future unit ever sets them and default to 0 otherwise, which is NOT a guess: it is
      // vanilla's own untargeted idle state (.decomp WitherEntity.java:199, \`sideHeadYaws[i] =
      // getNextAngle(sideHeadYaws[i], this.bodyYaw, 10)\` -- relative yaw settles to 0).
      wither: (e.type === 'wither') ? { sideYawRel: e.witherSideYawRel || null,
                                         sidePitch: e.witherSidePitch || null } : null,
      // loop/vsleep -- `null` for every mob but a sleeping villager (`ER.sleepPoseOf`'s own
      // header for every number/citation); `ER.emitMobLayer`/`ER.build` both read this off the
      // anim object rather than taking a parallel argument, the same reason chickenWingRoll/
      // sheepEatGrass do two lines up.
      sleepPose: (e.type === 'squid' || e.type === 'glow_squid') ? null : ER.deathPoseOf(e, partial) || ER.spawnerPoseOf(e, partial) || ER.sleepPoseOf(e, partial),
      // #733 -- IronGolemEntityModel's own inputs (getAttackTicksLeft/getLookingAtVillagerTicks, ints).
      // #4058 -- MerchantEntity.getHeadRollingTimeLeft()>0 (VillagerResemblingModel.setAngles :72-86): head roll/pitch override.
      vleg: /^(villager|wandering_trader|witch)$/.test(e.type),   // VillagerResemblingModel.setAngles: legs x0.5, no riding branch
      headShake: (e.type === 'villager' || e.type === 'wandering_trader') && e.headRollingTimeLeft > 0,
      golem: e.type === 'iron_golem' ? { look: e.lookingAtVillagerTicks | 0, attack: e.attackTicksLeft | 0,
                                         partial: partial } : null,
      // #1004 -- MagmaCubeEntityModel.method_17098's inputs (lerped, clamped stretch).
      slime: e.type === 'magma_cube' ? { stretch: ER.slimeStretch(e, partial) } : null,
      // #731 -- iron golem body roll (degrees about Z), 0 for everything else.
      roll: ER.golemRoll(e, partial),
      // #919 -- PandaEntityRenderer.setupTransforms + PandaEntityModel inputs (null for non-pandas).
      panda: ER.pandaAnimOf(e, partial)
    };
    if (e.type === 'armor_stand' && NS.ArmorStand) {
      // #4497 ArmorStandArmorEntityModel/ArmorStandEntityModel.setAngles: every part takes its Pose triple (degrees -> radians);
      // hat copies head, the three body sticks copy body, base_plate yaw = -body yaw. ponytail: plate sign not eyeballed in-GL.
      var AS = NS.ArmorStand, D = Math.PI / 180, K = { head: 'Head', hat: 'Head', body: 'Body', right_body_stick: 'Body', left_body_stick: 'Body',
        shoulder_stick: 'Body', left_arm: 'LeftArm', right_arm: 'RightArm', left_leg: 'LeftLeg', right_leg: 'RightLeg' };
      an.baby = !!e.small;   // ArmorStandEntity.isBaby() == isSmall()
      an.deltaFor = function (n) {
        if (n === 'base_plate') return { rx: 0, ry: -ER.dragonYaw(e, partial), rz: 0 };
        var v = K[n] && AS.pose(e, K[n]);
        return v ? { rx: v[0] * D, ry: v[1] * D, rz: v[2] * D } : null;
      };
    }
    return an;
  };

  /**
   * #6736 -- `ElytraEntityModel.setAngles` (.decomp): rest fold pi/12 pitch, -pi/12 roll; fall flying lerps pitch toward pi/9
   * and roll toward -pi/2 by f = 1 - (-vy/|v|)^1.5 (f = 1 unless descending); a sneaking pose is pitch 2pi/9, roll -pi/4,
   * yaw 0.08726646, pivotY 3. A player eases its stored elytraPitch/Yaw/Roll 0.1 of the way per call; others take the target.
   * The right wing mirrors yaw/roll; the feature's translate(0, 0, 0.125) is 2 model units of pivot z. Returns `base` (the
   * host's ER.animOf) with `deltaFor` replaced.
   */
  ER.elytraTarget = function (e) {
    var K = 0.2617994, t = { pitch: K, yaw: 0, roll: -K, py: 0 };
    if (e.fallFlying) {
      var f = 1, vx = e.vx || 0, vy = e.vy || 0, vz = e.vz || 0;
      if (vy < 0) f = 1 - Math.pow(-vy / Math.sqrt(vx * vx + vy * vy + vz * vz), 1.5);
      t.pitch = f * 0.34906584 + (1 - f) * K; t.roll = f * -1.5707964 + (1 - f) * -K;
    } else if (e.sneaking || e.crouching) {
      t.pitch = 0.6981317; t.roll = -0.7853982; t.py = 3; t.yaw = 0.08726646;
    }
    return t;
  };
  ER.elytraAnim = function (e, partial) {
    var base = ER.animOf(e, partial), t = ER.elytraTarget(e), K = 0.2617994;
    if (e.type === 'player' || e.type === 'player_slim') {
      e.elytraPitch = (e.elytraPitch || 0) + (t.pitch - (e.elytraPitch || 0)) * 0.1;
      e.elytraYaw = (e.elytraYaw || 0) + (t.yaw - (e.elytraYaw || 0)) * 0.1;
      e.elytraRoll = (e.elytraRoll || 0) + (t.roll - (e.elytraRoll || 0)) * 0.1;
      t.pitch = e.elytraPitch; t.yaw = e.elytraYaw; t.roll = e.elytraRoll;
    }
    var a = {};
    for (var k in base) a[k] = base[k];
    a.deltaFor = function (n) {
      if (n === 'left_wing') return { rx: t.pitch - K, ry: t.yaw, rz: t.roll + K, dpy: t.py, dpz: 2 };
      if (n === 'right_wing') return { rx: t.pitch - K, ry: -t.yaw, rz: -t.roll - K, dpy: t.py, dpz: 2 };
      return null;
    };
    return a;
  };

  /** #910 -- WolfEntity.tick's begAnimationProgress (+= (target - p) * 0.4, once per tick). */
  ER.wolfBegTick = function (e) {
    if (e.begTickAge === (e.age || 0)) return;
    e.begTickAge = e.age || 0;
    e.begO = e.beg || 0;
    e.beg = (e.beg || 0) + ((e.begging ? 1 : 0) - (e.beg || 0)) * 0.4;
  };
  /** #910 -- WolfEntity.getTailAngle: angry 1.5393804; tamed (0.55 - (max - hp) * 0.02) * PI; else PI / 5. */
  ER.wolfTailAngle = function (e) {
    if ((e.angerTime | 0) > 0) return 1.5393804;
    if (!e.tamed) return Math.PI / 5;
    return (0.55 - ((e.maxHealth || 20) - (e.health === undefined ? 20 : e.health)) * 0.02) * Math.PI;
  };
  ER.wolfAnim = function (e, partial) {
    ER.wolfBegTick(e);
    var bo = e.begO || 0, b = e.beg || 0, WS = NS.WolfShake;
    var sh = function (off) { return (WS && e.furWet) ? WS.shakeAnimation(e, partial, off) : 0; };   // #955 getShakeAnimationProgress
    return { sitting: !!e.sitting, angry: (e.angerTime | 0) > 0, tailAngle: ER.wolfTailAngle(e),
             headRoll: (bo + (b - bo) * partial) * 0.15 * Math.PI + sh(0),
             neckRoll: sh(-0.08), bodyRoll: sh(-0.16), tailRoll: sh(-0.2) };
  };
  /**
   * #1284 -- FoxEntity.tickMovement's headRollProgress (+= (rolling ? 1 : 0 - p) * 0.4) and extraRollingHeight
   * (+0.2 to 3 while crouching, else 0), once per tick (FoxEntity.java:527-543), then the lerped getHeadRoll /
   * getBodyRotationHeightOffset the model reads. `legPhase` is the model's own legPitchModifier (+0.67 per setAngles).
   */
  ER.foxAnim = function (e, partial) {
    if (e.foxTickAge !== (e.age || 0)) {
      e.foxTickAge = e.age || 0;
      e.foxHrO = e.foxHr || 0; e.foxXhO = e.foxXh || 0;
      e.foxHr = (e.foxHr || 0) + ((e.rollingHead ? 1 : 0) - (e.foxHr || 0)) * 0.4;
      e.foxXh = e.crouching ? Math.min(3, (e.foxXh || 0) + 0.2) : 0;
    }
    var lp = e.foxHrO || 0, lx = e.foxXhO || 0, walking = !!e.walking;
    if (walking) e.foxLeg = (e.foxLeg || 0) + 0.67;
    return { sleeping: !!e.sleeping && !e.crouching, sitting: !!e.sitting, sneaking: !!e.crouching, walking: walking,
             headRoll: (lp + ((e.foxHr || 0) - lp) * partial) * 0.11 * Math.PI,
             bodyOff: lx + ((e.foxXh || 0) - lx) * partial, leg: e.foxLeg || 0, age: (e.age || 0) + partial };
  };
  /**
   * #1352 -- HorseBaseEntity.tickMovement's three animation progresses (eatingGrass / angry / eating), once per tick
   * (.decomp HorseBaseEntity 612-660), lerped by partial as getEatingGrassAnimationProgress & co. The horse flags
   * come from e.eatingGrass / e.angry / e.eating; `tailWagTicks` is vanilla's own public field (nonzero = wag).
   */
  ER.HORSE_MODEL = { horse: 1, donkey: 1, mule: 1, zombie_horse: 1, skeleton_horse: 1 };
  ER.HORSE_ADULT_LEGS = { left_front_leg: 1, right_front_leg: 1, left_hind_leg: 1, right_hind_leg: 1 };
  ER.HORSE_BABY_LEGS = { left_front_baby_leg: 1, right_front_baby_leg: 1, left_hind_baby_leg: 1, right_hind_baby_leg: 1 };
  ER.HORSE_SADDLE = { saddle: 1, left_saddle_mouth: 1, right_saddle_mouth: 1, head_saddle: 1, mouth_saddle_wrap: 1 };
  ER.HORSE_STRAPS = { left_saddle_line: 1, right_saddle_line: 1 };
  ER.horseAnim = function (e, partial) {
    if (e.horseTickAge !== (e.age || 0)) {
      e.horseTickAge = e.age || 0;
      var g = e.hgP || 0, an = e.haP || 0, ea = e.heP || 0;
      e.hgO = g; e.haO = an; e.heO = ea;
      if (e.eatingGrass) g = Math.min(1, g + (1 - g) * 0.4 + 0.05); else g = Math.max(0, g + ((0 - g) * 0.4 - 0.05));
      if (e.angry) {
        g = 0; e.hgO = 0;
        an = Math.min(1, an + (1 - an) * 0.4 + 0.05);
      } else {
        an = Math.max(0, an + ((0.8 * an * an * an - an) * 0.6 - 0.05));
      }
      if (e.eating) ea = Math.min(1, ea + (1 - ea) * 0.7 + 0.05); else ea = Math.max(0, ea + ((0 - ea) * 0.7 - 0.05));
      e.hgP = g; e.haP = an; e.heP = ea;
    }
    var lp = function (o, n) { return (o || 0) + ((n || 0) - (o || 0)) * partial; };
    var saddled = !!(NS.Mount && NS.Mount.isSaddled ? NS.Mount.isSaddled(e) : e.saddled);
    return { saddled: saddled, passengers: !!e.rider, baby: !!e.isBaby, inWater: !!e.inWater,
             grass: lp(e.hgO, e.hgP), angry: lp(e.haO, e.haP), eating: lp(e.heO, e.heP), tailWag: (e.tailWagTicks | 0) !== 0 };
  };
  /**
   * #1352 -- HorseEntityModel.animateModel (.decomp), as deltas from the golden rest pose: head_parts (0,4,-12) pitch PI/6,
   * body pitch 0, tail (0,-5,2) pitch PI/6, legs pitch 0 with front pivots (y14, z-12), hind (y14, z7). Every value
   * there is an ASSIGNMENT, so delta = target - rest. Baby legs copy their adult leg's pitch and pivots.
   */
  ER.horseDelta = function (partName, l, a, netHeadYaw, headPitch, ageInTicks, H) {
    var P = Math.PI, c = Math.cos, s = Math.sin, base = partName.replace('_baby', '');
    var an = H.angry, eg = H.grass, ea = H.eating, k = 1 - Math.max(an, eg), n = 1 - an;
    var yw = Math.max(-20, Math.min(20, netHeadYaw)) * P / 180, hp = headPitch * P / 180;
    if (a > 0.2) hp += c(l * 0.4) * 0.15 * a;
    var age = ageInTicks, lw = c((H.inWater ? 0.2 : 1) * l * 0.6662 + P), l17 = lw * 0.8 * a, c20 = c(age * 0.6 + P);
    switch (base) {
      case 'head_parts':
        return { rx: an * (P / 12 + hp) + eg * (2.1816616 + s(age) * 0.05) + k * (P / 6 + hp + ea * s(age) * 0.05) - P / 6,
                 ry: an * yw + k * yw, rz: 0, dpy: an * -4 + eg * 11 + k * 4 - 4, dpz: an * -4 + eg * -12 + k * -12 + 12 };
      case 'body': return { rx: an * -P / 4, ry: 0, rz: 0 };
      case 'left_front_leg': case 'right_front_leg': {
        var f = base === 'left_front_leg' ? (-P / 3 + c20) * an + l17 * n : (-P / 3 - c20) * an - l17 * n;
        return { rx: f, ry: 0, rz: 0, dpy: 2 * an + 14 * n - 14, dpz: -6 * an - 10 * n + 12 };
      }
      case 'left_hind_leg': return { rx: P / 12 * an - lw * 0.5 * a * n, ry: 0, rz: 0 };
      case 'right_hind_leg': return { rx: P / 12 * an + lw * 0.5 * a * n, ry: 0, rz: 0 };
      case 'tail': return { rx: a * 0.75, ry: H.tailWag ? c(age * 0.7) : 0, rz: 0, dpy: a, dpz: a * 2 };
    }
    return null;
  };
  ER.FOX_LEGS = { right_hind_leg: 1, left_hind_leg: 1, right_front_leg: 1, left_front_leg: 1 };
  /** #955 -- WolfEntityRenderer.render: isFurWet() -> setColorMultiplier(b,b,b), b = getFurWetBrightnessMultiplier. */
  ER.wolfWetTint = function (e, partial) {
    if (e.type !== 'wolf' || !e.furWet || !NS.WolfShake) return null;
    var b = NS.WolfShake.wetBrightness(e, partial);
    return [b, b, b];
  };

  /** #168 -- `MobSpawnerBlockEntityRenderer.render` as virtual mob entities (07zs `Spawner.display`):
   *  origin (x+.5, y+.2, z+.5), yaw = -spin*10 degrees (`YP.rotationDegrees(spin)` is the engine's
   *  yaw negated), `displayScale` folded in by `ER.renderScaleOf`. */
  /** #5186 -- the spawner mob's rotateY(spin*10) then rotateX(-30), in `sleepPose`'s shape (as drownedSwimPoseOf:
   *  vanilla Ry*Rx*Z180 is the engine's Y * rotX(-angle)). */
  ER.spawnerPoseOf = function (e, partial) {
    if (!e || !e.isSpawnerDisplay) return null;
    var yaw = ER.bodyYawAt(e, partial), c = Math.cos(yaw), sn = Math.sin(yaw);
    return { R: mulMat3([c, 0, sn, 0, 1, 0, -sn, 0, c], rotX(30)), dx: 0, dy: 0, dz: 0 };
  };
  ER.spawnerDisplays = function (eX, eZ, partial) {
    var BE = NS.BlockEntities, S = NS.Spawner, out = [];
    if (!BE || !BE.ready || !BE.forEachNear || !S || !S.display) return out;
    BE.forEachNear(Math.floor(eX), Math.floor(eZ), Math.ceil(ER.RANGE / 16) + 1, function (b) {
      if (b.type !== 'mob_spawner' || !b.entity || BE.stale(b)) return;
      var type = NS.Entities && NS.Entities.bare ? NS.Entities.bare(b.entity) : b.entity;
      var dim = NS.Entities && NS.Entities.dimensions ? NS.Entities.dimensions(type) : null;
      var d = S.display(b, partial, dim);
      var x = b.x + 0.5, y = b.y + d.lift, z = b.z + 0.5;
      out.push({ type: type, x: x, y: y, z: z, px: x, py: y, pz: z, yaw: -d.spinDeg, yawO: -d.spinDeg,
                 age: b.renderAge || 0, removed: false, displayScale: d.scale, isSpawnerDisplay: true,
                 width: dim ? dim.width : 0.6, height: dim ? dim.height : 1.8 });
    });
    return out;
  };

  /** PlayerEntityRenderer: an invisible player is drawn translucent (entity translucent, alpha 0.15) for a spectator viewer. */
  ER.GHOST_ALPHA = 0.15;
  ER.ghostAlpha = function (e, viewer) {
    var Gm = NS.Gamemode;
    var spec = !!(viewer && Gm && Gm.isSpectator && Gm.isSpectator(viewer));
    return spec && e && (e.invisible || (Gm.isSpectator(e))) ? ER.GHOST_ALPHA : 1;
  };

  /** `Entity.isInvisible()` for a mob (the status effect; NOT a player, which has its own path). */
  ER.invisibleMob = function (e) {
    var ST = NS.Effects;
    if (e && e.type === 'armor_stand' && e.invisible) return true;   // #4497 getRenderLayer == null for an invisible stand
    return !!(e && ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'));
  };

  /** #4497 ArmorStandEntityModel.setAngles: arms visible only with ShowArms, base plate hidden by NoBasePlate. */
  ER.standHide = function (e) {
    if (!e || e.type !== 'armor_stand') return null;
    var h = {};
    if (!e.showArms) { h.left_arm = 1; h.right_arm = 1; }
    if (e.noBasePlate) h.base_plate = 1;
    return h;
  };

  /** LlamaDecorFeatureRenderer.method_4191 texKey (carpet dye, else the trader blanket), or null. No isInvisible check (#3927). */
  ER.llamaDecorKey = function (e) {
    var Mn = NS.Mount;
    if (Mn && Mn.hasDecorSlot && Mn.hasDecorSlot(e) && e.carpetColor !== undefined && e.carpetColor !== null && e.carpetColor >= 0)
      return e.carpetColor === 0 ? 'decor#null' : 'decor#null#' + e.carpetColor;
    return e.type === 'trader_llama' ? 'decor#null#16' : null;
  };

  /** #1017 -- IllusionerEntityRenderer.method_3991's ghost offsets (world axes, blocks) for an
   *  invisible illusioner: `method_7065(partial)` + `cos(i + t*0.5)*0.025`, `cos(i + t*0.75)*0.0125`,
   *  `cos(i + t*0.7)*0.025` with t = `getAnimationProgress` (age + partial). [] for any other mob. */
  ER.mirrorCopies = function (e, partial) {
    var SP = NS.Spell;
    if (!e || e.type !== 'illusioner' || !SP || !SP.mirrorOffsets) return [];
    var o = SP.mirrorOffsets(e, partial), t = (e.age || 0) + partial, r = [];
    for (var i = 0; i < o.length; i++) {
      r.push([o[i][0] + Math.cos(i + t * 0.5) * 0.025,
              o[i][1] + Math.cos(i + t * 0.75) * 0.0125,
              o[i][2] + Math.cos(i + t * 0.7) * 0.025]);
    }
    return r;
  };

  /** Every entity this frame will draw, already positioned. Also used by the checks. */
  /**
   * #2724 -- the camera player as a pseudo mob entity (`player`, or `player_slim` when `P.slim`; the
   * Steve/Alex skin sheets). Null in first person. Body yaw = look yaw (vanilla's yBodyRot lags it;
   * ponytail: head/body split when a remote-player entity needs it). Limb swing from `P.walkDist`.
   */
  var playerE = { removed: false, maxHealth: 20, health: 20 };
  ER.playerEntity = function (partial, force) {
    var P = NS.Player;
    if (!P || (!force && (!(P.thirdPerson | 0) || P.sleeping))) return null;
    var e = playerE, t = partial === undefined ? 1 : partial, yawO = P.yawO === undefined ? P.yaw : P.yawO;
    e.type = P.slim ? 'player_slim' : 'player';
    e.px = e.x = P.ex; e.py = e.y = P.ey; e.pz = e.z = P.ez;
    e.yaw = e.yBodyRot = e.yHeadRot = P.yaw; e.yawO = e.yBodyRotO = e.yHeadRotO = yawO;
    e.xHeadRot = (P.pitch || 0) * -1; e.xHeadRotO = e.xHeadRot;   // engine +pitch looks up; model headPitch is down-positive
    var wd = P.walkDist || 0, wo = P.walkDistO === undefined ? wd : P.walkDistO;
    e.animPos = wd * (4 / 0.6); e.animSpeed = Math.min(1, (wd - wo) / 0.6 * 4); e.animSpeedO = e.animSpeed;
    e.hurtTime = P.hurtTime || 0; e.deathTime = P.deathTime || 0;
    e.sneaking = !!P.sneaking;
    // #6734 -- HeldItemFeatureRenderer + handSwingProgress: the swing (Hand's tick-stepped attackAnim), the
    // hotbar/offhand stacks and the bow draw (BOW_AND_ARROW pose while the bow is being used).
    var H = NS.Hand, Iv = NS.Inventory, IT = NS.Items, sl = P.inventory && P.inventory.slots;
    if (H && H.attackAnim !== undefined) { e.handSwingProgress = H.attackAnim || 0; e.lastHandSwingProgress = H.prevAttackAnim || 0; }
    else e.handSwingProgress = e.lastHandSwingProgress = 0;
    if (sl && IT && IT.ready) {
      var main = sl[P.slot | 0], off = Iv && Iv.OFFHAND !== undefined ? sl[Iv.OFFHAND] : null;
      e.equip = []; e.equip[IT.MAINHAND] = main && main.i >= 0 ? main : null; e.equip[IT.OFFHAND] = off && off.i >= 0 ? off : null;
      e.usingItem = !!P.usingItem;
      var isBow = !!(P.usingItem && main && main.i >= 0 && IT.nameOf(main.i) === 'bow');
      e.bowDrawing = isBow; e.bowCharge = isBow ? Math.min(1, (P.useTicks || 0) / 20) : 0;
      e.attacking = isBow;
    }
    e.swimming = !!P.swimming; e.crawling = !!P.crawling; e.fallFlying = !!P.fallFlying; e.inWater = !!P.inWater;
    e.swimAmount = P.swimAmount || 0; e.lastSwimAmount = P.lastSwimAmount || 0; e.fallFlyTicks = P.fallFlyTicks | 0; e.riptideTicks = P.riptideTicks | 0;
    e.vx = P.vx || 0; e.vy = P.vy || 0; e.vz = P.vz || 0;
    if (sl && IT && IT.ready) {   // #6736 the chest slot (only an elytra is read from it here)
      var chs = sl[NS.Inventory.ARMOR_START + 2];
      if (!e.equip) e.equip = [];
      e.equip[IT.CHEST] = chs && chs.i >= 0 && IT.nameOf(chs.i) === 'elytra' ? chs : null;
    }
    return e;
  };

  /**
   * #5785 -- the player as `InventoryScreen.drawEntity` sees it: `ER.playerEntity` forced on in first person,
   * with the four worn armour pieces (inventory armour slots 0..3 = feet..head) in `equip` for the armour layers.
   */
  ER.playerPreviewEntity = function () {
    var e = ER.playerEntity(1, true), P = NS.Player, IT = NS.Items, sl = P && P.inventory && P.inventory.slots;
    if (!e || !sl || !IT || !IT.ready) return e;
    if (!e.equip) e.equip = [];
    for (var a = IT.FEET; a <= IT.HEAD; a++) {
      var st = sl[NS.Inventory.ARMOR_START + (a - IT.FEET)];
      if (a === IT.CHEST && e.equip[a]) continue;   // an elytra already set
      e.equip[a] = st && st.i >= 0 && IT.isArmor(st.i) ? st : null;
    }
    return e;
  };

  /**
   * #3929 -- `ShoulderParrotFeatureRenderer` (.decomp): the parrot in `player.shoulderLeft/Right` is drawn at
   * model-space (+-0.4, -1.5) (sneaking -1.3), i.e. 1.5 blocks up in the 0.9375-scaled player frame, 0.4 to the
   * player's left/right, with `poseOnShoulder` (ON_SHOULDER: STANDING angles, no leg swing, flap 0). Returned as
   * virtual parrot entities (`e.shoulder`) so the ordinary mob path draws them; `pe` is `ER.playerEntity`.
   * Vanilla applies only that translate to the entity matrix (no body pitch or arm offsets), so there is no sneak lean to add (#6436).
   */
  var shoulderEs = [{ removed: false, type: 'parrot' }, { removed: false, type: 'parrot' }];
  ER.shoulderParrots = function (pe) {
    var P = NS.Player, out = [];
    if (!P || !pe) return out;
    for (var s = 0; s < 2; s++) {
      var rec = s ? P.shoulderRight : P.shoulderLeft;
      if (!rec || rec.type !== 'parrot') continue;
      var e = shoulderEs[s], side = s ? 1 : -1, c = Math.cos(pe.yaw), sn = Math.sin(pe.yaw), k = 0.9375;
      e.shoulder = true; e.parrotVariant = rec.parrotVariant | 0;
      e.age = 0; e.onGround = true; e.displayScale = k;
      var h = k * (pe.sneaking ? 1.301 : 1.501);
      e.px = e.x = pe.x + side * 0.4 * k * c; e.pz = e.z = pe.z + side * 0.4 * k * sn; e.py = e.y = pe.y + h;
      e.yaw = e.yBodyRot = e.yHeadRot = pe.yaw; e.yawO = e.yBodyRotO = e.yHeadRotO = pe.yawO;
      e.xHeadRot = e.xHeadRotO = pe.xHeadRot; e.animPos = pe.animPos; e.animSpeed = e.animSpeedO = pe.animSpeed;
      out.push(e);
    }
    return out;
  };

  ER.visible = function (eX, eY, eZ, partial) {
    var EL = NS.EntityList;
    if (!ER.ready || !EL || !EL.ready || !EL.list) return [];
    // D-835 (loop/crystal-render-beam) -- `out.beams`: the crystal-beam quad groups this
    // frame's `ER.pushEndCrystal` calls collect, one entry per crystal whose `e.beamTarget`
    // is set -- attached to the returned ARRAY (a plain JS array takes extra own properties
    // fine) rather than changing `ER.visible`'s own return shape, so every existing caller
    // (`ER.build` included, until this session's own read of it below) keeps working
    // unchanged. `ER.build` copies this reference out before `.concat`ing `out` with the
    // block-entity/knot lists, since `Array.prototype.concat` returns a NEW array that would
    // otherwise drop it.
    var beams = [];
    var out = [], p = [0, 0, 0], R2 = ER.RANGE * ER.RANGE;
    ER.camPos = [eX, eY, eZ];   // #2022 -- GuardianEntityModel's eye looks at the camera entity
    // #168 -- the spinning miniature mob each mob spawner shows in its cage (virtual, never in EL.list)
    var elList = ER.spawnerDisplays(eX, eZ, partial);
    elList = elList.length ? EL.list.concat(elList) : EL.list;
    // #2724 -- the player's own body, only when the camera is off the eyes (F5/V)
    var pe = ER.playerEntity(partial);
    if (pe) elList = elList.concat([pe], ER.shoulderParrots(pe));
    for (var i = 0; i < elList.length; i++) {
      var e = elList[i];
      if (e.removed) continue;
      if (e.type === 'guardian' || e.type === 'elder_guardian') ER.pushGuardianBeam(e, partial, beams);
      if (e.type === 'painting' && NS.Hanging && e.motive) {
        var pdx = e.x - eX, pdy = e.y - eY, pdz = e.z - eZ;
        if (pdx * pdx + pdy * pdy + pdz * pdz > R2 || !ER.shouldRender(e, pdx * pdx + pdy * pdy + pdz * pdz)) continue;
        out.push({ e: e, state: 0, x: e.x, y: e.y, z: e.z, shape: 'painting', layer: CFG.LAYER_OPAQUE,
                   sprites: null, copies: null, flatSprite: false, mobLayer: null, quads: ER.paintingQuads(e) });
        continue;
      }
      if ((e.type === 'item_frame' || e.type === 'glow_item_frame') && e.facing >= 0 && e.facing < 4) {
        // #5708: the HELD item; ER.itemFrameItemAffine is the vanilla chain
        var fdx = e.x - eX, fdy = e.y - eY, fdz = e.z - eZ;
        if (fdx * fdx + fdy * fdy + fdz * fdz > R2 || !ER.shouldRender(e, fdx * fdx + fdy * fdy + fdz * fdz)) continue;
        // #5708: the frame MODEL (block/item_frame, glow: block/glow_item_frame): the block-model-on-entity path,
        // centred on the block cell (entity + facing * 0.46875), turned Ry(180 - yaw) like vanilla's chain
        if (!e.invisible && NS.States && NS.States.stateOf) {
          var frs = NS.States.stateOf(e.type) | 0;
          if (frs) {
            var fth = Math.fround((180 - (e.facing & 3) * 90) * Math.PI / 180);
            out.push({ e: e, state: frs, x: e.x, y: e.y, z: e.z, shape: 'mushroom', layer: ER.layerOf(frs),
                       sprites: null, copies: null, flatSprite: false, mobLayer: null,
                       mush: { state: frs, part: -1, c: [ER.FRAME_DX[e.facing & 3] * 0.46875, 0, ER.FRAME_DZ[e.facing & 3] * 0.46875],
                               m: rY(fth), white: 0 } });
          }
        }
        var fsp = e.item ? ER.spritesFor({ item: e.item, count: 1 }) : null;
        if (fsp) {
          var fa = ER.itemFrameItemAffine(e.facing & 3, e.rotation | 0, !!e.invisible, false);
          out.push({ e: e, state: 0, x: e.x + fa.t[0], y: e.y + fa.t[1], z: e.z + fa.t[2], shape: 'arrow',
                     layer: fsp.layer, sprites: fsp.parts, copies: [[0, 0, 0]], flatSprite: true, mobLayer: null, m: fa.R });
        }
        continue;
      }
      var state = ER.stateOf(e);
      // ⚠ A FLAT ITEM HAS NO STATE AND IS STILL DRAWN (D-342). The `if (!state) continue` below
      // is what made every dropped stick invisible: "this engine has no picture for it" and
      // "this thing is drawn from sprite parts rather than a block state" were the same answer.
      // ⚠ AND NEITHER DOES A BLOCK-ENTITY ITEM (PASS 15 JOB 3): a dropped chest has no block
      // state either, for the same underlying reason a chest's own BLOCK model bakes no quads
      // — so a be-item is tried right alongside a sprite, not as some later special case.
      var sprites = null, isFlat = false, mobLayer = null, arrowSprites = null, beGround = null;
      if (!state && ER.SHAPE[e.type] === 'item') {
        sprites = ER.spritesFor(e);
        if (sprites) { isFlat = true; }
        else {
          var be = ER.beFor(e);
          if (be) { sprites = { parts: [be.part], layer: be.layer, copies: be.copies }; beGround = ER.beGroundFor(NS.Items.nameOf(ER.itemIdOf(e))); }
        }
        if (!sprites) continue;
      } else if (!state && ER.SHAPE[e.type] === 'fireball') {
        sprites = ER.spritesFor(e);
        if (!sprites) continue;
        sprites.copies = [[0, 0, 0]];
        isFlat = true;
      } else if (!state && ER.SHAPE[e.type] === 'arrow') {
        // D-449 — the live arrow, closing `ER.OWED`'s own line for it (see `ER.arrowSpritesFor`).
        arrowSprites = ER.arrowSpritesFor(e.type);
        if (!arrowSprites) continue;
      } else if (!state && e.type === 'end_crystal') {
        // D-835 (loop/crystal-render-beam) -- EC.OWED's own "crystal-model half... unbuilt"
        // line, CLOSED: pushes its own (up to four model entries, plus a beam entry when
        // `e.beamTarget` is set) draw-list entries directly, sidestepping `ER.mobLayerFor`
        // below (which has no entry for it -- this is not a `setupAnim` mob, see
        // `ER.pushEndCrystal`'s own header) and the single-entry-per-iteration assumption the
        // mob/item/arrow branches here all share.
        ER.pushEndCrystal(e, eX, eY, eZ, partial, out, beams);
        continue;
      } else if (!state && !ER.SHAPE[e.type]) {
        // ⚠ G18c: THE MOB PATH. `ER.SHAPE` names only 'block'/'item' -- an entity with
        // neither is either something this engine has no picture for at all (the usual
        // case, and still a silent skip, exactly as before this session) or a mob with
        // real box geometry, which `ER.mobLayerFor` is the one place allowed to decide.
        mobLayer = ER.mobLayerFor(e.type) || ER.fishLayerFor(e);
        if (!mobLayer) continue;
        if (e.type === 'player' && e.slim) mobLayer = 'player_slim';   // #2628: Alex's 3-wide arms + skin sheet
      } else if (!state) continue;
      var fangs = null;
      if (mobLayer && e.type === 'evoker_fangs') {
        // EvokerFangsEntityRenderer.render: nothing is drawn until the bite animation runs.
        var fpr = NS.Spell && NS.Spell.fangsProgress ? NS.Spell.fangsProgress(e, partial) : 0;
        if (fpr === 0) continue;
        fangs = { progress: fpr };
      }
      ER.posAt(e, partial, p);
      // D-773 (tender-carson-7zokog) -- ShulkerEntityRenderer.getPositionOffset: the 6-tick
      // slide in from the block a teleporting shulker left (07zzl's `SD.lerpOffset`).
      if (mobLayer && e.type === 'shulker' && NS.ShulkerDraw && NS.ShulkerDraw.ready) {
        var shOff = NS.ShulkerDraw.lerpOffset(e, partial);
        if (shOff) { p[0] += shOff[0]; p[1] += shOff[1]; p[2] += shOff[2]; }
      }
      // #4744 -- EndermanEntityRenderer.getPositionOffset: while isAngry() (== has a target, as the model's `angry`)
      // the offset is (nextGaussian*0.02, 0, nextGaussian*0.02), re-rolled every frame. Render-only, so Math.random.
      if (mobLayer && e.type === 'enderman' && e.target) {
        var gr = Math.sqrt(-2 * Math.log(1 - Math.random())) * 0.02, ga = 6.283185307179586 * Math.random();
        p[0] += gr * Math.cos(ga); p[2] += gr * Math.sin(ga);   // Box-Muller: two independent gaussians
      }
      var dx = p[0] - eX, dy = p[1] - eY, dz = p[2] - eZ;
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      if (!ER.shouldRender(e, dx * dx + dy * dy + dz * dz)) continue;   // #5624
      if (e.type === 'tnt' && state) {   // #5086 TntEntityRenderer: fuse pulse scale + white blink
        var tr = ER.tntRender(e, partial), ts = tr.scale;
        out.push({ e: e, state: state, x: p[0], y: p[1], z: p[2], shape: 'mushroom', layer: ER.layerOf(state),
                   sprites: null, copies: null, flatSprite: false, mobLayer: null,
                   mush: { state: state, part: -1, c: [0, 0.5, 0], m: [ts, 0, 0, 0, ts, 0, 0, 0, ts], white: tr.white } });
        continue;
      }
      if (mobLayer && e.type === 'dragon_fireball') e.yaw = e.yawO = Math.atan2(-dx, -dz);   // #3806 yaw-only camera billboard
      if (sprites) {
        if (ER.SHAPE[e.type] === 'fireball') {
          var fm = ER.fireballMatrix(e.type, dx, dz, dy);
          out.push({ e: e, state: 0, x: p[0] + fm.lift[0], y: p[1] + fm.lift[1], z: p[2] + fm.lift[2], shape: 'arrow',
                     layer: sprites.layer, sprites: sprites.parts, copies: sprites.copies,
                     flatSprite: true, mobLayer: null, m: fm });
          continue;
        }
        out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'item',
                   layer: sprites.layer, sprites: sprites.parts, copies: sprites.copies,
                   flatSprite: isFlat, mobLayer: null, ground: beGround });
        continue;
      }
      if (arrowSprites) {
        var ayaw = ER.arrowYaw(e), apitch = ER.arrowPitch(e);
        out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'arrow',
                   layer: arrowSprites.layer, sprites: arrowSprites.parts, copies: arrowSprites.copies,
                   flatSprite: true, mobLayer: null, m: ER.arrowMatrix(ayaw, apitch, ER.ARROW_SCALE) });
        continue;
      }
      if (mobLayer && ER.invisibleMob(e)) {
        // #1017 -- `LivingEntityRenderer.render` draws nothing for an invisible non-player mob;
        // IllusionerEntityRenderer.method_3991 (.decomp) instead draws FOUR ghost copies at
        // `IllusionerEntity.method_7065(partial)` offsets plus a cosine jitter. Both the body
        // and the ghosts are pushed as ordinary `mob` items. #1261: `method_3991` calls super.render per ghost, so
        // each ghost also runs the feature layers -- the illusioner's held-item layer (bow, gated on
        // spellcasting||attacking inside `ER.heldItemsFor`) rides every ghost. (No per-entity frustum test exists in
        // this renderer, so `getVisibilityBoundingBox`'s +-3 expansion has nothing to widen: ghosts are never culled
        // by the real body's box; only the ER.RANGE test above applies.)
        // #5731: SheepWoolFeatureRenderer's invisible branch -- fleece into the OUTLINE pass only, and only
        // when the client outlines the sheep (glowing); never the colour pass (ER.emit skips outlineOnly).
        var ofl = (e.type === 'sheep' && NS.Passive && NS.Passive.ready && ER.isGlowing(e)) ? NS.Passive.fleeceTintFor(e, partial) : null;
        if (ofl) out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                            layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                            mobLayer: mobLayer, texKey: 'fur#null', tintRGB: ofl, outlineOnly: true });
        var idk = ER.llamaDecorKey(e);   // #3927: the body is skipped, the decor layer is not
        if (idk) out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob', layer: CFG.LAYER_CUTOUT, sprites: null,
                            copies: null, flatSprite: false, mobLayer: mobLayer, texKey: idk });
        var ghosts = ER.mirrorCopies(e, partial);
        for (var gi = 0; gi < ghosts.length; gi++) {
          out.push({ e: e, state: 0, x: p[0] + ghosts[gi][0], y: p[1] + ghosts[gi][1], z: p[2] + ghosts[gi][2],
                     shape: 'mob', layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: null, tintRGB: null, ghost: gi + 1 });
          var gx = p[0] + ghosts[gi][0], gy = p[1] + ghosts[gi][1], gz = p[2] + ghosts[gi][2];
          var gheld = ER.heldItemsFor(e, mobLayer, gx, gy, gz, partial);
          for (var ghi = 0; ghi < gheld.length; ghi++) { gheld[ghi].ghost = gi + 1; out.push(gheld[ghi]); }
          if (e.bowDrawing !== undefined && (e.attacking || (NS.Spell && NS.Spell.isSpellcasting(e)))) {
            var gbow = ER.bowSpritesFor(e, gx, gy, gz, partial);
            if (gbow) { gbow.ghost = gi + 1; out.push(gbow); }
          }
        }
        continue;
      }
      if (mobLayer) {
        // D-469 — the TEXTURE key (`Tm.skinKey`), tried ahead of `mobLayer`/`e.type` by
        // `ER.mobGeomFor` alone; `mobLayer` itself stays the BASE type everywhere else (BOX
        // geometry, `setupAnim`'s part rules, the baby transform) because none of those vary
        // per skin -- only which atlas crop a face samples does. `Tm` may not exist this early
        // in load order (D-330's own caution elsewhere in this file), so every step is guarded.
        // ⚠ D-445 — CUTOUT, NOT OPAQUE. This used to read "nothing about a posed mob box needs
        // the cutout/translucent passes yet, and no anchor layer's geometry says otherwise" —
        // that was never actually checked against a real mob's real texture, and it was wrong:
        // `skeleton.png`'s ribcage design (rows 20/21/23/24/26 of the front torso rect, and the
        // fully-transparent rows 27-29) is alpha=0 over a stored RGB of (0,0,0), and the OPAQUE
        // pass never applies alpha, so those texels drew as solid black -- the "black torso hole"
        // (confirmed against the real 1.18.2 jar, not the atlas pipeline, which was already
        // correct; see D-445). CUTOUT alpha-tests at 0.5 (`CFG.CUTOUT`, `10_gfx.js`), which is a
        // no-op for a mob whose skin has no transparent texels (cow, zombie, ...) and the fix for
        // one that does (skeleton, and any other mob nobody has pixel-checked yet) -- so every
        // mob goes through it uniformly rather than auditing 90-odd skins one at a time tonight.
        var Tm = NS.Tame;
        var texKey = (Tm && Tm.skinKey) ? Tm.skinKey(e) : null;
        if (!texKey && e.type === 'boat') texKey = ER.boatTexKey(e);   // G18a-1 (#209): the six woods
        // loop/rabbit-s98 (QUEUE 0.2 G18c) -- the second `texKey` picker (`Tm.skinKey`
        // above answers null for anything that isn't cat/wolf_tame): the rabbit texture
        // family (`rabbit`/`rabbit#1`..`rabbit#7`, `pack-mobtex.mjs`'s own header names it
        // as a family with no picker yet -- this is that picker, `Rb.skinKey`, 07zh_rabbit
        // .js).
        if (!texKey && NS.Rabbit && NS.Rabbit.skinKey) texKey = NS.Rabbit.skinKey(e);
        // loop/fox-s99 (QUEUE 0.2 G18c) -- the fox's own texture-family picker (red vs
        // snow, `Fx.skinKey`, 07zj_fox.js) -- same chained-fallback shape rabbit's own
        // picker above already established (no fox family baked into this session's atlas
        // yet, `Fx.OWED`, so this currently always falls through to the base layer name).
        if (!texKey && NS.Fox && NS.Fox.skinKey) texKey = NS.Fox.skinKey(e);
        // loop/panda-axolotl-s101 (QUEUE 0.2 G18c) -- the axolotl's own five-sheet texture-
        // family picker (`Ax.skinKey`, 07zm_axolotl.js), same chained-fallback shape rabbit/
        // fox's own pickers immediately above already establish.
        if (!texKey && NS.Axolotl && NS.Axolotl.skinKey) texKey = NS.Axolotl.skinKey(e);
        // QUEUE 0.2 (G18e remainder, Ll.OWED close) -- llama's own base-colour-by-e.variant
        // picker (`Ll.skinKey`, 07ze_llama.js), the SAME chained-fallback shape rabbit/fox
        // already use above.
        if (!texKey && NS.Llama && NS.Llama.skinKey) texKey = NS.Llama.skinKey(e);
        // QUEUE 0.2 (G18 mobs) -- the bee's own anger/nectar texture picker (`Bee.skinKey`,
        // 07zo_bee.js: bee/bee_angry/bee_nectar/bee_angry_nectar, `BeeEntityRenderer`,
        // .decomp, four literal sheets), same chained-fallback shape every picker above uses.
        if (!texKey && NS.Panda && NS.Panda.skinKey) texKey = NS.Panda.skinKey(e);   // #918 gene sheets
        if (!texKey && NS.Bee && NS.Bee.skinKey) texKey = NS.Bee.skinKey(e);
        if (!texKey && NS.Fly && NS.Fly.skinKey) texKey = NS.Fly.skinKey(e);   // #1224 parrot colours
        // #641 -- GhastEntityRenderer.getTexture: isShooting() ? ghast_shooting : ghast.
        if (!texKey && NS.Ghast && NS.Ghast.skinKey) texKey = NS.Ghast.skinKey(e);
        if (!texKey) texKey = ER.vexSkinKey(e);   // #760
        if (!texKey) texKey = ER.witherSkinKey(e);   // #1577
        if (!texKey && e.type === 'strider' && NS.Strider && NS.Strider.isCold && NS.Strider.isCold(e)) texKey = 'strider_cold';   // #932
    if (!texKey && NS.Shulker && NS.Shulker.skinKey) texKey = NS.Shulker.skinKey(e);   // #657 dyed sheets
        out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                   layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                   mobLayer: mobLayer, texKey: texKey, tintRGB: ER.fishTintFor(e) || ER.wolfWetTint(e, partial), fangs: fangs });
        // #1760 -- TropicalFishColorFeatureRenderer: the pattern pass over the same (dilated) boxes.
        var fpat = ER.fishPatternFor(e);
        if (fpat) out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                             layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                             mobLayer: mobLayer, texKey: fpat.texKey, tintRGB: fpat.tint });
        // D-449 — a bow-armed mob draws the bow in its hand alongside its own box geometry
        // (`RangedBowAttackGoal` sets `e.bowDrawing`/`e.bowCharge`; `undefined` on any mob that
        // has never run that goal, so this never fires for a cow or a zombie).
        if (e.bowDrawing !== undefined) {
          var bowIt = ER.bowSpritesFor(e, p[0], p[1], p[2], partial);
          if (bowIt) out.push(bowIt);
        }
        // #1564 -- the minecart's display block (MinecartEntityRenderer.renderBlock), the mushroom shape's contract.
        if (NS.MinecartRender && NS.MinecartRender.is(e.type)) {
          var mcb = NS.MinecartRender.blockFor(e, partial);
          if (mcb) {
            out.push({ e: e, state: mcb.state, x: p[0], y: p[1], z: p[2], shape: 'mushroom', layer: mcb.layer,
                       sprites: null, copies: null, flatSprite: false, mobLayer: null, mush: mcb });
          }
        }
        // #1749 -- EndermanBlockFeatureRenderer: the carried block between the arms.
        var carr = ER.endermanCarried(e, partial);
        if (carr) out.push({ e: e, state: carr.state, x: p[0], y: p[1], z: p[2], shape: 'mushroom',
                             layer: ER.layerOf(carr.state), sprites: null, copies: null, flatSprite: false,
                             mobLayer: null, mush: carr });
        // #2268 -- EntityRenderDispatcher.renderFlame (on-fire overlay). RENDERING MAY BE CHEAP: the real
        // fire block model (the fire_0/fire_1 crossed planes) stands in for vanilla's four flame quads,
        // sized to the hitbox (width * 1.4 wide, full height). Blaze's own isOnFire is its fireActive byte.
        if ((e.isOnFire || e.fireActive) && !e.fireImmuneRender) {
          var fst = NS.States && NS.States.stateOf ? NS.States.stateOf('fire') | 0 : 0;
          if (fst) {
            var fw = (e.width || 0.6) * 1.4, fh = e.height || 1.8;
            out.push({ e: e, state: fst, x: p[0], y: p[1], z: p[2], shape: 'mushroom', layer: CFG.LAYER_CUTOUT,
                       sprites: null, copies: null, flatSprite: false, mobLayer: null,
                       mush: { state: fst, part: -1, c: [0, fh / 2, 0], m: [fw, 0, 0, 0, fh, 0, 0, 0, fw] } });
          }
        }
        // #671 -- MooshroomMushroomFeatureRenderer: three mushroom BLOCKS on the back and head.
        var mush = ER.mooshroomMushrooms(e, partial);
        for (var mi = 0; mi < mush.length; mi++) {
          out.push({ e: e, state: mush[mi].state, x: p[0], y: p[1], z: p[2], shape: 'mushroom',
                     layer: ER.layerOf(mush[mi].state), sprites: null, copies: null, flatSprite: false,
                     mobLayer: null, mush: mush[mi] });
        }
        // s134 -- every OTHER held item (a piglin's golden sword, a brute's axe, a zombie's shovel,
        // a wither skeleton's stone sword): HeldItemFeatureRenderer, posed on the arm (ER.heldItemsFor).
        if (e.type === 'iron_golem' && e.lookingAtVillagerTicks > 0) {
          var fl = ER.ironGolemFlowerFor(e, mobLayer, p[0], p[1], p[2], partial);
          if (fl) out.push(fl);
        }
        var held = ER.heldItemsFor(e, mobLayer, p[0], p[1], p[2], partial);
        for (var hi2 = 0; hi2 < held.length; hi2++) out.push(held[hi2]);
        // D-471 — THE COLLAR. Read off `fac`/`eyq`'s own bytecode (`WolfCollarLayer`/
        // `CatCollarLayer`, both `extends RenderLayer`): neither draws a box of its own —
        // each is a SECOND pass of the SAME parent model (`getParentModel()`), textured from
        // `wolf_collar.png`/`cat_collar.png` and tinted by the owner's dye colour, drawn only
        // when tamed. `Tm.collarKey(e)` already answers "which overlay, if any" (07n_tame.js,
        // D-458) — this pushes it as a SECOND `it` for the SAME entity, the exact shape the
        // bow overlay above already proved safe (same `mobLayer` so the SAME box geometry and
        // pose, a different `texKey` so `ER.mobGeomFor` samples the tinted collar sheet
        // `pack-mobtex.mjs`'s own `GEOM_BASE_OVERRIDE` now points back at that same box list).
        // QUEUE 0.2 (Tame/Breed remainder) — closes `Tm.OWED`'s own line 1: D-471's citation
        // above already read `WolfCollarFeatureRenderer`/`CatCollarFeatureRenderer`'s gate as
        // `$$3.isTamed() && !$$3.isInvisible()` (.decomp WolfCollarFeatureRenderer.java, its
        // one `method_4209`) and left it unwired because no invisibility status effect existed
        // yet to gate on. D-497 (src/07q_effects.js) added one (`ES.hasStatusEffect`, id 14 in
        // `ES.instance`'s own table) — this is the SECOND half of that same gate, read here
        // rather than in `Tm.collarKey` because `Tm.collarKey` answers the RULE ("does this
        // species/tame-state draw a collar at all", 07n_tame.js's own scope note) and
        // invisibility is a RENDER-time fact about `e`, not a fact about the collar rule itself.
        var ST = NS.Effects;
        var collarKey = (Tm && Tm.collarKey && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility')))
          ? Tm.collarKey(e) : null;
        if (collarKey) {
          var collarRGB = Tm.collarRGB(e);   // #1948: the sheet is the white mask, tinted by the CURRENT collar colour
          out.push({ tintRGB: collarRGB && [collarRGB[0] / 255, collarRGB[1] / 255, collarRGB[2] / 255], e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: collarKey });
        }
        // #1128 -- StrayOverlayFeatureRenderer (.decomp, read whole): a second pass of a SkeletonEntityModel
        // on STRAY_OUTER (biped boxes, Dilation 0.25) textured stray_overlay.png, same cutout layer, untinted.
        // Not gated on invisibility here: LivingEntityRenderer skips the whole feature stack for an invisible mob.
        if (e.type === 'stray' && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: 'stray_outer', texKey: 'stray_outer' });
        }
        // #7658 -- DrownedOverlayFeatureRenderer: DROWNED_OUTER (the drowned model, Dilation 0.25) textured drowned_outer_layer.png, untinted.
        if (e.type === 'drowned' && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: 'drowned_outer#null', texKey: 'drowned_outer#null' });
        }
        // #1869 -- SlimeOverlayFeatureRenderer: the 8x8x8 outer gel cube (SLIME_OUTER) on slime.png over the inner model.
        if (e.type === 'slime' && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('slime_outer'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: 'slime_outer', texKey: 'slime_outer' });
        }
        // #1230 -- SpiderEyesFeatureRenderer (EyesFeatureRenderer, RenderLayer.getEyes): spider_eyes.png (packed as
        // the eye family's index 1, `eye#null#1`) over the spider AND the cave spider, drawn full-bright (`eyes`).
        if ((e.type === 'spider' || e.type === 'cave_spider') &&
            !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('spider_eyes'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'spider_eyes', eyes: true });
        }
        // #1748 -- EndermanEyesFeatureRenderer (RenderLayer.getEyes): enderman_eyes.png (eye family index 0, `eye#null`)
        // over the enderman's own model, full-bright.
        if (e.type === 'enderman' && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('enderman_eyes'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'enderman_eyes', eyes: true });
        }
        // #1539 -- PhantomEyesFeatureRenderer (RenderLayer.getEyes, phantom_eyes.png): a full-bright second pass of the
        // phantom's own model (packed as `phantom_eyes`, borrowing the phantom box list).
        if (e.type === 'phantom' && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('phantom_eyes'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'phantom_eyes', eyes: true });
        }
        // #1566 -- EnderDragonEntityRenderer: RenderLayer.getEyes(dragon_eyes.png) over the whole model, full-bright.
        if (e.type === 'ender_dragon' && !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('dragon_eyes'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'dragon_eyes', eyes: true });
        }
        // #1589 -- EnderDragonEntityRenderer.render :56+: while ticksSinceDeath > 0 the model is drawn with RenderLayer.getEntityAlpha(
        // dragon_exploding.png, ticks/200): texels with alpha below the cutoff are discarded (`ea`, #1849). Own entry, cutout layer.
        if (e.type === 'ender_dragon' && e.dragon && e.dragon.ticksSinceDeath > 0) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: NS.CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'dragon_exploding', ea: ER.dragonDissolveAlpha(e.dragon.ticksSinceDeath) });
        }
        // #1576 -- WitherArmorFeatureRenderer: the 0.5-dilated wither model (packed as `wither_armor`) in wither_armor.png while
        // WitherEntity.shouldRenderOverlay() (health <= maxHealth/2), full-bright. #2627: drawn in the additive scrolling-UV
        // pass (RenderLayer.getEnergySwirl: ONE/ONE blend, UV offset NS.CFG.swirlOffset), as the 4th model bucket.
        if (ER.witherArmorOn(e)) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('wither_armor'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'wither_armor', eyes: true });
        }
        // #2614 -- CreeperChargeFeatureRenderer: the 2.0-dilated creeper model (`creeper_armor`) in creeper_armor.png while charged,
        // full-bright, #4402: additive energy swirl (x = f*0.01, NS.CFG.swirlOffset(f, true)).
        if (e.type === 'creeper' && e.charged) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: ER.mobBlendLayer('creeper_armor'), sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'creeper_armor', eyes: true });
        }
        // #723 -- SnowmanPumpkinFeatureRenderer: a snow golem with its pumpkin draws a carved_pumpkin on its head.
        if (e.type === 'snow_golem' && e.hasPumpkin !== false) {
          var pumpIt = ER.snowPumpkinFor(e, mobLayer, p[0], p[1], p[2], partial);
          if (pumpIt) out.push(pumpIt);
        }
        // G18a-R1 -- arrows / bee stingers stuck in the entity.
        if (e.stuckArrows > 0 || e.stingerCount > 0) {
          var stuckIts = ER.stuckObjectItems(e, mobLayer, p[0], p[1], p[2], partial);
          for (var si = 0; si < stuckIts.length; si++) out.push(stuckIts[si]);
        }
        // G18a-HD1 -- HeadFeatureRenderer: a block item (carved pumpkin, ...) worn on the head. The snow golem has its own.
        if (e.type !== 'snow_golem' && e.equip && NS.Items && NS.Items.ready) {
          var headIt = ER.headBlockFor(e, mobLayer, p[0], p[1], p[2], partial);
          if (headIt) out.push(headIt);
          var skullIt = ER.headSkullFor(e, mobLayer, p[0], p[1], p[2], partial);
          if (skullIt) out.push(skullIt);
        }
        // loop/fleece-s97 (QUEUE 0.2 G18c, Passive.OWED's fleece line, CLOSED) — THE FLEECE.
        // `SheepWoolFeatureRenderer.method_4198` (.decomp, read whole): a SECOND pass of the
        // sheep's own model, textured `sheep_fur.png` (packed here as `fur#null`,
        // pack-mobtex.mjs's own overlay-layer fix, loop/mobrender-s96) and tinted by
        // `SheepEntity.getRgbColor`/`getDyedColor` (`Passive.fleeceColor`, 07w_passive.js — no
        // colour math duplicated here). Same second-`it`-for-the-same-entity shape the collar
        // push just above uses: `mobLayer` stays 'sheep' (the SAME box/pose set) and only
        // `texKey` differs, so `ER.mobGeomFor` samples the fleece's own, slightly larger, slice
        // table instead of the body's. `Passive.fleeceTintFor` alone answers the RULE (sheared /
        // species) exactly like `Tm.collarKey` does for the collar; invisibility is this call
        // site's own RENDER-time fact, the identical split the collar push already draws.
        var Ps = NS.Passive;
        var fleeceTint = (e.type === 'sheep' && Ps && Ps.ready && Ps.fleeceTintFor &&
                           !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility')))
          ? Ps.fleeceTintFor(e, partial) : null;   // loop/nameplate: partial feeds the jeb_ cycle's own tickDelta   // loop/nameplate: partial feeds the jeb_ cycle's own tickDelta
        if (fleeceTint) {
          // `it.e` stays the REAL entity (so `ER.animOf`/`ER.yawAt`/hurt-flash all read the
          // sheep's own live state, not a stand-in) — `it.tintRGB` is a NEW field read ahead of
          // `it.e.tintRGB` at the emit call below, so this push's colour cannot fight whatever
          // debug tool sets the sheep's own `e.tintRGB` (D-503's F4 diagnostics channel).
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'fur#null', tintRGB: fleeceTint });
        }
        // loop/fleece-s97 (QUEUE 0.2 G18c, pig saddle, RENDER half) — `saddle#null` (baked the
        // same pass fur#null was, pack-mobtex.mjs) is a plain, untinted second pass, exactly
        // `PigEntity`'s own saddle overlay (a `FeatureRenderer` with no tint channel at all,
        // unlike the collar/fleece above) — drawn whenever `Passive.pigIsSaddled(e)`.
        if (e.type === 'pig' && Ps && Ps.ready && Ps.pigIsSaddled && Ps.pigIsSaddled(e)) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'saddle#null' });
        }
        // #1178 -- StriderEntityRenderer's SaddleFeatureRenderer (strider_saddle.png, the strider's own
        // model again, untinted), drawn when isSaddled (`e.saddled`, Strider.isSaddled).
        if (e.type === 'strider' && e.saddled) {
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'strider_saddle' });
        }
        // #732 -- IronGolemCrackFeatureRenderer + IronGolemEntity.Crack.from(health/maxHealth):
        // <0.25 high, <0.5 medium, <0.75 low, else none; a second untinted pass of the golem's own
        // model, skipped when invisible.
        if (e.type === 'iron_golem' && e.maxHealth > 0 && e.health < e.maxHealth * 0.75 &&
            !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          var gr = e.health / e.maxHealth;
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer,
                     texKey: gr < 0.25 ? 'iron_golem_crack_high' : gr < 0.5 ? 'iron_golem_crack_medium' : 'iron_golem_crack_low' });
        }
        // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- THE CARPET DECORATION. `LlamaDecor
        // FeatureRenderer.method_4191` (.decomp, read in full): `getCarpetColor()` picks
        // `LLAMA_DECOR[id]` (packed here as `decor#<id>`, `tools/extract-mob-textures.mjs`'s
        // own `FAMILY.decor`, DyeColor ordinal order) drawn as a second, untinted pass of the
        // SAME llama body model. loop/renderres-s104: the trader-llama "no carpet but still
        // draw a trader pattern" branch (`else { if (!isTrader()) return; ... }`) is now built
        // too, just below (the `else if` on `decorColor < 0`) -- `TRADER_LLAMA_DECOR`, packed
        // as "decor#null#16".
        // `Mnt.hasDecorSlot`/`e.carpetColor` (07r_mount.js) already answer the RULE; this
        // reads it the same invisibility-gated way the collar/fleece pushes above do.
        var Mn = NS.Mount;
        var invisible = !!(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'));
        var decorColor = (Mn && Mn.hasDecorSlot && Mn.hasDecorSlot(e) && e.carpetColor !== undefined &&
                           e.carpetColor !== null && e.carpetColor >= 0)
          ? e.carpetColor : -1;
        if (decorColor >= 0) {
          // `decor#null` (not bare "decor") is the literal `tools/golden/models-1.18.2.tsv`
          // row name -- it carries its OWN geometry (the decor render model, shape-identical
          // to the llama body but read from the jar as its own model, .decomp), so
          // `pack-mobtex.mjs`'s own-geometry branch keys sheet 0 (white) as "decor#null"
          // itself and every other dye as "decor#null#<id>", never a bare "decor#<id>" --
          // this session's own build (`assets/mob-geometry.json`) confirmed the exact keys.
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: decorColor === 0 ? 'decor#null' : 'decor#null#' + decorColor });
        } else if (e.type === 'trader_llama') {
          // loop/renderres-s104 (Mnt.OWED/WT.OWED close) -- `LlamaDecorFeatureRenderer.
          // method_4191` (.decomp, read in full): `getCarpetColor() == null` falls to
          // `if (!isTrader()) return;` -- `TraderLlamaEntity.isTrader()` (.decomp) is the ONLY
          // override, always true, so `e.type === 'trader_llama'` IS that gate (a plain llama
          // never reaches this branch, `isTrader()`'s own jar default is false). The texture is
          // `TRADER_LLAMA_DECOR` -- `tools/extract-mob-textures.mjs`'s `FAMILY.decor` index 16,
          // baked as "decor#null#16" by `pack-mobtex.mjs`'s own vi-loop, same geometry as the
          // dyed carpet above (drawn only when NO carpet is set, mirroring the jar's if/else).
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: 'decor#null#16' });
        }
        // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- THE HORSE MARKING. `HorseMarking
        // FeatureRenderer.method_27152` (.decomp, read in full): `TEXTURES.get(getMarking())`,
        // null for `NONE` (ordinal 0, never drawn) -- `Mnt.horseMarking(e)` (07r_mount.js)
        // already returns that same 0..4 index; `horse_marking#0..3` (packed here as
        // `FAMILY.horse_marking`, white/whitefield/whitedots/blackdots order, `GEOM_BASE_
        // OVERRIDE` pointing it back at horse's own box list) covers marking 1..4.
        var markIdx = (e.type === 'horse' && Mn && Mn.horseMarking) ? Mn.horseMarking(e) : 0;
        if (markIdx > 0) {
          // D-469's own family-baking convention (`pack-mobtex.mjs`): sheet index 0 of a
          // multi-sheet family is baked under the BARE key ("horse_marking"), never
          // "horse_marking#0" -- only members 1.. get a "#n" suffix. `markIdx - 1` is the
          // FAMILY.horse_marking index (0=white .. 3=blackdots); index 0 must read "horse_
          // marking" bare or ER.mobGeomFor's texKey lookup misses and silently falls back to
          // plain "horse" (no overlay at all) -- the exact trap `cat`'s own bare-key-at-0
          // convention (Tm.skinKey) already established and this mirrors.
          var markFam = markIdx - 1;
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: markFam === 0 ? 'horse_marking' : 'horse_marking#' + markFam });
        }
        // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- THE HORSE ARMOUR OVERLAY.
        // `HorseArmorFeatureRenderer` (.decomp, read in full): a plain, untinted second pass
        // of the horse's own body model, picked off the equipped armour ITEM, drawn whenever
        // `e.armorItem` is set (`Mnt.equipArmor`, 07r_mount.js) -- `horse_armor#0..3` (packed
        // here as `FAMILY.horse_armor`, leather/iron/gold/diamond order, the SAME `GEOM_BASE_
        // OVERRIDE` shape the marking overlay above uses).
        var armorIdx = (e.type === 'horse' && e.armorItem) ? Mn && Mn.HORSE_ARMOR_TEX_INDEX &&
          Mn.HORSE_ARMOR_TEX_INDEX[e.armorItem] : undefined;
        if (armorIdx !== undefined) {
          // same bare-key-at-0 convention as the marking overlay just above.
          out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                     layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                     mobLayer: mobLayer, texKey: armorIdx === 0 ? 'horse_armor' : 'horse_armor#' + armorIdx });
        }
        // loop/villager-tex -- THE VILLAGER/ZOMBIE_VILLAGER CLOTHING OVERLAYS (see
        // `ER.villagerClothingLayers`'s own header for the full citation). `e.villagerType`/
        // `e.profession`/`e.villagerLevel` are 07o_profession.js's/07zr_zvillager.js's own
        // fields (already round-tripped through NBT, D-573..D-578) -- this is their first
        // RENDER-time read. Gated on `!isInvisible()` the same as the collar/fleece pushes
        // above (.java:45's own top-level gate covers the WHOLE feature renderer, not just
        // one pass of it).
        if ((e.type === 'villager' || e.type === 'zombie_villager') &&
            !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          var vLayers = ER.villagerClothingLayers(e.type, e.villagerType || 'plains',
                                                    e.profession || 'none', e.villagerLevel || 1,
                                                    !!e.isBaby);
          for (var vi2 = 0; vi2 < vLayers.length; vi2++) {
            out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                       layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                       mobLayer: mobLayer, texKey: vLayers[vi2].texKey,
                       hideParts: vLayers[vi2].hideParts });
          }
        }
        // #1835 -- ArmorFeatureRenderer: one pass per worn ArmorItem, the slot's own parts only
        // (setVisible), LEGS on the inner (0.5) layer `#b`, the rest on the outer (1.0) `#c`.
        if (e.equip && ER.ARMOUR_MOBS[e.type] && NS.Items && NS.Items.ready &&
            !(ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility'))) {
          for (var asl = NS.Items.FEET; asl <= NS.Items.HEAD; asl++) {
            var ast = e.equip[asl];
            if (!ast || !NS.Items.isArmor(ast.i) || NS.Items.equipSlot(ast.i) !== asl) continue;
            var amat = ER.ARMOUR_MATERIALS.indexOf(NS.Items.nameOf(ast.i).split('_')[0]);
            if (amat < 0) amat = 0;
            var akey = (e.type === 'player' && e.slim ? 'player_slim' : e.type) + (asl === NS.Items.LEGS ? '#b' : '#c');
            // ArmorFeatureRenderer.renderArmorParts: DyeableArmorItem draws the sheet tinted by display.color
            // (default 0xA06540), then the untinted _overlay sheet (baked as material 7).
            var acol = -1;
            if (amat === 1) acol = (ast.t && ast.t.display && ast.t.display.color !== undefined) ? ast.t.display.color : 0xA06540;
            for (var apass = 0; apass < (acol >= 0 ? 2 : 1); apass++)
              out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                         layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                         mobLayer: mobLayer, texKey: apass ? akey + '#7' : (amat ? akey + '#' + amat : akey),
                         tintRGB: apass || acol < 0 ? null : [(acol >> 16 & 255) / 255, (acol >> 8 & 255) / 255, (acol & 255) / 255],
                         hideParts: ER.ARMOUR_HIDE[asl] });
            // RenderLayer.getArmorEntityGlint: ArmorFeatureRenderer.renderArmorParts draws the same parts again in the foil
            // layer when stack.hasGlint() (scroll 0.16/8 by Util.getMeasuringTimeMs()*8 is applied by the draw, `glint`).
            if (ER.stackHasGlint(ast))
              out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                         layer: CFG.LAYER_ADDITIVE, sprites: null, copies: null, flatSprite: false,
                         mobLayer: mobLayer, texKey: amat ? akey + '#' + amat : akey, glint: 'armor',
                         hideParts: ER.ARMOUR_HIDE[asl] });
          }
        }
        // #6736 -- ElytraFeatureRenderer: a worn elytra in the chest slot draws the two wings (elytra.png), uninvisibility-gated like vanilla.
        if (e.equip && ER.ARMOUR_MOBS[e.type] && NS.Items && NS.Items.ready) {
          var ech = e.equip[NS.Items.CHEST];
          if (ech && ech.i >= 0 && NS.Items.nameOf(ech.i) === 'elytra')
            out.push({ e: e, state: 0, x: p[0], y: p[1], z: p[2], shape: 'mob',
                       layer: CFG.LAYER_CUTOUT, sprites: null, copies: null, flatSprite: false,
                       mobLayer: 'elytra', texKey: 'elytra', elytra: true });
        }
        continue;
      }
      out.push({ e: e, state: state, x: p[0], y: p[1], z: p[2],
                 shape: ER.SHAPE[e.type], layer: ER.layerOf(state),
                 sprites: null, copies: null, flatSprite: false, mobLayer: null });
    }
    out.beams = beams;
    return out;
  };

  var m3mulM = function (a, b) {
    var r = [];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
    return r;
  };
  var m3vec = function (m, v) {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
            m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  };
  var ryM = function (deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  };
  /**
   * #671 -- `MooshroomMushroomFeatureRenderer.method_4195` (.decomp, read whole). None for a baby
   * or an invisible mooshroom. Otherwise three `{state, c, m}`: the mushroom block state, its
   * CENTRE in blocks from the entity position (world axes) and the 3x3 it is drawn through.
   * Built in the cow model's feature space (y down, blocks) and carried out by the same
   * `Ry(yaw) * diag(-1,-1,1)` and 1.501 lift `ER.emitMobLayer` gives a living mob.
   */
  ER.mooshroomMushrooms = function (e, partial) {
    if (!e || e.type !== 'mooshroom' || e.isBaby) return [];
    var ST = NS.Effects;
    if (ST && ST.ready && ST.hasStatusEffect && ST.hasStatusEffect(e, 'invisibility')) return [];
    var Mo = NS.Mooshroom, BE = NS.BEModel;
    var name = ((Mo && Mo.typeOf) ? Mo.typeOf(e) : 'red') + '_mushroom';
    var state = NS.States.stateOf(name) | 0;
    if (!state || !BE || !BE.ready) return [];
    var L = BE.layer('mooshroom');
    var head = L && ER.findRestPart(L.parts, 'head');
    if (!head) return [];
    head = ER.posedPart(head, ER.animOf(e, partial), 'mooshroom');
    var S = [-1, 0, 0, 0, -1, 0, 0, 0, 1];
    var Rh = m3mulM(m3mulM(
      [Math.cos(head.rz), -Math.sin(head.rz), 0, Math.sin(head.rz), Math.cos(head.rz), 0, 0, 0, 1],
      [Math.cos(head.ry), 0, Math.sin(head.ry), 0, 1, 0, -Math.sin(head.ry), 0, Math.cos(head.ry)]),
      [1, 0, 0, 0, Math.cos(head.rx), -Math.sin(head.rx), 0, Math.sin(head.rx), Math.cos(head.rx)]);
    var t1 = [0.2, -0.35, 0.5];
    var r42 = ryM(42), t2 = m3vec(r42, [0.1, 0, -0.6]);
    var hp = m3vec(Rh, [0, -0.7, -0.2]);
    var feat = [
      { c: t1, l: m3mulM(ryM(-48), S) },
      { c: [t1[0] + t2[0], t1[1] + t2[1], t1[2] + t2[2]], l: m3mulM(ryM(-6), S) },
      { c: [head.px / 16 + hp[0], head.py / 16 + hp[1], head.pz / 16 + hp[2]], l: m3mulM(m3mulM(Rh, ryM(-78)), S) }
    ];
    var yaw = ER.bodyYawAt(e, partial);
    var W = m3mulM(ryM(yaw * 180 / Math.PI), [-1, 0, 0, 0, -1, 0, 0, 0, 1]);
    var out = [];
    for (var i = 0; i < 3; i++) {
      var f = feat[i].c, v = m3vec(W, [f[0], f[1] - 1.501, f[2]]);
      out.push({ state: state, c: v, m: m3mulM(W, feat[i].l) });
    }
    return out;
  };

  /**
   * #1749 -- `EndermanBlockFeatureRenderer.render` (.decomp): translate(0,0.6875,-0.75), Rx(20), Ry(45),
   * translate(0.25,0.1875,0.25), scale(-0.5,-0.5,0.5), Ry(90), block drawn about its corner (so -0.5 shift
   * to the centre). Null when nothing is carried. Same output shape as `ER.mooshroomMushrooms` entries.
   */
  ER.endermanCarried = function (e, partial) {
    if (!e || e.type !== 'enderman' || e.carriedBlock === undefined || e.carriedBlock === null) return null;
    var state = e.carriedBlock | 0;
    if (!state) return null;
    var cr = Math.cos(20 * Math.PI / 180), sr = Math.sin(20 * Math.PI / 180);
    var Rx = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
    var L = m3mulM(m3mulM(m3mulM(Rx, ryM(45)), [-0.5, 0, 0, 0, -0.5, 0, 0, 0, 0.5]), ryM(90));
    var P = m3vec(m3mulM(Rx, ryM(45)), [0.25, 0.1875, 0.25]);
    var c = [0 + P[0], 0.6875 + P[1], -0.75 + P[2]];
    var ctr = m3vec(L, [0.5, 0.5, 0.5]);   // block corner -> centre
    c = [c[0] + ctr[0], c[1] + ctr[1], c[2] + ctr[2]];
    var yaw = ER.bodyYawAt(e, partial);
    var W = m3mulM(ryM(yaw * 180 / Math.PI), [-1, 0, 0, 0, -1, 0, 0, 0, 1]);
    var v = m3vec(W, [c[0], c[1] - 1.501, c[2]]);
    return { state: state, c: v, m: m3mulM(W, L) };
  };

  /** How many model quads a state costs. No neighbour culling: an entity has no neighbours. */
  ER.quadCount = function (state, wx, wy, wz) {
    return NS.Mesher.modelQuadCount(NS.States.vis[state], 0, 0, 0, 0, wx, wy, wz);
  };

  /** How many quads one geometry part holds — the sprite path's equivalent of the above. */
  ER.partQuads = function (part) {
    var R = NS.Reg;
    if (!R || !R.partOff || !(part >= 0) || part + 1 >= R.partOff.length) return 0;
    return R.partOff[part + 1] - R.partOff[part];
  };

  /**
   * One entity's geometry, written into the model stream at word offset `o`.
   *
   * ⚠⚠ **THIS IS `Mesher.emitModelBlock` WITH A SUB-BLOCK OFFSET, AND THE CHECK ASSERTS THE TWO
   * AGREE BYTE FOR BYTE** when that offset happens to be a whole block. That assertion is the
   * whole reason this function is allowed to exist: the alternative — a second copy of the
   * winding rule, the `MESH_OF_DIR` remap and the tint field, drifting quietly out of step with
   * the one the world uses — is D-314 exactly, and it cost a session (D-320 cost another).
   *
   * ⚠ THE CORNERS GO OUT IN REVERSE (D-133) and the face is remapped through `MESH_OF_DIR`
   * (D-314). Both for the same reason they are done next door: the index ramp is wound CCW and
   * the shade table is indexed in ARCH order while the baked `dir` is vanilla's.
   */
  ER.emit = function (out, o, state, ux, uy, uz, sky, blk, wx, wy, wz, m) {
    var R = NS.Reg;
    var vis = NS.States.vis[state];
    var groups = R.groupCount(vis);
    for (var g = 0; g < groups; g++) {
      o = ER.emitPart(out, o, R.partFor(vis, g, wx, wy, wz), ux, uy, uz, sky, blk, m);
    }
    return o;
  };

  /**
   * ⚠⚠ **ONE PART'S QUADS, AND IT IS THE ONLY PLACE THIS LOOP IS WRITTEN** (D-342). It was
   * inside `ER.emit` until a dropped stick needed it: a sprite item has no block state, so it
   * cannot go through `States.vis` and `Reg.partFor` at all — it has a part index and nothing
   * else. Lifting the loop out is what let the sprite path reuse the winding rule, the
   * `MESH_OF_DIR` remap, the rotated-normal shade and the tint field rather than grow a second
   * copy of them. A second copy is D-314, and D-314 has cost this project two sessions.
   */
  ER.emitPart = function (out, o, part, ux, uy, uz, sky, blk, m, white) {
    var R = NS.Reg, M = NS.Mesher;
    var MAP = M.MESH_OF_DIR;
    var HALF = CFG.MODEL_UNITS_PER_BLOCK * 0.5;
    for (var q = R.partOff[part]; q < R.partOff[part + 1]; q++) {
      var f = R.qFlags[q];
      var face = MAP[f & 7];
      var tint = (f >>> 7) & 7;
      var shade = (f >>> 6) & 1;
      var tile = R.qTile[q];
      var po = q * 12, uo = q * 8;
      if (m) {
        // ⚠⚠ **THE SHADE FOLLOWS THE ROTATED NORMAL, NOT THE BAKED FACE NUMBER.** This is the
        // lesson of D-314 and D-320 a third time: a spinning item whose faces keep their
        // model-space shade has a bright side that turns with it, which reads as a flickering
        // lamp rather than as a block catching the light. `NRM_OF_MESH` is the outward normal
        // of each ARCH face, carried through the same matrix the corners are.
        var n = NRM_OF_MESH[face];
        var nx = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
        var ny = m[3] * n[0] + m[4] * n[1] + m[5] * n[2];
        var nz = m[6] * n[0] + m[7] * n[1] + m[8] * n[2];
        var ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, az = nz < 0 ? -nz : nz;
        face = ay >= ax && ay >= az ? (ny >= 0 ? 2 : 3)
             : ax >= az ? (nx >= 0 ? 0 : 1) : (nz >= 0 ? 4 : 5);
      }
      for (var c = 3; c >= 0; c--) {
        var px = R.qPos[po + c * 3], py = R.qPos[po + c * 3 + 1], pz = R.qPos[po + c * 3 + 2];
        var vx, vy, vz;
        if (m) {
          // the pivot is the block's own centre, because every display transform in vanilla is
          // written about it — `ItemRenderer` translates by (-0.5, -0.5, -0.5) after the scale
          var ox = px - HALF, oy = py - HALF, oz = pz - HALF;
          vx = ux + Math.round(m[0] * ox + m[1] * oy + m[2] * oz);
          vy = uy + Math.round(m[3] * ox + m[4] * oy + m[5] * oz);
          vz = uz + Math.round(m[6] * ox + m[7] * oy + m[8] * oz);
        } else { vx = ux + px; vy = uy + py; vz = uz + pz; }
        o = M.packModelVertex(out, o, vx, vy, vz,
          tile, R.qUv[uo + c * 2], R.qUv[uo + c * 2 + 1],
          face, 3, sky, blk, tint > 3 ? 3 : tint, shade, 0, undefined, undefined, undefined, undefined, white);   // white: #4933 renderFlashingBlock overlay
      }
    }
    return o;
  };

  /** The outward normal of each face in ARCH order: +X -X +Y -Y +Z -Z. */
  var NRM_OF_MESH = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  /**
   * The 3x3 an ITEM entity's model is drawn through: `0.25 * Ry(spin)`, uniform and
   * orientation-preserving, so the reversed-corner winding of D-133 still holds.
   */
  ER.itemMatrix = function (spin, ground) {
    var g = ground || ER.GROUND;
    var c = Math.cos(spin) * g.scale, s = Math.sin(spin) * g.scale;
    return [c, 0, s, 0, g.scale, 0, -s, 0, c];
  };

  /**
   * Build one §8 buffer holding every visible entity, positioned relative to `(ox, oy, oz)`.
   *
   * Returns `{ buf, quads, drawn, clipped }` or null when there is nothing to draw. The three
   * layers are written contiguously in layer order, exactly as the mesher writes a section's,
   * because that is what the header's three offsets mean to a backend.
   */
  /**
   * #5707 (G17-HG7) PaintingEntityRenderer.renderPainting, as pure geometry.
   *
   * The pose is rotateY(180 - yaw) then scale(1/16): the quads below are written in PIXELS of the
   * local frame (x along the width, z the depth, front at -0.5, back at +0.5) exactly as vanilla
   * writes them, then rotated and scaled here. Every 16px tile of the motive gets six quads (front,
   * back, top, bottom, two sides); the front samples that tile of the motive and the rest sample the
   * back sprite. Tile column/row are mirrored (cols-1-i, rows-1-j) because vanilla's front U/V run
   * from the far edge. Light is sampled per tile at the block the tile's centre falls in.
   *
   * Returns [{ p: [[x,y,z] x4] world blocks, uv: [[u,v] x4] px in the 16px layer, tile: layer index
   * RELATIVE to A.paintTile0 (0 = back.png), n: world normal, cell: [bx,by,bz] light cell }].
   */
  ER.paintTileIndex = function (motiveIdx, col, row) {
    var MS = NS.Hanging.MOTIVES, off = 1, k;
    for (k = 0; k < motiveIdx; k++) off += (MS[k][1] / 16) * (MS[k][2] / 16);
    return off + row * (MS[motiveIdx][1] / 16) + col;
  };

  ER.paintingQuads = function (e) {
    var H = NS.Hanging, MS = H.MOTIVES, mi = -1, k;
    for (k = 0; k < MS.length; k++) if (MS[k][0] === e.motive) { mi = k; break; }
    if (mi < 0) return [];
    var wpx = MS[mi][1], hpx = MS[mi][2], cols = wpx / 16, rows = hpx / 16;
    var th = (180 - e.yaw) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    var f = ((e.facing % 4) + 4) % 4;
    var out = [];
    function q(v, n, uv, tile, cell) {
      var p = [], i;
      for (i = 0; i < 4; i++) {
        p.push([e.x + (v[i][0] * c + v[i][2] * s) / 16, e.y + v[i][1] / 16, e.z + (-v[i][0] * s + v[i][2] * c) / 16]);
      }
      out.push({ p: p, uv: uv, tile: tile, n: [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c], cell: cell });
    }
    var x0 = -wpx / 2, y0 = -hpx / 2, i, j;
    for (i = 0; i < cols; i++) {
      for (j = 0; j < rows; j++) {
        var xR = x0 + (i + 1) * 16, xL = x0 + i * 16, yT = y0 + (j + 1) * 16, yB = y0 + j * 16;
        var bx = Math.floor(e.x), by = Math.floor(e.y + (yT + yB) / 2 / 16), bz = Math.floor(e.z);
        var mx = (xR + xL) / 2 / 16;
        if (f === 2) bx = Math.floor(e.x + mx);
        if (f === 1) bz = Math.floor(e.z - mx);
        if (f === 0) bx = Math.floor(e.x - mx);
        if (f === 3) bz = Math.floor(e.z + mx);
        var cell = [bx, by, bz];
        var ft = ER.paintTileIndex(mi, cols - 1 - i, rows - 1 - j);
        q([[xR, yB, -0.5], [xL, yB, -0.5], [xL, yT, -0.5], [xR, yT, -0.5]], [0, 0, -1], [[0, 16], [16, 16], [16, 0], [0, 0]], ft, cell);
        q([[xR, yT, 0.5], [xL, yT, 0.5], [xL, yB, 0.5], [xR, yB, 0.5]], [0, 0, 1], [[16, 0], [0, 0], [0, 16], [16, 16]], 0, cell);
        q([[xR, yT, -0.5], [xL, yT, -0.5], [xL, yT, 0.5], [xR, yT, 0.5]], [0, 1, 0], [[0, 0], [16, 0], [16, 1], [0, 1]], 0, cell);
        q([[xR, yB, 0.5], [xL, yB, 0.5], [xL, yB, -0.5], [xR, yB, -0.5]], [0, -1, 0], [[0, 0], [16, 0], [16, 1], [0, 1]], 0, cell);
        q([[xR, yT, 0.5], [xR, yB, 0.5], [xR, yB, -0.5], [xR, yT, -0.5]], [-1, 0, 0], [[1, 0], [1, 16], [0, 16], [0, 0]], 0, cell);
        q([[xL, yT, -0.5], [xL, yB, -0.5], [xL, yB, 0.5], [xL, yT, 0.5]], [1, 0, 0], [[1, 0], [1, 16], [0, 16], [0, 0]], 0, cell);
      }
    }
    return out;
  };

  /** Write a painting's quads into the model stream (the pack loop of `ER.build`'s 'painting' entry). */
  ER.emitPainting = function (out, o, quads, ox, oy, oz) {
    var M = NS.Mesher, A = NS.Atlas, U = CFG.MODEL_UNITS_PER_BLOCK, W = NS.World;
    var t0 = A && A.paintTile0 ? A.paintTile0 : 0;
    for (var qi = 0; qi < quads.length; qi++) {
      var qd = quads[qi], n = qd.n;
      var ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
      var face = ay >= ax && ay >= az ? (n[1] >= 0 ? 2 : 3) : ax >= az ? (n[0] >= 0 ? 0 : 1) : (n[2] >= 0 ? 4 : 5);
      var lt = W && W.getLight ? (W.getLight(qd.cell[0], qd.cell[1], qd.cell[2]) | 0) : 0xF0;
      var wx = [], wy = [], wz = [], c;
      for (c = 0; c < 4; c++) {
        wx.push(Math.round((qd.p[c][0] - ox) * U)); wy.push(Math.round((qd.p[c][1] - oy) * U)); wz.push(Math.round((qd.p[c][2] - oz) * U));
      }
      var e1x = wx[1] - wx[0], e1y = wy[1] - wy[0], e1z = wz[1] - wz[0];
      var e2x = wx[2] - wx[0], e2y = wy[2] - wy[0], e2z = wz[2] - wz[0];
      var cr = (e1y * e2z - e1z * e2y) * n[0] + (e1z * e2x - e1x * e2z) * n[1] + (e1x * e2y - e1y * e2x) * n[2];
      var order = cr < 0 ? [3, 2, 1, 0] : [0, 1, 2, 3];
      for (var w = 0; w < 4; w++) {
        c = order[w];
        o = M.packModelVertex(out, o, wx[c], wy[c], wz[c], t0 + qd.tile,
          Math.round(qd.uv[c][0] * 16), Math.round(qd.uv[c][1] * 16), face, 3, lt >> 4, lt & 15, 0, 0, 0);
      }
    }
    return o;
  };

  /** ER.build: Dimension.getBrightness for the overworld (ambient 0): f / (4 - 3f), f = light / 15. */
  ER.shadowBrightness = function (light) { var f = light / 15; return f / (4 - 3 * f); };
  /** The atlas tile of the packed `shadow` layer (one flat 16x16 slice), or -1 before the mob geometry is loaded. */
  ER.shadowTile = function () {
    var G = mobGeomTable_(), L = G && G.layers && G.layers.shadow, s = L && L[0] && L[0][2] && L[0][2][0];
    return s ? s.tile : -1;
  };
  /**
   * #6739 -- EntityRenderDispatcher.render/renderShadow/renderShadowPart as geometry. One entry per entity of `list`
   * (overlay/ghost entries share `it.e`, so each entity once): the full-cube blocks within the radius under its feet,
   * each a world-space quad {x0,x1,z0,z1,y,a,u0,u1,v0,v1} clipped to the shadow square (the sheet's edge texels are
   * transparent, so the clip equals vanilla's quad). No shadow: invisible, radius 0, opacity <= 0, light <= 3.
   */
  ER.shadowQuads = function (list, eX, eY, eZ) {
    var W = NS.World, SR = NS.States, out = [], seen = [], i, it, e;
    if (!W || !W.getBlock || !SR || ER.shadowTile() < 0) return out;
    for (i = 0; i < list.length; i++) {
      it = list[i]; e = it.e;
      if (!e || !it.n || it.ghost || seen.indexOf(e) >= 0 || e.invisible) continue;
      if (it.shape !== 'mob' && it.shape !== 'item') continue;
      var r0 = ER.shadowRadiusOf({ type: e.type, size: e.size, puffState: e.puffState, baby: e.isBaby || e.baby });
      if (!(r0 > 0)) continue;
      seen.push(e);
      var dx = it.x - eX, dy = it.y - eY, dz = it.z - eZ;
      var op = ER.shadowOpacity(dx * dx + dy * dy + dz * dz);
      if (!(op > 0)) continue;
      var r = Math.fround(ER.shadowPartRadius(r0, !!(e.isBaby || e.baby)) > 32 ? 32 : ER.shadowPartRadius(r0, !!(e.isBaby || e.baby)));
      var x0 = Math.floor(it.x - r), x1 = Math.floor(it.x + r), y0 = Math.floor(it.y - r), y1 = Math.floor(it.y);
      var z0 = Math.floor(it.z - r), z1 = Math.floor(it.z + r), bx, by, bz;
      for (bx = x0; bx <= x1; bx++) for (by = y0; by <= y1; by++) for (bz = z0; bz <= z1; bz++) {
        if (!SR.fullCubeCollision(W.getBlock(bx, by - 1, bz))) continue;
        var lt = W.getLight ? (W.getLight(bx, by, bz) | 0) : 0xF0, lv = Math.max(lt >> 4, lt & 15);
        if (lv <= 3) continue;
        var a = ER.shadowPartAlpha(op, it.y, by, ER.shadowBrightness(lv));
        if (a === null || a <= 0) continue;
        var qx0 = Math.max(bx, it.x - r), qx1 = Math.min(bx + 1, it.x + r);
        var qz0 = Math.max(bz, it.z - r), qz1 = Math.min(bz + 1, it.z + r);
        if (qx1 <= qx0 || qz1 <= qz0) continue;
        out.push({ x0: qx0, x1: qx1, z0: qz0, z1: qz1, y: by, a: a,
                   u0: -(qx0 - it.x) / 2 / r + 0.5, u1: -(qx1 - it.x) / 2 / r + 0.5,
                   v0: -(qz0 - it.z) / 2 / r + 0.5, v1: -(qz1 - it.z) / 2 / r + 0.5 });
      }
    }
    return out;
  };
  /** Write the shadow quads (translucent layer, full-bright, `ea` = the quad alpha) into the model stream. */
  ER.emitShadows = function (out, o, quads, ox, oy, oz) {
    if (NS.Settings && NS.Settings.entityShadows === false) return o;   // GameOptions.entityShadows off: no shadow quads
    var M = NS.Mesher, U = CFG.MODEL_UNITS_PER_BLOCK, tile = ER.shadowTile();
    for (var qi = 0; qi < quads.length; qi++) {
      var q = quads[qi], ys = Math.round((q.y - oy) * U);
      var xs = [q.x0, q.x0, q.x1, q.x1], zs = [q.z0, q.z1, q.z1, q.z0];
      var us = [q.u0, q.u0, q.u1, q.u1], vs = [q.v0, q.v1, q.v1, q.v0];
      // face 2 = +Y: wind so the normal points up (x then z increasing is down-facing, so reverse)
      for (var w = 3; w >= 0; w--) {
        o = M.packModelVertex(out, o, Math.round((xs[w] - ox) * U), ys, Math.round((zs[w] - oz) * U), tile,
          Math.round(us[w] * 256), Math.round(vs[w] * 256), 2, 3, 15, 15, 0, 0, 0,
          undefined, undefined, undefined, Math.max(q.a, 1 / 31));
      }
    }
    return o;
  };

  ER.build = function (ox, oy, oz, eX, eY, eZ, partial) {
    var M = NS.Mesher, W = NS.World, U = CFG.MODEL_UNITS_PER_BLOCK;
    var list = ER.visible(eX, eY, eZ, partial);
    // D-835 (loop/crystal-render-beam) -- captured BEFORE any `.concat` below replaces
    // `list` with a fresh array (`ER.visible`'s own header on `out.beams`).
    var beamQuads = list.beams || [];
    // ⚠ D-421 — THE BLOCK ENTITIES IN THE WORLD JOIN THE SAME FRAME BUFFER. A chest is not an
    // entity and is drawn by the same emitter as one, into the same §8 buffer, for the same
    // reason this file never grew a second backend path: one buffer, one draw call, no shader.
    // ⚠ AND THE `!list.length` RETURN MOVED BELOW THIS. It used to mean "no entities, draw
    // nothing"; a world with nine chests and no mobs would have taken it and drawn none of them.
    var bew = ER.beWorldVisible(eX, eY, eZ, partial);
    if (bew.length) list = list.length ? list.concat(bew) : bew;
    // D-503/D-508's OWED, CLOSED: the leash KNOT joins the same frame buffer too, the SAME
    // reasoning as the block entities two lines up — `leash_knot` is a REAL baked layer
    // (`assets/mob-geometry.json`'s own `leash_knot` entry, `tools/pack-mobtex.mjs`'s
    // `entity/lead_knot.png` crops), not a hand-rolled wire cube in 07u_leash.js's own program;
    // drawing it here, through the SAME `emitMobLayer` path every mob uses, is what gives it
    // real texture, real lighting and all three backends for free — `07u_leash.js` now draws
    // only the ROPE, which is not a boxed model and has no baked layer to join here.
    var knots = ER.leashKnotVisible(eX, eY, eZ);
    if (knots.length) list = list.length ? list.concat(knots) : knots;
    if (!list.length) return null;

    var mQuads = [0, 0, 0, 0], i, it, clipped = 0, total = 0;
    for (i = 0; i < list.length; i++) {
      it = list[i];
      var bx = Math.floor(it.x), by = Math.floor(it.y), bz = Math.floor(it.z);
      it.wx = bx; it.wy = by; it.wz = bz;
      if (it.sprites) {
        // one part per sprite LAYER, once per COPY of the pile
        var per = 0;
        for (var sp = 0; sp < it.sprites.length; sp++) per += ER.partQuads(it.sprites[sp]);
        it.n = per * it.copies.length;
      } else if (it.shape === 'painting') {
        it.n = it.quads.length;
      } else if (it.shape === 'ec') {
        // D-835 (loop/crystal-render-beam) -- ONE named part of `end_crystal` per list entry
        // (`ER.pushEndCrystal`'s own header: `glass` is drawn twice, at two different
        // instances, never all three parts together the way `ER.mobQuadCount` assumes).
        it.n = ER.endCrystalPartQuadCount(it.ecPart);
      } else if (it.shape === 'mob' || it.shape === 'beworld') {
        // ⚠ G18c step 1. The SAME count `mobboxcheck.mjs` independently re-derives from a
        // second read of `assets/mob-geometry.json` -- this is not a new formula, it is
        // JOB 4.3's own `ER.mobQuadCount` getting its first real caller.
        // D-700: `it.texKey` MUST ride along -- an overlay item (the fleece's own `fur#null`,
        // pushed as its own list entry by `ER.visible`, same shape D-471's collar comment
        // already names) can need a DIFFERENT quad count than its bare `mobLayer` once that
        // texKey has its own dilated box (D-698). Sizing this off `mobLayer` alone (as before
        // D-700) undercounts and the real `ER.emitMobLayer(..., it.texKey, ...)` call further
        // down this same function overflows the buffer this line sizes -- KW-36.
        it.n = ER.mobQuadCount(it.mobLayer, it.texKey);
      } else {
        it.n = ER.quadCount(it.state, bx, by, bz);
      }
      if (total + it.n > ER.MAX_QUADS) { it.n = 0; clipped++; continue; }
      total += it.n;
      mQuads[it.layer] += it.n;
    }
    var shQuads = NS.Settings && NS.Settings.entityShadows === false ? [] : ER.shadowQuads(list, eX, eY, eZ);   // #10252: off = none counted either, not empty quads
    if (shQuads.length && total + shQuads.length <= ER.MAX_QUADS) { total += shQuads.length; mQuads[CFG.LAYER_TRANSLUCENT] += shQuads.length; }
    else shQuads = [];
    if (!total) return null;

    var buf = M.allocBuffer(0, 0, 0, mQuads);
    var hdr = M.readHeader(buf);
    var mOut = new Uint32Array(buf, hdr.modelOff[0], total * 16);
    var cursor = [0, mQuads[0] * 16, (mQuads[0] + mQuads[1]) * 16, (mQuads[0] + mQuads[1] + mQuads[2]) * 16];
    var drawn = 0;
    var beOrig = [0, 0, 0];
    var maskRecs = [], decalRecs = [];

    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (!it.n) continue;
      // ⚠ ROUNDED, NOT TRUNCATED. `| 0` truncates toward zero, so an entity at a negative
      // coordinate would be quantised the other way from one at a positive coordinate and a
      // falling block would jitter by a 256th as it crossed x = 0.
      var m = null, offX = ER.MODEL_OFFSET[0], offY = ER.MODEL_OFFSET[1], offZ = ER.MODEL_OFFSET[2];
      var spin = 0;
      if (it.shape === 'item') {
        // ⚠ AN ITEM IS CENTRED ON ITS OWN POSITION, NOT ON A CORNER — the matrix already works
        // about the block's centre, so there is no half-block to take off here, only the lift.
        // ⚠ AND THE GROUND TRANSFORM DEPENDS ON THE MODEL (D-342): a sprite is scale 0.5 lifted
        // 2/16, a block is scale 0.25 lifted 3/16.
        var age = it.e.age | 0, bo = it.e.bobOffs || 0;
        // ⚠ THE GROUND TRANSFORM READS THE FLAT FLAG, NOT "has sprite parts" (PASS 15 JOB 3):
        // a be-item ALSO draws through `it.sprites` (one part, reused machinery) but its model
        // is a 3D box, not a flat quad, so it needs the BLOCK ground transform, same as a
        // dropped stone would get.
        var gnd = it.ground || ER.groundFor(it.flatSprite);
        spin = ER.itemSpin(age, partial, bo);
        m = ER.itemMatrix(spin, gnd);
        offX = 0; offZ = 0; offY = ER.itemLift(age, partial, bo, gnd);
      } else if (it.shape === 'mob' || it.shape === 'beworld' || it.shape === 'ec') {
        // ⚠ NOT `ER.MODEL_OFFSET` -- that corner-to-centre shift is a BLOCK model fact.
        // `ER.buildMobLayer`'s own standalone caller (JOB 4.3) places a mob at its feet
        // position directly, no offset at all, and this is the same emission this session
        // wires a live caller onto -- it must match, not invent a second convention.
        offX = 0; offY = 0; offZ = 0;
      } else if (it.shape === 'arrow') {
        // D-449 — a flying arrow or a held bow: `it.x/y/z` is already the exact world point
        // (velocity-oriented for an arrow, hand-offset for a bow — both computed in
        // `ER.visible`/`ER.bowSpritesFor`), and `it.m` is that entity's own already-built
        // orientation matrix, not the item pile's spin/ground transform.
        offX = 0; offY = 0; offZ = 0;
        m = it.m;
      }
      // ⚠ THE LIGHT IS SAMPLED WHERE THE ENTITY IS, not where the block it came from was.
      // Vanilla lights an entity from `getLightColor`, which reads the cell it occupies.
      var lt = W && W.getLight ? (W.getLight(it.wx, it.wy, it.wz) | 0) : 0xF0;
      if (it.e && it.e.type === 'glow_item_frame') lt = 0xFF;   // #5708: 15728880 = sky 15, block 15
      if (it.sprites) {
        // ⚠⚠ **THE PILE OFFSETS ARE IN THE SPUN FRAME AND ARE NOT SCALED BY THE MODEL MATRIX.**
        // Vanilla applies them to the PoseStack after `rotateY(spin)` and before the model's own
        // display transform, so they turn with the item but do not shrink with it — the factors
        // of `scale` they do carry are the explicit ones the renderer multiplies in. Folding
        // them through `m` instead would make a pile of sticks a quarter as spread out as it
        // should be, which reads as one thick stick.
        var cs = Math.cos(spin), sn = Math.sin(spin);
        for (var ci = 0; ci < it.copies.length; ci++) {
          var c0 = it.copies[ci];
          var rx = cs * c0[0] + sn * c0[2];
          var rz = -sn * c0[0] + cs * c0[2];
          var cux = Math.round((it.x + offX + rx - ox) * U);
          var cuy = Math.round((it.y + offY + c0[1] - oy) * U);
          var cuz = Math.round((it.z + offZ + rz - oz) * U);
          for (var si = 0; si < it.sprites.length; si++) {
            cursor[it.layer] = ER.emitPart(mOut, cursor[it.layer], it.sprites[si],
                                           cux, cuy, cuz, lt >> 4, lt & 15, m);
          }
        }
        drawn++;
        continue;
      }
      if (it.shape === 'painting') {
        cursor[it.layer] = ER.emitPainting(mOut, cursor[it.layer], it.quads, ox, oy, oz);
        drawn++;
        continue;
      }
      if (it.shape === 'beworld') {
        // ⚠ D-421 — THE ORIGIN CARRIES THE PIVOT. `ER.beWorldOrigin`'s own header: rotating a
        // model about the block's centre, which is what vanilla's chest does, is the same
        // geometry as rotating about the origin and translating by `C - R(C)`, and the origin
        // is the only translation this emitter takes. `ER.BASE_NONE`: a chest is NOT a living
        // entity, so it gets none of `LivingEntityRenderer`'s flip-and-lift preamble (D-415) --
        // hand it one and the chest is drawn upside down and buried, which is exactly the bug
        // that preamble was written to fix for mobs.
        var csB = Math.cos(it.beYaw), snB = Math.sin(it.beYaw);
        // #591: a skull's origin IS its pivot (`it.x/y/z` already carry the renderer's translate)
        if (it.beRaw) { beOrig[0] = it.x; beOrig[1] = it.y; beOrig[2] = it.z; }
        else ER.beWorldOrigin(it.x, it.y, it.z, csB, snB, beOrig);
        cursor[it.layer] = ER.emitMobLayer(mOut, cursor[it.layer], it.mobLayer,
                                           Math.round((beOrig[0] - ox) * U),
                                           Math.round((beOrig[1] - oy) * U),
                                           Math.round((beOrig[2] - oz) * U),
                                           csB, snB, lt >> 4, lt & 15, 0,
                                           it.beBox ? ER.beBoxAnim(it) : it.beAnim || ER.beLidAnim(it.beOpen),
                                           it.beBase, it.texKey || null, 0, null, it.beScale,
                                           it.beBox ? ER.SHULKER_BOX_HIDE : it.beHide || undefined);
        drawn++;
        continue;
      }
      // loop/vsleep -- `ER.animOf` (computed once, here, rather than twice) may carry a
      // `sleepPose` (`ER.sleepPoseOf`, below): `LivingEntityRenderer.render`'s own pillow-side
      // world-space TRANSLATE (.decomp/net/minecraft/client/render/entity/
      // LivingEntityRenderer.java:84-90) applied to the entity's OWN position, before it is
      // quantised into the draw-origin-relative fixed point every shape here shares. Every
      // other shape's `it.x/it.z` is untouched (`sleepPose` is null unless `it.e.vbSleeping`).
      // #5731: SheepWoolFeatureRenderer's invisible branch draws RenderLayer.getOutline only -- the
      // outline-list item (ER.visible `outlineOnly`) never reaches the colour pass; the glowing
      // silhouette itself is ER.renderOutlines' (the entity is glowing, so its box is drawn there).
      if (it.outlineOnly) continue;
      if (it.shape === 'mushroom') {
        // #671 -- the block-model-on-entity path: `mush.c` is the block CENTRE in blocks from the
        // entity, `mush.m` the linear part; `ER.emitPart` works about the block's centre already.
        var mc = it.mush.c;
        cursor[it.layer] = ER.emitPart(mOut, cursor[it.layer],
          it.mush.part >= 0 ? it.mush.part : NS.Reg.partFor(NS.States.vis[it.state], 0, it.wx, it.wy, it.wz),
          Math.round((it.x + mc[0] - ox) * U), Math.round((it.y + mc[1] - oy) * U),
          Math.round((it.z + mc[2] - oz) * U), lt >> 4, lt & 15, it.mush.m, it.mush.white);
        drawn++;
        continue;
      }
      var animObj = (it.shape === 'mob' && it.e) ? (it.fangs ? ER.fangsAnim(it.fangs.progress) : it.elytra ? ER.elytraAnim(it.e, partial) : ER.animOf(it.e, partial)) : null;
      var sleepPose = animObj && animObj.sleepPose;
      var sx = sleepPose ? it.x + sleepPose.dx : it.x;
      var sz = sleepPose ? it.z + sleepPose.dz : it.z;
      var ux = Math.round((sx + offX - ox) * U);
      var uy = Math.round((it.y + offY + (sleepPose && sleepPose.dy || 0) - oy) * U);
      var uz = Math.round((sz + offZ - oz) * U);
      if (it.shape === 'mob') {
        // ⚠ G18c step 1, the very thing this pass exists to wire: a real mob, drawn from a
        // live `EntityList` entry through `ER.emitMobLayer`'s own posed-and-textured path
        // (JOB 4.2/4.3), lit by the SAME `W.getLight` call every other entity here uses --
        // never a constant, which is what every Node-only check up to this session used
        // instead (`mobboxcheck.mjs` section 6's own sky=15/blk=0).
        // ⚠ THIS COMMENT USED TO SAY `anim` IS NULL and that nothing ticked the limb swing. Both
        // stopped being true at D-415 (`EL.tickAnim`) and D-422 (the look control); it is
        // corrected here rather than left, because a comment that describes a hole somebody
        // already filled is how the next session decides not to look.
        // D-430: the INTERPOLATED body heading -- unused when `sleepPose` (`ER.sleepPoseOf`)
        // supplies `anim.sleepPose.R` instead (loop/vsleep).
        // loop/nameplate -- a Dinnerbone/Grumm-named living mob's base pose is overridden
        // (ER.dinnerbonePoseFor, this file's own header two sections up) instead of the
        // usual `undefined` (-> `ER.basePoseFor(it.mobLayer)`, D-469's own default); every
        // other mob keeps drawing through that default, byte-for-byte unchanged.
        var dbFlip = ER.shouldFlipUpsideDown(it.e, it.mobLayer);
        // D-773 (tender-carson-7zokog) -- a shulker's body yaw is pinned at vanilla 0
        // (ShulkerBodyControl), and setupTransforms adds 180: this engine's heading 0.
        var mobYaw = (animObj && animObj.shulker) ? 0 : it.fangs ? ER.fangsYaw(it.e) : it.e.type === 'llama_spit' ? ER.spitYaw(it.e, partial) : ER.dragonYaw(it.e, partial);
        ER.entityAlpha = it.ea;   // #1589: read by emitMobLayer for the dragon_exploding pass only
        var emitIt = function (mOut, cur, texKeyArg) { return ER.emitMobLayer(mOut, cur, it.mobLayer, ux, uy, uz,
                                            sleepPose ? 1 : Math.cos(mobYaw),
                                            sleepPose ? 0 : Math.sin(mobYaw),
                                            it.eyes ? 15 : lt >> 4,
                                            // #1577 -- WitherEntityRenderer.method_24093: block light always 15
                                            (it.eyes || ER.fullBrightBlockLight(it.e)) ? 15 : ER.glowSquidBlockLight(it.e, lt & 15), 0, animObj,
                                            it.fangs ? ER.FANGS_BASE : dbFlip ? ER.dinnerbonePoseFor(it.e.height) : undefined,
                                            texKeyArg,    // D-469: base pose, then the skin key
                                            // the red hurt flash: `LivingEntity.hurtTime`/`deathTime` (.decomp
                                            // `LivingEntityRenderer.getOverlay`), bookkept since D-338 and read
                                            // here for the first time.
                                            !!(it.e && (it.e.hurtTime > 0 || it.e.deathTime > 0)),
                                            // D-503's OWED, CLOSED: the per-entity RGB tint channel, fed from
                                            // whatever set `e.tintRGB` (a [0..1]x3 triple) -- MineHTML's F4
                                            // diagnostics overlay (D-431's OWED) is the first caller named for
                                            // it, but this is the channel itself, not that overlay.
                                            // loop/fleece-s97: `it.tintRGB` (the fleece overlay's own
                                            // colour) is read FIRST — falling back to `it.e.tintRGB` keeps
                                            // every other caller (the F4 diagnostics channel included)
                                            // byte-for-byte unchanged, since a plain mob `it` never sets it.
                                            it.tintRGB || (it.e && it.e.tintRGB),
                                            // loop/mobrender-s96: the creeper swell scale, `null` for every
                                            // other mob (`ER.creeperScale`'s own type guard).
                                            // D-674: now the renderer's own scale() too (`ER.mobScale`).
                                            it.fangs ? ER.fangsScale(it.fangs.progress) : ER.mobScale(it.e, partial),
                                            // QUEUE 0.2 (G18e remainder, Mnt.OWED close) --
                                            // the chest-part hide set, read off the REAL
                                            // entity (`it.e`, never a stand-in) so an overlay
                                            // push (decor/marking/armour, all sharing this
                                            // same `it.mobLayer` == 'donkey'/'mule'/'llama'/
                                            // 'horse') hides its chest boxes exactly like the
                                            // body pass does.
                                            // loop/villager-tex -- an `it.hideParts` the push
                                            // site itself set (the villager type-overlay
                                            // hat gate) wins over the per-entity chest hide,
                                            // which is a `null` no-op for anything but a
                                            // donkey/mule/llama/horse anyway.
                                            it.hideParts || ER.standHide(it.e) ||
                                            (NS.Mount && NS.Mount.hideChestParts ? NS.Mount.hideChestParts(it.e) : null),
                                            it.glint === 'armor' ? ER.GLINT_ARMOR_SCALE : 0); };   // #9239
        cursor[it.layer] = emitIt(mOut, cursor[it.layer], it.texKey);
        // #1589: DRAGON_DECAL -- the same dragon geometry again in the plain skin, drawn depth-EQUAL over the dissolving pass
        if (it.ea !== undefined) decalRecs.push(emitIt);
        // #5723: BoatEntityRenderer.render -- the water_patch goes out only while the boat is not submerged
        if (it.e && it.e.type === 'boat' && !ER.boatSubmerged(it.e)) maskRecs.push({ ux: ux, uy: uy, uz: uz, sky: lt >> 4, blk: lt & 15, anim: animObj, mobYaw: mobYaw, it: it, scale: ER.mobScale(it.e, partial) });
        drawn++;
        continue;
      } else if (it.shape === 'ec') {
        // D-835 (loop/crystal-render-beam) -- one named part of `end_crystal`, hiding the
        // other two (`ER.EC_HIDE`), posed entirely by its OWN Euler triple (`ER.pushEndCrystal`)
        // -- `cosYaw=1,sinYaw=0` because vanilla's `EndCrystalEntityRenderer` reads no body
        // yaw of its own, and no skin/hurt/tint channel because it never reads those either.
        cursor[it.layer] = ER.emitMobLayer(mOut, cursor[it.layer], it.mobLayer, ux, uy, uz,
                                            1, 0, lt >> 4, lt & 15, 0,
                                            { deltaFor: function () { return it.ecRot; } },
                                            ER.BASE_NONE, null, false, null,
                                            { sxz: it.ecScale, sy: it.ecScale },
                                            ER.EC_HIDE[it.ecPart]);
        drawn++;
        continue;
      }
      cursor[it.layer] = ER.emit(mOut, cursor[it.layer], it.state, ux, uy, uz,
                                 lt >> 4, lt & 15, it.wx, it.wy, it.wz, m);
      drawn++;
    }
    if (shQuads.length && !(NS.Settings && NS.Settings.entityShadows === false)) cursor[CFG.LAYER_TRANSLUCENT] = ER.emitShadows(mOut, cursor[CFG.LAYER_TRANSLUCENT], shQuads, ox, oy, oz);
    return { buf: buf, quads: mQuads, drawn: drawn, clipped: clipped, list: list, beamQuads: beamQuads,
             maskBuf: ER.buildWaterMask(maskRecs), decalBuf: ER.buildDragonDecal(decalRecs) };
  };

  // ── PASS 15 JOB 4.3 -- THE WORLD-SPACE MOB BOX RENDERER ─────────────────────────────────
  //
  // `BE.layers[name].parts` (`15h_bemodel.js`, D-317) is the SAME box table that file already
  // renders as an inventory icon -- straight out of the jar's `CubeListBuilder` calls, one
  // pivot and one rotation per box, already flattened per-part rather than a runtime parent
  // chain. Posing each box by its OWN pivot/rotation here, rather than baking them into one
  // rigid mesh, is what makes a mob "a hierarchy of posed boxes" (git 2a8efe1:docs/passes/PASS-15-HISTORY.md 4.3): JOB 4.4
  // (`setupAnim`) only ever has to ADD an angle to a part's `rx`/`ry`/`rz` before this runs --
  // it never needs a second emission path, and this file never needs to know which mob it is.
  //
  // ⚠ NO ANIMATION HERE. Every part is posed at the REST angles the jar's own constructor
  // wrote -- the T-pose equivalent -- because `setupAnim` (4.4) does not exist yet and a
  // static pose is what 4.3 alone is asked to prove. Nothing here is faked to look posed.
  //
  // ⚠ NEITHER IS THE TEXTURE. `mob-tex.bin` (JOB 4.2, git 2a8efe1:docs/passes/PASS-15-HISTORY.md) is packed but not
  // wired into the GPU atlas, so `tile` is caller-supplied and this file makes no claim about
  // what it names -- a mob drawn today draws its UV rectangle into WHATEVER atlas layer `tile`
  // happens to be. Texturing mobs is still owed; what this proves is the GEOMETRY.
  //
  // ⚠ AND NEITHER IS THE ENTITY-LEVEL BASE POSE. Vanilla's `LivingEntityRenderer` applies its
  // own preamble (a translate and, for most mobs, a 180-degree yaw flip) before a model's own
  // parts are posed at all; this emits boxes directly in the model's own space, translated by
  // the entity's feet position and rotated by yaw only. That preamble is entity-render-base
  // work, not box-hierarchy work, and is STILL not modeled -- G18c step 1 (this session) wired
  // `ER.build`'s live loop onto this exact path (`guardian`/`dolphin`/`llama_spit`/`turtle`,
  // the only types with both measured motion AND real box geometry today), and it has not
  // been checked against a real screen -- this remote session has no Chromium. Whoever runs
  // the browser stage first must re-check this preamble against it, not assume it was settled
  // here: a mob with no base pose may stand rotated 180 degrees from vanilla and look fine in
  // every Node-only check anyway, since none of them render a picture.
  //
  // ⚠⚠ THE ±128-BLOCK WRAP LIMIT (`ER.RANGE`'s own header comment, above). A model vertex is
  // signed i16 in 1/256 of a block: the format wraps past 32767/256 = 127.996 blocks from the
  // draw origin. `ER.mobWorstCoord` computes, for one layer, the worst any vertex can reach
  // with the entity placed exactly at `ER.RANGE` blocks out on the least favourable axis, at
  // ANY yaw -- and `mobboxcheck.mjs` asserts it for every shipped layer, not just the two the
  // spec names, because a layer nobody thought to check is exactly how this would ship broken.

  /** The four corners (cube-corner index: i&1=x1, i&2=y1, i&4=z1) bounding each ARCH-order
   *  face -- the SAME grouping `15h_bemodel.js`'s own `FACE_CORNERS` uses, so the two files
   *  agree on which four corners make a face even though each derives its own winding. */
  var MOB_FACE_CORNERS = [
    [1, 5, 7, 3],   // +X
    [4, 0, 2, 6],   // -X
    [2, 3, 7, 6],   // +Y
    [4, 5, 1, 0],   // -Y
    [5, 4, 6, 7],   // +Z
    [0, 1, 3, 2]    // -Z
  ];

  /** Minecraft's own model scale: 16 units to a block (D-317, `15h_bemodel.js`'s own boxes). */
  ER.MC_UNITS_PER_BLOCK = 16;

  // ── D-415: THE ENTITY-LEVEL BASE POSE, which this file said out loud it did not have ───────
  //
  // ⚠⚠ **THE PREAMBLE IS NOT DECORATION; IT IS WHICH WAY UP THE MOB IS.** `LivingEntityRenderer
  // .render` does three things before a single model part is posed:
  //
  //     setupRotations(...)                       // mulPose(YP.rotationDegrees(180 - yBodyRot))
  //     poseStack.scale(-1.0F, -1.0F, 1.0F);      // X and Y both negated
  //     poseStack.translate(0.0D, -1.501D, 0.0D); // in the ALREADY-FLIPPED frame, so +1.501 up
  //
  // Entity model boxes are authored Y-DOWN from a point 1.501 blocks above the feet (a
  // humanoid's legs run y 12..24, which is why 1.501 - 24/16 = 0.001 puts its feet on the
  // floor). Emit them without the flip and every mob is drawn upside down, sunk into the
  // ground, facing backwards — which is exactly what shipped: a cow standing on its horns and
  // a zombie lying in the dirt. `JOB 4.3`'s header named this gap and asked the first session
  // with a real browser to settle it; this is that session, and the browser is how it was seen.
  //
  // ⚠ **THE YAW HALF IS ALREADY PAID FOR, AND THAT IS NOT LUCK — IT IS A CONVENTION GAP.**
  // Vanilla rotates by `180 - yawMC`. This engine's yaw is Minecraft's minus 180 degrees
  // (`Cam.forward` is `(sin y, sin p, -cos y)`, so yaw 0 looks NORTH here and SOUTH there), so
  // `180 - yawMC` is exactly `-yaw`, and `Ry(-yaw) . diag(-1,-1,1)` differs from the rotation
  // this file already applied only by negating X and Y. Write the flip as `bs` and the whole
  // preamble is two multiplies and an add, in both the position and the normal.
  //
  // ⚠ WHICH RENDERERS DO IT. Every `LivingEntityRenderer` — so every MOB — does. The two
  // projectile layers this engine can also spawn do not, and are NAMED rather than silently
  // given a mob's preamble (`LlamaSpitRenderer` translates 0.15 up and rotates by yaw/pitch;
  // `ShulkerBulletRenderer` scales -0.5). Neither has a check that looks at its picture yet,
  // so neither is claimed: `ER.OWED_BASE_POSE` is the closed list, the same shape as `ER.OWED`.
  ER.LIVING_Y_OFFSET = 1.501;
  ER.BASE_LIVING = { flip: true, yOffsetFixed: 1.501 * CFG.MODEL_UNITS_PER_BLOCK };
  ER.BASE_NONE = { flip: false, yOffsetFixed: 0 };
  // D-596: `LeashKnotEntityRenderer.method_4035` (.decomp, LeashKnotEntityRenderer.java:21-23) is
  // `scale(-1,-1,1)` and NOTHING else — the living mirror without the 1.501 lift. With the knot
  // at `fence + 0.375` (Tm.getOrCreateKnot, LeashKnotEntity.java:40) and its box
  // `cuboid(-3,-8,-3,6,8,6)` (LeashKnotEntityModel.java:24), that puts the knot from 0.375 to
  // 0.875 up the fence post — ER.BASE_NONE had it hanging 0.125 below the fence's own block.
  ER.BASE_MIRROR = { flip: true, yOffsetFixed: 0 };
  // #3806: WitherSkullEntityRenderer is scale(-1,-1,1) and nothing else, like the knot.
  ER.MIRROR_ONLY = { leash_knot: 1, shulker_bullet: 1, wither_skull: 1, dragon_fireball: 1 };
  // #3968/#4599: LlamaSpitEntityRenderer is translate(0,0.15,0) + Ry(lerp(yaw)-90) + Rz(lerp(pitch)), no flip. The lift is
  // BASE_SPIT; yaw/pitch are the 0.2-low-passed ProjectileEntity.updateRotation values Llama.tick keeps on the entity
  // (e.spitYaw/e.spitPitch, degrees, with spitYawO/spitPitchO the previous tick's), drawn through `anim.sleepPose.R`.
  ER.BASE_SPIT = { flip: false, yOffsetFixed: 0.15 * CFG.MODEL_UNITS_PER_BLOCK };
  ER.spitYaw = function (e, partial) {
    var y = e.spitYaw || 0, yo = e.spitYawO === undefined ? y : e.spitYawO;
    return (yo + (y - yo) * (partial === undefined ? 1 : partial) - 90) * Math.PI / 180;
  };
  ER.spitAnimOf = function (e, partial) {
    var p = e.spitPitch || 0, po = e.spitPitchO === undefined ? p : e.spitPitchO;
    var R = mulMat3(rotY(ER.spitYaw(e, partial) * 180 / Math.PI), rotZ(po + (p - po) * partial));
    return { sleepPose: { R: R, dx: 0, dy: 0, dz: 0 }, deltaFor: function () { return null; } };
  };
  // TridentEntityRenderer is Ry(lerp(yaw)-90) + Rz(lerp(pitch)+90), no flip, no lift (BASE_NONE); same sleepPose.R slot as the spit.
  ER.tridentAnimOf = function (e, partial) {
    var y = e.prevYaw === undefined ? (e.yaw || 0) : e.prevYaw, yo = y, p = e.pitch || 0, po = e.prevPitch === undefined ? p : e.prevPitch;
    y = e.yaw || 0; partial = partial === undefined ? 1 : partial;
    var R = mulMat3(rotY(yo + (y - yo) * partial - 90), rotZ(po + (p - po) * partial + 90));
    return { sleepPose: { R: R, dx: 0, dy: 0, dz: 0 }, deltaFor: function () { return null; } };
  };
  ER.OWED_BASE_POSE = [];

  /** The `{flip, yOffsetFixed}` preamble a layer is drawn with. Living entities get
   *  `LivingEntityRenderer`'s; everything else is on `ER.OWED_BASE_POSE` and gets none. */
  ER.basePoseFor = function (layerName) {
    var E = NS.Entities;
    // s133 -- a renderer whose own scale() ends in a translate (ER.RENDER_TRANSLATE) moves the
    // model before the 1.501 lift; both land in the same flipped frame, so they fold together.
    var tb = String(layerName).split('#')[0];
    if (tb === 'drowned_outer') { tb = 'drowned'; layerName = 'drowned'; }   // #7658
    if (tb === 'stray_outer') { tb = 'stray'; layerName = 'stray'; }   // #1128: the overlay pass poses as its host
    if (ER.RENDER_TRANSLATE[tb] && E && E.ready && E.isLiving && E.isLiving(tb)) return ER.translatedPose(tb);
    // #1548: a player is a LivingEntity (PlayerEntityRenderer extends LivingEntityRenderer) but has no attribute row, so
    // `isLiving` is false for it: it was posed BASE_NONE, the model upside down
    if (E && E.ready && E.isLiving && (E.isLiving(layerName) || tb === 'player' || tb === 'player_slim' || tb === 'elytra')) return ER.BASE_LIVING;
    if (ER.MIRROR_ONLY[layerName]) return ER.BASE_MIRROR;
    if (layerName === 'llama_spit') return ER.BASE_SPIT;
    return ER.BASE_NONE;
  };

  /** How many §8 quads one mob LAYER costs: six faces a box, no culling -- a mob has no
   *  neighbours to hide a face against, unlike a block. */
  // -- PASS 16 JOB 4.2's GPU wiring (RENDER half): the SAME per-face slicing recipe
  // `tools/pack-mobtex.mjs` used to bake `assets/mob-geometry.json` (its own header names
  // `ARCH_AXES`/`SIZE_KEY`) -- duplicated here, not shared, because that file is a Node build
  // tool and this runs live in the browser every frame. Keep the two tables identical; a
  // posed-frame check (this session's own addition to `mobboxcheck.mjs`) is what would catch
  // them drifting apart.
  var ARCH_AXES = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']];
  var SIZE_KEY = { x: 'w', y: 'h', z: 'd' };

  // `NS.DATA.mobGeometry` is `assets/mob-geometry.json` DEFLATED (`19_data.gen.js`'s own
  // comment: too large to inline raw) -- unpacked ONCE, on first use, not every frame. Same
  // lazy-decode shape `T.init` (`02i_text.js`) already uses for a deflated JSON blob: bytes ->
  // UTF-8 string (chunked `TextDecoder`, or `decodeURIComponent(escape(...))` where that is
  // missing) -> `JSON.parse`. `null` (not `{}`) on any absence or failure, so every caller
  // below just tests truthiness once rather than re-deriving "did this load" three ways.
  var mobGeomTable = null, mobGeomTried = false;
  function mobGeomTable_() {
    if (mobGeomTried) return mobGeomTable;
    mobGeomTried = true;
    var D = NS.DATA;
    if (!D || !D.mobGeometry || !NS.Z) return mobGeomTable;
    try {
      var bytes = NS.Z.unpack(D.mobGeometry, D.mobGeometryBytes);
      var json;
      if (typeof TextDecoder !== 'undefined') {
        json = new TextDecoder('utf-8').decode(bytes);
      } else {
        var CH = 8192, parts = [];
        for (var i = 0; i < bytes.length; i += CH) {
          parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length))));
        }
        json = decodeURIComponent(escape(parts.join('')));
      }
      mobGeomTable = JSON.parse(json);
    } catch (e) { mobGeomTable = null; }
    return mobGeomTable;
  }

  /** `layerName`'s `[part][face] -> [slices]` table (`pack-mobtex.mjs`'s own shape), or null
   *  when the layer is untextured (the 32 overlay-only layers git 2a8efe1:docs/passes/PASS-16-HISTORY.md counted,
   *  or any layer before `mob-geometry.json` loads at all). */
  // D-469 — `texKey` (`Tm.skinKey(e)`, e.g. "cat#3"/"wolf_tame") is tried FIRST, so a mob
  // whose skin varies by state draws its own baked slice table instead of every member of its
  // family sharing layer 0's; `layerName` (the base type) is the fallback every OTHER caller
  // already relied on — a mob with no picker, a chest/beworld layer, or a variant
  // `pack-mobtex.mjs` never baked (e.g. `wolf_angry`, still `Tm.OWED`) draws exactly as before.
  // #1835 -- the humanoids ArmorFeatureRenderer dresses (player/armor_stand have their own renderers).
  ER.ARMOUR_MOBS = { zombie: 1, husk: 1, drowned: 1, giant: 1, skeleton: 1, stray: 1, wither_skeleton: 1,
                     zombie_villager: 1, piglin: 1, piglin_brute: 1, zombified_piglin: 1, armor_stand: 1,
                     player: 1, player_slim: 1 };   // #2628: a remote/third-person player (ArmorFeatureRenderer, #2368)
  // ArmorFeatureRenderer.setVisible: the parts HIDDEN for a slot (indexed by Items.FEET..HEAD).
  // item-name prefix -> baked sheet index (extract-mob-textures ARMOR_MATS); 7 is the leather overlay.
  ER.ARMOUR_MATERIALS = ['iron', 'leather', 'chainmail', 'golden', 'diamond', 'netherite', 'turtle'];
  ER.ARMOUR_HIDE = [null, null,
    { head: 1, hat: 1, body: 1, right_arm: 1, left_arm: 1 },                  // FEET: legs only
    { head: 1, hat: 1, right_arm: 1, left_arm: 1 },                           // LEGS: body + legs
    { head: 1, hat: 1, right_leg: 1, left_leg: 1 },                           // CHEST: body + arms
    { body: 1, right_arm: 1, left_arm: 1, right_leg: 1, left_leg: 1 }];       // HEAD: head + hat

  /** #9239 -- the glint texture matrix (RenderPhase.setupGlintTexturing: T * rotZ(10deg) * scale(s)), the part the shader does not
   *  scroll: model UV (0..1 of the 64x32 armour sheet) -> scale -> rotate, in glint repeats; the packed u,v are tile units * 16. */
  ER.GLINT_ARMOR_SCALE = 0.16; ER.GLINT_ITEM_SCALE = 8;   // ARMOR_ENTITY_GLINT_TEXTURING / ENTITY_GLINT_TEXTURING
  ER.glintUV = function (us, vs, scale) {
    var c = Math.cos(Math.PI / 18), sn = Math.sin(Math.PI / 18);
    for (var i = 0; i < 4; i++) {
      var u = us[i] / 64 * scale, v = vs[i] / 32 * scale;
      us[i] = (u * c - v * sn) * 16; vs[i] = (u * sn + v * c) * 16;
    }
  };
  /** The atlas tile of the packed `enchant_glint` layer (one flat 16x16 slice), or -1 before the mob geometry is loaded. */
  ER.glintTile = function () {
    var G = mobGeomTable_(), L = G && G.layers && G.layers.enchant_glint, s = L && L[0] && L[0][2] && L[0][2][0];
    return s ? s.tile : -1;
  };
  ER.mobGeomFor = function (layerName, texKey) {
    var G = mobGeomTable_();
    if (!G || !G.layers) return null;
    return (texKey && G.layers[texKey]) || G.layers[layerName] || null;
  };

  /** How many slices face `f` of part `k` needs, from `layerGeom` as `ER.mobGeomFor` returns
   *  it -- the real count when a non-empty slice list exists, else 1 for today's whole-face
   *  fallback quad (a degenerate face, or any face this session's packer never resolved,
   *  draws exactly as it always has: one quad, matching the old `parts.length*6` assumption). */
  function mobFaceQuadCount(layerGeom, k, f) {
    var slices = layerGeom && layerGeom[k] && layerGeom[k][f];
    return (slices && slices.length) ? slices.length : 1;
  }

  /** How many §8 quads one mob LAYER costs. Six faces a box, no culling -- a mob has no
   *  neighbours to hide a face against, unlike a block -- UNLESS `mob-geometry.json` sliced a
   *  face into more than one ≤16x16 atlas crop (JOB 4.2, D-376's packing played on mob box
   *  faces): then it costs one quad per slice, not one. `ER.buildMobLayer`'s buffer sizing
   *  calls this same function for its allocation, so the two can never disagree about how many
   *  quads a layer needs -- get them out of sync and a textured mob overflows its own buffer,
   *  exactly the failure mode `git 2a8efe1:docs/passes/PASS-16-HISTORY.md` warned the next session
   *  about by name. */
  /** #1165 -- the BOX table an overlay pass draws. `SheepWoolFeatureRenderer` draws
   *  `SheepWoolEntityModel`, whose cuboids are NOT the body model's (head 6x6x6 at z-4, legs 6 tall,
   *  all dilated); the fleece pass used the bare sheep's boxes with fur's slice table, so the head
   *  (8 deep, not 6) and legs (12 tall, not 6) were mangled. Use `texKey`'s own layer when it
   *  carries the same part names 1:1 with the base layer (fur#null); else the base layer. */
  ER.boxLayerFor = function (layerName, texKey) {
    var BE = NS.BEModel, L = BE.layer(layerName);
    if (!L || !texKey || texKey === layerName) return L;
    var T = BE.layer(/^tropical_fish_\w+_pattern#\d$/.test(texKey) ? texKey.split('#')[0] : texKey);   // #1760 pattern sheets 1..5
    if (!T || T.parts.length !== L.parts.length) return L;
    for (var i = 0; i < T.parts.length; i++) if (T.parts[i].n !== L.parts[i].n) return L;
    return T;
  };
  ER.mobQuadCount = function (layerName, texKey) {
    var BE = NS.BEModel, L = BE && BE.ready ? ER.boxLayerFor(layerName, texKey) : null;
    if (!L) return 0;
    // D-700: texKey MUST be threaded through to mobGeomFor exactly as emitMobLayer's own
    // `var G = ER.mobGeomFor(layerName, texKey)` does (D-469's own comment there: "texKey
    // first, layerName the fallback") -- this header's own warning above ("get them out of
    // sync and a textured mob overflows its own buffer") is not hypothetical: D-698's Dilation
    // fix gave a texKey like 'fur#null' a genuinely different (larger) box than its bare
    // layerName, so a caller sizing a buffer off the layerName alone silently undercounts and
    // `ER.build`'s shared mesh buffer overflows into whatever the next item's quads were going
    // to occupy (KW-36). `texKey` is optional and defaults to `undefined`, so every existing
    // caller that never had an overlay texKey draws byte-for-byte unchanged.
    var G = ER.mobGeomFor(layerName, texKey), n = 0;
    var dh = ER.DEFAULT_HIDDEN[layerName], ph = ER.playerPartsHidden(layerName);
    for (var k = 0; k < L.parts.length; k++) {
      if (dh && dh[L.parts[k].n]) continue;
      if (ph && ph[L.parts[k].n]) continue;
      var nk = 0;
      for (var f = 0; f < 6; f++) nk += mobFaceQuadCount(G, k, f);
      n += nk * (L.parts[k].n === 'neck' && ER.modelKindOf(layerName) === 'ender_dragon' ? 17 : 1);   // #1848: the neck is drawn 17 times (5 neck + 12 tail, ER.dragonExpandParts)
    }
    return ER.NO_CULL[String(layerName).split('#')[0]] ? 2 * n : n;
  };

  /**
   * D-773 cloud unit (tender-carson-7zokog) -- layers drawn DOUBLE-SIDED: every quad is emitted
   * a second time with its winding reversed, because the model pass culls back faces and vanilla's
   * layer for these does not. `ShulkerEntityModel`'s own constructor passes
   * `RenderLayer::getEntityCutoutNoCullZOffset`, and `shulker.png` is HOLLOW (the lid's underside
   * and the base's top are transparent, the side walls notched) -- culled, an open shulker is a
   * see-through frame. (Vanilla's `EntityModel` DEFAULT is `getEntityCutoutNoCull` too, for every
   * mob; only the shulker's sheet makes the difference visible, so only it pays the 2x quads.)
   */
  // D-835 (loop/crystal-render-beam) -- vanilla's EndCrystalEntityRenderer uses
  // RenderLayer.getEntityCutoutNoCull(TEXTURE), the SAME render-layer class as the shulker's
  // own (this table's other member) -- a rotating glass/core box needs its inside faces
  // visible from every angle, exactly the shulker's own reasoning above.
  ER.NO_CULL = { shulker: 1, end_crystal: 1 };

  /**
   * #211 G18a-3 -- the PLAYER model (`PlayerEntityModel`, `player` = Steve's 4-wide arms,
   * `player_slim` = Alex's 3-wide, both on the 64x64 default skin from the jar).
   * Two parts of its mesh are never drawn from the skin sheet: `ear` (only for the names
   * "deadmau5"/"Dinnerbone" -- `PlayerEntityModel.renderEars`) and `cloak` (a cape texture, and a
   * default skin has none -- `renderCape`). They stay in the golden table because the mesh has
   * them; the emitter and `ER.mobQuadCount` skip them so no quad is ever wasted or mis-sampled.
   */
  // The piglin family's rows also carry the biped's `hat` (vanilla's piglin hat is EMPTY:
  // PiglinEntityModel.getModelData ends addChild("hat", ModelPartBuilder.create(), NONE)) and
  // PlayerEntityModel's ear/cloak, which no mob body renders (#1046). Keyed by the exact layer: the piglin
  // ARMOR layers (#b/#c) keep their real hat box (#2007).
  // #7799 -- the render-layer blend mode of each overlay/eye pass, from .decomp: SlimeOverlayFeatureRenderer getEntityTranslucent,
  // Stray/DrownedOverlay getEntityCutoutNoCull, EyesFeatureRenderer getEyes (ONE,ONE), Wither/CreeperCharge getEnergySwirl (ONE,ONE).
  // tools/mobtexproofcheck.mjs reads this literal. eyes = getEyes (ONE,ONE, non-scrolling) = the shared additive layer.
  ER.MOB_BLEND = {"slime_outer":"translucent","stray_outer":"cutout","drowned_outer#null":"cutout","spider_eyes":"additive","enderman_eyes":"additive","phantom_eyes":"additive","dragon_eyes":"additive","wither_armor":"additive","creeper_armor":"additive"};
  ER.mobBlendLayer = function (key) {
    var m = ER.MOB_BLEND[key], C = NS.CFG;
    return m === 'translucent' ? C.LAYER_TRANSLUCENT : m === 'additive' || m === 'eyes' ? C.LAYER_ADDITIVE : C.LAYER_CUTOUT;
  };
  ER.DEFAULT_HIDDEN = { player: { ear: 1, cloak: 1 }, player_slim: { ear: 1, cloak: 1 },
    piglin: { ear: 1, cloak: 1, hat: 1 }, piglin_brute: { ear: 1, cloak: 1, hat: 1 },
    zombified_piglin: { ear: 1, cloak: 1, hat: 1 },
    // IllagerEntityModel's constructor: hat.visible = false (the arms/left_arm/right_arm flip is illagerArmHide's)
    evoker: { hat: 1 }, illusioner: { hat: 1 }, vindicator: { hat: 1 }, pillager: { hat: 1 } };
  /**
   * #6408 -- `PlayerEntityRenderer.setModelPose`: hat/jacket/sleeves/pants take `isPartVisible(part)`, i.e. the
   * Skin Customization options (`NS.Options.modelParts`). Only the bare player layers (the armor layers keep theirs).
   * The cape is already never drawn (`DEFAULT_HIDDEN` cloak), so its toggle has nothing further to hide.
   */
  var PART_OF = { hat: 'hat', jacket: 'jacket', left_sleeve: 'left_sleeve', right_sleeve: 'right_sleeve',
    left_pants: 'left_pants_leg', right_pants: 'right_pants_leg' };
  ER.playerPartsHidden = function (layerName) {
    if (layerName !== 'player' && layerName !== 'player_slim') return null;
    var O = NS.Options, mp = O && O.modelParts ? O.modelParts() : null, h = null;
    if (!mp) return null;
    for (var n in PART_OF) if (mp[PART_OF[n]] === false) (h || (h = {}))[n] = 1;
    return h;
  };
  /**
   * `PlayerEntityModel.setAngles` ends with `leftPants.copyTransform(leftLeg)` and its four
   * siblings: each skin-overlay part takes the exact pose of the part it covers, so it gets that
   * part's setAngles delta (and the arm-swing one) rather than a rule of its own.
   */
  ER.OVERLAY_OF = { left_sleeve: 'left_arm', right_sleeve: 'right_arm', left_pants: 'left_leg',
    right_pants: 'right_leg', jacket: 'body' };

  // ── PASS 16 -- setupAnim, JOB 4.4's angle deltas (D-263 bytecode-verified formulas) ────────────
  //
  // `tools/golden/setupanim-1.18.2.json` carries the exact vanilla constants this ports.
  // Ported ONLY for the two base classes (QuadrupedModel, HumanoidModel) this session verified
  // by fingerprint -- per-mob specials (creeper swell, spider legs, squid tentacles, chicken
  // wings) are each their own override class in vanilla and are NOT here; a part name this
  // function does not recognize returns null and is left at its REST pose (D-139: no guessing).

  var DEG2RAD = 0.017453292;  // pi/180, both base classes' own constant
  // ⚠ THE JAR'S OWN CONSTANT, not `180 / Math.PI`. `LookControl` multiplies by the float
  // literal `57.2957763671875` — a float32 rounding of 180/pi — and this is the return trip of
  // the same conversion, so the two agree to the bit rather than to nine decimal places.
  var RAD2DEG = 57.2957763671875;

  /**
   * Which `setupAnim` a LAYER belongs to, derived from the parts it actually has (D-415).
   *
   * ⚠ IT IS NOT A TYPE LIST, AND IT MUST NOT BE. The three base models are told apart by their
   * own part names — a spider has eight legs including `left_middle_front_leg`, a humanoid has
   * arms, a quadruped has front and hind legs — so a new mob layer lands in the right family the
   * day it is extracted, and one that matches none of them is left at its REST pose rather than
   * being posed by whichever branch happened to share a name.
   *
   * ⚠ AND IT IS WHY THIS FUNCTION EXISTS AT ALL. `left_front_leg`, `right_front_leg`,
   * `left_hind_leg` and `right_hind_leg` belong to BOTH the quadruped and the spider, so a
   * name-only lookup gave a spider a cow's trot: four of its eight legs swinging on the
   * quadruped's diagonal gait and the other four rigid.
   */
  var modelKindCache = null;
  ER.modelKindOf = function (layerName) {
    var BE = NS.BEModel;
    if (!BE || !BE.ready) return null;
    if (!modelKindCache) modelKindCache = {};
    if (modelKindCache[layerName] !== undefined) return modelKindCache[layerName];
    var L = BE.layer(layerName), kind = null;
    if (L && L.parts) {
      var has = {};
      for (var i = 0; i < L.parts.length; i++) has[L.parts[i].n] = 1;
      if (has.left_middle_front_leg && has.right_middle_hind_leg) kind = 'spider';
      else if (has.left_arm && has.left_leg) kind = 'humanoid';
      // D-788 residue (G18 leftover) -- the dragon's own `left_front_leg`/`left_hind_leg` names
      // are the SAME ones a real quadruped uses (tools/golden/models-1.18.2.tsv), so without this
      // check ahead of the quadruped one below it would get a cow's diagonal walk trot instead of
      // EnderDragonEntityRenderer's own flight-tuck pose. `jaw`+both wing tips are unique to it
      // among every layer this table has ever carried (ghast has tentacles, not wings/a jaw).
      else if (has.jaw && has.left_wing_tip && has.right_wing_tip) kind = 'ender_dragon';
      else if (has.left_front_leg && has.left_hind_leg) kind = 'quadruped';
      else if (has.tentacle0 && has.tentacle8 && has.body) kind = 'ghast';
      // #1569: SquidEntityModel (body + tentacle0..7, no tentacle8) -- every tentacle pitch = tentacleAngle.
      else if (has.tentacle0 && has.tentacle7 && has.body) kind = 'squid';
      // #851: SilverfishEntityModel (seg0..seg6 + 3 layer parts sharing seg0..2's names) and
      // EndermiteEntityModel (seg0..seg3) -- both wiggle from age alone.
      else if (has.part0 && has.part11 && has.head) kind = 'blaze';
      else if (has.seg0 && has.seg6) kind = 'silverfish';
      else if (has.seg0 && has.seg3 && !has.seg4) kind = 'endermite';
      else if (has.upper_body && has.lower_body && has.left_arm && has.right_arm) kind = 'snow_golem';
      else if (has.left_wing_base && has.tail_base) kind = 'phantom';
      else if (has.stinger && has.front_legs && has.left_antenna) kind = 'bee';
    }
    modelKindCache[layerName] = kind;
    return kind;
  };
  ER.resetModelKinds = function () { modelKindCache = null; zarmCache = null; };

  /**
   * ⚠⚠ **THE ARMS-OUT POSE — D-429.** Dan, session 55: *"the zombie doesnt have its arms out
   * pose"*. It was not a missing texture or a wrong rest angle: `ER.modelKindOf` correctly calls
   * a zombie a HUMANOID, because its part names ARE a humanoid's, and `HumanoidModel.setupAnim`
   * hangs the arms at the sides and swings them with the walk. The arms-out pose is a SECOND
   * layer, applied after the super call, in `AbstractZombieModel.setupAnim`:
   *
   *     AnimationUtils.animateZombieArms(leftArm, rightArm, isAggressive(e), attackTime, age)
   *
   * and it OVERWRITES all three angles of both arms rather than adding to them — so it cannot be
   * expressed as a delta on top of the humanoid swing, and the humanoid swing must not be added
   * to it. `ER.setupAnimDelta` returns the difference from REST for these two parts instead.
   *
   * ⚠ THE ANGLE IS NOT −π/2. Every description of this animation says the arms are set to
   * −π/2; the bytecode says −π over **1.5 when the mob is aggressive and 2.25 when it is not**
   * — −120° and −80°, neither of them −90° — and the difference between the two IS the "it
   * raises its arms when it comes for you" read. `tools/extract-zombiearms.mjs` is the referee.
   *
   * ⚠ AND IT IS NOT ONLY ZOMBIES. The same helper is called by the ILLAGER model, so a
   * vindicator and an illusioner charge with their arms out too. The set is the jar's own call
   * graph, not the word "zombie": a hand-written list would have had four of the five wrong.
   */
  var zarmCache = null;
  ER.zombieArms = function (layerName) {
    var D = NS.DATA, z = D && D.entities && D.entities.zarms;
    if (!z || !z.on || !z.on.length) return null;
    if (!zarmCache) {
      zarmCache = {};
      for (var i = 0; i < z.on.length; i++) zarmCache[z.on[i]] = 1;
      // #2654: PiglinEntityModel calls CrossbowPosing.meleeAttack for ZOMBIFIED_PIGLIN -- same pose maths
      // as animateZombieArms (the extractor only finds the latter's callers).
      zarmCache.zombified_piglin = 1;
    }
    return zarmCache[layerName] ? z.c : null;
  };

  /**
   * QUEUE 0.2 — **THE MOB SWING, CLOSED.** `attackTime` (this engine's name for Yarn's
   * `LivingEntity.getHandSwingProgress(partial)`, .decomp `net/minecraft/entity/LivingEntity`)
   * used to be a hard 0 (`ER.ZARM_OWED`, now deleted — D-433's own rule, a stage that
   * replaces something deletes the old thing): `Cb.mobAttack` landed every hit with no swing
   * behind it. `ER.swingHand`/`ER.tickHandSwing`/`ER.getHandSwingProgress` below are that
   * class's `swingHand`/`tickHandSwing`/`getHandSwingProgress` (.decomp lines 1627-1642,
   * 1810-1823, 2751-2759), transcribed onto the plain-object mob this engine has instead of a
   * `LivingEntity`. `Ai.MeleeAttackGoal` (07k_goals.js) calls `ER.swingHand(e)` the same tick
   * it calls `NS.Combat.mobAttack` — `MeleeAttackGoal.attack` (.decomp) calls
   * `this.mob.swingHand(Hand.MAIN_HAND)` THEN `this.mob.tryAttack($$0)`, unconditionally, so
   * the arm swings even on a miss (there is no miss: `tryAttack` always connects here, but the
   * ORDER — swing first — is the jar's own and is transcribed rather than reordered for
   * convenience). `EL.tickAnim` (07i_entitylist.js) calls `ER.tickHandSwing(e)` every tick,
   * beside the walk-cycle clock it already keeps, the same way `LivingEntity.tick()` keeps
   * `tickHandSwing()` beside `aiStep()`.
   */
  /** `LivingEntity.getHandSwingDuration()` (.decomp 1617-1623) — `6` unless the mob itself
   *  carries Haste or Mining Fatigue, which no rostered mob does today (`Ai.OWED`: mobs read no
   *  status effects of their own yet), so this is `6` for every live call and NAMED as such
   *  rather than silently dropping the effect branches the jar has. */
  ER.getHandSwingDuration = function (e) {
    var ST = NS.Effects;
    if (ST && ST.ready && ST.amplifierOf) {
      var haste = ST.amplifierOf(e, 'haste');
      if (haste >= 0) return 6 - (1 + haste);
      var fatigue = ST.amplifierOf(e, 'mining_fatigue');
      if (fatigue >= 0) return 6 + (1 + fatigue) * 2;
    }
    return 6;
  };
  /** `LivingEntity.swingHand(Hand, boolean)` (.decomp 1631-1644) — the two-arg overload's
   *  guard only (this engine has one hand and never calls the `$$1`/`updateSelf` branch that
   *  guard exists for), so what is transcribed is exactly the re-entrancy rule: a swing already
   *  past its own halfway point restarts rather than being ignored. */
  ER.swingHand = function (e) {
    if (!e) return;
    var dur = ER.getHandSwingDuration(e);
    var ticks = e.handSwingTicks || 0;
    if (!e.handSwinging || ticks >= dur / 2 || ticks < 0) {
      e.handSwingTicks = -1;
      e.handSwinging = true;
    }
  };
  /** `LivingEntity.tickHandSwing()` (.decomp 1810-1823) verbatim, plus the `lastHandSwingProgress
   *  = handSwingProgress` snapshot `LivingEntity.tick()` (.decomp line 329) takes at the TOP of
   *  the tick — taken here instead, at the top of THIS function, which is the same ordering
   *  since nothing else in this engine reads either field between the two. */
  ER.tickHandSwing = function (e) {
    if (!e || e.maxHealth === undefined) return;
    e.lastHandSwingProgress = e.handSwingProgress || 0;
    var dur = ER.getHandSwingDuration(e);
    if (e.handSwinging) {
      e.handSwingTicks = (e.handSwingTicks || 0) + 1;
      if (e.handSwingTicks >= dur) { e.handSwingTicks = 0; e.handSwinging = false; }
    } else {
      e.handSwingTicks = 0;
    }
    e.handSwingProgress = e.handSwingTicks / dur;
  };
  /** `LivingEntity.getHandSwingProgress(partial)` (.decomp 2751-2759) verbatim — the wraparound
   *  add-1 is for the tick a swing resets `handSwingProgress` to 0 while `lastHandSwingProgress`
   *  was still near 1, so the interpolated value keeps climbing to 1 instead of snapping back. */
  ER.getHandSwingProgress = function (e, partial) {
    if (!e) return 0;
    var last = e.lastHandSwingProgress || 0, cur = e.handSwingProgress || 0;
    var d = cur - last;
    if (d < 0) d += 1;
    return last + d * partial;
  };

  /** #651 -- `IllagerEntityModel.setAngles` SPELLCASTING branch (.decomp IllagerEntityModel.java:118-128):
   *  pivots (+-5,_,0), pitch = cos(age*0.6662)*0.25, roll = +-3pi/4, yaw 0. Rest of both arms is
   *  pivot (+-5,2,0) rot 0, so this is a delta of pitch/roll only. */
  ER.illagerSpellArm = function (partName, ageInTicks) {
    var right = partName === 'right_arm';
    return { rx: Math.cos(ageInTicks * 0.6662) * 0.25, ry: 0, rz: right ? Math.PI * 3 / 4 : -Math.PI * 3 / 4 };
  };
  /** `IllagerEntityModel.setAngles` tail: `arms.visible = state == CROSSED`, the two arms the
   *  opposite. Only the evoker is wired (its other states are never entered); keyed by layer. */
  ER.ILLAGERS = { evoker: 1, illusioner: 1, vindicator: 1, pillager: 1 };
  ER.illagerArmHide = function (layerName, state) {
    if (!ER.ILLAGERS[String(layerName).split('#')[0]]) return null;
    return state && state !== 'CROSSED' ? { arms: 1, left_shoulder: 1 } : { left_arm: 1, right_arm: 1 };
  };
  /** `IllagerEntity.getState()` per type (PillagerEntity / VindicatorEntity / SpellcastingIllagerEntity /
   *  IllusionerEntity .decomp); null for a non-illager. `e.attacking` is vanilla's isAttacking flag. */
  ER.illagerMainEmpty = function (e) {
    if (!e || !ER.ILLAGERS[e.type]) return false;
    var Eq = NS.Equip, IT = NS.Items, st = Eq && Eq.getEquipped && IT ? Eq.getEquipped(e, IT.MAINHAND) : null;
    return !(st && st.i >= 0);
  };
  ER.illagerStateOf = function (e) {
    if (!e || !ER.ILLAGERS[e.type]) return null;
    var spell = !!(NS.Spell && NS.Spell.isSpellcasting(e));
    if (e.type === 'pillager') {
      if (e.crossbowCharging) return 'CROSSBOW_CHARGE';
      var Eq = NS.Equip, IT = NS.Items, st = Eq && Eq.getEquipped && IT && IT.MAINHAND !== undefined ? Eq.getEquipped(e, IT.MAINHAND) : null;
      var st2 = Eq && Eq.getEquipped && IT && IT.OFFHAND !== undefined ? Eq.getEquipped(e, IT.OFFHAND) : null;
      if ((st && st.i >= 0 && IT.nameOf(st.i) === 'crossbow') || (st2 && st2.i >= 0 && IT.nameOf(st2.i) === 'crossbow')) return 'CROSSBOW_HOLD';
      return e.attacking ? 'ATTACKING' : 'CROSSED';
    }
    if (e.type === 'vindicator') return e.attacking ? 'ATTACKING' : (e.celebrating ? 'CELEBRATING' : 'CROSSED');
    if (spell) return 'SPELLCASTING';
    if (e.type === 'illusioner') return e.attacking ? 'BOW_AND_ARROW' : 'CROSSED';
    return e.celebrating ? 'CELEBRATING' : 'CROSSED';
  };
  /** `IllagerEntityModel.setAngles` arm block + `CrossbowPosing` (.decomp), as a DELTA from the arm's rest
   *  (pivot (+-5,2,0), rot 0). `c` = { state, ageInTicks, attackTime, leftHanded, mainEmpty, charge, rest }. */
  ER.illagerArmDelta = function (partName, limbSwing, amount, headYaw, headPitch, riding, c) {
    var right = partName === 'right_arm', st = c.state, age = c.ageInTicks || 0, rest = c.rest || {};
    var P = Math.PI, hy = (headYaw || 0) * DEG2RAD, hp = (headPitch || 0) * DEG2RAD;
    var pitch, yaw = 0, roll = 0;
    if (riding) pitch = -P / 5;
    else pitch = Math.cos(limbSwing * 0.6662 + (right ? P : 0)) * 2 * amount * 0.5;
    var swingArm = function (sgn) {
      roll += sgn * (Math.cos(age * 0.09) * 0.05 + 0.05);
      pitch += sgn * Math.sin(age * 0.067) * 0.05;
    };
    if (st === 'ATTACKING') {
      var t = c.attackTime || 0, s5 = Math.sin(t * P), s6 = Math.sin((1 - (1 - t) * (1 - t)) * P);
      roll = 0;
      if (c.mainEmpty) {
        yaw = right ? -(0.1 - s5 * 0.6) : 0.1 - s5 * 0.6;
        pitch = -P / 1.5 + s5 * 1.2 - s6 * 0.4;
      } else {
        var mainRight = !c.leftHanded, isMain = right === mainRight;
        yaw = right ? P / 20 : -P / 20;
        pitch = isMain ? -1.8849558 + Math.cos(age * 0.09) * 0.15 + s5 * 2.2 - s6 * 0.4
                       : Math.cos(age * 0.19) * 0.5 + s5 * 1.2 - s6 * 0.4;
      }
      swingArm(right ? 1 : -1);
    } else if (st === 'SPELLCASTING') {
      pitch = Math.cos(age * 0.6662) * 0.25; roll = right ? P * 3 / 4 : -P * 3 / 4; yaw = 0;
    } else if (st === 'BOW_AND_ARROW') {
      if (right) { yaw = -0.1 + hy; pitch = -P / 2 + hp; }
      else { yaw = hy - 0.4; pitch = -0.9424779 + hp; roll = P / 2; }
    } else if (st === 'CROSSBOW_HOLD') {
      if (right) { yaw = -0.3 + hy; pitch = -P / 2 + hp + 0.1; } else { yaw = 0.6 + hy; pitch = -1.5 + hp; }
    } else if (st === 'CROSSBOW_CHARGE') {
      var f = Math.max(0, Math.min(1, c.charge || 0)), p0 = -0.97079635;
      if (right) { yaw = -0.8; pitch = p0; }
      else { yaw = 0.4 + (0.85 - 0.4) * f; pitch = p0 + (-P / 2 - p0) * f; }
    } else if (st === 'CELEBRATING') {
      pitch = Math.cos(age * 0.6662) * 0.05; roll = right ? 2.670354 : -P * 3 / 4; yaw = 0;
    }
    return { rx: pitch - (rest.rx || 0), ry: yaw - (rest.ry || 0), rz: roll - (rest.rz || 0) };
  };

  /** `AnimationUtils.animateZombieArms` + `bobArms`, as a DELTA from a part's rest angles. */
  ER.zombieArmDelta = function (partName, C, ageInTicks, attackTime, aggressive, rest) {
    var left = partName === 'left_arm';
    var f = Math.sin(attackTime * Math.PI);
    var f1 = Math.sin((1 - (1 - attackTime) * (1 - attackTime)) * Math.PI);
    var yaw = C.yawBase - f * C.yawSwing;
    var zRot = 0;
    var yRot = left ? yaw : -yaw;
    var xRot = -Math.PI / (aggressive ? C.aggrDiv : C.calmDiv);
    xRot += f * C.swing1 - f1 * C.swing2;
    // bobArms(rightArm, leftArm, age): the RIGHT arm gets +1 and the LEFT arm gets -1.
    var sign = left ? -1 : 1;
    zRot += sign * (Math.cos(ageInTicks * C.bobZFreq) * C.bobAmp + C.bobAmp);
    xRot += sign * (Math.sin(ageInTicks * C.bobXFreq) * C.bobAmp);
    var r = rest || { rx: 0, ry: 0, rz: 0 };
    return { rx: xRot - (r.rx || 0), ry: yRot - (r.ry || 0), rz: zRot - (r.rz || 0) };
  };

  /**
   * `SpiderModel.setupAnim`, transcribed from `elg.a(T,FFFFF)`'s bytecode (D-415). Every constant
   * below is an `ldc` in that method, in the order it appears, and the field mapping comes from
   * the constructor's own `getChild` strings (`l` = right_hind_leg … `t` = left_front_leg;
   * `emb.d` = xRot, `emb.e` = yRot, `emb.f` = zRot, which is how the head's two lines identify
   * themselves).
   *
   *   base zRot   +-0.7853982 (pi/4) for the outer pairs, +-0.58119464 (pi/4 * 0.74) for the
   *               middle two — RIGHT negative, LEFT positive, which is what splays them outward
   *   base yRot   +-0.7853982 for the hind and front pairs, +-0.3926991 (pi/8) for the middle
   *               two, with the FRONT pair's sign reversed so the legs fan fore and aft
   *   swing      `-(cos(limbSwing * 0.6662 * 2 + phase) * 0.4) * amount` on yRot, at phases
   *               0, pi, pi/2, 3pi/2 for the four pairs; right + delta, left - delta
   *   lift       `abs(sin(limbSwing * 0.6662 + phase) * 0.4) * amount` on zRot, at the SAME
   *               four phases but at HALF the frequency and through `abs`, so a leg lifts once
   *               per cycle instead of twice. Right + delta, left - delta.
   *
   * ⚠ The spider's rest pose is all zeros (every leg's `rx`/`ry`/`rz` in the layer is 0), so
   * vanilla's assignments and this file's DELTAS are the same number. That is a fact about the
   * data, checked, not an assumption: `animcheck` asserts the rest pose is zero before it
   * asserts these.
   */
  var SPIDER_LEGS = {
    right_hind_leg:         { z: -0.7853982,  y:  0.7853982, phase: 0,          sign:  1 },
    left_hind_leg:          { z:  0.7853982,  y: -0.7853982, phase: 0,          sign: -1 },
    right_middle_hind_leg:  { z: -0.58119464, y:  0.3926991, phase: Math.PI,    sign:  1 },
    left_middle_hind_leg:   { z:  0.58119464, y: -0.3926991, phase: Math.PI,    sign: -1 },
    right_middle_front_leg: { z: -0.58119464, y: -0.3926991, phase: 1.5707964,  sign:  1 },
    left_middle_front_leg:  { z:  0.58119464, y:  0.3926991, phase: 1.5707964,  sign: -1 },
    right_front_leg:        { z: -0.7853982,  y: -0.7853982, phase: 4.712389,   sign:  1 },
    left_front_leg:         { z:  0.7853982,  y:  0.7853982, phase: 4.712389,   sign: -1 }
  };
  ER.SPIDER_FREQ = 0.6662;
  ER.SPIDER_AMP = 0.4;

  ER.spiderDelta = function (partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch) {
    if (partName === 'head') {
      return { rx: headPitch * DEG2RAD, ry: netHeadYaw * DEG2RAD, rz: 0 };
    }
    var L = SPIDER_LEGS[partName];
    if (!L) return null;                       // body0/body1 are never posed
    var F = ER.SPIDER_FREQ, A = ER.SPIDER_AMP;
    var swing = -(Math.cos(limbSwing * F * 2 + L.phase) * A) * limbSwingAmount;
    var lift = Math.abs(Math.sin(limbSwing * F + L.phase) * A) * limbSwingAmount;
    return { rx: 0, ry: L.y + L.sign * swing, rz: L.z + L.sign * lift };
  };

  /** One part's angle DELTA, in radians, to ADD to its rest rx/ry/rz -- or null if this part
   *  name isn't one of the base classes' own parts (left at rest; D-139, not guessed).
   *  vanilla's own five setupAnim args; `riding` is a bool. Formulas from
   *  tools/golden/setupanim-1.18.2.json, verified by bytecode fingerprint (D-263); the spider's
   *  are D-415's, straight off `elg.a`'s own bytecode. `kind` is `ER.modelKindOf`'s answer —
   *  omitted, the two base classes' shared names behave exactly as they did before this session. */
  /**
   * s133 — `BipedEntityModel.animateArms` (.decomp, read whole), run inside every BipedEntityModel
   * subclass's setAngles once `handSwingProgress > 0`: the body twists `sin(sqrt(t)*2PI)*0.2` (mirrored
   * for a left-handed mob, `getPreferredArm`), both arm pivots swing round with it (x = -/+cos*5,
   * z = +/-sin*5), both arms take the twist as yaw and the left arm as pitch too, and the MAIN arm
   * chops: pitch -= sin((1-(1-t)^4)*PI)*1.2 + sin(t*PI)*-(head.pitch-0.7)*0.75, yaw += twist*2,
   * roll += sin(t*PI)*-0.4. Before this no humanoid's main arm moved when it hit (KW-32).
   * `ER.BIPED_SWING` = the layers whose model extends BipedEntityModel (grep "extends
   * BipedEntityModel|PlayerEntityModel|AbstractZombieModel|SkeletonEntityModel", .decomp); illagers,
   * witches and villagers have models of their own and are not in it. A zombie's arms are then
   * REASSIGNED by animateZombieArms (all three angles), so for it only the pivots and body survive.
   */
  ER.BIPED_SWING = { zombie: 1, husk: 1, drowned: 1, drowned_outer: 1, zombie_villager: 1, zombified_piglin: 1, giant: 1,
    skeleton: 1, stray: 1, stray_outer: 1, wither_skeleton: 1, piglin: 1, piglin_brute: 1, enderman: 1, vex: 1, player: 1, player_slim: 1 };
  ER.animateArmsDelta = function (partName, t, leftHanded, headPitchRad, rest, anglesToo) {
    if (!(t > 0)) return null;
    var by = Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.2;
    if (leftHanded) by = -by;
    if (partName === 'body') return { rx: 0, ry: by, rz: 0 };
    if (partName !== 'right_arm' && partName !== 'left_arm') return null;
    var right = partName === 'right_arm', r = rest || { px: right ? -5 : 5, pz: 0 };
    var d = { rx: 0, ry: 0, rz: 0,
      dpx: (right ? -Math.cos(by) * 5 : Math.cos(by) * 5) - (r.px || 0),
      dpz: (right ? Math.sin(by) * 5 : -Math.sin(by) * 5) - (r.pz || 0) };
    if (!anglesToo) return d;
    d.ry = by;
    if (!right) d.rx = by;
    if (partName === (leftHanded ? 'left_arm' : 'right_arm')) {
      var f = 1 - t; f *= f; f *= f; f = 1 - f;
      var g = Math.sin(f * Math.PI), h = Math.sin(t * Math.PI) * -(headPitchRad - 0.7) * 0.75;
      d.rx -= g * 1.2 + h;
      d.ry += by * 2;
      d.rz += Math.sin(t * Math.PI) * -0.4;
    }
    return d;
  };
  /**
   * s134 -- the parent links the flattened model table drops (tools/extract-models.mjs keeps one
   * pivot + rotation per box). Read off each model's getTexturedModelData (.decomp):
   * HoglinEntityModel — `head.addChild(right_ear/left_ear/right_horn/left_horn)`, `body.addChild(mane)`;
   * ZoglinEntityRenderer draws the same HoglinEntityModel. Before this the hoglin's ears and horns
   * were drawn at their head-local pivots in the ROOT frame (floating off the snout, never turning
   * with the head) and the mane 7 units too high.
   */
  var GUARDIAN_PARENTS = { eye: 'head', tail0: 'head', tail1: 'tail0', tail2: 'tail1' };
  for (var gi = 0; gi < 12; gi++) GUARDIAN_PARENTS['spike' + gi] = 'head';
  ER.PART_PARENT = {
    // #1567 -- EnderDragonEntityModel tree: root (render()'s translate/pitch) > body-roll group > body/wings/legs;
    // neck/head/tail hang off the root only. Tips and feet are children of their limb (their table pivots are parent-local).
    ender_dragon: { head: 'dragon_root', jaw: 'head', neck: 'dragon_root', dragon_body: 'dragon_root',   // #1848: ONE key - a second `ender_dragon:` literal below (#1568's jaw/tips) silently replaced this tree
      body: 'dragon_body', left_wing: 'dragon_body', right_wing: 'dragon_body', left_wing_tip: 'left_wing', right_wing_tip: 'right_wing',
      left_front_leg: 'dragon_body', right_front_leg: 'dragon_body', left_hind_leg: 'dragon_body', right_hind_leg: 'dragon_body',
      left_front_leg_tip: 'left_front_leg', right_front_leg_tip: 'right_front_leg', left_front_foot: 'left_front_leg_tip', right_front_foot: 'right_front_leg_tip',
      left_hind_leg_tip: 'left_hind_leg', right_hind_leg_tip: 'right_hind_leg', left_hind_foot: 'left_hind_leg_tip', right_hind_foot: 'right_hind_leg_tip' },
    dolphin: { head: 'body', back_fin: 'body', left_fin: 'body', right_fin: 'body', tail: 'body', tail_fin: 'tail', nose: 'head' },
    strider: { right_bottom_bristle: 'body', right_middle_bristle: 'body', right_top_bristle: 'body',
               left_top_bristle: 'body', left_middle_bristle: 'body', left_bottom_bristle: 'body' },
    hoglin: { right_ear: 'head', left_ear: 'head', right_horn: 'head', left_horn: 'head', mane: 'body' },
    zoglin: { right_ear: 'head', left_ear: 'head', right_horn: 'head', left_horn: 'head', mane: 'body' },
    // #843 -- RavagerEntityModel.getTexturedModelData: neck > head > (mouth, right_horn, left_horn).
    ravager: { head: 'neck', mouth: 'head', right_horn: 'head', left_horn: 'head' },
    // GoatEntityModel: head.addChild(left_horn/right_horn/nose) (#750).
    goat: { left_horn: 'head', right_horn: 'head', nose: 'head' },
    // D-KW hat/nose pivot sweep (Dan, "check every model with a hat/nose child"): every one of
    // these child parts has a NONZERO parent-local pivot (tools/golden/models-1.18.2.tsv --
    // `villager nose 0 -2 0`, `witch hat -5 -10.03125 -5`, ...) and was previously posed with
    // NO parent composition at all, so it never turned with the head it is supposed to sit on
    // -- exactly the hoglin ear/horn bug above, on a villager-family head instead of a hoglin's.
    // `hat` itself is NOT listed for villager/wandering_trader/zombie_villager/the illagers:
    // their `hat`'s own parent-local pivot is (0,0,0) -- the SAME origin as `head` -- so
    // `ER.setupAnimDeltaCore`'s direct `partName === 'hat'` override (below) already gives the
    // byte-identical answer a full compose would, and is left alone. Witch's `hat` pivot is
    // NOT (0,0,0) (it is the cone's own off-centre pivot), so it DOES need the full chain --
    // `ER.setupAnimDeltaCore`'s `ctx.hatComposed` guard turns the direct override off for
    // exactly this one layer so the two mechanisms do not double-rotate it.
    villager: { hat_rim: 'hat', nose: 'head' },
    wandering_trader: { hat_rim: 'hat', nose: 'head' },
    zombie_villager: { hat_rim: 'hat' },
    witch: { hat: 'head', hat2: 'hat', hat3: 'hat2', hat4: 'hat3', hat_rim: 'hat', nose: 'head', mole: 'nose' },
    evoker: { nose: 'head', left_shoulder: 'arms' },   // IllagerEntityModel: arms.addChild(left_shoulder)
    illusioner: { nose: 'head', left_shoulder: 'arms' },   // IllagerEntityModel: arms.addChild(left_shoulder)
    pillager: { nose: 'head', left_shoulder: 'arms' },   // IllagerEntityModel: arms.addChild(left_shoulder)
    vindicator: { nose: 'head', left_shoulder: 'arms' },   // IllagerEntityModel: arms.addChild(left_shoulder)
    // #1162 -- BeeEntityModel: bone(pivot 0,19,0) > body > (stinger, antennae), bone > wings/legs.
    // #1202 -- the same parent links, read off each model's getTexturedModelData (.decomp). WolfEntityModel:
    // head > real_head, tail > real_tail (box-less parents: VIRTUAL_PARTS). SalmonEntityModel: body_front > top_front_fin,
    // body_back > (back_fin, top_back_fin). AxolotlEntityModel: body > (head > gills, four legs, tail).
    wolf: { real_head: 'head', real_tail: 'tail' },
    // #1284 -- FoxEntityModel: head > (right_ear, left_ear, nose); body > tail.
    fox: { right_ear: 'head', left_ear: 'head', nose: 'head', tail: 'body' },
    // #1352 -- HorseEntityModel: head_parts > (head > ears, mane, upper_mouth, saddle bits); body > (tail, saddle).
    horse: { head: 'head_parts', mane: 'head_parts', upper_mouth: 'head_parts', left_saddle_mouth: 'head_parts', right_saddle_mouth: 'head_parts',
             left_saddle_line: 'head_parts', right_saddle_line: 'head_parts', head_saddle: 'head_parts', mouth_saddle_wrap: 'head_parts',
             left_ear: 'head', right_ear: 'head', tail: 'body', saddle: 'body' },
    donkey: { head: 'head_parts', mane: 'head_parts', upper_mouth: 'head_parts', left_saddle_mouth: 'head_parts', right_saddle_mouth: 'head_parts',
             left_saddle_line: 'head_parts', right_saddle_line: 'head_parts', head_saddle: 'head_parts', mouth_saddle_wrap: 'head_parts',
             left_ear: 'head', right_ear: 'head', tail: 'body', saddle: 'body', left_chest: 'body', right_chest: 'body' },
    mule: { head: 'head_parts', mane: 'head_parts', upper_mouth: 'head_parts', left_saddle_mouth: 'head_parts', right_saddle_mouth: 'head_parts',
             left_saddle_line: 'head_parts', right_saddle_line: 'head_parts', head_saddle: 'head_parts', mouth_saddle_wrap: 'head_parts',
             left_ear: 'head', right_ear: 'head', tail: 'body', saddle: 'body', left_chest: 'body', right_chest: 'body' },
    zombie_horse: { head: 'head_parts', mane: 'head_parts', upper_mouth: 'head_parts', left_saddle_mouth: 'head_parts', right_saddle_mouth: 'head_parts',
             left_saddle_line: 'head_parts', right_saddle_line: 'head_parts', head_saddle: 'head_parts', mouth_saddle_wrap: 'head_parts',
             left_ear: 'head', right_ear: 'head', tail: 'body', saddle: 'body' },
    skeleton_horse: { head: 'head_parts', mane: 'head_parts', upper_mouth: 'head_parts', left_saddle_mouth: 'head_parts', right_saddle_mouth: 'head_parts',
             left_saddle_line: 'head_parts', right_saddle_line: 'head_parts', head_saddle: 'head_parts', mouth_saddle_wrap: 'head_parts',
             left_ear: 'head', right_ear: 'head', tail: 'body', saddle: 'body' },
    // #1226 -- ParrotEntityModel: head > (head2, beak1, beak2, feather).
    bat: { right_ear: 'head', left_ear: 'head', right_wing: 'body', left_wing: 'body', right_wing_tip: 'right_wing', left_wing_tip: 'left_wing' },
    parrot: { head2: 'head', beak1: 'head', beak2: 'head', feather: 'head' },
    // #1541 -- PhantomEntityModel: body > (head, left_wing_base > left_wing_tip, right_wing_base > right_wing_tip, tail_base > tail_tip).
    phantom: { head: 'body', left_wing_base: 'body', right_wing_base: 'body', tail_base: 'body',
               left_wing_tip: 'left_wing_base', right_wing_tip: 'right_wing_base', tail_tip: 'tail_base' },
    // #1596 -- GuardianEntityModel: head > (spike0..11, eye, tail0 > tail1 > tail2); the head itself has pivot NONE.
    guardian: GUARDIAN_PARENTS, elder_guardian: GUARDIAN_PARENTS,
    salmon: { top_front_fin: 'body_front', back_fin: 'body_back', top_back_fin: 'body_back' },
    axolotl: { head: 'body', right_hind_leg: 'body', left_hind_leg: 'body', right_front_leg: 'body', left_front_leg: 'body',
               tail: 'body', top_gills: 'head', left_gills: 'head', right_gills: 'head' },
    bee: { body: 'bone', left_wing: 'bone', right_wing: 'bone', front_legs: 'bone', middle_legs: 'bone', back_legs: 'bone',
           stinger: 'body', left_antenna: 'body', right_antenna: 'body' }
  };
  /**
   * #1162 -- a parent part with NO cuboids never reaches the flattened model table (one row per box), so its
   * pivot/rotation was lost and its children drew at the root origin. The bee's `bone` (pivot 0,19,0) is the
   * one still missing (#1202: and the wolf's head/tail).
   */
  var VP = function (n, px, py, pz, rx) { return { n: n, tu: 0, tv: 0, x: 0, y: 0, z: 0, w: 0, h: 0, d: 0, px: px, py: py, pz: pz, rx: rx, ry: 0, rz: 0, m: 0, g: 0, virtual: true }; };
  ER.VIRTUAL_PARTS = { ender_dragon: { dragon_root: VP('dragon_root', 0, 0, 0, 0), dragon_body: VP('dragon_body', 0, 0, 0, 0) }, bee: { bone: VP('bone', 0, 19, 0, 0) },
    wolf: { head: VP('head', -1, 13.5, -7, 0), tail: VP('tail', -1, 12, 8, 0.6283185307179586) } };
  ER.partParentOf = function (layerName, partName) {
    var ln = String(layerName).split('#')[0];
    var t = ER.PART_PARENT[ln === 'strider_saddle' ? 'strider' : ln];   // #7866: the saddle layer is the strider's own model, bristles hang off the body
    return (t && t[partName]) || null;
  };
  /** The top of a part's parent chain — a head child takes the head's BABY transform (AnimalModel
   *  scales getHeadParts() with everything under them). */
  ER.partRootOf = function (layerName, partName) {
    var n = partName, guard = 0, up;
    while ((up = ER.partParentOf(layerName, n)) && guard++ < 8) n = up;
    return n;
  };
  /** A part with its setAngles delta applied (the same clone emitMobLayer makes inline). */
  ER.posedPart = function (p, anim, layerName) {
    if (!anim) return p;
    var d = anim.deltaFor ? anim.deltaFor(p.n)
          : ER.setupAnimDelta(p.n, anim.limbSwing, anim.limbSwingAmount, anim.netHeadYaw, anim.headPitch, anim.riding,
                              ER.modelKindOf(layerName), { zarm: ER.zombieArms(layerName), rest: p,
                              biped: !!ER.BIPED_SWING[String(layerName).split('#')[0]], leftHanded: anim.leftHanded,
                              ageInTicks: anim.ageInTicks, attackTime: anim.attackTime, aggressive: anim.aggressive, player: anim.player, skelMelee: anim.skelMelee, skelBow: anim.skelBow, trident: anim.trident, drownedLp: anim.drownedLp, drownedSwim: anim.drownedSwim,
                              spellcast: anim.spellcasting, illager: anim.illager ? { state: anim.illager, ageInTicks: anim.ageInTicks, attackTime: anim.attackTime, leftHanded: anim.leftHanded, mainEmpty: anim.mainEmpty, charge: anim.illagerCharge, rest: p } : null, vex: anim.vex,
                              phantomId: anim.phantomId, bee: anim.bee, squid: anim.squid, dragon: anim.dragon,
                              chickenWingRoll: anim.chickenWingRoll, feline: anim.feline, fish: anim.fish, sheepEatGrass: anim.sheepEatGrass, panda: anim.panda,
                              hoglin: anim.hoglin, witch: anim.witch, strider: anim.strider, axolotl: anim.axolotl, golem: anim.golem, headShake: anim.headShake, vleg: anim.vleg, enderman: anim.enderman, slime: anim.slime, dolphin: anim.dolphin, guardian: anim.guardian, turtle: anim.turtle, rabbit: anim.rabbit, wolf: anim.wolf, fox: anim.fox, horse: anim.horse, parrot: anim.parrot, bat: anim.bat, baby: anim.baby, wither: anim.wither, ravager: anim.ravager, polarBear: anim.polarBear,
                              piglin: /^(piglin|piglin_brute|zombified_piglin)(#|$)/.test(String(layerName)), piglinMelee: anim.piglinMelee, piglinDance: anim.piglinDance, piglinPose: anim.piglinPose,
                              // D-KW: witch's `hat` is ALSO a PART_PARENT child of `head` (its
                              // pivot is not (0,0,0) the way every other hat-wearer's is), so the
                              // direct head-rotation shortcut below must not ALSO fire for it --
                              // one rotation from ONE mechanism, never both.
                              hatComposed: !!ER.partParentOf(layerName, 'hat') });
    if (!d) return p;
    return { n: p.n, tu: p.tu, tv: p.tv, x: p.x, y: p.y, z: p.z, w: p.w, h: p.h, d: p.d,
             px: p.px + (d.dpx || 0), py: p.py + (d.dpy || 0), pz: p.pz + (d.dpz || 0),
             rx: p.rx + d.rx, ry: p.ry + d.ry, rz: p.rz + d.rz, m: p.m, g: p.g, gy: p.gy };
  };
  /** A part looked up by name out of a layer's own (rest) parts list. */
  ER.findRestPart = function (parts, name) {
    for (var i = 0; i < parts.length; i++) if (parts[i].n === name) return parts[i];
    return null;
  };
  ER.findRestPartIn = function (parts, layerName, name) {
    var t = ER.VIRTUAL_PARTS[String(layerName).split('#')[0]];
    return ER.findRestPart(parts, name) || (t && t[name]) || null;
  };
  /**
   * D-KW -- the FULL chain, recursively: `ER.composeChild` on its own only ever composes ONE
   * level (a direct parent's posed transform onto a child), which is exactly what hoglin's
   * 2-level chains (head->ear, body->mane) need but NOT what a 3-4 level chain needs (witch's
   * `head -> hat -> hat2 -> hat3 -> hat4`, or `hat_rim`/`nose`'s own `-> hat/head` hop on TOP of
   * head's own rotation) -- composing a child straight onto its parent's UNCOMPOSED rest+delta
   * transform silently drops every ancestor above that one parent. This walks the chain from
   * the ROOT down, composing one level at a time, so a grandchild inherits its grandparent's
   * posed rotation too.
   */
  ER.fullyPosedPart = function (parts, layerName, anim, name) {
    var rest = ER.findRestPartIn(parts, layerName, name);
    if (!rest) return null;
    var posed = ER.posedPart(rest, anim, layerName);
    var parName = ER.partParentOf(layerName, name);
    if (!parName) return posed;
    var parPosed = ER.fullyPosedPart(parts, layerName, anim, parName);
    return parPosed ? ER.composeChild(parPosed, posed) : posed;
  };
  /** Rz·Ry·Rx (ModelPart.rotate's order, 15h rotateZYX) as a row-major 3x3. */
  ER.rotMatrix = function (rx, ry, rz) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
            -sy,     cy * sx,                cy * cx];
  };
  /** The (rx,ry,rz) Euler triple `ER.rotMatrix` would build INTO the 3x3 `M` -- the return
   *  half of that conversion, shared by `ER.composeChild` (below) and the crystal-render
   *  matrix chain (D-835, loop/crystal-render-beam) so the two never drift on the same
   *  decomposition (D-314's own warning, one more time). */
  ER.eulerOf = function (M) {
    var sy = -M[6]; if (sy > 1) sy = 1; if (sy < -1) sy = -1;
    var ry = Math.asin(sy), rx, rz;
    if (Math.abs(sy) < 0.9999999) { rx = Math.atan2(M[7], M[8]); rz = Math.atan2(M[3], M[0]); }
    else { rx = 0; rz = Math.atan2(-M[1], M[4]); }
    return { rx: rx, ry: ry, rz: rz };
  };
  /** parent ∘ child: pivot = Pp + Mp·Pc, rotation Mp·Mc decomposed back into Rz·Ry·Rx angles. */
  ER.composeChild = function (par, ch) {
    var A = ER.rotMatrix(par.rx, par.ry, par.rz), B = ER.rotMatrix(ch.rx, ch.ry, ch.rz), M = new Array(9);
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
      M[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    var eu = ER.eulerOf(M);
    return { n: ch.n, tu: ch.tu, tv: ch.tv, x: ch.x, y: ch.y, z: ch.z, w: ch.w, h: ch.h, d: ch.d,
             px: par.px + A[0] * ch.px + A[1] * ch.py + A[2] * ch.pz,
             py: par.py + A[3] * ch.px + A[4] * ch.py + A[5] * ch.pz,
             pz: par.pz + A[6] * ch.px + A[7] * ch.py + A[8] * ch.pz,
             rx: eu.rx, ry: eu.ry, rz: eu.rz, m: ch.m, g: ch.g, gy: ch.gy };
  };
  /**
   * s134 -- `HoglinEntityModel.setAngles` (method_24461, .decomp, read whole), as deltas from rest:
   *   ears: right.roll = -2PI/9 - a*sin(l), left.roll = 2PI/9 + a*sin(l);  head.yaw = netHeadYaw;
   *   head.pitch = lerp(t, 0.87266463, -PI/9), t = 1 - |10 - 2*movementCooldownTicks| / 10 (the
   *   strike's toss: 0 at rest, 1 at cooldown 5); a BABY also lifts head.pivotY lerp(t, 2, 5) and
   *   sets mane.pivotZ -3 (adult -7 — the rest -5 is never drawn); legs cos(l)*1.2*a — NOT the
   *   quadruped's cos(l*0.6662)*1.4 — right front = left hind, left front = right hind.
   */
  ER.HOGLIN_HEAD_PITCH_START = 0.87266463;
  ER.HOGLIN_HEAD_PITCH_END = -Math.PI / 9;
  /**
   * #933 -- `StriderEntityModel.setAngles` (method_26414, .decomp), as deltas from rest (golden tsv):
   * limbDistance clamped to 0.25; body pitch/yaw = head pitch/yaw unless ridden, roll 0.1*sin(l*1.5)*4*a,
   * pivotY 2 - 2*cos(l*1.5)*2*a (rest 1); legs pitch sin(l*.75)*2*a (right +PI), roll PI/18*cos, pivotY 8 +- ..;
   * bristle rolls = rest + cos(l*1.5+PI)*a*{1.3,1.2,0.6} + the ageInTicks wobble.
   */
  ER.STRIDER_BRISTLE = { right_bottom_bristle: [1.3, 0.05, -0.4], right_middle_bristle: [1.2, 0.1, 0.2], right_top_bristle: [0.6, 0.1, 0.4],
                         left_top_bristle: [0.6, 0.1, 0.4], left_middle_bristle: [1.2, 0.1, 0.2], left_bottom_bristle: [1.3, 0.05, -0.4] };
  /**
   * #7788 -- AxolotlEntityModel.method_33293 (.decomp): resetAngles from the entity's cached angles (or the
   * body pitch/yaw when the cache is empty), then ONE of five poses that lerpAngleDegrees toward its target
   * (the radians-through-a-degrees-lerp is vanilla's own). `prev` is the cache ({part:{rx,ry,rz}} or null);
   * the pose in the air (neither water nor ground) leaves the reset angles and does not write the cache.
   * st = { dead, water, moving, ground }. Returns { pose, bodyPivotY, cache }.
   */
  var AX_PARTS = ['body', 'head', 'right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg', 'tail', 'top_gills', 'left_gills', 'right_gills'];
  var axWrap = function (d) { d = d % 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
  ER.axolotlPose = function (prev, st, age, yaw, pitch) {
    var P = {}, i, n, M = Math, D = M.PI / 180;
    for (i = 0; i < AX_PARTS.length; i++) P[AX_PARTS[i]] = { rx: 0, ry: 0, rz: 0 };
    if (prev) { for (i = 0; i < AX_PARTS.length; i++) { n = prev[AX_PARTS[i]]; P[AX_PARTS[i]] = { rx: n.rx, ry: n.ry, rz: n.rz }; } }
    else { P.body.rx = pitch * D; P.body.ry = yaw * D; }
    var by = 20, B = P.body, H = P.head, T = P.tail, TG = P.top_gills, LG = P.left_gills, RG = P.right_gills,
        LH = P.left_hind_leg, RH = P.right_hind_leg, LF = P.left_front_leg, RF = P.right_front_leg;
    var l2 = function (a, b) { return a + 0.05 * axWrap(b - a); }, l3 = function (d, a, b) { return a + d * axWrap(b - a); };
    var set = function (p, x, y, z) { p.rx = l2(p.rx, x); p.ry = l2(p.ry, y); p.rz = l2(p.rz, z); };
    var copy = function () { set(RH, LH.rx, -LH.ry, -LH.rz); set(RF, LF.rx, -LF.ry, -LF.rz); };
    var sin = M.sin, cos = M.cos, a, s, c, q, r;
    if (st.dead) {
      set(LH, 1.4137167, 1.0995574, M.PI / 4); set(LF, M.PI / 4, 2.042035, 0);
      B.rx = l2(B.rx, -0.15); B.rz = l2(B.rz, 0.35); copy(); B.ry = l2(B.ry, yaw * D);
      H.rx = l2(H.rx, 0); H.ry = l2(H.ry, 0); H.rz = l2(H.rz, 0); T.ry = l2(T.ry, 0);
      set(TG, 0, 0, 0); set(LG, 0, 0, 0); set(RG, 0, 0, 0);
    } else if (st.water) {
      if (st.moving) {
        a = age * 0.33; s = sin(a); c = cos(a); r = 0.13 * s;
        B.rx = l3(0.1, B.rx, pitch * D + r); H.rx = -r * 1.8; by -= 0.45 * c;
        TG.rx = l2(TG.rx, -0.5 * s - 0.8); LG.ry = l2(LG.ry, 0.3 * s + 0.9); RG.ry = l2(RG.ry, -LG.ry);
        T.ry = l2(T.ry, 0.3 * cos(a * 0.9));
        set(LH, 1.8849558, -0.4 * s, M.PI / 2); set(LF, 1.8849558, -0.2 * c - 0.1, M.PI / 2); copy();
        H.ry = l2(H.ry, 0); H.rz = l2(H.rz, 0);
      } else {
        a = age * 0.075; c = cos(a); s = sin(a) * 0.15;
        B.rx = l2(B.rx, -0.15 + 0.075 * c); by -= s; H.rx = l2(H.rx, -B.rx);
        TG.rx = l2(TG.rx, 0.2 * c); LG.ry = l2(LG.ry, -0.3 * c - 0.19); RG.ry = l2(RG.ry, -LG.ry);
        set(LH, M.PI * 3 / 4 - c * 0.11, 0.47123894, 1.7278761); set(LF, M.PI / 4 - c * 0.2, 2.042035, 0); copy();
        T.ry = l2(T.ry, 0.5 * c); H.ry = l2(H.ry, 0); H.rz = l2(H.rz, 0);
      }
    } else if (st.ground) {
      if (st.moving) {
        a = age * 0.11; c = cos(a); q = (c * c - 2 * c) / 5; r = 0.7 * c;
        H.rx = l2(H.rx, 0); H.ry = l2(H.ry, 0.09 * c); H.rz = l2(H.rz, 0); T.ry = l2(T.ry, H.ry);
        TG.rx = l2(TG.rx, 0.6 - 0.08 * (c * c + 2 * sin(a))); LG.ry = l2(LG.ry, -TG.rx); RG.ry = l2(RG.ry, -LG.ry);
        set(LH, 0.9424779, 1.5 - q, -0.1); set(LF, 1.0995574, M.PI / 2 - r, 0);
        set(RH, LH.rx, -1 - q, 0); set(RF, LF.rx, -M.PI / 2 - r, 0);
        B.rx = l3(0.2, B.rx, 0); B.ry = l2(B.ry, yaw * D); B.rz = l2(B.rz, 0);
      } else {
        a = age * 0.09; s = sin(a); c = cos(a); q = s * s - 2 * s; r = c * c - 3 * s;
        H.rx = l2(H.rx, -0.09 * q); H.ry = l2(H.ry, 0); H.rz = l2(H.rz, -0.2); T.ry = l2(T.ry, -0.1 + 0.1 * q);
        TG.rx = l2(TG.rx, 0.6 + 0.05 * r); LG.ry = l2(LG.ry, -TG.rx); RG.ry = l2(RG.ry, -LG.ry);
        set(LH, 1.1, 1, 0); set(LF, 0.8, 2.3, -0.5); copy();
        B.rx = l3(0.2, B.rx, 0); B.ry = l2(B.ry, yaw * D); B.rz = l2(B.rz, 0);
      }
    } else return { pose: P, bodyPivotY: by, cache: null };
    var cache = {};
    for (i = 0; i < AX_PARTS.length; i++) cache[AX_PARTS[i]] = { rx: P[AX_PARTS[i]].rx, ry: P[AX_PARTS[i]].ry, rz: P[AX_PARTS[i]].rz };
    return { pose: P, bodyPivotY: by, cache: cache };
  };
  /** Per-entity wrapper: reads/writes the angle cache on the entity (vanilla's getModelAngles map). */
  ER.axolotlAnim = function (e, age, yaw, pitch) {
    var moving = ((e.vx || 0) * (e.vx || 0) + (e.vy || 0) * (e.vy || 0) + (e.vz || 0) * (e.vz || 0)) > 1.0E-7;
    var r = ER.axolotlPose(e.axolotlAngles || null, { dead: !!e.playingDead, water: !!e.inWater, moving: moving, ground: !!e.onGround }, age, yaw, pitch);
    if (r.cache) e.axolotlAngles = r.cache;
    return r;
  };
  ER.axolotlDelta = function (partName, r) {
    var p = r.pose[partName];
    if (!p) return null;
    return { rx: p.rx, ry: p.ry, rz: p.rz, dpy: partName === 'body' ? r.bodyPivotY - 20 : 0 };
  };
  ER.striderDelta = function (partName, l, a, netHeadYaw, headPitch, age, s) {
    a = Math.min(0.25, a);
    switch (partName) {
      case 'body':
        return { rx: s.ridden ? 0 : headPitch * DEG2RAD, ry: s.ridden ? 0 : netHeadYaw * DEG2RAD,
                 rz: 0.1 * Math.sin(l * 1.5) * 4 * a, dpy: (2 - 2 * Math.cos(l * 1.5) * 2 * a) - 1 };
      case 'left_leg': case 'right_leg':
        var right = partName === 'right_leg', r = right ? Math.PI : 0, q = l * 1.5 * 0.5;
        return { rx: Math.sin(q + r) * 2 * a, ry: 0, rz: (Math.PI / 18) * Math.cos(q + r) * a,
                 dpy: 2 * Math.sin(q + (right ? 0 : Math.PI)) * 2 * a };
    }
    var b = ER.STRIDER_BRISTLE[partName];
    if (!b) return null;
    return { rx: 0, ry: 0, rz: Math.cos(l * 1.5 + Math.PI) * a * b[0] + b[1] * Math.sin(age * b[2]) };
  };
  ER.hoglinDelta = function (partName, l, a, netHeadYaw, h, baby) {
    var t = 1 - Math.abs(10 - 2 * (h.cd | 0)) / 10;
    switch (partName) {
      case 'right_ear': return { rx: 0, ry: 0, rz: -a * Math.sin(l) };
      case 'left_ear': return { rx: 0, ry: 0, rz: a * Math.sin(l) };
      case 'head':
        return { rx: (ER.HOGLIN_HEAD_PITCH_START + t * (ER.HOGLIN_HEAD_PITCH_END - ER.HOGLIN_HEAD_PITCH_START)) - ER.HOGLIN_HEAD_PITCH_START,
                 ry: netHeadYaw * DEG2RAD, rz: 0, dpy: baby ? (2 + t * 3) - 2 : 0 };
      case 'mane': return { rx: 0, ry: 0, rz: 0, dpz: (baby ? -3 : -7) - (-5) };
      case 'right_front_leg': case 'left_hind_leg': return { rx: Math.cos(l) * 1.2 * a, ry: 0, rz: 0 };
      case 'left_front_leg': case 'right_hind_leg': return { rx: Math.cos(l + Math.PI) * 1.2 * a, ry: 0, rz: 0 };
    }
    return null;
  };
  /**
   * D-787 residue (G18 leftover, QUEUE.md row 0.00 part 2) -- \`WitherEntityModel\`/
   * \`WitherEntityRenderer\` (.decomp, both read whole). Parts ported from
   * \`tools/golden/models-1.18.2.tsv\` rows 987-994 (\`grep -n '^wither\t' tools/golden/models-1.18.2.tsv\`):
   * \`shoulders\`/\`center_head\`/\`right_head\`/\`left_head\`/\`ribcage\` are all there, rest angles and
   * pivots exactly as \`WitherEntityModel.getTexturedModelData\` builds them.
   *
   * \`ribcage\`'s baked rest rx is 0.20420352 == RIBCAGE_PITCH_OFFSET (0.065) * PI, the model's
   * BUILD-TIME constant -- \`method_17130\` OVERWRITES \`this.ribcage.pitch\` every frame with
   * \`(0.065 + 0.05*cos(age*0.1)) * PI\`, an ASSIGNMENT, so the delta below is that absolute angle
   * minus the baked rest constant (the same "delta off rest" shape as every table in this file,
   * e.g. the sheep head-pitch override a few hundred lines up).
   *
   * \`center_head\` takes the SAME netHeadYaw/headPitch pair every other mob's plain head does --
   * \`method_17130\`'s own \`$$4,$$5\` args are exactly that pair, unmodified (WitherEntityRenderer
   * builds them the ordinary MobEntityRenderer way; nothing wither-specific overrides them).
   *
   * \`right_head\`/\`left_head\` (\`rotateHead\`, .decomp): \`ctx.wither.sideYawRel\`/\`sidePitch\` --
   * see the header where \`animOf\` builds \`wither:\` above for why those default to 0.
   *
   * \`tail\` (#1578): its row is now emitted by extract-models' witherTailRows(); formerly: no row -- \`extract-models.mjs\` never evaluated the
   * \`MathHelper.cos/sin(0.20420352F)*10.0F\` pivot expression inside \`ModelTransform.of\`, only
   * literal float args, so the box this engine would need to pose was never baked. That is a
   * data-extraction gap outside this file (this unit owns \`07j_entityrender.js\` only) -- the
   * tail stays undrawn, exactly as it was before this unit, not a regression this change makes.
   */
  ER.WITHER_RIBCAGE_REST_RX = 0.20420352;  // tools/golden/models-1.18.2.tsv, wither/ribcage row
  ER.WITHER_TAIL_REST = { rx: 0.8325221, py: 16.692228, pz: 1.5278728 };  // models-1.18.2.tsv wither/tail row
  ER.witherDelta = function (partName, ageInTicks, netHeadYaw, headPitch, w) {
    if (partName === 'center_head') {
      return { rx: headPitch * DEG2RAD, ry: netHeadYaw * DEG2RAD, rz: 0 };
    }
    if (partName === 'right_head' || partName === 'left_head') {
      var i = partName === 'right_head' ? 0 : 1;
      var yawRel = (w && w.sideYawRel) ? (w.sideYawRel[i] || 0) : 0;
      var pitch = (w && w.sidePitch) ? (w.sidePitch[i] || 0) : 0;
      return { rx: pitch * DEG2RAD, ry: yawRel * DEG2RAD, rz: 0 };
    }
    if (partName === 'ribcage') {
      var abs = (0.065 + 0.05 * Math.cos(ageInTicks * 0.1)) * Math.PI;
      return { rx: abs - ER.WITHER_RIBCAGE_REST_RX, ry: 0, rz: 0 };
    }
    if (partName === 'tail') {
      // method_17130: tail pivot = (-2, 6.9+cos(ribcage.pitch)*10, -0.5+sin(ribcage.pitch)*10), pitch = (0.265+0.1*cos(age*0.1))*PI
      var c = Math.cos(ageInTicks * 0.1), rp = (0.065 + 0.05 * c) * Math.PI;
      return { rx: (0.265 + 0.1 * c) * Math.PI - ER.WITHER_TAIL_REST.rx, ry: 0, rz: 0,
               dpy: 6.9 + Math.cos(rp) * 10 - ER.WITHER_TAIL_REST.py, dpz: -0.5 + Math.sin(rp) * 10 - ER.WITHER_TAIL_REST.pz };
    }
    return null;
  };

  /**
   * D-788 residue (G18 leftover, QUEUE.md row 0.00 part 2) -- ports
   * `EnderDragonEntityRenderer.DragonEntityModel.render`/`setLimbRotation` (.decomp
   * net/minecraft/client/render/entity/EnderDragonEntityRenderer.java, the whole class read),
   * every angle below is that method's own trigonometry verbatim (D-415's rx/ry/rz ==
   * pitch/yaw/roll mapping, unchanged). Every REST rx/ry/rz `pack-models.mjs` gave these parts
   * (`tools/golden/models-1.18.2.tsv`, `ender_dragon` rows) is 0, so an additive delta here is
   * the same wholesale ASSIGNMENT vanilla's own setter makes -- same shape as the sheep-head
   * override a few lines below this one.
   *
   * #1567 UPDATE: the rig now has wingPosition/prevWingPosition + the 64-entry segment ring buffer (ED.EnderDragonEntity),
   * and `ER.dragonAnim` ports render()'s neck x5 / head / tail x12 chain, body roll and root pitch. `dragonWingPhase` and the
   * k=0 neck term below are only the fallback when no live rig data is present. The renderer's `-seg7.yaw` model yaw is `ER.dragonYaw` (#1847). The paragraphs below describe the pre-#1567 state.
   *
   * ⚠ THE ONE NUMBER THIS PORTS *AROUND*, NOT FROM, IS `wingPosition` ITSELF --
   * `EnderDragonEntity.tickMovement()` advances it once a tick as part of the flight/phase-
   * manager substrate `07zzl_enderdragon.js`'s own `EnderDragon.OWED` still names as unbuilt (a
   * separate unit's work this one does not touch). `ER.dragonWingPhase` below is a RENDER-ONLY
   * clock standing in for that missing field until the phase manager ticks a real one -- every
   * angle downstream of it is the real formula, only the clock driving it is a placeholder.
   *
   * ⚠ THE NECK/TAIL ALSO WANT DATA THIS ENGINE DOES NOT TRACK YET: vanilla draws its neck by
   * re-rendering the SAME `neck` ModelPart 5 times (and the tail is 12 MORE copies of it) at
   * pivots derived from `EnderDragonEntity`'s own 64-tick position ring buffer
   * (`getSegmentProperties`). This engine's box-layer renderer poses each NAMED part once, not
   * N times, and the golden model table has no `tail*` box at all (vanilla's tail is not its
   * own mesh) -- so `neck` gets the k=0 term of that same per-segment cosine
   * (`cos(k*0.45+phase)*0.15`, k=0) as one representative sway, and no separate tail render is
   * attempted rather than faked with an invented box.
   */
  ER.DRAGON_WING_PERIOD = 20;   // render-only clock (ticks/cycle) -- placeholder, see header above
  ER.dragonWingPhase = function (ageInTicks) {
    var t = ((ageInTicks || 0) % ER.DRAGON_WING_PERIOD) / ER.DRAGON_WING_PERIOD;
    return t * Math.PI * 2;
  };
  /** `$$9` in the .decomp render() method (:378-379): sin(wingPos*2pi - 1)+1, squared+doubled, *0.05 -- feeds every leg pitch via `setLimbRotation`'s own `$$4` argument. */
  ER.dragonBodyPitch = function (tau) {
    var r = Math.sin(tau - 1) + 1;
    return (r * r + r * 2) * 0.05;
  };
  /** `setLimbRotation` (.decomp, the six pitches read top to bottom): [base, wingClock coefficient]. */
  ER.DRAGON_LEG_PITCH = {
    left_front_leg: [1.3, 0.1], right_front_leg: [1.3, 0.1],
    left_front_leg_tip: [-0.5, -0.1], right_front_leg_tip: [-0.5, -0.1],
    left_front_foot: [0.75, 0.1], right_front_foot: [0.75, 0.1],
    left_hind_leg: [1.0, 0.1], right_hind_leg: [1.0, 0.1],
    left_hind_leg_tip: [0.5, 0.1], right_hind_leg_tip: [0.5, 0.1],
    left_hind_foot: [0.75, 0.1], right_hind_foot: [0.75, 0.1]
  };
  /**
   * #1567 -- `DragonEntityModel.render()`'s whole segment chain (.decomp EnderDragonEntityRenderer :339-450) for one
   * frame, from a rig exposing `wingPosition/prevWingPosition`, `getSegmentProperties(i, t)` and
   * `getChangeInNeckPitch(i, a, b)` (ED.EnderDragonEntity). Returns the wing phase (rad), the root group
   * (translate(0,b-2,-3) * Rx(2b deg) under the renderer's Rx(-pitch)), the body-roll group, the 5 neck poses, the head
   * pose and the 12 tail poses (each {rx,ry,rz,px,py,pz}; neck/tail are the SAME `neck` ModelPart drawn again).
   */
  ER.dragonAnim = function (rig, t) {
    var D = Math.PI / 180, fw = function (d) { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
    var wing = rig.prevWingPosition + (rig.wingPosition - rig.prevWingPosition) * t;
    var tau = wing * Math.PI * 2;
    var b = Math.sin(tau - 1) + 1; b = (b * b + b * 2) * 0.05;
    var s5 = rig.getSegmentProperties(5, t), s6 = rig.getSegmentProperties(6, t), s10 = rig.getSegmentProperties(10, t);
    var d15 = fw(s5[0] - s10[0]), d16 = fw(s5[0] + d15 / 2);
    var pitchOut = (s5[1] - s10[1]) * 10 * D, c = Math.cos(-pitchOut), sn = Math.sin(-pitchOut);   // Rx(-p): outer pitch seen through the model flip
    var ty = (b - 2) * 16, tz = -32, Y0 = 1.501 * 16;   // #1848: the base pose's translate(0,-1.501,0) sits INSIDE the renderer's pitch, so it rotates with it: p = Rx(-P)(t - Y0) + Y0
    var out = { wing: wing, tau: tau, neck: [], tail: [], head: null,
      root: { rx: b * 2 * D - pitchOut, px: 0, py: (ty - Y0) * c - tz * sn + Y0, pz: (ty - Y0) * sn + tz * c },
      roll: { rz: -d15 * 1.5 * D } };
    out.roll.px = 16 * Math.sin(out.roll.rz); out.roll.py = 16 - 16 * Math.cos(out.roll.rz);
    var py = 20, pz = -12, px = 0, i, s, q;
    for (i = 0; i < 5; i++) {
      s = rig.getSegmentProperties(5 - i, t);
      q = { ry: fw(s[0] - s6[0]) * D * 1.5, px: px, py: py, pz: pz };
      q.rx = Math.cos(i * 0.45 + tau) * 0.15 + rig.getChangeInNeckPitch(i, s6, s) * D * 1.5 * 5;
      q.rz = -fw(s[0] - d16) * D * 1.5;
      py += Math.sin(q.rx) * 10; pz -= Math.cos(q.ry) * Math.cos(q.rx) * 10; px -= Math.sin(q.ry) * Math.cos(q.rx) * 10;
      out.neck.push(q);
    }
    s = rig.getSegmentProperties(0, t);
    out.head = { ry: fw(s[0] - s6[0]) * D, rx: fw(rig.getChangeInNeckPitch(6, s6, s)) * D * 1.5 * 5, rz: -fw(s[0] - d16) * D, px: px, py: py, pz: pz };
    py = 10; pz = 60; px = 0;
    var s11 = rig.getSegmentProperties(11, t), tp = 0;
    for (i = 0; i < 12; i++) {
      s = rig.getSegmentProperties(12 + i, t);
      tp += Math.sin(i * 0.45 + tau) * 0.05;
      q = { ry: (fw(s[0] - s11[0]) * 1.5 + 180) * D, px: px, py: py, pz: pz };
      q.rx = tp + (s[1] - s11[1]) * D * 1.5 * 5;
      q.rz = fw(s[0] - d16) * D * 1.5;
      py += Math.sin(q.rx) * 10; pz -= Math.cos(q.ry) * Math.cos(q.rx) * 10; px -= Math.sin(q.ry) * Math.cos(q.rx) * 10;
      out.tail.push(q);
    }
    return out;
  };
  /** The part list with every `neck` box repeated for the 5 neck + 12 tail draws (`dgi` 0..16 picks the pose). */
  ER.dragonExpandParts = function (parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.n !== 'neck') { out.push(Object.assign({ gk: i }, p)); continue; }
      for (var k = 0; k < 17; k++) { var c = Object.assign({}, p); c.dgi = k; c.gk = i; out.push(c); }
    }
    return out;
  };
  /** #1589 -- the entityAlpha cutoff of the exploding pass: ticksSinceDeath / 200 (whole ticks, EnderDragonEntityRenderer :58), clamped to 0..1. */
  ER.dragonDissolveAlpha = function (ticks) { return Math.max(0, Math.min(1, Math.fround(ticks / 200))); };
  /** #8076 -- EnderDragonEntityRenderer.render death animation (.decomp :56-97). `ticks` = ticksSinceDeath (>0), `partial` the frame fraction.
   *  flash = the model's explosion-texture overlay alpha (ticks/200, whole ticks); the rays are the RenderLayer.getLightning triangle fans drawn
   *  from Random(432) after translate(0,-1,-2), each ray 3 triangles (9 verts: white centre alpha a, two magenta alpha 0), positions in the
   *  dragon-model space (before the root translate/scale). Returns { flash, progress, fade, count, rays:[{len,width,alpha,verts:[[x,y,z]x9]}] }. */
  ER.dragonDeathRays = function (ticks, partial) {
    var F = Math.fround, D = Math.PI / 180, out = { flash: ticks / 200, progress: 0, fade: 0, count: 0, rays: [] };
    if (!(ticks > 0)) return out;
    var p = F(F(ticks + (partial || 0)) / 200), fade = Math.min(p > F(0.8) ? F(F(p - F(0.8)) / F(0.2)) : 0, 1);
    out.progress = p; out.fade = fade;
    var rnd = new NS.JRandom(432n), H = F(Math.sqrt(3) / 2);
    var M = [1, 0, 0, 0, 1, 0, 0, 0, 1], T = [0, -1, -2];
    function mul(R) {   // M = M * R (MatrixStack.multiply)
      var o = new Array(9);
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = M[r * 3] * R[c] + M[r * 3 + 1] * R[3 + c] + M[r * 3 + 2] * R[6 + c];
      M = o;
    }
    function rot(ax, deg) {
      var a = F(deg) * D, c = Math.cos(a), s = Math.sin(a);
      return ax === 0 ? [1, 0, 0, 0, c, -s, 0, s, c] : ax === 1 ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
    }
    function pt(x, y, z) { return [M[0] * x + M[1] * y + M[2] * z + T[0], M[3] * x + M[4] * y + M[5] * z + T[1], M[6] * x + M[7] * y + M[8] * z + T[2]]; }
    for (var i = 0; i < F(F(p + F(p * p)) / 2 * 60); i++) {
      mul(rot(0, F(rnd.nextFloat() * 360))); mul(rot(1, F(rnd.nextFloat() * 360))); mul(rot(2, F(rnd.nextFloat() * 360)));
      mul(rot(0, F(rnd.nextFloat() * 360))); mul(rot(1, F(rnd.nextFloat() * 360))); mul(rot(2, F(F(rnd.nextFloat() * 360) + F(p * 90))));
      var len = F(F(F(rnd.nextFloat() * 20) + 5) + F(fade * 10)), w = F(F(F(rnd.nextFloat() * 2) + 1) + F(fade * 2));
      var a = Math.floor(F(255 * F(1 - fade))), c0 = pt(0, 0, 0), l = pt(-H * w, len, -0.5 * w), r = pt(H * w, len, -0.5 * w), f = pt(0, len, w);
      out.rays.push({ len: len, width: w, alpha: a, verts: [c0, l, r, c0, r, f, c0, f, l] });
    }
    out.count = out.rays.length;
    return out;
  };
  /** #1847 -- `EnderDragonEntityRenderer.render` :46-47,:49 draws Ry(-getSegmentProperties(7,t)[0]) and NOTHING of the entity's own
   *  yaw (it is not a LivingEntityRenderer). The engine's mob path takes a heading psi with vanilla's `180 - yawMC` == `-psi`, so the
   *  dragon's psi is seg7.yaw (degrees -> rad). Replaces bodyYawAt for the dragon; every other mob keeps bodyYawAt. */
  ER.dragonYaw = function (e, partial) {
    if (e.type === 'ender_dragon' && e.dragon && e.dragon.latestSegment >= 0)
      return e.dragon.getSegmentProperties(7, partial === undefined ? 1 : partial)[0] * DEG2RAD;
    return ER.bodyYawAt(e, partial);
  };
  ER.dragonDelta = function (partName, ctx, netHeadYaw, headPitch) {
    var tau = ER.dragonWingPhase(ctx && ctx.ageInTicks);
    var dg = ctx && ctx.dragon;
    if (dg) {
      // #1567 -- the real chain (ER.dragonAnim): wing clock from lerp(prevWingPosition, wingPosition), neck/tail segment poses.
      var tauR = dg.tau, rest = ctx.rest || {}, ps;
      var rel = function (q) { return { rx: q.rx - (rest.rx || 0), ry: q.ry - (rest.ry || 0), rz: q.rz - (rest.rz || 0),
                                       dpx: q.px - (rest.px || 0), dpy: q.py - (rest.py || 0), dpz: q.pz - (rest.pz || 0) }; };
      if (partName === 'dragon_root') return rel({ rx: dg.root.rx, ry: 0, rz: 0, px: dg.root.px, py: dg.root.py, pz: dg.root.pz });
      if (partName === 'dragon_body') return rel({ rx: 0, ry: 0, rz: dg.roll.rz, px: dg.roll.px, py: dg.roll.py, pz: 0 });
      if (partName === 'head') return rel(dg.head);
      if (partName === 'neck') {
        ps = rest.dgi < 5 ? dg.neck[rest.dgi] : dg.tail[rest.dgi - 5];
        return ps ? rel(ps) : null;
      }
      tau = tauR;
    }
    if (partName === 'head') {
      return { rx: (headPitch || 0) * DEG2RAD, ry: (netHeadYaw || 0) * DEG2RAD, rz: 0 };
    }
    if (partName === 'jaw') {
      // jaw.pitch = (sin(wingPos*2pi)+1)*0.2
      return { rx: (Math.sin(tau) + 1) * 0.2, ry: 0, rz: 0 };
    }
    if (partName === 'neck') {
      return { rx: Math.cos(tau) * 0.15, ry: 0, rz: 0 };
    }
    if (partName === 'left_wing') {
      return { rx: 0.125 - Math.cos(tau) * 0.2, ry: -0.25, rz: -(Math.sin(tau) + 0.125) * 0.8 };
    }
    if (partName === 'right_wing') {
      // mirrored: yaw/roll flip sign, pitch shared (decomp's own rightWing = leftWing.pitch/-yaw/-roll)
      return { rx: 0.125 - Math.cos(tau) * 0.2, ry: 0.25, rz: (Math.sin(tau) + 0.125) * 0.8 };
    }
    if (partName === 'left_wing_tip') {
      return { rx: 0, ry: 0, rz: (Math.sin(tau + 2) + 0.5) * 0.75 };
    }
    if (partName === 'right_wing_tip') {
      return { rx: 0, ry: 0, rz: -(Math.sin(tau + 2) + 0.5) * 0.75 };
    }
    var lp = ER.DRAGON_LEG_PITCH[partName];
    if (lp) {
      var bp = ER.dragonBodyPitch(tau);
      return { rx: lp[0] + bp * lp[1], ry: 0, rz: 0 };
    }
    return null;   // body (roll is assigned 0 in decomp too -- rest already is), anything unnamed
  };
  /**
   * #843 -- `RavagerEntityModel.method_17089` (animateModel) + `method_17091` (setAngles) legs.
   * neck rest = pivot (0,-7,5.5) pitch 0; mouth rest pitch 0. `neck.pitch` is only ever assigned in
   * the non-attack branch (stun 0.21991149, else 0), so during a bite it keeps that value -- taken
   * here from the stun tick. Legs: 0.4*limbDistance, cos(pos*0.6662).
   */
  ER.ravagerDelta = function (partName, l, a, r) {
    var PI = Math.PI, at = r.at, st = r.st, rt = r.rt, pt = r.pt, nPitch = st > 0 ? 0.21991149 : 0;
    if (partName === 'right_hind_leg' || partName === 'left_front_leg') return { rx: Math.cos(l * 0.6662) * 0.4 * a, ry: 0, rz: 0 };
    if (partName === 'left_hind_leg' || partName === 'right_front_leg') return { rx: Math.cos(l * 0.6662 + PI) * 0.4 * a, ry: 0, rz: 0 };
    if (partName === 'neck') {
      if (at > 0) {
        var w = ER.ravagerWrap(at - pt, 10), c = (1 + w) * 0.5, z = c * c * c * 12;
        return { rx: nPitch, ry: 0, rz: 0, dpx: 0, dpy: -z * Math.sin(nPitch), dpz: -6.5 + z - 5.5 };
      }
      return { rx: nPitch, ry: 0, rz: 0, dpx: st > 0 ? Math.sin(st / 40 * 10) * 3 : 0, dpy: Math.sin(nPitch), dpz: 0 };
    }
    if (partName === 'mouth') {
      var jp;
      if (at > 0) jp = at > 5 ? Math.sin((at - 4 - pt) / 4) * PI * 0.4 : (PI / 20) * Math.sin(PI * (at - pt) / 10);
      else if (st > 0) jp = PI * 0.05;
      else if (rt > 0) jp = (PI / 2) * Math.sin((20 - rt - pt) / 20 * PI * 0.25);
      else jp = PI * 0.01;
      return { rx: jp, ry: 0, rz: 0 };
    }
    return null;
  };
  /** `MathHelper.wrap(value, period)` (.decomp): a triangle wave, (|v % p - p/2| - p/4) / (p/4). */
  ER.ravagerWrap = function (v, p) { return (Math.abs(v % p - p * 0.5) - p * 0.25) / (p * 0.25); };
  /** #760 -- `VexEntityRenderer.getTexture`: vex_charging.png while `isCharging()`, else null (plain vex). */
  /** #1576 -- WitherEntity.shouldRenderOverlay(): health <= maxHealth / 2 (the armour layer's gate). */
  ER.witherArmorOn = function (e) {
    return !!e && e.type === 'wither' && e.health !== undefined && e.health <= (e.maxHealth || 300) / 2;
  };

  /** #1577 -- `WitherEntityRenderer.method_4153`: wither_invulnerable.png while `timer > 0 && (timer > 80 ||
   *  timer / 5 % 2 != 1)` (flashing through the last 80 of the 220 spawn ticks), else null (plain wither). */
  ER.witherSkinKey = function (e) {
    if (e && e.type === 'wither_skull') return e.charged ? 'wither_invulnerable' : null;   // #3806 isCharged -> wither_invulnerable.png
    if (!e || e.type !== 'wither') return null;
    var t = e.invulTimer | 0;
    return t > 0 && (t > 80 || ((t / 5 | 0) % 2) !== 1) ? 'wither_invulnerable' : null;
  };
  ER.vexSkinKey = function (e) { return e && e.type === 'vex' && e.charging ? 'vex_charging' : null; };
  /** #760 -- `VexEntityModel.setAngles` (.decomp) after the biped super call. Arm pitch is an ASSIGNMENT while
   *  charging (3pi/2 empty-handed, else 3.7699115 on the main arm; a vex spawns with an iron sword, so the
   *  latter), rightLeg.pitch += pi/5, wings: pivotY 1, pivotZ 2, yaw 0.47123894 + cos(age*45.836624deg)*pi*0.05
   *  (left negated), pitch 0.47123894, roll +-0.47123894. `d` is the biped delta, `rest` the part's rest pose. */
  ER.vexDelta = function (partName, d, vex, age, rest) {
    d = d || { rx: 0, ry: 0, rz: 0 };
    rest = rest || { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
    var out = { rx: d.rx, ry: d.ry, rz: d.rz, dpx: d.dpx || 0, dpy: d.dpy || 0, dpz: d.dpz || 0 };
    if (partName === 'right_leg') { out.rx += Math.PI / 5; return out; }
    if (partName === 'right_arm' || partName === 'left_arm') {
      if (vex.charging && vex.mainEmpty) out.rx = 3 * Math.PI / 2 - rest.rx;   // empty main hand: BOTH arms 3pi/2
      else if (vex.charging && (partName === 'right_arm') !== !!vex.leftHanded) out.rx = 3.7699115 - rest.rx;
      return out;
    }
    if (partName === 'right_wing' || partName === 'left_wing') {
      var yaw = 0.47123894 + Math.cos(age * 45.836624 * Math.PI / 180) * Math.PI * 0.05, r = partName === 'right_wing';
      out.dpy = 1 - rest.py; out.dpz = 2 - rest.pz;
      out.rx = 0.47123894 - rest.rx; out.ry = (r ? yaw : -yaw) - rest.ry; out.rz = (r ? 0.47123894 : -0.47123894) - rest.rz;
      return out;
    }
    return d;
  };
  /** #1540 -- `PhantomEntityModel.setAngles` (method_33686, .decomp): t = (id*3 + age) * 7.448451deg; wing
   *  base/tip roll = +-cos(t)*16deg (right negated), tail base/tip pitch = -(5 + cos(2t)*5)deg. All ASSIGNED,
   *  so each delta is target - rest (`ctx.rest`). `ctx.phantomId` = entity id. */
  ER.phantomDelta = function (partName, ctx) {
    var D = Math.PI / 180, rest = (ctx && ctx.rest) || {}, t = (((ctx && ctx.phantomId) | 0) * 3 + ((ctx && ctx.ageInTicks) || 0)) * 7.448451 * D;
    var m = /^(left|right)_wing_(base|tip)$/.exec(partName);
    if (m) return { rx: 0, ry: 0, rz: (m[1] === 'left' ? 1 : -1) * Math.cos(t) * 16 * D - (rest.rz || 0) };
    if (partName === 'tail_base' || partName === 'tail_tip') return { rx: -(5 + Math.cos(t * 2) * 5) * D - (rest.rx || 0), ry: 0, rz: 0 };
    return null;
  };
  /** #4741 -- `BeeEntityModel.setAngles` (method_22112). Everything is ASSIGNED, so delta = target - `ctx.rest`.
   *  `ctx.bee` = { still (onGround && v^2<1e-7), angry, bodyPitch }. */
  ER.beeDelta = function (partName, ctx) {
    var b = ctx && ctx.bee, rest = (ctx && ctx.rest) || {}, PI = Math.PI;
    if (!b) return null;
    var age = ctx.ageInTicks || 0, c = Math.cos(age * 0.18), wing = partName === 'left_wing' || partName === 'right_wing';
    var rx = 0, ry = rest.ry || 0, rz = rest.rz || 0, py = 0;
    if (wing) {
      ry = b.still ? (partName === 'right_wing' ? -0.2618 : 0.2618) : 0;
      rz = b.still ? 0 : Math.cos(age * 120.32113 * PI / 180) * PI * 0.15 * (partName === 'right_wing' ? 1 : -1);
    } else if (/_legs$/.test(partName)) {
      if (!b.still) rx = partName === 'front_legs' && !b.angry ? -c * PI * 0.1 + PI / 8 : partName === 'back_legs' && !b.angry ? -c * PI * 0.05 + PI / 4 : PI / 4;
    } else if (partName === 'left_antenna' || partName === 'right_antenna') {
      if (!b.angry && !b.still) rx = c * PI * 0.03;
    } else if (partName === 'bone') {
      if (!b.angry && !b.still) { rx = 0.1 + c * PI * 0.025; py = -c * 0.9; }
      if (b.bodyPitch > 0) {   // ModelUtil.interpolateAngle(pitch, 3.0915928, bodyPitch)
        var d = 3.0915928 - rx;
        while (d < -PI) d += 2 * PI;
        while (d >= PI) d -= 2 * PI;
        rx += d * Math.min(1, Math.max(0, b.bodyPitch));
      }
    } else return null;
    return { rx: rx - (rest.rx || 0), ry: ry - (rest.ry || 0), rz: rz - (rest.rz || 0), dpy: py };
  };
  // #730/#733 -- the iron golem pose is ER.golemDelta below (ER.mathWrap); the #730 duplicate that
  // read `g.atk` was dead (shadowed) and is gone (#1397).
  /** `getMainHandStack().isEmpty()`. */
  ER.mainHandEmpty = function (e) {
    var IT = NS.Items, Eq = NS.Equip;
    if (!IT || !IT.ready || !Eq || !Eq.getEquipped) return true;
    var st = Eq.getEquipped(e, IT.MAINHAND);
    return !(st && st.i >= 0 && (st.n === undefined || st.n > 0));
  };
  /** `MobEntity.isHoldingTool`: the main hand is a ToolItem (sword/axe/pickaxe/shovel/hoe). */
  ER.holdsTool = function (e) {
    var IT = NS.Items, Eq = NS.Equip;
    if (!IT || !IT.ready || !Eq || !Eq.getEquipped) return false;
    var st = Eq.getEquipped(e, IT.MAINHAND);
    return !!(st && st.i >= 0 && /_(sword|axe|pickaxe|shovel|hoe)$/.test(IT.nameOf(st.i) || ''));
  };
  /** `PiglinEntityModel.setAngles` PiglinActivity.DANCING branch (ears/head/arms/body), as deltas on `ctx.rest`. */
  ER.piglinDanceDelta = function (partName, ctx, d) {
    var t = (ctx.ageInTicks || 0) / 60, r = ctx.rest || {}, S = Math.sin, C = Math.cos, D = Math.PI / 180;
    var o = d ? { rx: d.rx, ry: d.ry, rz: d.rz } : { rx: 0, ry: 0, rz: 0 };
    var piv = function (x, y) { o.dpx = x - (r.px || 0); o.dpy = y - (r.py || 0); o.dpz = 0; return o; };
    if (partName === 'right_ear') return { rx: 0, ry: 0, rz: Math.PI / 6 + D * S(t * 30) * 10 - (r.rz || 0) };
    if (partName === 'left_ear') return { rx: 0, ry: 0, rz: -Math.PI / 6 - D * C(t * 30) * 10 - (r.rz || 0) };
    if (partName === 'head') return piv(S(t * 10), S(t * 40) + 0.4);
    if (partName === 'body') return piv(r.px || 0, S(t * 40) * 0.35);
    if (partName === 'right_arm' || partName === 'left_arm') {
      var rz = D * (70 + C(t * 40) * 10);
      o.rz = (partName === 'right_arm' ? rz : -rz) - (r.rz || 0);
      return piv(r.px || 0, S(t * 40) * 0.5 + 1.5);
    }
    return null;
  };
  /** `PiglinEntityModel.setAngles` ADMIRING_ITEM / CROSSBOW_HOLD / CROSSBOW_CHARGE arms+head (`CrossbowPosing.hold/charge`), as
   *  deltas on `ctx.rest`. `hy`/`hp` = head yaw/pitch radians (hold reads the head), `ctx.charge` = pull fraction 0..1. */
  ER.piglinPoseDelta = function (partName, pose, ctx, hy, hp, d) {
    var r = ctx.rest || {}, P = Math.PI, right = !ctx.leftHanded, isMainPart = (partName === 'right_arm') === right;
    var o = function (rx, ry) { return { rx: rx - (r.rx || 0), ry: ry - (r.ry || 0), rz: d ? d.rz : 0 }; };
    if (pose === 'admire') {
      if (partName === 'head') return { rx: 0.5 - (r.rx || 0), ry: 0 - (r.ry || 0), rz: d ? d.rz : 0 };
      if (partName === (ctx.leftHanded ? 'right_arm' : 'left_arm')) return o(-0.9, ctx.leftHanded ? -0.5 : 0.5);
      return null;
    }
    if (partName !== 'right_arm' && partName !== 'left_arm') return null;
    if (pose === 'hold') return isMainPart ? o(-P / 2 + hp + 0.1, (right ? -0.3 : 0.3) + hy) : o(-1.5 + hp, (right ? 0.6 : -0.6) + hy);
    if (pose === 'charge') {
      var f = Math.max(0, Math.min(1, ctx.charge || 0)), p0 = -0.97079635;
      return isMainPart ? o(p0, right ? -0.8 : 0.8) : o(p0 + (-P / 2 - p0) * f, (0.4 + (0.85 - 0.4) * f) * (right ? 1 : -1));
    }
    return null;
  };
  /** `PiglinEntityModel.setAngles` ears, as a delta from REST (`ctx.rest`). */
  ER.piglinDelta = function (partName, limbSwing, limbSwingAmount, ctx) {
    var t = (ctx.ageInTicks || 0) * 0.1 + (limbSwing || 0) * 0.5, a = 0.08 + (limbSwingAmount || 0) * 0.4;
    var rz = (ctx.rest && ctx.rest.rz) || 0;
    if (partName === 'left_ear') return { rx: 0, ry: 0, rz: (-Math.PI / 6 - Math.cos(t * 1.2) * a) - rz };
    if (partName === 'right_ear') return { rx: 0, ry: 0, rz: (Math.PI / 6 + Math.cos(t) * a) - rz };
    return null;
  };
  /** #1000 `WitchEntityModel.setAngles`: nose pivot reset (0,-2,0); f = 0.01*(id%10), pitch sin(age*f)*4.5deg,
   *  roll cos(age*f)*2.5deg; holding an item (drinking): pivot (0,1,-1.5), pitch -0.9. As a delta from `rest`. */
  ER.witchNoseDelta = function (w, age, rest) {
    rest = rest || { px: 0, py: -2, pz: 0, rx: 0, ry: 0, rz: 0 };
    var f = 0.01 * ((w.id | 0) % 10), rx = Math.sin(age * f) * 4.5 * DEG2RAD, rz = Math.cos(age * f) * 2.5 * DEG2RAD, py = -2, pz = 0;
    if (w.drinking) { py = 1; pz = -1.5; rx = -0.9; }
    return { rx: rx - (rest.rx || 0), ry: 0, rz: rz - (rest.rz || 0), dpx: 0 - (rest.px || 0), dpy: py - (rest.py || 0), dpz: pz - (rest.pz || 0) };
  };
  /**
   * `OcelotEntityModel.animateModel` + `setAngles` (.decomp OcelotEntityModel.java:100-160), the
   * standing / crouching / sprinting states as DELTAS on the rest pose (tools/golden rest =
   * animateModel's defaults: body 12/-10, tail1 15/8 pitch 0.9, tail2 20/14). State 0 crouch:
   * body y+1, tail1 y+1, tail2 y-4 z+2, both tail pitches PI/2, walk legs, tail2 swing 0.4712.
   * State 2 sprint: tail2 y = tail1 y (15), z+2, both tail pitches PI/2, the offset hind/front
   * leg phases, tail2 swing PI/10. State 1 stand: walk legs, tail2 swing PI/4. (The head's +2
   * crouch drop is the separate head layer's; the sitting states 3 are CatEntityModel's.)
   */
  /** CatEntity.getSleepAnimation / getTailCurlAnimation / getHeadDownAnimation: lerp(partial, prev, cur). */
  ER.catAnim = function (e, k, partial) {
    var c = e[k] || 0, p = e[k + 'O'] === undefined ? c : e[k + 'O'];
    return p + (c - p) * partial;
  };
  /** CatEntity.updateSleepAnimation + updateHeadDownAnimation, once per tick (sleep +0.15/-0.22, tail +0.08/-0.13, head +0.1/-0.13). */
  ER.tickCatAnim = function (e) {
    e.sleepAnimO = e.sleepAnim || 0; e.tailCurlAnimO = e.tailCurlAnim || 0; e.headDownAnimO = e.headDownAnim || 0;
    var sl = !!e.sleeping;
    e.sleepAnim = sl ? Math.min(1, (e.sleepAnim || 0) + 0.15) : Math.max(0, (e.sleepAnim || 0) - 0.22);
    e.tailCurlAnim = sl ? Math.min(1, (e.tailCurlAnim || 0) + 0.08) : Math.max(0, (e.tailCurlAnim || 0) - 0.13);
    e.headDownAnim = e.headDown ? Math.min(1, (e.headDownAnim || 0) + 0.1) : Math.max(0, (e.headDownAnim || 0) - 0.13);
  };
  ER.felineDelta = function (n, l, a, f) {
    var w = l * 0.6662, C = Math.cos, H = Math.PI / 2;
    var st = f.crouch ? 0 : f.sprint ? 2 : 1;
    var sit = !!f.sitting, sl = f.sleep || 0;
    var leg = null;
    if (sit) leg = null;   // animationState 3: setAngles leaves the leg/tail pitches animateModel assigned
    else if (st === 2) {
      if (n === 'left_hind_leg') leg = C(w) * a;
      else if (n === 'right_hind_leg') leg = C(w + 0.3) * a;
      else if (n === 'left_front_leg') leg = C(w + Math.PI + 0.3) * a;
      else if (n === 'right_front_leg') leg = C(w + Math.PI) * a;
    } else if (n === 'left_hind_leg' || n === 'right_front_leg') leg = C(w) * a;
    else if (n === 'right_hind_leg' || n === 'left_front_leg') leg = C(w + Math.PI) * a;
    var sw = st === 2 ? Math.PI / 10 : st === 1 ? Math.PI / 4 : 0.47123894;
    // CatEntityModel.animateModel's sitting block (pivots as deltas on rest), then setAngles' sleep block (.decomp).
    if (n.indexOf('_leg') > 0) {
      var front = n.indexOf('front') > 0, right = n.charAt(0) === 'r';
      var o = { rx: leg === null ? 0 : leg, ry: 0, rz: 0, dpx: 0, dpy: 0, dpz: 0 };
      if (sit) {
        o.rx = front ? -Math.PI / 20 : -H;
        o.dpy = front ? 16.1 - 14.1 : 21 - 18; o.dpz = front ? -7 + 5 : 1 - 5;
      }
      if (sl > 0) {
        if (n === 'left_front_leg') o.rx = -1.2707963;
        else if (n === 'right_front_leg') { o.rx = -0.47079635; o.rz = -0.2; o.dpx = -0.2 + 1.2; }
        else if (n === 'left_hind_leg') o.rx = -0.4;
        else { o.rx = 0.5; o.rz = -0.5; o.dpx = -0.3 + 1.1; o.dpy = 20 - 18; o.dpz = sit ? 1 - 5 : 0; }
      }
      return o;
    }
    if (n === 'body') return sit ? { rx: -Math.PI / 4, ry: 0, rz: 0, dpy: -4 + (st === 0 ? 1 : 0), dpz: 5 }
                                 : { rx: 0, ry: 0, rz: 0, dpy: st === 0 ? 1 : 0 };
    if (n === 'tail1' || n === 'tail2') {
      var one = n === 'tail1', base, rest = one ? 0.9 : 0;
      if (sit) base = one ? 1.7278761 : 2.670354;
      else if (one) base = st === 1 ? 0.9 : H;
      else base = 1.7278761 + sw * C(l) * a;
      if (sl > 0) { var tc = f.tail || 0, to = one ? 0.8 : -0.4; base = base + (to - base) * tc; }
      // the sitting block adds (+=) onto whatever the crouch / sprint block of Ocelot.animateModel left
      if (sit) return { rx: base - rest, ry: 0, rz: 0, dpy: (one ? 8 : 2) + (one ? (st === 0 ? 1 : 0) : st === 0 ? -4 : st === 2 ? -5 : 0), dpz: (one ? -2 : -0.8) + (one || st === 1 ? 0 : 2) };
      if (one) return { rx: base - rest, ry: 0, rz: 0, dpy: st === 0 ? 1 : 0 };
      return { rx: base, ry: 0, rz: 0, dpy: st === 0 ? -4 : st === 2 ? -5 : 0, dpz: st === 1 ? 0 : 2 };
    }
    return null;
  };
  /** CatEntityModel head: sitting pivot (0,-3.3,+1); sleep roll/yaw lerp; headDown pitch lerp. `d` = the core head delta. */
  ER.felineHead = function (d, f, rest) {
    var rr = rest || {}, o = { rx: d ? d.rx : 0, ry: d ? d.ry : 0, rz: d ? d.rz : 0, dpx: d && d.dpx || 0, dpy: d && d.dpy || 0, dpz: d && d.dpz || 0 };
    if (f.sitting) { o.dpy += -3.3; o.dpz += 1; }
    var sl = f.sleep || 0;
    if (sl > 0) { o.rz = -1.2707963 * sl - (rr.rz || 0); o.ry = o.ry + (1.2707963 - (o.ry + (rr.ry || 0))) * sl; }
    if (f.headDown > 0) { var p = o.rx + (rr.rx || 0); o.rx = p + (-0.58177644 - p) * f.headDown - (rr.rx || 0); }
    return o;
  };
  ER.setupAnimDelta = function (partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, ctx) {
    partName = ER.OVERLAY_OF[partName] || partName;   // #211: sleeves/pants/jacket copy their base part's pose
    if (ctx && ctx.vex) {
      var vx = ctx.vex; ctx = Object.assign({}, ctx, { vex: null });
      return ER.vexDelta(partName, ER.setupAnimDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, ctx),
                         vx, ctx.ageInTicks || 0, ctx.rest);
    }
    // #1749 -- EndermanEntityModel.setAngles: carryingBlock arms (pitch -0.5, roll +-0.05), angry head/hat pivotY -= 5.
    if (ctx && ctx.enderman) {
      var en = ctx.enderman, rest = ctx.rest || {};
      var ed = ER.setupAnimDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, Object.assign({}, ctx, { enderman: null })) || { rx: 0, ry: 0, rz: 0 };
      ed = Object.assign({}, ed);
      // #1767 -- setAngles: arm/leg pitch *= 0.5 then clamp +-0.4 (carrying arms below overwrite the arm pitch)
      if (/^(left|right)_(arm|leg)$/.test(partName)) ed.rx = Math.max(-0.4, Math.min(0.4, (ed.rx || 0) * 0.5));
      if (en.carrying && (partName === 'right_arm' || partName === 'left_arm')) {
        ed.rx = -0.5 - (rest.rx || 0);
        ed.rz = (partName === 'right_arm' ? 0.05 : -0.05) - (rest.rz || 0);
      }
      if (en.angry && (partName === 'head' || partName === 'hat')) ed.dpy = (ed.dpy || 0) - 5;
      return ed;
    }
    // #1256 -- TurtleEntityModel.method_17125 (legs) + render()'s translate(0,-0.08,0) while the plastron shows.
    if (ctx && ctx.turtle) {
      var tt = ctx.turtle;
      return ER.turtleDelta(partName, limbSwing, limbSwingAmount, tt,
        ER.setupAnimDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, Object.assign({}, ctx, { turtle: null })));
    }
    // #1004 -- MagmaCubeEntityModel.method_17098: slices[i].pivotY = -(4 - i) * max(0, stretch) * 1.7 (rest pivotY is 0).
    if (ctx && ctx.slime && /^cube[0-7]$/.test(partName))
      return { rx: 0, ry: 0, rz: 0, dpy: -(4 - (partName.charCodeAt(4) - 48)) * ctx.slime.stretch * 1.7 };
    if (ctx && ctx.shulker) return NS.ShulkerDraw.delta(partName, ctx.shulker, headPitch);
    if (ctx && ctx.wither) return ER.witherDelta(partName, ctx.ageInTicks || 0, netHeadYaw, headPitch, ctx.wither);
    if (ctx && ctx.witch && partName === 'nose') return ER.witchNoseDelta(ctx.witch, ctx.ageInTicks || 0, ctx.rest);
    if (ctx && ctx.axolotl) return ER.axolotlDelta(partName, ctx.axolotl);
    if (ctx && ctx.strider) return ER.striderDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, ctx.ageInTicks || 0, ctx.strider);
    if (ctx && ctx.hoglin) return ER.hoglinDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, ctx.hoglin, !!ctx.baby);
    if (ctx && ctx.ravager) {
      var rd = ER.ravagerDelta(partName, limbSwing, limbSwingAmount, ctx.ravager);
      if (rd) return rd;
    }
    if (ctx && ctx.golem && (partName === 'left_arm' || partName === 'right_arm' || partName === 'left_leg' || partName === 'right_leg'))
      return ER.golemDelta(partName, limbSwing, limbSwingAmount, ctx.golem);
    if (ctx && ctx.feline) {
      var fd = ER.felineDelta(partName, limbSwing, limbSwingAmount, ctx.feline);
      if (fd) return fd;
      if (partName === 'head' && (ctx.feline.sitting || ctx.feline.sleep > 0 || ctx.feline.headDown > 0))
        return ER.felineHead(ER.setupAnimDeltaCore(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, ctx), ctx.feline, ctx.rest);
    }
    var d = ER.setupAnimDeltaCore(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, ctx);
    if (ctx && ctx.player && ctx.rest) d = ER.playerDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, ctx.player, ctx.rest, ctx.ageInTicks || 0) || d;
    if (ctx && ctx.drownedLp > 0 && ctx.rest) d = ER.drownedLeanDelta(partName, d, limbSwing, headPitch, ctx);
    if (ctx && ctx.headShake && partName === 'head') d = Object.assign({}, d, { rx: 0.4, rz: 0.3 * Math.sin(0.45 * (ctx.ageInTicks || 0)) });
    if (ctx && ctx.polarBear) return ER.polarBearDelta(partName, d, ctx.polarBear.p, !!ctx.baby, ctx.rest || {});
    if (ctx && ctx.rabbit) return ER.rabbitDelta(partName, ctx.rabbit.jump, netHeadYaw, headPitch, ctx.rest || {}, d);
    if (ctx && ctx.panda) return ER.pandaDelta(partName, d, netHeadYaw, headPitch, ctx);
    if (ctx && ctx.piglin) {
      var dn = ctx.piglinDance && ER.piglinDanceDelta(partName, ctx, d);
      if (dn) return dn;
      var pd = ER.piglinDelta(partName, limbSwing, limbSwingAmount, ctx);
      if (pd) return pd;
      var pp = ctx.piglinPose && ER.piglinPoseDelta(partName, ctx.piglinPose, ctx, (netHeadYaw || 0) * DEG2RAD, (headPitch || 0) * DEG2RAD, d);
      if (pp) return pp;
      // rotateMainArm (only while not swinging): the main arm's pitch is ASSIGNED -1.8
      if (ctx.piglinMelee && !(ctx.attackTime > 0) && partName === (ctx.leftHanded ? 'left_arm' : 'right_arm'))
        return { rx: -1.8 - ((ctx.rest && ctx.rest.rx) || 0), ry: d ? d.ry : 0, rz: d ? d.rz : 0 };
    }
    if (ctx && ctx.skelBow && (partName === 'left_arm' || partName === 'right_arm')) return ER.skeletonBowArmDelta(partName, ctx, netHeadYaw, headPitch);
    if (ctx && ctx.skelMelee && (partName === 'left_arm' || partName === 'right_arm')) return ER.skeletonMeleeArmDelta(partName, ctx, d);
    if (!ctx || !ctx.biped || !(ctx.attackTime > 0)) return d;
    var sw = ER.animateArmsDelta(partName, ctx.attackTime, !!ctx.leftHanded, (headPitch || 0) * DEG2RAD, ctx.rest, !ctx.zarm);
    if (!sw) return d;
    if (!d) return sw;
    return { rx: d.rx + sw.rx, ry: d.ry + sw.ry, rz: d.rz + sw.rz, dpx: (d.dpx || 0) + (sw.dpx || 0),
             dpy: d.dpy || 0, dpz: (d.dpz || 0) + (sw.dpz || 0) };
  };
  /**
   * #1256 -- `TurtleEntityModel.setAngles` leg block (.decomp): water = hind pitch / front roll swing at
   * cos(l*0.6662*0.6)*0.5*a; on land (`!touchingWater && onGround`) front yaw cos(k*l*5 (+PI))*8*a*m (k=4,m=2 while
   * digging, else 1,1), hind yaw cos(l*5 (+PI))*3*a with roll/pitch zeroed. Leg rest angles are all 0 so the
   * assignment is the delta. `render()` translates y by -0.08 block (-1.28 model units) while `plastron.visible`.
   * `base` is the generic quadruped result (head pose), kept for every non-leg part.
   */
  ER.turtleDelta = function (partName, l, a, t, base) {
    var dy = t.belly ? -0.08 * 16 : 0, P = Math.PI, o = null, c = Math.cos;
    var fl = partName === 'left_front_leg', fr = partName === 'right_front_leg',
        hl = partName === 'left_hind_leg', hr = partName === 'right_hind_leg';
    if (fl || fr || hl || hr) {
      var w = l * 0.6662 * 0.6, ry = 0, rx = 0, rz = 0;
      if (hl) rx = c(w + P) * 0.5 * a; else if (hr) rx = c(w) * 0.5 * a;
      else if (fl) rz = c(w) * 0.5 * a; else rz = c(w + P) * 0.5 * a;
      if (!t.inWater && t.onGround) {
        var k = t.digging ? 4 : 1, m = t.digging ? 2 : 1;
        rx = 0; rz = 0;
        if (fl) ry = c(k * l * 5) * 8 * a * m; else if (fr) ry = c(k * l * 5 + P) * 8 * a * m;
        else if (hl) ry = c(l * 5) * 3 * a; else ry = c(l * 5 + P) * 3 * a;
      }
      o = { rx: rx, ry: ry, rz: rz };
    } else if (base) o = { rx: base.rx, ry: base.ry, rz: base.rz, dpx: base.dpx, dpy: base.dpy, dpz: base.dpz };
    if (dy) { if (!o) o = { rx: 0, ry: 0, rz: 0 }; o.dpy = (o.dpy || 0) + dy; }
    return o;
  };
  /** #1276 -- PufferfishEntityRenderer.render: shadowRadius = 0.1F + 0.1F * puffState (ctor base 0.2F). */
  ER.pufferShadowRadius = function (puffState) { return 0.1 + 0.1 * (puffState | 0); };
  /** TurtleEntityRenderer.render: ctor 0.7F, `*= 0.5F` for a baby (vanilla compounds it per frame; the 0.35 steady first-frame value is used). */
  ER.turtleShadowRadius = function (isBaby) { return isBaby ? 0.35 : 0.7; };
  /**
   * #6739 -- every `EntityRenderer.shadowRadius` (the ctor value; .decomp EntityRenderDispatcher.renderShadow reads it).
   * Living: the `super(ctx, model, r)` of each renderer (Horse/Donkey/Mule/ZombieHorse/SkeletonHorse all land on
   * HorseBaseEntityRenderer's 0.75F, their own number is a model scale); Giant = 0.5F * 6.0F; ElderGuardian 1.2F.
   * Non-living: Minecart family 0.7, Boat 0.8, FallingBlock/Tnt/EndCrystal/EnderDragon 0.5, Item/XpOrb 0.15.
   * Slime = 0.25F * size, Pufferfish = 0.1F + 0.1F * puff, Strider/Villager 0.25F when baby: see `ER.shadowRadiusOf`.
   * Types absent here (arrow, painting, ...) keep the EntityRenderer default 0.0F: no shadow.
   */
  ER.SHADOW_RADIUS = {
    horse: 0.75, donkey: 0.75, mule: 0.75, zombie_horse: 0.75, skeleton_horse: 0.75, panda: 0.9, sheep: 0.7,
    piglin: 0.5, piglin_brute: 0.5, zombified_piglin: 0.5, endermite: 0.3, creeper: 0.5, slime: 0.25, vex: 0.3,
    llama: 0.7, trader_llama: 0.7, snow_golem: 0.5, ocelot: 0.4, squid: 0.7, glow_squid: 0.7, pillager: 0.5,
    bat: 0.25, wolf: 0.5, strider: 0.5, chicken: 0.3, hoglin: 0.7, polar_bear: 0.9, zoglin: 0.7, player: 0.5,
    evoker: 0.5, magma_cube: 0.25, ravager: 1.1, illusioner: 0.5, wandering_trader: 0.5, blaze: 0.5,
    iron_golem: 0.7, goat: 0.7, cow: 0.7, turtle: 0.7, cod: 0.3, ghast: 1.5, mooshroom: 0.7, cat: 0.4,
    tropical_fish: 0.15, wither: 1.0, enderman: 0.5, pufferfish: 0.2, rabbit: 0.3, parrot: 0.3, axolotl: 0.5,
    salmon: 0.4, bee: 0.4, pig: 0.7, armor_stand: 0, vindicator: 0.5, villager: 0.5, fox: 0.4, phantom: 0.75,
    zombie_villager: 0.5, shulker: 0, spider: 0.8, cave_spider: 0.8, skeleton: 0.5, stray: 0.5, wither_skeleton: 0.5,
    silverfish: 0.3, zombie: 0.5, husk: 0.5, drowned: 0.5, giant: 3, witch: 0.5, dolphin: 0.7, guardian: 0.5,
    elder_guardian: 1.2, minecart: 0.7, chest_minecart: 0.7, furnace_minecart: 0.7, hopper_minecart: 0.7,
    spawner_minecart: 0.7, command_block_minecart: 0.7, tnt_minecart: 0.7, boat: 0.8, falling_block: 0.5, tnt: 0.5,
    end_crystal: 0.5, ender_dragon: 0.5, item: 0.15, experience_orb: 0.15
  };
  /**
   * #6739 -- the radius `renderShadow` receives. `e`: { type, size (slime/magma), puffState, baby }.
   * Slime: 0.25F * size (SlimeEntityRenderer.render); Pufferfish by puff; baby Strider/Villager 0.25F;
   * a baby Turtle halves (ER.turtleShadowRadius). Then renderShadow's own `MobEntity.isBaby -> * 0.5F`.
   */
  ER.shadowRadiusOf = function (e) {
    var t = e.type, r = ER.SHADOW_RADIUS[t] || 0, baby = !!e.baby;
    if (t === 'slime') r = 0.25 * (e.size || 1);
    else if (t === 'pufferfish') r = ER.pufferShadowRadius(e.puffState);
    else if (t === 'turtle') r = ER.turtleShadowRadius(baby);
    else if ((t === 'strider' || t === 'villager') && baby) r = 0.25;
    return r;
  };
  /** `renderShadow` radius: baby MobEntity halves it (Math.fround'd like the float). */
  ER.shadowPartRadius = function (r, baby) { return Math.fround(baby ? r * 0.5 : r); };
  /** Dispatcher.render: `(1 - distSq / 256) * shadowOpacity`; <= 0 draws nothing. */
  ER.shadowOpacity = function (distSq) { return Math.fround(1 - distSq / 256); };
  /** renderShadowPart's alpha: `(opacity - (feetY - cellY) / 2) * 0.5 * brightness`, clamped to 1, < 0 draws nothing (null). */
  ER.shadowPartAlpha = function (opacity, feetY, cellY, brightness) {
    var a = Math.fround((opacity - (feetY - cellY) / 2) * 0.5 * brightness);
    return a < 0 ? null : a > 1 ? 1 : a;
  };
  /** `MathHelper.wrap(a, b)` (MathHelper.java:728): a triangle wave in [-1, 1]. */
  ER.mathWrap = function (a, b) { return (Math.abs(a % b - b * 0.5) - b * 0.25) / (b * 0.25); };
  /** #733 -- `IronGolemEntityModel.method_17097` (legs) + `method_17095` (arms): rest pitch is 0, so the assignment is the delta. */
  ER.golemDelta = function (partName, limbSwing, amount, g) {
    var w = ER.mathWrap(limbSwing, 13), right = partName[0] === 'r', rx;
    if (partName.slice(-3) === 'leg') rx = (right ? -1.5 : 1.5) * w * amount;
    else if (g.attack > 0) rx = -2 + 1.5 * ER.mathWrap(g.attack - g.partial, 10);
    else if (g.look > 0) rx = right ? -0.8 + 0.025 * ER.mathWrap(g.look, 70) : 0;
    else rx = (right ? -0.2 + 1.5 * w : -0.2 - 1.5 * w) * amount;
    return { rx: rx, ry: 0, rz: 0 };
  };
  /** #1291 -- SkeletonEntityModel.setAngles melee pose: arm angles ASSIGNED (pitch -PI/2 - (sin(t*PI)*1.2 - sin((1-(1-t)^2)*PI)*0.4),
   *  yaw -/+(0.1 - sin(t*PI)*0.6), roll 0) then CrossbowPosing.swingArms(age); animateArms' pivots survive, its angles do not. */
  ER.holdsTrident = function (e) {
    var Eq = NS.Equip, IT = NS.Items, st = Eq && Eq.ready && IT && Eq.getEquipped(e, IT.MAINHAND);
    return !!(st && IT.nameOf(st.i) === 'trident');
  };
  /** BipedEntityModel.positionRightArm/LeftArm BOW_AND_ARROW (.decomp, read whole) + bobArms, as a DELTA from rest. */
  ER.skeletonBowArmDelta = function (partName, ctx, netHeadYaw, headPitch) {
    var right = partName === 'right_arm', age = ctx.ageInTicks || 0, r = ctx.rest || {};
    var hy = (netHeadYaw || 0) * DEG2RAD, hp = (headPitch || 0) * DEG2RAD, lh = !!ctx.leftHanded, sg = right ? 1 : -1;
    var ry = right ? (lh ? -0.1 + hy - 0.4 : -0.1 + hy) : (lh ? 0.1 + hy : 0.1 + hy + 0.4);
    var rx = -Math.PI / 2 + hp + sg * Math.sin(age * 0.067) * 0.05;
    var rz = sg * (Math.cos(age * 0.09) * 0.05 + 0.05);
    return { rx: rx - (r.rx || 0), ry: ry - (r.ry || 0), rz: rz - (r.rz || 0) };
  };
  ER.skeletonMeleeArmDelta = function (partName, ctx, d) {
    var right = partName === 'right_arm', t = ctx.attackTime || 0, age = ctx.ageInTicks || 0, r = ctx.rest || {};
    var a = Math.sin(t * Math.PI), b = Math.sin((1 - (1 - t) * (1 - t)) * Math.PI), sg = right ? 1 : -1;
    var rx = -Math.PI / 2 - (a * 1.2 - b * 0.4), ry = right ? -(0.1 - a * 0.6) : 0.1 - a * 0.6, rz = 0;
    rz += sg * (Math.cos(age * 0.09) * 0.05 + 0.05);
    rx += sg * Math.sin(age * 0.067) * 0.05;
    var sw = ER.animateArmsDelta(partName, t, !!ctx.leftHanded, 0, ctx.rest, false);
    return { rx: rx - (r.rx || 0), ry: ry - (r.ry || 0), rz: rz - (r.rz || 0),
             dpx: sw ? sw.dpx : 0, dpy: d && d.dpy || 0, dpz: sw ? sw.dpz : 0 };
  };
  /**
   * #7795 -- `BipedEntityModel.setAngles` for the PLAYER model (.decomp, read whole), empty arm poses, no swing: head, body, arms
   * (swing / 0.2-velocity divisor while fall flying / riding -PI/5 / sneaking +0.4 / CrossbowPosing.swingArm bob), legs (riding
   * splay, sneaking pivots), then the leaningPitch (swim/crawl) lerps toward the crawl pose. Returns the DELTA from `rest`
   * (every value is ASSIGNED in vanilla). ponytail: the head pitch lerped FROM is the model's previous-frame pitch in vanilla;
   * here it is 0 (the model default). Arm poses (bow/crossbow/item), animateArms and spyglass stay with the other layers.
   */
  ER.playerDelta = function (partName, ls, amt, yaw, pitch, riding, pl, rest, age) {
    var P = Math.PI, c = Math.cos, hy = yaw * DEG2RAD, hp = pitch * DEG2RAD, lp = pl.lp, sn = pl.sneaking;
    var lerpA = function (a, f, t) { var w = (t - f) % (P * 2); if (w < -P) w += P * 2; if (w >= P) w -= P * 2; return f + a * w; };
    var lerp = function (a, f, t) { return f + a * (t - f); };
    var k = 1; if (pl.flying) { k = pl.v2 / 0.2; k *= k * k; } if (k < 1) k = 1;
    var out = { rx: 0, ry: 0, rz: 0, px: rest.px, py: rest.py, pz: rest.pz };
    var w = ls * 0.6662;
    if (partName === 'head' || partName === 'hat') {
      out.ry = hy;
      out.rx = pl.flying ? -P / 4 : lp > 0 ? lerpA(lp, 0, pl.swimPose ? -P / 4 : hp) : hp;
      out.py = sn ? 4.2 : 0;
    } else if (partName === 'body') {
      out.rx = sn ? 0.5 : 0; out.py = sn ? 3.2 : 0;
    } else if (partName === 'right_arm' || partName === 'left_arm') {
      var r = partName === 'right_arm', sg = r ? 1 : -1, ra, ry = 0, rz = 0;
      ra = (r ? c(w + P) : c(w)) * 2 * amt * 0.5 / k;
      if (riding) ra += -P / 5;
      if (sn) ra += 0.4;
      rz += sg * (c(age * 0.09) * 0.05 + 0.05); ra += sg * Math.sin(age * 0.067) * 0.05;
      out.px = r ? -5 : 5; out.pz = 0; out.py = sn ? 5.2 : 2;
      if (lp > 0 && !pl.usingItem) {
        var m = function (x) { return -65 * x + x * x; }, l = ls % 26, f = r ? lerp : lerpA;
        if (l < 14) { ra = f(lp, ra, 0); ry = f(lp, ry, P); rz = f(lp, rz, r ? P - 1.8707964 * m(l) / m(14) : P + 1.8707964 * m(l) / m(14)); }
        else if (l < 22) { var q = (l - 14) / 8; ra = f(lp, ra, P / 2 * q); ry = f(lp, ry, P); rz = f(lp, rz, r ? 1.2707963 + 1.8707964 * q : 5.012389 - 1.8707964 * q); }
        else if (l < 26) { var q2 = (l - 22) / 4; ra = f(lp, ra, P / 2 - P / 2 * q2); ry = f(lp, ry, P); rz = f(lp, rz, P); }
      }
      out.rx = ra; out.ry = ry; out.rz = rz;
    } else if (partName === 'right_leg' || partName === 'left_leg') {
      var rl = partName === 'right_leg', lx = (rl ? c(w) : c(w + P)) * 1.4 * amt / k, ly = 0, lz = 0;
      if (riding) { lx = -1.4137167; ly = rl ? P / 10 : -P / 10; lz = rl ? 0.07853982 : -0.07853982; }
      if (lp > 0) lx = lerp(lp, lx, 0.3 * (rl ? c(ls * 0.33333334) : c(ls * 0.33333334 + P)));
      out.rx = lx; out.ry = ly; out.rz = lz; out.pz = sn ? 4 : 0.1; out.py = sn ? 12.2 : 12;
    } else return null;
    return { rx: out.rx - (rest.rx || 0), ry: out.ry - (rest.ry || 0), rz: out.rz - (rest.rz || 0),
             dpx: out.px - rest.px, dpy: out.py - rest.py, dpz: out.pz - rest.pz };
  };
  /** DrownedEntityModel.setAngles leaning block (.decomp) on top of the zombie pose `d`: arms lerpAngle toward -4PI/5 + 0.35 sin(0.1 age) bob,
   *  roll toward -/+0.15, legs -/+ 0.55 sin(0.1 age), head pitch 0. Biped.setAngles had already lerped head/hat (hat copied BEFORE the zeroing) and legs. */
  ER.drownedLeanDelta = function (partName, d, ls, headPitch, ctx) {
    var P = Math.PI, k = ctx.drownedLp, r = ctx.rest, age = ctx.ageInTicks || 0, s = Math.sin(0.1 * age);
    var lerpA = function (a, f, t) { var w = (t - f) % (P * 2); if (w < -P) w += P * 2; if (w >= P) w -= P * 2; return f + a * w; };
    d = d || { rx: 0, ry: 0, rz: 0 };
    var o = { rx: d.rx, ry: d.ry, rz: d.rz, dpx: d.dpx, dpy: d.dpy, dpz: d.dpz };
    if (partName === 'head') o.rx = -(r.rx || 0);
    else if (partName === 'hat') o.rx = lerpA(k, 0, ctx.drownedSwim ? -P / 4 : headPitch * DEG2RAD) - (r.rx || 0);
    else if (partName === 'left_arm' || partName === 'right_arm') {
      var R = partName === 'right_arm', a = (r.rx || 0) + d.rx, z = (r.rz || 0) + d.rz;
      o.rx = lerpA(k, a, -P * 4 / 5) + (R ? 1 : -1) * k * 0.35 * s - (r.rx || 0);
      o.rz = lerpA(k, z, R ? -0.15 : 0.15) - (r.rz || 0);
    } else if (partName === 'left_leg' || partName === 'right_leg') {
      var RL = partName === 'right_leg', l = (r.rx || 0) + d.rx;
      l = l + k * ((RL ? Math.cos(ls * 0.33333334) : Math.cos(ls * 0.33333334 + P)) * 0.3 - l);   // Biped lerp(leaningPitch, pitch, 0.3 cos)
      o.rx = l + (RL ? 1 : -1) * k * 0.55 * s - (r.rx || 0);
    }
    return o;
  };
  ER.setupAnimDeltaCore = function (partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind, ctx) {
    // D-429 — the zombie-arm layer, which REPLACES the humanoid arm swing rather than adding to
    // it. `ctx` is optional and absent from every existing caller, so a check that has not been
    // told about it gets exactly the behaviour it had before.
    if (ctx && ctx.zarm && !ctx.illager && (partName === 'left_arm' || partName === 'right_arm')) {
      var zd = ER.zombieArmDelta(partName, ctx.zarm, ctx.ageInTicks || 0,
                                 ctx.attackTime || 0, !!ctx.aggressive, ctx.rest);
      if (ctx.trident && (partName === 'left_arm') === !!ctx.leftHanded) {   // pitch = pitch * 0.5 - PI, yaw = 0
        var rr = ctx.rest || {};
        zd.rx = ((rr.rx || 0) + zd.rx) * 0.5 - Math.PI - (rr.rx || 0);
        zd.ry = -(rr.ry || 0);
      }
      return zd;
    }
    if (ctx && ctx.illager && (partName === 'left_arm' || partName === 'right_arm')) {
      return ER.illagerArmDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, ctx.illager);
    }
    if (ctx && ctx.spellcast && (partName === 'left_arm' || partName === 'right_arm')) {
      return ER.illagerSpellArm(partName, ctx.ageInTicks || 0);
    }
    if (ctx && ctx.golem && /^(left|right)_(arm|leg)$/.test(partName)) {
      return ER.golemDelta(partName, limbSwing, limbSwingAmount, ctx.golem);
    }
    if (kind === 'phantom') return ER.phantomDelta(partName, ctx);
    if (kind === 'bee') return ER.beeDelta(partName, ctx);
    // #1569 -- SquidEntityModel.setAngles: tentacle.pitch = tentacleAngle (ASSIGNED; rest pitch 0).
    if (kind === 'squid') {
      if (!/^tentacle[0-7]$/.test(partName)) return null;
      return { rx: ((ctx && ctx.squid && ctx.squid.tentacle) || 0) - ((ctx && ctx.rest && ctx.rest.rx) || 0), ry: 0, rz: 0 };
    }
    if (kind === 'spider') {
      return ER.spiderDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch);
    }
    // GhastEntityModel.setAngles: tentacle[i].pitch = 0.2 * sin(ageInTicks * 0.3 + i) + 0.4 (rest pitch 0).
    if (kind === 'ghast') {
      var gt = /^tentacle([0-8])$/.exec(partName);
      if (!gt) return null;
      return { rx: 0.2 * Math.sin(((ctx && ctx.ageInTicks) || 0) * 0.3 + (+gt[1])) + 0.4, ry: 0, rz: 0 };
    }
    // BlazeEntityModel.setAngles: rod pivots are ASSIGNED (rest = tsv pivot, so delta = target - rest); three rings,
    // R 9/7/5, spin -0.1/+0.03/-0.05*PI*age, +1 rad per rod; Y bobs with cos. The head falls through to the generic head turn.
    if (kind === 'blaze') {
      var bm = /^part(\d+)$/.exec(partName), br = ctx && ctx.rest;
      if (bm && br) {
        var bi = +bm[1], bg = ((ctx && ctx.ageInTicks) || 0), ring = bi < 4 ? 0 : bi < 8 ? 1 : 2, bk = bi - ring * 4;
        var ba = [0, Math.PI / 4, 0.47123894][ring] + bg * Math.PI * [-0.1, 0.03, -0.05][ring] + bk, bR = [9, 7, 5][ring];
        var by = ring === 0 ? -2 + Math.cos((bi * 2 + bg) * 0.25) : ring === 1 ? 2 + Math.cos((bi * 2 + bg) * 0.25) : 11 + Math.cos((bi * 1.5 + bg) * 0.5);
        return { rx: 0, ry: 0, rz: 0, dpx: Math.cos(ba) * bR - br.px, dpy: by - br.py, dpz: Math.sin(ba) * bR - br.pz };
      }
    }
    // #851 -- Silverfish/EndermiteEntityModel.setAngles: body[i].yaw = cos(age*.9 + i*.15PI)*PI*Y*(1+|i-2|),
    // pivotX = sin(same)*PI*P*|i-2| (silverfish Y .05 P .2; endermite .01/.1), both ASSIGNED (rest 0).
    // Silverfish's 3 layer parts share seg0/1/2's names in the table (rest tu 20): layer0 copies
    // body[2]'s yaw only, layer1 body[4]'s yaw+pivotX, layer2 body[1]'s.
    if (kind === 'silverfish' || kind === 'endermite') {
      var sm = /^seg([0-6])$/.exec(partName);
      if (!sm) return null;
      var si = +sm[1], layer = kind === 'silverfish' && ctx && ctx.rest && ctx.rest.tu >= 20;
      var sa = ((ctx && ctx.ageInTicks) || 0) * 0.9;
      var sy = kind === 'silverfish' ? 0.05 : 0.01, sp = kind === 'silverfish' ? 0.2 : 0.1;
      if (layer) si = [2, 4, 1][si];
      var ph = sa + si * 0.15 * Math.PI, ax = Math.abs(si - 2);
      return { rx: 0, ry: Math.cos(ph) * Math.PI * sy * (1 + ax),
               dpx: (layer && partName === 'seg0') ? 0 : Math.sin(ph) * Math.PI * sp * ax, rz: 0 };
    }
    if (kind === 'ender_dragon') {
      return ER.dragonDelta(partName, ctx, netHeadYaw, headPitch);
    }
    // #723 -- SnowGolemEntityModel.setAngles (.decomp): head yaw/pitch from the head rotation, the
    // upper body turns a QUARTER of the head yaw and the arms follow it (yaw = upperBody.yaw, the
    // right one +PI) with their pivots swung on a radius of 5 -- and they NEVER swing with the walk.
    // Yaw/pivot X/Z are ASSIGNMENTS, so the deltas below are target - rest (rest: golden tsv).
    if (kind === 'snow_golem') {
      var sgYaw = netHeadYaw * DEG2RAD, sgUb = sgYaw * 0.25, sgR = ctx && ctx.rest;
      if (partName === 'head') return { rx: headPitch * DEG2RAD, ry: sgYaw, rz: 0 };
      if (partName === 'upper_body') return { rx: 0, ry: sgUb, rz: 0 };
      if (partName === 'left_arm' || partName === 'right_arm') {
        var sgL = partName === 'left_arm', sgS = Math.sin(sgUb), sgC = Math.cos(sgUb);
        return { rx: 0, ry: sgL ? sgUb - (sgR ? sgR.ry : 0) : sgUb - (sgR ? sgR.ry - Math.PI : 0), rz: 0,
                 dpx: (sgL ? sgC * 5 : -sgC * 5) - (sgR ? sgR.px : (sgL ? 5 : -5)),
                 dpz: (sgL ? -sgS * 5 : sgS * 5) - (sgR ? sgR.pz : (sgL ? 1 : -1)) };
      }
      return null;
    }
    // loop/renderres-s104 -- `ChickenEntityModel.setAngles` lines 74-76: `rightWing.roll = f`,
    // `leftWing.roll = -f`, `f` = `ER.chickenWingRoll`'s already-interpolated curve. `roll` is
    // this table's `rz` (D-415's own `pitch/yaw/roll` == `rx/ry/rz` mapping, unchanged here).
    // Both wings' REST `rz` is 0 (`tools/golden/models-1.18.2.tsv` rows 123/126), so ADDING
    // this delta is the same ASSIGNMENT vanilla makes.
    // #584 -- the fish family's setAngles (.decomp CodEntityModel/SalmonEntityModel/
    // Small+LargeTropicalFishEntityModel/Small+Medium+LargePufferfishEntityModel), every one
    // an ASSIGNMENT of a single angle (rest yaw/roll of these parts is 0 except the puffer
    // fins' roll, which the assignment replaces: `rz` below is delta = target - rest).
    if (ctx && ctx.fish && ctx.fish.puffer) {
      // #1276 -- PufferfishEntityRenderer.setupTransforms: translate(0, cos(ageInTicks*0.05)*0.08, 0) before super
      // (no cod/salmon roll: its super is LivingEntityRenderer). Model units = blocks * 16, like #1256's belly.
      var pb = ER.setupAnimDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, riding, kind,
        Object.assign({}, ctx, { fish: { water: ctx.fish.water, puffer: false } }));
      var po = pb ? { rx: pb.rx, ry: pb.ry, rz: pb.rz, dpx: pb.dpx, dpy: pb.dpy || 0, dpz: pb.dpz } : { rx: 0, ry: 0, rz: 0, dpy: 0 };
      po.dpy += Math.cos((ctx.ageInTicks || 0) * 0.05) * 0.08 * 16;
      return po;
    }
    if (ctx && ctx.fish) {
      var age = ctx.ageInTicks || 0, fw = ctx.fish.water;
      if (partName === 'tail_fin' || partName === 'tail')
        return { rx: 0, ry: -(fw ? 1.0 : 1.5) * 0.45 * Math.sin(0.6 * age), rz: 0 };
      if (partName === 'back_fin' && ctx.rest && ctx.rest.w === 0 && ctx.rest.h === 5)   // salmon tail (pufferfish_small back_fin is a different box)
        return { rx: 0, ry: -(fw ? 1.0 : 1.3) * 0.25 * Math.sin((fw ? 1.0 : 1.7) * 0.6 * age), rz: 0 };
      // pufferfish: small = left_fin/right_fin, medium+large = left_blue_fin/right_blue_fin
      var pr = partName === 'right_blue_fin' || (partName === 'right_fin' && ctx.rest && ctx.rest.pz === -1.5);
      var pl = partName === 'left_blue_fin' || (partName === 'left_fin' && ctx.rest && ctx.rest.pz === -1.5);
      if (pr) return { rx: 0, ry: 0, rz: -0.2 + 0.4 * Math.sin(age * 0.2) };
      if (pl) return { rx: 0, ry: 0, rz: 0.2 - 0.4 * Math.sin(age * 0.2) };
    }
    // #910 -- WolfEntityModel.method_17131/method_17133 (.decomp, read whole). The flattened table
    // has no `head`/`tail` pivot-only parents, so real_head/real_tail carry the parent's pivot
    // here (dpx/dpy/dpz) and the nested rotation (parent Euler then the child's roll) is folded
    // into ONE Euler triple with ER.rotMatrix/eulerOf. Every rest angle below is 0 except
    // body/upper_body (pi/2), so deltas are target - rest.
    if (ctx && ctx.wolf) {
      var W = ctx.wolf, wl = limbSwing * 0.6662, wa = limbSwingAmount, HP = Math.PI / 2, sit = W.sitting;
      var ws = Math.cos(wl) * 1.4 * wa, wo = Math.cos(wl + Math.PI) * 1.4 * wa;
      switch (partName) {
        case 'upper_body': return sit ? { rx: Math.PI * 2 / 5 - HP, ry: 0, rz: W.neckRoll, dpy: 2 } : (W.neckRoll ? { rx: 0, ry: 0, rz: W.neckRoll } : null);
        case 'body': return sit ? { rx: Math.PI / 4 - HP, ry: 0, rz: W.bodyRoll, dpy: 4, dpz: -2 } : (W.bodyRoll ? { rx: 0, ry: 0, rz: W.bodyRoll } : null);
        case 'right_hind_leg': case 'left_hind_leg':
          return sit ? { rx: Math.PI * 3 / 2, ry: 0, rz: 0, dpy: 6.7, dpz: -5 }
                     : { rx: partName === 'right_hind_leg' ? ws : wo, ry: 0, rz: 0 };
        case 'right_front_leg': case 'left_front_leg':
          return sit ? { rx: 5.811947, ry: 0, rz: 0, dpx: 0.01, dpy: 1 }
                     : { rx: partName === 'right_front_leg' ? wo : ws, ry: 0, rz: 0 };
        // #1202 -- the box-less `head`/`tail` parents are VIRTUAL_PARTS (pivot + rest pitch) and real_head/real_tail
        // compose under them (PART_PARENT), exactly the vanilla tree: head.pitch/yaw = the look angles, real_head.roll =
        // the begging/shake roll; tail.pitch = tailAngle (rest 0.6283), tail.yaw/roll, and the sit pivot is head-local.
        case 'head': return { rx: headPitch * DEG2RAD, ry: netHeadYaw * DEG2RAD, rz: 0 };
        case 'real_head': return W.headRoll ? { rx: 0, ry: 0, rz: W.headRoll } : null;
        case 'tail': return { rx: W.tailAngle - 0.6283185307179586, ry: W.angry ? 0 : ws, rz: W.tailRoll, dpy: sit ? 9 : 0, dpz: sit ? -2 : 0 };
      }
      return null;
    }
    // #1284 -- FoxEntityModel.method_18330/method_18332 (.decomp), as deltas from rest (golden tsv): head (-1,16.5,-3),
    // body (0,16,-6) pitch PI/2, tail (-4,15,-1) pitch -0.05235988, hind legs z7 / front z0 at y17.5.
    if (ctx && ctx.horse) return ER.horseDelta(partName, limbSwing, limbSwingAmount, netHeadYaw, headPitch, ctx.ageInTicks || 0, ctx.horse);
    if (ctx && ctx.fox) {
      var F = ctx.fox, fl = limbSwing * 0.6662, fa = limbSwingAmount, FH = Math.PI / 2, fb = !!ctx.baby, fp = Math.PI;
      var fq = F.sneaking ? 0 : F.sleeping ? 1 : F.sitting ? 2 : 3;   // sneak wins over sleep wins over sit
      var fleg = function (hind, right) {
        if (fq === 2 && hind) { var sl = F.walking ? { rx: Math.cos((F.leg * 0.4662) + (right === hind ? 0 : fp)) * 0.1, ry: 0, rz: 0 } : { rx: -fp * 5 / 12, ry: 0, rz: 0 }; sl.dpy = 4; sl.dpz = -0.25; return sl; }
        if (fq === 2 && !F.walking) return { rx: -fp / 12, ry: 0, rz: 0 };
        var ph = F.walking ? F.leg * 0.4662 : fl, g = F.walking ? 0.1 : 1.4 * fa, sw = right === hind ? 0 : fp;
        var r = { rx: Math.cos(ph + sw) * g, ry: 0, rz: 0 };
        if (fq === 0) r.rz = Math.cos(F.age) * 0.01 / (hind ? 1 : 2);
        return r;
      };
      switch (partName) {
        case 'head':
          if (fq === 0) return { rx: 0, ry: 0, rz: F.headRoll, dpy: F.bodyOff };
          if (fq === 1) return { rx: 0, ry: -fp * 2 / 3, rz: Math.cos(F.age * 0.027) / 22, dpx: 2, dpy: 2.99 };
          if (fq === 2) return { rx: F.walking ? 0 : headPitch * DEG2RAD, ry: F.walking ? 0 : netHeadYaw * DEG2RAD, rz: F.headRoll, dpy: fb ? -3.5 : -6.5, dpz: fb ? -0.75 : 2.75 };   // method_18332 aims a sitting fox's head too
          return F.walking ? { rx: 0, ry: 0, rz: F.headRoll } : { rx: headPitch * DEG2RAD, ry: netHeadYaw * DEG2RAD, rz: F.headRoll };
        case 'body':
          if (fq === 0) return { rx: 1.6755161 - FH, ry: Math.cos(F.age) * 0.01, rz: 0, dpy: F.bodyOff };
          if (fq === 1) return { rx: 0, ry: 0, rz: -FH, dpy: 5, dpz: fb ? 4 : 0 };
          if (fq === 2) return { rx: fp / 6 - FH, ry: 0, rz: 0, dpy: -7, dpz: 3 };
          return null;
        case 'tail':
          if (fq === 1) return { rx: (fb ? -2.1816616 : -fp * 5 / 6) + 0.05235988, ry: 0, rz: 0 };
          if (fq === 2) return { rx: fp / 4 + 0.05235988, ry: 0, rz: 0, dpz: -1 };
          return null;
        case 'right_hind_leg': return fleg(true, true);
        case 'left_hind_leg': return fleg(true, false);
        case 'right_front_leg': return fleg(false, true);
        case 'left_front_leg': return fleg(false, false);
      }
      return null;
    }
    // #1226 -- ParrotEntityModel.setAngles/animateModel (.decomp, read whole). Every rest rotation in the golden
    // table is 0 and every pivot below is an ASSIGNMENT, so a delta is target - rest (rest py: head 15.69, body 16.5,
    // tail 21.07, wings 16.94, legs 22; wing rest px +-1.5). Pose from ER.parrotAnim.
    // BatEntityModel.setAngles (method_17069) + BatEntityRenderer.setupTransforms (method_3882). Every bat rest
    // rotation is 0 and the pivots are ASSIGNED, so delta = target - rest (wing rest pivot 0). The renderer's
    // translate is in blocks BEFORE the 0.35 scale, y-up, so on the (y-down, scaled) roots it is -t*16/0.35.
    if (ctx && ctx.bat) {
      var BT = ctx.bat, bAge = ctx.ageInTicks || 0, bRoost = BT.roosting, bRt = (bRoost ? -0.1 : Math.cos(bAge * 0.3) * 0.1) * -16 / 0.35;
      var bWy = bRoost ? -Math.PI * 2 / 5 : Math.cos(bAge * 74.48451 * DEG2RAD) * Math.PI * 0.25;
      var bTy = bRoost ? -1.7278761 : bWy * 0.5, bSg = partName === 'left_wing' || partName === 'left_wing_tip' ? -1 : 1;
      switch (partName) {
        case 'head': return { rx: headPitch * DEG2RAD, ry: bRoost ? Math.PI - netHeadYaw * DEG2RAD : netHeadYaw * DEG2RAD,
                              rz: bRoost ? Math.PI : 0, dpy: (bRoost ? -2 : 0) + bRt };
        case 'body': return { rx: bRoost ? Math.PI : Math.PI / 4 + Math.cos(bAge * 0.1) * 0.15, ry: 0, rz: 0, dpy: bRt };
        case 'right_wing': case 'left_wing':
          return { rx: bRoost ? -Math.PI / 20 : 0, ry: bSg * bWy, rz: 0, dpx: bRoost ? -3 * bSg : 0, dpz: bRoost ? 3 : 0 };
        case 'right_wing_tip': case 'left_wing_tip': return { rx: 0, ry: bSg * bTy, rz: 0 };
      }
      return null;
    }
    if (ctx && ctx.parrot) {
      var PA = ctx.parrot, pp = PA.pose, pf = PA.flap, pls = limbSwing * 0.6662;
      var pD = pp === 'party' ? 0 : pp === 'sitting' ? 1.9 : pf * 0.3;
      var pcx = pp === 'party' ? Math.cos(PA.age) : 0, psy = pp === 'party' ? Math.sin(PA.age) : 0;
      var pdy = pp === 'party' ? psy : pD;
      var pw = pp === 'sitting' ? 0.0873 : 0.0873 + pf;
      switch (partName) {
        case 'head':
          return pp === 'party' ? { rx: 0, ry: 0, rz: psy * 0.4, dpx: pcx, dpy: pdy }
                                : { rx: headPitch * DEG2RAD, ry: netHeadYaw * DEG2RAD, rz: 0, dpy: pdy };
        case 'feather': return { rx: -0.2214, ry: 0, rz: 0 };
        case 'body': return { rx: 0.4937, ry: 0, rz: 0, dpx: pcx, dpy: pdy };
        case 'tail':
          return { rx: pp === 'sitting' ? 1.5388988 : pp === 'party' ? 0 : 1.015 + Math.cos(pls) * 0.3 * limbSwingAmount,
                   ry: 0, rz: 0, dpx: pcx, dpy: pdy };
        case 'left_wing': return { rx: -0.6981, ry: -Math.PI, rz: -pw, dpx: pcx, dpy: pdy };
        case 'right_wing': return { rx: -0.6981, ry: -Math.PI, rz: pw, dpx: pcx, dpy: pdy };
        case 'left_leg': case 'right_leg': {
          var pl = partName === 'left_leg', lrx = -0.0299, lrz = 0;
          if (pp === 'sitting') lrx += 1;
          else if (pp === 'flying') lrx += Math.PI * 2 / 9;
          else if (pp === 'party') lrz = pl ? -Math.PI / 9 : Math.PI / 9;
          else if (pp === 'shoulder') lrx += 0;   // ON_SHOULDER: no leg swing (setAngles' default branch)
          else lrx += pl ? Math.cos(pls) * 1.4 * limbSwingAmount : Math.cos(pls + Math.PI) * 1.4 * limbSwingAmount;
          return { rx: lrx, ry: 0, rz: lrz, dpy: pp === 'sitting' ? 1 : pp === 'party' ? 0 : pD };
        }
      }
      return null;
    }
    // #720 -- DolphinEntityModel.setAngles (.decomp): body.pitch/yaw = the head angles (the head,
    // fins, tail are its children and never rotate on their own); only while moving, body.pitch
    // -= 0.05 + 0.05cos(age*.3), tail.pitch = -0.1cos, tailFin.pitch = -0.2cos (assignments:
    // tail rest pitch is -0.10471976, tail_fin 0, so delta = target - rest).
    // #2022 -- GuardianEntityModel.setAngles (.decomp): spike pivots = rest-formula(age, (1-ext)*0.55) minus the rest
    // pivot (age 0, ext 0); tail yaws sin(tailAngle)*PI*{.05,.1,.15}; eye pivotX/Y (rest 0,0) = g.eyeX/eyeY.
    if (ctx && ctx.guardian) {
      var g = ctx.guardian, gm = /^spike(\d+)$/.exec(partName);
      if (gm) {
        var gi = +gm[1], gr = ctx.rest || { px: 0, py: 16, pz: 0 };
        var ga = 1 + Math.cos(g.age * 1.5 + gi) * 0.01 - g.spikeK;
        var gb = 1 + Math.cos(gi) * 0.01;
        return { rx: 0, ry: 0, rz: 0, dpx: gr.px / gb * ga - gr.px, dpy: 16 + (gr.py - 16) / gb * ga - gr.py, dpz: gr.pz / gb * ga - gr.pz };
      }
      if (partName === 'eye') return { rx: 0, ry: 0, rz: 0, dpx: g.eyeX, dpy: g.eyeY, dpz: 0 };
      var gt = partName === 'tail0' ? 0.05 : partName === 'tail1' ? 0.1 : partName === 'tail2' ? 0.15 : 0;
      if (gt) return { rx: 0, ry: Math.sin(g.tail) * Math.PI * gt, rz: 0 };
    }
    if (ctx && ctx.dolphin) {
      var dc = Math.cos((ctx.ageInTicks || 0) * 0.3), dm = ctx.dolphin.moving;
      if (partName === 'body') return { rx: headPitch * DEG2RAD + (dm ? -0.05 - 0.05 * dc : 0), ry: netHeadYaw * DEG2RAD, rz: 0 };
      if (partName === 'tail') return { rx: dm ? -0.1 * dc - (ctx.rest ? ctx.rest.rx : -0.10471976) : 0, ry: 0, rz: 0 };
      if (partName === 'tail_fin') return { rx: dm ? -0.2 * dc : 0, ry: 0, rz: 0 };
      return null;
    }
    if (ctx && ctx.chickenWingRoll !== undefined &&
        (partName === 'right_wing' || partName === 'left_wing')) {
      var roll = ctx.chickenWingRoll;
      return { rx: 0, ry: 0, rz: partName === 'right_wing' ? roll : -roll };
    }
    // ChickenEntityModel.setAngles: beak and red_thing (wattle) copy head.pitch/yaw.
    if ((kind === 'chicken' || (ctx && ctx.chickenWingRoll !== undefined)) && (partName === 'beak' || partName === 'red_thing'))
      return { rx: headPitch * DEG2RAD, ry: netHeadYaw * DEG2RAD, rz: 0 };
    if (partName === 'head' || (partName === 'hat' && !(ctx && ctx.hatComposed))) {
      // loop/renderres-s104 -- `SheepEntityModel.method_17121`: `super.setAngles(...)` first
      // (the generic `headPitch*DEG2RAD` this branch already computes, UNTOUCHED -- the sheep
      // never overrides yaw), THEN `this.head.pitch = headPitchModifier` -- an ASSIGNMENT, not
      // an add, which is why `rx` below is set to the override wholesale rather than summed
      // with the generic one. `dpy` is `method_17120`'s own `head.pivotY = 6 + neckAngle*9`
      // (rest py 6, `tools/golden/models-1.18.2.tsv` row 741) -- see `ER.emitMobLayer`'s own
      // note on this field. Both are `undefined`/0 for every non-sheep head (`ctx.sheepEatGrass`
      // is only ever set from `ER.animOf`'s sheep branch), so nothing else regresses.
      var eg = ctx && ctx.sheepEatGrass;
      var rx = headPitch * DEG2RAD, dpy = 0;
      if (eg) {
        dpy = (eg.neckAngle || 0) * 9;
        if (eg.headOverride !== undefined) rx = eg.headOverride;
      }
      return { rx: rx, ry: netHeadYaw * DEG2RAD, rz: 0, dpy: dpy };
    }
    if (partName === 'right_arm') return riding
      ? { rx: -0.62831855, ry: 0, rz: 0 }
      : { rx: Math.cos(limbSwing * 0.6662 + Math.PI) * 2.0 * limbSwingAmount * 0.5, ry: 0, rz: 0 };
    if (partName === 'left_arm') return riding
      ? { rx: -0.62831855, ry: 0, rz: 0 }
      : { rx: Math.cos(limbSwing * 0.6662) * 2.0 * limbSwingAmount * 0.5, ry: 0, rz: 0 };
    // s98 -- the seated legs also splay: IllagerEntityModel.method_17094 / BipedEntityModel's
    // riding branch, rightLeg yaw PI/10 roll 0.07853982, leftLeg the negatives.
    // VillagerResemblingModel / IllagerEntityModel.setAngles: leg pitch is x0.5 (villager/witch have no riding branch)
    if ((partName === 'right_leg' || partName === 'left_leg') && ctx && (ctx.vleg || ctx.illager)) {
      if (ctx.illager && riding) return partName === 'right_leg' ? { rx: -1.4137167, ry: Math.PI / 10, rz: 0.07853982 } : { rx: -1.4137167, ry: -Math.PI / 10, rz: -0.07853982 };
      return { rx: Math.cos(limbSwing * 0.6662 + (partName === 'left_leg' ? Math.PI : 0)) * 1.4 * limbSwingAmount * 0.5, ry: 0, rz: 0 };
    }
    if (partName === 'right_leg') return riding
      ? { rx: -1.4137167, ry: Math.PI / 10, rz: 0.07853982 }
      : { rx: Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingAmount, ry: 0, rz: 0 };
    if (partName === 'left_leg') return riding
      ? { rx: -1.4137167, ry: -Math.PI / 10, rz: -0.07853982 }
      : { rx: Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbSwingAmount, ry: 0, rz: 0 };
    // quadruped: diagonal gait, front/back legs half a cycle apart (git 2a8efe1:docs/passes/PASS-15-HISTORY.md 4.4 anchor).
    // ⚠ the jar's own fields carry no left/right label, only a phase; this assigns left-front
    // and right-hind to phase 0 and the other diagonal pair to phase pi, which gives the
    // correct vanilla TROT (diagonal pairs move together) regardless of which physical leg the
    // unlabeled fields actually were -- swapping the assignment only mirrors which leg is
    // forward at a given instant, not whether the gait is right.
    if (partName === 'left_front_leg' || partName === 'right_hind_leg') {
      return { rx: Math.cos(limbSwing * 0.6662) * 1.4 * limbSwingAmount, ry: 0, rz: 0 };
    }
    if (partName === 'right_front_leg' || partName === 'left_hind_leg') {
      return { rx: Math.cos(limbSwing * 0.6662 + Math.PI) * 1.4 * limbSwingAmount, ry: 0, rz: 0 };
    }
    return null;
  };

  /**
   * `AgeableListModel.renderToBuffer`'s young branch, as a per-part transform in MODEL UNITS.
   *
   * Vanilla, for a model whose `young` flag is set:
   *     head group:  if (scaleHead) { f = 1.5 / babyHeadScale; scale(f,f,f); }
   *                  translate(0, babyYHeadOffset/16, babyZHeadOffset/16)
   *     body group:  f = 1 / babyBodyScale; scale(f,f,f);
   *                  translate(0, bodyYOffset/16, 0)
   *
   * ⚠⚠ **A `PoseStack` SCALE FOLLOWED BY A TRANSLATE SCALES THE TRANSLATE TOO.** The matrix is
   * S·T, so a point lands at `s * (p + t)`, not at `s * p + t`. Getting that backwards puts a
   * baby cow's body a block and a half under the floor and looks like a Y-offset bug, which is
   * the wrong thing to go looking for.
   * ⚠ THE OFFSETS ARE IN BLOCKS IN VANILLA AND IN MODEL UNITS HERE, and the conversion is the
   * `/16` in the formula above: 16 model units are one block, so `babyYHeadOffset/16` blocks is
   * `babyYHeadOffset` model units and the division cancels. Nothing is scaled twice.
   * ⚠ AND IT IS APPLIED BEFORE THE BASE POSE, which is where vanilla applies it: the model's
   * own space, inside `LivingEntityRenderer`'s `scale(-1,-1,1)`, not after the flip.
   *
   * Returns null for a layer this engine has no baby row for — `Entities.babyModel`'s own
   * refusal, which is how an unread model draws as its adult self rather than as a guess.
   */
  /**
   * QUEUE 0.2 (Tame/Breed remainder) — CLOSED. `Ent.babyModels` (07h_entities.js,
   * `tools/golden/babymodel-1.18.2.tsv`) now carries all 22 vanilla `AgeableListModel`
   * subclasses this roster can hold a baby for. The 15 that were UNREAD split two ways:
   *   - 12 read and rostered — `axolotl, armor_stand, bee, cat, chicken, drowned, fox, horse,
   *     ocelot, wolf, zombie, zombie_villager`. `tools/extract-babymodel.mjs`'s `sixOf`/
   *     `headPartsOf` were generalized to follow `AnimalModel`'s OWN short-ctor overloads
   *     (chicken's and wolf's `super()`-by-omission defaults to `(false,5,2,2,2,24)`),
   *     `BipedEntityModel`'s longer chain (zombie/zombie_villager/drowned, and — surprisingly —
   *     `armor_stand`: `ArmorStandEntity.isBaby()` IS `this.isSmall()`, so a small stand takes
   *     the same child branch a baby zombie does), and a `public`-visibility override of
   *     `getHeadParts()` (horse). See that file's own `sixOf` docstring for the exact bug (a
   *     hard stop the moment ANY call reached `AnimalModel`, even a call to one of its OWN
   *     shorter overloads) and fix.
   *   - 3 ruled NOT babyable, not faked — `enderman, giant, vex`. Their MODELS resolve a full,
   *     valid six values (they extend `BipedEntityModel` too), but `LivingEntity.isBaby()` is
   *     `return false;` unconditionally and none of the three overrides it (`ZombieEntity` does:
   *     a real spawned-baby data-tracker flag; `ArmorStandEntity` does: `isSmall()`; enderman/
   *     giant/vex do not — `grep -rl "public boolean isBaby()" .decomp/net/minecraft/entity/`).
   *     `LivingEntityRenderer` sets `model.child = entity.isBaby()`, so the child branch never
   *     runs for these three regardless of what their model could draw. See
   *     `tools/extract-babymodel.mjs`'s own `NOT_BABYABLE` for the citations.
   * ⚠ PROVENANCE: the 12 rostered rows above were verified by hand against the decompiled
   * source (no JDK/`javap` on the worker that closed this — see the golden tsv's own header)
   * rather than by an actual extractor run; a future run on a machine with a JDK should
   * reproduce them byte-for-byte, and a disagreement is the bug to chase.
   * `ER.babyTransform` below needed NO change to draw any of this — it already drew whatever
   * `Ent.babyModel` returned, including an EMPTY head-part list (axolotl, bee: their own
   * `getHeadParts()` returns `ImmutableList.of()`, so every part takes the body branch).
   */
  ER.BABY_OWED = [];
  /** The three vanilla AgeableListModel species whose ENTITY never reports isBaby() true —
   *  ruled, not owed (see the block comment above this pair of lists). */
  ER.BABY_RULED = ['enderman', 'giant', 'vex'];
  ER.babyTransform = function (layerName, partName) {
    var E = NS.Entities;
    var b = E && E.ready && E.babyModel ? E.babyModel(layerName) : null;
    if (!b) return null;
    var isHead = false;
    for (var i = 0; i < b.head.length; i++) if (b.head[i] === partName) { isHead = true; break; }
    if (isHead) {
      return { s: b.sh ? (ER.BABY_HEAD_NUMERATOR / b.hs) : 1, oy: b.hy, oz: b.hz };
    }
    return { s: 1 / b.bs, oy: b.by, oz: 0 };
  };
  /** The 1.5 in `1.5F / babyHeadScale` — `babymodel-1.18.2.tsv`'s own header records it. */
  ER.BABY_HEAD_NUMERATOR = 1.5;

  /**
   * Write one posed mob layer's boxes into the model stream at word offset `o`.
   *
   *   ux, uy, uz     the entity's own origin, already in 1/256-of-a-block fixed point and
   *                  relative to the draw origin every other model in this buffer uses --
   *                  the same convention `ER.emit`'s `ux/uy/uz` already keeps.
   *   cosYaw, sinYaw the entity's yaw, decomposed once by the caller.
   *   sky, blk, tile as `ER.emit`'s.
   *
   * ⚠⚠ THE WINDING IS DERIVED, NOT ASSUMED -- the same rule `emitcheck` holds the mesher to
   * (D-133/D-314): `cross(v1-v0, v2-v0)` must point the way the face's own outward normal
   * does. `MOB_FACE_CORNERS` gives four corners that bound a face, in SOME consistent loop,
   * but which way that loop winds once it is posed and yaw-rotated is not something worth
   * hand-deriving six more times and hoping the reasoning survives a mirrored box -- so it is
   * computed and corrected per quad instead, the same question `mobboxcheck.mjs` asks of the
   * result independently.
   *
   * Returns the new offset, the same contract as `M.packModelVertex`/`ER.emit`/`ER.emitPart`.
   */
  // #2679: method_23154's white flash is `ER.creeperScale().white` -> packModelVertex `ew` (w1 bits 28-31) -> `vWhite`/`o.white`.

  /**
   * loop/mobrender-s96 — `CreeperEntityRenderer.method_3900`/`method_23154` (.decomp,
   * .decomp/net/minecraft/client/render/entity/CreeperEntityRenderer.java lines 19-33):
   *   f3 = getClientFuseTime(partial)
   *   f4 = 1 + sin(f3*100) * f3 * 0.01          // the jitter wobble
   *   f3 = clamp(f3, 0, 1); f3 *= f3; f3 *= f3;  // f3^4
   *   sxz = (1 + f3*0.4) * f4
   *   sy  = (1 + f3*0.1) / f4
   * `getClientFuseTime` itself (CreeperEntity.java line 195-196: lerp(partial, last, current) /
   * (fuseTime - 2)) is `Cr.swellFraction` (07zb_creeper.js) verbatim — this function reads that
   * function's result, it does not re-derive the fuse bookkeeping (07zb_creeper.js is this
   * unit's read-only file). Returns `null` for anything but a live, non-dead creeper, or when
   * `NS.Cr` is not loaded, so a caller can `if (s) ...` without a second guard.
   */
  /** #5086 TntEntityRenderer.render (.decomp): f = fuse - partial + 1; f < 10 -> s = (1 - f/10) clamped 0..1, ^4,
   *  scale = 1 + s*0.3; flash = getFuse() / 5 % 2 == 0 (int fuse, no partial, no +1). */
  ER.tntRender = function (e, partial) {
    var fu = e.fuse === undefined ? 80 : e.fuse | 0;
    var f = fu - partial + 1;
    var sc = 1;
    if (f < 10) {
      var s = 1 - f / 10;
      s = s < 0 ? 0 : (s > 1 ? 1 : s);
      s = s * s; s = s * s;
      sc = 1 + s * 0.3;
    }
    return { scale: sc, white: ((fu / 5) | 0) % 2 === 0 ? 1 : 0 };
  };

  ER.creeperScale = function (e, partial) {
    if (!e || e.type !== 'creeper' || e.dead || !NS.Creeper || !NS.Creeper.swellFraction) return null;
    var f3 = NS.Creeper.swellFraction(e, partial);
    var f4 = 1 + Math.sin(f3 * 100) * f3 * 0.01;
    var c = f3 < 0 ? 0 : (f3 > 1 ? 1 : f3);
    c = c * c; c = c * c;
    // #2679 method_23154: odd tenth of the fuse -> white overlay at clamp(f,.5,1), else none
    // (OverlayTexture.getU quantises to 15ths: floor, not round)
    var w = Math.floor(f3 * 10) % 2 === 0 ? 0 : Math.floor(Math.max(0.5, Math.min(1, f3)) * 15) / 15;
    return { sxz: (1 + c * 0.4) * f4, sy: (1 + c * 0.1) / f4, white: w };
  };

  /**
   * D-674 — **THE RENDERER'S OWN `scale()`**, which this engine never applied to any mob.
   * `LivingEntityRenderer.render` (.decomp :93-96) runs `setupTransforms` (yaw), `scale(-1,-1,1)`,
   * then the per-renderer `this.scale(entity, matrices, tickDelta)`, then `translate(0,-1.501,0)`
   * — so the factor multiplies the whole model INCLUDING the 1.501 lift (feet stay on the floor).
   * Every constant below is a literal read off that renderer's `.decomp` source:
   *   BatEntityRenderer 0.35 · CatEntityRenderer 0.8 · CaveSpiderEntityRenderer 0.7 ·
   *   GhastEntityRenderer 4.5 · EntityRenderers `new GiantEntityRenderer($$0, 6.0F)` ·
   *   HuskEntityRenderer 1.0625 · IllagerEntityRenderer 0.9375 (evoker/illusioner/pillager/
   *   vindicator extend it) · PolarBearEntityRenderer 1.2 · VexEntityRenderer 0.4 ·
   *   WanderingTraderEntityRenderer / WitchEntityRenderer 0.9375 · WitherSkeletonEntityRenderer 1.2 ·
   *   HorseBaseEntityRenderer `this.scale`: HorseEntityRenderer 1.1, EntityRenderers donkey 0.87 /
   *   mule 0.92, ZombieHorseEntityRenderer (zombie + skeleton horse) 1.0.
   * Size-dependent: creeper swell stays `ER.creeperScale`; SLIME/MAGMA CUBE are `ER.slimeScale`
   * below (a size-4 slime was drawn size 1 before this); phantom (scale 1+0.15*size PLUS its own
   * translate(0,1.3125,0.1875)) is named on KW-32, not half-done. VillagerEntityRenderer is 0.9375,
   * HALVED for a baby (.decomp :26-35) — villager is not an AgeableListModel, so this halving is
   * the ONLY thing that ever made a baby villager small; StriderEntityRenderer is 0.5 for a baby only.
   */
  ER.RENDER_SCALE = {
    bat: 0.35, cat: 0.8, cave_spider: 0.7, ghast: 4.5, giant: 6.0, husk: 1.0625,
    evoker: 0.9375, illusioner: 0.9375, pillager: 0.9375, vindicator: 0.9375,
    polar_bear: 1.2, vex: 0.4, wandering_trader: 0.9375, witch: 0.9375, wither_skeleton: 1.2,
    horse: 1.1, donkey: 0.87, mule: 0.92, zombie_horse: 1.0, skeleton_horse: 1.0,
    // D-787 residue -- WitherEntityRenderer.method_4152 base 2.0; the spawn-timer shrink is ER.renderScaleOf's (#1577).
    wither: 2.0,
    // #1012 -- ElderGuardianEntityRenderer.scale (.decomp:17): scale(SCALE) with ElderGuardianEntity.SCALE =
    // elder width / guardian width = 1.9975 / 0.85.
    elder_guardian: 1.9975 / 0.85,
    dragon_fireball: 2,   // #3806 scale(2,2,2)
    shulker_bullet: 0.5   // #3032 scale(-0.5,-0.5,0.5)
  };
  /** s133 -- `PhantomEntityRenderer.scale` (.decomp:24-28): `scale(f,f,f)` with f = 1 + 0.15 *
   *  getPhantomSize(), THEN `translate(0.0, 1.3125, 0.1875)` — in the flipped frame, before the
   *  living 1.501 lift, so the model sits 1.3125 lower and 0.1875 further along its own +z (both
   *  scaled by f). It was drawn with the plain lift: 1.31 blocks above its own hitbox. */
  ER.RENDER_TRANSLATE = { phantom: [0, 1.3125, 0.1875] };
  var translatedPoses = {};
  ER.translatedPose = function (base) {
    if (translatedPoses[base]) return translatedPoses[base];
    var t = ER.RENDER_TRANSLATE[base], U = CFG.MODEL_UNITS_PER_BLOCK;
    return (translatedPoses[base] = { flip: true, yOffsetFixed: (ER.LIVING_Y_OFFSET - t[1]) * U,
      xOffsetFixed: t[0] * U, zOffsetFixed: t[2] * U });
  };
  /** PiglinEntityRenderer ctor: BipedEntityRenderer(scaleX=1.0019531F, scaleY=1.0F, scaleZ=1.0019531F)
   *  (HORIZONTAL_SCALE) -- piglin, piglin_brute and zombified_piglin are drawn 0.195% wider only. */
  ER.RENDER_SCALE_XZ = { piglin: 1.0019531, piglin_brute: 1.0019531, zombified_piglin: 1.0019531 };
  ER.renderScaleOf = function (e, partial) {
    if (!e) return 1;
    if (e.displayScale) { var inner = ER.renderScaleOf({ type: e.type, isBaby: false }, partial); return e.displayScale * inner; }
    if (e.type === 'phantom') return 1 + 0.15 * (e.phantomSize | 0);
    if (e.type === 'villager') return e.isBaby ? 0.9375 * 0.5 : 0.9375;
    if (e.type === 'strider') return e.isBaby ? 0.5 : 1;
    // #1577 -- WitherEntityRenderer.method_4152: 2.0, minus (timer - partial) / 220 * 0.5 while spawning
    if (e.type === 'wither') { var wt = e.invulTimer | 0; return wt > 0 ? 2.0 - (wt - (partial || 0)) / 220 * 0.5 : 2.0; }
    var s = ER.RENDER_SCALE[e.type];
    return s === undefined ? 1 : s;
  };
  /** SlimeEntityRenderer.scale (.decomp) / MagmaCubeEntityRenderer.scale: `s = lerp(partial,
   *  lastStretch, stretch) / (size*0.5 + 1)`, `g = 1/(s+1)`, `scale(g*size, size/g, g*size)`; the
   *  slime's own extra `scale(0.999)` first (its `translate(0, 0.001, 0)` — a thousandth of a
   *  block, z-fight insurance — is below this mesher's vertex precision and not drawn). */
  /** `MathHelper.lerp(partial, lastStretch, stretch)` clamped at 0 -- `MagmaCubeEntityModel.method_17098`. */
  ER.slimeStretch = function (e, partial) {
    var st = (e.lastStretch || 0) + ((e.stretch || 0) - (e.lastStretch || 0)) * (partial || 0);
    return st < 0 ? 0 : st;
  };
  ER.slimeScale = function (e, partial) {
    if (!e || (e.type !== 'slime' && e.type !== 'magma_cube')) return null;
    var size = e.size || 1;
    var st = (e.lastStretch || 0) + ((e.stretch || 0) - (e.lastStretch || 0)) * (partial || 0);
    var s = st / (size * 0.5 + 1), g = 1 / (s + 1);
    var k = e.type === 'slime' ? 0.999 : 1;
    return { sxz: k * g * size, sy: k * size / g };
  };
  /** ⚠ THE i16 CEILING (`ER.mobWorstCoord`). A packed model vertex is a signed 16-bit offset at
   *  256 units a block, and `ER.RANGE` (64 blocks) of draw distance already spends half of it, so
   *  no model may reach past ~64 blocks from its origin. Vanilla lets a /summon'd slime be Size 127
   *  — 127 blocks wide — which would wrap. Every scale is clamped HERE, the one place it is made;
   *  natural slimes (sizes 1/2/4) and every constant renderer scale (giant 6) are far below it. */
  ER.MAX_MOB_SCALE = 16;
  /** The largest scale a LAYER can ever be drawn at — `ER.mobWorstCoord`'s bound. */
  ER.layerScaleBound = function (layerName) {
    var b = String(layerName).split('#')[0];
    if (b === 'slime' || b === 'magma_cube') return ER.MAX_MOB_SCALE;
    var s = ER.RENDER_SCALE[b];
    // creeper's swell tops out at sxz 1.4 * (1 + 0.01) (ER.creeperScale at f3 = 1)
    if (b === 'creeper') return 1.42;
    return s !== undefined && s > 1 ? s : 1;
  };
  /** The one `{sxz, sy}` `ER.emitMobLayer` multiplies in: the renderer scale times the creeper's
   *  swell (the creeper's renderer has no constant factor, so for it this is `creeperScale` alone). */
  // `EvokerFangsEntityRenderer.render`: rotateY(90 - yaw), scale(-s,-s,s), translate(0,-0.626,0),
  // scale(0.5) -- the living mirror, with the 0.626 lift taken inside the (s*0.5) scale, so the
  // emitter's scale k = s/2 and a lift of 0.626*s/k = 1.252 blocks.
  ER.FANGS_BASE = { flip: true, yOffsetFixed: 1.252 * CFG.MODEL_UNITS_PER_BLOCK };
  /** The emitter's yaw argument for a fang: its DEGREES yaw through `90 - yaw` (emitMobLayer rotates by -arg). */
  ER.fangsYaw = function (e) { return (e.yaw || 0) * DEG2RAD - Math.PI / 2; };
  ER.fangsScale = function (progress) { var k = NS.Spell.fangsScale(progress) / 2; return { sxz: k, sy: k }; };
  /** `EvokerFangsEntityModel.setAngles` as the emitter's `deltaFor` contract (rest rolls are 0, pivots 24). */
  ER.fangsAnim = function (progress) {
    var P = NS.Spell.fangsPose(progress);
    return { deltaFor: function (n) {
      return { rx: 0, ry: 0, rz: n === 'upper_jaw' ? P.upperRoll : n === 'lower_jaw' ? P.lowerRoll : 0, dpy: -P.lift };
    } };
  };

  ER.mobScale = function (e, partial) {
    var sw = ER.creeperScale(e, partial) || ER.slimeScale(e, partial);
    var r = ER.renderScaleOf(e, partial);
    var h = e && ER.RENDER_SCALE_XZ[e.type] || 1;
    var out = r === 1 ? sw : (sw ? { sxz: sw.sxz * r, sy: sw.sy * r } : { sxz: r, sy: r });
    if (h !== 1) out = out ? { sxz: out.sxz * h, sy: out.sy } : { sxz: h, sy: 1 };
    if (out) {
      var M = ER.MAX_MOB_SCALE;
      if (out.sxz > M || out.sy > M) out = { sxz: Math.min(out.sxz, M), sy: Math.min(out.sy, M) };
    }
    return out;
  };

  ER.emitMobLayer = function (out, o, layerName, ux, uy, uz, cosYaw, sinYaw, sky, blk, tile, anim, base, texKey, hurt, tintRGB, swellScale, hideParts, glintScale) {
    // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- `hideParts`: a {partName: 1} set of
    // part names to skip entirely, the RENDER half of `e.hasChest` (`Mnt.hideChestParts`,
    // 07r_mount.js) -- this table has no per-part visibility flag of its own
    // (`tools/golden/models-1.18.2.tsv`'s rows are static), so the emitter is handed the
    // name set to drop instead of a live `ModelPart.visible` bit. `undefined`/`null` (every
    // caller before this session, and every non-chestable mob) skips nothing, byte-for-byte
    // unchanged.
    var BE = NS.BEModel, M = NS.Mesher;
    var L = BE && BE.ready ? ER.boxLayerFor(layerName, texKey) : null;
    if (!L) return o;
    // ⚠⚠ **THE ENTITY-LEVEL BASE POSE — D-415.** See `ER.BASE` above. `bs` is +1 for a renderer
    // with no preamble and -1 for `LivingEntityRenderer`'s `scale(-1, -1, 1)`; `byo` is the
    // fixed-point Y translate that goes with it. Every mob drawn before this session got
    // `bs = +1, byo = 0` by omission, which is why a cow stood on its head.
    var bp = (base === undefined || base === null) ? ER.basePoseFor(layerName) : base;
    var bs = bp.flip ? -1 : 1, byo = bp.yOffsetFixed;
    // D-674: the renderer's scale() sits BEFORE translate(0,-1.501,0) (LivingEntityRenderer :95-96),
    // so the lift is scaled with the model — unscaled, a 1.2x wither skeleton sank into the floor.
    var byoS = swellScale ? byo * swellScale.sy : byo;
    var SCALE = CFG.MODEL_UNITS_PER_BLOCK / ER.MC_UNITS_PER_BLOCK;
    var parts = L.parts, c8 = new Float64Array(24), axisOut = new Float64Array(3);
    if (anim && anim.dragon && ER.modelKindOf(layerName) === 'ender_dragon') parts = ER.dragonExpandParts(parts);   // #1567
    var wx = [0, 0, 0, 0], wy = [0, 0, 0, 0], wz = [0, 0, 0, 0];
    var us = [0, 0, 0, 0], vs = [0, 0, 0, 0];
    var G = ER.mobGeomFor(layerName, texKey);   // D-469: texKey first, layerName the fallback
    var noCull = !!ER.NO_CULL[String(layerName).split('#')[0]];
    // D-503's OWED, CLOSED: the per-entity RGB tint channel, fed from the caller's own
    // `tintRGB` (a [0..1, 0..1, 0..1] triple, or falsy for "no tint"). Quantised to the 3-bit
    // eighths `packModelVertex`'s w3 bits 17-25 hold; `undefined` -> 7 -> the ×1.0 identity,
    // so a caller that never sets a tint draws exactly as before this channel existed.
    var er, eg, eb;
    if (tintRGB) {
      var qch = function (c) { return Math.max(0, Math.min(7, Math.round((c === undefined ? 1 : c) * 7))); };
      er = qch(tintRGB[0]); eg = qch(tintRGB[1]); eb = qch(tintRGB[2]);
    }
    var dhide = ER.DEFAULT_HIDDEN[layerName];
    var phide = ER.playerPartsHidden(layerName);
    var ihide = ER.illagerArmHide(layerName, anim ? anim.illager : null);   // no anim = CROSSED, vanilla's resting state
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k], gk = p.gk === undefined ? k : p.gk;   // gk: the part's slot in the layer's face-slice table (#1848: dragonExpandParts copies share one)
      if (hideParts && hideParts[p.n]) continue;
      if (dhide && dhide[p.n]) continue;
      if (phide && phide[p.n]) continue;
      if (p.n === 'egg_belly' && !(anim && anim.turtle && anim.turtle.belly)) continue;   // #1256 plastron.visible
      if (ihide && ihide[p.n]) continue;
      if (anim && anim.horse) {   // #1352 HorseEntityModel.setAngles/animateModel visibility
        var hz = anim.horse;
        if (ER.HORSE_SADDLE[p.n] && !hz.saddled) continue;
        if (ER.HORSE_STRAPS[p.n] && !(hz.saddled && hz.passengers)) continue;
        if (ER.HORSE_ADULT_LEGS[p.n] && hz.baby) continue;
        if (ER.HORSE_BABY_LEGS[p.n] && !hz.baby) continue;
      }
      if (anim && anim.bee && anim.bee.stung && p.n === 'stinger') continue;   // #4741 BeeEntityModel.animateModel
      if (anim && anim.fox && anim.fox.sleeping && ER.FOX_LEGS[p.n]) continue;   // #1284 FoxEntityModel: legs.visible = false asleep
      // GoatEntityModel.setAngles: left_horn/right_horn .visible = !isBaby()
      if (anim && anim.baby && (p.n === 'left_horn' || p.n === 'right_horn') && String(layerName).split('#')[0] === 'goat') continue;
      if (anim) {
        // ⚠ `anim.deltaFor` — a renderer that poses its parts by a rule of its OWN rather than
        // by `setupAnim`'s limb swing (D-421: a chest lid is `xRot = -(openness * PI/2)`, a
        // fact about a container's opener count, not about a walk cycle). It is the SAME
        // `{rx, ry, rz}` delta contract, added to the part's rest angles by the same code
        // below, so it grows no second emission path — the one thing this file's header says
        // not to do. `null` from it means "this part is not posed", exactly as `setupAnimDelta`
        // already means it.
        var d = anim.deltaFor ? anim.deltaFor(p.n)
              : ER.setupAnimDelta(p.n, anim.limbSwing, anim.limbSwingAmount, anim.netHeadYaw,
                                  anim.headPitch, anim.riding, ER.modelKindOf(layerName),
                                  // D-429: the zombie-arm layer needs the part's REST angles,
                                  // because it SETS all three rather than adding to them.
                                  // loop/renderres-s104: chicken/sheep read the SAME slot for
                                  // the SAME reason -- a mob-specific override that is not a
                                  // limb-swing formula.
                                  { zarm: ER.zombieArms(layerName), rest: p,
                                    biped: !!ER.BIPED_SWING[String(layerName).split('#')[0]], leftHanded: anim.leftHanded,
                                    ageInTicks: anim.ageInTicks, attackTime: anim.attackTime,
                                    aggressive: anim.aggressive, player: anim.player, enderman: anim.enderman, skelMelee: anim.skelMelee, skelBow: anim.skelBow, trident: anim.trident, drownedLp: anim.drownedLp, drownedSwim: anim.drownedSwim, spellcast: anim.spellcasting, illager: anim.illager ? { state: anim.illager, ageInTicks: anim.ageInTicks, attackTime: anim.attackTime, leftHanded: anim.leftHanded, mainEmpty: anim.mainEmpty, charge: anim.illagerCharge, rest: p } : null, vex: anim.vex,
                              phantomId: anim.phantomId, bee: anim.bee, squid: anim.squid, dragon: anim.dragon,
                                    chickenWingRoll: anim.chickenWingRoll, feline: anim.feline, fish: anim.fish,
                                    sheepEatGrass: anim.sheepEatGrass, panda: anim.panda, hoglin: anim.hoglin, witch: anim.witch, strider: anim.strider, axolotl: anim.axolotl, golem: anim.golem, headShake: anim.headShake, vleg: anim.vleg, slime: anim.slime, dolphin: anim.dolphin, guardian: anim.guardian, turtle: anim.turtle, rabbit: anim.rabbit, wolf: anim.wolf, fox: anim.fox, horse: anim.horse, parrot: anim.parrot, bat: anim.bat, baby: anim.baby,
                                    shulker: anim.shulker, wither: anim.wither, ravager: anim.ravager, polarBear: anim.polarBear,
                                    piglin: /^(piglin|piglin_brute)(#|$)/.test(String(layerName)), piglinMelee: anim.piglinMelee, piglinDance: anim.piglinDance,
                                    // #4002: same flag as fullyPosedPart's call -- `hat` is composed through PART_PARENT below, so no direct head turn on top
                                    hatComposed: !!ER.partParentOf(layerName, 'hat') });
        if (d) {
          // SHALLOW CLONE -- never mutate the shared BE.layers[name].parts entry in place
          // (D-317's table is read by the inventory-icon renderer and JOB 4.3's own static
          // pose too). `dpy` (loop/renderres-s104) is the ONE pivot-TRANSLATE delta this
          // contract carries, additive to `py` the same way `rx`/`ry`/`rz` are additive to the
          // rest rotation -- `SheepEntityModel.method_17120`'s `head.pivotY = 6 + neckAngle*9`
          // is exactly `rest.py (6, tools/golden/models-1.18.2.tsv) + neckAngle*9`, so ADDING
          // a delta here is the same assignment vanilla makes (`renderrescheck.mjs` asserts
          // that rest value rather than trusting the sentence, `ER.beLidAnim`'s own precedent
          // for the rotation case just above). `undefined` (every caller before this session)
          // is `|| 0`, byte-for-byte unchanged.
          p = { n: p.n, tu: p.tu, tv: p.tv, x: p.x, y: p.y, z: p.z, w: p.w, h: p.h, d: p.d,
                px: p.px + (d.dpx || 0), py: p.py + (d.dpy || 0), pz: p.pz + (d.dpz || 0),
                rx: p.rx + d.rx, ry: p.ry + d.ry, rz: p.rz + d.rz, m: p.m, g: p.g, gy: p.gy };
        }
      }
      // s134 -- a CHILD part (ModelPart.getChild: hoglin ears/horns under the head, mane under the
      // body) is posed in its parent's frame; the flattened table carries it with its parent-local
      // pivot, so it is composed here onto the parent's POSED transform (ER.PART_PARENT).
      var parName = ER.partParentOf(layerName, p.n);
      if (parName) {
        // D-KW -- was a single flat `composeChild(posedPart(par), p)`, which only reaches ONE
        // level up (fine for hoglin's 2-level chains, silently wrong for witch's 3-4 level
        // `head -> hat -> hat2 -> hat3 -> hat4`). `ER.fullyPosedPart` walks the WHOLE chain.
        var parPosed = ER.fullyPosedPart(parts, layerName, anim, parName);
        if (parPosed) p = ER.composeChild(parPosed, p);
      }
      var rects = BE.faceRects(p);
      for (var f = 0; f < 6; f++) {
        var idx = MOB_FACE_CORNERS[f], rc = rects[f];
        // ⚠⚠ THE WINDING IS DERIVED, NOT ASSUMED -- the same rule `emitcheck` holds the mesher
        // to (D-133/D-314): `cross(v1-v0, v2-v0)` must point the way the face's own outward
        // normal does. The normal itself (`nx/ny/nz`, `packFace`) is a fact about the FACE, not
        // any one slice of it -- same rotation, same plane -- so it is derived once per face,
        // outside the slice loop below.
        var n0 = NRM_OF_MESH[f];
        BE.poseAxis(p, n0[0], n0[1], n0[2], axisOut);
        // ⚠ THE NORMAL TAKES THE BASE POSE TOO (D-415). The composite map is a ROTATION
        // (det = +1: `diag(-1,-1,1)` is a 180-degree roll about Z, and a rotation times a
        // rotation is a rotation), so the normal transforms by the SAME matrix as a position
        // and the winding derivation below still works unchanged. Transform the position and
        // not the normal and every face of every mob is shaded as its opposite.
        // loop/vsleep -- a sleeping mob's normal takes `anim.sleepPose.R` (`ER.sleepMatrix`)
        // in place of the plain yaw rotation, for the SAME "the normal transforms by the same
        // matrix as a position" reason the comment above already gives; `R` is a real rotation
        // (a product of three axis rotations), so the winding derivation below still holds.
        var nx, ny, nz;
        if (anim && anim.sleepPose) {
          var SN = anim.sleepPose.R;
          nx = bs * (SN[0] * axisOut[0] + SN[1] * axisOut[1] + SN[2] * axisOut[2]);
          ny = bs * (SN[3] * axisOut[0] + SN[4] * axisOut[1] + SN[5] * axisOut[2]);
          nz = SN[6] * axisOut[0] + SN[7] * axisOut[1] + SN[8] * axisOut[2];
        } else if (anim && anim.shulkerBox) {
          // #887 -- ShulkerBoxBlockEntityRenderer: the normal takes the same chain as a vertex,
          // `Q * scale(1,-1,-1)` (the 0.9995 shrink is a positive uniform scale: no effect here).
          var BQ = anim.shulkerBox.R;
          var bx0 = axisOut[0], by0 = -axisOut[1], bz0 = -axisOut[2];
          nx = BQ[0] * bx0 + BQ[1] * by0 + BQ[2] * bz0;
          ny = BQ[3] * bx0 + BQ[4] * by0 + BQ[5] * bz0;
          nz = BQ[6] * bx0 + BQ[7] * by0 + BQ[8] * bz0;
        } else if (anim && anim.shulker) {
          // D-773 (tender-carson-7zokog) -- ShulkerEntityRenderer.setupTransforms: the attached
          // face's rotation sits BETWEEN the yaw and the base-pose flip, so it acts on the
          // already-flipped normal; the yaw (always vanilla bodyYaw 0 here) is applied after.
          var SQ = anim.shulker.R;
          var fx = bs * axisOut[0], fy = bs * axisOut[1], fz = axisOut[2];
          var qx = SQ[0] * fx + SQ[1] * fy + SQ[2] * fz;
          ny = SQ[3] * fx + SQ[4] * fy + SQ[5] * fz;
          var qz = SQ[6] * fx + SQ[7] * fy + SQ[8] * fz;
          nx = cosYaw * qx - sinYaw * qz; nz = sinYaw * qx + cosYaw * qz;
        } else if (anim && (anim.panda || anim.catPose)) {
          // #919 -- PandaEntityRenderer.setupTransforms' matrix acts between the flip and the yaw.
          var PR = (anim.panda || anim.catPose).pose.R, pfx = bs * axisOut[0], pfy = bs * axisOut[1], pfz = axisOut[2];
          var phx = PR[0] * pfx + PR[1] * pfy + PR[2] * pfz;
          ny = PR[3] * pfx + PR[4] * pfy + PR[5] * pfz;
          var phz = PR[6] * pfx + PR[7] * pfy + PR[8] * pfz;
          nx = cosYaw * phx + sinYaw * phz; nz = -sinYaw * phx + cosYaw * phz;
        } else if (anim && anim.roll) {
          var RC = ER.golemRollCS(anim.roll);
          var gx = bs * axisOut[0], gy = bs * axisOut[1];
          var hx = RC.c * gx - RC.s * gy;
          ny = RC.s * gx + RC.c * gy;
          nx = cosYaw * hx + bs * sinYaw * axisOut[2];
          nz = -bs * sinYaw * hx + cosYaw * axisOut[2];
        } else {
          nx = bs * (cosYaw * axisOut[0] + sinYaw * axisOut[2]); ny = bs * axisOut[1];
          nz = -sinYaw * axisOut[0] + cosYaw * axisOut[2];
        }
        var ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, az = nz < 0 ? -nz : nz;
        // ⚠ THE PACKED `face` IS THE BUCKETED WORLD NORMAL, NOT THE LOOP INDEX `f`. `f` still
        // picks the UV rectangle (and, below, which slice table to read) -- which physical face
        // of the box a texture region belongs to is a fact about the BOX, unaffected by how it
        // is posed -- but the packed vertex's `face` field drives per-face SHADING
        // (`Gfx.SHADE.FACE`), a fact about the WORLD, exactly the distinction `ER.emitPart`'s
        // own `m`-transform branch already draws for a spinning item, a few hundred lines up.
        var packFace = ay >= ax && ay >= az ? (ny >= 0 ? 2 : 3)
                     : ax >= az ? (nx >= 0 ? 0 : 1) : (nz >= 0 ? 4 : 5);
        // ⚠⚠ PASS 16 JOB 4.2's RENDER half. A face `mob-geometry.json` sliced into more than
        // one ≤16x16 atlas crop (D-376's packing, played on mob box faces a fourth time) draws
        // ONE QUAD PER SLICE, each against its OWN posed SUB-BOX -- trimmed along this face's
        // two ARCH axes the SAME way `tools/pack-mobtex.mjs`'s packing loop trimmed the SOURCE
        // pixels (`ARCH_AXES`/`SIZE_KEY`, both above the quad-count helpers, kept identical to
        // that file's own copy on purpose) -- and stamped with its OWN atlas tile+placement,
        // not the caller-supplied placeholder `tile`. A face with no slice table (the 32
        // overlay-only layers this session's packer could not resolve, or ANY face before a
        // caller ever supplies real texture data at all) falls back to exactly today's single
        // whole-face quad against the caller's `tile` -- nothing regresses for a layer this
        // session did not texture.
        var slices = G && G[gk] && G[gk][f];
        var nSlices = slices && slices.length;
        var subP = p, tileF = tile;
        var gl = glintScale ? ER.glintTile() : -1;   // #9239: the glint's own atlas tile replaces every slice's tile
        for (var si = 0; si < (nSlices || 1); si++) {
          if (nSlices) {
            var s = slices[si];
            var uAxis = ARCH_AXES[f][0], vAxis = ARCH_AXES[f][1];
            // SHALLOW CLONE, same rule as the anim clone above -- `p` (shared or already
            // anim-cloned) is never mutated in place.
            subP = { n: p.n, tu: p.tu, tv: p.tv, x: p.x, y: p.y, z: p.z, w: p.w, h: p.h, d: p.d,
                     px: p.px, py: p.py, pz: p.pz, rx: p.rx, ry: p.ry, rz: p.rz, m: p.m };
            // D-773 (beautiful-allen-7isws6): a slice at texture offset 0 sits at the LOW end
            // of the axis only where the face's texture runs toward +axis (`BE.faceDir`).
            var fd = BE.faceDir(f, p.m);
            // #633: slices are TEXEL ranges of the un-grown rect; a dilated box's extent is
            // stretched over them (kU/kV are exactly 1 for an undilated box).
            var kU = rc[2] > 0 ? p[SIZE_KEY[uAxis]] / rc[2] : 1, kV = rc[3] > 0 ? p[SIZE_KEY[vAxis]] / rc[3] : 1;
            subP[uAxis] = fd[0] > 0 ? p[uAxis] + s.u0 * kU : p[uAxis] + p[SIZE_KEY[uAxis]] - (s.u0 + s.w) * kU;
            subP[SIZE_KEY[uAxis]] = s.w * kU;
            subP[vAxis] = fd[1] > 0 ? p[vAxis] + s.v0 * kV : p[vAxis] + p[SIZE_KEY[vAxis]] - (s.v0 + s.h) * kV;
            subP[SIZE_KEY[vAxis]] = s.h * kV;
            tileF = s.tile;
            if (gl >= 0) { tileF = gl; BE.faceUV(f, p.m, s.su, s.sv, s.su + s.w, s.sv + s.h, us, vs); ER.glintUV(us, vs, glintScale); }
            else BE.faceUV(f, p.m, s.ox, s.oy, s.ox + s.w, s.oy + s.h, us, vs);
          } else {
            BE.faceUV(f, p.m, rc[0], rc[1], rc[0] + rc[2], rc[1] + rc[3], us, vs);
          }
          BE.poseBoxCorners(subP, c8);
          // G18e unit 2 — the baby transform, in the model's own space, before the base pose.
          if (anim && anim.baby) {
            var bt = ER.babyTransform(layerName, ER.partRootOf(layerName, p.n));
            if (bt) {
              for (var bi = 0; bi < 24; bi += 3) {
                c8[bi] = bt.s * c8[bi];
                c8[bi + 1] = bt.s * (c8[bi + 1] + bt.oy);
                c8[bi + 2] = bt.s * (c8[bi + 2] + bt.oz);
              }
            }
          }
          for (var c = 0; c < 4; c++) {
            var ci = idx[c] * 3;
            var lx = c8[ci] * SCALE, ly = c8[ci + 1] * SCALE, lz = c8[ci + 2] * SCALE;
            // loop/mobrender-s96 — `CreeperEntityRenderer.method_3900` (.decomp): `matrixStack.scale(sxz, sy,
            // sxz)`, applied in the model's own LOCAL space before the yaw rotate below. X and Z
            // share one factor, so (unlike a non-uniform scale) this commutes with the yaw
            // rotation two lines down and may be folded in here rather than needing its own
            // matrix stage — the caller (`ER.build`) is the only thing that ever sets this,
            // from `ER.creeperScale`, which reads the swell fraction `07zb_creeper.js`'s own
            // `Cr.swellFraction` already exposes (read-only: no fuse math is re-derived here).
            if (swellScale) { lx *= swellScale.sxz; ly *= swellScale.sy; lz *= swellScale.sxz; }
            // s133: a renderer translate (ER.RENDER_TRANSLATE) — x/z added to the box coordinates in the
            // model's own frame (the translate is the last matrix before the model), scaled like the lift.
            if (bp.zOffsetFixed || bp.xOffsetFixed) { var ts = swellScale ? swellScale.sxz : 1; lx += (bp.xOffsetFixed || 0) * ts; lz += (bp.zOffsetFixed || 0) * ts; }
            // loop/vsleep -- the same `anim.sleepPose.R` substitution as the normal above,
            // for the actual VERTEX position this time (`ER.sleepMatrix`'s own header: this is
            // `LivingEntityRenderer.setupTransforms`'s sleeping branch, .decomp lines 194-199,
            // standing in for the plain "rotate by yaw" branch below it does for every other
            // pose). `byo`/`bs` (D-415's base-pose flip+lift) apply exactly as before either
            // way -- that translate happens AFTER setupTransforms in vanilla's own render(),
            // unconditionally, so sleeping changes nothing about it.
            var rx, ry2, rz;
            if (anim && anim.sleepPose) {
              var SR3 = anim.sleepPose.R;
              rx = SR3[0] * lx + SR3[1] * ly + SR3[2] * lz;
              ry2 = SR3[3] * lx + SR3[4] * ly + SR3[5] * lz;
              rz = SR3[6] * lx + SR3[7] * ly + SR3[8] * lz;
              wx[c] = ux + Math.round(bs * rx); wy[c] = uy + Math.round(byoS + bs * ry2); wz[c] = uz + Math.round(rz);
            } else if (anim && anim.shulkerBox) {
              // #887 -- translate(.5,.5,.5); scale(.9995); multiply(facing quaternion); scale(1,-1,-1);
              // translate(0,-1,0) (ShulkerBoxBlockEntityRenderer.render). `ux/uy/uz` is the block centre.
              var BQ2 = anim.shulkerBox.R, bsc = anim.shulkerBox.s, U1 = CFG.MODEL_UNITS_PER_BLOCK;
              var bvx = lx, bvy = U1 - ly, bvz = -lz;
              wx[c] = ux + Math.round(bsc * (BQ2[0] * bvx + BQ2[1] * bvy + BQ2[2] * bvz));
              wy[c] = uy + Math.round(bsc * (BQ2[3] * bvx + BQ2[4] * bvy + BQ2[5] * bvz));
              wz[c] = uz + Math.round(bsc * (BQ2[6] * bvx + BQ2[7] * bvy + BQ2[8] * bvz));
            } else if (anim && anim.shulker) {
              // D-773 (tender-carson-7zokog) -- the same setupTransforms order as the normal
              // above: flip + lift first, then the face rotation about the block centre
              // (`translate(0,.5,0); multiply(q); translate(0,-.5,0)`), then the yaw.
              var SQ2 = anim.shulker.R, cY = NS.ShulkerDraw.FACE_CENTRE_Y * CFG.MODEL_UNITS_PER_BLOCK;
              var vx = bs * lx, vy = byoS + bs * ly - cY, vz = lz;
              var qx2 = SQ2[0] * vx + SQ2[1] * vy + SQ2[2] * vz;
              var qy2 = SQ2[3] * vx + SQ2[4] * vy + SQ2[5] * vz + cY;
              var qz2 = SQ2[6] * vx + SQ2[7] * vy + SQ2[8] * vz;
              wx[c] = ux + Math.round(cosYaw * qx2 - sinYaw * qz2); wy[c] = uy + Math.round(qy2);
              wz[c] = uz + Math.round(sinYaw * qx2 + cosYaw * qz2);
            } else if (anim && (anim.panda || anim.catPose)) {
              // #919 -- flip + lift, then the pose matrix (rotation + translate, blocks -> units), then yaw.
              var PM = (anim.panda || anim.catPose).pose, PR2 = PM.R, pU = CFG.MODEL_UNITS_PER_BLOCK;
              var pvx = bs * lx, pvy = byoS + bs * ly, pvz = lz;
              var pqx = PR2[0] * pvx + PR2[1] * pvy + PR2[2] * pvz + PM.t[0] * pU;
              var pqy = PR2[3] * pvx + PR2[4] * pvy + PR2[5] * pvz + PM.t[1] * pU;
              var pqz = PR2[6] * pvx + PR2[7] * pvy + PR2[8] * pvz + PM.t[2] * pU;
              wx[c] = ux + Math.round(cosYaw * pqx + sinYaw * pqz); wy[c] = uy + Math.round(pqy);
              wz[c] = uz + Math.round(-sinYaw * pqx + cosYaw * pqz);
            } else if (anim && anim.roll) {
              // #731 -- roll about Z after the flip+lift, before the yaw (setupTransforms order).
              var GC = ER.golemRollCS(anim.roll), gvx = bs * lx, gvy = byoS + bs * ly;
              var gqx = GC.c * gvx - GC.s * gvy, gqy = GC.s * gvx + GC.c * gvy;
              rx = cosYaw * gqx + bs * sinYaw * lz; rz = -bs * sinYaw * gqx + cosYaw * lz;
              wx[c] = ux + Math.round(rx); wy[c] = uy + Math.round(gqy); wz[c] = uz + Math.round(rz);
            } else {
              rx = bs * (cosYaw * lx + sinYaw * lz); rz = -sinYaw * lx + cosYaw * lz;
              wx[c] = ux + Math.round(rx); wy[c] = uy + Math.round(byoS + bs * ly); wz[c] = uz + Math.round(rz);
            }
          }
          var e1x = wx[1] - wx[0], e1y = wy[1] - wy[0], e1z = wz[1] - wz[0];
          var e2x = wx[2] - wx[0], e2y = wy[2] - wy[0], e2z = wz[2] - wz[0];
          var crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
          var order = (crx * nx + cry * ny + crz * nz) < 0 ? [3, 2, 1, 0] : [0, 1, 2, 3];
          // ⚠ `hurt` -> the packed vertex's `flag` bit (D-234's spare bit in w3, bit 16,
          // documented but unread by every shader until this session -- see 05_mesher.js's
          // `packModelVertex` doc and 10_gfx.js/11_gfx_webgpu.js/12_gfx_webgl2.js's vs_model).
          // `LivingEntityRenderer.getOverlay` (.decomp) packs `OverlayTexture.getV(hurtTime > 0
          // || deathTime > 0)` into every vertex of a hurt/dying living entity's OWN render
          // call, selecting the overlay texture's "hurt" row -- `OverlayTexture`'s constructor
          // (.decomp) bakes that row as ARGB `-1308622593` = 0xB20000FF, i.e. translucent
          // (alpha 178/255 ~= 0.7) pure red -- blended over the WHOLE mob for as long as
          // `hurtTime > 0` (`Cb.HURT_DURATION` = 10 ticks, 14j_combat.js). This is not a new
          // colour invented for this engine; it is that same red at that same weight, applied
          // the one way this mesher already tints a model vertex (multiplicatively, in the
          // fragment shader) rather than through a texture-sampled overlay this engine has no
          // slot for.
          var csw = texKey === 'creeper_armor' ? (1 << 26) : 0;   // #4402: w3 bit 26 in the swirl pass = CreeperChargeFeatureRenderer's x = f*0.01 (not the wither's cos*3)
          // #8082: getEyes is ONE,ONE but NON-scrolling: alpha field 31 in the additive bucket = static UV, full colour (shaders)
          var eyeA = texKey === 'dragon_exploding' ? ER.entityAlpha : /_eyes$/.test(texKey) ? 1 : gl >= 0 ? 30 / 31 : undefined;   // #9239: alpha field 30 = the glint scroll
          var hf = hurt ? 1 : 0, ew = (!hurt && swellScale) ? swellScale.white : 0;   // #2679: the hurt row wins (getOverlay's V)
          for (var w = 0; w < 4; w++) {
            var cc = order[w];
            o = M.packModelVertex(out, o, wx[cc], wy[cc], wz[cc], tileF,
              Math.round(us[cc] * 16), Math.round(vs[cc] * 16), packFace, 3, sky, blk, 0, 0, hf,
              er, eg, eb, eyeA, ew);
            out[o - 1] |= csw;
          }
          if (noCull) {
            // the back of the same face (ER.NO_CULL): reversed winding, the opposite bucket
            for (var wb = 3; wb >= 0; wb--) {
              var cb = order[wb];
              o = M.packModelVertex(out, o, wx[cb], wy[cb], wz[cb], tileF,
                Math.round(us[cb] * 16), Math.round(vs[cb] * 16), packFace ^ 1, 3, sky, blk, 0, 0, hf,
                er, eg, eb, eyeA, ew);
              out[o - 1] |= csw;
            }
          }
        }
      }
    }
    return o;
  };

  /**
   * Build a §8 buffer for ONE posed mob layer at a world position -- the standalone unit 4.3
   * proved. `ER.build`'s live per-frame loop (G18c step 1, this session) does NOT call this --
   * it inlines the same `ER.emitMobLayer` call directly into its own shared buffer, the same
   * way the item/state paths already do, because a per-mob buffer would be the second backend
   * path this file's own header says not to grow. This function stays for standalone callers
   * (checks, and any future one-off render) and is proven identical in shape to what the live
   * loop now emits, not a parallel untested path.
   *
   * `ex/ey/ez` are the entity's own world position; `ox/oy/oz` the draw origin every buffer in
   * a frame is relative to (as `ER.build`'s). `yaw` is radians. An entity past `ER.RANGE` is
   * refused -- the SAME guard `ER.visible` applies to everything else this file draws; a mob
   * gets no looser rule. Returns `{ buf, quads }` or null.
   */
  ER.buildMobLayer = function (layerName, ex, ey, ez, yaw, ox, oy, oz, sky, blk, tile, layerIdx, anim, hurt) {
    var M = NS.Mesher, U = CFG.MODEL_UNITS_PER_BLOCK;
    var dx = ex - ox, dy = ey - oy, dz = ez - oz;
    if (dx * dx + dy * dy + dz * dz > ER.RANGE * ER.RANGE) return null;
    var n = ER.mobQuadCount(layerName);
    if (!n) return null;
    var li = layerIdx || 0;
    var mQuads = [0, 0, 0];
    mQuads[li] = n;
    var buf = M.allocBuffer(0, 0, 0, mQuads);
    var hdr = M.readHeader(buf);
    var mOut = new Uint32Array(buf, hdr.modelOff[li], n * 16);
    var ux = Math.round(dx * U), uy = Math.round(dy * U), uz = Math.round(dz * U);
    ER.emitMobLayer(mOut, 0, layerName, ux, uy, uz, Math.cos(yaw), Math.sin(yaw),
                    sky === undefined ? 15 : sky, blk === undefined ? 0 : blk, tile || 0, anim,
                    undefined, undefined, hurt, undefined, undefined);
    return { buf: buf, quads: n };
  };

  /**
   * ⚠⚠ THE ASSERTION `git 2a8efe1:docs/passes/PASS-15-HISTORY.md` JOB 4.3 NAMES BY NAME: "A large mob's box on a distant
   * entity must still not reach it -- assert that." The worst absolute coordinate ANY vertex
   * of `layerName` reaches with the entity at exactly `ER.RANGE` blocks out, at the least
   * favourable yaw -- horizontally a box's own corner radius can point straight along the axis
   * the entity is already offset on (any rotation), so the true bound is the corner's XZ
   * radius, not its raw x or z component; vertically yaw does nothing, so it is the plain `y`.
   * Both get `ER.RANGE` blocks of draw-distance added in fixed point before comparing to the
   * i16 ceiling. `mobboxcheck.mjs` compares this to 32767 for every layer this engine ships.
   */
  ER.mobWorstCoord = function (layerName) {
    var BE = NS.BEModel, L = BE && BE.ready ? BE.layer(layerName) : null;
    if (!L) return 0;
    var SCALE = CFG.MODEL_UNITS_PER_BLOCK / ER.MC_UNITS_PER_BLOCK;
    var c8 = new Float64Array(24), worst = 0;
    var rangeFixed = ER.RANGE * CFG.MODEL_UNITS_PER_BLOCK;
    // ⚠ THE BASE POSE MOVES THE WORST VERTEX (D-415). A living mob's boxes are flipped and
    // lifted 1.501 blocks, so the Y a vertex actually reaches is `yOffsetFixed - ly`, not `ly`
    // — a model 24 units tall below the origin becomes one 384 fixed-point units ABOVE it. The
    // ceiling this function exists to defend is the i16 format's, so it must measure the
    // coordinate that is PACKED, not the one the box table happens to hold.
    var bp = ER.basePoseFor(layerName), bs = bp.flip ? -1 : 1, byo = bp.yOffsetFixed;
    var K = ER.layerScaleBound(layerName);
    for (var k = 0; k < L.parts.length; k++) {
      BE.poseBoxCorners(L.parts[k], c8);
      for (var i = 0; i < 8; i++) {
        // D-674: at the LARGEST scale the renderer can ever apply to this layer (`ER.layerScaleBound`)
        // — the lift scales with it (the renderer's scale() sits before the 1.501 translate).
        var lx = K * c8[i * 3] * SCALE, ly = K * (byo + bs * (c8[i * 3 + 1] * SCALE)), lz = K * c8[i * 3 + 2] * SCALE;
        var horiz = Math.sqrt(lx * lx + lz * lz) + rangeFixed;
        var vert = (ly < 0 ? -ly : ly) + rangeFixed;
        if (horiz > worst) worst = horiz;
        if (vert > worst) worst = vert;
      }
    }
    return worst;
  };

  // ── THE BLOCK ENTITIES IN THE WORLD (D-421) ─────────────────────────────────────────────
  //
  // ⚠⚠ **A PLACED CHEST WAS A HOLE IN THE WORLD, AND NOTHING SAID SO.** Measured, not assumed:
  // `Mesher.modelQuadCount` on the default state gives 6 for `stone` and **0** for `chest`,
  // `trapped_chest`, `ender_chest`, every bed, every banner, every sign and every shulker box.
  // Their block models are `builtin/entity` and bake no quads on purpose — vanilla draws them
  // from a BLOCK-ENTITY RENDERER, which this engine had never had. The chest SCREEN shipped
  // nine units ago (D-403..D-413); the chest itself was invisible the whole time, and every
  // check was green because no check ever asked what the world looked like where one stood.
  //
  // ⚠ **IT IS THE MOB PATH, NOT A NEW ONE.** `ER.emitMobLayer` already poses a hierarchy of
  // boxes from `BE.layers[name]` and stamps each face with its own atlas slice; a chest is
  // three boxes posed by exactly that. So this section decides WHICH layer, at WHAT yaw, with
  // WHAT lid angle — and hands all three to the emitter every mob already goes through. No
  // shader, no vertex format, no backend method, no second buffer (this file's header, twice).
  //
  // ⚠ **THE PIVOT IS THE BLOCK'S CENTRE AND THE EMITTER ROTATES ABOUT THE ORIGIN.** Vanilla:
  //     translate(0.5, 0.5, 0.5); mulPose(YP.rotationDegrees(-facing.toYRot())); translate(-0.5, -0.5, -0.5)
  // `ER.emitMobLayer` has no pivot argument — it rotates the model about its own origin — and
  // giving it one would change the signature every mob calls it through. It does not need one:
  // rotating about C instead of the origin is the SAME geometry translated by `C - R(C)`, and
  // `ux/uz` is a translation. So the origin is pushed by exactly that and the boxes come out
  // where vanilla puts them. `ER.beWorldOrigin` is that arithmetic, alone, so a check can ask
  // it directly instead of inferring it from a vertex.
  //
  // ⚠ **THE YAW IS `facing.toYRot()` UNNEGATED, AND THAT IS NOT A GUESS ABOUT THE SIGN.**
  // `ER.emitMobLayer(θ)` implements vanilla's `YP.rotationDegrees(-θ)` — D-415's own derivation,
  // which is why a mob is passed `yawMC - 180` to get vanilla's `180 - yawMC`. Vanilla's chest
  // wants `-f`, so this passes `+f`. The sign is CHECKED rather than argued: a chest's lock is
  // on its front face, so the lock's world centre must lie on the side the chest FACES, for all
  // four facings (`beworldcheck` §3), which a flipped sign fails on the spot.
  //
  // ⚠ **WHAT IS DRAWN IS A CLOSED LIST AND WHAT IS NOT IS NAMED** — `ER.OWED`'s own rule, one
  // file up, applied to block entities: `ER.BE_WORLD_OWED` carries every block-entity type that
  // still bakes no quads and gets no picture here, and `beworldcheck` FAILS if a type is in
  // neither table.
  // D-651 — `variant` is the chest MATERIAL (`TexturedRenderLayers.getChestTexture`): the packer's
  // family index, drawn as texKey "<layer>#<variant>" (0 = the layer's own base sheet).
  ER.BE_WORLD = {
    chest:         { layer: 'chest', lid: true, variant: 0 },
    trapped_chest: { layer: 'chest', lid: true, variant: 1 },
    ender_chest:   { layer: 'chest', lid: true, variant: 2 },
    // #887 -- ShulkerBoxBlockEntityRenderer: its own progress controller (`BE.tickShulkerBox`), a
    // lid that rises and turns, and the facing's full 6-way rotation. The sheet is the dye's.
    shulker_box:   { layer: 'shulker', lid: false, box: true },
    // #1172 -- BannerBlockEntityRenderer: standing (rotation 0-15) or wall pose, the dye-tinted base
    // and the pattern layers composited into a per-instance dynamic atlas slice (`ER.bannerTexKey`).
    banner:        { layer: 'banner', lid: false, banner: true },
    // #6392 -- BellBlockEntityRenderer: the bell_body model (body + base) on entity/bell/bell_body, no facing
    // (the frame is the block model's); only the ring swing turns it (`ER.bellAnim`).
    bell:          { layer: 'bell', lid: false, bell: true },
    // #5502 -- the packed BookModel (`book`, textures/entity/enchanting_table_book) in two renderers
    lectern:         { layer: 'book', lid: false, book: 'lectern' },
    enchanting_table: { layer: 'book', lid: false, book: 'enchant' },
    // #5499 -- ConduitBlockEntityRenderer: several layers a block, see `ER.conduitItems`
    conduit:         { layer: 'conduit', lid: false, conduit: true },
    // #6373 -- SignBlockEntityRenderer: the board and stick of `SignType` <wood> ("sign#<n>", ER.SIGN_WOODS order)
    sign:            { layer: 'sign', lid: false, sign: true },
    // #6372 -- BedBlockEntityRenderer: bed_head / bed_foot by PART, the dye's sheet by colour
    bed:             { layer: 'bed_head', lid: false, bed: true }
  };
  /** `SignType` registration order = the packed family: "sign" (oak), "sign#1" .. "sign#7" (`extract-mob-textures.mjs`). */
  ER.SIGN_WOODS = ['oak', 'spruce', 'birch', 'acacia', 'jungle', 'dark_oak', 'crimson', 'warped'];
  ER.SIGN_SCALE = 0.6666667;
  /** `DyeColor` ids in order: the block name's prefix -> the `shulker#(id+1)` sheet (Sh.skinKey's family). */
  ER.SHULKER_DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
                     'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  /** ShulkerBoxBlockEntityRenderer's lid: `setPivot(0, 24 - p*0.5*16, 0)`, `yaw = 270deg * p`; the
   *  lid's rest pivot is 24 and rest yaw 0 (`beworldcheck` asserts both), so the delta is `-p*8` / `270deg*p`. */
  ER.beShulkerAnim = function (p) {
    return { deltaFor: function (name) {
      return name === 'lid' ? { rx: 0, ry: 270 * p * (Math.PI / 180), rz: 0, dpy: -p * 0.5 * 16 } : null;
    } };
  };
  ER.SHULKER_BOX_SCALE = 0.9995;
  /** `ShulkerEntityModel.getParts()` is base + lid only: the head is not part of a box. */
  ER.SHULKER_BOX_HIDE = { head: 1 };
  /** #5574 -- `BeaconBlockEntityRenderer.render/renderBeam/renderBeamLayer/renderBeamFace` (.decomp). `segs` is
   *  `BE.tickBeacon`'s `[r,g,b,height]` list, `time` the world time, `pt` the partial tick. Returns the
   *  quads as flat vertices `[x,y,z,r,g,b,a,u,v]`, block-local (the +0.5 centre translate is applied):
   *  the inner prism (r 0.2, alpha 1, spun `12*2.25-45` degrees about Y) then the outer (0.25, alpha 0.125).
   *  The last segment is 1024 tall; `texture/entity/beacon_beam.png` scrolls by `frac(t*0.2 - floor(t*0.1))`. */
  ER.beaconBeamVerts = function (segs, time, pt, rIn, rOut, span) {
    var f = Math.fround, out = [], y0 = span ? span.y0 : 0;   // span: { y0, height } = renderBeam's yOffset / maxY (the gateway)
    rIn = rIn === undefined ? 0.2 : rIn; rOut = rOut === undefined ? 0.25 : rOut;
    for (var i = 0; i < segs.length; i++) {
      var sg = segs[i], h = span ? span.height : i === segs.length - 1 ? 1024 : sg[3];
      var t = f(((time % 40) + 40) % 40 + pt), tt = h < 0 ? t : -t;
      var q = f(tt * f(0.2)) - Math.floor(f(tt * f(0.1)));
      var v2 = f(-1 + (q - Math.floor(q))), y1 = y0 + h;
      var yaw = f(f(t * f(2.25)) - 45) * Math.PI / 180, cs = Math.cos(yaw), sn = Math.sin(yaw);
      var emit = function (cs4, a, spin, vv1) {
        var pairs = [[0, 1], [3, 2], [1, 3], [2, 0]];
        for (var k = 0; k < 4; k++) {
          var P = cs4[pairs[k][0]], Q = cs4[pairs[k][1]];
          var vs = [[P, y1, 1, 0], [P, y0, 1, 1], [Q, y0, 0, 1], [Q, y1, 0, 0]];
          for (var j = 0; j < 4; j++) {
            var x = vs[j][0][0], z = vs[j][0][1];
            if (spin) { var nx = x * cs + z * sn; z = -x * sn + z * cs; x = nx; }
            out.push([f(x + 0.5), vs[j][1], f(z + 0.5), sg[0], sg[1], sg[2], a, vs[j][2], vs[j][3] ? v2 : vv1]);
          }
        }
      };
      emit([[0, rIn], [rIn, 0], [-rIn, 0], [0, -rIn]], 1, true, f(h * f(0.5 / rIn) + v2));
      emit([[-rOut, -rOut], [rOut, -rOut], [-rOut, rOut], [rOut, rOut]], 0.125, false, f(h + v2));
      y0 = y1;
    }
    return out;
  };
  ER.beBoxAnim = function (it) {
    var a = ER.beShulkerAnim(it.beOpen);
    a.shulkerBox = it.beBox;
    return a;
  };

  /** A double chest's two halves are two DIFFERENT models, not one model drawn twice:
   *  `double_chest_left` for `type=left` and `double_chest_right` for `type=right`
   *  (`ChestRenderer`'s own branch, refereed off the jar this session — `ChestType.LEFT` takes
   *  `ModelLayers.DOUBLE_CHEST_LEFT`, anything else takes `DOUBLE_CHEST_RIGHT`). */
  ER.BE_WORLD_PAIR = { left: 'double_chest_left', right: 'double_chest_right' };

  /**
   * #1172 -- THE BANNER'S TEXTURE IS PER INSTANCE. `BannerBlockEntityRenderer` draws the pole and bar
   * with the plain base sheet and the FLAG with `renderCanvas`: the base dye x `entity/banner_base`,
   * then each pattern's texture x its dye, source-over (`BE.composite`). That picture exists only at
   * runtime, so the flag's faces are cloned off the packed `banner` slice table onto the dynamic tile
   * pool (`Atlas.dynTake/dynWrite`, #1329): every slice's crop of the composite is shelf-packed into
   * 16x16 layers and the clone is registered under the texKey "banner@<look>" - `ER.mobGeomFor`
   * finds it there, so the emitter needs no second path. Looks are shared (same dye + patterns = same
   * slice) and recycled least-recently-used; a look that cannot get tiles this frame is not drawn.
   */
  var bannerLooks = Object.create(null), bannerSerial = 0;
  ER.BANNER_SCALE = 0.6666667;
  function bannerFree_(key) {
    var L = bannerLooks[key], A = NS.Atlas, G = mobGeomTable_();
    if (!L) return;
    for (var i = 0; i < L.tiles.length; i++) A.dynFree(L.tiles[i]);
    if (G && G.layers) delete G.layers[key];
    delete bannerLooks[key];
  }
  ER.bannerClear = function () { for (var k in bannerLooks) bannerFree_(k); };
  /** The geometry key for banner dye `dye` (name) wearing `patterns` (the NBT list), or null when it cannot be drawn. */
  ER.bannerTexKey = function (dye, patterns) {
    var BE = NS.BEModel, A = NS.Atlas, G = mobGeomTable_();
    if (!BE || !BE.ready || !A || !A.dynTake || !A.dynTiles || !G || !G.layers || !G.layers.banner) return null;
    var layers = BE.patternLayers({ BlockEntityTag: { Patterns: patterns || [] } });
    var key = 'banner@' + dye;
    for (var i = 0; i < layers.length; i++) key += '|' + layers[i].tex + ':' + layers[i].rgb;
    var hit = bannerLooks[key];
    if (hit) { hit.used = bannerSerial; return key; }
    var rgb = BE.dye ? BE.dye[dye] : undefined, flagK = -1, parts = BE.layer('banner').parts;
    for (i = 0; i < parts.length; i++) if (parts[i].n === 'flag') flagK = i;
    if (rgb === undefined || flagK < 0) return null;
    var comp = BE.composite('be_banner', [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255], layers);
    if (!comp) return null;
    var rects = BE.faceRects(parts[flagK]), base = G.layers.banner, bufs = [], taken = [];
    var flag = [[], [], [], [], [], []], jobs = [], shelves = [];   // shelves: { b: tile index, y, h, x }
    var take = function () {
      var t = A.dynTake();
      if (t < 0) {   // recycle the least recently used look that is not on this frame's screen
        var oldest = null;
        for (var k in bannerLooks) if (bannerLooks[k].used < bannerSerial && (!oldest || bannerLooks[k].used < bannerLooks[oldest].used)) oldest = k;
        if (oldest) { bannerFree_(oldest); t = A.dynTake(); }
      }
      return t;
    };
    var fail = false;
    for (var f = 0; f < 6; f++) for (var si = 0; si < base[flagK][f].length; si++) jobs.push({ f: f, s: base[flagK][f][si] });
    // shelf packing, tallest first: a slice goes on the first shelf of its height class with room, else a new shelf
    jobs.sort(function (a, b) { return b.s.h - a.s.h || b.s.w - a.s.w; });
    for (var ji = 0; ji < jobs.length && !fail; ji++) {
      var s = jobs[ji].s, f2 = jobs[ji].f, sh = null, y, x;
      for (i = 0; i < shelves.length && !sh; i++) if (shelves[i].h >= s.h && shelves[i].x + s.w <= 16) sh = shelves[i];
      if (!sh) {
        var top = null;
        for (i = 0; i < shelves.length; i++) {
          var cap = 16 - (shelves[i].y + shelves[i].h);
          if (shelves[i].last && cap >= s.h && (!top || shelves[i].b < top.b)) top = shelves[i];
        }
        var b0, y0;
        if (top) { b0 = top.b; y0 = top.y + top.h; top.last = false; }
        else {
          var t = take();
          if (t < 0) { fail = true; break; }
          taken.push(t); bufs.push(new Uint8Array(16 * 16 * 4)); b0 = taken.length - 1; y0 = 0;
        }
        sh = { b: b0, y: y0, h: s.h, x: 0, last: true };
        shelves.push(sh);
      }
      x = sh.x; y = sh.y;
      var cu = Math.round(rects[f2][0] + s.u0), cv = Math.round(rects[f2][1] + s.v0), buf = bufs[sh.b];
      for (var yy = 0; yy < s.h; yy++) for (var xx = 0; xx < s.w; xx++) {
        var si4 = ((cv + yy) * comp.w + cu + xx) * 4, di = ((y + yy) * 16 + x + xx) * 4;
        buf[di] = comp.data[si4]; buf[di + 1] = comp.data[si4 + 1]; buf[di + 2] = comp.data[si4 + 2]; buf[di + 3] = comp.data[si4 + 3];
      }
      flag[f2].push({ si: base[flagK][f2].indexOf(s), u0: s.u0, v0: s.v0, w: s.w, h: s.h, tile: taken[sh.b], ox: x, oy: y });
      sh.x += s.w;
    }
    for (f = 0; f < 6; f++) flag[f].sort(function (a, b) { return a.si - b.si; });
    if (fail) { for (i = 0; i < taken.length; i++) A.dynFree(taken[i]); return null; }
    for (i = 0; i < taken.length; i++) A.dynWrite(taken[i], bufs[i]);
    var clone = base.slice();
    clone[flagK] = flag;
    G.layers[key] = clone;
    bannerLooks[key] = { tiles: taken, used: bannerSerial };
    return key;
  };
  ER.bannerBeginFrame = function () { bannerSerial++; };
  /** `BannerBlockEntityRenderer`'s flag sway: pitch `(-0.0125 + 0.01 cos(2pi t)) pi`, pivotY -32, `t` the
   *  position-phased 100-tick cycle. Delta contract: added to the flag's rest (`beworldcheck` asserts the rest). */
  ER.beBannerAnim = function (e, partial) {
    var T = (NS.Behave && NS.Behave.gameTime) | 0;
    var m = (((e.x * 7 + e.y * 9 + e.z * 13 + T) % 100) + 100) % 100;
    var pitch = (-0.0125 + 0.01 * Math.cos(Math.PI * 2 * ((m + (partial || 0)) / 100))) * Math.PI;
    var rest = null, ps = NS.BEModel.layer('banner').parts;
    for (var i = 0; i < ps.length; i++) if (ps[i].n === 'flag') rest = ps[i];
    return { deltaFor: function (name) {
      return name === 'flag' ? { rx: pitch - rest.rx, ry: 0, rz: 0, dpy: -32 - rest.py } : null;
    } };
  };

  /** #6392 -- `BellBlockEntityRenderer.render`: while ringing, t = ticks + partial and
   *  s = sin(t / PI) / (4 + t / 3); north -> pitch -s, south -> +s, east -> roll -s, west -> +s.
   *  Rests at 0. The BE keeps `e.ticks` / `e.ringing` (+ `e.lastSideHit`, a direction name, when known). */
  ER.bellAnim = function (e, partial) {
    var rx = 0, rz = 0;
    if (e && e.ringing) {
      var t = (e.ticks | 0) + (partial || 0), s = Math.sin(t / Math.PI) / (4 + t / 3);
      var d = e.lastSideHit;
      if (d === 'north') rx = -s; else if (d === 'south') rx = s; else if (d === 'east') rz = -s; else if (d === 'west') rz = s;
    }
    var f = function (name) { return name === 'bell_body' ? { rx: rx, ry: 0, rz: rz } : null; };
    return { deltaFor: f };
  };

  /** D-651 — `ChestBlockEntityRenderer`'s constructor (.decomp:46-49): December 24..26 on the
   *  player's own clock swaps every non-ender chest to the Christmas sheet. Vanilla reads the
   *  calendar ONCE, when the renderer is built; so does this (cached on first ask).
   *  `ER.christmasOverride` (true/false) is the check's handle; null = the real clock. */
  ER.christmasOverride = null;
  var christmas_ = null;
  ER.isChristmasDate = function (d) {
    return d.getMonth() + 1 === 12 && d.getDate() >= 24 && d.getDate() <= 26;
  };
  ER.chestChristmas = function () {
    if (ER.christmasOverride !== null) return ER.christmasOverride;
    if (christmas_ === null) christmas_ = ER.isChristmasDate(new Date());
    return christmas_;
  };

  /**
   * ⚠ NAMED, NOT SILENTLY ABSENT. Two kinds of entry, told apart on purpose:
   *   (a) NO PICTURE AT ALL — the block bakes no quads and nothing here draws it either, so it
   *       is still a hole. Each names the stage that closes it, the way `ER.OWED` does.
   *   (b) DRAWN, BUT NOT WITH ITS OWN SHEET — none left: D-651 packed the chest materials as a
   *       family ("chest#1" trapped, "chest#2" ender, "double_chest_*#1" trapped double) and
   *       `ER.BE_WORLD[type].variant` picks the member (`beworldcheck` §5), with vanilla's
   *       24-26 December Christmas swap (`ER.chestChristmas`, "chest#3"/"double_chest_*#2").
   */
  ER.BE_WORLD_OWED = [];

  /**
   * #591 -- THE SIX SKULLS IN THE WORLD (`SkullBlockEntityRenderer.render`, .decomp, read whole).
   *   rotation = 22.5 * (wall ? (2 + facing.getHorizontal()) * 4 : state.ROTATION)      // degrees
   *   translate(0.5, 0, 0.5)                                    // standing
   *   translate(0.5 - fx * 0.25, 0.25, 0.5 - fz * 0.25)         // wall, `fx/fz` the facing's offset
   *   scale(-1, -1, 1); head.yaw = rotation; head.pitch = 0
   * `getHorizontal()` is south 0, west 1, north 2, east 3. The head's own yaw is a rotation about the
   * model origin, which is the pivot the mob emitter turns about too, and `diag(-1,-1,1)` is exactly
   * `ER.BASE_MIRROR`, so nothing here needs a second emission path. The dragon's model adds
   * `translate(0, -0.374375, 0); scale(0.75)` inside that (`DragonHeadEntityModel.render`).
   */
  ER.SKULL_BLOCKS = {
    skeleton_skull: ['skeleton_skull', 0], skeleton_wall_skull: ['skeleton_skull', 1],
    wither_skeleton_skull: ['wither_skeleton_skull', 0], wither_skeleton_wall_skull: ['wither_skeleton_skull', 1],
    zombie_head: ['zombie_head', 0], zombie_wall_head: ['zombie_head', 1],
    player_head: ['player_head', 0], player_wall_head: ['player_head', 1],
    creeper_head: ['creeper_head', 0], creeper_wall_head: ['creeper_head', 1],
    dragon_head: ['dragon_head', 0], dragon_wall_head: ['dragon_head', 1]
  };
  ER.SKULL_HORIZONTAL = { south: 0, west: 1, north: 2, east: 3 };
  ER.SKULL_YAW_SIGN = 1;
  ER.SKULL_DRAGON_SCALE = { sxz: 0.75, sy: 0.75 };
  /** The head yaw in DEGREES and the model origin (block-relative) of the skull block state `st`, or null. */
  ER.skullPose = function (st) {
    var SR = NS.States, R = NS.Reg;
    if (!SR || !R || !R.PROP || !(st > 0)) return null;
    var name = SR.name ? SR.name(st) : '';
    var rule = ER.SKULL_BLOCKS[name];
    if (!rule) return null;
    var layer = rule[0], wall = rule[1] === 1, deg, ox = 0.5, oy = 0, oz = 0.5;
    if (wall) {
      var f = R.valueNames[SR.propValue(st, R.PROP.facing)];
      var h = ER.SKULL_HORIZONTAL[f];
      if (h === undefined) return null;
      var fx = f === 'east' ? 1 : f === 'west' ? -1 : 0, fz = f === 'south' ? 1 : f === 'north' ? -1 : 0;
      deg = 22.5 * ((2 + h) * 4);
      ox = 0.5 - fx * 0.25; oy = 0.25; oz = 0.5 - fz * 0.25;
    } else {
      deg = 22.5 * (parseInt(R.valueNames[SR.propValue(st, R.PROP.rotation)], 10) | 0);
    }
    return { layer: layer, deg: deg, ox: ox, oy: oy, oz: oz, dragon: layer === 'dragon_head' };
  };
  ER.SKULL_DRAGON_BASE = { flip: true, yOffsetFixed: 0.374375 / 0.75 * CFG.MODEL_UNITS_PER_BLOCK };

  /**
   * `Direction.toYRot()`, in RADIANS — south 0, west 90, north 180, east 270. Vanilla's own
   * numbers; a chest's default facing is north, which is why an unrotated chest model has its
   * lock on +Z and a north-facing one ends up with it on −Z.
   */
  ER.beYRot = function (V, facing) {
    if (facing === V.south) return 0;
    if (facing === V.west) return Math.PI * 0.5;
    if (facing === V.north) return Math.PI;
    if (facing === V.east) return Math.PI * 1.5;
    return 0;
  };

  /**
   * `ChestRenderer`'s own openness curve, off the bytecode:
   *     o = lidController.getOpenness(partial);  o = 1 - o;  o = 1 - o*o*o;
   * then `lid.xRot = lock.xRot = -(o * PI/2)`. ⚠ The CUBE is the whole character of the motion:
   * the lid leaves the closed position fast and eases into open. A linear lid is a wrong lid,
   * and it is wrong in a way only three sampled values can catch, which is what the check takes.
   */
  ER.beLidAngle = function (openness) {
    var o = 1 - openness;
    o = 1 - o * o * o;
    return -(o * Math.PI * 0.5);
  };

  /** The `{rx,ry,rz}` delta contract `ER.emitMobLayer` already understands, for a chest lid.
   *  ⚠ The lid's and the lock's REST `rx` are both 0 in the jar's own box table, so ADDING this
   *  delta is identical to vanilla ASSIGNING `xRot` — `beworldcheck` §2 asserts that rest angle
   *  rather than trusting the sentence. */
  ER.beLidAnim = function (openness) {
    var rx = ER.beLidAngle(openness);
    return { deltaFor: function (name) {
      return (name === 'lid' || name === 'lock') ? { rx: rx, ry: 0, rz: 0 } : null;
    } };
  };

  /** The emission origin that makes `ER.emitMobLayer` rotate about the BLOCK CENTRE: the block
   *  corner plus `C - R(C)`, `C = (0.5, ·, 0.5)`, `R` the emitter's own rotation. Y is untouched
   *  — the rotation is about Y, so the centre's Y never moves. */
  ER.beWorldOrigin = function (bx, by, bz, cosYaw, sinYaw, out) {
    var rcx = cosYaw * 0.5 + sinYaw * 0.5, rcz = -sinYaw * 0.5 + cosYaw * 0.5;
    out[0] = bx + 0.5 - rcx; out[1] = by; out[2] = bz + 0.5 - rcz;
    return out;
  };

  /**
   * Which layer, yaw and lid angle one block entity is drawn with, or null when this engine has
   * no picture for it (everything in that case is on `ER.BE_WORLD_OWED`).
   */
  /**
   * #5501 -- CampfireBlockEntityRenderer.render (.decomp, read whole), per non-empty slot i:
   *   translate(0.5, 0.44921875, 0.5); Ry(-dir.asRotation()) with dir = fromHorizontal((i + facing.h) % 4);
   *   Rx(90); translate(-0.3125, -0.3125, 0); scale(0.375); item in GROUND mode (sprite: ty 2/16, scale 0.5).
   * Returns the `ER.build` 'arrow'-shape entries (an explicit matrix, no spin/lift). Empty slots draw nothing.
   */
  ER.CAMPFIRE_ROT = [0, 90, 180, 270];   // Direction.asRotation() by horizontal index: south west north east
  ER.campfireItems = function (e, st) {
    var out = [], SR = NS.States, R = NS.Reg;
    if (!e || !e.items || !st || !SR || !R || !R.PROP) return out;
    var fh = { south: 0, west: 1, north: 2, east: 3 }[R.valueNames[SR.propValue(st, R.PROP.facing)]];
    if (fh === undefined) return out;
    var G = ER.GROUND_SPRITE, K = 0.375;
    for (var i = 0; i < 4; i++) {
      var stack = e.items[i];
      if (!stack || !(stack.n > 0)) continue;
      var sp = ER.spritesFor({ item: stack, count: 1 });
      if (!sp) continue;
      var a = -ER.CAMPFIRE_ROT[(i + fh) % 4] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      var Ry = [c, 0, s, 0, 1, 0, -s, 0, c], Rx = [1, 0, 0, 0, 0, -1, 0, 1, 0];
      var B = m3mul(Ry, Rx);
      var o = m3v(B, [-0.3125, -0.3125 + K * G.ty, 0]);
      out.push({ e: e, state: 0, x: e.x + 0.5 + o[0], y: e.y + 0.44921875 + o[1], z: e.z + 0.5 + o[2], shape: 'arrow',
                 layer: sp.layer, sprites: sp.parts, copies: [[0, 0, 0]], flatSprite: true, mobLayer: null,
                 m: m3mul(B, [K * G.scale, 0, 0, 0, K * G.scale, 0, 0, 0, K * G.scale]), campfireSlot: i });
    }
    return out;
  };

  /** Rodrigues: the 3x3 turn of `deg` degrees about the unit axis `a` (`Vec3f.getDegreesQuaternion`). */
  function axisAngle3(a, deg) {
    var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c, x = a[0], y = a[1], z = a[2];
    return [c + x * x * k, x * y * k - z * s, x * z * k + y * s,
            y * x * k + z * s, c + y * y * k, y * z * k - x * s,
            z * x * k - y * s, z * y * k + x * s, c + z * z * k];
  }
  function scale3(m, k) { var o = []; for (var i = 0; i < 9; i++) o.push(m[i] * k); return o; }
  /**
   * #5499 -- ConduitBlockEntityRenderer.render (.decomp, read whole). Inactive: the base shell turned
   * `getRotation(0)` about Y at the block centre. Active: cage (bobbing, spun about (0.5,1,0.5)), two wind
   * cubes (`ticks / 66 % 3` picks wind / vertical wind / wind turned about Z; the inner one 0.875 and
   * flipped) and the eye, billboarded to the camera and scaled 0.5 * 4/3. `.m` is each part's whole-model
   * matrix; `.key` names the part. ⚠ The rotation is `-0.0375` rad per active tick (`BE.conduitRotation`,
   * the decomp's own), not the 0.0125 the issue text quoted. Wind frames (the sheet is animated): owed.
   */
  ER.conduitParts = function (e, partial, cam) {
    var BEs = NS.BlockEntities, out = [], p = partial || 0;
    var ticks = e.ticks || 0, t = Math.fround(ticks + p);
    if (!e.active) {
      var r0 = BEs.conduitRotation(e, 0) * 180 / Math.PI;
      out.push({ key: 'base', layer: 'conduit', texKey: null, m: rotY(r0), o: [0.5, 0.5, 0.5] });
      return out;
    }
    var deg = BEs.conduitRotation(e, p) * 180 / Math.PI;
    var sn = Math.sin(t * 0.1) / 2 + 0.5; sn = sn * sn + sn;
    var by = 0.3 + sn * 0.2, ax = [0.5, 1, 0.5], al = Math.sqrt(1.5);
    ax = [ax[0] / al, ax[1] / al, ax[2] / al];
    out.push({ key: 'cage', layer: 'conduit_cage', texKey: null, m: axisAngle3(ax, deg), o: [0.5, by, 0.5] });
    var ph = ((ticks / 66) | 0) % 3, wk = ph === 1 ? 'conduit_wind#1' : null;
    var w1 = ph === 1 ? rotX(90) : ph === 2 ? rotZ(90) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    out.push({ key: 'wind', layer: 'conduit_wind', texKey: wk, m: w1, o: [0.5, 0.5, 0.5] });
    out.push({ key: 'wind2', layer: 'conduit_wind', texKey: wk, m: scale3(mulMat3(rotX(180), rotZ(180)), 0.875), o: [0.5, 0.5, 0.5] });
    var c = cam || { yaw: 0, pitch: 0 };
    var me = mulMat3(mulMat3(mulMat3(rotY(-c.yaw), rotX(c.pitch)), rotZ(180)), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    out.push({ key: 'eye', layer: 'conduit_eye', texKey: e.eyeOpen ? null : 'conduit_eye#1',
               m: scale3(me, 0.5 * 1.3333334), o: [0.5, by, 0.5] });
    return out;
  };
  ER.conduitItems = function (e, partial) {
    var P = NS.Player, cam = P && P.yaw !== undefined ? { yaw: P.yaw * 180 / Math.PI, pitch: -P.pitch * 180 / Math.PI } : null;
    var ps = ER.conduitParts(e, partial, cam), out = [];
    for (var i = 0; i < ps.length; i++) {
      var q = ps[i];
      out.push({ layer: q.layer, yaw: 0, openness: 0, texKey: q.texKey, base: ER.BASE_NONE, conduitKey: q.key,
                 raw: [e.x + q.o[0], e.y + q.o[1], e.z + q.o[2]],
                 anim: { sleepPose: { R: q.m, dx: 0, dy: 0, dz: 0 }, deltaFor: function () { return null; } } });
    }
    return out;
  };

  /**
   * #6372 -- BedBlockEntityRenderer.renderPart (.decomp): translate(0, 0.5625, 0); Rx(90); translate(.5,.5,.5);
   * Rz(180 + facing.asRotation()); translate(-.5,-.5,-.5) (the foot's -1 z is the item path's only). The whole
   * chain is M = Rx(90) Rz(180 + rot) about the block centre, so the origin is T0 + Rx(90)(C - Rz C), the same
   * pivot-in-the-origin trick as `ER.beWorldOrigin`; M rides `anim.sleepPose.R` like the book's. The sheet is
   * the dye id's: `bed_head#id` (0 = the layer's own sheet). Drawn through `entitySolid`: no cutout.
   */
  ER.bedPose = function (rotDeg) {
    var Rz = rotZ(180 + rotDeg), X = rotX(90), C = [0.5, 0.5, 0.5];
    var rc = [Rz[0] * C[0] + Rz[1] * C[1] + Rz[2] * C[2], Rz[3] * C[0] + Rz[4] * C[1] + Rz[5] * C[2], Rz[6] * C[0] + Rz[7] * C[1] + Rz[8] * C[2]];
    var d = [C[0] - rc[0], C[1] - rc[1], C[2] - rc[2]];
    return { R: mulMat3(X, Rz), o: [X[0] * d[0] + X[1] * d[1] + X[2] * d[2],
                                    0.5625 + X[3] * d[0] + X[4] * d[1] + X[5] * d[2],
                                    X[6] * d[0] + X[7] * d[1] + X[8] * d[2]] };
  };
  ER.bedItem = function (e, st) {
    var SR = NS.States, R = NS.Reg, P_ = R.PROP, V = R.PVAL;
    var m = /^(\w+)_bed$/.exec(SR.name ? SR.name(st) : '');
    if (!m) return null;
    var dye = ER.SHULKER_DYES.indexOf(m[1]);
    if (dye < 0) return null;
    var head = SR.propValue(st, P_.part) === V.head;
    var pose = ER.bedPose(ER.BOOK_REST_ROT[R.valueNames[SR.propValue(st, P_.facing)]] || 0);
    return { layer: head ? 'bed_head' : 'bed_foot', yaw: 0, openness: 0, texKey: dye ? (head ? 'bed_head#' : 'bed_foot#') + dye : null,
             base: ER.BASE_NONE, bedDye: dye, bedPart: head ? 'head' : 'foot', bedRot: pose.R,
             anim: { sleepPose: { R: pose.R, dx: 0, dy: 0, dz: 0 }, deltaFor: function () { return null; } },
             raw: [e.x + pose.o[0], e.y + pose.o[1], e.z + pose.o[2]] };
  };

  ER.beWorldItem = function (e, partial) {
    var SR = NS.States, R = NS.Reg, W = NS.World, BEs = NS.BlockEntities;
    if (!e || !SR || !R || !R.PROP || !W) return null;
    var st = W.getBlock(e.x, e.y, e.z);
    if (!st || SR.block[st] === undefined) return null;
    if (e.type === 'skull') {
      var sk = ER.skullPose(st);
      if (!sk) return null;
      // #591: `renderSkull`'s model turn is `Ry(head yaw)` under `scale(-1,-1,1)`; ER.SKULL_YAW_SIGN is
      // what the emitter's own yaw convention makes of that (`skullcheck` measures it on the front face)
      var a = ER.SKULL_YAW_SIGN * sk.deg * Math.PI / 180;
      return { layer: sk.layer, yaw: a, openness: 0, texKey: null, raw: [e.x + sk.ox, e.y + sk.oy, e.z + sk.oz],
               base: sk.dragon ? ER.SKULL_DRAGON_BASE : ER.BASE_MIRROR, scale: sk.dragon ? ER.SKULL_DRAGON_SCALE : null };
    }
    var rule = ER.BE_WORLD[e.type];
    if (!rule) return null;
    var P_ = R.PROP, V = R.PVAL;
    if (rule.box) {
      var sname = SR.name ? SR.name(st) : '';
      if (!/shulker_box$/.test(sname)) return null;
      var dye = sname === 'shulker_box' ? -1 : ER.SHULKER_DYES.indexOf(sname.replace(/_shulker_box$/, ''));
      var fdir = R.valueNames[SR.propValue(st, P_.facing)];
      var di = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 }[fdir];
      if (di === undefined) di = 1;   // Direction.UP when the block is not a shulker box's
      var prog = BEs && BEs.shulkerProgress ? BEs.shulkerProgress(e, partial) : 0;
      return { layer: rule.layer, yaw: 0, openness: prog, texKey: dye < 0 ? null : 'shulker#' + (dye + 1),
               raw: [e.x + 0.5, e.y + 0.5, e.z + 0.5], base: ER.BASE_NONE,
               box: { R: NS.ShulkerDraw.faceMatrix(di ^ 1), s: ER.SHULKER_BOX_SCALE } };
    }
    if (rule.banner) {
      var bname = SR.name ? SR.name(st) : '';
      var bm = /^(\w+?)_(wall_)?banner$/.exec(bname);
      if (!bm) return null;
      var bkey = ER.bannerTexKey(bm[1], e.patterns);
      if (!bkey) return null;
      // BannerBlockEntityRenderer: scale(.667,-.667,-.667) is Rx(pi); the emitter's flip base is Rz(pi) under
      // a yaw of -theta, so Ry(a) Rx(pi) = Ry(a+pi) Rz(pi) is theta = -(a + pi).
      var ba, bo;
      if (bm[2]) {
        var bf = R.valueNames[SR.propValue(st, P_.facing)];
        ba = -(({ south: 0, west: 90, north: 180, east: 270 })[bf] || 0) * Math.PI / 180;
        bo = [e.x + 0.5 - 0.4375 * Math.sin(ba), e.y - 0.1666667 - 0.3125, e.z + 0.5 - 0.4375 * Math.cos(ba)];
      } else {
        ba = -(parseInt(R.valueNames[SR.propValue(st, P_.rotation)], 10) | 0) * 22.5 * Math.PI / 180;
        bo = [e.x + 0.5, e.y + 0.5, e.z + 0.5];
      }
      return { layer: 'banner', yaw: -(ba + Math.PI), openness: 0, texKey: bkey, raw: bo, base: ER.BASE_MIRROR,
               scale: { sxz: ER.BANNER_SCALE, sy: ER.BANNER_SCALE }, hide: bm[2] ? { pole: 1 } : null,
               anim: ER.beBannerAnim(e, partial) };
    }
    if (rule.sign) {
      var gname = SR.name ? SR.name(st) : '';
      var gm = /^(\w+?)_(wall_)?sign$/.exec(gname), gw = gm ? ER.SIGN_WOODS.indexOf(gm[1]) : -1;
      if (gw < 0) return null;
      // SignBlockEntityRenderer: Ry(-rotation*22.5) (standing) or Ry(-facing.asRotation()) then T(0,-.3125,-.4375)
      // (wall), under scale(.667,-.667,-.667) = Rx(pi): the banner's own pose, so the banner's yaw algebra.
      var ga, go;
      if (gm[2]) {
        var gf = R.valueNames[SR.propValue(st, P_.facing)];
        ga = -(({ south: 0, west: 90, north: 180, east: 270 })[gf] || 0) * Math.PI / 180;
        go = [e.x + 0.5 - 0.4375 * Math.sin(ga), e.y + 0.5 - 0.3125, e.z + 0.5 - 0.4375 * Math.cos(ga)];
      } else {
        ga = -(parseInt(R.valueNames[SR.propValue(st, P_.rotation)], 10) | 0) * 22.5 * Math.PI / 180;
        go = [e.x + 0.5, e.y + 0.5, e.z + 0.5];
      }
      return { layer: 'sign', yaw: -(ga + Math.PI), openness: 0, texKey: gw ? 'sign#' + gw : null, raw: go, base: ER.BASE_MIRROR,
               scale: { sxz: ER.SIGN_SCALE, sy: ER.SIGN_SCALE }, hide: gm[2] ? { stick: 1 } : null };
    }
    if (rule.bed) return ER.bedItem(e, st);
    if (rule.book) return ER.bookItem(e, st, rule.book, partial);
    if (rule.bell) return { layer: 'bell', yaw: 0, openness: 0, texKey: null, anim: ER.bellAnim(e, partial) };
    var layer = rule.layer;
    // ⚠ A DOUBLE CHEST IS READ OFF THE BLOCK STATE, NOT OFF THE MENU. `Hud.chestPair` answers
    // "which container did the player open"; this answers "what does this cell look like", and
    // the two must not be the same call — a double chest is two halves whether or not anybody
    // has ever opened it.
    var type = SR.propValue(st, P_.type);
    if (type === V.left) layer = ER.BE_WORLD_PAIR.left;
    else if (type === V.right) layer = ER.BE_WORLD_PAIR.right;
    // ⚠⚠ **NEGATED, AND THE SIGN WAS MEASURED, NOT REASONED.** `ER.beYRot` is vanilla's own
    // `Direction.toYRot()`; the emitter's rotation is `Ry(+θ)` while vanilla's chest does
    // `mulPose(YP.rotationDegrees(-f))`, so the emitter wants `-f`. The first version of this
    // line passed `+f` and was green on north and south — a 180-degree error is invisible on the
    // axis it mirrors — and put the lock of an east-facing chest on its west face.
    // `beworldcheck` §3 tests all FOUR facings for exactly that reason (D-330: assert in both
    // directions; a two-case test of a four-case fact is a coin toss that passed).
    var yaw = -ER.beYRot(V, SR.propValue(st, P_.facing));
    var open = rule.lid && BEs && BEs.lidOpenness ? BEs.lidOpenness(e, partial) : 0;
    // D-651 — the material's own sheet: trapped/ender/christmas are family members of the SAME
    // geometry, picked the way `TexturedRenderLayers.getChestTexture` picks: ender first, then
    // the Christmas swap, then trapped/normal.
    var vr = rule.variant;
    if (rule.lid && e.type !== 'ender_chest' && ER.chestChristmas()) vr = (layer === 'chest') ? 3 : 2;
    var texKey = vr ? layer + '#' + vr : null;
    return { layer: layer, yaw: yaw, openness: open, texKey: texKey };
  };

  /**
   * #5502 -- LecternBlockEntityRenderer + EnchantingTableBlockEntityRenderer, one packed BookModel.
   *   lectern (only HAS_BOOK): T(.5,1.0625,.5) Ry(-facing.rotateYClockwise().asRotation()) Rz(67.5) T(0,-.125,0),
   *     setPageAngles(0, 0.1, 0.9, 1.2)
   *   table: T(.5,.75,.5) T(0, 0.1 + sin(t*.1)*.01, 0) Ry(-yaw) Rz(80), page angles from the entity's own
   *     tick (EnchantingTableBlockEntity.tick, java Random). The whole-model matrix rides `anim.sleepPose.R`
   *     (the one slot every whole-model turn here uses); the inner translate is folded into the origin as R*t.
   */
  ER.BOOK_REST_ROT = { south: 0, west: 90, north: 180, east: 270 };
  ER.bookPlayer = function () { var P = NS.Player; return P && P.ex !== undefined ? { x: P.ex, y: P.ey, z: P.ez } : null; };
  /** One `EnchantingTableBlockEntity.tick` (client); `pl` = {x, z} of the player within 3 blocks, or null. */
  ER.bookTick = function (e, pl) {
    var PI = Math.PI, TAU = PI * 2;
    e.pageTurningSpeed = e.nextPageTurningSpeed;
    e.fl3 = e.fl4;
    if (pl) {
      e.fl2 = Math.atan2(pl.z - (e.z + 0.5), pl.x - (e.x + 0.5));
      e.nextPageTurningSpeed += 0.1;
      if (e.nextPageTurningSpeed < 0.5 || e.bookRnd.nextInt(40) === 0) {
        var o = e.fl9;
        do { e.fl9 += e.bookRnd.nextInt(4) - e.bookRnd.nextInt(4); } while (o === e.fl9);
      }
    } else { e.fl2 += 0.02; e.nextPageTurningSpeed -= 0.1; }
    while (e.fl4 >= PI) e.fl4 -= TAU;
    while (e.fl4 < -PI) e.fl4 += TAU;
    while (e.fl2 >= PI) e.fl2 -= TAU;
    while (e.fl2 < -PI) e.fl2 += TAU;
    var d = e.fl2 - e.fl4;
    while (d >= PI) d -= TAU;
    while (d < -PI) d += TAU;
    e.fl4 += d * 0.4;
    e.nextPageTurningSpeed = Math.max(0, Math.min(1, e.nextPageTurningSpeed));
    e.bticks++;
    e.pageAngle = e.nextPageAngle;
    var q = Math.max(-0.2, Math.min(0.2, (e.fl9 - e.nextPageAngle) * 0.4));
    e.fl7 += (q - e.fl7) * 0.9;
    e.nextPageAngle += e.fl7;
  };
  /** The part deltas of `BookModel.setPageAngles(t, f1, f2, open)`; assignment = delta over the jar's rest. */
  ER.bookAnim = function (t, f1, f2, open, R, d3) {
    var a = (Math.sin(t * 0.02) * 0.1 + 1.25) * open, sa = Math.sin(a);
    var rest = {}, ps = NS.BEModel.layer('book').parts;
    for (var i = 0; i < ps.length; i++) rest[ps[i].n] = ps[i];
    var yaw = { left_lid: Math.PI + a, right_lid: -a, left_pages: a, right_pages: -a,
                flip_page1: a - a * 2 * f1, flip_page2: a - a * 2 * f2 };
    return {
      sleepPose: { R: R, dx: d3[0], dy: d3[1], dz: d3[2] },
      deltaFor: function (n) {
        if (yaw[n] === undefined) return null;
        var r = rest[n], o = { rx: 0, ry: yaw[n] - (r.ry || 0), rz: 0 };
        if (/pages$|^flip/.test(n)) o.dpx = sa - (r.px || 0);
        return o;
      }
    };
  };
  ER.bookItem = function (e, st, kind, partial) {
    var SR = NS.States, R = NS.Reg, P_ = R.PROP, V = R.PVAL, W = NS.World, PI = Math.PI;
    var m, t, f1 = 0.1, f2 = 0.9, open = 1.2, origin;
    if (kind === 'lectern') {
      if (SR.propValue(st, P_.has_book) !== V['true']) return null;
      var fn = R.valueNames[SR.propValue(st, P_.facing)];
      var cw = { north: 'east', east: 'south', south: 'west', west: 'north' }[fn];
      var psi = (ER.BOOK_REST_ROT[cw] || 0);
      m = mulMat3(rotY(-psi), rotZ(67.5)); t = 0;
      origin = [0.5, 1.0625, 0.5];
      var tt = [0, -0.125, 0];
    } else {
      var T = (NS.Behave && NS.Behave.gameTime) | 0;
      if (!e.bookRnd) { e.bookRnd = new ER.JRandom((e.x * 3129871) ^ (e.z * 116129781) ^ e.y); e.bticks = 0; e.nextPageTurningSpeed = e.pageTurningSpeed = 0;
        e.nextPageAngle = e.pageAngle = e.fl2 = e.fl3 = e.fl4 = e.fl7 = e.fl9 = 0; e.bookT = T - 1; }
      var n = Math.max(0, Math.min(20, T - e.bookT));
      e.bookT = T;
      var pl = ER.bookPlayer(), near = null;
      if (pl) {
        var dx = pl.x - (e.x + 0.5), dy = (pl.y || 0) - (e.y + 0.5), dz = pl.z - (e.z + 0.5);
        if (dx * dx + dy * dy + dz * dz < 9) near = pl;
      }
      for (var i = 0; i < n; i++) ER.bookTick(e, near);
      var p = partial || 0;
      t = e.bticks + p;
      var d = e.fl4 - e.fl3;
      while (d >= PI) d -= 2 * PI;
      while (d < -PI) d += 2 * PI;
      var ang = e.fl3 + d * p;
      m = mulMat3(rotY(-ang * 180 / PI), rotZ(80));
      var pa = e.pageAngle + (e.nextPageAngle - e.pageAngle) * p;
      var fr = function (x) { return x - Math.floor(x); };
      f1 = Math.max(0, Math.min(1, fr(pa + 0.25) * 1.6 - 0.3));
      f2 = Math.max(0, Math.min(1, fr(pa + 0.75) * 1.6 - 0.3));
      open = e.pageTurningSpeed + (e.nextPageTurningSpeed - e.pageTurningSpeed) * p;
      origin = [0.5, 0.75 + 0.1 + Math.sin(t * 0.1) * 0.01, 0.5];
      tt = [0, 0, 0];
    }
    var off = [m[0] * tt[0] + m[1] * tt[1] + m[2] * tt[2], m[3] * tt[0] + m[4] * tt[1] + m[5] * tt[2], m[6] * tt[0] + m[7] * tt[1] + m[8] * tt[2]];
    var an = ER.bookAnim(t, f1, f2, open, m, [0, 0, 0]);
    return { layer: 'book', yaw: 0, openness: 0, texKey: null, base: ER.BASE_NONE, raw: [e.x + origin[0] + off[0], e.y + origin[1] + off[1], e.z + origin[2] + off[2]], anim: an, bookPose: true };
  };

  /** Every block entity within `ER.RANGE` of the eye that this file can draw, in `ER.build`'s
   *  own item shape. ⚠ `BE.forEachNear` rather than `BE.forEach`: a draw loop wants the ball in
   *  front of the player, not every chest the player has ever placed (07c's own header). */
  ER.beWorldVisible = function (eX, eY, eZ, partial) {
    var BEs = NS.BlockEntities, out = [];
    if (!ER.ready || !BEs || !BEs.ready || !BEs.forEachNear) return out;
    ER.bannerBeginFrame();
    var R2 = ER.RANGE * ER.RANGE, rc = Math.ceil(ER.RANGE / 16);
    BEs.forEachNear(Math.floor(eX), Math.floor(eZ), rc, function (e) {
      var dx = e.x + 0.5 - eX, dy = e.y + 0.5 - eY, dz = e.z + 0.5 - eZ;
      if (dx * dx + dy * dy + dz * dz > R2) return;
      if (e.type === 'piston') {   // #323 PistonBlockEntityRenderer: the carried state, part-way between its cells
        var pps = NS.Piston && NS.Piston.renderParts ? NS.Piston.renderParts(e, e.x, e.y, e.z, partial) : [];
        for (var pi = 0; pi < pps.length; pi++) {
          var pp = pps[pi];
          out.push({ e: e, state: pp.state, x: e.x + pp.off[0] + 0.5, y: e.y + pp.off[1], z: e.z + pp.off[2] + 0.5,   // pp.cell is the light/seed pos only; the matrix origin is the entity's own
                     
                     shape: 'mushroom', layer: ER.layerOf(pp.state), sprites: null, copies: null, flatSprite: false, mobLayer: null,
                     mush: { state: pp.state, part: -1, c: [0, 0.5, 0], m: [1, 0, 0, 0, 1, 0, 0, 0, 1], white: 0 } });
        }
        return;
      }
      if (e.type === 'campfire') {
        var cf = ER.campfireItems(e, NS.World && NS.World.getBlock ? NS.World.getBlock(e.x, e.y, e.z) : 0);
        for (var ci = 0; ci < cf.length; ci++) out.push(cf[ci]);
        return;
      }
      var its = e.type === 'conduit' ? ER.conduitItems(e, partial) : [ER.beWorldItem(e, partial)];
      for (var ii = 0; ii < its.length; ii++) {
        var it = its[ii];
        if (!it) continue;
        out.push({ e: e, state: 0, x: it.raw ? it.raw[0] : e.x, y: it.raw ? it.raw[1] : e.y, z: it.raw ? it.raw[2] : e.z, shape: 'beworld',
                   layer: CFG.LAYER_OPAQUE, sprites: null, copies: null, flatSprite: false,
                   mobLayer: it.layer, beYaw: it.yaw, beOpen: it.openness, texKey: it.texKey,
                   beRaw: !!it.raw, beBase: it.base || ER.BASE_NONE, beScale: it.scale || null, beBox: it.box || null,
                   beHide: it.hide || null, beAnim: it.anim || null, conduitKey: it.conduitKey });
      }
    });
    return out;
  };

  /**
   * D-503/D-508's OWED, CLOSED — every `NS.Tame.knots` entry within `ER.RANGE`, in `ER.build`'s
   * own item shape, `shape: 'mob'` so it goes through the SAME `it.x/y/z` origin convention
   * `ER.build`'s own comment ("NOT `ER.MODEL_OFFSET`—...places a mob at its feet position
   * directly") already documents — `knot.x/y/z` (`Tm.getOrCreateKnot`, 07n_tame.js:
   * `AbstractDecorationEntity.updateAttachmentPosition`, `pos + (0.5, 0.375, 0.5)`) IS that feet
   * position already, no block-corner recentring the way `ER.beWorldOrigin` does for a chest.
   *
   * `e: { yaw: 0 }` is a MINIMAL STAND-IN, not a real `EntityList` row — a knot never turns
   * (`LeashKnotEntityModel.setAngles` only ever reads yaw/pitch the game never sets past 0), so
   * `ER.yawAt`'s interpolation always resolves to 0 and `ER.animOf` (`!e.maxHealth` — a stand-in
   * has none) returns null, exactly the "not posed" contract every other static layer here gets.
   *
   * The base pose is `ER.BASE_MIRROR` (D-596, `ER.basePoseFor`'s `MIRROR_ONLY` table): vanilla's
   * `LeashKnotEntityRenderer.method_4035` is `scale(-1,-1,1)` with no lift — read off `.decomp`,
   * settled by arithmetic (the knot's Y span on the post), not by a screenshot. mobboxcheck §knot.
   */
  ER.leashKnotVisible = function (eX, eY, eZ) {
    var Tm = NS.Tame, out = [];
    if (!Tm || !Tm.ready || !Tm.knots) return out;
    var R2 = ER.RANGE * ER.RANGE;
    for (var i = 0; i < Tm.knots.length; i++) {
      var k = Tm.knots[i];
      if (k.removed) continue;
      var dx = k.x - eX, dy = k.y - eY, dz = k.z - eZ;
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      out.push({ e: { yaw: 0 }, state: 0, x: k.x, y: k.y, z: k.z, shape: 'mob',
                 layer: CFG.LAYER_OPAQUE, sprites: null, copies: null, flatSprite: false,
                 mobLayer: 'leash_knot', texKey: null });
    }
    return out;
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // D-835 unit (loop/crystal-render-beam) -- EC.OWED's own "crystal-model half... unbuilt" line
  // (07zzn_endcrystal.js, ~line 114): EndCrystalEntityRenderer's own hand-built PoseStack chain
  // (.decomp, read whole) --
  //   scale(2) -> translate(0,-0.5,0) -> BOTTOM (if shouldShowBottom)
  //   -> rotateY(age*3deg) -> translate(0, 1.5+bobY/2, 0) -> tilt60 -> FRAME #1
  //   -> scale(0.875) -> tilt60 -> rotateY(age*3deg) -> FRAME #2
  //   -> scale(0.875) -> tilt60 -> rotateY(age*3deg) -> CORE
  // -- ported as up to four separate `ER.emitMobLayer` calls against the ONE real `end_crystal`
  // BE layer (`assets/models.bin`'s own `base`/`cube`/`glass` parts, all pivot (0,0,0) --
  // `tools/golden/models-1.18.2.tsv` lines 242-244, this session's own read confirmed it),
  // each instance hiding the other two parts (`ER.EC_HIDE`) and carrying its OWN
  // Euler-decomposed rotation (`ER.eulerOf`, shared with `ER.composeChild` above) and
  // isotropic `swellScale` -- the two knobs `ER.emitMobLayer` already exposes for a creeper's
  // swell and a chest's lid, so this is NOT a third render path: no cuboid math is hand-rolled
  // here, only the matrix chain vanilla's own renderer builds by hand is, since nothing in this
  // engine's model system executes an arbitrary PoseStack script the way vanilla's render()
  // method does.
  //
  // ⚠ THE SCALE FACTORS ARE TRACKED AS PLAIN NUMBERS, NOT RE-DERIVED FROM A MATRIX NORM:
  // vanilla's `scale(s)` is isotropic and `s*R = R*s` for any rotation `R`, so the three
  // isotropic scales this chain ever reaches (2, 2*0.875 = 1.75, 1.75*0.875 = 1.53125) commute
  // straight through the rotation composition below and are applied afterward, once, via
  // `ER.emitMobLayer`'s own `swellScale` knob -- `ER.eulerOf` never reads scale off a matrix.
  //
  // ⚠ THE TILT AXIS IS A REAL UNIT VECTOR: `(sin45, 0, sin45)` has magnitude
  // `sin45*sqrt(2) = 1` exactly (`SINE_45_DEGREES` IS `Math.sin(PI/4)`, .decomp's own constant
  // name) -- `ER.axisAngle3`'s Rodrigues formula assumes a unit axis and this one already is.

  var crystalTiltCache = null;
  /** The Rodrigues rotation matrix for a unit axis (`ax,ay,az`) and angle `rad` -- the plain
   *  3x3 form `new Quaternion(axis, angle, true)` builds in the jar (right-hand rule, axis
   *  already normalized): `cosθ·I + sinθ·[axis]× + (1-cosθ)·(axis⊗axis)`. */
  ER.axisAngle3 = function (ax, ay, az, rad) {
    var c = Math.cos(rad), s = Math.sin(rad), t = 1 - c;
    return [
      c + ax * ax * t,      ax * ay * t - az * s, ax * az * t + ay * s,
      ay * ax * t + az * s, c + ay * ay * t,      ay * az * t - ax * s,
      az * ax * t - ay * s, az * ay * t + ax * s, c + az * az * t
    ];
  };
  /** `EndCrystalEntityRenderer`'s own 60-degree tilt, `new Quaternion(new Vec3f(SINE_45_DEGREES,
   *  0, SINE_45_DEGREES), 60, true)` -- a constant, cached once rather than rebuilt every frame
   *  of every crystal. */
  function crystalTilt() {
    if (!crystalTiltCache) {
      var s45 = Math.sin(Math.PI / 4);
      crystalTiltCache = ER.axisAngle3(s45, 0, s45, Math.PI / 3);
    }
    return crystalTiltCache;
  }
  /** `EndCrystalEntityRenderer.getYOffset` (.decomp, read whole), byte-for-byte: the bob both
   *  the crystal's own float height AND the beam's near-end (below) read. */
  ER.crystalYOffset = function (e, partial) {
    var t = (e.endCrystalAge || 0) + partial;
    var s = Math.sin(t * 0.2) / 2 + 0.5;
    s = (s * s + s) * 0.4;
    return s - 1.4;
  };
  /** Which of the layer's OTHER two named parts a single-instance `ER.emitMobLayer` call must
   *  hide, keyed by the part actually wanted this call. */
  ER.EC_HIDE = {
    base: { cube: 1, glass: 1 },
    cube: { base: 1, glass: 1 },
    glass: { base: 1, cube: 1 }
  };
  /** How many quads ONE named part of the `end_crystal` layer costs -- `ER.mobQuadCount`'s own
   *  loop, restricted to a single part index, because a crystal's `glass` part is drawn TWICE
   *  a frame (two independent instances, D-835) and its `cube`/`base` once each, never all
   *  three together the way `ER.mobQuadCount` assumes. */
  ER.endCrystalPartQuadCount = function (partName) {
    var BE = NS.BEModel, L = BE && BE.ready ? BE.layer('end_crystal') : null;
    if (!L) return 0;
    var G = ER.mobGeomFor('end_crystal');
    for (var k = 0; k < L.parts.length; k++) {
      if (L.parts[k].n !== partName) continue;
      var n = 0;
      for (var f = 0; f < 6; f++) n += mobFaceQuadCount(G, k, f);
      return ER.NO_CULL.end_crystal ? 2 * n : n;
    }
    return 0;
  };

  /**
   * `EnderDragonEntityRenderer.renderCrystalBeam` (.decomp, read whole), as pure WORLD-SPACE
   * geometry: eight trapezoidal quads (apex ring radius `0.75*0.2`, far ring radius `0.75`),
   * each `{ p: [[x,y,z] x4], uv: [[u,v] x4], rgba: [[r,g,b,a] x4] }`. `ER.OWED`'s own line
   * named "no beam-drawing primitive at all" (D-835) -- confirmed by `grep -rn "beam"
   * src/07j_entityrender.js` matching nothing before this pass -- so this is genuinely new,
   * not a rename of something that already drew.
   *
   * ⚠ GEOMETRY ONLY, NOT A GPU DRAW CALL (named, not silently skipped). `ER.build`'s shared
   * §8 model buffer is an atlas-tinted BLOCK-quad format (`Mesher.packModelVertex`) with no
   * slot for a translucent, vertex-coloured, UV-SCROLLING cone against its own dedicated
   * `end_crystal_beam.png` texture -- the same reason `07zx_particle.js`'s billboards and
   * `ER.renderOrbs`'s xp-orb glow are each their own hand-rolled GPU path rather than an
   * `ER.emit`/`ER.emitPart` call. Wiring an actual textured draw call into all three backends
   * (webgl1/webgl2/webgpu) is real work this pass's single-file ownership does not cover; what
   * IS real here is the exact vertex math vanilla's own renderer runs (rotation, taper, UV
   * scroll, the two-tone vertex colour), collected onto `ER.build`'s own return value
   * (`beamQuads`) the same way `list` already is, for a future GPU-wiring pass to consume.
   *
   * ⚠ THE ROTATION IS THE JAR'S OWN TWO-AXIS ALIGNMENT, NOT A LOOK-AT SHORTCUT:
   * `Vec3f.POSITIVE_Y.getRadialQuaternion(-atan2(dz,dx)-PI/2)` then
   * `Vec3f.POSITIVE_X.getRadialQuaternion(-atan2(xz,dy)-PI/2)` (RADIANS, no degree conversion
   * — `getRadialQuaternion` unlike `getDegreesQuaternion` two names up), reproduced here as
   * plain rotate-Y-then-rotate-X with this same file's own `rY`/`rX` sign convention.
   */
  ER.crystalBeamQuads = function (crystalXYZ, targetXYZ, bobY, age, partial) {
    var lx = targetXYZ[0] - crystalXYZ[0], ly = targetXYZ[1] - crystalXYZ[1], lz = targetXYZ[2] - crystalXYZ[2];
    // the jar's own (dx,dy,dz) argument to renderCrystalBeam: -lx, -ly+bobY, -lz -- points
    // from the TARGET back toward the crystal, the crystal's own bob folded into Y only.
    var dx = -lx, dy = -ly + bobY, dz = -lz;
    var xz = Math.sqrt(dx * dx + dz * dz);
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dist > 0)) return [];
    var theta1 = -Math.atan2(dz, dx) - Math.PI / 2;
    var theta2 = -Math.atan2(xz, dy) - Math.PI / 2;
    function rotYv(theta, v) {
      var c = Math.cos(theta), s = Math.sin(theta);
      return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
    }
    function rotXv(theta, v) {
      var c = Math.cos(theta), s = Math.sin(theta);
      return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
    }
    // `matrixStack.translate(0, 2, 0)` -- the cone's own local origin, itself already sitting
    // at the TARGET point (`EndCrystalEntityRenderer.render`'s own `translate(lx,ly,lz)`),
    // lifted two blocks.
    var origin = [targetXYZ[0], targetXYZ[1] + 2, targetXYZ[2]];
    function toWorld(local) {
      var w = rotYv(theta1, rotXv(theta2, local));
      return [origin[0] + w[0], origin[1] + w[1], origin[2] + w[2]];
    }
    var v0tex = 0 - (age + partial) * 0.01;
    var v1tex = dist / 32 - (age + partial) * 0.01;
    var quads = [];
    var xPrev = 0, yPrev = 0.75, tPrev = 0;
    for (var i = 1; i <= 8; i++) {
      var ang = i * (Math.PI * 2) / 8;
      var xi = Math.sin(ang) * 0.75, yi = Math.cos(ang) * 0.75, ti = i / 8;
      quads.push({
        p: [
          toWorld([xPrev * 0.2, yPrev * 0.2, 0]),
          toWorld([xPrev, yPrev, dist]),
          toWorld([xi, yi, dist]),
          toWorld([xi * 0.2, yi * 0.2, 0])
        ],
        uv: [[tPrev, v0tex], [tPrev, v1tex], [ti, v1tex], [ti, v0tex]],
        rgba: [[0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255]]
      });
      xPrev = xi; yPrev = yi; tPrev = ti;
    }
    return quads;
  };
  ER.CRYSTAL_BEAM_TEXTURE = 'entity/end_crystal/end_crystal_beam';

  /**
   * `GuardianEntityRenderer.render`'s beam half (.decomp, read whole), as WORLD-SPACE geometry in the same
   * `{p,uv,rgba}` quad shape as `ER.crystalBeamQuads` (GEOMETRY ONLY, same reason: no textured draw call
   * for `guardian_beam.png` yet -- named, not faked). Two spinning side quads plus the flickering end cap,
   * the jar's twelve vertices. `eye` = guardian lerped pos + standing eye height; `tgt` = target lerped pos +
   * height*0.5; `progress` = `Gd.getBeamProgress` (colour ramps with its square); `time` = world time +
   * partial; `ageEven` = `guardian.age % 2 == 0`.
   */
  ER.guardianBeamQuads = function (eye, tgt, progress, time, ageEven) {
    var dx = tgt[0] - eye[0], dy = tgt[1] - eye[1], dz = tgt[2] - eye[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 0)) return [];
    var L = len + 1;
    var thX = Math.acos(dy / len), thY = Math.PI / 2 - Math.atan2(dz / len, dx / len);
    var cx = Math.cos(thX), sx = Math.sin(thX), cy = Math.cos(thY), sy = Math.sin(thY);
    function toWorld(x, y, z) {
      var ay = cx * y - sx * z, az = sx * y + cx * z;
      return [eye[0] + cy * x + sy * az, eye[1] + ay, eye[2] - sy * x + cy * az];
    }
    var spin = time * 0.05 * -1.5;
    var pp = progress * progress;
    var col = [64 + Math.trunc(pp * 191), 32 + Math.trunc(pp * 191), 128 - Math.trunc(pp * 64), 255];
    var v0 = -1 + (time * 0.5 % 1), v1 = L * 2.5 + v0;
    var PI = Math.PI;
    function pt(a, r) { return [Math.cos(spin + a) * r, Math.sin(spin + a) * r]; }
    function side(a, b) {
      return {
        p: [toWorld(a[0], L, a[1]), toWorld(a[0], 0, a[1]), toWorld(b[0], 0, b[1]), toWorld(b[0], L, b[1])],
        uv: [[0.4999, v1], [0.4999, v0], [0, v0], [0, v1]], rgba: [col, col, col, col]
      };
    }
    var q = [side(pt(PI, 0.2), pt(0, 0.2)), side(pt(PI / 2, 0.2), pt(PI * 3 / 2, 0.2))];
    var c1 = pt(PI * 3 / 4, 0.282), c2 = pt(PI / 4, 0.282), c3 = pt(PI * 7 / 4, 0.282), c4 = pt(PI * 5 / 4, 0.282);
    var f = ageEven ? 0.5 : 0;
    q.push({
      p: [toWorld(c1[0], L, c1[1]), toWorld(c2[0], L, c2[1]), toWorld(c3[0], L, c3[1]), toWorld(c4[0], L, c4[1])],
      uv: [[0.5, f + 0.5], [1, f + 0.5], [1, f], [0.5, f]], rgba: [col, col, col, col]
    });
    return q;
  };
  ER.GUARDIAN_BEAM_TEXTURE = 'entity/guardian_beam';

  /** Pushes this frame's guardian/elder_guardian beam group onto `beamsOut` (see `ER.guardianBeamQuads`). */
  ER.pushGuardianBeam = function (e, partial, beamsOut) {
    var Gd = NS.Guardian;
    if (!Gd || !Gd.hasBeamTarget(e)) return;
    var t = Gd.getBeamTarget(e);
    if (!t) return;
    var Ent = NS.Entities;
    var hOf = function (x) { return (Ent && Ent.height ? Ent.height(x.type) : 0) || x.height || 0; };
    var a = ER.posAt(e, partial, [0, 0, 0]), b = ER.posAt(t, partial, [0, 0, 0]);
    var q = ER.guardianBeamQuads([a[0], a[1] + hOf(e) * 0.5, a[2]], [b[0], b[1] + hOf(t) * 0.5, b[2]],
      Gd.getBeamProgress(e, partial), (e.age || 0) + partial, (e.age || 0) % 2 === 0);
    if (q.length) beamsOut.push({ e: e, quads: q, texture: ER.GUARDIAN_BEAM_TEXTURE });
  };

  /**
   * One live `end_crystal` entity's up-to-four MODEL draw-list entries (shape `'ec'`), pushed
   * straight into `out` the same way `ER.leashKnotVisible`/`ER.beWorldVisible` extend
   * `ER.build`'s own list -- `ER.visible`'s own per-entity loop calls this instead of falling
   * through to the generic mob path (`ER.mobLayerFor('end_crystal')` would refuse: it is not a
   * `setupAnim` mob, it is this hand-built matrix chain). When `e.beamTarget` is set (read as
   * `{x,y,z}` block coordinates -- this pass's own read convention, since no setter/format for
   * it exists anywhere in src/ yet, `EC.OWED`'s own "DATA fields with no reader yet" line),
   * also appends this frame's beam quad group to `beamsOut`.
   */
  ER.pushEndCrystal = function (e, eX, eY, eZ, partial, out, beamsOut) {
    var p = [0, 0, 0];
    ER.posAt(e, partial, p);
    var dx = p[0] - eX, dy = p[1] - eY, dz = p[2] - eZ;
    if (dx * dx + dy * dy + dz * dz > ER.RANGE * ER.RANGE) return;
    var bobY = ER.crystalYOffset(e, partial);
    var rotRad = ((e.endCrystalAge || 0) + partial) * 3 * DEG2RAD;
    var TILT = crystalTilt(), Ry = rY(rotRad);
    var Rframe1 = m3mul(Ry, TILT);
    var Rframe2 = m3mul(m3mul(Rframe1, TILT), Ry);
    var Rcore = m3mul(m3mul(Rframe2, TILT), Ry);
    var frameY = p[1] + 2 + bobY;
    function push1(partName, wy, R, scale) {
      out.push({ e: e, state: 0, x: p[0], y: wy, z: p[2], shape: 'ec',
                 layer: CFG.LAYER_OPAQUE, sprites: null, copies: null, flatSprite: false,
                 mobLayer: 'end_crystal', ecPart: partName, ecRot: ER.eulerOf(R), ecScale: scale });
    }
    if (e.showBottom !== false) push1('base', p[1] - 1, ER.rotMatrix(0, 0, 0), 2);
    push1('glass', frameY, Rframe1, 2);
    push1('glass', frameY, Rframe2, 1.75);
    push1('cube', frameY, Rcore, 1.53125);
    if (e.beamTarget && typeof e.beamTarget.x === 'number' &&
        typeof e.beamTarget.y === 'number' && typeof e.beamTarget.z === 'number') {
      var targetXYZ = [e.beamTarget.x + 0.5, e.beamTarget.y + 0.5, e.beamTarget.z + 0.5];
      beamsOut.push({ e: e, quads: ER.crystalBeamQuads(p, targetXYZ, bobY, e.endCrystalAge || 0, partial) });
    }
  };



  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // loop/xporbsprite (G21) — ER.OWED's own "experience_orb — G21" line, CLOSED: the draw.
  // `tools/extract-xporbtex.mjs` packs the vanilla `textures/entity/experience_orb.png` sheet
  // (one 64x64 texture, a 4-column grid of 16x16 icons — NOT a texture array, unlike
  // `07zx_particle.js`'s atlas, because this is already one sheet with no per-type JSON split);
  // everything below reads it back and paints a camera-facing billboard per live orb, the SAME
  // "vertex math lives here once, each backend only uploads and draws" shape `07u_leash.js`'s
  // own header established and `07zx_particle.js` already reused a second time.
  //
  // ⚠ THIS IS TRANSLUCENT, NOT ALPHA-TESTED (unlike the particle billboards above it in the
  // frame). `ExperienceOrbEntityRenderer.LAYER` is `RenderLayer.getItemEntityTranslucentCull`
  // (.decomp/net/minecraft/client/render/entity/ExperienceOrbEntityRenderer.java:18) and its own
  // `vertex()` helper hard-codes alpha=128 on every vertex (.java:65) — a discard-on-threshold
  // shader would either hide the whole orb (128/255 < the 0.5 cutout `10_gfx.js`'s own
  // `CFG.CUTOUT` uses) or show it fully opaque; neither is the translucent glow vanilla draws.
  // So this pass, alone among this file's own draws, enables blending and turns depth WRITES
  // (not depth TESTING) off for its own quads — the ordinary translucent-pass convention
  // `10_gfx.js`'s own `drawList` already uses for `listTrans`, reproduced by hand here because
  // this quad never enters that list (same reason the particle/leash passes are hooked after it
  // instead of inside it).
  //
  // ⚠ WHAT THIS DOES NOT MODEL, NAMED RATHER THAN SILENTLY DROPPED (same two lines
  // `07zx_particle.js`'s own header already carries, for the same reasons):
  //   * `getBlockLight`-based lighting (`method_24089`, .decomp:26-28: `clamp(blockLight+7,0,15)`)
  //     — drawn full-bright instead (light 15 always), a per-frame-per-orb light probe being the
  //     exact rendering-cost simplification category this unit's own brief carves out.
  //   * partial-tick interpolation of the COLOUR PULSE — `t = (age + partialTicks) / 2` is
  //     reproduced exactly (`NS.Main.partial()`, the same source `buildEntityMesh` already
  //     reads), but the QUAD POSITION is not re-interpolated a second way; `ER.posAt` (already
  //     used by every other billboard/sprite in this file) is reused as-is.

  /** `NS.DATA.xporbSheet/xporbTile/xporbCols` (from `extract-xporbtex.mjs`'s own meta), read
   *  once and cached — `null` until `19_data.gen.js` has loaded, every caller below treats that
   *  as "nothing to draw yet". */
  var xporbMetaCache;
  function xporbMeta() {
    if (xporbMetaCache !== undefined) return xporbMetaCache;
    var data = NS.DATA;
    xporbMetaCache = (data && data.xporbTiles) ? {
      sheet: data.xporbSheet || 64, tile: data.xporbTile || 16, cols: data.xporbCols || 4
    } : null;
    return xporbMetaCache;
  }
  // test-only reset, the same idiom `Px._resetLayerCacheForTest` already established.
  ER._resetOrbMetaCacheForTest = function () { xporbMetaCache = undefined; orbRGBA = null; orbTried = false; };

  /**
   * The 0..10 icon index -> its UV rect on the sheet, `[u0, v0, u1, v1]`, exactly
   * `ExperienceOrbEntityRenderer.method_3966`'s own crop (.decomp:31-34: `size%cols*tile`,
   * `size/cols*tile`, both `/sheet`, integer division before the divide). Pure and GPU-free so
   * `xporbdrawcheck.mjs` can pin it with no WebGL/WebGPU context at all.
   */
  ER.orbUV = function (index) {
    var m = xporbMeta();
    var sheet = m ? m.sheet : 64, tile = m ? m.tile : 16, cols = m ? m.cols : 4;
    var col = index % cols, row = Math.floor(index / cols);
    var u0 = (col * tile) / sheet, u1 = (col * tile + tile) / sheet;
    var v0 = (row * tile) / sheet, v1 = (row * tile + tile) / sheet;
    return [u0, v0, u1, v1];
  };

  /**
   * The colour-pulse RGBA, 0..255 ints, exactly `method_3966`'s own local math (.decomp:38-42):
   * `t = (age + partialTicks) / 2`, `r = (sin(t)+1)*0.5*255` (truncated, not rounded — `(int)`
   * casts toward zero and every input here is >= 0, so `Math.floor` matches), `g` constant 255,
   * `b = (sin(t + 4*PI/3)+1)*0.1*255`, alpha the vertex helper's own hard-coded 128 (.decomp:65,
   * not the unused `$$14 = 255.0F` two lines above it — read the bytecode, not the dead local).
   */
  ER.orbColorAt = function (age, partial) {
    var t = ((age | 0) + (partial || 0)) / 2;
    var r = Math.floor((Math.sin(t) + 1) * 0.5 * 255);
    var g = 255;
    var b = Math.floor((Math.sin(t + Math.PI * 4 / 3) + 1) * 0.1 * 255);
    return [r, g, b, 128];
  };

  /**
   * ONE frame's worth of orb billboard quads, `[x,y,z, u,v, r,g,b,a]` per vertex (world-space,
   * NOT eye-relative — unlike `Px.buildQuads`, this file's own vertex data is already
   * world-space everywhere else, `ER.build`'s own `ox,oy,oz` origin convention).
   *
   * ⚠ THE HORIZONTAL AXIS IS `-cam.right`, NOT `cam.right`. Vanilla's own matrix stack does
   * `multiply(dispatcher.getRotation())` (aligns the local frame with the camera, exactly what
   * `cam.right`/`cam.up` already are) and THEN `multiply(POSITIVE_Y.getDegreesQuaternion(180))`
   * (.decomp:46-47) — a 180-degree turn about the now-camera-aligned local Y axis, which negates
   * that frame's X (and Z) and leaves Y alone. Reproducing the extra rotation exactly would mean
   * a quaternion this engine's billboard convention has never needed; negating the right-axis
   * component is the same picture, since `cy*up` is untouched either way and `cx*right` is the
   * only term the flip changes the sign of.
   */
  var ORB_CORNERS = [
    [-0.5, -0.25], [0.5, -0.25], [0.5, 0.75], [-0.5, 0.75]
  ];
  ER.ORB_SCALE = 0.3;     // method_3966's own `$$19 = 0.3F` / `$$3.scale(0.3F, 0.3F, 0.3F)`
  ER.buildOrbQuads = function (cam, partial) {
    var EL = NS.EntityList;
    var out = [];
    if (!EL || !EL.ready || !EL.list || !cam) return out;
    var right = cam.right, up = cam.up, R2 = ER.RANGE * ER.RANGE;
    var p = [0, 0, 0];
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (e.removed || e.type !== 'experience_orb') continue;
      ER.posAt(e, partial, p);
      var dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z;
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      var idx = (NS.Xp && NS.Xp.orbIconIndex) ? NS.Xp.orbIconIndex(e.value | 0) : 0;
      var uv = ER.orbUV(idx);
      var col = ER.orbColorAt(e.age | 0, partial);
      // translate(0, 0.1, 0), .decomp:44 — before the billboard rotation, so it is a plain
      // world-Y offset, not something the camera basis carries.
      var cx = p[0], cy = p[1] + 0.1, cz = p[2];
      for (var k = 0; k < 4; k++) {
        var c = ORB_CORNERS[k];
        var lx = -c[0] * ER.ORB_SCALE, ly = c[1] * ER.ORB_SCALE;
        out.push(
          cx + right[0] * lx + up[0] * ly,
          cy + right[1] * lx + up[1] * ly,
          cz + right[2] * lx + up[2] * ly,
          (k === 0 || k === 3) ? uv[0] : uv[2],
          (k === 0 || k === 1) ? uv[3] : uv[1],
          col[0] / 255, col[1] / 255, col[2] / 255, col[3] / 255
        );
      }
    }
    return out;
  };
  ER.ORB_VERTEX_FLOATS = 9;   // x,y,z, u,v, r,g,b,a

  var orbQuadIndexCache = null, orbQuadIndexCap = 0;
  function orbQuadIndices(n) {
    if (orbQuadIndexCache && orbQuadIndexCap >= n) return orbQuadIndexCache;
    var cap = Math.max(n, 64);
    var idx = new Uint16Array(cap * 6);
    for (var i = 0; i < cap; i++) {
      var v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    orbQuadIndexCache = idx; orbQuadIndexCap = cap;
    return idx;
  }

  /** The sheet's raw RGBA bytes, decoded from `NS.DATA.xporbTiles` once and cached. */
  var orbRGBA = null, orbSheet = 64, orbTried = false;
  function orbAtlas() {
    if (orbRGBA || orbTried) return orbRGBA;
    orbTried = true;
    var data = NS.DATA;
    if (!data || !data.xporbTiles || !NS.Z) return null;
    try {
      orbRGBA = NS.Z.unpack(data.xporbTiles, data.xporbTilesBytes);
      orbSheet = data.xporbSheet || 64;
    } catch (err) { orbRGBA = null; }
    return orbRGBA;
  }

  // ── WebGL2 ───────────────────────────────────────────────────────────────────────────────

  var orbGl2 = { prog: null, vbuf: null, ibuf: null, tex: null,
                 uViewProj: -1, uTex: -1, aPos: 0, aUV: 1, aColor: 2 };

  function orbGlCompile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Orb shader: ' + log);
    }
    return sh;
  }

  function orbGlEnsureProgram(gl) {
    if (orbGl2.prog) return true;
    try {
      var VS = [
        '#version 300 es',
        'precision highp float;',
        'in vec3 aPos;', 'in vec2 aUV;', 'in vec4 aColor;',
        'uniform mat4 uViewProj;',
        'out vec2 vUV;', 'out vec4 vColor;',
        'void main() {',
        '  vUV = aUV; vColor = aColor;',
        '  gl_Position = uViewProj * vec4(aPos, 1.0);',
        '}'
      ].join('\n');
      var FS = [
        '#version 300 es',
        'precision highp float;',
        'in vec2 vUV;', 'in vec4 vColor;',
        'uniform sampler2D uTex;',
        'out vec4 fragColor;',
        'void main() {',
        '  vec4 t = texture(uTex, vUV);',
        '  fragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);',
        '}'
      ].join('\n');
      var vs = orbGlCompile(gl, gl.VERTEX_SHADER, VS);
      var fs = orbGlCompile(gl, gl.FRAGMENT_SHADER, FS);
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, orbGl2.aPos, 'aPos');
      gl.bindAttribLocation(prog, orbGl2.aUV, 'aUV');
      gl.bindAttribLocation(prog, orbGl2.aColor, 'aColor');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Orb program: ' + gl.getProgramInfoLog(prog));
      orbGl2.prog = prog;
      orbGl2.uViewProj = gl.getUniformLocation(prog, 'uViewProj');
      orbGl2.uTex = gl.getUniformLocation(prog, 'uTex');
      orbGl2.vbuf = gl.createBuffer();
      orbGl2.ibuf = gl.createBuffer();
      return true;
    } catch (err) {
      ER.orbGlError = (err && err.message) || String(err);
      return false;
    }
  }

  function orbGlEnsureTexture(gl) {
    var rgba = orbAtlas();
    if (!rgba) return false;
    if (orbGl2.tex) return true;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, orbSheet, orbSheet, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    orbGl2.tex = tex;
    return true;
  }

  /** The WebGL2 render call — dispatched from `ER.renderOrbs`, same one-hook-site shape
   *  `Px.render`/`Ls.render` already use. */
  ER.renderOrbsGL2 = function (G, cam, partial) {
    if (!G || G.name !== 'webgl2' || !G.backend || !G.backend.gl) return;
    var gl = G.backend.gl;
    if (!orbGlEnsureProgram(gl) || !orbGlEnsureTexture(gl)) return;
    var verts = ER.buildOrbQuads(cam, partial);
    if (!verts.length) return;
    var nQuads = verts.length / (4 * ER.ORB_VERTEX_FLOATS);
    var arr = new Float32Array(verts);
    var idx = orbQuadIndices(nQuads);
    gl.useProgram(orbGl2.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, orbGl2.vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, orbGl2.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    var stride = ER.ORB_VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(orbGl2.aPos);
    gl.enableVertexAttribArray(orbGl2.aUV);
    gl.enableVertexAttribArray(orbGl2.aColor);
    gl.vertexAttribPointer(orbGl2.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(orbGl2.aUV, 2, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribPointer(orbGl2.aColor, 4, gl.FLOAT, false, stride, 5 * 4);
    gl.uniformMatrix4fv(orbGl2.uViewProj, false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, orbGl2.tex);
    gl.uniform1i(orbGl2.uTex, 0);
    // translucent, not cutout (this section's own header) -- blend on, depth WRITE off,
    // depth TEST left exactly as the caller set it (10_gfx.js's own translucent-pass norm).
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (noDepth) gl.disable(gl.DEPTH_TEST);
    gl.drawElements(gl.TRIANGLES, nQuads * 6, gl.UNSIGNED_SHORT, 0);
    if (noDepth) gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(orbGl2.aPos);
    gl.disableVertexAttribArray(orbGl2.aUV);
    gl.disableVertexAttribArray(orbGl2.aColor);
  };

  // ── WebGPU ───────────────────────────────────────────────────────────────────────────────

  var orbGpu = { device: null, pipeline: null, bgl: null, bg: null, sampler: null,
                 uniformBuf: null, vertBuf: null, vertCap: 0, idxBuf: null, idxCap: 0, tex: null };

  function orbGpuWGSL() {
    return [
      'struct VP { viewProj : mat4x4<f32> };',
      '@group(0) @binding(0) var<uniform> uVP : VP;',
      '@group(0) @binding(1) var uTex : texture_2d<f32>;',
      '@group(0) @binding(2) var uSamp : sampler;',
      'struct VOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) uv : vec2<f32>,',
      '  @location(1) color : vec4<f32>',
      '};',
      '@vertex',
      'fn vs_orb(@location(0) pos : vec3<f32>, @location(1) uv : vec2<f32>,',
      '          @location(2) color : vec4<f32>) -> VOut {',
      '  var o : VOut;',
      '  o.pos = uVP.viewProj * vec4<f32>(pos, 1.0);',
      '  o.uv = uv; o.color = color;',
      '  return o;',
      '}',
      '@fragment',
      'fn fs_orb(v : VOut) -> @location(0) vec4<f32> {',
      '  let t = textureSample(uTex, uSamp, v.uv);',
      '  return vec4<f32>(t.rgb * v.color.rgb, t.a * v.color.a);',
      '}'
    ].join('\n');
  }

  function orbGpuEnsurePipeline(device, format) {
    if (orbGpu.pipeline && orbGpu.device === device) return true;
    try {
      var module = device.createShaderModule({ code: orbGpuWGSL() });
      var bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
        ]
      });
      var layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      var pipeline = device.createRenderPipeline({
        layout: layout,
        vertex: {
          module: module, entryPoint: 'vs_orb',
          buffers: [{
            arrayStride: ER.ORB_VERTEX_FLOATS * 4, stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
              { shaderLocation: 2, offset: 20, format: 'float32x4' }
            ]
          }]
        },
        fragment: {
          module: module, entryPoint: 'fs_orb',
          targets: [{
            format: format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
      });
      var pipelineAlways = device.createRenderPipeline({
        layout: layout,
        vertex: { module: module, entryPoint: 'vs_beam', buffers: [{ arrayStride: ER.CRYSTAL_BEAM_VERTEX_FLOATS * 4, stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x4' }] }] },
        fragment: { module: module, entryPoint: 'fs_beam', targets: [{ format: format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }
      });
      beamGpu.pipelineAlways = pipelineAlways;
      var uniformBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      var sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      orbGpu.device = device; orbGpu.pipeline = pipeline; orbGpu.bgl = bgl; orbGpu.uniformBuf = uniformBuf;
      orbGpu.sampler = sampler; orbGpu.bg = null; orbGpu.tex = null;
      orbGpu.vertBuf = null; orbGpu.vertCap = 0; orbGpu.idxBuf = null; orbGpu.idxCap = 0;
      return true;
    } catch (err) {
      ER.orbGpuError = (err && err.message) || String(err);
      return false;
    }
  }

  function orbGpuEnsureTexture(device) {
    var rgba = orbAtlas();
    if (!rgba) return false;
    if (orbGpu.tex && orbGpu.bg) return true;
    var tex = device.createTexture({
      size: [orbSheet, orbSheet, 1],
      format: 'rgba8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    device.queue.writeTexture(
      { texture: tex },
      rgba,
      { bytesPerRow: orbSheet * 4, rowsPerImage: orbSheet },
      [orbSheet, orbSheet, 1]
    );
    orbGpu.tex = tex;
    orbGpu.bg = device.createBindGroup({
      layout: orbGpu.bgl,
      entries: [
        { binding: 0, resource: { buffer: orbGpu.uniformBuf } },
        { binding: 1, resource: tex.createView({ dimension: '2d' }) },
        { binding: 2, resource: orbGpu.sampler }
      ]
    });
    return true;
  }

  /** The WebGPU render call — same contract as `ER.renderOrbsGL2`. */
  ER.renderOrbsGPU = function (G, cam, partial) {
    var P = G && G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    if (!orbGpuEnsurePipeline(P.device, P.format) || !orbGpuEnsureTexture(P.device)) return;
    var verts = ER.buildOrbQuads(cam, partial);
    if (!verts.length) return;
    var nQuads = verts.length / (4 * ER.ORB_VERTEX_FLOATS);
    var arr = new Float32Array(verts);
    var bytes = arr.byteLength;
    if (!orbGpu.vertBuf || orbGpu.vertCap < bytes) {
      orbGpu.vertBuf = P.device.createBuffer({ size: Math.max(bytes, 256), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      orbGpu.vertCap = Math.max(bytes, 256);
    }
    var idx = orbQuadIndices(nQuads);
    var idxBytes = nQuads * 6 * 2;
    if (!orbGpu.idxBuf || orbGpu.idxCap < idxBytes) {
      orbGpu.idxBuf = P.device.createBuffer({ size: Math.max(idxBytes, 256), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      orbGpu.idxCap = Math.max(idxBytes, 256);
    }
    P.device.queue.writeBuffer(orbGpu.vertBuf, 0, arr.buffer, arr.byteOffset, bytes);
    P.device.queue.writeBuffer(orbGpu.idxBuf, 0, idx.buffer, idx.byteOffset, idxBytes);
    P.device.queue.writeBuffer(orbGpu.uniformBuf, 0, cam.viewProj.buffer, cam.viewProj.byteOffset, 64);
    P.pass.setPipeline(orbGpu.pipeline);
    P.pass.setBindGroup(0, orbGpu.bg);
    P.pass.setVertexBuffer(0, orbGpu.vertBuf);
    P.pass.setIndexBuffer(orbGpu.idxBuf, 'uint16');
    P.pass.drawIndexed(nQuads * 6);
  };

  /**
   * The one dispatcher, `10_gfx.js`'s own ONE hook call site — right after
   * `NS.Particle.render(G, cam)`, same frame position (after the world's translucent pass and
   * the particle/leash passes; an orb behind a particle or a rope is not a picture vanilla ever
   * has to resolve either, since none of these are sorted against each other there).
   */
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // loop/crystal-beam-render — D-838 built `ER.crystalBeamQuads`/`ER.build`'s own `beamQuads`
  // (world-space geometry, collected via `beamsOut` in `ER.pushEndCrystal`) but never submitted
  // a single vertex of it to a GPU (its own header says so: "GEOMETRY ONLY, NOT A GPU DRAW
  // CALL"). This closes that, following `ER.renderOrbs`'s own shape EXACTLY — a self-contained
  // per-frame quad builder that walks `EntityList` on its own (the same reason `buildOrbQuads`
  // does not reuse anything from `ER.build`: `ER.build`'s own §8 mesh is thrown away and rebuilt
  // every frame — see `buildEntityMesh`'s own header in 10_gfx.js — before `beamQuads` could ever
  // reach the caller that discards it), one GL2 draw and one WebGPU draw, dispatched from ONE
  // function with the SAME `G.name` branch `ER.renderOrbs` already uses.
  //
  // ⚠ NAMED OMISSION, NOT SILENTLY DROPPED: no textured draw. `ER.CRYSTAL_BEAM_TEXTURE` names
  // the real jar texture (`entity/end_crystal/end_crystal_beam.png`), but unlike
  // `experience_orb.png` (packed by `tools/extract-xporbtex.mjs`, `assets/xporb-tex.bin`) or the
  // particle atlas, NO extraction tool or packed asset for this texture exists anywhere in the
  // repo (`grep -rl "end_crystal_beam"` before this pass matched only this file's own beam-math
  // comment). Building that pipeline (a new `tools/extract-*.mjs`, a new packed asset, a new
  // `19_data.gen.js` slot) is asset-pipeline work outside this pass's single-file
  // (`07j_entityrender.js`-only) ownership, so this draws the SAME quads, SAME vertex positions,
  // and the SAME two-tone vertex colour `ER.crystalBeamQuads` already computes
  // (`(0,0,0,255)` near ring / `(255,255,255,255)` far ring, alpha-blended, depth-write off —
  // the same translucent convention `ER.renderOrbsGL2`/`GPU` already use) — UNTEXTURED (no `uv`
  // attribute, no sampler) rather than inventing a placeholder bitmap. A real cone silhouette
  // now appears and fades from black to white exactly where vanilla's own beam does; only the
  // scrolling bitmap detail is still owed.
  //
  // ⚠ WHY THIS HOOKS THROUGH `ER.renderOrbs` RATHER THAN A NEW `10_gfx.js` LINE: this pass owns
  // `07j_entityrender.js` alone; `10_gfx.js`'s existing hook (`if (NS.EntityRender &&
  // NS.EntityRender.renderOrbs) NS.EntityRender.renderOrbs(G, cam);`, right after the particle
  // pass) is the one call site this file already reaches into the frame through, so the beam
  // rides that same call rather than adding a second cross-file wire this pass has no file to
  // put it in.

  // ── lightning_bolt (#5268) ───────────────────────────────────────────────────────────────
  // LightningEntityRenderer.render: java.util.Random seeded from LightningEntity.seed, the
  // 8-point offset walk, then 4 layers x 3 sections x drawBranch (4 quads). Untextured colour
  // (0.45,0.45,0.5,0.3) quads, drawn through the crystal-beam pass (same vertex format and
  // blend), so WebGL2 and WebGPU draw the identical list. Pure; lightningdrawcheck.mjs pins it.
  function JRandom(seed) {
    this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & 0xFFFFFFFFFFFFn;
  }
  JRandom.prototype.next = function (bits) {
    this.s = (this.s * 0x5DEECE66Dn + 0xBn) & 0xFFFFFFFFFFFFn;
    return Number(this.s >> BigInt(48 - bits));
  };
  JRandom.prototype.nextInt = function (bound) {
    var bits, val;
    do { bits = this.next(31); val = bits % bound; } while (bits - val + (bound - 1) > 0x7FFFFFFF);
    return val;
  };
  JRandom.prototype.nextDouble = function () {
    return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565e-16;
  };
  /** java.util.Random.nextGaussian: Marsaglia polar method, the second value cached (haveNextNextGaussian). */
  JRandom.prototype.nextGaussian = function () { return NS.U.polarGaussian(this, this.nextDouble); };
  ER.JRandom = JRandom;

  /** The bolt's quads in entity-local space: array of 4 [x,y,z] points, colour constant. */
  ER.lightningQuads = function (seed, layers) {
    var f = Math.fround, xs = [], zs = [], x = 0, z = 0, i;
    var r = new JRandom(seed);
    for (i = 7; i >= 0; i--) {
      xs[i] = x; zs[i] = z;
      x += r.nextInt(11) - 5; z += r.nextInt(11) - 5;
    }
    var out = [];
    var nl = layers === undefined ? 4 : layers;
    for (var L = 0; L < nl; L++) {
      var r2 = new JRandom(seed);
      for (var sec = 0; sec < 3; sec++) {
        var top = sec > 0 ? 7 - sec : 7;
        var bot = sec > 0 ? top - 2 : 0;
        var cx = xs[top] - x, cz = zs[top] - z;
        for (var y = top; y >= bot; y--) {
          var px = cx, pz = cz;
          if (sec === 0) { cx += r2.nextInt(11) - 5; cz += r2.nextInt(11) - 5; }
          else { cx += r2.nextInt(31) - 15; cz += r2.nextInt(31) - 15; }
          var a = f(0.1 + L * 0.2), b = a;
          if (sec === 0) { a = f(a * f(y * 0.1 + 1)); b = f(b * f((y - 1) * 0.1 + 1)); }
          // drawBranch(x0,z0,y,x1,z1, a=$$10 (top half-width), b=$$11 (bottom), flags)
          var F = [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]];
          for (var k = 0; k < 4; k++) {
            var q = F[k], s12 = q[0] ? 1 : -1, s13 = q[1] ? 1 : -1, s14 = q[2] ? 1 : -1, s15 = q[3] ? 1 : -1;
            out.push([
              [cx + s12 * b, y * 16, cz + s13 * b],
              [px + s12 * a, (y + 1) * 16, pz + s13 * a],
              [px + s14 * a, (y + 1) * 16, pz + s15 * a],
              [cx + s14 * b, y * 16, cz + s15 * b]
            ]);
          }
        }
      }
    }
    return out;
  };
  ER.LIGHTNING_RGBA = [0.45, 0.45, 0.5, 0.3];

  // ── sign text (#9262) ────────────────────────────────────────────────────────────────────
  // BE.signTextLayout's glyphs as flat-colour texel quads on the sign board, riding this same untextured
  // pass: one quad per inked texel of the HUD's own bitmap font sheet (NS.Gui, 15b_gui.js), the glow
  // outline as the 8 neighbouring texel offsets drawn a hair behind the fill. Frame (SignBlockEntityRenderer):
  // Ry(a) about the block centre (wall: then T(0,-.3125,-.4375)), T(BE.SIGN_OFFSET), scale BE.SIGN_SCALE, y down.
  var signGlyphs = null;
  function signGlyphTexels(ch) {
    var G = NS.Gui;
    if (!G || !G.ready || !G.sheets || !G.sheets.ascii) return null;
    if (!signGlyphs) {
      var sh = G.sheets.ascii, id = sh.canvas.getContext('2d').getImageData(0, 0, sh.w, sh.h).data;
      signGlyphs = { id: id, w: sh.w, cache: [] };
    }
    var hit = signGlyphs.cache[ch];
    if (hit) return hit;
    var c = G.cell, sx = (ch % 16) * c, sy = ((ch / 16) | 0) * c, list = [];
    for (var ty = 0; ty < c; ty++) for (var tx = 0; tx < c; tx++) if (signGlyphs.id[((sy + ty) * signGlyphs.w + sx + tx) * 4 + 3] > 127) list.push(tx, ty);
    return (signGlyphs.cache[ch] = list);
  }
  ER.signTextVerts = function (cam, out) {
    var BEs = NS.BlockEntities, G = NS.Gui, W = NS.World, SR = NS.States, R = NS.Reg;
    if (!BEs || !BEs.forEach || !BEs.signTextLayout || !G || !G.ready || !W || !SR || !R || !R.PROP || !cam) return out;
    var R2 = ER.RANGE * ER.RANGE, P_ = R.PROP, S = BEs.SIGN_SCALE, O = BEs.SIGN_OFFSET;
    BEs.forEach(function (e) {
      if (e.type !== 'sign') return;
      var dx = e.x + 0.5 - cam.x, dy = e.y + 0.5 - cam.y, dz = e.z + 0.5 - cam.z;
      if (dx * dx + dy * dy + dz * dz > R2) return;
      var st = W.getBlock(e.x, e.y, e.z), nm = st && SR.name ? SR.name(st) : '', m = /_(wall_)?sign$/.exec(nm);
      if (!m) return;
      if (out.length > 7 * 4 * 12000) return;   // the pass indexes with u16: stay under 16383 quads
      var lay = BEs.signTextLayout(e, G.textWidth);
      if (!lay.length) return;
      var a, ox = e.x + 0.5, oy = e.y + 0.5, oz = e.z + 0.5;
      if (m[1]) {
        var f = R.valueNames[SR.propValue(st, P_.facing)];
        a = -(({ south: 0, west: 90, north: 180, east: 270 })[f] || 0) * Math.PI / 180;
        ox -= 0.4375 * Math.sin(a); oz -= 0.4375 * Math.cos(a); oy -= 0.3125;
      } else a = -(parseInt(R.valueNames[SR.propValue(st, P_.rotation)], 10) | 0) * 22.5 * Math.PI / 180;
      ox -= cam.x; oy -= cam.y; oz -= cam.z;   // viewProj is camera-relative (D-179)
      var ca = Math.cos(a), sa = Math.sin(a);
      function put(px, py, dz2, rgb) {
        var lx = px * S, ly = O[1] - py * S, lz = O[2] + dz2;
        out.push(ox + lx * ca + lz * sa, oy + ly, oz - lx * sa + lz * ca,
          (rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255, 1);
      }
      function texel(px, py, dz2, rgb) { put(px, py, dz2, rgb); put(px, py + 1, dz2, rgb); put(px + 1, py + 1, dz2, rgb); put(px + 1, py, dz2, rgb); }
      for (var i = 0; i < lay.length; i++) {
        var q = lay[i], cx = q.x;
        for (var k = 0; k < q.text.length; k++) {
          var ch = q.text.charCodeAt(k); if (ch > 255) ch = 63;
          var tl = signGlyphTexels(ch);
          if (tl) for (var t = 0; t < tl.length; t += 2) {
            if (q.outline >= 0) for (var oyy = -1; oyy <= 1; oyy++) for (var oxx = -1; oxx <= 1; oxx++) if (oxx || oyy) texel(cx + tl[t] + oxx, q.y + tl[t + 1] + oyy, 0.003, q.outline);
            texel(cx + tl[t], q.y + tl[t + 1], 0.0045, q.color);
          }
          cx += G.widths[ch];
        }
      }
    });
    return out;
  };

  // ── elder guardian apparition (#8078) ────────────────────────────────────────────────────
  // ElderGuardianAppearanceParticle.buildGeometry draws GuardianEntityModel (texture guardian_elder, entityTranslucent,
  // alpha = Px.elderGuardianAlpha) at the descriptor Px.elderGuardianDraws gives. The model is NEVER setAngles'd there, so
  // every part sits at its constructor pose (spike pivots at extension 0, eye at its pivot, tails unrotated). It rides this
  // untextured-vertex pass: each box face is one quad in the flat colour of its texture crop (mean of the opaque texels of
  // the face's mob-tile slices). NAMED OMISSION: no per-texel bitmap and no entity shader's per-face shade here.
  var MODEL_FACE_CORNERS = [[1, 5, 7, 3], [4, 0, 2, 6], [2, 3, 7, 6], [4, 5, 1, 0], [5, 4, 6, 7], [0, 1, 3, 2]];
  var mobTileRaw = null, mobTileTried = false;
  /** Mean RGB (0..1) of the opaque texels of the (ox,oy,w,h) window of mob-tile layer `rel`, or null. */
  ER.mobTileMean = function (rel, ox, oy, w, h) {
    if (!mobTileTried) {
      mobTileTried = true;
      var D = NS.DATA;
      if (D && D.mobTiles && NS.Z && D.mobTilesCount) { try { mobTileRaw = NS.Z.unpack(D.mobTiles, D.mobTilesBytes); } catch (e) { mobTileRaw = null; } }
    }
    if (!mobTileRaw || rel < 0 || (rel + 1) * 1024 > mobTileRaw.length) return null;
    var r = 0, g = 0, b = 0, n = 0;
    for (var y = oy; y < oy + h; y++) for (var x = ox; x < ox + w; x++) {
      var i = rel * 1024 + (y * 16 + x) * 4;
      if (mobTileRaw[i + 3] < 128) continue;
      r += mobTileRaw[i]; g += mobTileRaw[i + 1]; b += mobTileRaw[i + 2]; n++;
    }
    return n ? [r / n / 255, g / n / 255, b / n / 255] : null;
  };
  ER.ELDER_FALLBACK_RGB = [0.62, 0.55, 0.45];
  /** One face's flat colour from the mob-geometry slices of (`layerName`, part index `k`, face `f`). */
  ER.faceMeanRGB = function (layerName, k, f) {
    var G = ER.mobGeomFor(layerName), L = G && G[k] && G[k][f];
    if (!L || !L.length) return ER.ELDER_FALLBACK_RGB;
    var base = NS.Atlas && NS.Atlas.mobTile0 ? NS.Atlas.mobTile0 : 0, tb = (mobGeomTable_() || {}).tileBase | 0;
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < L.length; i++) {
      var s = L[i], c = ER.mobTileMean(s.tile - (base || tb), s.ox, s.oy, s.w, s.h);
      if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
    }
    return n ? [r / n, g / n, b / n] : ER.ELDER_FALLBACK_RGB;
  };
  /**
   * The elder guardian apparition's quads, world space: `draw` is one `Px.elderGuardianDraws` entry. Returns
   * `[{ p: [4 x [x,y,z]], rgba: [r,g,b,a] }]`, one per box face (22 boxes -> 132), alpha = `draw.alpha`.
   * model px -> world: origin + (cx*axisX + cy*axisY + cz*axisZ)/16 (axes already carry scale(-1,-1,1)).
   */
  ER.elderGuardianQuads = function (draw) {
    var BE = NS.BEModel, L = BE && BE.layer ? BE.layer('elder_guardian') : null;
    if (!L || !draw) return [];
    var parts = L.parts, out = [], c8 = new Array(24), O = draw.origin, X = draw.axisX, Y = draw.axisY, Z = draw.axisZ;
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k], par = ER.partParentOf('elder_guardian', p.n);
      var pp = par ? ER.fullyPosedPart(parts, 'elder_guardian', null, par) : null;
      if (pp) p = ER.composeChild(pp, p);
      BE.poseBoxCorners(p, c8);
      for (var f = 0; f < 6; f++) {
        var idx = MODEL_FACE_CORNERS[f], q = [];
        for (var c = 0; c < 4; c++) {
          var cx = c8[idx[c] * 3] / 16, cy = c8[idx[c] * 3 + 1] / 16, cz = c8[idx[c] * 3 + 2] / 16;
          q.push([O[0] + cx * X[0] + cy * Y[0] + cz * Z[0], O[1] + cx * X[1] + cy * Y[1] + cz * Z[1], O[2] + cx * X[2] + cy * Y[2] + cz * Z[2]]);
        }
        var rgb = ER.faceMeanRGB('elder_guardian', k, f);
        out.push({ p: q, rgba: [rgb[0], rgb[1], rgb[2], draw.alpha] });
      }
    }
    return out;
  };

  ER.buildCrystalBeamVerts = function (cam, partial) {
    var EL = NS.EntityList;
    var out = [];
    if (cam && !ER.skipSignText) ER.signTextVerts(cam, out);
    if (cam && NS.Particle && NS.Particle.elderGuardianDraws && NS.Particle.list && NS.Particle.list.length) {
      var egd = NS.Particle.elderGuardianDraws(cam, partial);
      for (var gi = 0; gi < egd.length; gi++) {
        var egq = ER.elderGuardianQuads(egd[gi]);
        for (var gq = 0; gq < egq.length; gq++) for (var gk = 0; gk < 4; gk++) {
          var gp = egq[gq].p[gk], gc = egq[gq].rgba;
          out.push(gp[0], gp[1], gp[2], gc[0], gc[1], gc[2], gc[3]);
        }
      }
    }
    if (!EL || !EL.ready || !EL.list || !cam) return out;
    var R2 = ER.RANGE * ER.RANGE;
    var p = [0, 0, 0];
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (!e.removed && e.type === 'lightning_bolt') {
        ER.posAt(e, partial, p);
        var bx = p[0] - cam.x, by = p[1] - cam.y, bz = p[2] - cam.z;
        if (bx * bx + by * by + bz * bz > R2) continue;
        var bq = ER.lightningQuads(e.seed >>> 0), C = ER.LIGHTNING_RGBA;
        for (var q1 = 0; q1 < bq.length; q1++) for (var k1 = 0; k1 < 4; k1++) {
          var v = bq[q1][k1];
          out.push(p[0] + v[0], p[1] + v[1], p[2] + v[2], C[0], C[1], C[2], C[3]);
        }
        continue;
      }
      if (!e.removed && e.type === 'fishing_bobber') {
        ER.posAt(e, partial, p);
        var fx = p[0] - cam.x, fy = p[1] - cam.y, fz = p[2] - cam.z;
        if (fx * fx + fy * fy + fz * fz <= R2) ER.bobberVerts(e, cam, partial, out);
        continue;
      }
      if (!e.removed && e.type === 'ender_dragon' && e.dragon && e.dragon.ticksSinceDeath > 0 && e.dragon.latestSegment >= 0) {
        // #8076 -- the death rays: each triangle goes out as a degenerate quad (a,b,c,c); centre white alpha a, rim magenta alpha 0.
        ER.posAt(e, partial, p);
        var dgx = p[0] - cam.x, dgy = p[1] - cam.y, dgz = p[2] - cam.z;
        if (dgx * dgx + dgy * dgy + dgz * dgz > R2) continue;
        var dr = ER.dragonDeathRays(e.dragon.ticksSinceDeath, partial), dd = e.dragon;
        var dyaw = -dd.getSegmentProperties(7, partial)[0] * DEG2RAD, dpit = (dd.getSegmentProperties(5, partial)[1] - dd.getSegmentProperties(10, partial)[1]) * 10 * DEG2RAD;
        var cy = Math.cos(dyaw), sy = Math.sin(dyaw), cx = Math.cos(dpit), sx = Math.sin(dpit);
        for (var ri = 0; ri < dr.rays.length; ri++) {
          var ray = dr.rays[ri], al = ray.alpha / 255;
          for (var ti = 0; ti < 3; ti++) for (var vi = 0; vi < 4; vi++) {
            var vv = ray.verts[ti * 3 + Math.min(vi, 2)], x1 = vv[0], y1 = vv[1] * cx - vv[2] * sx, z1 = vv[1] * sx + vv[2] * cx;
            var centre = (Math.min(vi, 2) === 0);
            out.push(p[0] + x1 * cy + z1 * sy, p[1] + y1, p[2] - x1 * sy + z1 * cy, 1, centre ? 1 : 0, 1, centre ? al : 0);
          }
        }
        continue;
      }
      if (e.removed || e.type !== 'end_crystal') continue;
      if (!e.beamTarget || typeof e.beamTarget.x !== 'number' ||
          typeof e.beamTarget.y !== 'number' || typeof e.beamTarget.z !== 'number') continue;
      ER.posAt(e, partial, p);
      var dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z;
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      var bobY = ER.crystalYOffset(e, partial);
      var targetXYZ = [e.beamTarget.x + 0.5, e.beamTarget.y + 0.5, e.beamTarget.z + 0.5];
      var quads = ER.crystalBeamQuads(p, targetXYZ, bobY, e.endCrystalAge || 0, partial);
      for (var q = 0; q < quads.length; q++) {
        var quad = quads[q];
        for (var k = 0; k < 4; k++) {
          var pt = quad.p[k], c = quad.rgba[k];
          out.push(pt[0], pt[1], pt[2], c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255);
        }
      }
    }
    return out;
  };
  ER.CRYSTAL_BEAM_VERTEX_FLOATS = 7;   // x,y,z, r,g,b,a (no uv — see the header's named omission)

  // ── WebGL2 ───────────────────────────────────────────────────────────────────────────────

  var crystalBeamGl2 = { prog: null, vbuf: null, ibuf: null, uViewProj: -1, aPos: 0, aColor: 1 };

  function beamGlCompile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Crystal beam shader: ' + log);
    }
    return sh;
  }

  function beamGlEnsureProgram(gl) {
    if (crystalBeamGl2.prog) return true;
    try {
      var VS = [
        '#version 300 es',
        'precision highp float;',
        'in vec3 aPos;', 'in vec4 aColor;',
        'uniform mat4 uViewProj;',
        'out vec4 vColor;',
        'void main() {',
        '  vColor = aColor;',
        '  gl_Position = uViewProj * vec4(aPos, 1.0);',
        '}'
      ].join('\n');
      var FS = [
        '#version 300 es',
        'precision highp float;',
        'in vec4 vColor;',
        'out vec4 fragColor;',
        'void main() { fragColor = vColor; }'
      ].join('\n');
      var vs = beamGlCompile(gl, gl.VERTEX_SHADER, VS);
      var fs = beamGlCompile(gl, gl.FRAGMENT_SHADER, FS);
      var prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, crystalBeamGl2.aPos, 'aPos');
      gl.bindAttribLocation(prog, crystalBeamGl2.aColor, 'aColor');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Crystal beam program: ' + gl.getProgramInfoLog(prog));
      crystalBeamGl2.prog = prog;
      crystalBeamGl2.uViewProj = gl.getUniformLocation(prog, 'uViewProj');
      crystalBeamGl2.vbuf = gl.createBuffer();
      crystalBeamGl2.ibuf = gl.createBuffer();
      return true;
    } catch (err) {
      ER.beamGlError = (err && err.message) || String(err);
      return false;
    }
  }

  /** The WebGL2 render call — dispatched from `ER.renderOrbs`, same one-hook-site shape
   *  `ER.renderOrbsGL2` already uses. */
  ER.renderCrystalBeamsGL2 = function (G, cam, partial, vertsIn, noDepth) {
    if (!G || G.name !== 'webgl2' || !G.backend || !G.backend.gl) return;
    var gl = G.backend.gl;
    if (!beamGlEnsureProgram(gl)) return;
    var verts = vertsIn || ER.buildCrystalBeamVerts(cam, partial);
    if (!verts.length) return;
    var nQuads = verts.length / (4 * ER.CRYSTAL_BEAM_VERTEX_FLOATS);
    var arr = new Float32Array(verts);
    var idx = orbQuadIndices(nQuads);
    gl.useProgram(crystalBeamGl2.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, crystalBeamGl2.vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, crystalBeamGl2.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    var stride = ER.CRYSTAL_BEAM_VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(crystalBeamGl2.aPos);
    gl.enableVertexAttribArray(crystalBeamGl2.aColor);
    gl.vertexAttribPointer(crystalBeamGl2.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(crystalBeamGl2.aColor, 4, gl.FLOAT, false, stride, 3 * 4);
    gl.uniformMatrix4fv(crystalBeamGl2.uViewProj, false, cam.viewProj);
    // translucent (this section's own header) -- blend on, depth WRITE off, depth TEST left
    // exactly as the caller set it (10_gfx.js's own translucent-pass norm, same as the orbs).
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, nQuads * 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.disableVertexAttribArray(crystalBeamGl2.aPos);
    gl.disableVertexAttribArray(crystalBeamGl2.aColor);
  };

  // ── WebGPU ───────────────────────────────────────────────────────────────────────────────

  var beamGpu = { device: null, pipeline: null, pipelineAlways: null, bgl: null, bg: null, uniformBuf: null,
                  vertBuf: null, vertCap: 0, idxBuf: null, idxCap: 0 };

  function beamGpuWGSL() {
    return [
      'struct VP { viewProj : mat4x4<f32> };',
      '@group(0) @binding(0) var<uniform> uVP : VP;',
      'struct VOut {',
      '  @builtin(position) pos : vec4<f32>,',
      '  @location(0) color : vec4<f32>',
      '};',
      '@vertex',
      'fn vs_beam(@location(0) pos : vec3<f32>, @location(1) color : vec4<f32>) -> VOut {',
      '  var o : VOut;',
      '  o.pos = uVP.viewProj * vec4<f32>(pos, 1.0);',
      '  o.color = color;',
      '  return o;',
      '}',
      '@fragment',
      'fn fs_beam(v : VOut) -> @location(0) vec4<f32> {',
      '  return v.color;',
      '}'
    ].join('\n');
  }

  function beamGpuEnsurePipeline(device, format) {
    if (beamGpu.pipeline && beamGpu.device === device) return true;
    try {
      var module = device.createShaderModule({ code: beamGpuWGSL() });
      var bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
        ]
      });
      var layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
      var pipeline = device.createRenderPipeline({
        layout: layout,
        vertex: {
          module: module, entryPoint: 'vs_beam',
          buffers: [{
            arrayStride: ER.CRYSTAL_BEAM_VERTEX_FLOATS * 4, stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x4' }
            ]
          }]
        },
        fragment: {
          module: module, entryPoint: 'fs_beam',
          targets: [{
            format: format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
            }
          }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
      });
      var uniformBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      beamGpu.device = device; beamGpu.pipeline = pipeline; beamGpu.bgl = bgl; beamGpu.uniformBuf = uniformBuf;
      beamGpu.bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: uniformBuf } }] });
      beamGpu.vertBuf = null; beamGpu.vertCap = 0; beamGpu.idxBuf = null; beamGpu.idxCap = 0;
      return true;
    } catch (err) {
      ER.beamGpuError = (err && err.message) || String(err);
      return false;
    }
  }

  /** The WebGPU render call — same contract as `ER.renderCrystalBeamsGL2`. */
  ER.renderCrystalBeamsGPU = function (G, cam, partial, vertsIn, noDepth) {
    var P = G && G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    if (!beamGpuEnsurePipeline(P.device, P.format)) return;
    var verts = vertsIn || ER.buildCrystalBeamVerts(cam, partial);
    if (!verts.length) return;
    var nQuads = verts.length / (4 * ER.CRYSTAL_BEAM_VERTEX_FLOATS);
    var arr = new Float32Array(verts);
    var bytes = arr.byteLength;
    if (!beamGpu.vertBuf || beamGpu.vertCap < bytes) {
      beamGpu.vertBuf = P.device.createBuffer({ size: Math.max(bytes, 256), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      beamGpu.vertCap = Math.max(bytes, 256);
    }
    var idx = orbQuadIndices(nQuads);
    var idxBytes = nQuads * 6 * 2;
    if (!beamGpu.idxBuf || beamGpu.idxCap < idxBytes) {
      beamGpu.idxBuf = P.device.createBuffer({ size: Math.max(idxBytes, 256), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      beamGpu.idxCap = Math.max(idxBytes, 256);
    }
    P.device.queue.writeBuffer(beamGpu.vertBuf, 0, arr.buffer, arr.byteOffset, bytes);
    P.device.queue.writeBuffer(beamGpu.idxBuf, 0, idx.buffer, idx.byteOffset, idxBytes);
    P.device.queue.writeBuffer(beamGpu.uniformBuf, 0, cam.viewProj.buffer, cam.viewProj.byteOffset, 64);
    P.pass.setPipeline(noDepth ? beamGpu.pipelineAlways : beamGpu.pipeline);
    P.pass.setBindGroup(0, beamGpu.bg);
    P.pass.setVertexBuffer(0, beamGpu.vertBuf);
    P.pass.setIndexBuffer(beamGpu.idxBuf, 'uint16');
    P.pass.drawIndexed(nQuads * 6);
  };

  // ── #5623 Glowing outline ────────────────────────────────────────────────────────────────
  // Vanilla draws a glowing entity's silhouette into an outline framebuffer in the team colour
  // (white with no team), visible through walls. Cheap form (rendering is the cheap area): the
  // 12 edges of the entity's bounding box as thin flat-colour bars, depth test OFF, through the
  // beam pass's own programs/pipelines on both backends.
  ER.OUTLINE_ENABLED = true;
  /** `Entity.isGlowing` (client: flag 6 or the Glowing effect). */
  ER.isGlowing = function (e) {
    if (!e || e.removed) return false;
    if (e.glowing || (e.flags & 64)) return true;
    return !!(NS.Effects && NS.Effects.hasStatusEffect && NS.Effects.hasStatusEffect(e, 'glowing'));
  };
  ER.buildOutlineVerts = function (cam, partial) {
    var EL = NS.EntityList, out = [];
    if (!ER.OUTLINE_ENABLED || !EL || !EL.list || !cam || !NS.Entities || !NS.Entities.boxAt) return out;
    var R2 = ER.RANGE * ER.RANGE, p = [0, 0, 0];
    for (var i = 0; i < EL.list.length; i++) {
      var e = EL.list[i];
      if (!ER.isGlowing(e)) continue;
      ER.posAt(e, partial, p);
      var b = NS.Entities.boxAt(e.type, p[0], p[1], p[2]);
      if (!b) continue;
      var dx = p[0] - cam.x, dy = p[1] - cam.y, dz = p[2] - cam.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2) continue;
      var t = 0.03 * Math.max(1, Math.sqrt(d2) / 8), C = (e.teamColor || [1, 1, 1]);
      for (var ed = 0; ed < 12; ed++) {
        var ax = ed >> 2, o1 = (ax + 1) % 3, o2 = (ax + 2) % 3, lo = [0, 0, 0], hi = [0, 0, 0];
        var sa = ed & 1, sb = (ed >> 1) & 1;
        for (var k = 0; k < 3; k++) { lo[k] = b[k] - t; hi[k] = b[k + 3] + t; }
        lo[o1] = hi[o1] = sa ? b[o1 + 3] : b[o1]; lo[o2] = hi[o2] = sb ? b[o2 + 3] : b[o2];
        lo[o1] -= t; hi[o1] += t; lo[o2] -= t; hi[o2] += t;
        // a cuboid lo..hi as 6 quads
        var X = [lo[0], hi[0]], Y = [lo[1], hi[1]], Z = [lo[2], hi[2]];
        var F = [[0,0,0, 0,1,0, 0,1,1, 0,0,1], [1,0,0, 1,0,1, 1,1,1, 1,1,0], [0,0,0, 0,0,1, 1,0,1, 1,0,0],
                 [0,1,0, 1,1,0, 1,1,1, 0,1,1], [0,0,0, 1,0,0, 1,1,0, 0,1,0], [0,0,1, 0,1,1, 1,1,1, 1,0,1]];
        for (var f = 0; f < 6; f++) for (var v = 0; v < 4; v++)
          out.push(X[F[f][v * 3]], Y[F[f][v * 3 + 1]], Z[F[f][v * 3 + 2]], C[0], C[1], C[2], 1);
      }
    }
    return out;
  };
  ER.renderOutlines = function (G, cam) {
    if (!G || !cam || !ER.ready) return;
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    var v = ER.buildOutlineVerts(cam, partial);
    if (!v.length) return;
    if (G.name === 'webgpu') ER.renderCrystalBeamsGPU(G, cam, partial, v, true);
    else if (G.name === 'webgl2') ER.renderCrystalBeamsGL2(G, cam, partial, v, true);
  };

  /** The one dispatcher for the beam pass, called from `ER.renderOrbs` (this file's own one
   *  hook site into 10_gfx.js — see this section's own header for why no second hook is added
   *  there this pass). Same `G.name` branch shape as `ER.renderOrbs` itself. */
  ER.renderCrystalBeams = function (G, cam) {
    if (!G || !cam || !ER.ready) return;
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    if (G.name === 'webgpu') { ER.renderCrystalBeamsGPU(G, cam, partial); return; }
    if (G.name === 'webgl2') { ER.renderCrystalBeamsGL2(G, cam, partial); return; }
  };

  /**
   * The one dispatcher, `10_gfx.js`'s own ONE hook call site — right after
   * `NS.Particle.render(G, cam)`, same frame position (after the world's translucent pass and
   * the particle/leash passes; an orb behind a particle or a rope is not a picture vanilla ever
   * has to resolve either, since none of these are sorted against each other there).
   *
   * ⚠ loop/crystal-beam-render ALSO rides this exact call: this pass owns `07j_entityrender.js`
   * alone (see the beam section's own header above), so the end-crystal beam pass is dispatched
   * from here, right after the orbs, rather than adding a second line to `10_gfx.js`.
   */
  ER.renderOrbs = function (G, cam) {
    if (!G || !cam || !ER.ready) return;
    var partial = NS.Main && NS.Main.partial ? NS.Main.partial() : 1;
    if (G.name === 'webgpu') { ER.renderOrbsGPU(G, cam, partial); }
    else if (G.name === 'webgl2') { ER.renderOrbsGL2(G, cam, partial); }
    // the beam rides through the ONE dispatcher (`ER.renderCrystalBeams`), not the backend
    // functions directly -- so a future pass (or this check's own anti-vacuity) can swap the
    // whole beam pass out by replacing ER.renderCrystalBeams alone, the same single seam
    // ER.renderOrbs itself is swapped through by nothing else in this file, on purpose.
    ER.renderEndPortals(G, cam);
    ER.renderCrystalBeams(G, cam);
    ER.renderOutlines(G, cam);
  };

  /**
   * #5578 -- EndPortalBlockEntityRenderer / EndGatewayBlockEntityRenderer (.decomp, 1.18.2).
   * ⚠ In 1.18.2 the renderer has NO layer count: it emits the cuboid's faces (`shouldDrawSide`) into
   * `RenderLayer.getEndPortal()/getEndGateway()` and the 16 parallax layers live in the core shader
   * (`END_PORTAL_SHADER`), so `ER.END_PORTAL.layers` is the shader's constant, not a per-distance value.
   * Portal: y 0.375..0.75, up/down faces only (`EndPortalBlockEntity.shouldDrawSide`). Gateway: full
   * 0..1 cube, every side whose neighbour does not cull it, plus a beam (`BeaconBlockEntityRenderer.renderBeam`
   * radii 0.15/0.175) while recently generated (magenta, to world top) or on cooldown (purple, 50).
   */
  ER.END_PORTAL = { layers: 16, bottomY: 0.375, topY: 0.75, sky: 'environment/end_sky', tex: 'entity/end_portal' };
  ER.END_GATEWAY = { bottomY: 0, topY: 1, renderDistance: 256, beamTex: 'entity/end_gateway_beam',
                     innerR: 0.15, outerR: 0.175, magenta: [13061821, 'magenta'], purple: [8991416, 'purple'] };
  /** The six faces' quads [x0,x1,y0,y1,z-a,z-b...] in the decomp's order: each is 4 verts (x,y,z). */
  ER.endPortalQuads = function (gateway, drawSide) {
    var b = gateway ? ER.END_GATEWAY.bottomY : ER.END_PORTAL.bottomY, t = gateway ? ER.END_GATEWAY.topY : ER.END_PORTAL.topY;
    var S = [['south', 0, 1, 0, 1, 1, 1, 1, 1], ['north', 0, 1, 1, 0, 0, 0, 0, 0], ['east', 1, 1, 1, 0, 0, 1, 1, 0],
             ['west', 0, 0, 0, 1, 0, 1, 1, 0], ['down', 0, 1, b, b, 0, 0, 1, 1], ['up', 0, 1, t, t, 1, 1, 0, 0]];
    var out = [];
    for (var i = 0; i < S.length; i++) {
      var r = S[i], f = r[0];
      if (!gateway && f !== 'up' && f !== 'down') continue;
      if (drawSide && !drawSide(f)) continue;
      var a = r[1], c = r[2], y0 = r[3], y1 = r[4];
      out.push({ face: f, v: [[a, y0, r[5]], [c, y0, r[6]], [c, y1, r[7]], [a, y1, r[8]]] });
    }
    return out;
  };
  /** The gateway beam for block entity `e` at partial tick `pt`, world time `time`, world top `topY`; null when off. */
  ER.gatewayBeam = function (e, pt, time, topY) {
    var BE = NS.BlockEntities, fresh = BE.gatewayRecentlyGenerated(e);
    if (!fresh && !(e.teleportCooldown > 0)) return null;
    var h = Math.fround(Math.sin(Math.fround((fresh ? BE.gatewayBeamHeight(e, pt) : BE.gatewayCooldownBeamHeight(e, pt)) * Math.PI)));
    var n = Math.floor(h * (fresh ? topY : 50));
    var G = ER.END_GATEWAY;
    return { y0: -n, height: n * 2, scale: h, color: fresh ? G.magenta[0] : G.purple[0],
             time: ((time % 40) + 40) % 40 + pt, innerR: G.innerR, outerR: G.outerR };
  };

  /**
   * #8255 -- THE END PORTAL / END GATEWAY PARALLAX DRAW (`RenderLayer.getEndPortal()/getEndGateway()`, core shader
   * `end_portal`). Every drawn face is a screen-space-projected texture lookup: the end_sky sheet times COLORS[0],
   * plus END_PORTAL.layers (16) lookups into the entity/end_portal sheet, layer `i` (1..16) scaled, rotated and
   * scrolled by `endPortalLayerParams`, each times COLORS[i-1]. One pass in both backends, generated from the
   * ONE table below so the two shaders cannot drift. ⚠ The shader is a resource file, not in .decomp: the table
   * and the layer matrix are the 1.18.2 core shader's constants, pinned by tools/extract-shaders.mjs -> golden/endportal-shader-1.18.2.json (rendertype_end_portal/gateway use the same fsh).
   */
  ER.END_PORTAL_COLORS = [
    [0.022087, 0.098399, 0.110818], [0.011892, 0.095924, 0.089485], [0.027636, 0.101689, 0.100326],
    [0.046564, 0.109883, 0.114838], [0.064901, 0.117696, 0.097189], [0.063761, 0.086895, 0.123646],
    [0.084817, 0.111994, 0.166380], [0.097489, 0.154120, 0.091064], [0.106152, 0.131144, 0.195191],
    [0.097721, 0.110188, 0.187229], [0.133516, 0.138278, 0.148582], [0.070006, 0.243332, 0.235792],
    [0.196766, 0.142899, 0.214696], [0.047281, 0.315338, 0.321970], [0.204675, 0.390010, 0.302066],
    [0.080955, 0.314821, 0.661491]
  ];
  /** Atlas layers of the two whole sheets (assets/be-tiles.meta.json `whole`), 16x16 tiles row-major. */
  ER.END_PORTAL_SHEETS = { portal: { layer: 1949, w: 256, h: 256 }, sky: { layer: 2205, w: 128, h: 128 },
                           beam: { layer: 2269, w: 16, h: 16 } };   // #8634: entity/end_gateway_beam
  ER.END_PORTAL_DRAW = true;
  /** Layer `layer` (1..16) at game time `t` (days): scale k, rotation (rad), translation (tx, ty) in the texture plane. */
  ER.endPortalLayerParams = function (layer, t) {
    return { k: (4.5 - layer / 4) * 2, rot: (layer * layer * 4321 + layer * 9) * 2 * Math.PI / 180,
             tx: 17 / layer, ty: (2 + layer / 1.5) * (t * 1.5) };
  };
  /** (u, v) = projected screen coordinate in 0..1 -> the layer's texture coordinate. */
  ER.endPortalUV = function (u, v, layer, t) {
    var P = ER.endPortalLayerParams(layer, t), c = Math.cos(P.rot), s = Math.sin(P.rot), x = u * P.k, y = v * P.k;
    return [(x * c + y * s + P.tx) * 0.5 + 0.25, (-x * s + y * c + P.ty) * 0.5 + 0.25];
  };
  /** CPU reference of the fragment shader. `skyTex`/`portalTex`: (u, v) -> [r, g, b] (repeat wrap is theirs). */
  ER.endPortalShade = function (u, v, t, skyTex, portalTex) {
    var C = ER.END_PORTAL_COLORS, s = skyTex(u, v), out = [s[0] * C[0][0], s[1] * C[0][1], s[2] * C[0][2]];
    for (var i = 0; i < ER.END_PORTAL.layers; i++) {
      var uv = ER.endPortalUV(u, v, i + 1, t), p = portalTex(uv[0], uv[1]);
      out[0] += p[0] * C[i][0]; out[1] += p[1] * C[i][1]; out[2] += p[2] * C[i][2];
    }
    return out;
  };
  /** Camera-relative triangles-as-quads (x,y,z per vertex, 4 per quad) of every portal / gateway face in range. */
  ER.buildEndPortalVerts = function (cam) {
    var out = [], BE = NS.BlockEntities;
    if (!ER.END_PORTAL_DRAW || !BE || !BE.ready || !cam) return out;
    var R2 = 128 * 128;
    BE.forEach(function (e) {
      var gw = e.type === 'end_gateway';
      if (!gw && e.type !== 'end_portal') return;
      var dx = e.x + 0.5 - cam.x, dy = e.y + 0.5 - cam.y, dz = e.z + 0.5 - cam.z;
      if (dx * dx + dy * dy + dz * dz > R2) return;
      var N = { south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0], down: [0, -1, 0], up: [0, 1, 0] };
      var qs = ER.endPortalQuads(gw, function (f) {
        var o = BE.get(e.x + N[f][0], e.y + N[f][1], e.z + N[f][2]);
        return !(gw && o && o.type === 'end_gateway');
      });
      for (var q = 0; q < qs.length; q++) for (var k = 0; k < 4; k++) {
        var v = qs[q].v[k];
        out.push(e.x + v[0] - cam.x, e.y + v[1] - cam.y, e.z + v[2] - cam.z);
      }
    });
    return out;
  };
  function endPortalGameTime() {
    var W = NS.World, M = NS.Main, tk = W && typeof W.time === 'number' ? W.time : 0;
    return ((tk % 24000) + (M && M.partial ? M.partial() : 0)) / 24000;
  }
  /** The 256x256 / 128x128 RGBA of a whole sheet, stitched from the atlas' 16x16 layers. */
  var endPortalPix = {};
  function endPortalSheet(name) {
    if (endPortalPix[name]) return endPortalPix[name];
    var A = NS.Atlas, S = ER.END_PORTAL_SHEETS[name];
    if (!A || !A.mips || !A.mips[0] || !A.mips[0].data) return null;
    var T = 16, cols = S.w / T, d = A.mips[0].data, out = new Uint8Array(S.w * S.h * 4);
    for (var y = 0; y < S.h; y++) for (var x = 0; x < S.w; x++) {
      var l = S.layer + Math.floor(y / T) * cols + Math.floor(x / T);
      var si = ((l * T + (y % T)) * T + (x % T)) * 4, di = (y * S.w + x) * 4;
      out[di] = d[si]; out[di + 1] = d[si + 1]; out[di + 2] = d[si + 2]; out[di + 3] = 255;
    }
    return (endPortalPix[name] = { w: S.w, h: S.h, rgba: out });
  }
  function f6(n) { return n.toFixed(6); }
  /** Both backends' fragment bodies come from here; `L` = 'glsl' | 'wgsl'. */
  ER.endPortalShaderSrc = function (L) {
    var C = ER.END_PORTAL_COLORS, n = ER.END_PORTAL.layers, g = L === 'glsl';
    var v3 = function (c) { return (g ? 'vec3(' : 'vec3<f32>(') + c.map(f6).join(', ') + ')'; };
    var tbl = C.map(v3).join(',\n  ');
    if (g) {
      return {
        vs: ['#version 300 es', 'precision highp float;', 'in vec3 aPos;', 'uniform mat4 uViewProj;', 'out vec3 vProj;',
          'void main() { vec4 p = uViewProj * vec4(aPos, 1.0); gl_Position = p;',
          '  vProj = vec3(p.x * 0.5 + p.w * 0.5, p.y * 0.5 + p.w * 0.5, p.w); }'].join('\n'),
        fs: ['#version 300 es', 'precision highp float;', 'in vec3 vProj;', 'uniform sampler2D uSky;', 'uniform sampler2D uPortal;',
          'uniform float uTime;', 'out vec4 fragColor;',
          'const vec3 COLORS[' + n + '] = vec3[' + n + '](\n  ' + tbl + ');',
          'vec2 layerUV(vec2 uv, float L) {',
          '  float a = radians((L * L * 4321.0 + L * 9.0) * 2.0), c = cos(a), s = sin(a), k = (4.5 - L / 4.0) * 2.0;',
          '  vec2 q = uv * k; q = vec2(q.x * c + q.y * s, -q.x * s + q.y * c);',
          '  q += vec2(17.0 / L, (2.0 + L / 1.5) * (uTime * 1.5));',
          '  return q * 0.5 + 0.25;',
          '}',
          'void main() {',
          '  vec2 uv = vProj.xy / vProj.w;',
          '  vec3 color = textureLod(uSky, uv, 0.0).rgb * COLORS[0];',
          '  for (int i = 0; i < ' + n + '; i++) color += textureLod(uPortal, layerUV(uv, float(i + 1)), 0.0).rgb * COLORS[i];',
          '  fragColor = vec4(color, 1.0);',
          '}'].join('\n')
      };
    }
    return ['struct U { viewProj : mat4x4<f32>, time : vec4<f32> };',
      '@group(0) @binding(0) var<uniform> u : U;',
      '@group(0) @binding(1) var skyT : texture_2d<f32>;',
      '@group(0) @binding(2) var portalT : texture_2d<f32>;',
      '@group(0) @binding(3) var smp : sampler;',
      'var<private> COLORS : array<vec3<f32>, ' + n + '> = array<vec3<f32>, ' + n + '>(\n  ' + tbl + ');',
      'struct VOut { @builtin(position) pos : vec4<f32>, @location(0) proj : vec3<f32> };',
      '@vertex fn vs_portal(@location(0) aPos : vec3<f32>) -> VOut {',
      '  var o : VOut; let p = u.viewProj * vec4<f32>(aPos, 1.0); o.pos = p;',
      '  o.proj = vec3<f32>(p.x * 0.5 + p.w * 0.5, p.y * 0.5 + p.w * 0.5, p.w); return o; }',
      'fn layerUV(uv : vec2<f32>, L : f32) -> vec2<f32> {',
      '  let a = radians((L * L * 4321.0 + L * 9.0) * 2.0); let c = cos(a); let s = sin(a); let k = (4.5 - L / 4.0) * 2.0;',
      '  var q = uv * k; q = vec2<f32>(q.x * c + q.y * s, -q.x * s + q.y * c);',
      '  q = q + vec2<f32>(17.0 / L, (2.0 + L / 1.5) * (u.time.x * 1.5));',
      '  return q * 0.5 + vec2<f32>(0.25, 0.25);',
      '}',
      '@fragment fn fs_portal(i : VOut) -> @location(0) vec4<f32> {',
      '  let uv = i.proj.xy / i.proj.z;',
      '  var color = textureSampleLevel(skyT, smp, uv, 0.0).rgb * COLORS[0];',
      '  for (var j = 0; j < ' + n + '; j = j + 1) { color = color + textureSampleLevel(portalT, smp, layerUV(uv, f32(j + 1)), 0.0).rgb * COLORS[j]; }',
      '  return vec4<f32>(color, 1.0);',
      '}'].join('\n');
  };

  var portalGl2 = { prog: null, vbuf: null, ibuf: null, skyTex: null, portalTex: null };
  function portalGlTex(gl, name) {
    var s = endPortalSheet(name);
    if (!s) return null;
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s.w, s.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  ER.renderEndPortalsGL2 = function (G, cam, vertsIn) {
    if (!G || G.name !== 'webgl2' || !G.backend || !G.backend.gl) return;
    var gl = G.backend.gl, verts = vertsIn || ER.buildEndPortalVerts(cam);
    if (!verts.length) return;
    try {
      if (!portalGl2.prog) {
        var src = ER.endPortalShaderSrc('glsl'), mk = function (type, s) {
          var sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('End portal shader: ' + gl.getShaderInfoLog(sh));
          return sh;
        };
        var prog = gl.createProgram();
        gl.attachShader(prog, mk(gl.VERTEX_SHADER, src.vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, src.fs));
        gl.bindAttribLocation(prog, 0, 'aPos');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('End portal program: ' + gl.getProgramInfoLog(prog));
        portalGl2.skyTex = portalGlTex(gl, 'sky'); portalGl2.portalTex = portalGlTex(gl, 'portal');
        if (!portalGl2.skyTex || !portalGl2.portalTex) throw new Error('End portal sheets missing from the atlas');
        portalGl2.prog = prog; portalGl2.vbuf = gl.createBuffer(); portalGl2.ibuf = gl.createBuffer();
      }
    } catch (err) { ER.portalGlError = (err && err.message) || String(err); return; }
    var nQuads = verts.length / 12, p = portalGl2.prog;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, portalGl2.vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, portalGl2.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, orbQuadIndices(nQuads), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uViewProj'), false, cam.viewProj);
    gl.uniform1f(gl.getUniformLocation(p, 'uTime'), endPortalGameTime());
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, portalGl2.skyTex);
    gl.uniform1i(gl.getUniformLocation(p, 'uSky'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, portalGl2.portalTex);
    gl.uniform1i(gl.getUniformLocation(p, 'uPortal'), 1);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.drawElements(gl.TRIANGLES, nQuads * 6, gl.UNSIGNED_SHORT, 0);
    gl.enable(gl.CULL_FACE);
    gl.disableVertexAttribArray(0);
    gl.activeTexture(gl.TEXTURE0);
  };

  var portalGpu = { device: null, pipeline: null, bgl: null, bg: null, uniformBuf: null, vertBuf: null, vertCap: 0, idxBuf: null, idxCap: 0 };
  ER.renderEndPortalsGPU = function (G, cam, vertsIn) {
    var P = G && G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    var verts = vertsIn || ER.buildEndPortalVerts(cam);
    if (!verts.length) return;
    var device = P.device;
    try {
      if (portalGpu.device !== device) {
        var module = device.createShaderModule({ code: ER.endPortalShaderSrc('wgsl') });
        var vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        var bgl = device.createBindGroupLayout({ entries: [
          { binding: 0, visibility: vis, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
        var texs = ['sky', 'portal'].map(function (nm) {
          var s = endPortalSheet(nm);
          if (!s) throw new Error('End portal sheets missing from the atlas');
          var t = device.createTexture({ size: [s.w, s.h, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
          device.queue.writeTexture({ texture: t }, s.rgba, { bytesPerRow: s.w * 4, rowsPerImage: s.h }, [s.w, s.h, 1]);
          return t;
        });
        var ub = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var smp = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
        portalGpu.pipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
          vertex: { module: module, entryPoint: 'vs_portal', buffers: [{ arrayStride: 12, stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
          fragment: { module: module, entryPoint: 'fs_portal', targets: [{ format: P.format }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
        });
        portalGpu.bg = device.createBindGroup({ layout: bgl, entries: [
          { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: texs[0].createView() },
          { binding: 2, resource: texs[1].createView() }, { binding: 3, resource: smp }] });
        portalGpu.uniformBuf = ub; portalGpu.device = device; portalGpu.vertBuf = portalGpu.idxBuf = null; portalGpu.vertCap = portalGpu.idxCap = 0;
      }
    } catch (err) { ER.portalGpuError = (err && err.message) || String(err); return; }
    var nQuads = verts.length / 12, arr = new Float32Array(verts), idx = orbQuadIndices(nQuads), ib = nQuads * 12;
    if (!portalGpu.vertBuf || portalGpu.vertCap < arr.byteLength) {
      portalGpu.vertCap = Math.max(arr.byteLength, 256);
      portalGpu.vertBuf = device.createBuffer({ size: portalGpu.vertCap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (!portalGpu.idxBuf || portalGpu.idxCap < ib) {
      portalGpu.idxCap = Math.max(ib, 256);
      portalGpu.idxBuf = device.createBuffer({ size: portalGpu.idxCap, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    device.queue.writeBuffer(portalGpu.vertBuf, 0, arr.buffer, arr.byteOffset, arr.byteLength);
    device.queue.writeBuffer(portalGpu.idxBuf, 0, idx.buffer, idx.byteOffset, ib);
    var u = new Float32Array(20); u.set(cam.viewProj, 0); u[16] = endPortalGameTime();
    device.queue.writeBuffer(portalGpu.uniformBuf, 0, u.buffer, 0, 80);
    P.pass.setPipeline(portalGpu.pipeline);
    P.pass.setBindGroup(0, portalGpu.bg);
    P.pass.setVertexBuffer(0, portalGpu.vertBuf);
    P.pass.setIndexBuffer(portalGpu.idxBuf, 'uint16');
    P.pass.drawIndexed(nQuads * 6);
  };

  /**
   * #8634 -- THE END GATEWAY BEAM (`EndGatewayBlockEntityRenderer.render` -> `BeaconBlockEntityRenderer.renderBeam`,
   * .decomp): `ER.gatewayBeam`'s yOffset/height through `ER.beaconBeamVerts` (inner prism alpha 1, outer 0.125),
   * textured with entity/end_gateway_beam. Camera-relative, 9 floats a vertex (x y z r g b a u v), 4 a quad.
   */
  ER.GATEWAY_BEAM_DRAW = true;
  ER.buildGatewayBeamVerts = function (cam, time, pt) {
    var out = [], BE = NS.BlockEntities;
    if (!ER.GATEWAY_BEAM_DRAW || !BE || !BE.ready || !cam) return out;
    var R2 = ER.END_GATEWAY.renderDistance * ER.END_GATEWAY.renderDistance, G = ER.END_GATEWAY;
    BE.forEach(function (e) {
      if (e.type !== 'end_gateway') return;
      var dx = e.x + 0.5 - cam.x, dy = e.y + 0.5 - cam.y, dz = e.z + 0.5 - cam.z;
      if (dx * dx + dy * dy + dz * dz > R2) return;
      var b = ER.gatewayBeam(e, pt, time, 256);
      if (!b || b.height <= 0) return;
      var c = b.color, vs = ER.beaconBeamVerts([[((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, b.height]],
                                              time, pt, b.innerR, b.outerR, { y0: b.y0, height: b.height });
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        out.push(e.x + v[0] - cam.x, e.y + v[1] - cam.y, e.z + v[2] - cam.z, v[3], v[4], v[5], v[6], v[7], v[8]);
      }
    });
    return out;
  };
  /** Both backends' beam shaders from one body: texture x vertex colour, alpha blended. */
  ER.gatewayBeamShaderSrc = function (L) {
    if (L === 'glsl') return {
      vs: ['#version 300 es', 'precision highp float;', 'layout(location=0) in vec3 aPos;', 'layout(location=1) in vec4 aCol;',
        'layout(location=2) in vec2 aUV;', 'uniform mat4 uViewProj;', 'out vec4 vCol;', 'out vec2 vUV;',
        'void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vCol = aCol; vUV = aUV; }'].join('\n'),
      fs: ['#version 300 es', 'precision highp float;', 'in vec4 vCol;', 'in vec2 vUV;', 'uniform sampler2D uTex;', 'out vec4 fragColor;',
        'void main() { fragColor = textureLod(uTex, vUV, 0.0) * vCol; }'].join('\n')
    };
    return ['struct U { viewProj : mat4x4<f32> };',
      '@group(0) @binding(0) var<uniform> u : U;',
      '@group(0) @binding(1) var tex : texture_2d<f32>;',
      '@group(0) @binding(2) var smp : sampler;',
      'struct VOut { @builtin(position) pos : vec4<f32>, @location(0) col : vec4<f32>, @location(1) uv : vec2<f32> };',
      '@vertex fn vs_beam(@location(0) aPos : vec3<f32>, @location(1) aCol : vec4<f32>, @location(2) aUV : vec2<f32>) -> VOut {',
      '  var o : VOut; o.pos = u.viewProj * vec4<f32>(aPos, 1.0); o.col = aCol; o.uv = aUV; return o; }',
      '@fragment fn fs_beam(i : VOut) -> @location(0) vec4<f32> { return textureSampleLevel(tex, smp, i.uv, 0.0) * i.col; }'].join('\n');
  };
  function gatewayBeamTime() {
    var W = NS.World, M = NS.Main;
    return { time: W && typeof W.time === 'number' ? W.time : 0, pt: M && M.partial ? M.partial() : 0 };
  }
  var gwBeamGl2 = { prog: null, vbuf: null, ibuf: null, tex: null };
  ER.renderGatewayBeamGL2 = function (G, cam, vertsIn) {
    if (!G || G.name !== 'webgl2' || !G.backend || !G.backend.gl) return;
    var gl = G.backend.gl, T = gatewayBeamTime(), verts = vertsIn || ER.buildGatewayBeamVerts(cam, T.time, T.pt);
    if (!verts.length) return;
    try {
      if (!gwBeamGl2.prog) {
        var src = ER.gatewayBeamShaderSrc('glsl'), mk = function (type, s) {
          var sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Gateway beam shader: ' + gl.getShaderInfoLog(sh));
          return sh;
        };
        var prog = gl.createProgram();
        gl.attachShader(prog, mk(gl.VERTEX_SHADER, src.vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, src.fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Gateway beam program: ' + gl.getProgramInfoLog(prog));
        gwBeamGl2.tex = portalGlTex(gl, 'beam');
        if (!gwBeamGl2.tex) throw new Error('Gateway beam sheet missing from the atlas');
        gwBeamGl2.prog = prog; gwBeamGl2.vbuf = gl.createBuffer(); gwBeamGl2.ibuf = gl.createBuffer();
      }
    } catch (err) { ER.beamGlError = (err && err.message) || String(err); return; }
    var nQuads = verts.length / 36, p = gwBeamGl2.prog;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gwBeamGl2.vbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gwBeamGl2.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, orbQuadIndices(nQuads), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 36, 12);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 36, 28);
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uViewProj'), false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gwBeamGl2.tex);
    gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
    gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, nQuads * 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(0);
  };

  var gwBeamGpu = { device: null, pipeline: null, bg: null, uniformBuf: null, vertBuf: null, vertCap: 0, idxBuf: null, idxCap: 0 };
  ER.renderGatewayBeamGPU = function (G, cam, vertsIn) {
    var P = G && G.backend;
    if (!P || !P.device || !P.pass || P.lost) return;
    var T = gatewayBeamTime(), verts = vertsIn || ER.buildGatewayBeamVerts(cam, T.time, T.pt);
    if (!verts.length) return;
    var device = P.device;
    try {
      if (gwBeamGpu.device !== device) {
        var module = device.createShaderModule({ code: ER.gatewayBeamShaderSrc('wgsl') });
        var bgl = device.createBindGroupLayout({ entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
        var s = endPortalSheet('beam');
        if (!s) throw new Error('Gateway beam sheet missing from the atlas');
        var t = device.createTexture({ size: [s.w, s.h, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        device.queue.writeTexture({ texture: t }, s.rgba, { bytesPerRow: s.w * 4, rowsPerImage: s.h }, [s.w, s.h, 1]);
        var ub = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var smp = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
        var blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
        gwBeamGpu.pipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
          vertex: { module: module, entryPoint: 'vs_beam', buffers: [{ arrayStride: 36, stepMode: 'vertex', attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x4' },
            { shaderLocation: 2, offset: 28, format: 'float32x2' }] }] },
          fragment: { module: module, entryPoint: 'fs_beam', targets: [{ format: P.format, blend: blend }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
        });
        gwBeamGpu.bg = device.createBindGroup({ layout: bgl, entries: [
          { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: smp }] });
        gwBeamGpu.uniformBuf = ub; gwBeamGpu.device = device; gwBeamGpu.vertBuf = gwBeamGpu.idxBuf = null; gwBeamGpu.vertCap = gwBeamGpu.idxCap = 0;
      }
    } catch (err) { ER.beamGpuError = (err && err.message) || String(err); return; }
    var nQuads = verts.length / 36, arr = new Float32Array(verts), idx = orbQuadIndices(nQuads), ib = nQuads * 12;
    if (!gwBeamGpu.vertBuf || gwBeamGpu.vertCap < arr.byteLength) {
      gwBeamGpu.vertCap = Math.max(arr.byteLength, 256);
      gwBeamGpu.vertBuf = device.createBuffer({ size: gwBeamGpu.vertCap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (!gwBeamGpu.idxBuf || gwBeamGpu.idxCap < ib) {
      gwBeamGpu.idxCap = Math.max(ib, 256);
      gwBeamGpu.idxBuf = device.createBuffer({ size: gwBeamGpu.idxCap, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    device.queue.writeBuffer(gwBeamGpu.vertBuf, 0, arr.buffer, arr.byteOffset, arr.byteLength);
    device.queue.writeBuffer(gwBeamGpu.idxBuf, 0, idx.buffer, idx.byteOffset, ib);
    device.queue.writeBuffer(gwBeamGpu.uniformBuf, 0, new Float32Array(cam.viewProj).buffer, 0, 64);
    P.pass.setPipeline(gwBeamGpu.pipeline);
    P.pass.setBindGroup(0, gwBeamGpu.bg);
    P.pass.setVertexBuffer(0, gwBeamGpu.vertBuf);
    P.pass.setIndexBuffer(gwBeamGpu.idxBuf, 'uint16');
    P.pass.drawIndexed(nQuads * 6);
  };
  ER.renderGatewayBeams = function (G, cam) {
    if (G.name === 'webgpu') ER.renderGatewayBeamGPU(G, cam);
    else if (G.name === 'webgl2') ER.renderGatewayBeamGL2(G, cam);
  };
  /** Dispatcher, called from `ER.renderOrbs` (the one hook site this file has into 10_gfx.js). */
  ER.renderEndPortals = function (G, cam) {
    if (!G || !cam || !ER.ready) return;
    if (G.name === 'webgpu') ER.renderEndPortalsGPU(G, cam);
    else if (G.name === 'webgl2') ER.renderEndPortalsGL2(G, cam);
    ER.renderGatewayBeams(G, cam);   // #8634: after the opaque parallax faces, blended
  };

  /**
   * #5908 -- `InventoryScreen.drawEntity` (.decomp) for the horse screen: the animal's posed quads, as
   * screen-ready triangles, through the SAME `ER.visible` -> `ER.emitMobLayer` path the world uses (so the
   * saddle, armour, marking, chest and llama-carpet layers come out exactly as in the world). The entity is
   * a delegating clone (the real one is never written); `bodyYaw`/`headYaw`/`pitch` are vanilla's
   * `180 + atan(dx/40)*20`, `180 + atan(dx/40)*40`, `-atan(dy/40)*20` in degrees. Returns
   * `[{ x:[4], y:[4], z:[4], u:[4], v:[4], tile, face }]` in BLOCKS, +y up, origin at the feet; null if unbuilt.
   */
  ER.PREVIEW_SIDE = 1;   // +1: world +x is screen-right (the viewer on the +z side); -1 mirrors
  ER.previewQuads = function (e, bodyYaw, headYaw, pitch) {
    var EL = NS.EntityList, M = NS.Mesher, U = CFG.MODEL_UNITS_PER_BLOCK;
    if (!ER.ready || !EL || !EL.ready || !EL.list || !M) return null;
    var c = Object.create(e);
    c.px = c.x = 0; c.py = c.y = 0; c.pz = c.z = 0;
    c.yaw = c.yawO = c.yBodyRot = c.yBodyRotO = bodyYaw;
    c.yHeadRot = c.yHeadRotO = headYaw; c.xHeadRot = c.xHeadRotO = pitch;
    c.hurtTime = 0; c.deathTime = 0; c.animSpeed = c.animSpeedO = 0; c.animPos = 0;
    var saved = EL.list, items;
    EL.list = [c];
    try { items = ER.visible(0, 0, 0, 1); } finally { EL.list = saved; }
    var tris = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.shape !== 'mob' || it.outlineOnly || !it.mobLayer) continue;
      var n = ER.mobQuadCount(it.mobLayer, it.texKey);
      if (!n) continue;
      var buf = M.allocBuffer(0, 0, 0, [n * 2, 0, 0]), hdr = M.readHeader(buf);
      var out = new Uint32Array(buf, hdr.modelOff[0], n * 2 * 16);
      var animObj = it.elytra ? ER.elytraAnim(it.e, 1) : ER.animOf(it.e, 1), yaw = ER.dragonYaw(it.e, 1);
      var o = ER.emitMobLayer(out, 0, it.mobLayer, 0, 0, 0, Math.cos(yaw), Math.sin(yaw), 15, 0, 0, animObj,
        undefined, it.texKey, false, it.tintRGB || null, ER.mobScale(it.e, 1), it.hideParts || ER.standHide(it.e) || (NS.Mount && NS.Mount.hideChestParts ? NS.Mount.hideChestParts(it.e) : null));
      for (var q = 0; q + 16 <= o; q += 16) {
        var t = { x: [], y: [], z: [], u: [], v: [], tile: 0, face: 0 };
        for (var k = 0; k < 4; k++) {
          var vv = M.unpackModelVertex(out[q + k * 4], out[q + k * 4 + 1], out[q + k * 4 + 2], out[q + k * 4 + 3]);
          t.x.push(vv.px / U); t.y.push(vv.py / U); t.z.push(vv.pz / U);
          t.u.push(vv.u / 16); t.v.push(vv.v / 16); t.tile = vv.tile; t.face = vv.face;
        }
        tris.push(t);
      }
    }
    return tris;
  };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
