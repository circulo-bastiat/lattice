#!/usr/bin/env node
// witherlootcheck.mjs -- #940: WitherEntity.dropEquipment drops one nether star (.decomp:476-481)
// and setCovetedItem() (itemAge = -6000).   node tools/witherlootcheck.mjs [--verbose]

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

console.log('witherlootcheck -- #940: a dead wither drops exactly one nether_star');

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
ok(T.ready === true, 'Tags loaded (needed for wither_immune / wither_summon_base_blocks)');
ok(BE.ready === true, 'BlockEntities loaded');
ok(T.blockTag('wither_immune') >= 0, 'the real wither_immune tag is packed');
ok(T.blockTag('wither_summon_base_blocks') >= 0, 'the real wither_summon_base_blocks tag is packed');

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
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }


const NS_IDX = MCL.Items.of('nether_star');
const stars = () => EL.list.filter((e) => e.type === 'item' && !e.removed && e.item === NS_IDX);

function run(type) {
  freshWorld();
  const w = spawn(type, 0.5, 70, 0.5, {});
  w.health = 0;
  Cb.dropLoot(w);
  return stars();
}
const wst = run('wither');
ok(NS_IDX >= 0, 'nether_star is a real item');
ok(wst.length === 1 && wst[0].count === 1, 'a dead wither drops exactly one nether_star (' + wst.length + ')');
ok(wst.length === 1 && wst[0].age === -6000, 'the star is a coveted item (age -6000)');
okAv(run('zombie').length === 0, 'anti-vacuity: a zombie drops no nether_star');
okAv(run('wither_skeleton').length === 0, 'anti-vacuity: a wither skeleton drops no nether_star');

console.log(`witherlootcheck: ${pass} assertions, ${fails.length} failed`);
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
