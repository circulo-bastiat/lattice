#!/usr/bin/env node
// explosionbehaviorcheck.mjs -- #11693: proves 07za_explosion.js's ExplosionBehavior
// (resistanceAt: air=null, block resistance, unbreakable=HUGE), EntityExplosionBehavior
// (resistHook/destroyHook inside collectBlocks) and LootContextParameters.EXPLOSION_RADIUS
// (affectWorld's decay -> Loot.drops explosionRadius) through the real Ex.explode entry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js'];

function fresh() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Behave.init(M.World); M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Spawn.init();
  M.Combat.init(); M.Explosion.init();
  M.Items.init({ items: Buffer.from(readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin'))).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Loot.init({ loot: Buffer.from(readFileSync(join(MCLITE_ROOT, 'assets', 'loot.bin'))).toString('base64'), lootBytes: rdj('loot.meta.json').jsonBytes }); M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c);
  }
  return M;
}
function fill(M, id) {
  for (let x = -6; x <= 6; x++) for (let y = 60; y <= 80; y++) for (let z = -6; z <= 6; z++)
    M.World.setBlock(x, y, z, y < 70 ? id : 0);
}
const rng = () => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('x ' + m); fail++; } };

function run(brk) {
  const M = fresh(), Ex = M.Explosion, R = M.Reg;
  const S = M.States, stone = S.stateOf('stone'), bed = S.stateOf('bedrock');
  fill(M, stone);
  // ExplosionBehavior.getBlastResistance
  ok((Ex.resistanceAt(0, 75, 0) === null) !== (brk === 'air'), 'air resistance must be null');
  ok(Ex.resistanceAt(0, 65, 0) === R.resist[R.id.stone], 'stone resistance mismatch');
  M.World.setBlock(1, 65, 0, bed);
  ok(Ex.resistanceAt(1, 65, 0) === (isFinite(R.resist[R.id.bedrock]) ? R.resist[R.id.bedrock] : Ex.HUGE_RESIST) && Ex.resistanceAt(1, 65, 0) > 1000, 'bedrock must be huge: ' + Ex.resistanceAt(1, 65, 0) + ' ' + R.resist[R.id.bedrock] + ' ' + M.World.getBlock(1,65,0));
  // EntityExplosionBehavior hooks
  const base = Object.keys(Ex.collectBlocks(0.5, 69.5, 0.5, 4, rng())).length;
  ok(base > 0, 'baseline blast breaks nothing');
  const hook = brk === 'hook' ? null : () => 1e6;
  const shielded = Object.keys(Ex.collectBlocks(0.5, 69.5, 0.5, 4, rng(), hook)).length;
  ok(shielded < base, 'resistHook did not shield blocks (' + shielded + ' vs ' + base + ')');
  const dh = brk === 'destroy' ? null : () => false;
  ok(Object.keys(Ex.collectBlocks(0.5, 69.5, 0.5, 4, rng(), null, dh)).length === 0, 'destroyHook=false must destroy nothing');
  // LootContextParameters.EXPLOSION_RADIUS: huge radius -> survives_explosion almost never; no radius -> always
  function drops(decay) {
    fill(M, stone);
    for (const e of (M.EntityList.list || [])) e.removed = true;
    const aff = {}; for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) aff[x + ',65,' + z] = [x, 65, z];
    Ex.affectWorld(null, aff, true, 1e9, rng(), decay);
    return (M.EntityList.list || []).filter((e) => !e.removed && e.type === 'item').length;
  }
  const keep = drops(brk === 'radius' ? true : false), decayed = drops(true);
  ok(keep >= 45, 'decay=false must keep every drop, got ' + keep);
  ok(decayed < 5, 'decay=true with radius 1e9 must lose nearly all drops, got ' + decayed);
  return fail;
}
if (run(null)) { console.log('FAIL'); process.exit(1); }
let caught = 0;
for (const b of ['air', 'hook', 'destroy', 'radius']) { fail = 0; const l = console.log; console.log = () => {}; const f = run(b); console.log = l; if (f) caught++; else console.log('x break not caught: ' + b); }
console.log(caught + ' breaks caught');
process.exit(caught === 4 ? 0 : 1);
