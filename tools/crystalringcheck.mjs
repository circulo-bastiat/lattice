#!/usr/bin/env node
// crystalringcheck.mjs -- G27e (#10979): EnderDragonFight.countAliveCrystals() counts LIVE end_crystal
// entities in the spike columns, not the synthetic ED.buildCrystalRing `alive` rows. Proven by removing
// an entity WITHOUT crystalDestroyed (row.alive stays true, count must still drop), adding an extra
// entity inside a column (count rises), and a far entity (ignored). Then crystalDestroyed's row update.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('crystalringcheck -- getAliveEndCrystals counts real end_crystal entities (EnderDragonFight.countAliveCrystals)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js'];

function freshEngine() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  const W = M.World, CH = M.CH;
  M.Behave.init(W);
  M.Entities.init();
  M.EntityList.init();
  M.Ai.init();
  M.Spawn.init();
  M.Combat.init();
  M.Explosion.init();
  M.EnderDragon.init();
  M.EndCrystal.init();
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  return M;
}


const mk = () => { const M = freshEngine(); const ED = M.EnderDragon; const fight = new ED.EnderDragonFight({ seed: 4242, heightAt: () => 65 }); ED.activeFight = fight; return { M, ED, EL: M.EntityList, fight }; };
const live = (EL) => EL.list.filter((e) => e.type === 'end_crystal' && !e.removed);
{
  const { EL, fight } = mk();
  ok(fight.getAliveEndCrystals() === 10, 'fresh fight counts 10 real entities');
  const e = live(EL)[2];
  EL.remove(e);
  ok(fight.crystals.every((r) => r.alive), 'sanity: no row flag was touched by a bare removal');
  ok(fight.getAliveEndCrystals() === 9, 'bare entity removal drops the count to 9 (reads entities, not rows)');
  const r0 = fight.crystals[0];
  EL.spawn('end_crystal', r0.x + 0.5, r0.height + 20, r0.z + 0.5, {});
  ok(fight.getAliveEndCrystals() === 10, 'a second crystal inside a spike column (any height) counts');
  EL.spawn('end_crystal', 5000, 70, 5000, {});
  ok(fight.getAliveEndCrystals() === 10, 'a far crystal is not counted');
  EL.remove(live(EL)[0]); EL.remove(live(EL)[0]);
  okAv(fight.getAliveEndCrystals() === 8 && fight.crystals.filter((r) => r.alive).length === 10, 'break: after two more bare removals entity count is 8 while all 10 row flags are still alive -- not answering from rows')
}
{
  const { M, EL, fight } = mk();
  const e = live(EL).find((c) => c.x === fight.crystals[5].x + 0.5 && c.z === fight.crystals[5].z + 0.5);
  M.EndCrystal.damage(e, { attacker: { type: 'player' } });
  ok(fight.crystals[5].alive === false && fight.getAliveEndCrystals() === 9, 'killing the spawned ring crystal flips its row and the count');
  okAv(fight.crystals.filter((r) => r.alive).length === 9, 'break: exactly one row flipped');
}
{
  const { ED, EL, fight } = mk();
  const real = ED.EnderDragonFight.prototype.getAliveEndCrystals;
  ED.EnderDragonFight.prototype.getAliveEndCrystals = function () { return this.crystals.filter((r) => r.alive).length; };
  EL.remove(live(EL)[0]);
  okAv(fight.getAliveEndCrystals() === 10, 'break: a row-based counter ignores a removed entity (the bug this check catches)');
  ED.EnderDragonFight.prototype.getAliveEndCrystals = real;
  okAv(fight.getAliveEndCrystals() === 9, 'break: restored counter sees 9');
}
console.log(`\n${pass} checks passed, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
