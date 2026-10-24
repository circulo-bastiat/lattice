#!/usr/bin/env node
// simdistcheck.mjs — item 8(b), D-452: SIMULATION DISTANCE, separate from render distance.
//
//   node tools/simdistcheck.mjs
//
// Vanilla has two distances, not one: render distance decides what is MESHED and DRAWN,
// simulation distance decides what TICKS — entities, natural spawning, random block ticks. This
// engine had only the first. This file proves the second exists and actually shrinks what runs,
// against the SAME primitive both consumers share (`World.tickingAt`), then against each
// consumer directly: `World.randomTick`'s per-section dispatch and `EntityList.tick`'s per-entity
// gate. Spawn's own use of the same primitive (`Spawn.attempt`, D-452) is `spawncheck`'s job —
// biome/heightmap data belongs there, not duplicated here.
//
// Sections:
//   1. Settings — the setting itself: independent of the preset, clamped to <= renderDistance
//   2. World.tickingAt — the shared primitive both consumers below read
//   3. World.randomTick — sections beyond SIM distance (but inside render distance) never fire
//   4. EntityList.tick — entities beyond SIM distance don't tick, and are not dropped
//   5. anti-vacuity — sim == render must restore what §3/§4 excluded, or the check is vacuous

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => console.log(...a);

say('simdistcheck — item 8(b), simulation distance (D-452)');

