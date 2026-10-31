// 14k_hand3d.js — PLAN G10d: THE FIRST-PERSON HAND, AS REAL GEOMETRY (D-359).
// Runs on: MAIN THREAD ONLY. Builds one float vertex buffer a frame; no DOM, no GL.
//
// ⚠⚠ **WHY THIS FILE EXISTS, AND WHY THE THING IT REPLACES COULD NEVER HAVE WORKED.**
// Dan, 15 Sept 2026: *"items in your hand are still not even close to vanilla … theres no sway
// in the hand and hand models like the real game … i told last session to fix these and it
// wasnt even close."*
//
// He is describing a structural fact, not a tuning problem. Until tonight the held item was a
// **software-rasterised sprite blitted onto the 2D HUD canvas** (D-273, then D-311, then D-320,
// then D-328 — four decisions spent making a flat picture look less flat). A 2D blit has three
// degrees of freedom: where, how big, and one rotation in the plane of the screen. Vanilla's
// hand has **twelve** — it is a model in three dimensions, drawn through a perspective
// projection, and every part of what Dan calls "sway" lives in the axes a blit does not have:
//
//   · the item is rotated 45° about Y and tipped toward you — you see two faces of a block;
//   · the swing arcs it AWAY from the camera and back, which is depth, not scale;
//   · the hand LAGS the camera by a tenth of your look delta, so it trails when you turn;
//   · the whole view bobs as you walk, and the item bobs with it in a different phase;
//   · a new item rises into frame from below.
//
// **None of those five is expressible as a blit**, which is why four sessions of tuning did not
// converge. So the 2D path is DELETED (D-139) and this draws the real thing.
//
// ⚠ **EVERY NUMBER BELOW COMES FROM `tools/golden/handrender-1.18.2.json`**, which
// `tools/extract-handrender.mjs` reads out of the 1.18.2 client jar by float-constant
// fingerprint — `ItemInHandRenderer` is the one class of 6,352 holding {0.56, -0.52, -0.72}.
// `tools/handposecheck.mjs` asserts this file's constants against that file, so a typo in the
// port fails the suite instead of looking slightly wrong on screen. Nothing here is remembered.
//
// ⚠ **THE PIPELINE IT DRAWS THROUGH IS THE ONE THAT ALREADY EXISTED.** An item in your hand is
// the same baked geometry as the block in the world (`Reg.qPos`/`qUv`/`qTile`) or the same
// extruded sprite as the dropped item (D-342's sprite parts). What is new is a POSE and a pass
// — not a second source of geometry, because a second source is how a hand ends up showing a
// different block from the hotbar (D-314's rule).

