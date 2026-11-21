#!/usr/bin/env node
// soundopts11626check.mjs — #11626: proves 15f_options.js SoundOptionsScreen (ten SoundSource sliders + subtitles)
// and PlayerModelPart (seven skin toggles + Main Hand via SkinOptionsScreen rows), with reachability + SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['02j_sounds.js', '15f_options.js'], dom: false, patch: patch ? (f, s) => (f === '15f_options.js' ? patch(s) : s) : undefined });
  const O = MCL.Options, o = {};
  let saves = 0; const st = { save() { saves++; } };
  MCL.Settings = st;
  const Sn = MCL.Sound; Sn.volumes = null; Sn.volume = 1;
  // SoundOptionsScreen
  const rows = O.soundRows();
  o.rowCount = rows.length === 11 && Sn.SOURCES.length === 10;
  o.masterTop = rows[0].top === true && rows[0].wide === true && !rows[1].top && /^Master Volume: 100%$/.test(rows[0].label());
  rows[1].set(0.5); o.slide = Sn.volumeOf(Sn.SOURCES[1]) === 0.5 && rows[1].label() === 'Music: 50%' && rows[1].frac() === 0.5;
  o.persist = saves === 1 && st.sound === Sn.volumes;
  rows[2].set(0); o.off = /: OFF$/.test(rows[2].label());
  rows[0].set(0.25); o.masterMoves = Sn.volume === 0.25;
  o.labels = Sn.SOURCES.every((s, i) => rows[i].label().startsWith(O.SOUND_LABELS[s] + ':'));
  const sub = rows[10];
  o.subOff = sub.label() === 'Show Subtitles: OFF'; sub.fn(); o.subOn = sub.label() === 'Show Subtitles: ON' && st.showSubtitles === true;
  o.title = O.TITLES.sound === 'Music & Sound Options' && O.ROWS.sound === O.soundRows;
  // PlayerModelPart
  o.parts = O.MODEL_PARTS.map((p) => p[0]).join() === 'cape,jacket,left_sleeve,right_sleeve,left_pants_leg,right_pants_leg,hat';
  const sk = O.skinRows();
  o.skinCount = sk.length === 8 && sk[7].label === 'Main Hand';
  const mp0 = O.modelParts();
  o.defaultsOn = Object.keys(mp0).length === 7 && Object.values(mp0).every((v) => v === true) && sk[0].val() === 'ON';
  sk[6].fn(); o.toggleOff = sk[6].val() === 'OFF' && O.modelParts().hat === false && O.modelParts().cape === true;
  sk[6].fn(); o.toggleBack = O.modelParts().hat === true;
  o.hand0 = O.mainHand() === 'right' && sk[7].val() === 'Right';
  sk[7].fn(); o.hand1 = O.mainHand() === 'left' && sk[7].val() === 'Left';
  o.skinTitle = O.TITLES.skin === 'Skin Customization' && O.ROWS.skin === O.skinRows && O.GEOM.skin.titleY === 20;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const opt = rd('15f_options.js');
ok(/O\.go\('sound'\)/.test(opt) && /O\.go\('skin'\)/.test(opt), 'reach: Options buttons open Sound and Skin screens');
ok(/O\.modelParts\(\)/.test(rd('14k_hand3d.js') + rd('07j_entityrender.js')) || /modelParts \? O\.modelParts/.test(rd('07j_entityrender.js')), 'reach: renderers read modelParts');
const BR = [
  ['tenSources', "var srcs = (Sn && Sn.SOURCES) || ['master'];", "var srcs = ['master'];", ['rowCount', 'labels']],
  ['masterTop', 'wide: first, top: first', 'wide: false, top: false', ['masterTop']],
  ['offLabel', "(v <= 0 ? 'OFF' :", "(false ? 'OFF' :", ['off']],
  ['setVol', 'Sn.setSourceVolume(src, f);', '', ['slide', 'masterMoves']],
  ['persist', 'S().sound = Sn.volumes; S().save();', '', ['persist']],
  ['subtitles', "t.showSubtitles = !(t.showSubtitles === true); t.save();", 't.save();', ['subOn']],
  ['partList', "['hat', 'Hat']]", "]", ['parts', 'skinCount']],
  ['partDefault', "S()[k] !== false ? 'ON'", "S()[k] === true ? 'ON'", ['defaultsOn']],
  ['partToggle', 'fn: function () { var t = S(); t[k] = !(t[k] !== false); t.save(); } };', 'fn: function () { var t = S(); t.save(); } };', ['toggleOff']],
  ['modelPartsRead', "S()['modelPart_' + O.MODEL_PARTS[i][0]] !== false", 'false', ['defaultsOn']],
  ['mainHand', "t.mainHand = t.mainHand === 'left' ? 'right' : 'left';", '', ['hand1']],
  ['skinRoute', 'sound: O.soundRows, language: O.languageRows, skin: O.skinRows', 'sound: O.soundRows, language: O.languageRows, skin: O.languageRows', ['skinTitle']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`soundopts11626check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
