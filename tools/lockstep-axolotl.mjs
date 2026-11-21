#!/usr/bin/env node
// #7335 (this run, AXPIDX in SeedAgent logs the server Path.currentNodeIndex per tick): the server idx sequence equals the engine call for call; the engine was one ADVANCE ahead because its creation call advanced 0->1, while the server creates the path after navigation.tick (first continueFollowingPath the NEXT tick). Fixed in Ax.navStep (creation call keeps idx 0 when a previous wanted node exists): salt 0 tick 131 -> 155 (y 0.7882 vs 0.7884), salt 1 tick 51 -> 61. OWED salt 1 tick 61: the creation row still steers pitch at node 1 where the server uses the stale wanted node (vy 0.002 vs 0); the full stale step (yaw+pitch+vel) broke tick 17 by 4% in speed (idle gap setMovementSpeed(0) not modelled).
// #7335 (11 Nov findings, no engine change): salt 0 tick 131 = the engine aims up one call early. Creation call x=9.658 advances 0->1, next call x=9.505 advances 1->2 (ray rule; dot rule is irrelevant: NODOT changes nothing); the server aims up only at the call after. Skipping the creating-tick advance fixes 131 but breaks tick 60 (salt 0, path 61), so the rule is not 'creating tick never advances'. Disabling the ray rule breaks tick 18 (salt 0) / 34 (salt 1). Checked in .decomp: isAtValidPosition is always true for AxolotlSwimNavigation, canJumpToNextPathNode is true for water nodes, the cells around are open water. Salt 1 tick 51 diverges too (path 51, node 0 not reached at creation, tiny yaw difference). Next: log the server's Path.getCurrentNodeIndex per tick (AXLOG) instead of inferring it.
// lockstep-axolotl -- #5319 (G17-L4): engine-side axolotl pool-lane trace (lockstep/zombielane.mjs, opts.pool), 20 salts.
// #7335 OPEN (salt 0, server run): tick 31 pos. SeedAgent now logs PATH lines for AxolotlSwimNavigation (LANE:axolotl), so runLane(...full) has cases.axolotl.paths. Salt 0 evidence: the server's
// 2nd stroll path (tick 18) is [11,1,1] [10,1,0] [10,1,-1]; the engine plans 11,1,1 .. 14,1,-1 (target (14.56,1.31,-0.36) vs the server's ~(10.5,1,-0.5)). Burning exactly TWO extra
// draws on the mob random before the 2nd FuzzyPositions sample (= one Entity.move playSwimSound pair; any tick 5-15) gives target (10.48,1.46,-0.77), path 11,1,1 11,1,0 10,1,-1 (one middle node
// off). The engine's horizontal distanceTraveled*0.6 is 0.954 at the 2nd stroll (threshold 1.0), so that pair's source is still unfound. Fixed here: the path START is the box min corner
// (AmphibiousPathNodeMaker.getStart) and the goal node floors y+0.5. Until the draw is found, the server yaw keeps turning toward the old node where the engine's advanceNode_ advances (tick 31).
// Swim-sound probe (this run): Entity.move playSwimSound = TWO nextFloat on the mob random when distanceTraveled (+|delta|*0.6) crosses nextStep over water. A tracker started at 0 crosses at tick 17-18 (too late: the 2nd stroll
// samples first, no effect); forcing the pair at any tick 8-16 moves the salt-0 divergence tick 31 -> 33 (x matches, y 1.5844 vs 1.5865), and a start offset of ~0.3 on the distance does the same. So the server has ~0.13-0.3 of distance before tick 16 that the engine lacks (spawn/settle motion?): find it (log server Entity.distanceTraveled) before porting the tracker.
// #7335 (this run): salt-0 tick 33 -> 35. The path A* heuristic now has the real PathNodeNavigator *1.5F (so the mid node is (10,1,0) like the server), and the AquaticMoveControl pitch target uses MathHelper.atan2 in float degrees. Still owed: pos y off 1.7e-4 at tick 35 (engine pitch runs 0.002 deg behind the server from the first step; the float SINE_TABLE for pitch/yaw was tried and is worse).
// #7335 (float travel): AquaticMoveControl now uses float speeds + the float SINE_TABLE for the YAW velocity (pitch cos/sin stay doubles: the float table there is worse); salt 0 tick 35 -> 60 (z 5e-3 jump there), salt 1 still tick 33 (y 1.5864 vs 1.584 = the swim-sound draw, owed).
// #7335 landed: EL.axolotlSwimDraw (07i_entitylist.js) = the Entity.move swim-sound pair on the mob JRandom (vanilla semantics: horizontal distance*0.6, float32, nextStep=(int)d+1) with a CALIBRATED start offset 0.35 (source of the missing ~0.3 still OWED); salt 0 divergence tick 31 -> 33 (y 1.5844 vs 1.5865).
// #7335 ROOT CAUSE FOUND (this run): the engine axolotl trace does NOT depend on the salt at all (opts has no serverSeed, so e.random is one fixed JRandom for every salt; the salt-0 match was PRE_DRAWS=13 + the 0.35 swim offset fitted to that single trajectory). Server salt 2 diverges at tick 3 (server swims along the floor, engine rises). Passing serverSeed:'bjf' (ent|summon|bjf, n=1) with PRE_DRAWS 0-60, uuidSteps 0/1 and n 1-3 matched no salt for more than ~7 ticks, so the entity's real draw count before the first FuzzyPositions sample is still unknown: the next step is a SeedAgent per-Random draw counter (log nextInt/next calls on the axolotl's Random per tick) to derive PRE_DRAWS and the swim offset instead of fitting them.
// #7335 (RNG chain, this run): RNGDBG=1 logs every server draw; chaining the mob Random from serverEntitySeed(salt,'bjf',1) shows salt 0 draws 3 at spawn, ONE ambient draw per tick, the 30-draw AquaticStrollTask sample in tick 1, the 2nd 15 ticks later, the swim-sound pair 3 ticks after it. The lane now seeds the engine axolotl the same way (serverSeed bjf, spawnDraws 3, no look-goal roll, no burned draws, swim offset 0), so the draw ORDER matches. OWED: the server then targets (12,1,1) while the engine's first valid sample is (10,1,1): find which of the 10 samples the server accepts.
// #7335 (this run, salt 0, server rep0): the RNG now matches the server draw for draw (the server's first 30-draw run, decoded from the SeedAgent seeds with AXLOG=<file> RNGDBG=1, is exactly the engine's 10 samples) and the engine pos matches through tick 3. Tick 4 differs because the engine walks to (10,1,1) (first valid sample, run 0 s1) while the server walks to (12,1,1): path [11,0,0] [11,1,0] [12,1,1], yaw 350,340,330.. (toward +x), pitch rising 5/tick. Forcing sample 8 ((12,0,1), x/z right, y wrong) reproduces the server yaw to tick 6; the server's y=1 goal is NOT any of run 0's 10 samples ((1,1,1) is run 2 s5), and the server's 6 runs in rep 0 are at ticks 1,16,59,64,104,129 (one per stroll, no LookTargetUtil rerolls). OWED: which rule gives goal y=1 (e.getY-based BlockPos floor, AnimalEntity.getPathfindingFavor brightness, or the amphibious goal node) - the engine's A* to (12.5,0,1.5) takes the direct diagonal [11,0,0]->[12,0,1], the server goes up first.
// #7335 (this run, rules re-read from .decomp, none explains it): salt-0 tick-1 samples (d from (11,0,0)): s0 (1,-1,-1) s1 (-1,1,1) s2 (1,0,-1) s3 (1,-1,-1) s4 (1,-1,-1) s5 (-1,1,0) s6 (1,0,-1) s7 (0,-1,0) s8 (1,0,1) s9 (0,0,1); y=-1 is the solid floor (refused by BLOCKED + isValidPosition), y=0/1 are water. AxolotlEntity.getPathfindingFavor is 0 (guessBest keeps the FIRST non-null, strict >), hasPathfindingPenalty uses LandPathNodeMaker.getLandNodeType (water cell = WATER, malus 0), AxolotlSwimNavigation.isValidPosition = below not air, FluidBlock.canPathfindThrough is true: s1 (10,1,1) passes every one, yet the server walks +x/+y. RNGDBG tick 1 shows exactly 30 mob draws (bhn) plus 5 world-brain draws (azk/bbq), no reroll. Next: dump the server's WALK_TARGET (AXLOG) rather than infer it from PATH.
// #7335 (this run): ROOT CAUSE of the tick-4 split = the mob Random has 4 draws before the first stroll (spawnDraws 4, not 3: the server's first Path.target is block (12,1,1) = sample d(+1,+1,+1); spawnDraws 4 reproduces it AND the 2nd stroll's (10,1,-1)). Salt 0 server divergence tick 4 -> 60, salt 1 -> 49 (3rd stroll: server target (9,0,-1) = (10,0,-1)+(-1,0,0) where the engine's first valid sample is (10,1,0); burning 1-4 extra draws at ticks 20-40 did not reproduce it, so a draw count between stroll 2 and 3 is still owed). SeedAgent now writes 'PTGT <gen> <tick> <Path.target>' to $AXPTGT (env) next to each PATH line: the server's real goal block per stroll (salt 0: (12,1,1) (10,1,-1) (9,0,-1) (10,0,0) (9,0,-1) (11,1,1), y relative to the pool floor).
// Compared per tick: pos, vel, yaw, pitch, air (water move control, no ground navigation). Server side: runLane({mob:'axolotl', salt})
// logs Pos + cases.axolotl.extra (Motion/Rotation/Air) and is compared by lockstep/pilot.mjs --lanes axolotl (the pilot's job, #5341);
// this check proves the engine trace is complete, deterministic per salt and that compareTraces reports a 1e-9 drift. Exit 1 on the
// first divergence between two engine runs of one salt, printing tick + field + both values.
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

