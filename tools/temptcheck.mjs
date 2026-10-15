#!/usr/bin/env node
// temptcheck.mjs — #1995: TemptGoal/OcelotTemptGoal vs .decomp TemptGoal (canBeScared, 100-tick cooldown,
// 2.5-block stand-off, off hand, no inLove clause).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07s_raid.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai;
const cod = (i) => i === 'cod';
const mkMob = () => ({ id: 1, type: 'ocelot', x: 0, y: 8, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, width: 0.6, height: 0.7, trusting: false });
const mkPlayer = (x, extra) => Object.assign({ x, y: 8, z: 0, yaw: 0, pitch: 0, heldItem: 'cod' }, extra);

/** Start the goal, then let the player move 1 block while within 6; returns canContinueToUse. */
function scared(canBeScared, trusting) {
  const e = mkMob(); e.trusting = trusting;
  const p = mkPlayer(4);
  const g = new Ai.TemptGoal(e, 0.6, () => [p], cod, canBeScared(e));
  if (!g.canUse()) return null;
  g.start();
  const still = g.canContinueToUse();
  p.x += 1;
  return { still, moved: g.canContinueToUse(), g, p };
}
const ocelotScared = (e) => () => !e.trusting;

{
  const r = scared(ocelotScared, false);
  ok(r && r.still, 'a still player keeps the ocelot tempted');
  ok(r && !r.moved, 'player moving >0.1 within 6 blocks ends the ocelot goal');
  // turning > 5 degrees
  const e = mkMob(), p = mkPlayer(4);
  const g = new Ai.TemptGoal(e, 0.6, () => [p], cod, () => !e.trusting);
  g.canUse(); g.start(); g.canContinueToUse();
  p.yaw = 6 * Math.PI / 180;
  ok(!g.canContinueToUse(), 'turning more than 5 degrees ends the goal');
  // cooldown: 100 ticks of canUse false, then true again
  g.stop();
  p.yaw = 0;
  let n = 0; while (!g.canUse() && n < 500) n++;
  ok(n === 100, 'stop() sets a 100-tick cooldown (' + n + ')');
  // trusting ocelot is not scared
  const t = scared(ocelotScared, true);
  ok(t && t.moved, 'a trusting ocelot keeps following a moving player');
  // not scared (cow-like) keeps following
  const c = scared(() => false, false);
  ok(c && c.moved, 'canBeScared=false never gives up');
  // anti-vacuity: break the scared flag and the give-up assertion must fail
  okAv(c && c.moved && !(r && r.moved), 'breaking canBeScared makes the mob follow a moving player');
  // stand-off 2.5 blocks (3D)
  const e2 = mkMob(), p2 = mkPlayer(2.4);
  const g2 = new Ai.TemptGoal(e2, 0.6, () => [p2], cod);
  g2.canUse(); g2.start(); g2.tick();
  ok(e2.x === 0, 'stands still inside 2.5 blocks');
  okAv(Ai.TEMPT_STANDOFF === 2.5, 'TEMPT_STANDOFF is 2.5 (was 1.5)');
  // off hand
  const e4 = mkMob(), p4 = mkPlayer(4, { heldItem: null, offHandItem: 'cod' });
  ok(new Ai.TemptGoal(e4, 0.6, () => [p4], cod).canUse(), 'off-hand cod tempts');
  p4.offHandItem = null;
  okAv(!new Ai.TemptGoal(e4, 0.6, () => [p4], cod).canUse(), 'with the off hand emptied nothing tempts');
}

for (const f of fails) console.log('FAIL  ' + f);
console.log(fails.length ? 'FAIL  temptcheck' : `temptcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
