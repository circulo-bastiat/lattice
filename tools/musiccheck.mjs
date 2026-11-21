#!/usr/bin/env node
// musiccheck.mjs — #253: music scheduler + cave mood vs MusicTracker/MusicType/BiomeEffectSoundPlayer.
// Delays are parsed from .decomp MusicType.java; the scheduler is compared against an independent
// literal transcription of MusicTracker.tick over random scripts. Anti-vacuity (D-30): mutants.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (c) { pass++; console.log('  ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
console.log('musiccheck — #253: music tracker + mood vs .decomp');
const S = loadEngine({ extra: ['02j_sounds.js'] }).Sound;

// constants from MusicType.java
const mt = readFileSync(join(ROOT, '.decomp/net/minecraft/client/sound/MusicType.java'), 'utf8');
const C = {}; for (const m of mt.matchAll(/(MENU|CREATIVE|CREDITS|DRAGON|END)\s*=\s*new MusicSound\(\w+\.\w+,\s*(\d+),\s*(\d+),\s*(true|false)/g)) C[m[1].toLowerCase()] = [+m[2], +m[3], m[4] === 'true'];
for (const [k, v] of Object.entries(C)) ok(S.MUSIC[k === 'creative' ? 'flyer' : k][1] === v[0] && S.MUSIC[k === 'creative' ? 'flyer' : k][2] === v[1] && S.MUSIC[k === 'creative' ? 'flyer' : k][3] === v[2], 'MusicType.' + k + ' delays/replace');
ok(Object.keys(C).length === 5, 'parsed 5 MusicType constants');
ok(/GAME_MIN_DELAY = 12000/.test(mt) && S.MUSIC.game[1] === 12000 && S.MUSIC.game[2] === 24000 && S.MUSIC.underwater[1] === 12000, 'game/underwater 12000..24000');
ok(!('music' in S.OWED_SOURCES) && !('ambient' in S.OWED_SOURCES), 'music/ambient struck from S.OWED_SOURCES');

// LCG so both implementations draw the same numbers
const mk = (seed) => { let s = seed >>> 0; return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor(s / 4294967296 * n); }; };
// literal MusicTracker.tick
function ref(rnd, io) {
  const r = { cur: null, ev: null, t: 100 };
  const ni = (a, b) => a >= b ? a : rnd(b - a + 1) + a;
  r.tick = (T) => {
    if (r.cur !== null) {
      if (T[0] !== r.ev && T[3]) { io.stop(r.cur); r.t = ni(0, Math.trunc(T[1] / 2)); }
      if (!io.isPlaying(r.cur)) { r.cur = null; r.t = Math.min(r.t, ni(T[1], T[2])); }
    }
    r.t = Math.min(r.t, T[2]);
    if (r.cur === null && r.t-- <= 0) { r.cur = io.play(T[0]); r.ev = T[0]; r.t = 2147483647; }
  };
  return r;
}
function run(Impl, seed) {
  const log = []; let now = 0, id = 0; const ends = {};
  const rnd = mk(seed), env = mk(seed ^ 0x9e3779b9);
  const io = { play: (e) => { id++; ends[id] = now + 1000 + env(3000); log.push(now + ':play:' + e); return id; },
    isPlaying: (h) => ends[h] > now, stop: (h) => { ends[h] = 0; log.push(now + ':stop'); } };
  const t = Impl(rnd, io); const types = [S.MUSIC.menu, S.MUSIC.game, S.MUSIC.flyer, S.MUSIC.end, S.MUSIC.underwater];
  let T = types[0];
  for (now = 0; now < 120000; now++) { if (env(4000) === 0) T = types[env(types.length)]; t.tick(T); }
  return log.join(',');
}
let diffs = 0, plays = 0;
for (let seed = 1; seed <= 12; seed++) {
  const a = run((r, io) => new S.MusicTracker(r, io), seed), b = run(ref, seed);
  if (a !== b) diffs++; plays += a.split(':play:').length - 1;
}
ok(diffs === 0 && plays > 40, `tracker matches MusicTracker.tick over 12 scripts (${plays} plays, ${diffs} diffs)`);
// first song: menu waits 100 ticks, then plays
{ const log = []; const t = new S.MusicTracker(mk(1), { play: (e) => { log.push(e); return 1; }, isPlaying: () => true, stop() {} });
  let first = -1; for (let i = 0; i < 200 && first < 0; i++) { t.tick(S.MUSIC.game); if (log.length) first = i; }
  ok(first === 100, 'first track starts on tick 100 (timeUntilNextSong=100, post-decrement); got ' + first);
  t.stop(); ok(t.timeUntilNextSong === 2147483647 + 100, 'stop() adds 100'); }
