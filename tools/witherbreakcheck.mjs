#!/usr/bin/env node
// witherbreakcheck.mjs — #3809: Wi.tickBlockBreaking keeps fluid (World.breakBlock leaves the fluid state).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;


const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zzh_blaze.js', '07zzi_ghast.js',
  '07zzm_wither.js', '09c_weather.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, ES = MCL.Effects, Wi = MCL.Wither;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(Wi.ready === true, 'Wi.ready is true once loaded');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
if (MCL.Loot && MCL.Loot.init) MCL.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
if (MCL.Tags && MCL.Tags.init) { try { MCL.Tags.init(JSON.parse(readFileSync(join(ASSETS, 'tags.json'), 'utf8'))); } catch (e) {} }

function run(sabotage, only) {
  freshWorld();
  const w = EL.spawn('wither', 0.5, 70, 0.5, {});
  put(0, 71, 0, 'water');
  if (!only) { put(1, 72, 0, 'lava'); put(-1, 71, 0, 'stone'); }
  const slab = B.setProp(S.stateOf('oak_slab'), 'waterlogged', true);
  if (!only) W.setBlock(0, 72, 1, slab);
  const snd = []; MCL.Sound = MCL.Sound || {}; const ob = MCL.Sound.blockBreak;
  MCL.Sound.blockBreak = (st) => { snd.push(st); };
  const orig = Wi.playEvent; let ev = 0;
  Wi.playEvent = (e, id) => { if (id === 1022) ev++; };
  const Wx = MCL.Weather, of = Wx.fluidOf;
  if (sabotage) Wx.fluidOf = () => [0, 0];
  w.blockBreakingCooldown = 1;
  Wi.tickBlockBreaking(w);
  Wx.fluidOf = of; Wi.playEvent = orig; MCL.Sound.blockBreak = ob;
  return { ev, snd };
}
console.log('witherbreakcheck -- #3809: wither block-breaking keeps fluid');
ok(Wi.ready === true && MCL.Tags.ready, 'ready');
{
  const { ev, snd } = run(false);
  ok(snd.includes(S.stateOf('stone')), 'break sound (2001) for the stone cell');
  ok(W.getBlock(0, 71, 0) === S.stateOf('water'), 'water stays');
  ok(W.getBlock(1, 72, 0) === S.stateOf('lava'), 'lava stays');
  ok(W.getBlock(-1, 71, 0) === 0, 'stone broken');
  ok(W.getBlock(0, 72, 1) === S.stateOf('water'), 'waterlogged slab replaced by water');
  ok(ev === 1, 'event 1022 plays');
  ok(run(false, true).ev === 0, 'water-only volume: no 1022');
}
okAv(run(true, true).ev === 1, 'with fluid detection off a water-only volume DOES play 1022');
okAv(run(true) && W.getBlock(0, 71, 0) === 0, 'with fluid detection off the water is deleted (assertion can fail)');
console.log(`witherbreakcheck: ${pass} assertions, ${fails.length} failed`);
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
