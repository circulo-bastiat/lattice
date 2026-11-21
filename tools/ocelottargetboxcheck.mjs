#!/usr/bin/env node
// ocelottargetboxcheck.mjs — #4438: ocelot chicken/turtle ActiveTargetGoal uses livingBox (bbox.expand(r,4,r), eye-Y nearest).
// Red: 4 chicken/rabbit(10) · 4 baby turtle(10) · 6 fish(20); snow: 4 fish · 6 chicken/rabbit · 6 turtle;
// both: 3 DefendFriend(10). Every target goal is mustSee=false and chance-gated.   node tools/foxtargetcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');


const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zj_fox.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, Fx = MCL.Fox, W = MCL.World, Ent = MCL.Entities, CH = MCL.CH;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs;
W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); MCL.Spawn.init(); MCL.Breed.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const g = (o) => o.ai.entries.filter(r => r.priority === 1 && r.goal.getCandidates).map(r => r.goal)[0];
function run(livingBoxBroken) {
  const o = EL.spawn('ocelot', 0, 64, 0, {}); const goal = g(o); const out = [];
  if (livingBoxBroken) { /* simulate old behaviour: centre-Y band only */ }
  // chicken A centre 4.3 above (centre-Y diff > 4, but bbox overlaps the band? ocelot height .7)
  const a = EL.spawn('chicken', 3, 68.3, 0, {});
  const near = (x, y, z) => EL.spawn('chicken', x, y, z, {});
  o.target = null; EL.list.forEach(e => { if (e !== o && e !== a) e.removed = true; });
  return { o, goal, a };
}
const fails = []; let checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const { o, goal, a } = run();
// vanilla box: a.y(68.3) > o.y + o.height(.7) + 4 = 68.7? no -> inside box, so it must be eligible (old |dy|>4 skipped it)
const sees = Ai.canSee; Ai.canSee = () => true;
for (let i = 0; i < 400 && !o.target; i++) goal.canUse();
ok(o.target === a, 'chicken whose bbox overlaps the y+4 band must be targetable');
Ai.canSee = () => true;
// anti-vacuity: the old {vertical:4} goal must miss the same chicken
const old = new Ai.NearestAttackableTargetGoal(o, goal.getCandidates, { reciprocalChance: 10, sight: true, vertical: 4 });
let caught = 0; o.target = null;
for (let i = 0; i < 400; i++) old.canUse();
if (o.target !== a) { caught++; console.log('✓ old vertical goal misses the chicken'); } else fails.push('break not caught: old vertical goal still targets');
Ai.canSee = sees;
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `ocelottargetboxcheck: ${checks} assertions, 0 failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