const EXTRA = ['16_settings.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
               '14b_physics.js', '07i_entitylist.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init();
const W = M.World, S = M.Settings, CH = M.CH, CFG = M.CFG, EL = M.EntityList;

W.init(1337);
EL.init();
if (!EL.ready) { say('simdistcheck: SKIP — EntityList.init() did not come up ready'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }

// ── 1. the setting itself ──────────────────────────────────────────────────────────────────
say('\n1. Settings.simDistance — independent, clamped to renderDistance');
ok(typeof S.simDistance === 'number', 'Settings carries no simDistance field');
S.setRenderDistance(12);
ok(S.setSimDistance(99) === 12, `setSimDistance(99) at renderDistance 12 gave ${S.simDistance}, expected the clamp`);
ok(S.setSimDistance(6) === 6, `setSimDistance(6) gave ${S.simDistance}, expected 6`);
ok(S.effectiveSimDistance() === 6, `effectiveSimDistance() disagrees with simDistance: ${S.effectiveSimDistance()}`);
S.setRenderDistance(4);                                    // shrink below the chosen sim distance
ok(S.simDistance === 4, `shrinking renderDistance to 4 left simDistance at ${S.simDistance}, expected it pulled down too`);

// ── 2. the shared primitive ────────────────────────────────────────────────────────────────
say('\n2. World.tickingAt — the primitive World.randomTick and EntityList.tick both read');
S.setRenderDistance(10);
S.setSimDistance(4);
W.camCx = 0; W.camCz = 0;
ok(W.tickingAt(0, 0) === true, 'the camera\'s own column is not ticking');
ok(W.tickingAt(4 * 16, 0) === true, 'a column exactly at the sim-distance edge is not ticking');
ok(W.tickingAt(5 * 16, 0) === false, 'a column one chunk past the sim-distance edge IS ticking');
ok(W.tickingAt(9 * 16, 0) === false, 'a column well inside RENDER but outside SIM distance is ticking');

// ── 3. World.randomTick — dispatch, not block rules (those are behavcheck's) ─────────────────
say('\n3. World.randomTick — sections beyond SIM distance never get a dispatch');
{
  const seen = [];
  M.Behave.ready = true;
  M.Behave.randomTickSection = (sx, sy, sz, rnd, speed) => { seen.push(sx + ',' + sz); return 0; };
  // NEAR (cx=2, within sim 4) and FAR (cx=8, inside render 10 but outside sim 4) columns, both
  // fully solid (non-uniform-air) so `W.randomTick` has no reason to skip either one.
  const near = W.getOrCreate(2, 0), far = W.getOrCreate(8, 0);
  near.state = far.state = CH.GENERATED;
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    near.sec[sy] = { u: 1, lu: 0 };
    far.sec[sy] = { u: 1, lu: 0 };
  }
  W.randomTick(Math.random, 1);
  const nearKey = (2 << 4) + ',' + 0, farKey = (8 << 4) + ',' + 0;
  ok(seen.indexOf(nearKey) >= 0, `the NEAR column (cx=2, inside sim 4) got ${seen.filter(k => k === nearKey).length} dispatches, expected ${CFG.SECTIONS_Y}`);
  ok(seen.filter(k => k === nearKey).length === CFG.SECTIONS_Y, 'every section of the near column should be dispatched, not just one');
  ok(seen.indexOf(farKey) < 0, `the FAR column (cx=8, outside sim 4 but inside render 10) got ${seen.filter(k => k === farKey).length} dispatches, expected 0`);

  // uniform AIR sections are a pure perf skip, never a behaviour change: near column, one air
  // section, must not be dispatched even though the column itself is in range.
  seen.length = 0;
  near.sec[5] = { u: 0, lu: 0 };
  W.randomTick(Math.random, 1);
  ok(seen.filter(k => k === nearKey).length === CFG.SECTIONS_Y - 1,
     `the near column's uniform-air section was dispatched anyway (${seen.filter(k => k === nearKey).length} of ${CFG.SECTIONS_Y - 1} expected)`);
}

// ── 4. EntityList.tick — outside SIM distance, an entity does not tick, and is not dropped ───
say('\n4. EntityList.tick — entities beyond SIM distance sit frozen, not removed');
{
  const ticked = [];
  EL.tickOne = (e) => ticked.push(e.id);
  W.camCx = 0; W.camCz = 0;
  S.setRenderDistance(10);
  S.setSimDistance(4);
  EL.list.length = 0;
  EL.list.push({ id: 'near', x: 2 * 16, z: 0, removed: false });   // inside sim (4 chunks)
  EL.list.push({ id: 'far',  x: 8 * 16, z: 0, removed: false });   // outside sim, inside render
  const n = EL.tick();
  ok(ticked.indexOf('near') >= 0, 'the near entity did not tick');
  ok(ticked.indexOf('far') < 0, `the far entity (outside sim, inside render) ticked anyway`);
  ok(n === 1, `EntityList.tick() reports ${n} ticked, expected 1 (the near one only)`);
  ok(EL.list.length === 2, `the far entity was dropped from the list (${EL.list.length} remain), it should only be frozen, not removed`);
}

// ── 5. anti-vacuity — sim == render must restore what was excluded ───────────────────────────
say('\n5. anti-vacuity — sim == render distance must undo §3/§4\'s exclusion');
{
  S.setSimDistance(10);                                     // now equal to renderDistance
  const seen = [];
  M.Behave.randomTickSection = (sx, sy, sz) => { seen.push(sx + ',' + sz); return 0; };
  W.randomTick(Math.random, 1);
  const farKey = (8 << 4) + ',' + 0;
  okAv(seen.indexOf(farKey) >= 0,
       'World.randomTick: sim==render must reach the far column §3 excluded — a gate that always excludes it would pass §3 vacuously');

  const ticked = [];
  EL.tickOne = (e) => ticked.push(e.id);
  EL.list.length = 0;
  EL.list.push({ id: 'far', x: 8 * 16, z: 0, removed: false });
  EL.tick();
  okAv(ticked.indexOf('far') >= 0,
       'EntityList.tick: sim==render must tick the far entity §4 excluded — a gate that always freezes it would pass §4 vacuously');
}

say('\n==============================================================================');
if (fails.length) {
  say(` simdistcheck: ${pass} assertions, ${fails.length} failed`);
  for (const f of fails) say('   x ' + f);
  process.exit(1);
} else {
  say(` simdistcheck: ${pass} assertions, ${breaks} anti-vacuity break(s) caught, 0 failed`);
  say(' simulation distance is a real, separate gate — render distance still decides only what is drawn.');
}
