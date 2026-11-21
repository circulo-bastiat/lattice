#!/usr/bin/env node
// particleport11746check.mjs — #11746: net/minecraft/particle (src/02p_particle.js): ParticleType, DefaultParticleType,
// DustParticleEffect, DustColorTransitionParticleEffect, VibrationParticleEffect. Reached from the real entry
// (/particle parsing via C.parseParticle). Each behaviour is cut by patching NS.Particle and the scenario must fail.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const EXTRA = ['02g_items.js', '02h_recipes.js', '02j_sounds.js', '02f_tags.js', '02i_text.js', '02n_nbt.js', '02o_net.js', '02p_particle.js', '14h_brigadier.js', '15g_commands.js'];
function scenario(patch) { try { return scenario0(patch); } catch (e) { return ['threw: ' + e.message]; } }
function scenario0(patch) {
  const NS = loadEngine({ extra: EXTRA, dom: false }); initRegistry(NS);
  const P = NS.Particle, f = [], chk = (c, m) => { if (!c) f.push(m); };
  if (patch) patch(P);
  const B = NS.Brigadier || NS.Brig;
  const C = NS.Commands; if (!C.parseParticle) C.build();
  // types
  const flame = P.typeFor('flame');
  chk(flame instanceof P.DefaultParticleType && flame.getParametersFactory().fromCommand(flame) === flame, 'default type: factory returns itself');
  chk(flame.asString() === 'minecraft:flame', 'default asString');
  chk(P.vibration.shouldAlwaysSpawn() === true && P.dust.shouldAlwaysSpawn() === false, 'alwaysShow flags');
  const buf = () => new NS.Net.PacketByteBuf();
  let b = buf(); flame.write(b); chk(b.writerIndex() === 0, 'default type writes nothing');
  // dust
  const d = new P.DustParticleEffect([1, 0.5, 0.25], 9);
  chk(d.scale === 4, 'dust scale clamps to 4: ' + d.scale);
  chk(new P.DustParticleEffect([1, 0, 0], 0).scale === Math.fround(0.01), 'dust scale clamps to 0.01');
  chk(d.asString() === 'minecraft:dust 1.00 0.50 0.25 4.00', 'dust asString: ' + d.asString());
  b = buf(); d.write(b); chk(b.writerIndex() === 16, 'dust writes 4 floats');
  const d2 = P.dust.getParametersFactory().fromBuf(P.dust, b); chk(d2.color.join() === '1,0.5,0.25' && d2.scale === 4, 'dust buf round trip');
  chk(P.DustParticleEffect.DEFAULT.color.join() === '1,0,0' && P.DustParticleEffect.DEFAULT.scale === 1, 'dust DEFAULT');
  // transition
  const t = new P.DustColorTransitionParticleEffect([1, 0, 0], [0, 0, 1], 2);
  chk(t.asString() === 'minecraft:dust_color_transition 1.00 0.00 0.00 2.00 0.00 0.00 1.00', 'transition asString: ' + t.asString());
  b = buf(); t.write(b); chk(b.writerIndex() === 28, 'transition writes 7 floats');
  const t2 = P.dustColorTransition.getParametersFactory().fromBuf(P.dustColorTransition, b);
  chk(t2.toColor.join() === '0,0,1' && t2.scale === 2 && t2.getFromColor().join() === '1,0,0', 'transition buf round trip (scale between colours)');
  chk(Math.abs(P.DustColorTransitionParticleEffect.SCULK_BLUE[2] - 0x5F / 255) < 1e-6 || P.DustColorTransitionParticleEffect.SCULK_BLUE[0] > 0.2, 'SCULK_BLUE from 3790560');
  // vibration
  const v = new P.VibrationParticleEffect({ origin: { x: 1, y: 2, z: 3 }, dest: { x: 4, y: 5, z: 6 }, ticks: 20 });
  chk(v.asString() === 'minecraft:vibration 1.00 2.00 3.00 1.00 2.00 3.00 20', 'vibration asString: ' + v.asString());
  b = buf(); v.write(b); const v2 = P.vibration.getParametersFactory().fromBuf(P.vibration, b);
  chk(v2.vibration.ticks === 20 && v2.vibration.dest.z === 6 && v2.vibration.origin.x === 1, 'vibration buf round trip');
  // real entry: /particle text parsing
  const parse = (s) => C.parseParticle(new B.Reader(s));
  const pd = parse('dust 1 0 0 9');
  chk(pd.scale === 4 && pd.effect instanceof P.DustParticleEffect, 'parseParticle dust goes through the port');
  const pt = parse('dust_color_transition 1 0 0 1 0 0 1');
  chk(pt.toColor && pt.toColor.join() === '0,0,1', 'parseParticle transition');
  const pv = parse('vibration 1.5 2 3 4 5 6 20');
  chk(pv.ticks === 20 && pv.from[0] === 1 && pv.to[2] === 6, 'parseParticle vibration floors to BlockPos: ' + pv.from);
  return f;
}
let breaks = 0, fails = [];
const base = scenario(null); if (base.length) fails.push(...base);
const cuts = {
  'dust no clamp': (P) => { const o = P.DustParticleEffect; P.DustParticleEffect = function (c, s) { const e = new o(c, s); e.scale = s; return e; }; Object.assign(P.DustParticleEffect, o); P.DustParticleEffect.prototype = o.prototype; },
  'dust factory off': (P) => { P.dust.factory.fromBuf = () => { throw new Error('cut'); }; },
  'transition drops toColor': (P) => { const w = P.DustColorTransitionParticleEffect.prototype.write; P.DustColorTransitionParticleEffect.prototype.write = function (b) { w.call(this, b); b.w -= 12; }; },
  'vibration write drops ticks': (P) => { P.VibrationParticleEffect.prototype.write = function (b) { b.writeBlockPos(this.vibration.origin); b.writeIdentifier('minecraft:block'); b.writeBlockPos(this.vibration.dest); b.writeVarInt(0); }; },
  'default type writes': (P) => { P.DefaultParticleType.prototype.write = function (b) { b.writeByte(1); }; },
  'alwaysShow lost': (P) => { P.ParticleType.prototype.shouldAlwaysSpawn = () => false; },
  'default factory wrong': (P) => { P.DefaultParticleType.prototype.getParametersFactory = () => ({ fromCommand: () => null }); },
  'vibration not floored': (P) => { P.vibration.factory.fromCommand = function (t, r) { const R = r; const n = []; for (let i = 0; i < 6; i++) { R.expect(' '); n.push(R.readDouble()); } R.expect(' '); const k = R.readInt(); return new P.VibrationParticleEffect({ origin: { x: n[0], y: n[1], z: n[2] }, dest: { x: n[3], y: n[4], z: n[5] }, ticks: k }); }; },
};
for (const [n, p] of Object.entries(cuts)) { const r = scenario(p); if (r.length) breaks++; else fails.push('cut not caught: ' + n); }
console.log(`particleport11746check: ${fails.length ? 'FAIL ' + fails.join('; ') : 'ok'} — ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
