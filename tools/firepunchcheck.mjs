#!/usr/bin/env node
// firepunchcheck.mjs — #1893 FIRE-1: punching out fire. Drives the REAL P.breakBlock against
// World.breakBlock (World.java:258: no event 2001 for an AbstractFireBlock) and AbstractFireBlock.onBreak
// (AbstractFireBlock.java:160-163: event 1009 = block.fire.extinguish, vol 0.5, pitch 2.6 +/- 0.8).
// Anti-vacuity: breaks its own call site (fire treated as a plain block) and a control block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '14_player.js'];
let asserted = 0;
function run(patch) {
  const f = [];
  const no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  MCL.EntityList.init(); MCL.Ai.init(); if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
  const c = MCL.World.makeChunk(0, 0); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(0, 0), c);
  const W = MCL.World, S = MCL.States, P = MCL.Player;
  const ev = [], parts = [], broke = [];
  MCL.Sound = { entitySound: (e, x, y, z, v, p) => ev.push({ e, v, p }), blockBreak: () => broke.push(1) };
  MCL.Particle.addBlockBreakParticles = () => parts.push(1);
  P.inventory = MCL.Inventory.create(); P.slot = 0; P.instabuild = false; P.mayBuild = true; P.x = 0.5; P.y = 64; P.z = 0.5;
  const brk = (name) => {
    ev.length = parts.length = broke.length = 0;
    W.setBlock(3, 63, 3, S.stateOf(name === 'soul_fire' ? 'soul_soil' : 'netherrack')); W.setBlock(3, 64, 3, S.stateOf(name));
    P.hasTarget = true; P.tx = 3; P.ty = 64; P.tz = 3;
    return P.breakBlock();
  };
  for (const n of ['fire', 'soul_fire']) {
    no(brk(n) === true && W.getBlock(3, 64, 3) === 0, n + ' not removed by a left click');
    no(parts.length === 0, n + ' spawned break particles (event 2001 must be skipped)');
    no(broke.length === 0, n + ' played the block break sound');
    no(ev.length === 1 && ev[0].e === 'block.fire.extinguish', n + ' did not play block.fire.extinguish');
    no(ev[0] && ev[0].v === 0.5 && ev[0].p >= 1.8 && ev[0].p <= 3.4, n + ' hiss volume/pitch off (0.5, 2.6+-0.8)');
  }
  brk('stone');
  no(parts.length === 1 && broke.length === 1 && ev.length === 0, 'control: stone must use the normal 2001 particles + break sound, no hiss');
  return f;
}
const clean = run(null);
for (const m of clean) console.log('FAIL ' + m);
let caught = 0, total = 0;
const hit = (label, patch) => { total++; const f = run(patch); if (f.length) caught++; else console.log('NOT CAUGHT: ' + label); };
const PL = '14_player.js';
hit('fire treated as plain block', (file, src) => file === PL ? src.replace("fireName === 'fire' ||", "false ||") : src);
hit('hiss removed', (file, src) => file === PL ? src.replace("'block.fire.extinguish'", "'block.fire.ambient'") : src);
console.log(`${asserted} assertions, ${clean.length} failures, ${caught} breaks caught`);
console.log(`${caught} breaks caught (of ${total})`);
process.exit(clean.length || caught !== total ? 1 : 0);
