#!/usr/bin/env node
// gendropcheck.mjs — QUEUE row 0 item 7: worldgen must never drop items during generation.
//
//   node tools/gendropcheck.mjs [--radius N] [--verbose]
//
// Vanilla places world features with ChunkGenerator flag 2 ("no drops"): a feature that cannot
// place a block simply never writes it (or writes air), it never places-then-breaks it through
// the normal block-break code path. This item was opened on the HYPOTHESIS (session 59) that a
// "support pass" during decoration removes a just-placed block through the same code path a
// player's own block-break uses, which spawns an ItemEntity — lag and, per Dan, a class of bug
// this project's own governing rule (mobs/behaviour = full parity, but the ENGINE MECHANISM of
// "how a block stops existing" is shared machinery, not a vanilla number) requires be silent at
// gen time exactly as it is silent in the real game.
//
// ⚠ WHAT THIS FILE FOUND, READ FIRST (also in the D-entry): every gen-time write in `src/04*.js`
// goes through `Features.setBlock` (04j_features.js), which is a REFUSAL gate — `supported()`/
// `featureSurvives()` are checked BEFORE the array write, and an unsupported placement returns 0
// (nothing written) rather than writing and then breaking it. Structures (04r-04x) write through
// the identical `api.setBlock`. Nothing in `src/04*.js` calls `EntityList.popResource`,
// `EntityList.dropStack`, or `Player.collectDrops` — those three names appear ONLY at
// `src/14_player.js:658` (mining) and `src/15g_commands.js:937` (`/setblock destroy`), both
// explicitly player-triggered. The live cascade in `World.setBlock` (`cascadeFrom`, D-155) that
// removes now-unsupported neighbours after a LIVE edit also never drops — it calls
// `W.setBlock(x,y,z,0)` directly, with no drop call anywhere in that path either. So today's
// engine already behaves like flag 2: a gen-time removal is a refusal-to-write, not a
// write-then-break, and there is no code path from worldgen to an item entity at all.
//
// This check exists to (a) prove that claim empirically over a real generated region rather than
// leave it as a read of the source, and (b) stand permanent guard against a regression — a
// future session wiring `collectDrops`/`popResource` into the support cascade or into a
// feature's own refusal branch would reintroduce exactly the lag Dan reported.
//
// Sections:
//   1. generate a real region (features + structures, vanilla climate) and assert ZERO item
//      entities exist afterward — nothing during generation ever called the drop path.
//   2. anti-vacuity — monkeypatch `Features.api.setBlock` to simulate the HYPOTHESISED bug (call
//      the real drop path whenever a placement is refused for lack of support) and confirm this
//      check's own assertion fails against it, proving section 1 is not vacuously green.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const ri = process.argv.indexOf('--radius');
const R = ri >= 0 ? (+process.argv[ri + 1] | 0) : 8;   // 17x17 chunks by default
const SEED = 1337;

let pass = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const check = (label, c) => ok(c, label);
const p = (...a) => { if (VERBOSE) console.log('   ' + a.join(' ')); };

console.log('gendropcheck — QUEUE row 0 item 7: worldgen must never drop items during generation');

function boot() {
  const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js'] });
  const entitiesJson = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8'));
  M.DATA = Object.assign({}, M.DATA, { entities: entitiesJson });
  M.Entities.init();
  M.EntityList.init();
  M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  return M;
}

function genRegion(M, radius) {
  const CFG = M.CFG;
  let chunks = 0;
  for (let cx = -radius; cx <= radius; cx++) {
    for (let cz = -radius; cz <= radius; cz++) {
      M.Gen.genColumn(cx, cz);
      chunks++;
    }
  }
  return chunks;
}

// ── 1. a real region, unpatched engine ─────────────────────────────────────────────────────────
console.log(`\n1. a real ${2 * R + 1}x${2 * R + 1}-chunk region at seed ${SEED} (features + structures on)`);
{
  const M = boot();
  const EL = M.EntityList;
  let drops = 0;
  const origPop = EL.popResource, origDrop = EL.dropStack;
  EL.popResource = function () { drops++; return origPop.apply(EL, arguments); };
  EL.dropStack = function () { drops++; return origDrop.apply(EL, arguments); };

  const t0 = Date.now();
  const chunks = genRegion(M, R);
  p(`generated ${chunks} chunks in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  ok(drops === 0, `${drops} drop-path calls fired during generation of ${chunks} real chunks (expected 0)`);
  ok(EL.count() === 0, `the entity list holds ${EL.count()} entities after pure generation (expected 0)`);
  p(`drop-path calls: ${drops}, entities alive: ${EL.count()}`);
}

// ── 2. anti-vacuity — simulate the hypothesised bug and confirm the check catches it ───────────
console.log('\n2. anti-vacuity — force a gen-time drop and confirm the check fires');
{
  const M = boot();
  const EL = M.EntityList;
  let drops = 0;
  const origPop = EL.popResource, origDrop = EL.dropStack;
  EL.popResource = function () { drops++; return origPop.apply(EL, arguments); };
  EL.dropStack = function () { drops++; return origDrop.apply(EL, arguments); };

  // Simulate exactly the hypothesis this item opened with: a feature/support-pass placement that
  // cannot survive is broken through the PLAYER's own code path (drop an item) instead of being
  // silently refused. `Features.api.setBlock` is the one write-time gate every 04*.js module
  // calls through (F.api, registered at 04j_features.js:1126) — wrapping it here reproduces "the
  // same code path a player's own block-break uses" without touching the shipped source.
  const F = M.Features;
  const origSetBlock = F.api.setBlock;
  let refusals = 0;
  F.api.setBlock = function (SB, cx, cz, x, y, z, st) {
    const before = origSetBlock(SB, cx, cz, x, y, z, st);
    if (before === 0 && st !== 0) {
      refusals++;
      EL.popResource(x, y, z, 1, 1);   // THE BUG: a refused gen-time placement drops an item
    }
    return before;
  };

  const chunks = genRegion(M, R);
  p(`generated ${chunks} chunks with the simulated bug active; ${refusals} refused placements were forced to drop`);
  F.api.setBlock = origSetBlock;   // restore before asserting, so a later section is never polluted

  check('anti-vacuity setup: the region produced real refused placements for the bug to hook', refusals > 0);
  check(`anti-vacuity (drop-path count): the forced bug must produce drop-path calls (got drops=${drops})`, drops > 0);
  check(`anti-vacuity (live entity count): the forced bug must leave live item entities behind (got entities=${EL.count()})`, EL.count() > 0);
  if (drops > 0 && EL.count() > 0) p(`✓ the forced bug produced ${drops} drop-path calls and ${EL.count()} live item entities — BOTH of section 1's assertions would have failed against it`);
}

// ── summary ─────────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} checks passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL: ' + f);
process.exit(fails.length ? 1 : 0);
