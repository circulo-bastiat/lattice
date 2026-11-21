#!/usr/bin/env node
// stridergoalcheck.mjs — #938: StriderEntity.initGoals roster + GoBackToLavaGoal behaviour.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, t, what) => ok(Math.abs(a - b) <= t, `${what}: ${a} vs ${b} (+-${t})`);


const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
               '07r_mount.js', '07w_passive.js', '07s_raid.js', '07y_equip.js',
               '07zk_undead.js', '07zzj_strider.js', '07zw_mobnbt.js',
               '14l_use.js', '14_player.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.World.init(1);
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();
M.Mount.init();
M.Passive.init();
M.Equip.init();
if (M.Undead && M.Undead.init) M.Undead.init();
M.Raid.init ? M.Raid.init() : null;
M.Strider.init();
// This check exercises Strider.*/Use.strider* directly, not the (separately real) rostered
// goal selector (Ai.ROSTER.strider, 07k_goals.js) -- EL.tickMob still needs SOME e.ai.tick()
// to not crash (§6's own dispatch-routing assertion calls it), so this stubs an inert one
// rather than let the real goal selector's own player/animal reads run interleaved with this
// file's own direct P.inventory/e.rider pokes within the same tick.
M.MobNbt.init ? M.MobNbt.init() : null;
M.Use.init(M.World);

