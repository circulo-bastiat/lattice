// 02p is net/minecraft/particle (#11746): ParticleType, DefaultParticleType, DustParticleEffect,
// DustColorTransitionParticleEffect, VibrationParticleEffect (+ AbstractDustParticleEffect). Main only.
// Ported from .decomp: factories parse command text (fromCommand, over a Brigadier-like reader) or a PacketByteBuf
// (fromBuf); write() is the packet form; asString() is the command form. Reached from /particle (15g_commands).
(function (NS) {
  'use strict';
  var P = NS.Particle = NS.Particle || {};
  var f32 = Math.fround;
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var f2 = function (v) { return (Math.round(v * 100 + (v < 0 ? -1e-9 : 1e-9)) / 100).toFixed(2); };

  // ParticleType: alwaysShow + the parameters factory.
  function ParticleType(id, alwaysShow, factory) { this.id = id; this.alwaysShow = !!alwaysShow; this.factory = factory; }
  ParticleType.prototype.shouldAlwaysSpawn = function () { return this.alwaysShow; };
  ParticleType.prototype.getParametersFactory = function () { return this.factory; };

  // DefaultParticleType: parameterless; its factory returns the type itself; write() writes nothing.
  function DefaultParticleType(id, alwaysShow) {
    ParticleType.call(this, id, alwaysShow, {
      fromCommand: function (type) { return type; }, fromBuf: function (type) { return type; } });
  }
  DefaultParticleType.prototype = Object.create(ParticleType.prototype);
  DefaultParticleType.prototype.getType = function () { return this; };
  DefaultParticleType.prototype.write = function () {};
  DefaultParticleType.prototype.asString = function () { return 'minecraft:' + this.id; };

  var T = P.types = {};
  P.dust = new ParticleType('dust', false, null);
  P.dustColorTransition = new ParticleType('dust_color_transition', false, null);
  P.vibration = new ParticleType('vibration', true, null);

  function readColorText(r) { r.expect(' '); var a = f32(r.readDouble()); r.expect(' '); var b = f32(r.readDouble()); r.expect(' '); var c = f32(r.readDouble()); return [f32(a), f32(b), f32(c)]; }
  function readColorBuf(b) { return [b.readFloat(), b.readFloat(), b.readFloat()]; }

  // AbstractDustParticleEffect: scale clamped to 0.01..4.0.
  function AbstractDust(color, scale) { this.color = color; this.scale = f32(clamp(f32(scale), f32(0.01), 4)); }
  AbstractDust.prototype.write = function (b) { b.writeFloat(this.color[0]); b.writeFloat(this.color[1]); b.writeFloat(this.color[2]); b.writeFloat(this.scale); };
  AbstractDust.prototype.asString = function () {
    return 'minecraft:' + this.getType().id + ' ' + f2(this.color[0]) + ' ' + f2(this.color[1]) + ' ' + f2(this.color[2]) + ' ' + f2(this.scale);
  };
  AbstractDust.prototype.getColor = function () { return this.color; };
  AbstractDust.prototype.getScale = function () { return this.scale; };

  var RED = [1, 0, 0], SCULK_BLUE = [f32(((3790560 >> 16) & 255) / 255), f32(((3790560 >> 8) & 255) / 255), f32((3790560 & 255) / 255)];

  function DustParticleEffect(color, scale) { AbstractDust.call(this, color, scale); }
  DustParticleEffect.prototype = Object.create(AbstractDust.prototype);
  DustParticleEffect.prototype.getType = function () { return P.dust; };
  DustParticleEffect.RED = RED; DustParticleEffect.DEFAULT = new DustParticleEffect(RED, 1);
  P.dust.factory = {
    fromCommand: function (t, r) { var c = readColorText(r); r.expect(' '); return new DustParticleEffect(c, f32(r.readDouble())); },
    fromBuf: function (t, b) { var c = readColorBuf(b); return new DustParticleEffect(c, b.readFloat()); } };

  function DustColorTransitionParticleEffect(from, to, scale) { AbstractDust.call(this, from, scale); this.toColor = to; }
  DustColorTransitionParticleEffect.prototype = Object.create(AbstractDust.prototype);
  DustColorTransitionParticleEffect.prototype.getType = function () { return P.dustColorTransition; };
  DustColorTransitionParticleEffect.prototype.getFromColor = function () { return this.color; };
  DustColorTransitionParticleEffect.prototype.getToColor = function () { return this.toColor; };
  DustColorTransitionParticleEffect.prototype.write = function (b) {
    AbstractDust.prototype.write.call(this, b); b.writeFloat(this.toColor[0]); b.writeFloat(this.toColor[1]); b.writeFloat(this.toColor[2]); };
  DustColorTransitionParticleEffect.prototype.asString = function () {
    var c = this.color, t = this.toColor;
    return 'minecraft:dust_color_transition ' + [c[0], c[1], c[2], this.scale, t[0], t[1], t[2]].map(f2).join(' ');
  };
  DustColorTransitionParticleEffect.SCULK_BLUE = SCULK_BLUE;
  DustColorTransitionParticleEffect.DEFAULT = new DustColorTransitionParticleEffect(SCULK_BLUE, RED, 1);
  P.dustColorTransition.factory = {
    fromCommand: function (t, r) { var a = readColorText(r); r.expect(' '); var s = f32(r.readDouble()); var c = readColorText(r); return new DustColorTransitionParticleEffect(a, c, s); },
    fromBuf: function (t, b) { var a = readColorBuf(b); var s = b.readFloat(); var c = readColorBuf(b); return new DustColorTransitionParticleEffect(a, c, s); } };

  // VibrationParticleEffect: Vibration = origin BlockPos, destination position source, arrival ticks.
  function VibrationParticleEffect(v) { this.vibration = v; }
  VibrationParticleEffect.prototype.getType = function () { return P.vibration; };
  VibrationParticleEffect.prototype.getVibration = function () { return this.vibration; };
  VibrationParticleEffect.prototype.write = function (b) {   // Vibration.writeToBuf
    b.writeBlockPos(this.vibration.origin); b.writeIdentifier('minecraft:block');
    b.writeBlockPos(this.vibration.dest); b.writeVarInt(this.vibration.ticks); };
  VibrationParticleEffect.prototype.asString = function () {
    var o = this.vibration.origin;
    return 'minecraft:vibration ' + [o.x, o.y, o.z, o.x, o.y, o.z].map(f2).join(' ') + ' ' + this.vibration.ticks;
  };
  var bp = function (x, y, z) { return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }; };
  P.vibration.factory = {
    fromCommand: function (t, r) {
      var n = []; for (var i = 0; i < 6; i++) { r.expect(' '); n.push(f32(r.readDouble())); }
      r.expect(' '); var ticks = r.readInt();
      return new VibrationParticleEffect({ origin: bp(n[0], n[1], n[2]), dest: bp(n[3], n[4], n[5]), ticks: ticks }); },
    fromBuf: function (t, b) {
      var o = b.readBlockPos(); b.readString(); var d = b.readBlockPos();
      return new VibrationParticleEffect({ origin: o, dest: d, ticks: b.readVarInt() }); } };

  P.ParticleType = ParticleType; P.DefaultParticleType = DefaultParticleType; P.DustParticleEffect = DustParticleEffect;
  P.DustColorTransitionParticleEffect = DustColorTransitionParticleEffect; P.VibrationParticleEffect = VibrationParticleEffect;
  // The registry: parameterless ids become DefaultParticleType; the three parameterised ids above are the others.
  P.typeFor = function (id) {
    if (id === 'dust') return P.dust; if (id === 'dust_color_transition') return P.dustColorTransition; if (id === 'vibration') return P.vibration;
    return T[id] || (T[id] = new DefaultParticleType(id, false));
  };
})(MCL);
