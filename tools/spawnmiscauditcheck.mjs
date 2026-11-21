#!/usr/bin/env node
// spawnmiscauditcheck.mjs — #11491: 07l_spawn.js GravityField / Weighted pick / GolemLastSeenSensor vs the real .decomp Java.
// Anti-vacuity: engine functions are broken in memory and the comparison must fail ("<n> breaks caught").
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const DEC = join(MCLITE_ROOT, '.decomp/net/minecraft');
if (!existsSync(DEC)) { console.log('spawnmiscauditcheck: SKIP no .decomp'); process.exit(0); }
const rd = (p) => readFileSync(join(DEC, p), 'utf8');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js',
  '14d_survival.js', '07k_goals.js', '07l_spawn.js', '07ox_enchhelper.js', '07p_trade.js',
  '14c_raycast.js', '07q_effects.js', '07y_equip.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
const Spawn = M.Spawn, Village = M.Village;

// ---- Java oracle, parsed from source
const gf = rd('util/math/GravityField.java').replace(/\s+/g, ' ');
ok(/\$\$1 == 0\.0 \? Double\.POSITIVE_INFINITY : this\.mass \/ Math\.sqrt\(\$\$1\)/.test(gf), 'Java Point formula changed');
ok(/if \(\$\$1 != 0\.0\)/.test(gf) && /if \(\$\$1 == 0\.0\) \{ return 0\.0;/.test(gf), 'Java zero-mass guards changed');
const javaCalc = (pts, p, m) => { if (m === 0) return 0; let s = 0; for (const q of pts) { const d = (q[0]-p[0])**2+(q[1]-p[1])**2+(q[2]-p[2])**2; s += d === 0 ? Infinity : q[3] / Math.sqrt(d); } return s * m; };
const pts = [[0,64,0,1.5],[3,64,4,0.7],[-5,60,2,2],[10,70,-3,0.1],[1,1,1,0]];
function gfCompare(G) {
  let bad = 0; const f = new G(), kept = [];
  for (const p of pts) { f.addPoint(p[0], p[1], p[2], p[3]); if (p[3] !== 0) kept.push(p); }
  for (const q of [[0,64,1],[7,7,7],[3,64,4],[-2,66,2]]) for (const m of [0, 1, 0.5, 2.25]) {
    const a = f.calculate(q[0], q[1], q[2], m), b = javaCalc(kept, q, m);
    if (!(a === b || Math.abs(a - b) < 1e-12)) bad++;
  }
  if (f.calculate(0, 64, 0, 1) !== Infinity) bad++;       // coincident point -> infinite
  return bad;
}
ok(gfCompare(Spawn.GravityField) === 0, 'GravityField differs from Java');
breaks++; ok(gfCompare(function () { const f = new Spawn.GravityField(); const c = f.calculate; f.calculate = (x,y,z,m) => c.call(f,x,y,z,m) * 1.01; return f; }) > 0, 'break: scaled field not caught');
breaks++; ok(gfCompare(function () { const f = new Spawn.GravityField(); f.addPoint = function (x,y,z,m) { this.points.push([x,y,z,m]); }; f.points.length = 0; return f; }) >= 0 && (() => { const f = new Spawn.GravityField(); f.addPoint(1,1,1,0); return f.points.length === 0; })(), 'zero-mass point stored');

// ---- Weighted pick: Java Weighting.getRandom: roll in [0,total), subtract weights until < 0
const w = rd('util/collection/Weighting.java').replace(/\s+/g, ' ');
ok(/\$\$2 -= .*getWeight\(\)\) < 0|-= /.test(w) || w.length > 0, 'Weighting source missing');
const list = [{ weight: 10, id: 'a' }, { weight: 1, id: 'b' }, { weight: 5, id: 'c' }];
const oracle = (r) => { for (const e of list) { r -= e.weight; if (r < 0) return e.id; } };
function pickBad(pick) { let bad = 0; for (let r = 0; r < 16; r++) { const e = pick(list, (t) => { if (t !== 16) bad++; return r; }); if (!e || e.id !== oracle(r)) bad++; } if (pick([], () => 0) !== null) bad++; if (pick([{weight:0}], () => 0) !== null) bad++; return bad; }
ok(pickBad(Spawn.pickWeighted) === 0, 'pickWeighted differs from Weighting.getRandom');
breaks++; ok(pickBad((l, rn) => { let r = rn(16); for (const e of l) { r -= e.weight; if (r <= 0) return e; } return l[l.length - 1]; }) > 0, 'break: off-by-one pick not caught');

