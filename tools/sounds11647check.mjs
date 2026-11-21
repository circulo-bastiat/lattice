#!/usr/bin/env node
// sounds11647check.mjs — #11647: proves 02j_sounds.js MusicTracker/MusicType/BiomeEffectSoundPlayer(mood)/BiomeMoodSound/
// PositionedSoundInstance/MovingSoundInstance(loopVoice)/SoundSystem(play, entitySound) are REACHED by the game loop
// (17_main worldTick -> Sound.ambientTick) and that EggItem/SplashPotionItem's throw sound goes through entitySound. SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['02j_sounds.js'], dom: false, patch: patch ? (f, s) => (f === '02j_sounds.js' ? patch(s) : s) : undefined });
  const S = M.Sound, o = {}, ev = [];
  S.play = (e, opts) => { ev.push([e, opts && opts.source]); return true; };
  let seed = 7; const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); };
  const P = { x: 0.5, y: 10, z: 0.5, eyeHeight: 1.62, mode: 0, dimension: 'overworld' };
  const dark = { biomeAt3: () => 'plains', getLight: () => 0 };   // sky 0, block 0 -> mood climbs 1/6000 per tick... block-1 = -1
  let ok1 = true;
  for (let i = 0; i < 400; i++) ok1 = S.ambientTick({ P, W: dark, rnd }) && ok1;
  o.tick = ok1;
  o.music = ev.some((e) => e[0] === 'music.game' && e[1] === 'music');
  const n0 = ev.filter((e) => e[0] === 'ambient.cave').length;
  for (let i = 0; i < 12000; i++) S.ambientTick({ P, W: dark, rnd });
  o.cave = ev.some((e) => e[0] === 'ambient.cave' && e[1] === 'ambient');
  const ev2 = ev.length; ev.length = 0;
  const P2 = { x: 0.5, y: 10, z: 0.5, eyeHeight: 1.62, mode: 1, dimension: 'overworld' };
  S.tracker = null; for (let i = 0; i < 300; i++) S.ambientTick({ P: P2, W: dark, rnd });
  o.creative = ev.some((e) => e[0] === 'music.creative');
  const v = S.loopVoice('entity.bee.loop', 'neutral'); v.set(1, 1, 0, 0, 0);
  o.loop = v.vol === 1 && typeof v.stop === 'function';
  const calls = []; S.play = (e, opts) => { calls.push([e, opts.source]); };
  S.entitySound('entity.egg.throw', 0, 0, 0, 0.5, 1, 'player', null);
  o.entity = calls.length === 1 && calls[0][1] === 'player';
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const main = readFileSync(join(MCLITE_ROOT, 'src', '17_main.js'), 'utf8');
ok(/NS\.Sound\.ambientTick\(\{ P: NS\.Player, W: NS\.World \}\)/.test(main), 'reach: 17_main worldTick calls Sound.ambientTick');
const th = readFileSync(join(MCLITE_ROOT, 'src', '07zzd_throw.js'), 'utf8');
ok(/sound: 'entity\.egg\.throw',\s+category: 'player'/.test(th) && /S\.entitySound\(def\.sound/.test(th), 'reach: EggItem throw sound via entitySound');
ok(/splash_potion:[^\n]*\n[^\n]*sound:/.test(th) || /splash_potion:[\s\S]{0,300}sound:/.test(th), 'reach: SplashPotionItem throw sound in Th.ITEMS');
const BR = [
  ['mood', "emit(m.event, env.x + dx / d * t", "emit('x', env.x + dx / d * t", ['cave']],
  ['moodsrc', "{ source: 'ambient', x: x", "{ source: 'block', x: x", ['cave']],
  ['musicsrc', "S.play(ev, { source: 'music' })", "S.play(ev, { source: 'block' })", ['music']],
  ['creative', "canFlyNow: P.mode === 1", "canFlyNow: false", ['creative']],
  ['gamedelay', "game: ['music.game', 12000, 24000, false]", "game: ['music.gamex', 12000, 24000, false]", ['music']],
  ['loop', "v.set = function (vol, pitch, x, y, z) { v.vol = vol;", "v.set = function (vol, pitch, x, y, z) { v.vol = 0;", ['loop']],
  ['entity', "return S.play(ev, { volume: volume, pitch: pitch, x: x, y: y, z: z, source: source, listener: listener });", "return S.play(ev, { volume: volume, pitch: pitch, x: x, y: y, z: z, source: 'block', listener: listener });", ['entity']],
  ['tick', "S.tracker.tick(type);", "", ['music']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`sounds11647check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