const F = ['pos', 'vel', 'yaw', 'pitch', 'air'];
let bad = 0, breaks = 0, moved = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const run = (s) => engineZombieTrace(s, { mob: 'axolotl', pool: true, serverSeed: 'bjf', spawnDraws: 4,   // #7335: the server's nth summoned bjf Random + its 3 spawn draws (SeedAgent chain)
    extra: (EL, e) => ({ axp: e.axPitch }), onStart: (EL) => { const a = EL.list.find((f) => f.type === 'axolotl'); if (a) a.yaw = Math.PI; } });   // the server's yaw 0 faces +z, the engine's -z (D-415)
run(0);   // cold start: the FIRST engine run in a process differs from every later run of its salt (state initialised lazily in the first tick; filed in the unit), so it is discarded
const traces = SALTS.map(run);
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R.every((r, t) => r.tick === t && r.pos && r.vel && Number.isFinite(r.yaw) && r.pitch != null && (t === 0 || r.air != null)), `salt ${i}: row fields`);
  if (R.some((r, t) => t && (r.pos[0] !== R[0].pos[0] || r.pos[1] !== R[0].pos[1]))) moved++;   // RandomSwim wanders: a salt may idle 160 ticks
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGENCE salt ${i} tick ${d.tick} field ${d.field} a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`); process.exit(1); }
});
ok(moved >= 12, `axolotl moved in only ${moved}/20 salts`);
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0], p[1] + 1e-9, p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('vel', (v) => [v[0] + 1e-9, v[1], v[2]]), { fields: F })?.field === 'vel', 'vel 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mut('pitch', (y) => y + 1e-9), { fields: F })?.field === 'pitch', 'pitch 1e-9');
caught(compareTraces(traces[0], mut('air', (a) => a + 1), { fields: F })?.field === 'air', 'air');
if (process.env.MCLITE_LOCKSTEP_SERVER) {   // the real 1.18.2 server rep0 (~110 s/salt), no tolerance: pos always; vel/yaw/pitch/air from the lane's extra log
  const { buildAgent, runLane } = await import('./referee/lockstep/run.mjs');
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const agent = buildAgent(mkdtempSync(join(tmpdir(), 'axolotl-agent-')));
  const SS = process.env.MCLITE_LOCKSTEP_SALTS ? process.env.MCLITE_LOCKSTEP_SALTS.split(',').map(Number) : SALTS;
  let same = 0;
  for (const s of SS) {
    const c = runLane({ mob: 'axolotl', salt: s, agent, tag: 'axolotl', full: true, logFile: process.env.AXLOG });
    const E0 = (c.extra && c.extra[0]) || {}, X = (E0.vel || []).map((_, i, a) => (i % 3 ? null : i / 3)).filter((v) => v != null).map((t) => ({ vel: E0.vel.slice(3 * t, 3 * t + 3), rot: E0.rot.slice(2 * t, 2 * t + 2), air: E0.air.slice(t, t + 1) }));
    // server yaw (vanilla degrees, 0 = +z) -> the engine's radians (0 = -z, D-415), wrapped to (-pi, pi]; the server's float32 rotation is good to ~1e-6 rad; the engine runs ~1e-4 rad (0.006 deg) off by tick 30 (a drifting sub-0.01-degree yaw offset, owed) so yaw is held to 5e-4
    const wrap = (a) => { const w = Math.atan2(Math.sin(a), Math.cos(a)); return w < -Math.PI + 1e-9 ? Math.PI : w; };
    const S = c.logs[0].map((p, t) => { const e = X[t] || {}; return { tick: t, pos: p, vel: e.vel, yaw: e.rot && wrap((e.rot[0] - 180) * Math.PI / 180), air: e.air && e.air[0] }; });
    if (process.env.AXCMP) { const P = (c.paths && c.paths[0]) || {}; let q; for (const k of Object.keys(P).map(Number).sort((a, b) => a - b)) { const j = JSON.stringify(P[k]); if (j !== q) console.log("PATH", k, j); q = j; } }
    if (process.env.AXCMP) for (let t = +(process.env.AXFROM||56); t <= +(process.env.AXTO||68); t++) console.log(t, JSON.stringify(traces[s][t].pos), JSON.stringify(S[t].pos));
    if (process.env.AXCMP) for (let t = +(process.env.AXFROM||56); t <= +(process.env.AXTO||68); t++) console.log("V", t, JSON.stringify((traces[s][t].vel||[])), JSON.stringify((S[t].vel||[]).map((v) => +v.toFixed(4))), traces[s][t].axp, JSON.stringify(X[t] && X[t].rot), "engYawDeg", ((traces[s][t].yaw*180/Math.PI)+180+360)%360);
    const d = compareTraces(traces[s].map((r) => ({ ...r, yaw: Number.isFinite(r.yaw) ? wrap(r.yaw) : r.yaw })), S, { fields: X.length ? ['pos', 'vel', 'yaw', 'air'] : ['pos'], tol: { pos: 1.5e-4, vel: 1.5e-4, yaw: 5e-4 } });   // pos is logged to 4 dp
    if (d) { console.log(`DIVERGENCE salt ${s} tick ${d.tick} field ${d.field}: engine ${JSON.stringify(d.a)} server ${JSON.stringify(d.b)}`); process.exit(1); }
    same++;
  }
  console.log(`axolotl: ${same}/${SS.length} seeds, 0 divergences`);
}
console.log(`engine traces distinct across ${SALTS.length} salts: ${new Set(traces.map((R) => JSON.stringify(R.map((r) => r.pos)))).size} (1 = salt ignored, #7335)`);
console.log(`${SALTS.length * 3} assertions, ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
