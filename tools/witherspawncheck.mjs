#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zzh_blaze.js', '07zzi_ghast.js',
  '07c_blockentity.js', '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, Wi = MCL.Wither, BE = MCL.BlockEntities, T = MCL.Tags, Diff = MCL.Diff;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();
BE.init();

ok(Wi.ready === true, 'Wi.ready is true once loaded');
function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
  BE.clear();
  Diff.set('normal');
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }

// #10986: live end-to-end: skull placed -> wither spawned invulnerable 220 -> ticks -> explosion -> vulnerable.
function live(opts) {
  freshWorld();
  MCL.Sound = { blockBreak: () => {}, play: () => {} };
  MCL.Adv = { trigger: () => {} };
  MCL.Player = { x: 8, y: 70, z: 5, type: 'player' };
  const x = 5, y = 70, z = 5;
  for (let i = 0; i < 3; i++) put(x + i, y - 1, z, 'soul_sand');
  put(x + 1, y - 2, z, 'soul_sand');
  put(x + 2, y, z, 'wither_skeleton_skull'); put(x, y, z, 'wither_skeleton_skull');
  put(x + 1, y, z, opts.centre || 'wither_skeleton_skull');
  put(x + 6, y - 1, z, 'dirt');
  const w = EL.list.find((e) => e.type === 'wither');
  return w;
}
const w = live({});
ok(!!w, 'wither spawned by the third skull');
if (w) {
  ok(Wi.getInvulnerableTimer(w) === 220, 'invul timer 220 on summon (got ' + Wi.getInvulnerableTimer(w) + ')');
  ok(near(w.health, (w.maxHealth || 300) / 3), 'summon health = max/3');
  ok(near(w.bossBar.percent, 0), 'boss bar starts at 0');
  const dirt = W.getBlock(11, 69, 5);
  ok(dirt !== 0, 'dirt present before explosion');
  for (let i = 0; i < 219; i++) { w.age = (w.age || 0) + 1; Wi.tickInvuln(w); }
  ok(Wi.getInvulnerableTimer(w) === 1, 'timer 1 after 219 ticks');
  ok(W.getBlock(11, 69, 5) === dirt, 'no explosion before expiry');
  w.age++; Wi.tickInvuln(w);
  ok(Wi.getInvulnerableTimer(w) === 0, 'timer 0 after 220 ticks');
  ok(near(w.bossBar.percent, 1), 'boss bar full at expiry');
  ok(W.getBlock(11, 69, 5) === 0, 'expiry explosion (power 7) broke the nearby dirt');
}
const w2 = live({ centre: 'torch' });
caught(!w2, 'without the third skull no wither spawns');
const w3 = live({});
if (w3) { Wi.setInvulTimer(w3, 1); }
caught(!!w3 && Wi.getInvulnerableTimer(w3) === 1, 'broken data (timer 1) differs from the 220 summon value');
const w4 = live({});
if (w4) { for (let i = 0; i < 100; i++) { w4.age++; Wi.tickInvuln(w4); } }
caught(!!w4 && W.getBlock(11, 69, 5) !== 0, 'only 100 ticks: dirt still intact (explosion needs all 220)');

console.log(`witherspawncheck: ${pass} ok, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
