// src/07zzs_minecartrender.js -- #1564 (G25): the MINECART's model + renderer.
//
// Ported from .decomp/net/minecraft/client/render/entity/MinecartEntityRenderer.java (render),
// TntMinecartEntityRenderer.java (fuse scale) and model/MinecartEntityModel.java (the five boxes).
//   * The BOXES are the `minecart` / `chest_minecart` / `furnace_minecart` / `hopper_minecart` /
//     `tnt_minecart` / `spawner_minecart` / `command_block_minecart` layers in models.bin (all seven
//     are MinecartEntityModel.getTexturedModelData, 64x32, `textures/entity/minecart.png` for every
//     one -- the ENTITY TEXTURE never varies with the cart type; only the display block does).
//     tools/minecartmodelcheck.mjs holds them against the Java.
//   * The PoseStack (outermost first): translate(rand jitter ~0.002); [rail snap translate];
//     translate(0, .375, 0); rotY(180 - yaw); rotZ(-pitch); [damage wobble: rotX(sin(t)*t*s/10*side)];
//     then (display block only) scale(.75), translate(-.5, (offset-8)/16, .5), rotY(90) [tnt: fuse
//     scale]; then scale(-1,-1,1) for the model. The model draws through `anim.sleepPose` exactly
//     like the boat (ER.boatAnimOf): R = every rotation folded, dy = .375, dx/dz = the rail snap.
//
// Entity fields read (all defensive, the cart logic that sets them lives elsewhere):
//   e.cartYaw / e.cartYawO       vanilla heading in DEGREES (the java getYaw()); absent -> the engine yaw + 180
//   e.cartPitch / e.cartPitchO   vanilla pitch in degrees; absent -> 0
//   e.cartDamageWobble           { ticks, strength, side } (or e.damageWobbleTicks/Strength/Side)
//   e.displayBlockState          a block state (0 = air = nothing drawn); absent -> the type's default block
//   e.displayOffset              getBlockOffset (default 6; chest cart 8, hopper cart 1)
//   e.cartSnap(x,y,z,off)        optional AbstractMinecartEntity.snapPositionToRail[WithOffset] -> [x,y,z] | null
//                                (off === undefined means snapPositionToRail)
//   e.cartFuse                   TNT cart fuse (-1 / absent = unlit)
//   e.lit                        furnace cart's default block `lit`
//   e.id                         the render jitter seed
(function (NS) {
  'use strict';
  var ER = NS.EntityRender;
  if (!ER) return;
  var MR = NS.MinecartRender = {};

  MR.TYPES = ['minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart',
              'spawner_minecart', 'command_block_minecart'];
  MR.is = function (type) { return MR.TYPES.indexOf(type) >= 0; };
  /** `getDefaultContainedBlock`'s block name per type (minecart = air = none). */
  MR.DEFAULT_BLOCK = { chest_minecart: 'chest', furnace_minecart: 'furnace', hopper_minecart: 'hopper',
                       tnt_minecart: 'tnt', spawner_minecart: 'spawner', command_block_minecart: 'command_block' };
  /** `getDefaultBlockOffset`: AbstractMinecartEntity 6, ChestMinecartEntity 8, HopperMinecartEntity 1. */
  MR.DEFAULT_OFFSET = { chest_minecart: 8, hopper_minecart: 1 };
  MR.BLOCK_SCALE = 0.75;
  MR.BASE_LIFT = 0.375;

  /** What this renderer still does not do, named. */
  MR.OWED = ['chest_minecart block is the chest item model (renderBlockAsEntity builtin) via the be part, no lid state'];

  function mul(a, b) {
    var r = new Array(9);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  }
  function ry(deg) { var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rz(deg) { var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function rx(deg) { var t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function app(m, v) {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  }
  function lerpDeg(t, a, b) { return a + (b - a) * t; }

  /** `(((float)(r >> k & 7) + 0.5F) / 8 - 0.5F) * 0.004F` for the three jitter axes, 64-bit exactly. */
  MR.jitter = function (id) {
    if (typeof BigInt === 'undefined') return [0, 0, 0];
    var w = function (x) { return BigInt.asIntN(64, x); };
    var a = w(BigInt(id | 0) * 493286711n);
    a = w(w(a * a * 4392167121n) + w(a * 98761n));
    var f = function (sh) { return (Number((a >> sh) & 7n) + 0.5) / 8 - 0.5; };
    return [f(16n) * 0.004, f(20n) * 0.004, f(24n) * 0.004];
  };

  /** The live rail lookup (NS.Minecart.snapPositionToRail[WithOffset]) in the [x,y,z] shape `pose` reads; null off a rail. */
  MR.railSnap = function (x, y, z, off) {
    var Mc = NS.Minecart;
    if (!Mc || !Mc.snapPositionToRail || !(Mc.world || NS.World)) return null;
    var r = off === undefined ? Mc.snapPositionToRail(x, y, z) : Mc.snapPositionToRailWithOffset(x, y, z, off);
    return r ? [r.x, r.y, r.z] : null;
  };

  function wobbleOf(e) {
    var w = e.cartDamageWobble;
    if (w && typeof w === 'object') return { t: w.ticks || 0, s: w.strength || 0, side: w.side === undefined ? 1 : w.side };
    return { t: e.damageWobbleTicks || 0, s: e.damageWobbleStrength || 0, side: e.damageWobbleSide === undefined ? 1 : e.damageWobbleSide };
  }

  /**
   * The whole pose of one cart at `partial`, `p` = the interpolated entity position. Returns
   *   { R (block frame, no model flip), RM (R * diag(-1,-1,1)), dx, dy, dz (world offset of the model origin) }.
   */
  MR.pose = function (e, partial, p) {
    var t = partial === undefined ? 1 : partial;
    var cc = e.cartClient;
    if (cc) {
      p = [cc.xO + (cc.x - cc.xO) * t, cc.yO + (cc.y - cc.yO) * t, cc.zO + (cc.z - cc.zO) * t];
    }
    var yaw = cc ? cc.yawO + (cc.yaw - cc.yawO) * t : e.cartYaw !== undefined
      ? (e.cartYawO === undefined ? e.cartYaw : e.cartYawO + (((((e.cartYaw - e.cartYawO) % 360) + 540) % 360) - 180) * t)
      : ER.yawAt(e, t) * 57.2957763671875 + 180;
    var pitch = cc ? cc.pitchO + (cc.pitch - cc.pitchO) * t : e.cartPitch !== undefined ? lerpDeg(t, e.cartPitchO === undefined ? e.cartPitch : e.cartPitchO, e.cartPitch) : 0;
    var dx = 0, dy = 0, dz = 0;
    var snap = typeof e.cartSnap === 'function' ? e.cartSnap : MR.railSnap;
    if (snap && p) {
      var s0 = snap(p[0], p[1], p[2]);
      if (s0) {
        var a = snap(p[0], p[1], p[2], 0.3) || s0, b = snap(p[0], p[1], p[2], -0.3) || s0;
        dx = s0[0] - p[0]; dy = (a[1] + b[1]) / 2 - p[1]; dz = s0[2] - p[2];
        var vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2], l = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (l !== 0) {
          vx /= l; vy /= l; vz /= l;
          yaw = Math.atan2(vz, vx) * 180 / Math.PI;
          pitch = Math.atan(vy) * 73;
        }
      }
    }
    var R = mul(ry(180 - yaw), rz(-pitch));
    var w = wobbleOf(e), wt = w.t - t, ws = w.s - t;
    if (ws < 0) ws = 0;
    if (wt > 0) R = mul(R, rx(Math.sin(wt) * wt * ws / 10 * w.side));
    var j = e.id !== undefined ? MR.jitter(e.id) : [0, 0, 0];
    return { R: R, RM: mul(R, [-1, 0, 0, 0, -1, 0, 0, 0, 1]), dx: dx + j[0], dy: dy + j[1] + MR.BASE_LIFT, dz: dz + j[2] };
  };

  /** `anim` for `ER.animOf`: the boat's own `sleepPose` slot (no limb animation). */
  MR.animOf = function (e, partial, p) {
    if (!p && ER.posAt) ER.posAt(e, partial, p = [0, 0, 0]);
    var P = MR.pose(e, partial, p || null);
    return { sleepPose: { R: P.RM, dx: P.dx, dy: P.dy, dz: P.dz }, deltaFor: function () { return null; } };
  };

  /** The display block: `{ state, part, layer, c, m }` (the mushroom shape's contract) or null. */
  MR.blockFor = function (e, partial, p) {
    var S = NS.States;
    if (!p && ER.posAt) ER.posAt(e, partial, p = [0, 0, 0]);
    if (!S) return null;
    var state = e.displayBlockState;
    if (state === undefined || state === null) {
      var nm = MR.DEFAULT_BLOCK[e.type];
      state = nm ? (nm === 'furnace' ? S.withLocal('furnace', e.lit ? 0 : 1) : S.stateOf(nm) | 0) : 0;
    }
    if (!(state > 0)) return null;
    var off = e.displayOffset !== undefined ? e.displayOffset : (MR.DEFAULT_OFFSET[e.type] === undefined ? 6 : MR.DEFAULT_OFFSET[e.type]);
    var P = MR.pose(e, partial, p || null);
    var k = 1, fz = e.cartFuse;
    if (e.type === 'tnt_minecart' && fz > -1 && fz - partial + 1 < 10) {   // TntMinecartEntityRenderer
      var f = 1 - (fz - partial + 1) / 10;
      f = f < 0 ? 0 : f > 1 ? 1 : f; f *= f; f *= f; k = 1 + f * 0.3;
    }
    var Y = ry(90), sc = MR.BLOCK_SCALE;
    var cb = app(Y, [0.5 * k, 0.5 * k, 0.5 * k]);
    cb = [(cb[0] - 0.5) * sc, (cb[1] + (off - 8) / 16) * sc, (cb[2] + 0.5) * sc];
    var cw = app(P.R, cb), lin = mul(P.R, Y), m = new Array(9);
    for (var i = 0; i < 9; i++) m[i] = lin[i] * sc * k;
    var out = { state: state, part: undefined, layer: ER.layerOf(state), c: [cw[0] + P.dx, cw[1] + P.dy, cw[2] + P.dz], m: m,
                white: (e.type === 'tnt_minecart' && fz > -1 && ((fz / 5) | 0) % 2 === 0) ? 1 : 0 };   // renderFlashingBlock(fuse/5%2==0)
    // a block with no baked quads (the chest) draws as its block-entity item model
    if (S.vis && NS.Reg && NS.Reg.partFor && ER.quadCount && !ER.quadCount(state, 0, 0, 0)) {
      var IT = NS.Items, nm2 = MR.DEFAULT_BLOCK[e.type], idx = IT && IT.ready && nm2 ? IT.of(nm2) : -1;
      var part = idx >= 0 ? ER.bePartOf(ER.beIndexOf(idx)) : -1;
      if (!(part >= 0)) return null;
      out.part = part; out.layer = NS.CFG.LAYER_OPAQUE;
    }
    return out;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
