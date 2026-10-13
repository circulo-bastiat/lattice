#!/usr/bin/env node
// arrowbubblecheck — PersistentProjectileEntity.tick:239-243: 4 BUBBLE particles per wet tick at pos - v*0.25, velocity v.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, W = M.World, CH = M.CH;
const WATER = M.States.stateOf('water') | 0, STONE = M.States.stateOf('stone') | 0;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
M.Behave.init({ get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, s) => W.setBlock(x, y, z, s), getLight: () => 240, getBlock: (x, y, z) => W.getBlock(x, y, z), setBlock: (x, y, z, s) => W.setBlock(x, y, z, s) });
EL.clear();
for (let x = -4; x <= 12; x++) for (let z = -4; z <= 4; z++) { W.setBlock(x, 3, z, STONE); for (let y = 4; y <= 6; y++) W.setBlock(x, y, z, WATER); }
function run(fn) {
  const log = [];
  M.Particle = M.Particle || {};
  M.Particle.spawn = function (t, x, y, z, vx, vy, vz) { if (t === 'bubble') log.push([x, y, z, vx, vy, vz]); };
  fn(); return log;
}
const nearA = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
function arrowCase(label, y) {
  const a = EL.spawn('arrow', 0.5, y, 0.5, { vx: 0.5, vy: 0, vz: 0, shooter: null });
  return [a, run(() => Cb.tickArrow(a))];
}
const [a, wl] = arrowCase('wet', 5.0);
ok(wl.length === 4, 'arrow wet tick: 4 bubbles, got ' + wl.length);
ok(wl.length && wl.every(b => nearA(b, [0.5 + 0.5 - 0.125, 5.0, 0.5, 0.5, 0, 0])), 'arrow bubble position/velocity');
const [, dl] = arrowCase('dry', 9.5);
ok(dl.length === 0, 'arrow dry tick: none');
// trident
function tri(y) {
  const t = EL.spawn('trident', 0.5, y, 0.5, { vx: 0.5, vy: 0, vz: 0, shooter: null });
  return [t, run(() => Cb.tickTrident(t))];   // bubbles use the PRE-drag v (0.5,0,0): drag/gravity reach next tick (#6601)
}
const [t, tl] = tri(5.0);
ok(tl.length === 4, 'trident wet tick: 4 bubbles, got ' + tl.length);
ok(tl.length && tl.every(b => nearA(b, [t.x - 0.5 * 0.25, t.y, t.z, 0.5, 0, 0])), 'trident bubble position/velocity');
ok(tri(9.5)[1].length === 0, 'trident dry tick: none');
// anti-vacuity: remove the water branch
const orig = Cb.projectileBubbles; Cb.projectileBubbles = () => 0;
if (arrowCase('x', 5.0)[1].length !== 4) { breaks++; console.log('   ✓ break caught: arrow'); } else fails.push('anti-vacuity: arrow');
if (tri(5.0)[1].length !== 4) { breaks++; console.log('   ✓ break caught: trident'); } else fails.push('anti-vacuity: trident');
Cb.projectileBubbles = orig;
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('arrowbubblecheck\n failures ........... 0\n assertions passed .. ' + pass + '\n breaks caught ...... ' + breaks + '\n' + breaks + ' breaks caught');