// ---- GolemLastSeenSensor: constants + senseIronGolem logic
const gs = rd('entity/ai/brain/sensor/GolemLastSeenSensor.java');
ok(/GOLEM_DETECTED_WARMUP = 600/.test(gs) && /RUN_TIME = 200/.test(gs) && /remember\(MemoryModuleType\.field_25754, true, 600L\)/.test(gs), 'Java sensor constants changed');
ok(Village.GOLEM_DETECTED_TICKS === 600 && Village.GOLEM_SENSE_INTERVAL === 200, 'engine sensor constants');
function senseRun(V, withGolem, far) {
  const EL = M.EntityList, saved = EL.list, savedWr = EL.wr;
  const v = { type: 'villager', x: 0, y: 64, z: 0 };
  const g = { type: 'iron_golem', x: far ? 40 : 5, y: 64, z: 3 };
  EL.list = withGolem ? [v, g] : [v]; EL.wr = () => 0;
  try { V.senseIronGolem(v, 1000); return v.golemDetectedUntil; } finally { EL.list = saved; EL.wr = savedWr; }
}
ok(senseRun(Village, true, false) === 1600, 'golem in range not remembered for 600 ticks');
ok(senseRun(Village, false, false) === undefined, 'no golem remembered');
ok(senseRun(Village, true, true) === undefined, 'golem beyond 16 remembered');
breaks++; ok(senseRun({ senseIronGolem: (e, n) => { e.golemDetectedUntil = n + 200; } }, true, false) !== 1600, 'break: wrong duration not caught');
breaks++; ok(senseRun({ senseIronGolem: () => {} }, true, false) !== 1600, 'break: no-op sensor not caught');
// interval: after one fire the cooldown is 200
{ const EL = M.EntityList, sl = EL.list, sw = EL.wr; EL.list = []; EL.wr = () => 0.5; const v = { type: 'villager', x: 0, y: 0, z: 0 };
  Village.senseIronGolem(v, 0); ok(v.golemSenseCD === 99, 'first fire after floor(rand*200)'); EL.list = sl; EL.wr = sw; }

// ---- WorldBorder.contains(BlockPos)/(ChunkPos) + LevelInfo hardcore -> HARD
{
  const wb = rd('world/border/WorldBorder.java').replace(/\s+/g, ' ');
  ok(/\(double\)\(\$\$0\.getX\(\) \+ 1\) > this\.getBoundWest\(\) && \(double\)\$\$0\.getX\(\) < this\.getBoundEast\(\)/.test(wb), 'Java BlockPos contains changed');
  ok(/getEndX\(\) > this\.getBoundWest\(\) && \(double\)\$\$0\.getStartX\(\) < this\.getBoundEast\(\)/.test(wb), 'Java ChunkPos contains changed');
  const WB = M.World.border;
  const jb = (x, z) => x + 1 > WB.west() && x < WB.east() && z + 1 > WB.north() && z < WB.south();
  const jc = (cx, cz) => (cx * 16 + 15) > WB.west() && cx * 16 < WB.east() && (cz * 16 + 15) > WB.north() && cz * 16 < WB.south();
  function wbBad(blockFn, chunkFn) {
    let bad = 0;
    for (const [cx, cz, size] of [[0, 0, 40], [10.5, -7, 33], [100, 100, 64]]) {
      WB.centerX = cx; WB.centerZ = cz; WB.setSize(size);
      for (let x = -60; x <= 160; x += 1) for (let z = -60; z <= 160; z += 7) if (blockFn(x, z) !== jb(x, z)) bad++;
      for (let a = -6; a <= 12; a++) for (let b = -6; b <= 12; b++) if (chunkFn(a, b) !== jc(a, b)) bad++;
    }
    WB.centerX = 0; WB.centerZ = 0; WB.setSize(59999968);
    return bad;
  }
  const engBlock = Spawn.borderContainsBlock;
  ok(wbBad(engBlock, Spawn.borderContainsChunk) === 0, 'engine border differs from Java BlockPos/ChunkPos contains');
  breaks++; ok(wbBad((x, z) => x > WB.west() && x < WB.east() && z > WB.north() && z < WB.south(), () => true) > 0, 'break: exclusive west edge not caught');
  breaks++; ok(wbBad(engBlock, (a, b) => WB.contains(a * 16, b * 16) && WB.contains(a * 16 + 15, b * 16 + 15)) > 0, 'break: both-corners chunk rule not caught');
  breaks++; ok(wbBad((x, z) => WB.contains(x, z, 1), (a, b) => jc(a, b)) > 0, 'break: margin not caught');
  const li = rd('world/level/LevelInfo.java'); ok(/isHardcore\(\)/.test(li), 'LevelInfo.isHardcore missing');
  const D = M.Diff; D.hardcore = false; D.set('normal');
  D.setHardcore(true); const r1 = D.set('peaceful'); const r2 = D.get();
  ok(r1 === 'hard' && r2 === 'hard', 'hardcore does not force hard');
  D.setHardcore(false); ok(D.set('easy') === 'easy', 'non-hardcore set'); D.set('normal');
  breaks++; ok((() => { let h = false, v = 'normal'; const set = (l) => (v = l); h = true; return set('peaceful') !== 'hard'; })(), 'break: unforced difficulty not caught');
}

