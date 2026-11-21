// 14kd_effectview.js — the numbers behind the view effects (G23k, #303). Pure functions, float-exact (Math.fround):
//   GameRenderer.getNightVisionStrength     (:918)  >200 ticks -> 1, else 0.7 + sin((d - pt) * PI * 0.2) * 0.3
//   BackgroundRenderer.applyFog blindness   (:209)  lerp(min(1, d/20), viewDist, 5); terrain fog 0 .. t*0.25 (t*0.8 sky)
//   BackgroundRenderer.render sky darkening (:131)  d < 20 -> 1 - d/20 else 0, squared, multiplies the fog colour
//   ClientPlayerEntity.updateNausea         (:813)  nether portal +0.0125, nausea (>60 ticks) +0.006666667, else -0.05
//   GameRenderer.bobView/renderNausea       (:1131) wobble scale, spin degrees per tick (7 nausea / 20 portal)
(function (NS) {
  'use strict';
  var EV = NS.EffectView = {};
  var fr = Math.fround;
  var lerp = function (t, a, b) { return fr(a + fr(t * fr(b - a))); };

  EV.nightVisionStrength = function (duration, partial) {
    return duration > 200 ? 1 : fr(0.7 + fr(Math.sin(fr(fr(fr(duration - partial) * fr(Math.PI)) * 0.2)) * 0.3));
  };

  /** -> { start, end } for blindness (viewDistance = fog far in blocks); `sky` = FogType.FOG_SKY. */
  EV.blindnessFog = function (duration, viewDistance, sky) {
    var d = lerp(Math.min(1, fr(duration / 20)), fr(viewDistance), 5);
    return sky ? { start: 0, end: fr(d * 0.8) } : { start: fr(d * 0.25), end: d };
  };

  /** Fog colour multiplier from blindness (the `$$37` squared factor), 1 when not ending. */
  EV.blindnessColorFactor = function (duration) {
    var f = duration < 20 ? fr(1 - fr(duration / 20)) : 0;
    return f < 1 ? fr(f * f) : 1;
  };

  /** Per-frame view state for an entity: { nightVision 0..1, blind: { fog:{start,end}, color } | null }.
   *  `effects` is the entity's NS.Effects store (e.effects[id].duration); viewDistance in blocks. */
  EV.frameFor = function (e, viewDistance, partial) {
    var fx = e && e.effects, nv = fx && fx.night_vision, bl = fx && fx.blindness;
    return {
      nightVision: nv && nv.duration > 0 ? EV.nightVisionStrength(nv.duration, partial || 0) : 0,
      blind: bl && bl.duration > 0 ? { fog: EV.blindnessFog(bl.duration, viewDistance, false), color: EV.blindnessColorFactor(bl.duration) } : null
    };
  };

  /** One client tick of nextNauseaStrength. st = { next, last }; returns st. */
  EV.tickNausea = function (st, inPortal, nauseaDuration) {
    st.last = st.next;
    if (inPortal) st.next = Math.min(1, fr(st.next + 0.0125));
    else if (nauseaDuration > 60) st.next = Math.min(1, fr(st.next + 0.006666667));
    else { if (st.next > 0) st.next = fr(st.next - 0.05); if (st.next < 0) st.next = 0; }
    if (st.next >= 1) st.next = 1;
    return st;
  };

  /** -> { scaleX, degrees } of the screen wobble, null when strength is 0. */
  EV.nauseaWobble = function (st, partial, ticks, distortionScale, hasNausea) {
    var s = fr(fr(lerp(partial, st.last, st.next) * distortionScale) * distortionScale);
    if (!(s > 0)) return null;
    var g = fr(fr(5 / fr(fr(s * s) + 5)) - fr(s * 0.04)); g = fr(g * g);
    return { scaleX: fr(1 / g), degrees: fr(fr(ticks + partial) * (hasNausea ? 7 : 20)) };
  };
})(MCL);
