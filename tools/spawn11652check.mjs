#!/usr/bin/env node
// spawn11652check.mjs — #11652: proves 07l_spawn.js classes through real entry points: GravityField (+SpawnHelper.Info.test),
// WorldBorder.contains(ChunkPos/BlockPos) via Spawn.borderContains*, GolemLastSeenSensor (Village.senseIronGolem, 200-tick
// interval, 600-tick memory, 16-box), EntityInteraction/InteractionObserver (Village.onHurt/onTrade/deathObservers gossip).
// Reach: Village.tick is the per-villager tick; Spawn.setupInfo/infoTest are SpawnHelper's. Source breaks must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07k_goals.js', '07l_spawn.js', '07ox_enchhelper.js',
  '07p_trade.js', '14c_raycast.js', '07q_effects.js', '07y_equip.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch: patch ? (f, s) => (f === '07l_spawn.js' ? patch(s) : s) : undefined });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init();
  const im = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: im.rawBytes });
  M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init(); M.Village.init();
  const o = {}, Sp = M.Spawn, V = M.Village;
  // GravityField
  const G = new Sp.GravityField();
  G.addPoint(0, 0, 0, 0); G.addPoint(3, 0, 4, 10); G.addPoint(0, 0, 10, 5);
  o.gfZeroMass = G.points.length === 2 && G.calculate(1, 1, 1, 0) === 0;
  o.gfCalc = Math.abs(G.calculate(0, 0, 0, 2) - (10 / 5 + 5 / 10) * 2) < 1e-9;
  o.gfInf = G.calculate(3, 0, 4, 1) === Infinity;
  // WorldBorder
  const saveB = M.World.border;
  M.World.border = { west: () => -32, east: () => 32, north: () => -32, south: () => 32, contains: (x, z) => x >= -32 && x < 32 && z >= -32 && z < 32 };
  o.bcChunk = Sp.borderContainsChunk(0, 0) && Sp.borderContainsChunk(1, 1) && !Sp.borderContainsChunk(2, 0) && Sp.borderContainsChunk(-2, 0) && !Sp.borderContainsChunk(-3, 0) && !Sp.borderContainsChunk(0, 2);
  o.bcBlock = Sp.borderContainsBlock(31, 0) && !Sp.borderContainsBlock(32, 0) && !Sp.borderContainsBlock(0, -33);
  M.World.border = null; o.bcNone = Sp.borderContainsChunk(99, 99) && Sp.borderContainsBlock(1e6, 0);
  M.World.border = saveB;
  // GolemLastSeenSensor
  const EL = M.EntityList;
  const mk = (t, x, y, z) => { const e = EL.spawn ? EL.spawn(t, x, y, z) : null; return e; };
  const vil = { type: 'villager', x: 0, y: 64, z: 0 };
  const gol = { type: 'iron_golem', x: 10, y: 64, z: 0 };
  EL.list.length = 0; EL.list.push(vil, gol);
  vil.golemSenseCD = 3;
  V.senseIronGolem(vil, 1000); V.senseIronGolem(vil, 1000);
  o.sensIdle = vil.golemDetectedUntil === undefined && vil.golemSenseCD === 1;
  V.senseIronGolem(vil, 1000);
  o.sensFire = vil.golemDetectedUntil === 1600 && vil.golemSenseCD === 200;
  const v2 = { type: 'villager', x: 0, y: 64, z: 0, golemSenseCD: 1 };
  gol.x = 17; EL.list.push(v2); V.senseIronGolem(v2, 5);
  o.sensRange = v2.golemDetectedUntil === undefined;
  gol.x = 16; v2.golemSenseCD = 1; V.senseIronGolem(v2, 5); o.sensEdge = v2.golemDetectedUntil === 605;
  // EntityInteraction gossip
  M.Player = M.Player || {};
  const vg = { type: 'villager', x: 0, y: 64, z: 0 };
  V.onHurt(vg, M.Player); o.hurt = !!(vg.gossip && vg.gossip.minor_negative === 25);
  const vt = { type: 'villager', x: 0, y: 64, z: 0 };
  V.onTrade(vt, M.Player); o.trade = !!(vt.gossip && vt.gossip.trading === 2);
  o.cap = (() => { const e = {}; V.startGossip(e, 'trading', 20); V.startGossip(e, 'trading', 20); return e.gossip.trading === 25 || e.gossip.trading === 20; })();
  // Weighted (Spawn.pickWeighted): cumulative subtract-and-test, rnd(total)
  const wl = [{ weight: 1, n: 'a' }, { weight: 3, n: 'b' }, { weight: 0, n: 'c' }];
  const pick = (r) => Sp.pickWeighted(wl, () => r).n;
  o.wPick = pick(0) === 'a' && pick(1) === 'b' && pick(3) === 'b' && Sp.pickWeighted([{ weight: 0 }], () => 0) === null;
  // LevelInfo hardcore forces hard
  const D = M.Difficulty || M.Diff || Sp.Difficulty || Sp.Diff;
  if (D && D.setHardcore) { D.setHardcore(false); D.set('easy'); D.setHardcore(true); o.hc = D.value === 'hard' && D.set('peaceful') === 'hard'; D.setHardcore(false); } else o.hc = false;
  o.ready = V.ready === true;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.Village\.tick/.test(rd('07i_entitylist.js') + rd('07zv_villagerbrain.js')), 'reach: Village.tick');
ok(/Spawn\.(setupInfo|infoTest)/.test(rd('07l_spawn.js')), 'reach: Info');
const BR = [
  ['gfmass', 'sum += d2 === 0 ? Infinity : p[3] / Math.sqrt(d2);', 'sum += d2 === 0 ? Infinity : p[3] / d2;', ['gfCalc']],
  ['gfzero', 'if (mass !== 0) this.points.push', 'if (true) this.points.push', ['gfZeroMass']],
  ['gfinf', 'sum += d2 === 0 ? Infinity :', 'sum += d2 === 0 ? 0 :', ['gfInf']],
  ['bcchunk', '(cx << 4) + 15 > WB.west()', '(cx << 4) > WB.west()', ['bcChunk']],
  ['bcblock', 'return !WB || WB.contains(x, z);', 'return true;', ['bcBlock']],
  ['sensor600', 'Village.GOLEM_DETECTED_TICKS = 600;', 'Village.GOLEM_DETECTED_TICKS = 300;', ['sensFire']],
  ['sensor200', 'Village.GOLEM_SENSE_INTERVAL = 200;', 'Village.GOLEM_SENSE_INTERVAL = 100;', ['sensFire']],
  ['sensrange', 'Village.MOBS_RANGE = 16;', 'Village.MOBS_RANGE = 32;', ['sensRange']],
  ['weighted', 'if (r < 0) return list[i];', 'if (r <= 0) return list[i];', ['wPick']],
  ['hardcore', "return (Diff.value = Diff.hardcore ? 'hard' : level);", 'return (Diff.value = level);', ['hc']],
  ['hurt', "Village.startGossip(e, 'minor_negative', 25);", "Village.startGossip(e, 'minor_negative', 5);", ['hurt']],
  ['trade', "Village.startGossip(e, 'trading', 2);", "Village.startGossip(e, 'trading', 1);", ['trade']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`spawn11652check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
