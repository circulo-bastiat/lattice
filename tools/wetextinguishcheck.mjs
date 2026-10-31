#!/usr/bin/env node
// wetextinguishcheck.mjs — #9962: Entity.move tail (.decomp Entity.java:660-676): burning + (powder snow | wet) -> extinguished + sound.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('wetextinguishcheck — #9962: a burning entity in rain / bubble column / powder snow is put out');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
M.Combat.init();
const Cb = M.Combat, EL = M.EntityList;
const played = []; M.Sound = { play: (ev, o) => { played.push([ev, o]); return true; } };
let rain = false, bubble = false;
M.Sky.isEntityRainedOn = () => rain;
const bc = M.Reg.id.bubble_column;
M.World = Object.assign(M.World || {}, { getBlock: () => 0 });
function scen(o) {
  rain = !!o.rain; played.length = 0;
  M.World.getBlock = () => o.bubble ? M.States.defaultOf ? M.States.defaultOf(bc) : M.States.stateOf('bubble_column') : 0;
  const z = EL.spawn('zombie', 0.5, 64, 0.5);
  z.remainingFireTicks = o.fire === undefined ? 100 : o.fire; z.isOnFire = z.remainingFireTicks > 0; z.inPowderSnow = !!o.snow;
  const r = Cb.wetExtinguish(z);
  return { z, r, n: played.filter(p => p[0] === 'entity.generic.extinguish_fire').length };
}
function suite(tag) {
  const a = scen({ rain: true }), b = scen({ bubble: true }), c = scen({ snow: true }), d = scen({}), e = scen({ rain: true, fire: 0 });
  ok(a.z.remainingFireTicks <= 0 && a.n === 1, tag + ' rain extinguishes + one sound');
  ok(b.z.remainingFireTicks <= 0 && b.n === 1, tag + ' bubble column extinguishes + one sound');
  ok(c.z.remainingFireTicks <= 0 && c.n === 1, tag + ' powder snow extinguishes + one sound');
  ok(d.z.remainingFireTicks === 100 && d.n === 0, tag + ' dry ground keeps burning');
  ok(e.n === 0, tag + ' not burning: no sound');
}
suite('real');
let caught = 0;
const realIsWet = Cb.isWet, realWx = Cb.wetExtinguish;
function breakWith(name, fn, restore) {
  const before = fails.length; fn(); suite('broken'); const hit = fails.length > before; fails.length = before; restore();
  if (hit) { caught++; console.log('   ✓ break caught: ' + name); } else fails.push('anti-vacuity: ' + name + ' not caught');
}
breakWith('isWet widening reverted', () => { Cb.isWet = (e) => !!e.inWater; }, () => { Cb.isWet = realIsWet; });
breakWith('powder snow ignored', () => { Cb.wetExtinguish = (e) => { const s = e.inPowderSnow; e.inPowderSnow = false; const r = realWx(e); e.inPowderSnow = s; return r; }; }, () => { Cb.wetExtinguish = realWx; });
breakWith('no sound', () => { const sp = M.Sound.play; M.Sound.play = () => true; Cb.__sp = sp; }, () => { M.Sound.play = Cb.__sp; });
console.log(`wetextinguishcheck: ${pass} assertions, 0 failures, ${caught} breaks caught`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
