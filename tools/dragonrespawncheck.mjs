#!/usr/bin/env node
// dragonrespawncheck.mjs -- #10978: first-ever natural spawn in a fresh End (EnderDragonFight.tick -> convertFromLegacy ->
// generateEndPortal(false) -> checkDragonSeen -> createDragon at 0,128,0) and the closed-vs-open exit portal fountain.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('dragonrespawncheck -- #10978 natural first spawn + exit portal');
function build() {
  const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js',
    '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js', '07q_effects.js',
    '14j_combat.js', '07k_goals.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07za_explosion.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Combat.init(); M.EnderDragon.init(); M.Explosion.init();
  M.World.init(1); M.EntityList.list.length = 0;
  return M;
}
function run(mut) {
  const M = build(), ED = M.EnderDragon;
  M.blocks = new Map(); M.World.setBlock = (x, y, z, id) => M.blocks.set(x + ',' + y + ',' + z, id);
  const fight = new ED.EnderDragonFight({ seed: 7, heightAt: () => 64 });
  const ring = M.EntityList.list.filter(e => e.type === 'end_crystal').length;
  const ctx = { playersInEnd: true, hasPortal: false, aliveDragons: () => [] };
  if (mut) mut(ctx, fight);
  const none = fight.firstTick(Object.assign({}, ctx, { playersInEnd: false }));
  const d = fight.firstTick(ctx);
  return { M, fight, d, none, ring };
}
{
  const { M, fight, d, none, ring } = run();
  const o = fight.exitPortalLocation;
  ok(ring === 10, '10 pillar crystals spawned with the fight (' + ring + ')');
  ok(none === null, 'no player in the End: nothing happens');
  ok(d && fight.dragonKilled === false && fight.previouslyKilled === false, 'fresh End: dragon alive, not previously killed');
  ok(d && d.x === 0 && d.y === 128 && d.z === 0, 'dragon created at 0,128,0');
  ok(fight.dragon === d, 'fight remembers the dragon');
  ok(fight.firstTick({ playersInEnd: true, aliveDragons: () => [] }) === null, 'legacy check runs once');
  const nm = (x, y, z) => { const s = M.blocks.get(x + ',' + y + ',' + z) || 0; return M.Reg.names[M.States.block[s]]; };
  ok(nm(o.x, o.y, o.z) === 'bedrock', 'closed exit portal: bedrock centre at y (not end_portal)');
  ok(nm(o.x + 1, o.y, o.z) === 'bedrock', 'closed portal bowl is bedrock, no end_portal');
  ok(nm(o.x, o.y + 3, o.z) === 'bedrock', 'pillar 4 high');
  ok(nm(o.x, o.y + 4, o.z) !== 'dragon_egg', 'no egg on a not-yet-killed fight');
}
// breaks: each wrong input must change the outcome
{
  let r = run((c) => { c.hasPortal = true; });
  okAv(r.fight.previouslyKilled === true && r.d === null, 'existing portal + no dragon: previouslyKilled, no natural spawn');
  r = run((c) => { c.hasPortal = true; c.aliveDragons = () => [{ x: 1, y: 2, z: 3 }]; });
  okAv(r.d && r.d.x === 1 && r.fight.dragonKilled === false, 'existing live dragon (portal present) is adopted, not duplicated');
  r = run((c) => { c.playersInEnd = false; });
  okAv(r.d === null, 'no players -> no spawn');
  r = run();
  okAv(r.fight.dragonKilled === false, 'flip dragonKilled->false needs previouslyKilled=false');
}
// first player entry into the End attaches the fight (World.setDimension) and spawns the dragon
{
  const attach = (dim) => { const M = build(); M.EnderDragon.activeFight = null; M.World.setDimension(dim);
    const f = M.EnderDragon.activeFight; return { M, f, dr: M.EntityList.list.filter(e => e.type === 'ender_dragon' || e.dragon).length }; };
  const e = attach('the_end');
  okAv(!!e.f && e.f.dragon && e.f.dragon.y === 128, 'entering the End attaches a fight with the dragon at y 128');
  okAv(attach('the_nether').f == null, 'entering the Nether attaches no fight');
}
for (const f of fails) console.log('  FAIL ' + f);
console.log('assertions passed ......... ' + pass + '\nfailures ......... ' + fails.length);
console.log(breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
