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
// #4878: WitherSkullBlock.onPlaced -- 2001 break effect per cleared cell, updateNeighbors after the
// spawn, SUMMONED_ENTITY for a non-spectating player within the box + 50.

function run(playerX) {
  freshWorld();
  const ev = [], trig = [], ch = [];
  MCL.Sound = { blockBreak: (st, x, y, z) => ev.push([st, x, y, z]) };
  MCL.Adv = { trigger: (p, id, ctx) => trig.push(id) };
  MCL.Player = { x: playerX, y: 70, z: 5, type: 'player' };
  const x = 5, y = 70, z = 5;
  for (let i = 0; i < 3; i++) put(x + i, y - 1, z, 'soul_sand');
  put(x + 1, y - 2, z, 'soul_sand');
  put(x + 2, y + 0, z, 'wither_skeleton_skull'); put(x, y, z, 'wither_skeleton_skull');
  put(x + 3, y, z, 'torch');   // neighbour of the cleared row
  const origChanged = B.changed;
  B.changed = (cx, cy, cz, old) => { ch.push([cx, cy, cz]); return origChanged(cx, cy, cz, old); };
  put(x + 1, y, z, 'wither_skeleton_skull');
  B.changed = origChanged;
  return { ev, trig, ch, n: EL.list.length };
}
const r = run(8);
ok(r.n === 1, 'wither spawned');
ok(r.ev.length === 7 && r.ev.every((e) => e[0] !== 0), `7 non-air 2001 break events (got ${r.ev.length})`);
ok(r.trig.length === 1 && r.trig[0] === 'minecraft:summoned_entity', 'summoned_entity fired for the near player');
ok(r.ch.length >= 7, `neighbour update on the cleared cells (got ${r.ch.length})`);
caught(run(500).trig.length === 0, 'a player 495 blocks away gets no trigger');
caught(run(500).ev.length === 7, 'the break events do not depend on the player');

console.log(`withersummoncheck: ${pass} ok, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