const EL = M.EntityList, W = M.World, R = M.Reg, Ai = M.Ai;
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
for (let cx = -1; cx <= 6; cx++) for (let cz = -1; cz <= 6; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
for (let x = -8; x <= 100; x++) for (let z = -8; z <= 100; z++) W.setBlock(x, 4, z, def('netherrack'));


// 1. the roster, as (priority, class) rows read off the built selector
function roster(e, mutate) {
  const seen = [];
  const names = Object.keys(Ai).filter((k) => /Goal$/.test(k) && typeof Ai[k] === 'function');
  const orig = {};
  for (const n of names) { orig[n] = Ai[n]; }
  const addOrig = Ai.GoalSelector.prototype.add;
  Ai.GoalSelector.prototype.add = function (pri, flags, goal) {
    let fam = '?';
    for (const n of names) if (goal instanceof orig[n] && (fam === '?' || orig[n].prototype !== Object.prototype)) { fam = n; }
    seen.push(pri + ':' + fam);
    return addOrig.call(this, pri, flags, goal);
  };
  try { Ai.ROSTER.strider(e, EL.aiCtx(e)); } finally { Ai.GoalSelector.prototype.add = addOrig; }
  return seen;
}
const WANT = ['1:PanicGoal', '2:BreedGoal', '3:TemptGoal', '4:GoBackToLavaGoal', '5:FollowParentGoal',
              '7:WanderAroundGoal', '8:LookAtPlayerGoal', '8:RandomLookAroundGoal', '9:LookAtMobGoal'];
function checkRoster(rows) {
  const miss = [];
  for (const w of WANT) if (!rows.includes(w)) miss.push(w);
  if (rows.some((r) => r === '7:WaterAvoidingRandomStrollGoal')) miss.push('water-avoiding stroll stand-in still present');
  return miss;
}
{
  const s = EL.spawn('strider', 10, 5, 10, { noRider: true });
  const rows = roster(s);
  const miss = checkRoster(rows);
  ok(miss.length === 0, 'strider roster: ' + miss.join('; ') + ' -- got ' + rows.join(' '));
  // anti-vacuity: a corrupted roster is caught
  let caught = 0;
  for (let i = 0; i < WANT.length; i++) {
    const bad = rows.filter((r) => r !== WANT[i]);
    if (checkRoster(bad).length) caught++;
  }
  const swapped = rows.map((r) => r === '4:GoBackToLavaGoal' ? '3:GoBackToLavaGoal' : r);
  if (checkRoster(swapped).length) caught++;
  ok(caught === WANT.length + 1, 'roster mutations caught: ' + caught);
  breaks += caught;
}

// 2. behaviour: a strider on netherrack 6 blocks from a lava pool walks to it
function scenario(withLava) {
  for (let x = 0; x <= 30; x++) for (let z = 0; z <= 30; z++) for (let y = 4; y <= 6; y++) W.setBlock(x, y, z, y === 4 ? def('netherrack') : 0);
  if (withLava) for (let x = 16; x <= 18; x++) for (let z = 9; z <= 11; z++) W.setBlock(x, 4, z, def('lava'));
  const s = EL.spawn('strider', 10.5, 5, 10.5, { noRider: true });
  const goal = new Ai.GoBackToLavaGoal(s, 1.5, () => 0.5);
  let started = goal.canUse();
  let best = Infinity;
  if (started) {
    goal.start();
    for (let t = 0; t < 400; t++) {
      goal.tick();
      Ph_step(s);
      best = Math.min(best, Math.hypot(s.x - 16.5, s.z - 10.5));
    }
  }
  return { started, best, s };
}
function Ph_step(s) { const n = s.navNode; if (!n) return; const dx = n.x + 0.5 - s.x, dz = n.z + 0.5 - s.z, d = Math.hypot(dx, dz) || 1, st = Math.min(0.15, d); s.x += dx / d * st; s.z += dz / d * st; s.navNode = null; }
{
  const a = scenario(true); if (process.env.DBG) { const p = Ai.findPath(10.5, 5, 10.5, 16.5, 5, 10.5, { maxDrop: 1, mob: a.s }); console.log(p && p.length, JSON.stringify(p && p.slice(-2)), R.names[M.States.block[M.Physics.blockAt(16,4,10)]]); const q = Ai.findPath(10.5, 5, 10.5, 14.5, 5, 10.5, { maxDrop: 1 }); console.log(q && q.length); }
  ok(a.started, 'GoBackToLava starts with lava 6 blocks away');
  ok(a.best < 3, 'GoBackToLava walks toward the lava (closest ' + a.best.toFixed(2) + ')');
  const b = scenario(false);
  ok(!b.started, 'GoBackToLava does NOT start with no lava in range');
  // anti-vacuity: the lava-less world must break the positive assertions
  breaks += (!b.started ? 1 : 0) + (b.best > 3 ? 1 : 0);
  // in lava: never starts
  const c = scenario(true);
  const g2 = new Ai.GoBackToLavaGoal(c.s, 1.5, () => 0.5); c.s.inLava = true;
  ok(!g2.canUse(), 'GoBackToLava never starts while the strider is in lava');
  breaks += g2.canUse() ? 0 : 1;
  c.s.inLava = false;
}

{ // #3683: tick tests the lava cell's own centre (ty+.5); the 20-tick re-path goes to y = ty (start() uses ty+1)
  const c = scenario(true), s = c.s, g = new Ai.GoBackToLavaGoal(s, 1.5, () => 0.5), ys = [], fp = Ai.findPath;
  Ai.findPath = function (a, b, c2, x, y, z, o) { ys.push(y); return fp.apply(this, arguments); };
  try {
    s.x = 10.5; s.y = 5; s.z = 10.5; g.canUse(); g.start();
    for (let t = 0; t < 20; t++) { s.x = 10.5; s.y = 5; s.z = 10.5; g.tick(); }
    ok(ys.length === 2 && ys[0] === 5 && ys[1] === 4, 'GoBackToLava start paths to ty+1, 20-tick re-path to ty (got ' + ys + ')');
    ys.length = 0; g.start(); ys.length = 0;
    for (let t = 0; t < 40; t++) { s.x = 16.5; s.y = 3.6; s.z = 10.5; g.tick(); }   // 0.9 below the cell centre: within 1.0
    ok(ys.length === 0, 'GoBackToLava within-distance test is against the cell centre (re-paths ' + ys.length + ')');
    breaks += (ys.length === 0 ? 1 : 0) + 1;
  } finally { Ai.findPath = fp; }
}

{
  const c = scenario(true), f = Ai.striderPathfindingFavor(c.s);
  c.s.inLava = false;
  const a1 = f(17, 4, 10), a2 = f(10, 5, 10); c.s.inLava = true; const a3 = f(10, 5, 10), a4 = f(17, 4, 10);
  ok(a1 === 10 && a4 === 10, 'strider favor(lava cell) = 10');
  ok(a2 === 0, 'strider favor(land, not in lava) = 0');
  ok(a3 === -Infinity, 'strider favor(land while inLava) = -Infinity');
  breaks += (a1 !== a2 ? 1 : 0) + (a3 !== a2 ? 1 : 0);
  c.s.inLava = false;
}
if (fails.length) { console.log('FAIL (' + fails.length + '):'); fails.forEach((f) => console.log(' x ' + f)); }
for (let i = 0; i < breaks; i++) console.log(' ✓ deliberate break ' + (i + 1) + ' noticed');
console.log('stridergoalcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