(function (NS) {
  'use strict';

  var H3 = NS.Hand3D = { ready: false };
  var CFG = NS.CFG;

  // ── vanilla's constants, each asserted against the golden file by handposecheck ───────────
  /** `ItemInHandRenderer.applyItemArmTransform` — where the hand IS. */
  H3.HAND_X = 0.56; H3.HAND_Y = -0.52; H3.HAND_EQUIP_Y = -0.6; H3.HAND_Z = -0.72;
  /** `applyItemArmAttackTransform` — the swing. ⚠ -20 appears TWICE, on two different axes. */
  H3.SWING_Y_BASE = 45.0; H3.SWING_Y_SWING = -20.0;
  H3.SWING_Z = -20.0; H3.SWING_X = -80.0; H3.SWING_Y_BACK = -45.0;
  /** `renderArmWithItem`'s own pre-swing offset, the one that arcs the item away from you. */
  H3.ITEM_SWING_X = -0.4; H3.ITEM_SWING_Y = 0.2; H3.ITEM_SWING_Z = -0.2;
  /** `renderFirstPersonItem`'s BOW use-action branch (HeldItemRenderer.java:410-433), i = +1. */
  H3.BOW_T = [-0.2785682, 0.18344387, 0.15731531];
  H3.BOW_ROT_X = -13.935; H3.BOW_ROT_Y = 35.3; H3.BOW_ROT_Z = -9.785;
  H3.BOW_SHAKE_MIN = 0.1; H3.BOW_SHAKE_FREQ = 1.3; H3.BOW_SHAKE_Y = 0.004;
  H3.BOW_PULL_Z = 0.04; H3.BOW_STRETCH = 0.2; H3.BOW_TURN_Y = 45.0;
  /** `renderPlayerArm` — the empty hand. */
  H3.ARM_X = 0.64000005; H3.ARM_Y = -0.6; H3.ARM_Z = -0.71999997;
  H3.ARM_SWING_X = -0.3; H3.ARM_SWING_Y = 0.4; H3.ARM_SWING_Z = -0.4;
  H3.ARM_ROT_Y = 45.0; H3.ARM_SWING_ROT_Y = 70.0; H3.ARM_SWING_ROT_Z = -20.0;
  /** ...and its skin-model tail, which is what turns Mojang's upside-down humanoid over. */
  H3.ARM_TAIL_T = [-1.0, 3.6, 3.5];
  H3.ARM_TAIL_Z = 120.0; H3.ARM_TAIL_X = 200.0; H3.ARM_TAIL_Y = -135.0;
  H3.ARM_TAIL_T2 = 5.6;
  /** `PlayerModel`'s wide right arm: `PartPose.offset(-5, 2, 0)`, in Mojang pixels. */
  H3.ARM_PART = [-5, 2, 0];
  /** `BipedEntityModel.setAngles` runs `CrossbowPosing.swingArm(rightArm, 0, 1)` for an empty hand:
   *  roll += 1 * (cos(0 * 0.09) * 0.05 + 0.05) = 0.1 rad, applied by `ModelPart.rotate` after the pivot translate. */
  H3.ARM_ROLL_RAD = Math.cos(0) * 0.05 + 0.05;
  /** `GameRenderer.bobView` — the walk bob. */
  H3.BOB_TRANSLATE = 0.5; H3.BOB_ROLL = 3.0; H3.BOB_PITCH_PHASE = 0.2; H3.BOB_PITCH = 5.0;
  /** `GameRenderer.bobHurt` — the hurt roll and the death tilt. */
  H3.HURT_ROLL = 14.0; H3.DEATH_TILT_A = 40.0; H3.DEATH_TILT_B = 8000.0; H3.DEATH_TILT_C = 200.0;
  /** `renderHandsWithItems` — the hand trails the camera by a TENTH of the look delta. */
  H3.HAND_LOOK_LAG = 0.1;

  /**
   * ⚠ THE PIVOT. `ItemRenderer.render` translates by (-0.5, -0.5, -0.5) AFTER the display
   * transform, so every model is posed about its own centre. Leaving it out puts the item's
   * corner where its middle should be, which reads as "the item is in the wrong place" and is
   * the single easiest thing to get wrong in this whole file.
   */
  H3.MODEL_PIVOT = 0.5;

  // ── 4x4, column-major, same layout as `U.mat4` so the projection can multiply it ──────────
  // ⚠ POST-MULTIPLY, BECAUSE THAT IS WHAT A `PoseStack` IS. `ps.translate(); ps.mulPose(r);`
  // means M = M * T * R — each call is applied in the CHILD's space, not the world's. A stack
  // that pre-multiplies produces a hand that is in roughly the right place and rotates about
  // the camera instead of about itself, which looks like a bug in the swing.
  function mIdent(m) {
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
  }
  var tmpA = new Float32Array(16), tmpB = new Float32Array(16);
  /** m = m * b, in place. */
  function mMul(m, b) {
    for (var c = 0; c < 4; c++) {
      var b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      tmpA[c * 4]     = m[0] * b0 + m[4] * b1 + m[8]  * b2 + m[12] * b3;
      tmpA[c * 4 + 1] = m[1] * b0 + m[5] * b1 + m[9]  * b2 + m[13] * b3;
      tmpA[c * 4 + 2] = m[2] * b0 + m[6] * b1 + m[10] * b2 + m[14] * b3;
      tmpA[c * 4 + 3] = m[3] * b0 + m[7] * b1 + m[11] * b2 + m[15] * b3;
    }
    for (var i = 0; i < 16; i++) m[i] = tmpA[i];
    return m;
  }
  function mTranslate(m, x, y, z) {
    mIdent(tmpB); tmpB[12] = x; tmpB[13] = y; tmpB[14] = z;
    return mMul(m, tmpB);
  }
  function mScale(m, x, y, z) {
    mIdent(tmpB); tmpB[0] = x; tmpB[5] = y; tmpB[10] = z;
    return mMul(m, tmpB);
  }
  var D2R = Math.PI / 180;
  function mRotX(m, d) {
    var c = Math.cos(d * D2R), s = Math.sin(d * D2R);
    mIdent(tmpB); tmpB[5] = c; tmpB[6] = s; tmpB[9] = -s; tmpB[10] = c;
    return mMul(m, tmpB);
  }
  function mRotY(m, d) {
    var c = Math.cos(d * D2R), s = Math.sin(d * D2R);
    mIdent(tmpB); tmpB[0] = c; tmpB[2] = -s; tmpB[8] = s; tmpB[10] = c;
    return mMul(m, tmpB);
  }
  // ⚠ IN COLUMN-MAJOR, A Z ROTATION'S OFF-DIAGONAL PAIR IS m[1] = +sin AND m[4] = -sin. Writing
  // it the other way round tilts the whole hand the wrong way — and a hand that leans the wrong
  // way still looks like a hand, which is how the 2D version's -0.55 fudge survived a session.
  function mRotZ(m, d) {
    var c = Math.cos(d * D2R), s = Math.sin(d * D2R);
    mIdent(tmpB); tmpB[0] = c; tmpB[1] = s; tmpB[4] = -s; tmpB[5] = c;
    return mMul(m, tmpB);
  }
  H3._m = { ident: mIdent, mul: mMul, translate: mTranslate, rotX: mRotX, rotY: mRotY,
            rotZ: mRotZ, scale: mScale };

  var sin = Math.sin, sqrt = Math.sqrt, PI = Math.PI;
  var lerp = function (t, a, b) { return a + (b - a) * t; };

  // ── the pose ──────────────────────────────────────────────────────────────────────────────
  /**
   * `GameRenderer.getFov(camera, partial, false)` — the HAND's field of view, in degrees. ⚠ A fixed
   * 70: the FOV option and the speed-effect multiplier only enter for the world (third argument
   * TRUE), so the held item is the same size at FOV 30 and FOV 110. Then, exactly as vanilla,
   * divided by `(1 - 500/(min(deathTime+partial,20)+500))*2 + 1` while dead, and multiplied by
   * `lerp(fovEffectScale, 1, 0.85714287)` when the eye is in water or lava.
   */
  H3.handFov = function (p, partial, fovEffectScale, submerged) {
    var fov = 70.0;
    if (p && p.dead) {
      var d = Math.min(((p.deathTime | 0) + partial), 20.0);
      fov /= (1.0 - 500.0 / (d + 500.0)) * 2.0 + 1.0;
    }
    if (submerged) {
      var s = fovEffectScale === undefined ? 1 : fovEffectScale;
      fov *= 1 + (0.85714287 - 1) * s;
    }
    return fov;
  };

  /**
   * `GameRenderer.bobHurt` — the camera rolls away from whatever hit you, and tips over on death.
   * ⚠ `f` IS `hurtTime - partialTick` AND MAY BE NEGATIVE: the tick after the hurt timer runs
   * out, this must do nothing at all rather than roll the other way.
   */
  H3.bobHurt = function (m, p, partial) {
    var f = (p.hurtTime | 0) - partial;
    if (p.deathTime > 0) {
      var f1 = Math.min((p.deathTime | 0) + partial, 20.0);
      mRotZ(m, H3.DEATH_TILT_A - H3.DEATH_TILT_B / (f1 + H3.DEATH_TILT_C));
    }
    if (f < 0) return m;
    var dur = p.hurtDuration || 10;
    f /= dur;
    f = sin(f * f * f * f * PI);
    var dir = p.hurtDir || 0;
    mRotY(m, -dir);
    mRotZ(m, -f * H3.HURT_ROLL);
    mRotY(m, dir);
    return m;
  };

  /**
   * `GameRenderer.bobView` — the walk bob, on the CAMERA and therefore on the hand with it.
   * ⚠ `bob` IS NOT SPEED AND `walkDist` IS NOT TIME. `bob` is a smoothed 0..0.1 of how fast you
   * are actually moving on the ground, and `walkDist` is distance walked — so the bob's PHASE
   * comes from where your feet are and its AMPLITUDE from how fast they are going. A bob driven
   * by a clock keeps swaying while you stand against a wall pressing W, which is wrong, and is
   * what every clone that uses `time` does.
   */
  H3.bobView = function (m, p, partial) {
    var f = (p.walkDist || 0) - (p.walkDistO || 0);
    var f1 = -((p.walkDist || 0) + f * partial);
    var f2 = lerp(partial, p.oBob || 0, p.bob || 0);
    mTranslate(m, sin(f1 * PI) * f2 * H3.BOB_TRANSLATE, -Math.abs(Math.cos(f1 * PI) * f2), 0);
    mRotZ(m, sin(f1 * PI) * f2 * H3.BOB_ROLL);
    mRotX(m, Math.abs(Math.cos(f1 * PI - H3.BOB_PITCH_PHASE) * f2) * H3.BOB_PITCH);
    return m;
  };

  /**
   * How far the camera's heading has run ahead of the hand's own smoothed one, in degrees,
   * ALWAYS taken the short way round (D-415). See `H3.pose` for why the wrap is not optional.
   * Always in [-180, 180], so the sway this returns is bounded whatever the player does.
   */
  H3.swayYaw = function (p, partial) {
    var yb = lerp(partial, p.yBobO || 0, p.yBob || 0);
    var d = H3.viewYRot(p, partial) - yb;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };

  /** `BowItem.getPullProgress`: f=t/20, (f²+2f)/3, capped at 1. */
  H3.bowPull = function (ticks) {
    var f = ticks / 20;
    f = (f * f + f * 2) / 3;
    return f > 1 ? 1 : f;
  };

  /** Ticks the player has drawn the held BOW, or -1 when not drawing one (`isUsingItem` + BOW action). */
  H3.bowDrawTicks = function (p) {
    if (!p || !p.usingItem || p.useKind || !p.heldItem) return -1;
    var st = p.heldItem(), IT = NS.Items;
    if (!st || !IT || !IT.ready || IT.nameOf(st.i | 0) !== 'bow') return -1;
    return p.useTicks || 0;
  };

  /**
   * `HeldItemRenderer.applyEatOrDrinkTransformation` (right arm, i = +1): left = useMax - useTicks (the
   * continuous form of `getItemUseTimeLeft - partial + 1`); a nod `|cos(left/4*PI)*0.1|` until 80% gone, then
   * the item swings to the mouth by 1 - (left/max)^27.
   */
  H3.applyEatOrDrinkTransformation = function (m, left, max) {
    var f = left / max;
    if (f < 0.8) mTranslate(m, 0, Math.abs(Math.cos(left / 4 * PI) * 0.1), 0);
    var g = 1 - Math.pow(f, 27);
    mTranslate(m, g * 0.6, g * -0.5, 0);
    mRotY(m, g * 90); mRotX(m, g * 10); mRotZ(m, g * 30);
    return m;
  };
  /** Remaining use ticks and total for a held EAT/DRINK hold, or null (`isUsingItem` + that UseAction). */
  H3.eatDrinkLeft = function (p) {
    var U = NS.Use;
    if (!p || !p.usingItem || p.useKind !== 'drink' || !p.heldItem || !U || !U.getUseAction) return null;
    var st = p.heldItem(), act = st ? U.getUseAction(st) : 0;
    if (act !== U.UseAction.EAT && act !== U.UseAction.DRINK) return null;
    var max = U.getMaxUseTime(st), left = max - (p.useTicks || 0);
    return left > 0 && max > 0 ? { left: left, max: max } : null;
  };

  /** `ItemInHandRenderer.applyItemArmTransform` — right hand only; `i` is +1. */
  H3.applyItemArmTransform = function (m, equipped) {
    return mTranslate(m, H3.HAND_X, H3.HAND_Y + equipped * H3.HAND_EQUIP_Y, H3.HAND_Z);
  };

  /** `ItemInHandRenderer.applyItemArmAttackTransform`. */
  H3.applyItemArmAttackTransform = function (m, swing) {
    var f = sin(swing * swing * PI);
    mRotY(m, H3.SWING_Y_BASE + f * H3.SWING_Y_SWING);
    var f1 = sin(sqrt(swing) * PI);
    mRotZ(m, f1 * H3.SWING_Z);
    mRotX(m, f1 * H3.SWING_X);
    mRotY(m, H3.SWING_Y_BACK);
    return m;
  };

  /**
   * The full view-space transform for the HELD ITEM, or for the ARM when the hand is empty.
   * `mode` is 'item' or 'arm'; the arm's own chain diverges after the bob.
   */
  H3.pose = function (out, p, partial, swing, equipped, mode) {
    var S = NS.Settings;
    mIdent(out);
    H3.bobHurt(out, p, partial);
    // ⚠ VANILLA'S OPTION, AND IT IS AN OPTION IN VANILLA TOO: `if (options.bobView)`. Some
    // people turn it off because it makes them motion sick, and a clone that hard-codes it on
    // has taken that choice away.
    if (!S || S.viewBobbing !== false) H3.bobView(out, p, partial);
    // ⚠⚠ **THE SWAY.** The hand is rotated by a TENTH of how far the camera has turned away
    // from its own smoothed heading, so it trails a fast look and settles when you stop. This
    // is the single thing Dan named that no amount of work on a 2D blit could have produced.
    var xb = lerp(partial, p.xBobO || 0, p.xBob || 0);
    var yb = lerp(partial, p.yBobO || 0, p.yBob || 0);
    mRotX(out, (H3.viewXRot(p, partial) - xb) * H3.HAND_LOOK_LAG);
    // ⚠⚠ **AND THE SWAY'S YAW DIFFERENCE MUST BE WRAPPED TOO — D-415, the held item that walked
    // off the side of the screen.** Vanilla's `getYRot()` is UNBOUNDED: spin twice and it reads
    // 720, and `yBob` chases it to 720, so `getViewYRot - yBob` is always a small number. This
    // engine wraps yaw into (-180, 180] in `Input.applyLook` (which is the right call — every
    // other consumer wants a bounded angle) and `Player.tick` eases `yBob` toward it THE SHORT
    // WAY ROUND. Both halves are correct on their own and together they are not: cross the
    // +-180 seam and `yBob` settles 360 away from the yaw it is chasing, so this difference —
    // the ONE place that subtracts them — jumps by a full turn and stays there. Times 0.1 that
    // is 36 degrees of permanent hand rotation per seam crossing, accumulating: the item slides
    // to the middle of the screen, then off to the left, and the other way if you turn back.
    // Nothing else reads the raw difference, so the wrap belongs here.
    mRotY(out, H3.swayYaw(p, partial) * H3.HAND_LOOK_LAG);

    if (mode === 'arm') {
      var f1 = sqrt(swing);
      var a2 = H3.ARM_SWING_X * sin(f1 * PI);
      var a3 = H3.ARM_SWING_Y * sin(f1 * PI * 2);
      var a4 = H3.ARM_SWING_Z * sin(swing * PI);
      mTranslate(out, a2 + H3.ARM_X, a3 + H3.ARM_Y + equipped * H3.ARM_Y, a4 + H3.ARM_Z);
      mRotY(out, H3.ARM_ROT_Y);
      var f5 = sin(swing * swing * PI);
      var f6 = sin(f1 * PI);
      mRotY(out, f6 * H3.ARM_SWING_ROT_Y);
      mRotZ(out, f5 * H3.ARM_SWING_ROT_Z);
      // the skin-model tail: Mojang's humanoid is built upside down and turned over here
      mTranslate(out, H3.ARM_TAIL_T[0], H3.ARM_TAIL_T[1], H3.ARM_TAIL_T[2]);
      mRotZ(out, H3.ARM_TAIL_Z);
      mRotX(out, H3.ARM_TAIL_X);
      mRotY(out, H3.ARM_TAIL_Y);
      mTranslate(out, H3.ARM_TAIL_T2, 0, 0);
      // ⚠⚠ **AND THE MODEL PART'S OWN OFFSET, WHICH IS EASY TO MISS AND PUTS THE ARM OFF THE
      // BOTTOM OF THE SCREEN WITHOUT IT.** `renderPlayerArm` ends by rendering `model.rightArm`,
      // and `ModelPart.render` begins with `translateAndRotate` — `translate(x/16, y/16, z/16)`
      // for the part's own `PartPose`. The wide player model's right arm is
      // `PartPose.offset(-5, 2, 0)` with `addBox(-3, -2, -2, 4, 12, 4)`, read out of the jar
      // (class `ekm`, the `right_sleeve` branch with the 4-wide box, `fconst_2` for the 2).
      // The first build of this file left it out and the arm was a sliver in the corner.
      mTranslate(out, H3.ARM_PART[0] / 16, H3.ARM_PART[1] / 16, H3.ARM_PART[2] / 16);
      mRotZ(out, H3.ARM_ROLL_RAD / D2R);
      // ⚠ and the box is in PIXELS — Mojang's model space is sixteenths of a block.
      mScale(out, 1 / 16, 1 / 16, 1 / 16);
      return out;
    }

    var draw = H3.bowDrawTicks(p);
    if (draw >= 0) {
      // the BOW use-action: no swing offset in this branch
      H3.applyItemArmTransform(out, equipped);
      mTranslate(out, H3.BOW_T[0], H3.BOW_T[1], H3.BOW_T[2]);
      mRotX(out, H3.BOW_ROT_X); mRotY(out, H3.BOW_ROT_Y); mRotZ(out, H3.BOW_ROT_Z);
      var pull = H3.bowPull(draw);
      if (pull > H3.BOW_SHAKE_MIN)
        mTranslate(out, 0, sin((draw - 0.1) * H3.BOW_SHAKE_FREQ) * (pull - H3.BOW_SHAKE_MIN) * H3.BOW_SHAKE_Y, 0);
      mTranslate(out, 0, 0, pull * H3.BOW_PULL_Z);
      mScale(out, 1, 1, 1 + pull * H3.BOW_STRETCH);
      mRotY(out, -H3.BOW_TURN_Y);
      return out;
    }
    var ed = H3.eatDrinkLeft(p);
    if (ed) {
      // vanilla: eat/drink transform, then the equip offset; no swing offset in this branch
      H3.applyEatOrDrinkTransformation(out, ed.left, ed.max);
      H3.applyItemArmTransform(out, equipped);
      return out;
    }
    var s = swing;
    mTranslate(out, H3.ITEM_SWING_X * sin(sqrt(s) * PI),
                    H3.ITEM_SWING_Y * sin(sqrt(s) * PI * 2),
                    H3.ITEM_SWING_Z * sin(s * PI));
    H3.applyItemArmTransform(out, equipped);
    H3.applyItemArmAttackTransform(out, s);
    return out;
  };

  /**
   * The interpolated look angles, in DEGREES, in vanilla's sense: yaw grows clockwise from
   * south and pitch is positive DOWNWARD.
   * ⚠ THIS ENGINE'S PITCH IS POSITIVE UP (D-334's note in `inputcheck`), so the sign is flipped
   * here rather than in the caller — one conversion, in the one place that needs vanilla's
   * convention, because the rest of the engine is internally consistent the other way.
   */
  H3.viewXRot = function (p, partial) {
    // ClientPlayerEntity.getPitch(float) is the CURRENT look, never interpolated (the mouse turns it every frame)
    return -p.pitch * 180 / PI;
  };
  H3.viewYRot = function (p, partial) {
    // ClientPlayerEntity.getYaw(float): the current look, interpolated only while riding
    if (!p.vehicle) return p.yaw * 180 / PI;
    var a = p.pYaw === undefined ? p.yaw : p.pYaw;
    // ⚠ a yaw that wraps past ±180 must be interpolated the SHORT way round, or the hand
    // whips a full turn in one frame every time you cross the seam.
    var d = p.yaw - a;
    while (d > PI) d -= 2 * PI;
    while (d < -PI) d += 2 * PI;
    return (a + d * partial) * 180 / PI;
  };

  // ── the geometry ──────────────────────────────────────────────────────────────────────────
  /** Floats per vertex: x y z · u v · layer · shade · r g b. Six vertices a quad, no indices. */
  H3.FLOATS_PER_VERTEX = 10;
  H3.VERTS_PER_QUAD = 6;

  /** The outward normal of each ARCH face: +X -X +Y -Y +Z -Z. */
  var NRM = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  /** A growing scratch buffer; the hand is rebuilt every frame and must not allocate every frame. */
  var scratch = new Float32Array(4096 * H3.FLOATS_PER_VERTEX);
  function room(need) {
    if (scratch.length >= need) return;
    var n = scratch.length;
    while (n < need) n *= 2;
    scratch = new Float32Array(n);
  }

  /**
   * Emit one geometry PART through `m`, with `tint` as a literal RGB triple.
   *
   * ⚠ THE SHADE FOLLOWS THE ROTATED NORMAL (D-320's lesson, third time): a face keeps the
   * brightness of the direction it ACTUALLY points after the pose, not of the direction it
   * pointed in the model. Without it the lit side of a held block turns with the swing, which
   * reads as the item catching a moving light.
   */
  H3.emitPart = function (out, o, part, m, tint, light) {
    var R = NS.Reg, M = NS.Mesher, G = NS.Gfx;
    if (!R || !R.partOff || !(part >= 0)) return o;
    var MAP = (M && M.MESH_OF_DIR) || [3, 2, 5, 4, 1, 0];
    var FACE = G && G.SHADE ? G.SHADE.FACE : [0.6, 0.6, 1, 0.5, 0.8, 0.8];
    var TINT = G && G.SHADE ? G.SHADE.TINT : [[1, 1, 1]];
    var piv = H3.MODEL_PIVOT;
    var U = 1 / (CFG.MODEL_UNITS_PER_BLOCK || 256);
    for (var q = R.partOff[part]; q < R.partOff[part + 1]; q++) {
      var fl = R.qFlags[q];
      var face = MAP[fl & 7];
      var shaded = (fl >>> 6) & 1;
      var tIdx = (fl >>> 7) & 7;
      var tile = R.qTile[q];
      var n = NRM[face];
      var nx = m[0] * n[0] + m[4] * n[1] + m[8] * n[2];
      var ny = m[1] * n[0] + m[5] * n[1] + m[9] * n[2];
      var nz = m[2] * n[0] + m[6] * n[1] + m[10] * n[2];
      var ax = nx < 0 ? -nx : nx, ay = ny < 0 ? -ny : ny, az = nz < 0 ? -nz : nz;
      var rf = ay >= ax && ay >= az ? (ny >= 0 ? 2 : 3)
             : ax >= az ? (nx >= 0 ? 0 : 1) : (nz >= 0 ? 4 : 5);
      var sh = (shaded ? FACE[rf] : 1) * light;
      var tc = tint || (TINT[tIdx > 3 ? 3 : tIdx] || TINT[0]);
      var po = q * 12, uo = q * 8;
      room(o + H3.VERTS_PER_QUAD * H3.FLOATS_PER_VERTEX);
      // ⚠ THE WINDING IS REVERSED, exactly as `ER.emitPart` reverses it (D-133): the baked
      // quads are wound for the mesher's own convention and a naive copy is backface-culled
      // into invisibility — which looks identical to "the hand is not drawn at all".
      var idx = [3, 2, 1, 3, 1, 0];
      for (var k = 0; k < 6; k++) {
        var c = idx[k];
        var px = R.qPos[po + c * 3] * U - piv;
        var py = R.qPos[po + c * 3 + 1] * U - piv;
        var pz = R.qPos[po + c * 3 + 2] * U - piv;
        out[o]     = m[0] * px + m[4] * py + m[8]  * pz + m[12];
        out[o + 1] = m[1] * px + m[5] * py + m[9]  * pz + m[13];
        out[o + 2] = m[2] * px + m[6] * py + m[10] * pz + m[14];
        out[o + 3] = R.qUv[uo + c * 2] * (1 / 256);
        out[o + 4] = R.qUv[uo + c * 2 + 1] * (1 / 256);
        out[o + 5] = tile;
        out[o + 6] = sh;
        out[o + 7] = tc[0]; out[o + 8] = tc[1]; out[o + 9] = tc[2];
        o += H3.FLOATS_PER_VERTEX;
      }
    }
    return o;
  };

  /**
   * #401 -- the two items whose in-hand model is not their inventory model. `be` names the part
   * `pack-blockentity.mjs` baked; `hand` is that model's own `firstperson_righthand`
   * (`[rot xyz, translation xyz in sixteenths, scale xyz]`): `trident_in_hand.json` declares
   * `[0,-90,25] [-3,17,1] [1,1,1]`, `spyglass_in_hand.json` declares none, so the identity applies
   * (and NOT `item/generated`'s, which is what the sprite path used). `texaudit` 3c compares
   * both against the jar.
   */
  H3.IN_HAND = {
    trident: { be: 'hand_trident', hand: [0, -90, 25, -3, 17, 1, 1, 1, 1] },
    spyglass: { be: 'hand_spyglass', hand: null },
  };

  /**
   * What is in the hand, as a list of parts to draw.
   * Returns `{ parts: [partIndex], tints: [rgb|null] }` — one entry per model layer, so a spawn
   * egg's base and overlay are two coincident sprite models exactly as vanilla draws them.
   *
   * ⚠ **THE MODEL DECIDES WHETHER IT IS A SPRITE, NOT `isBlock`** — D-342's rule, and the reason
   * a candle and a zombie spawn egg both belong on the sprite path even though one of them
   * places a block. An item with sprite LAYERS is `item/generated`; an item with none is a
   * block model.
   */
  H3.partsOf = function (itemIdx, bowTicks, tag, cast) {
    var IT = NS.Items, ER = NS.EntityRender, R = NS.Reg, SR = NS.States;
    var out = { parts: [], tints: [], sprite: false };
    if (!IT || !IT.ready || !(itemIdx >= 0)) return out;
    // #401: `ItemRenderer.getModel` answers `trident_in_hand` / `spyglass_in_hand` for every mode
    // but GUI, GROUND and FIXED, so the hand never draws their inventory sprite
    var ih = H3.IN_HAND[IT.nameOf(itemIdx)];
    if (ih && ER && ER.bePartOf && NS.DATA && NS.DATA.beNames && NS.DATA.beNames[ih.be] !== undefined) {
      out.parts.push(ER.bePartOf(NS.DATA.beNames[ih.be]));
      out.tints.push(null);
      return out;
    }
    // #8080: a banner-patterned shield is its base pass plus one pass per pattern layer
    if (tag && IT.nameOf(itemIdx) === 'shield' && ER && ER.shieldPasses && ER.bePartOf && NS.DATA && NS.DATA.beNames) {
      var sp = ER.shieldPasses(tag);
      for (var si = 0; si < sp.length; si++) { out.parts.push(ER.bePartOf(NS.DATA.beNames.shield)); out.tints.push(sp[si].rgb); }
      return out;
    }
    var layers = ER && ER.itemLayers ? ER.itemLayers(itemIdx) : [];
    // bow.json overrides: `pulling` selects bow_pulling_0, `pull` >= 0.65 / 0.9 the next two
    if (bowTicks >= 0 && layers.length && ER.bowTileName) {
      var tm = NS.DATA && NS.DATA.itemTileMap ? NS.DATA.itemTileMap() : null;
      var bt = tm ? tm[ER.bowTileName(bowTicks / 20, true)] : undefined;
      if (bt !== undefined && bt >= 0) layers = [bt];
    }
    // fishing_rod.json override `cast` (FishingRodItem predicate): the cast texture while the player's bobber exists
    if (cast && layers.length && ER.rodTileName) {
      var rm = NS.DATA && NS.DATA.itemTileMap ? NS.DATA.itemTileMap() : null;
      var rt = rm ? rm[ER.rodTileName(true)] : undefined;
      if (rt !== undefined && rt >= 0) layers = [rt];
    }
    if (layers.length) {
      out.sprite = true;
      for (var i = 0; i < layers.length; i++) {
        var part = ER.spritePartOf(layers[i]);
        if (part < 0) continue;
        out.parts.push(part);
        // ⚠ THE LAYER'S TILE IS ALREADY THE TINTED PIXELS (D-344): `extract-items` bakes one atlas
        // layer per (sprite, colour) pair and `IT.layerTile` points at it. Multiplying by `tint0`
        // here as well tinted a spawn egg TWICE (colour squared) and, with #4982's grass/fern/vine/
        // lily-pad tints, would have made those dark. The colour is data for the HUD/world bake only.
        out.tints.push(null);
      }
      return out;
    }
    // ⚠ A `builtin/entity` ITEM (chest, ender chest, trapped chest, shulker boxes, ...) bakes no
    // block-model quads, so the state path below draws nothing and the hand held an invisible
    // chest (#108). It is drawn from the one part `pack-blockentity.mjs` baked for it, the same
    // part a dropped one uses (`ER.beFor`).
    var bePart = ER && ER.beIndexOf ? ER.bePartOf(ER.beIndexOf(itemIdx)) : -1;
    if (bePart >= 0) {
      out.parts.push(bePart);
      out.tints.push(null);
      return out;
    }
    var state = IT.stateOf ? IT.stateOf(itemIdx) : -1;
    if (!(state > 0) || !R || !R.ready || !SR || !SR.ready) return out;
    var vis = SR.vis[state];
    if (!R.groupCount || !R.groupCount(vis)) return out;
    out.parts.push(R.partFor(vis, 0, 0, 0, 0));
    out.tints.push(null);
    return out;
  };

  /**
   * Build the frame's hand geometry.
   *
   * Returns `null` when there is nothing to draw, or
   *   `{ verts, floats, quads, arm: {verts, floats, quads} | null }`
   * — two buffers because the ARM is textured from the player skin and the ITEM from the block
   * atlas, and one draw call cannot sample two textures with one sampler uniform.
   */
  H3.build = function (p, partial) {
    var Hd = NS.Hand, IT = NS.Items, Iv = NS.Inventory, W = NS.World;
    // GameRenderer.renderHand: gameMode != SPECTATOR -- no hand at all for a spectator.
    if (NS.Gamemode && NS.Gamemode.isSpectator && p && NS.Gamemode.isSpectator(p)) return null;
    // struck s117: `GameRenderer.renderHand`'s own sleeping gate (.decomp GameRenderer.java:
    // 860-862 -- "camera entity instanceof LivingEntity && isSleeping()" is one of the ANDed
    // conditions before the first-person hand is ever drawn) -- the hand simply isn't built at
    // all for the frame, same effect, one fewer branch downstream.
    if (!p || !Hd || p.sleeping) return null;
    var stack = p.heldItem ? p.heldItem() : null;
    var empty = !stack || (Iv && Iv.isEmpty(stack));
    // vanilla draws its OWN lagging `mainHand`, not the player's stack (tickEquip swaps it at the bottom)
    var itemIdx = (Hd.mainHandItem === undefined ? (empty ? -1 : (stack.i | 0)) : Hd.mainHandItem);
    empty = itemIdx < 0;
    // ⚠ THE SWING IS THE MAIN HAND'S ONLY WHEN THE MAIN HAND IS THE ONE SWINGING — vanilla's
    // `hand == MAIN_HAND ? f : 0`. There is no offhand here yet, so this is always the main
    // hand; it is written as the branch rather than as `swing` so the offhand can be added
    // without re-deriving it.
    var swing = Hd.swingArm === 0 ? Hd.swingProgress(partial) : 0;
    var equipped = 1 - lerp(partial, Hd.oMainHandHeight || 0, Hd.mainHandHeight === undefined ? 1 : Hd.mainHandHeight);
    // ⚠ THE LIGHT IS THE CELL YOU ARE STANDING IN, which is what `getLightColor` gives vanilla's
    // hand. A hand lit at full brightness in a cave is the single most obvious tell of a clone.
    var lt = 15, sky = 15;
    if (W && W.getLight) {
      var l = W.getLight(Math.floor(p.ex), Math.floor(p.ey + (p.eyeHeight || p.EYE || 1.62)), Math.floor(p.ez)) | 0;
      sky = l >> 4; lt = l & 15;
    }
    var S = NS.Settings;
    var lv = Math.max(sky * (NS.Gfx && NS.Gfx.skyDarken !== undefined ? NS.Gfx.skyDarken : 1), lt) / 15;
    var AMB = NS.Gfx && NS.Gfx.SHADE ? NS.Gfx.SHADE.AMBIENT : 0.06;
    var light = AMB + (1 - AMB) * (lv / (4 - 3 * lv));

    var m = H3._pose || (H3._pose = new Float32Array(16));
    if (empty) {
      // vanilla `renderFirstPersonItem`: `mainHand && !player.isInvisible()` gates the empty-hand arm
      var ES = NS.Effects;
      if (ES && ES.hasStatusEffect && ES.hasStatusEffect(p, 'invisibility')) return null;
      H3.pose(m, p, partial, swing, equipped, 'arm');
      var arm = H3.buildArm(m, light);
      return arm ? { verts: null, floats: 0, quads: 0, arm: arm } : null;
    }
    H3.pose(m, p, partial, swing, equipped, 'item');
    var bowTicks = H3.bowDrawTicks(p);
    // the item model's OWN display transform, applied inside the hand pose
    H3.applyDisplay(m, itemIdx);
    var ER = NS.EntityRender;
    var info = H3.partsOf(itemIdx, bowTicks, stack && stack.tag, ER && ER.rodIsCast ? ER.rodIsCast(p, itemIdx) : false);
    if (!info.parts.length) return null;
    var o = 0;
    for (var i = 0; i < info.parts.length; i++) {
      o = H3.emitPart(scratch, o, info.parts[i], m, info.tints[i], light);
    }
    if (!o) return null;
    return { verts: scratch, floats: o, quads: o / (H3.FLOATS_PER_VERTEX * H3.VERTS_PER_QUAD), arm: null };
  };

  /**
   * `ItemTransform.apply` — the item model's own `firstperson_righthand` entry, then vanilla's
   * (-0.5, -0.5, -0.5) pivot shift, which `emitPart` folds into the corner positions.
   *
   * ⚠⚠ **THIS IS THE HALF THAT WAS MISSING AND IT IS THE HALF DAN KEPT SEEING.** The old code
   * had ONE transform — `block/block`'s `[0, 45, 0]` at 0.40 — and used it for every item in the
   * game. There are **nineteen distinct ones** in 1.18.2: a sword is `[0, -90, 25]` translated
   * `[1.13, 3.2, 1.13]` at 0.68, a rod is `[-90, 0, -55]`, a shield is `[0, 180, 5]` at 1.25.
   * A sword drawn at the block transform is a flat plank pointing away from you.
   * ⚠ THE TRANSLATION IS IN SIXTEENTHS, like every coordinate in a model file.
   */
  H3.applyDisplay = function (m, itemIdx) {
    var IT = NS.Items;
    var ih = IT && IT.ready && itemIdx >= 0 ? H3.IN_HAND[IT.nameOf(itemIdx)] : null;
    var t = ih ? ih.hand : (IT && IT.handTransform ? IT.handTransform(itemIdx) : null);
    if (!t) return m;
    mTranslate(m, t[3] / 16, t[4] / 16, t[5] / 16);
    // ⚠ THE ROTATION ORDER IS X THEN Y THEN Z, which is what `new Quaternion(x, y, z, true)`
    // composes — Mojang's own euler-to-quaternion, not an arbitrary choice.
    mRotX(m, t[0]); mRotY(m, t[1]); mRotZ(m, t[2]);
    mScale(m, t[6], t[7], t[8]);
    return m;
  };

  // ── the arm ───────────────────────────────────────────────────────────────────────────────
  /**
   * The player's right arm, as the two Mojang boxes the skin defines — the arm and the sleeve.
   * Reuses `BlockIcon.ARM` and `BlockIcon.boxFaces`, which are already the jar's own table and
   * already carry D-320's hard-won lesson that Mojang writes that table in a +Y-DOWN space.
   *
   * ⚠ IT IS TEXTURED FROM THE SKIN SHEET, NOT THE BLOCK ATLAS, so it is a separate buffer with
   * `layer = -1` — the shader's signal to sample the skin sampler instead of the array.
   */
  H3.buildArm = function (m, light) {
    var BI = NS.BlockIcon, G = NS.Gfx;
    if (!BI || !BI.ARM || !BI.boxFaces) return null;
    var A = BI.ARM;
    var FACE = G && G.SHADE ? G.SHADE.FACE : [0.6, 0.6, 1, 0.5, 0.8, 0.8];
    var buf = H3._arm || (H3._arm = new Float32Array(2 * 6 * 6 * H3.FLOATS_PER_VERTEX));
    var o = 0;
    o = armBox(buf, o, m, A, A.u, A.v, 0, FACE, light);
    var mp = NS.Options && NS.Options.modelParts ? NS.Options.modelParts() : null;   // #6408 setModelPose: the sleeve follows its toggle
    if (!mp || mp.right_sleeve !== false) o = armBox(buf, o, m, A, A.sleeveU, A.sleeveV, A.sleeveInflate, FACE, light);
    return { verts: buf, floats: o, quads: o / (H3.FLOATS_PER_VERTEX * H3.VERTS_PER_QUAD) };
  };

  /** The skin sheet is 64 wide in Mojang's texel space; a V of 64 is the modern square skin. */
  H3.SKIN_W = 64; H3.SKIN_H = 64;

  function armBox(out, o, m, A, u, v, inf, FACE, light) {
    var x0 = A.x0 - inf, y0 = A.y0 - inf, z0 = A.z0 - inf;
    var x1 = A.x0 + A.w + inf, y1 = A.y0 + A.h + inf, z1 = A.z0 + A.d + inf;
    var C = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    var faces = NS.BlockIcon.boxFaces(u, v, A.w, A.h, A.d);
    // the ARCH face each Mojang face points along, for the shade table: down, up, x0, z0, x1, z1
    var SHADEF = [3, 2, 1, 5, 0, 4];
    for (var f = 0; f < faces.length; f++) {
      var fc = faces[f];
      var sh = FACE[SHADEF[f]] * light;
      var idx = [0, 1, 2, 0, 2, 3];
      for (var k = 0; k < 6; k++) {
        var c = idx[k];
        var pt = C[fc.c[c]];
        out[o]     = m[0] * pt[0] + m[4] * pt[1] + m[8]  * pt[2] + m[12];
        out[o + 1] = m[1] * pt[0] + m[5] * pt[1] + m[9]  * pt[2] + m[13];
        out[o + 2] = m[2] * pt[0] + m[6] * pt[1] + m[10] * pt[2] + m[14];
        out[o + 3] = fc.uv[c * 2] / H3.SKIN_W;
        out[o + 4] = fc.uv[c * 2 + 1] / H3.SKIN_H;
        out[o + 5] = -1;                    // "sample the skin, not the atlas"
        out[o + 6] = sh;
        out[o + 7] = 1; out[o + 8] = 1; out[o + 9] = 1;
        o += H3.FLOATS_PER_VERTEX;
      }
    }
    return o;
  }

  // ── #7952: InGameOverlayRenderer.renderFireOverlay ─────────────────────────────────────────
  H3.FIRE_OFFSET_X = 0.24; H3.FIRE_OFFSET_Y = -0.3; H3.FIRE_ROT_Y = 10.0; H3.FIRE_Z = -0.5; H3.FIRE_ALPHA = 0.9;
  /**
   * The two fire_1 quads (i = 0, 1) as hand-buffer vertices (x y z u v layer shade r g b, 6 a quad),
   * view space: translate(-(i*2-1)*0.24, -0.3, 0) · rotateY((i*2-1)*10deg), extent -0.5..0.5 at z=-0.5.
   * Pure; the WebGL2 and WebGPU hand draws both take it as a `drawHand` frame.
   */
  H3.fireOverlayVerts = function (layer, out) {
    out = out || new Float32Array(2 * H3.VERTS_PER_QUAD * H3.FLOATS_PER_VERTEX);
    // vanilla corner order (-,-) (+,-) (+,+) (-,+) with uv (1,1) (0,1) (0,0) (1,0); as two triangles
    var X = [-0.5, 0.5, 0.5, -0.5], Y = [-0.5, -0.5, 0.5, 0.5], U = [1, 0, 0, 1], V = [1, 1, 0, 0];
    var order = [0, 1, 2, 0, 2, 3], o = 0;
    for (var i = 0; i < 2; i++) {
      var sgn = i * 2 - 1, a = sgn * H3.FIRE_ROT_Y * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      var tx = -sgn * H3.FIRE_OFFSET_X, ty = H3.FIRE_OFFSET_Y;
      for (var k = 0; k < 6; k++) {
        var j = order[k], x = X[j], z = H3.FIRE_Z;
        out[o]     = tx + c * x + sn * z;
        out[o + 1] = ty + Y[j];
        out[o + 2] = -sn * x + c * z;
        out[o + 3] = U[j]; out[o + 4] = V[j];
        out[o + 5] = layer; out[o + 6] = 1;
        out[o + 7] = 1; out[o + 8] = 1; out[o + 9] = 1;   // colour alpha 0.9 is H3.FIRE_ALPHA (cutout sprite)
        o += H3.FLOATS_PER_VERTEX;
      }
    }
    return out;
  };
  /** The overlay frame while `p` burns (not spectator, isOnFire already clears for fire immunity), else null. */
  H3.fireOverlay = function (p, layer) {
    if (!p || !p.isOnFire || p.mode === (NS.Gamemode && NS.Gamemode.SPECTATOR)) return null;
    if (layer === undefined) {
      var D = NS.DATA, n = D && D.tileNames;
      layer = H3._fireLayer = H3._fireLayer !== undefined ? H3._fireLayer : (n ? n.indexOf('block/fire_1') : -1);
    }
    if (!(layer >= 0)) return null;
    return { verts: H3.fireOverlayVerts(layer, H3._fireBuf || (H3._fireBuf = new Float32Array(2 * H3.VERTS_PER_QUAD * H3.FLOATS_PER_VERTEX))), floats: 2 * H3.VERTS_PER_QUAD * H3.FLOATS_PER_VERTEX, quads: 2, arm: null };
  };

  H3.init = function () {
    H3.ready = !!(NS.Reg && NS.Reg.ready && NS.Items && NS.Items.ready);
    return H3;
  };
})(MCL);
