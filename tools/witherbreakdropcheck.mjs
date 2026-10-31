#!/usr/bin/env node
// witherbreakdropcheck.mjs — #1583: Wi.tickBlockBreaking pops each broken block's loot (breakBlock(pos, true, this)).
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
  '07zzm_wither.js'];
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

function run(noDrop) {
  freshWorld();
  const w = EL.spawn('wither', 0.5, 70, 0.5, {});
  put(0, 71, 0, 'diamond_ore'); put(1, 72, 0, 'stone'); put(0, 70, 1, 'bedrock');
  const before = EL.count();
  const realDrops = MCL.Loot.drops;
  if (noDrop) MCL.Loot.drops = () => [];
  w.blockBreakingCooldown = 2;
  Wi.tickBlockBreaking(w);
  ok(W.getBlock(0, 71, 0) !== 0, 'cooldown 2 -> 1: nothing broken yet');
  Wi.tickBlockBreaking(w);
  MCL.Loot.drops = realDrops;
  return { w, gained: EL.count() - before };
}
console.log('witherbreakdropcheck -- #1583: wither block-breaking drops loot');
ok(Wi.ready === true, 'Wi ready');
ok(MCL.Tags.ready, 'tags ready');
{
  const { gained } = run(false);
  ok(W.getBlock(0, 71, 0) === 0 && W.getBlock(1, 72, 0) === 0, 'volume cleared');
  ok(W.getBlock(0, 70, 1) !== 0, 'wither_immune bedrock stays');
  ok(gained >= 2, `broken blocks popped item entities (got ${gained})`);
}
okAv(run(true).gained === 0, 'with the loot table emptied no item appears (the assertion can fail)');
console.log(`witherbreakdropcheck: ${pass} assertions, ${fails.length} failed`);
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
