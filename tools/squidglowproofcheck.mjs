#!/usr/bin/env node
// squidglowproofcheck — #11684: GlowSquidEntity (07zi_squid.js) via the real entry points
// (EL.spawn, Cb.hurt -> Sq.onDamaged, Sq.tickMovement countdown + glow particle, Sq.glowCanSpawn y-band).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
  '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07t_fly.js', '07zi_squid.js'] });
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Squid.init();
const EL = M.EntityList, W = M.World, S = M.States, Sq = M.Squid, Cb = M.Combat;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const water = S.stateOf('water') | 0, stone = S.stateOf('stone') | 0;
for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 7; y++)
  W.setBlock(x, y, z, (x === -3 || x === 3 || z === -3 || z === 3 || y === 0 || y === 7) ? stone : water);
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
for (let y = 0; y <= 40; y++) W.setBlock(20, y, 20, water);
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = () => {
  const r = [];
  EL.list.length = 0;
  const g = EL.spawn('glow_squid', 0.5, 3.5, 0.5);
  r.push(!!g && g.darkTicksRemaining === 0);
  Cb.hurt(g, 1, 0, false);
  r.push(g.darkTicksRemaining === 100);
  g.inWater = true; g.darkTicksRemaining = 2;
  Sq.tickMovement(g); r.push(g.darkTicksRemaining === 1);
  Sq.tickMovement(g); Sq.tickMovement(g); r.push(g.darkTicksRemaining === 0);
  const sp = []; const sv = M.Particle; M.Particle = { spawn: (n) => sp.push(n) };
  Sq.tickMovement(g); M.Particle = sv; r.push(sp.includes('glow'));
  r.push(Sq.glowCanSpawn(20, 23, 20, 63) === true);
  r.push(Sq.glowCanSpawn(20, 40, 20, 63) === false);
  return r;
};
const good = () => { try { return run().every(Boolean); } catch (e) { return false; } };
ok(good(), 'glow squid: spawn, dark ticks 100 on hurt, countdown, glow particle, deep-spawn band');
const caught = (label, fn, restore) => { fn(); const bad = !good(); restore(); if (bad) { breaks++; console.log(`   ✓ break caught: ${label}`); } else fails.push('anti-vacuity: ' + label); };
const od = Sq.onDamaged, ot = Sq.tickMovement, og = Sq.glowCanSpawn;
caught('onDamaged no-op', () => { Sq.onDamaged = () => {}; }, () => { Sq.onDamaged = od; });
caught('no countdown', () => { Sq.tickMovement = (e) => ot(e) , Sq.tickMovement = (e) => { const d = e.darkTicksRemaining; ot(e); e.darkTicksRemaining = d; }; }, () => { Sq.tickMovement = ot; });
caught('spawn band ignored', () => { Sq.glowCanSpawn = () => true; }, () => { Sq.glowCanSpawn = og; });
console.log('\n================ squidglowproofcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
