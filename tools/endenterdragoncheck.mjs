#!/usr/bin/env node
// endenterdragoncheck.mjs -- G27m (#11317): entering the End must leave exactly ONE live ender_dragon in the entity list (the fight's own dragon),
// and EnderDragonFight.tick must run once per game tick while the End is current (World.tickEndFight, called from 17_main.js after EntityList.tick).
// Real path: World.init -> World.setDimension('the_end') -> 5 world ticks. ANTI-VACUITY: breaks its own copy of the source and prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const T = dirname(fileURLToPath(import.meta.url)), ASSETS = join(T, '..', 'assets'), SRC = join(T, '..', 'src');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('endenterdragoncheck -- G27m #11317 the End has a live dragon and its fight ticks');
function run(worldSrc) {
  const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js',
    '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js', '07q_effects.js',
    '14j_combat.js', '07k_goals.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07za_explosion.js'], patch: (f, t) => (f === '07_world.js' ? worldSrc : t) });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Combat.init(); M.EnderDragon.init(); M.Explosion.init();
  M.World.init(1); M.EntityList.list.length = 0;
  M.World.setDimension('the_end');
  const ED = M.EnderDragon, fight = ED.activeFight;
  const dragons = () => M.EntityList.list.filter((e) => e.type === 'ender_dragon' && !e.removed);
  const out = { M, fight, n0: dragons().length, dragon: dragons()[0] };
  let ticks = 0, t0 = fight ? fight.spawnStateTimer || 0 : 0;
  for (let i = 0; i < 5; i++) { if (M.World.tickEndFight && M.World.tickEndFight()) ticks++; }
  out.ticks = ticks; out.n1 = dragons().length; out.linked = !!(out.dragon && fight && out.dragon.dragon && fight.dragon === out.dragon.dragon);
  return out;
}
try {
  const src = readFileSync(join(SRC, '07_world.js'), 'utf8');
  const r = run(src);
  ok(!!r.fight, 'setDimension(the_end) attaches the fight');
  ok(r.n0 === 1, 'exactly one live ender_dragon in EL.list right after entering the End (got ' + r.n0 + ')');
  ok(r.n1 === 1, 'still exactly one after 5 world ticks (got ' + r.n1 + ')');
  ok(r.dragon && Math.abs(r.dragon.y - 128) < 12 && Math.abs(r.dragon.x) < 60 && Math.abs(r.dragon.z) < 60, 'the dragon is near (0,128,0)');
  ok(r.linked, 'the live entity is the fight\'s own dragon (fight.dragon === entity.dragon)');
  ok(r.ticks === 5, 'World.tickEndFight ran the fight tick on each of the 5 ticks (got ' + r.ticks + ')');
  const main = readFileSync(join(SRC, '17_main.js'), 'utf8');
  ok(/EntityList\.tick\(\);\s*\n\s*if \(NS\.World && NS\.World\.tickEndFight\) NS\.World\.tickEndFight\(\);/.test(main), '17_main.js calls World.tickEndFight right after EntityList.tick');
  // anti-vacuity: each break must be caught by the same assertions
  const brk = [
    ['no spawnDragon -> no dragon in the list', src.replace("spawnDragon: function (x, y, z, yaw)", "spawnDragonX: function (x, y, z, yaw)"), (x) => x.n0 === 0 || x.n0 > 1 || !x.linked],
    ['no tick call -> fight never advances', src.replace("ED.activeFight.tick(); return true;", "return false;"), (x) => x.ticks !== 5],
    ['tick outside the End', src.replace("NS.Dim.cur === 'the_end' && ED", "NS.Dim.cur === 'overworld' && ED"), (x) => x.ticks !== 5],
  ];
  for (const [n, s, bad] of brk) { let x; try { x = run(s); } catch { x = { n0: -1, ticks: -1, linked: false }; } if (bad(x)) { breaks++; console.log('   ✓ ' + n); } else fails.push('NOT CAUGHT: ' + n); }
  const m2 = main.replace('NS.World.tickEndFight();', 'void 0;');
  if (!/EntityList\.tick\(\);\s*\n\s*if \(NS\.World && NS\.World\.tickEndFight\) NS\.World\.tickEndFight\(\);/.test(m2)) { breaks++; console.log('   ✓ 17_main.js without the tickEndFight call'); } else fails.push('NOT CAUGHT: main without the tick call');
} catch (e) { fails.push('check crashed: ' + e.message + ' @ ' + String(e.stack).split('\n').slice(1,4).join(' | ')); }
for (const f of fails) console.log('FAIL  ' + f);
console.log(`endenterdragoncheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught (of 4)`);
process.exit(fails.length ? 1 : 0);
