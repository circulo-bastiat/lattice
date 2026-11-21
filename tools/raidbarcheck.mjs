#!/usr/bin/env node
// raidbarcheck.mjs - #5780: the raid's ServerBossBar is DRAWN. H.bossBars() lists the active raid's bar
// (Raid.java updateBar/updateBarToPlayers: red, NOTCHED_10, players within 96 blocks).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

function run(mut) {
  const M = loadEngine({ extra: ['07q_effects.js', '07s_raid.js'] });
  let t = readFileSync(join(MCLITE_ROOT, 'src/15_hud.js'), 'utf8');
  if (mut) t = mut(t);
  new Function('MCL', t)(M);
  const Rd = M.Raid, RM = M.RaidManager, H = M.Hud;
  M.Player = { x: 0, y: 64, z: 0 }; M.EntityList = { list: [] };
  RM.world = RM.create();
  const raid = Rd.create(1, { x: 10, y: 64, z: 0 }, 'normal');
  RM.world.raids[1] = raid;
  const mk = () => ({ health: 24 });
  const rs = [mk(), mk(), mk(), mk()];
  raid.raiders = rs.slice(); raid.wavesSpawned = 1; raid.started = true;
  Rd.updateBar(raid);
  const res = { H, Rd, raid, rs, bars: () => H.bossBars().filter(b => b.raid) };
  const a = res.bars()[0];
  res.full = a;
  rs[0].health = 0; raid.raiders.splice(0, 1); Rd.updateBar(raid);
  res.mid = res.bars()[0];
  raid.raiders.splice(0, 1); Rd.updateBar(raid);
  raid.raiders.splice(0, 1); Rd.updateBar(raid);
  res.last = res.bars()[0];
  raid.raiders.splice(0, 1); Rd.updateBar(raid);
  raid.status = Rd.Status.VICTORY;
  res.win = res.bars()[0];
  raid.status = Rd.Status.LOSS;
  res.loss = res.bars()[0];
  raid.status = Rd.Status.STOPPED;
  res.stopped = res.bars().length;
  raid.status = Rd.Status.ONGOING; Rd.updateBar(raid);
  M.Player.x = 200;
  res.far = res.bars().length;
  return res;
}
let r = run();
ok(r.full && r.full.name === 'Raid' && r.full.percent === 1 && r.full.color === 'red' && r.full.style === 'notched_10', 'full raid: name Raid, percent 1, red, notched_10');
ok(r.mid && Math.abs(r.mid.percent - 0.75) < 1e-6, 'one of four killed -> percent 0.75, got ' + (r.mid && r.mid.percent));
ok(r.last && r.last.name === 'Raid - Raiders remaining: 1', '1 raider -> Raiders remaining: 1, got ' + (r.last && r.last.name));
ok(r.win && r.win.name === 'Raid - Victory' && r.win.percent === 0, 'victory text');
ok(r.loss && r.loss.name === 'Raid - Defeat', 'defeat text');
ok(r.stopped === 0, 'no bar once STOPPED');
ok(r.far === 0, 'no bar for a player 190 blocks away');
const probes = [
  ['never adds the raid bar', t => t.replace('var RM = NS.RaidManager', 'var RM = null'), x => x.full === undefined],
  ['range', t => t.replace('>= 96 * 96', '>= 9600 * 9600'), x => x.far !== 0],
  ['percent', t => t.replace('percent: r.status === st.VICTORY ? 0 : r.bar.percent', 'percent: 1'), x => !x.mid || x.mid.percent === 1],
  ['stopped', t => t.replace('if (r.status !== st.ONGOING && !fin) continue;', ''), x => x.stopped !== 0],
];
for (const [n, m, bad] of probes) okAv(bad(run(m)), 'breaking ' + n + ' is caught');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
