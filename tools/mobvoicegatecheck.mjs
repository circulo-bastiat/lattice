#!/usr/bin/env node
// mobvoicegatecheck.mjs — #4003: a mob's voice (ambient/hurt/death/step) is registered only for audited mobs.
// Loads src/07zzp_mobvoice.js with the real mob-sounds table; every MV.AUDITED mob must speak, no other may.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const R = (p) => fileURLToPath(new URL(p, import.meta.url));
const table = {};
for (const l of readFileSync(R('./golden/mob-sounds-1.18.2.tsv'), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
const src = readFileSync(R('../src/07zzp_mobvoice.js'), 'utf8');
function load(code = src) {
  const played = [], NS = { DATA: { mobSounds: table }, Sound: { play: (ev) => { played.push(ev); return true; } } };
  new Function('MCL', code)(NS);
  return { MV: NS.MobVoice, played };
}
function verdict(MV, played) {
  const bad = [];
  for (const t of Object.keys(table)) {
    if (MV.SKIP[t] || MV.OWN[t] || !table[t][2]) continue;   // own voice code / no death sound in the table
    played.length = 0;
    const spoke = MV.onDamage({ type: t, health: 0, x: 0, y: 0, z: 0 }, true) && played.length > 0;
    if (!!MV.AUDITED[t] !== spoke) bad.push(t);
  }
  played.length = 0;   // a direct emit (cat eat, polar bear warning, dolphin) is gated too
  if (MV.emit({ type: 'creeper', x: 0, y: 0, z: 0 }, 'entity.creeper.hurt') || played.length) bad.push('creeper direct emit');
  return bad;
}
// #4183: panda's own Pd.playSound (hurt/death/bite/sneeze/eat/cant_breed) is gated too, and no other path plays directly
const pdSrc = readFileSync(R('../src/07zl_panda.js'), 'utf8');
function pandaSpeaks(code, audited) {
  const played = [], NS = { MobVoice: { GATED: true, AUDITED: audited ? { panda: 1 } : {} }, Sound: { play: (ev) => { played.push(ev); return true; } } };
  new Function('MCL', code)(NS);
  NS.Panda = NS.Panda || NS.Pd;
  const P = Object.values(NS).find((v) => v && v.playSound);
  P.playSound({ type: 'panda', x: 0, y: 0, z: 0 }, 'entity.panda.hurt', 1, 1);
  return played.length > 0;
}
const direct = (code) => (code.match(/Sound\.play\(/g) || []).length;
const pdBad = () => { const f = []; if (llamaSpeaks(llSrc, false)) f.push('llama speaks unaudited'); if (!llamaSpeaks(llSrc, true)) f.push('audited llama mute'); if (pandaSpeaks(pdSrc, false)) f.push('panda speaks unaudited'); if (!pandaSpeaks(pdSrc, true)) f.push('audited panda mute'); if (direct(pdSrc) !== 1) f.push('panda plays outside Pd.playSound'); return f; };
// #4464: llama's own Ll.playSound is gated too
const llSrc = readFileSync(R('../src/07ze_llama.js'), 'utf8');
function llamaSpeaks(code, audited) {
  const played = [], NS = { MobVoice: { GATED: true, AUDITED: audited ? { llama: 1 } : {} }, Sound: { play: (ev) => { played.push(ev); return true; } } };
  new Function('MCL', code)(NS);
  NS.Llama.playSound({ type: 'llama', x: 0, y: 0, z: 0 }, 'entity.llama.death', 1, 1);
  return played.length > 0;
}
// #4262: MV.OWN types voice themselves (SnowGolem.playSound, Cb.golemSound) and are gated too
const sgSrc = readFileSync(R('../src/07zq_snowgolem.js'), 'utf8'), cbSrc = readFileSync(R('../src/14j_combat.js'), 'utf8');
function ownSpeaks(code, audited, fn) {
  const played = [], NS = { fbRand: () => 0.5, EntityList: { wr: () => 0.5 }, MobVoice: { GATED: true, AUDITED: audited ? { snow_golem: 1, iron_golem: 1 } : {} }, Sound: { play: (ev) => { played.push(ev); return true; } } };
  try { new Function('MCL', code)(NS); } catch (e) { /* later modules may be absent */ }
  fn(NS)({ type: audited ? 'snow_golem' : 'snow_golem', x: 0, y: 0, z: 0 });
  return played.length > 0;
}
const sgCall = (NS) => (e) => NS.SnowGolem.playSound(e, 'entity.snow_golem.hurt');
const cbCall = (NS) => (e) => NS.Combat.golemSound(e, 'entity.iron_golem.hurt');
const ownBad = () => { const f = [];
  for (const [n, code, fn] of [['snow_golem', sgSrc, sgCall], ['iron_golem', cbSrc, cbCall]]) {
    if (ownSpeaks(code, false, fn)) f.push(n + ' speaks unaudited'); if (!ownSpeaks(code, true, fn)) f.push('audited ' + n + ' mute'); }
  return f; };
// #4303: the zombie family's Undead.playSound / tickSounds are gated too (husk is audited; zombie is not)
const unSrc = readFileSync(R('../src/07zk_undead.js'), 'utf8');
function undeadSpeaks(code, type, audited) {
  const played = [], NS = { MobVoice: { GATED: true, AUDITED: audited ? { [type]: 1 } : {} }, Sound: { entitySound: (ev) => { played.push(ev); return true; } } };
  new Function('MCL', code)(NS);
  const e = { type, x: 0, y: 0, z: 0, onGround: true, angerTime: 5, angrySoundDelay: 1, angryPrevTarget: true, target: {} };
  NS.Undead.playSound(e, 'hurt'); NS.Undead.playHuskSound(e, 'hurt'); NS.Undead.tickAngrySound(e, () => 0);
  return played.length > 0;
}
const unBad = () => { const f = [];
  for (const t of ['husk', 'zombie', 'zombie_villager', 'zombified_piglin', 'drowned']) {
    if (undeadSpeaks(unSrc, t, false)) f.push(t + ' speaks unaudited'); if (!undeadSpeaks(unSrc, t, true)) f.push('audited ' + t + ' mute'); }
  return f; };
// #4315: Ai.vexSound is gated too
const gSrc = readFileSync(R('../src/07k_goals.js'), 'utf8');
function vexSpeaks(code, audited) {
  const played = [], NS = { MobVoice: { GATED: true, AUDITED: audited ? { vex: 1 } : {} }, Sound: { play: (ev) => { played.push(ev); return true; } } };
  try { new Function('MCL', code)(NS); } catch (e) { /* later modules may be absent */ }
  for (const k of ['ambient', 'hurt', 'death', 'charge']) NS.Ai.vexSound({ type: 'vex', x: 0, y: 0, z: 0 }, k);
  return played.length > 0;
}
const vexBad = () => { const f = []; if (vexSpeaks(gSrc, false)) f.push('vex speaks unaudited'); if (!vexSpeaks(gSrc, true)) f.push('audited vex mute'); return f; };
let caught = 0;
const { MV, played } = load();
const n = Object.keys(MV.AUDITED).length;
const fail = verdict(MV, played);
fail.push(...pdBad(), ...ownBad(), ...unBad(), ...vexBad());
// #4373: MV.HORSES is exactly the HorseBaseEntity subclasses that keep super's updateAnger (llamas override)
const horseBad = (m) => Object.keys(m.HORSES).sort().join() === 'donkey,horse,mule,skeleton_horse,zombie_horse' ? [] : ['MV.HORSES is not the horse family'];
fail.push(...horseBad(MV));
if (!n) fail.push('empty AUDITED list');
for (const t of Object.keys(MV.AUDITED)) if (!table[t]) fail.push(t + ': audited but no sound row');
// #4384: the skeleton family's package-private getStepSound must reach the table (step column = index 3), and EL must not also step them
const stepBad = (tbl) => ['skeleton', 'stray', 'wither_skeleton'].filter((t) => !(tbl[t] && tbl[t][3])).map((t) => t + ': empty step column');
fail.push(...stepBad(table));
{ const b = { ...table, stray: table.stray.map((v, i) => (i === 3 ? '' : v)) }; if (stepBad(b).length) caught++; }
const elSrc = readFileSync(R('../src/07i_entitylist.js'), 'utf8');
if (!/MobVoice\.AUDITED\[t\]\) return;/.test(elSrc)) fail.push('EL.tickStep does not defer audited types to MobVoice');
else if (!/MobVoice\.AUDITED\[t\]\) return;/.test(elSrc.replace('MobVoice.AUDITED[t]) return;', ''))) caught++;
for (const t of ['skeleton', 'stray', 'wither_skeleton']) if (!MV.AUDITED[t]) fail.push(t + ' not audited');
if (fail.length) { console.log('✗ mobvoicegatecheck: ' + fail.join(', ')); process.exit(1); }
// breaks (D-30): each one un-gates or mis-lists, and must be caught
const brk = (code, tweak) => { const o = load(code); if (tweak) tweak(o.MV); if (verdict(o.MV, o.played).length) caught++; };
if (horseBad({ HORSES: { ...MV.HORSES, endermite: 1 } }).length) caught++;
brk(src.replace('MV.GATED = true', 'MV.GATED = false'));
brk(src.replace('(MV.GATED && !MV.AUDITED[e.type]) || ', ''));
brk(src.replace('(!MV.GATED || MV.AUDITED[type]) && ', ''));
brk(src.replace('(MV.GATED && !MV.AUDITED[e.type]) || ', '').replace('(!MV.GATED || MV.AUDITED[type]) && ', ''));
if (pandaSpeaks(pdSrc.replace(' || (MV && MV.GATED && !MV.AUDITED[e.type])', ''), false)) caught++;
if (llamaSpeaks(llSrc.replace(' || (MV && MV.GATED && !MV.AUDITED[e.type])', ''), false)) caught++;
const G = ' || (MV && MV.GATED && !MV.AUDITED[e.type])';
if (ownSpeaks(sgSrc.replace(G, ''), false, sgCall)) caught++;
if (ownSpeaks(cbSrc.replace(G, ''), false, cbCall)) caught++;
if (undeadSpeaks(unSrc.replace('Undead.muted = function (e) {', 'Undead.muted = function (e) { return false;'), 'zombie', false)) caught++;
if (undeadSpeaks(unSrc.replace('!ev || Undead.muted(e) || !S', '!ev || !S'), 'husk', false)) caught++;
if (undeadSpeaks(unSrc.replace('if (!ev || Undead.muted(e)) return null;', 'if (!ev) return null;'), 'zombie', false)) caught++;
if (undeadSpeaks(unSrc.replace('&& !Undead.muted(e)) {', ') {'), 'zombified_piglin', false)) caught++;
if (vexSpeaks(gSrc.replace(' || (MV && MV.GATED && !MV.AUDITED[e.type])', ''), false)) caught++;
if (direct(pdSrc.replace("Pd.playSound(e, Pd.SOUND.bite, 1, 1)", "NS.Sound.play('x')")) !== 1) caught++;
console.log(`✓ mobvoicegatecheck: ${n} audited mobs speak, no other does; ${caught} breaks caught`);
console.log(` assertions passed .. ${Object.keys(table).length + 1}`);
if (caught < 3) process.exit(1);
