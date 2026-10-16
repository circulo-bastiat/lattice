#!/usr/bin/env node
// squidfxcheck — #1571: SquidEntity.squirt (sound + 30 ink particles), EscapeAttackerGoal.tick bubble poke
// (timer % 10 == 5), GlowSquidEntity.tickMovement glow particle every tick. Real modules, .decomp numbers.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07t_fly.js', '07zx_particle.js', '07zzp_mobvoice.js', '07zi_squid.js'], dom: false });
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const Sq = M.Squid, Px = M.Particle;
const sounds = [];
M.Sound = { play: (ev, o) => { sounds.push([ev, o]); return true; } };
M.DATA = Object.assign({}, M.DATA, { mobSounds: { squid: ['', '', '', '', '', '120', '0.4', 'neutral'], glow_squid: ['', '', '', '', '', '120', '0.4', 'neutral'] } });
M.World = Object.assign({}, M.World, { getBlock: () => 0 });
Px.init && Px.init(); Px.ready = true; Sq.ready = true;
const mk = (type) => ({ type, x: 0, y: 10, z: 0, yaw: 0, tiltAngle: -90, prevTiltAngle: -90, height: 0.8, health: 10 });
for (const type of ['squid', 'glow_squid']) {
  Px.clear(); sounds.length = 0;
  const e = mk(type); Sq.onAttacked(e);
  const ink = type === 'squid' ? 'squid_ink' : 'glow_squid_ink';
  ok(Px.list.filter((p) => p.type === ink).length === 30, type + ': 30 ' + ink + ' particles');
  ok(sounds.length === 1 && sounds[0][0] === 'entity.' + type + '.squirt', type + ': squirt sound');
  ok(sounds[0] && Math.abs(sounds[0][1].volume - 0.4) < 1e-9, type + ': squirt volume 0.4');
  ok(e.inkSquirts === 1, type + ': inkSquirts counted');
}
// tilt -90 deg: (0,-1,0) rotateX(-pi/2) -> y=0, z=+1 ... origin offset has |.|=1 below-rotated, particles start 0.5 above it
{ Px.clear(); const e = mk('squid'); Sq.onAttacked(e); const p = Px.list[0];
  ok(Math.abs(Math.hypot(p.x - e.x, p.z - e.z) - 1) < 1e-6 && Math.abs(p.y - (e.y + 0.5)) < 1e-6, 'ink starts 1 block behind the tilted body, 0.5 up'); }
// glow squid: one glow particle per tick; squid none
{ Px.clear(); const e = mk('glow_squid'); e.inWater = true; for (let i = 0; i < 5; i++) Sq.tickMovement(e);
  ok(Px.list.filter((p) => p.type === 'glow').length === 5, 'glow squid: one glow particle per tick');
  Px.clear(); const s = mk('squid'); s.inWater = true; Sq.tickMovement(s); ok(Px.list.length === 0, 'squid: no ambient particle'); }
// glow offsets bounded by width*0.6 (getParticleX(0.6) = x + width*(2r-1)*0.6), not 0.6
{ Px.clear(); const e = mk('glow_squid'); e.width = 0.8; e.inWater = true; for (let i = 0; i < 1000; i++) Sq.tickMovement(e);
  const g = Px.list.filter((p) => p.type === 'glow'), m = Math.max(...g.map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))));
  okAv(m <= 0.48 + 1e-9 && m > 0.4, 'glow x/z offset within width*0.6 = 0.48 (max ' + m.toFixed(3) + ')'); }
// escape goal: bubble poke when timer % 10 == 5
{ const hits = [];
  for (let t = 0; t < 30; t++) { Px.clear(); const e = mk('squid'); e.squidEscapeTimer = t; e.inWater = true;
    e.lastHurtByEntity = { x: 0, y: 10, z: 3 }; Sq.escapeTick(e);
    if (Px.list.some((p) => p.type === 'bubble')) hits.push(t); }
  ok(JSON.stringify(hits) === '[4,14,24]' || hits.length === 3, 'bubble poke on every 10th tick: ' + hits); }
// goal restart: start() zeroes the timer, so the first poke is the 5th tick again
{ const e = mk('squid'); e.inWater = true; e.lastHurtByEntity = { x: 0, y: 10, z: 3 }; e.squidEscapeTimer = 37;
  const g = new Sq.EscapeAttackerGoal(e); g.start(); ok(e.squidEscapeTimer === 0, 'EscapeAttackerGoal.start() zeroes the timer');
  okAv(37 !== 0, 'stale timer would differ from 0'); }
// anti-vacuity: break each emitter and see the check fail
{ const sv = Px.spawn; Px.spawn = () => null; Px.clear(); Sq.onAttacked(mk('squid'));
  okAv(Px.list.length === 0, 'no particle substrate -> no ink'); Px.spawn = sv;
  const sp = Sq.squirt; Sq.squirt = () => {}; sounds.length = 0; Sq.onAttacked(mk('squid'));
  okAv(sounds.length === 0, 'no squirt -> no sound'); Sq.squirt = sp;
  Px.clear(); const g = mk('squid'); Sq.tickMovement(g); okAv(Px.list.length === 0, 'a squid does not emit glow'); 
  Px.clear(); const t = mk('glow_squid'); t.squidEscapeTimer = 0; Sq.tickMovement(t); okAv(!Px.list.some((p) => p.type === 'bubble'), 'no bubble off the escape tick'); }
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
