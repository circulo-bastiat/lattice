#!/usr/bin/env node
// lodestonecheck.mjs — #5804: CompassItem + the client 'angle' predicate (14l_use.js Use.Compass*).
// Needle frame == the jar's angle formula at 5 positions (spawn target); a lodestone compass points
// at its lodestone; breaking the lodestone drops LodestonePos; the wrong dimension spins; using a
// compass on a lodestone links one compass of a stack. Anti-vacuity: always frame 0; link never removed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14f_inventory.js', '14l_use.js'];
const fmod = (a, b) => a - Math.floor(a / b) * b;

function run(patch) {
  const fails = []; let pass = 0;
  const ok = (c, m) => { if (c) pass++; else fails.push(m); };
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.World.init(1); M.Behave.init(M.World);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Use.init(M.World);
  const { Inventory: Iv, Use, World: W, States: S } = M;
  const CH = M.CH;
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  M.Dim.cur = 'overworld';
  const lode = S.stateOf('lodestone'), spawn = { x: 0, y: 64, z: 0 };
  M.Commands = Object.assign(M.Commands || {}, { worldSpawn: spawn });
  const compass = (t) => Iv.stack('compass', 1, 0, t || null);
  const ctx = (x, z, yaw, dim) => ({ x, z, yaw, dim: dim || 'overworld', spawn, time: 0, mainPlayer: false, seed: 0 });
  // 1) spawn target, non-main-player branch == 0.5 - (yaw/360 - 0.25 - atan2/2pi)  (floorMod 1)
  const pts = [[40, 0, 0], [-25, 60, 90], [3, -77, 180], [-120, -5, 270], [10, 10, 33]];
  for (const [x, z, yaw] of pts) {
    const a = Math.atan2(0.5 - z, 0.5 - x) / Math.fround(Math.PI * 2);
    const want = fmod(Math.fround(0.5 - (fmod(yaw / 360, 1) - 0.25 - a)), 1);
    const got = Use.compassAngle(compass(), ctx(x, z, yaw));
    ok(Math.abs(got - want) < 1e-6, `angle at ${x},${z},${yaw}: ${got} != ${want}`);
    const fr = (16 + Math.floor((want * 64 + 1) / 2)) % 32;
    ok(Use.compassFrame(got) === fr, `frame at ${x},${z}: ${Use.compassFrame(got)} != ${fr}`);
  }
  ok(new Set(pts.map(([x, z, yaw]) => Use.compassFrame(Use.compassAngle(compass(), ctx(x, z, yaw))))).size >= 3, 'frames vary with position');
  // frame table edges (compass.json thresholds (2k-1)/64)
  ok(Use.compassFrame(0) === 16 && Use.compassFrame(0.0157) === 17 && Use.compassFrame(0.4844) === 0 && Use.compassFrame(0.9844) === 16 && Use.compassFrame(0.96) === 15, 'frame thresholds');
  // 2) lodestone compass points at the lodestone, not the spawn
  const lc = compass({ LodestonePos: { X: 100, Y: 70, Z: 0 }, LodestoneDimension: 'minecraft:overworld', LodestoneTracked: true });
  const al = Use.compassAngle(lc, ctx(0, 0, 0));
  ok(Math.abs(al - fmod(Math.fround(0.5 - (0 - 0.25 - Math.atan2(0.5, 100.5) / Math.fround(Math.PI * 2))), 1)) < 1e-6, 'lodestone angle');
  // 3) wrong dimension spins (random target; differs between ticks) and never uses the spawn
  Use.Compass.reset(); Use.Compass.rand = () => 0.9;
  const seen = new Set();
  for (let t = 0; t < 40; t++) { const c = ctx(0, 0, 0, 'the_nether'); c.time = t; seen.add(Use.compassFrame(Use.compassAngle(compass(), c))); }
  ok(seen.size > 1, 'nether plain compass spins: ' + seen.size + ' frames');
  const wrong = compass({ LodestonePos: { X: 100, Y: 70, Z: 0 }, LodestoneDimension: 'minecraft:the_nether', LodestoneTracked: true });
  const seen2 = new Set(); Use.Compass.reset();
  for (let t = 100; t < 140; t++) { const c = ctx(0, 0, 0); c.time = t; seen2.add(Use.compassFrame(Use.compassAngle(wrong, c))); }
  ok(seen2.size > 1, 'lodestone from another dimension spins');
  // 4) use on a lodestone: single compass is linked in place; a stack of 2 splits one off
  W.setBlock(5, 70, 5, lode);
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, x: 5, y: 71, z: 5, syncHotbar() {} };
  Iv.setItem(P.inventory, 0, compass());
  ok(Use.itemUseOn(P, 5, 70, 5, 1, lode, Iv.getItem(P.inventory, 0)) === true, 'lodestone use consumed');
  let st = Iv.getItem(P.inventory, 0);
  ok(st.t && st.t.LodestonePos && st.t.LodestonePos.X === 5 && st.t.LodestoneDimension === 'minecraft:overworld' && st.t.LodestoneTracked === true, 'single compass linked');
  ok(Use.hasLodestone(st), 'hasLodestone');
  Iv.setItem(P.inventory, 0, Iv.stack('compass', 2, 0, null));
  Use.itemUseOn(P, 5, 70, 5, 1, lode, Iv.getItem(P.inventory, 0));
  st = Iv.getItem(P.inventory, 0);
  ok(st.n === 1 && !Use.hasLodestone(st), 'stack of 2 keeps one plain compass');
  let linked = 0; for (let i = 0; i < Iv.SIZE; i++) { const s = Iv.getItem(P.inventory, i); if (s && !Iv.isEmpty(s) && Use.hasLodestone(s)) linked++; }
  ok(linked === 1, 'one lodestone compass split off');
  ok(Use.itemUseOn(P, 6, 70, 5, 1, 0, Iv.getItem(P.inventory, 0)) === false, 'non-lodestone block ignored');
  // 5) breaking the lodestone drops the link on the next inventory tick; an untracked link stays
  let link = null; for (let i = 0; i < Iv.SIZE; i++) { const s = Iv.getItem(P.inventory, i); if (s && !Iv.isEmpty(s) && Use.hasLodestone(s)) link = s; }
  Use.tickCompasses(P);
  ok(link.t.LodestonePos !== undefined, 'link kept while lodestone stands');
  W.setBlock(5, 70, 5, 0);
  Use.tickCompasses(P);
  ok(link.t.LodestonePos === undefined, 'link dropped when lodestone is gone');
  ok(link.t.LodestoneDimension !== undefined && Use.hasLodestone(link), 'still a lodestone compass (dimension tag stays)');
  const un = compass({ LodestonePos: { X: 5, Y: 70, Z: 5 }, LodestoneDimension: 'minecraft:overworld', LodestoneTracked: false });
  Use.compassInventoryTick(un);
  ok(un.t.LodestonePos !== undefined, 'untracked link kept');
  return { pass, fails };
}

let breaks = 0;
const base = run();
const mutants = [
  ['always frame 0', (f, s) => f === '14l_use.js' ? s.replace('Use.compassFrame = function (angle) {', 'Use.compassFrame = function (angle) { return 0;') : s],
  ['link never removed', (f, s) => f === '14l_use.js' ? s.replace('{ delete t.LodestonePos; return true; }', '{ return false; }') : s],
];
let bad = base.fails.slice();
for (const [name, patch] of mutants) {
  const r = run(patch);
  if (r.fails.length) breaks++; else bad.push('mutant not caught: ' + name);
}
console.log(`lodestonecheck: ${base.pass} pass, ${base.fails.length} fail, ${breaks} breaks caught`);
if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
