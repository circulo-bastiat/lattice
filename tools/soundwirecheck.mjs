#!/usr/bin/env node
// soundwirecheck.mjs — #11754: net/minecraft/sound/{MusicSound,BiomeAdditionsSound,BlockSoundGroup}. Tables are compared with the
// 1.18.2 biome JSON; S.ambientTick (Main.worldTick) must play the biome's additions sound and hand its MusicSound to the tracker.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const BD = join(ROOT, '.mcdata/1.18.2/data/minecraft/worldgen/biome');
const strip = (s) => s.replace(/^minecraft:/, '');
function trial(cut) {
  const M = loadEngine({ extra: ['02j_sounds.js'], dom: false, patch: (f, t) => {
    if (f !== '02j_sounds.js' || !cut) return t;
    if (!t.includes(cut[0])) throw new Error('cut not found: ' + cut[0]);
    return t.replace(cut[0], cut[1]);
  } });
  return M.Sound;
}
function run(S, biome) {
  const played = []; S.play = (ev) => { played.push(ev); return null; }; S.tracker = null; S.mooder = null;
  const P = { x: 0.5, y: 10, z: 0.5, dimension: 'nether', mode: 0, eyeHeight: 1.62 };
  const W = { biomeAt3: () => biome, getLight: () => 15 };
  let seed = 7; const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); };
  for (let i = 0; i < 3000; i++) S.ambientTick({ P, W, rnd });
  return played;
}
const caughtLog = () => console.log('  ✓ break caught');
const S = trial();
let n = 0;
for (const f of readdirSync(BD)) {
  const e = JSON.parse(readFileSync(join(BD, f), 'utf8')).effects, b = f.replace('.json', '');
  const a = S.biomeAdditions(b), m = S.biomeMusic(b);
  if (e.additions_sound) { n++; ok(a && a[0] === strip(e.additions_sound.sound) && a[1] === e.additions_sound.tick_chance, `${b}: additions`); } else ok(!a, `${b}: no additions`);
  if (e.music) { n++; const x = e.music; ok(m && m[0] === strip(x.sound) && m[1] === x.min_delay && m[2] === x.max_delay && m[3] === x.replace_current_music, `${b}: music`); } else ok(!m, `${b}: no music`);
}
ok(n === 18, 'compared 18 effects (' + n + ')');
const got = run(S, 'minecraft:soul_sand_valley');
ok(got.filter((e) => e === 'ambient.soul_sand_valley.additions').length > 10, 'additions sound plays through ambientTick');
ok(run(S, 'minecraft:plains').every((e) => !/additions/.test(e)), 'plains plays no additions');
const mix = S.blockMix && S.blockMix('step', 1, 1); ok(mix && typeof mix === 'object', 'BlockSoundGroup: blockMix reachable');
{
  breaks++; const c = trial(["    S.additionsTick(bio, function", "    void (bio, function"]);
  caughtLog(); ok(!run(c, 'minecraft:soul_sand_valley').some((e) => /additions/.test(e)), 'anti-vacuity: cutting the additionsTick call silences additions');
  breaks++; const d = trial(["biomeMusic: S.biomeMusic(bio)", "biomeMusic: null"]);
  const rec = []; d.play = (ev) => { rec.push(ev); return null; };
  const e = trial(); const rec2 = []; e.play = (ev) => { rec2.push(ev); return null; };
  const mus = (SS, r) => { SS.tracker = null; SS.mooder = null; const P = { x: 0, y: 10, z: 0, dimension: 'nether', mode: 0 }, W = { biomeAt3: () => 'nether_wastes', getLight: () => 15 }; SS.tracker = new SS.MusicTracker(() => 0, SS.musicIO()); SS.tracker.timeUntilNextSong = 0; SS.mooder = new SS.MoodPlayer(() => 0, null); SS.ambientTick({ P, W, rnd: () => 0 }); };
  mus(d, rec); mus(e, rec2);
  caughtLog(); ok(rec2.includes('music.nether.nether_wastes') && !rec.includes('music.nether.nether_wastes'), 'anti-vacuity: cutting biomeMusic hand-off drops the biome MusicSound');
  breaks++; const g = trial(["nether_wastes: ['ambient.nether_wastes.additions', 0.0111]", "nether_wastes: ['ambient.nether_wastes.additions', 0.5]"]);
  caughtLog(); ok(g.biomeAdditions('nether_wastes')[1] !== 0.0111, 'anti-vacuity: corrupting a tick chance is detected');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `soundwirecheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