// musicType selection
const base = { inGame: true, dimension: 'overworld' };
ok(S.musicType({ inGame: false }) === S.MUSIC.menu && S.musicType(base) === S.MUSIC.game, 'menu / game');
ok(S.musicType({ ...base, canFlyNow: true }) === S.MUSIC.flyer && S.musicType({ ...base, dimension: 'nether', canFlyNow: true }) === S.MUSIC.game, 'creative flying, not in nether');
ok(S.musicType({ ...base, submergedInOcean: true }) === S.MUSIC.underwater && S.musicType({ ...base, dimension: 'end' }) === S.MUSIC.end && S.musicType({ ...base, dimension: 'end', dragonFight: true }) === S.MUSIC.dragon, 'underwater / end / dragon');

// mood
const cave = readFileSync(join(ROOT, '.decomp/net/minecraft/sound/BiomeMoodSound.java'), 'utf8');
ok(/CAVE = new BiomeMoodSound\(SoundEvents\.\w+, 6000, 8, 2\.0\)/.test(cave) && S.MOOD_CAVE.ticks === 6000 && S.MOOD_CAVE.range === 8 && S.MOOD_CAVE.extra === 2 && S.MOOD_CAVE.event === 'ambient.cave', 'BiomeMoodSound.CAVE');
function mood(P, sky, blk, n) {
  const p = new P(mk(7), S.MOOD_CAVE), out = []; 
  for (let i = 0; i < n; i++) p.tick({ x: 0.5, y: 10, z: 0.5, sky: () => sky, block: () => blk }, (e, x, y, z) => out.push([i, e, x, y, z]));
  return out;
}
const dark = mood(S.MoodPlayer, 0, 0, 20000);
ok(dark.length === 3, 'fully dark: (0-1)/6000 per tick raises mood -> 3 plays in 20000 ticks, got ' + dark.length);
const dk = mood(S.MoodPlayer, 0, 0, 6001);
ok(dk.length === 1 && dk[0][0] >= 5990 && dk[0][0] <= 6001, 'fully dark plays about every 6000 ticks (first at ' + (dk[0] && dk[0][0]) + ')');
ok(mood(S.MoodPlayer, 15, 0, 20000).length === 0 && mood(S.MoodPlayer, 0, 15, 20000).length === 0, 'sky light or bright block light never fires');
const d = dk[0]; const dist = Math.hypot(d[2] - 0.5, d[3] - 10, d[4] - 0.5);
ok(dist > 2 && dist < 8 * Math.sqrt(3) * 1.0 + 3, 'sound placed offset 2.0 beyond the picked block (dist ' + dist.toFixed(2) + ')');
// mutants
caught(mood(S.MoodPlayer, 0, 0, 6001).length === 1 && mood(function (r, m) { return new S.MoodPlayer(r, { ...m, ticks: 12000 }); }, 0, 0, 6001).length === 0, 'mood ticks 12000 delays the sound');
caught(run((r, io) => { const t = new S.MusicTracker(r, io); t.timeUntilNextSong = 99; return t; }, 3) !== run(ref, 3), 'wrong initial delay differs');
caught(run((r, io) => { const t = new S.MusicTracker(r, io); const o = t.tick; t.tick = (T) => o.call(t, [T[0], T[1], T[2], false]); return t; }, 5) !== run(ref, 5), 'ignoring replace-current differs');
caught(run((r, io) => { const t = new S.MusicTracker(r, io); const o = t.tick; t.tick = (T) => o.call(t, [T[0], T[1], T[2] * 2, T[3]]); return t; }, 2) !== run(ref, 2), 'doubled max delay differs');
caught(S.musicType({ ...base, dimension: 'nether', canFlyNow: true }) !== S.MUSIC.flyer, 'creative music in nether is flagged');
for (const f of fails) console.log('  ✗ ' + f);
console.log(`assertions passed ..... ${pass}\nfailures ........... ${fails.length}\n${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
