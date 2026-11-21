#!/usr/bin/env node
// #11673: proves LookAtCustomerGoal + StopFollowingCustomerGoal (via Ai.ROSTER.wandering_trader -> WT.rosterGoals)
// and ServerWorldProperties' trader counters (WT.managerToJSON/FromJSON <- 16b_save.js) matter; cut a rule -> scenario differs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, 'src', f), 'utf8');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
ok(/wandering_trader:\s*function \(e, ctx\) \{ return NS\.WT \? NS\.WT\.rosterGoals/.test(rd('07k_goals.js')), 'reach: ROSTER.wandering_trader -> rosterGoals');
const sv = rd('16b_save.js');
ok(/wtm: .*managerToJSON\(\)/.test(sv) && /managerFromJSON\(o\.wtm\)/.test(sv), 'reach: save writes/reads wtm');
function scenario(edit) {
  const log = [];
  let s = rd('07zt_wtrader.js');
  if (edit) { if (!s.includes(edit[0])) throw new Error('missing ' + edit[0]); s = s.replace(edit[0], edit[1]); }
  const Ai = { MOVE: 1, LOOK: 2, JUMP: 4, TARGET: 8,
    GoalSelector: function () { this.add = (p, f, g) => log.push('add' + p + ':' + f + ':' + (g.constructor.name || '?') + (g.tick && g.stop && g.canUse && g.__tag ? '' : '')); } };
  for (const n of ['FloatGoal', 'PanicGoal', 'WanderAroundFarGoal', 'GoToWalkTargetGoal', 'LookAtPlayerGoal', 'LookAtMobGoal', 'AvoidEntityGoal']) Ai[n] = function () {};
  const NS = { Ai };
  new Function('MCL', s)(NS);
  const WT = NS.WT;
  // roster wiring: record which goal objects are registered at which priority/flags
  const reg = [];
  Ai.GoalSelector = function () { this.add = (p, f, g) => { reg.push([p, f, g]); }; };
  const e = { x: 0, y: 0, z: 0, onGround: true, look: { setLookAt: (x, y, z) => log.push('look' + [x, y, z]) } };
  WT.rosterGoals(e, { random: () => 0.5, players: () => [] });
  log.push('roster' + reg.map((r) => r[0] + ':' + r[1] + ':' + (r[2] instanceof WT.StopFollowingCustomerGoal ? 'S' : r[2] instanceof WT.LookAtCustomerGoal ? 'L' : '-')).join(','));
  // Stop/Look goals
  const st = new WT.StopFollowingCustomerGoal(e), lk = new WT.LookAtCustomerGoal(e);
  log.push('n' + st.canUse() + lk.canUse());
  const p = { x: 2, y: 0, z: 2, eyeHeight: 1.62, currentScreenHandler: {} };
  WT.setCustomer(e, p); log.push('has' + WT.hasCustomer(e));
  log.push('c' + st.canUse() + lk.canUse()); lk.tick();
  p.x = 5; log.push('far' + st.canUse() + lk.canUse());
  p.x = 2; p.currentScreenHandler = null; log.push('noscreen' + st.canUse() + lk.canUse());
  p.currentScreenHandler = {};
  e.onGround = false; log.push('air' + st.canUse()); e.onGround = true;
  e.inWater = true; log.push('water' + st.canUse()); e.inWater = false;
  e.velocityModified = true; log.push('vm' + st.canUse()); e.velocityModified = false;
  e.dead = true; log.push('dead' + st.canUse()); e.dead = false;
  e.path = [1]; st.start(); log.push('path' + e.path);
  log.push('cc' + st.canContinueToUse()); p.x = 9; log.push('cc2' + st.canContinueToUse()); p.x = 2;
  st.stop(); log.push('after' + WT.hasCustomer(e) + lk.canUse());
  // ServerWorldProperties counters
  WT.resetManager(); WT.Manager.spawnTimer = 77; WT.Manager.spawnDelay = 5000; WT.Manager.spawnChance = 50;
  const j = WT.managerToJSON(); log.push(JSON.stringify(j));
  WT.resetManager(); log.push('reset' + JSON.stringify(WT.managerToJSON()));
  WT.managerFromJSON(j); log.push('rt' + JSON.stringify(WT.managerToJSON()));
  WT.managerFromJSON(null); log.push('abs' + JSON.stringify(WT.managerToJSON()));
  WT.managerFromJSON({ timer: 5, delay: 6, chance: 101 }); log.push('bad' + JSON.stringify(WT.managerToJSON()));
  WT.managerFromJSON({ timer: -1, delay: 6, chance: 30 }); log.push('neg' + JSON.stringify(WT.managerToJSON()));
  return log.join('|');
}
const base = scenario();
const breaks = [
  [['return dx * dx + dy * dy + dz * dz <= 16 && c.currentScreenHandler != null;', 'return c.currentScreenHandler != null;'], 'stop range'],
  [['&& c.currentScreenHandler != null;', ';'], 'stop screen handler'],
  [['!e.onGround || e.inWater || e.velocityModified', 'e.inWater || e.velocityModified'], 'stop onGround'],
  [['!e.onGround || e.inWater || e.velocityModified', '!e.onGround || e.velocityModified'], 'stop inWater'],
  [['!e.onGround || e.inWater || e.velocityModified', '!e.onGround || e.inWater'], 'stop velocityModified'],
  [['e.dead || e.removed || !e.onGround', 'e.removed || !e.onGround'], 'stop dead'],
  [['this.start = function () { if (e.path) e.path = null; };', 'this.start = function () {};'], 'stop start clears path'],
  [['this.stop = function () { e.customer = null; };', 'this.stop = function () {};'], 'stop drops customer'],
  [['this.canContinueToUse = this.canUse;\n    this.start = function () { if', 'this.canContinueToUse = function () { return true; };\n    this.start = function () { if'], 'stop canContinue'],
  [['this.canUse = function () { return !!e.customer; };', 'this.canUse = function () { return false; };'], 'look canUse'],
  [['e.look.setLookAt(t.x, t.y + (t.eyeHeight || 0), t.z)', 'e.look.setLookAt(t.x, t.y, t.z)'], 'look eye height'],
  [['gs.add(1, Ai.JUMP | Ai.MOVE, new WT.StopFollowingCustomerGoal(e));', ''], 'stop not registered'],
  [['gs.add(1, Ai.LOOK, new WT.LookAtCustomerGoal(e));', ''], 'look not registered'],
  [['gs.add(1, Ai.JUMP | Ai.MOVE, new WT.StopFollowingCustomerGoal(e));', 'gs.add(1, Ai.MOVE, new WT.StopFollowingCustomerGoal(e));'], 'stop flags'],
  [['return { timer: M.spawnTimer | 0, delay: M.spawnDelay | 0, chance: M.spawnChance | 0 };', 'return { timer: M.spawnTimer | 0, delay: M.spawnDelay | 0, chance: 0 };'], 'props chance'],
  [['if (isFinite(o.delay) && o.delay >= 0) M.spawnDelay = o.delay | 0;', ''], 'props delay restore'],
  [['o.chance <= 100) M.spawnChance', 'o.chance <= 1000) M.spawnChance'], 'props chance bound'],
  [['if (isFinite(o.timer) && o.timer >= 0) M.spawnTimer', 'if (isFinite(o.timer)) M.spawnTimer'], 'props negative'],
  [['WT.resetManager();   // absent', '// absent'], 'props absent reset'],
];
let caught = 0;
for (const [ed, name] of breaks) {
  let got; try { got = scenario(ed); } catch (e) { got = 'throw ' + e.message; }
  if (got !== base) caught++; else { fails++; console.log('NOT CAUGHT ' + name); }
}
console.log(`wtrader11673check -- ${fails ? fails + ' FAIL' : 'ok'}; ${caught} breaks caught`);
process.exit(fails || caught !== breaks.length ? 1 : 0);
