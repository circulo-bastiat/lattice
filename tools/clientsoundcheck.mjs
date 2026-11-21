#!/usr/bin/env node
// clientsoundcheck.mjs - #11728: the table-form client/sound classes in 02j_sounds.js, proven against .decomp.
// Classes proven: WeightedSoundSet + SoundContainer (weighted pick, Sound.getWeight sum, nextInt(total) walk),
// SoundEntry + SoundEntryDeserializer (defaults volume/pitch 1.0, weight 1), SoundManager (event -> set lookup, missing -> none),
// SoundListener + SoundEngine + SoundInstance + AbstractSoundInstance (listener = camera, play() attenuates then plays).
// Mutants (source edits) must each be caught: prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const dec = (c) => readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/sound', c + '.java'), 'utf8');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
// vanilla facts from .decomp, not memory
ok(/getFloat\(\$\$0, "volume", 1\.0F\)/.test(dec('SoundEntryDeserializer')) && /getFloat\(\$\$0, "pitch", 1\.0F\)/.test(dec('SoundEntryDeserializer')) && /"weight", 1\)/.test(dec('SoundEntryDeserializer')), 'decomp defaults 1/1/1');
ok(/nextInt\(\$\$0\)/.test(dec('WeightedSoundSet')) && /\$\$1 -= \$\$2\.getWeight\(\)/.test(dec('WeightedSoundSet')), 'decomp weighted walk');
function trial(patch) {
  const M = loadEngine({ extra: ['02j_sounds.js'], dom: false, patch: patch ? (f, s) => (f === '02j_sounds.js' ? patch(s) : s) : undefined });
  const S = M.Sound, o = {};
  S.events = { a: { s: [{ i: 0, w: 1 }, { i: 1, w: 1 }, { i: 2, w: 1 }, { i: 3, w: 4 }] }, b: { s: [{ e: 'a', v: 0.5, p: 2 }] }, c: { s: [{ i: 9 }] } };
  S.ready = true;
  const cnt = [0, 0, 0, 0]; const N = 70;   // total weight 7; rnd=(k+0.5)/7 walks every slot once
  for (let k = 0; k < 7; k++) cnt[S.pick('a', (k + 0.5) / 7).i]++;
  o.weight = cnt.join() === '1,1,1,4';
  const c = S.pick('c', 0); o.defaults = c.i === 9 && c.v === 1 && c.p === 1;
  o.missing = S.pick('nope', 0) === null;
  const r = S.pick('b', 0); o.ref = !!r && r.v === 0.5 && r.p === 2;
  o.atten = S.attenuate(1, 8, 0, 0, 16) === 0.5 && S.attenuate(1, 16, 0, 0, 16) === 0 && S.attenuate(2, 16, 0, 0, 16) === 1 * 0.5 * 1 && S.attenuate(0.5, 0, 0, 0, 16) === 0.5 && S.attenuate(0.5, 8, 0, 0, 16) === 0.25;
  M.Player = { x: 1, y: 2, z: 3, yaw: 4 }; const L = S.listenerNow();
  o.listener = L.x === 1 && L.y === 2 && L.z === 3 && L.yaw === 4;
  M.Player = null; o.nolistener = S.listenerNow() === null;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
// reachability: the real play path uses pick + attenuate + listenerNow
const src = readFileSync(join(MCLITE_ROOT, 'src/02j_sounds.js'), 'utf8');
const play = src.slice(src.indexOf('S.play = function'), src.indexOf('S.entitySound = function'));
ok(/S\.pick\(/.test(play) && /S\.attenuate\(/.test(play) && /S\.listenerNow\(/.test(play), 'reach: S.play uses pick/attenuate/listenerNow');
const BR = [
  ['weight', "total += (e.s[i].w || 1);", "total += 1;", ['weight']],
  ['walk', "r -= (e.s[i].w || 1);", "r -= 1;", ['weight']],
  ['defv', "v: (s.v === undefined ? 1 : s.v), p: (s.p === undefined ? 1 : s.p), a: s.a };\n      }", "v: (s.v === undefined ? 0 : s.v), p: (s.p === undefined ? 1 : s.p), a: s.a };\n      }", ['defaults']],
  ['defp', "p: (s.p === undefined ? 1 : s.p), a: s.a };\n      }", "p: (s.p === undefined ? 0 : s.p), a: s.a };\n      }", ['defaults']],
  ['reref', "inner.v * (s.v === undefined ? 1 : s.v)", "inner.v", ['ref']],
  ['linear', "(1 - d / reach)", "(1 - d / reach) * 0.9", ['atten']],
  ['clamp', "Math.max(vol, 1) * att", "vol * att", ['atten']],
  ['listen', "yaw: P.yaw || 0", "yaw: 0", ['listener']],
  ['nolisten', "if (!P) return null;", "if (!P) return {x:0,y:0,z:0,yaw:0};", ['nolistener']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]); ok(caught, 'anti-vacuity: break ' + key); if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('  FAIL ' + f);
console.log(`clientsoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