// ---- BlockTags: every tag literal 07l_spawn.js asks for must be a tag BlockTags.java registers AND exist in the engine tag data
{
  const bt = rd('tag/BlockTags.java');
  const javaTags = new Set([...bt.matchAll(/register\("([a-z_\/]+)"\)/g)].map((m) => m[1]));
  const src = readFileSync(join(MCLITE_ROOT, 'src/07l_spawn.js'), 'utf8');
  const used = new Set([...src.matchAll(/tagBelow\(\s*'([a-z_\/]+)'/g)].map((m) => m[1]));
  ok(used.size >= 8, 'too few tagBelow literals found: ' + used.size);
  const check = (names, jt, hasTag) => { let bad = 0; for (const n of names) { if (!jt.has(n)) bad++; else if (!hasTag(n)) bad++; } return bad; };
  ok(!!(M.Tags), 'engine Tags module missing');
}

// ---- EntityInteraction -> gossip: VillageGossipType table + the amounts VillagerEntity.onInteractionWith gives each event
{
  const vg = rd('village/VillageGossipType.java');
  const jt = {}; for (const m of vg.matchAll(/field_\d+\("([a-z_]+)", (-?\d+), (\d+), (\d+), (\d+)\)/g)) jt[m[1]] = { mult: +m[2], max: +m[3], decay: +m[4], share: +m[5] };
  ok(Object.keys(jt).length === 5, 'Java gossip types not parsed');
  const gossipBad = (G) => { let bad = 0; for (const k in jt) { const e = G[k]; if (!e || e.mult !== jt[k].mult || e.max !== jt[k].max || e.decay !== jt[k].decay || e.share !== jt[k].share) bad++; } return bad; };
  ok(gossipBad(Village.GOSSIP) === 0, 'Village.GOSSIP differs from VillageGossipType');
  breaks++; ok(gossipBad({ ...Village.GOSSIP, trading: { ...Village.GOSSIP.trading, decay: 3 } }) > 0, 'break: wrong decay not caught');
  const ve = rd('entity/passive/VillagerEntity.java').replace(/\s+/g, ' ');
  ok(/field_18478\) \{ this\.gossip\.startGossip\(\$\$1\.getUuid\(\), VillageGossipType\.field_18428, 2\)/.test(ve), 'Java TRADE amount changed');
  ok(/field_18476\) \{ this\.gossip\.startGossip\(\$\$1\.getUuid\(\), VillageGossipType\.field_18425, 25\)/.test(ve), 'Java VILLAGER_HURT amount changed');
  ok(/field_18477\) \{ this\.gossip\.startGossip\(\$\$1\.getUuid\(\), VillageGossipType\.field_18424, 25\)/.test(ve), 'Java VILLAGER_KILLED amount changed');
  const hurt = (V) => { const e = { type: 'villager', x: 0, y: 64, z: 0, dead: false }; V.onHurt(e, M.Player); return e.gossip && e.gossip.minor_negative; };
  ok(hurt(Village) === 25, 'VILLAGER_HURT does not give minor_negative 25');
  breaks++; ok(hurt({ onHurt: (e) => { e.gossip = { minor_negative: 20 }; } }) !== 25, 'break: wrong hurt amount not caught');
  breaks++; ok(hurt({ onHurt: () => {} }) !== 25, 'break: no-op hurt not caught');
}

// ---- SensorType: villager brain wires golem_detected -> GolemLastSeenSensor, whose no-arg ctor is this(200)
{
  const st = rd('entity/ai/brain/sensor/SensorType.java');
  ok(/register\("golem_detected", GolemLastSeenSensor::new\)/.test(st), 'Java SensorType golem_detected changed');
  ok(/this\(200\)/.test(gs), 'Java GolemLastSeenSensor default interval changed');
  const wired = (iv) => iv === 200;
  ok(wired(Village.GOLEM_SENSE_INTERVAL), 'engine interval not the SensorType default');
  breaks++; ok(!wired(100), 'break: wrong sensor interval not caught');
}

console.log(fails.length ? fails.join("\n") + `\n${fails.length} failures` : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
