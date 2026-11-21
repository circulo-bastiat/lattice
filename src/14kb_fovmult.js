// 14kb_fovmult.js — the world FOV multiplier: AbstractClientPlayerEntity.getFovMultiplier, smoothed by
// GameRenderer.updateFovMultiplier (0.5 per tick, clamp 0.1..1.5), scaled by the FOV Effects option.
(function (NS) {
  'use strict';
  var FM = NS.FovMult = {};
  var fr = Math.fround;
  FM.WALK_SPEED = 0.1;
  FM.BOW_ZOOM = 0.15;
  FM.cur = 1; FM.last = 1;

  /** The MOVEMENT_SPEED attribute value: base * (1+0.3 sprint) * (1+0.2(a+1) Speed) * (1-0.15(a+1) Slowness), all multiply_total. */
  FM.speedAttr = function (p) {
    var ES = NS.Effects, v = FM.WALK_SPEED;
    if (p.sprinting) v *= 1.3;
    if (ES && ES.attrValue) v = ES.attrValue(p, 'generic.movement_speed', v);
    return v < 0 ? 0 : v;
  };

  /** getFovMultiplier (bow + spyglass). */
  FM.target = function (speedAttr, walkSpeed, flying, fovEffectScale, scoped, bowTicks) {
    if (scoped) return fr(0.1);   // first person + isUsingSpyglass: returns 0.1F before the fovEffectScale lerp
    var f = 1;
    if (flying) f = fr(f * fr(1.1));
    f = fr(f * fr(fr(fr(speedAttr) / fr(walkSpeed) + 1) / 2));
    if (walkSpeed === 0 || !isFinite(f)) f = 1;
    if (bowTicks >= 0) {   // isUsingItem + bow: g = useTime/20, g>1 ? 1 : g*g; f *= 1 - g*0.15
      var g = fr(bowTicks / 20);
      g = g > 1 ? 1 : fr(g * g);
      f = fr(f * fr(1 - fr(g * FM.BOW_ZOOM)));
    }
    var s = fovEffectScale === undefined ? 1 : fovEffectScale;
    return fr(1 + fr(f - 1) * fr(s));
  };

  /** GameRenderer.updateFovMultiplier, once per tick. */
  FM.step = function (cur, target) {
    var n = fr(cur + fr(fr(target - cur) * 0.5));
    if (n > 1.5) n = 1.5;
    if (n < 0.1) n = 0.1;
    return n;
  };

  FM.tick = function (p, fovEffectScale) {
    FM.last = FM.cur;
    FM.cur = FM.step(FM.cur, p ? FM.target(FM.speedAttr(p), FM.WALK_SPEED, !!p.flying, fovEffectScale, NS.Use && NS.Use.isUsingSpyglass && NS.Use.isUsingSpyglass(p), NS.Use && NS.Use.bowUseTicks ? NS.Use.bowUseTicks(p) : -1) : 1);
  };

  FM.lerped = function (partial) { return FM.last + (FM.cur - FM.last) * partial; };
})(MCL);
