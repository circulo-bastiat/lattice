#!/usr/bin/env node
// minecartsoundcheck.mjs — #4499: a cart owns a looping entity.minecart.riding voice (MovingMinecartSoundInstance):
// volume lerp(clamp(speed,0,.5),0,.7) once speed >= .01, else 0; silent carts stay mute; removal stops it. Ends "<n> breaks caught".
import { loadEngine } from './loadsrc.mjs';

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '07zzq_rail.js', '07zzr_minecart.js'], dom: false });
const voices = [];
M.Sound = { loopVoice: (ev) => { const v = { event: ev, stopped: false, vol: 0, stop() { v.stopped = true; }, set(vol) { v.vol = vol; } }; voices.push(v); return v; } };

function run(roll) {
  voices.length = 0;
  const r = {}, near = (a, b) => Math.abs(a - b) < 1e-5;
  const e = { x: 0, y: 0, z: 0, vx: 0, vz: 0 };
  roll(e); r.mute = voices.length === 1 && (voices[0] || {}).event === 'entity.minecart.riding' && (voices[0] || {}).vol === 0;
  e.vx = 0.3; roll(e); r.mid = near((voices[0] || {}).vol, 0.21);
  e.vx = 3; roll(e); r.fast = near((voices[0] || {}).vol, 0.35);
  e.vx = 0.005; roll(e); r.slow = (voices[0] || {}).vol === 0;
  e.vx = 0.3; e.silent = true; roll(e); r.silent = (voices[0] || {}).vol === 0;
  e.removed = true; roll(e); r.gone = (voices[0] || {}).stopped && voices.length === 1;
  return r;
}
// riding player: two inside voices, underwater gating, stop on dismount
function rider(roll) {
  const P = (M.Player = M.Player || {}); const e = { x: 0, y: 0, z: 0, vx: 0.4, vz: 0 }; P.vehicle = e; P.eyeInWater = false;
  const ins = () => voices.filter((v) => /inside/.test(v.event)), near = (a, b) => Math.abs(a - b) < 1e-5, r = [];
  voices.length = 0; roll(e);
  r.push(ins().length === 2 && ins()[0].event === 'entity.minecart.inside' && ins()[1].event === 'entity.minecart.inside.underwater');
  r.push(ins().length === 2 && near(ins()[0].vol, 0.3) && ins()[1].vol === 0);
  P.eyeInWater = true; roll(e); r.push(ins().length === 2 && ins()[0].vol === 0 && near(ins()[1].vol, 0.3));
  P.vehicle = null; roll(e); r.push(ins().length === 2 && ins().every((v) => v.stopped));
  return r;
}
rider(M.Minecart.rollSound).forEach((c, i) => ok(c, 'rider check ' + i));
const good = run(M.Minecart.rollSound);
for (const [k, m] of [['mute', 'stopped cart: riding voice at volume 0'], ['mid', 'speed .3 -> volume .21'], ['fast', 'speed clamps at .5 -> .35'],
  ['slow', 'speed < .01 -> silent'], ['silent', 'silent cart mute'], ['gone', 'removed cart stops voice']]) ok(good[k], m);

const breaks = [
  ['no voice', () => {}],
  ['wrong event', (e) => { if (!e.v) e.v = M.Sound.loopVoice('entity.minecart.inside'); }],
  ['full volume', (e) => { const v = e.cv || (e.cv = M.Sound.loopVoice('entity.minecart.riding')); v.set(1); }],
];
let caught = 0;
for (const [n, f] of breaks) { const r = run(f); if (Object.values(r).some((x) => !x) || rider(f).some((x) => !x)) { caught++; console.log('  ✓ break caught: ' + n); } else fails.push('break not caught: ' + n); }
for (const f of fails) console.log('  ✗ ' + f);
console.log(`minecartsoundcheck: ${pass} ok, ${fails.length} failed`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${fails.length}`);
console.log(`${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
