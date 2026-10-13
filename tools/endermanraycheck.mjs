#!/usr/bin/env node
// endermanraycheck.mjs — KW-43 (docs/archive/KNOWN-WRONG.md): PickUpBlockGoal's own line-of-sight raycast
// (.decomp/net/minecraft/entity/mob/EndermanEntity.java:462-467) was NOT reproduced -- any
// enderman_holdable block anywhere in the 4x3x4 sweep was picked up regardless of whether
// something solid stood between the enderman and it, which is why the engine picked blocks up
// roughly 2x as often as the real server (endermanrefcheck sec7: 13.3%/4% server vs ~28%/14%
// engine, pick-up by tick 40 / placed by tick 600). This check drives the SAME
// `Em.PickUpBlockGoal` (src/07zg_enderman.js) the engine really runs, with a fixed
// `EntityList.random` sequence that forces its 4x3x4 sweep onto one exact cell every time, and
// asserts the raycast really gates that cell on whether the line to it is clear.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };

console.log('endermanraycheck — KW-43: PickUpBlockGoal line-of-sight raycast');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
          '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
          '07l_spawn.js', '14j_combat.js', '07zg_enderman.js', '07zn2_endermite.js']
});
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Enderman.init();
const EL = M.EntityList, W = M.World, S = M.States, Em = M.Enderman, T = M.Tags;
ok(T && T.ready === true, 'the tag payload (02f_tags.js) decoded — enderman_holdable needs it');

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const dirt = S.stateOf('dirt') | 0;
const stone = S.stateOf('stone') | 0;

// This exact three-roll sequence forces PickUpBlockGoal's sweep onto (bx,by,bz) = (2,64,0)
// for an enderman standing at (0.5,64,0.5): bx = floor(0.5-2+0.9*4) = 2, by = floor(64+0.1*3)
// = 64, bz = floor(0.5-2+0.5*4) = 0 -- worked out from src/07zg_enderman.js's own sweep
// formula, not guessed.
const SEQ = [0.9, 0.1, 0.5];
function tickWithSeq(pickup) {
  let k = 0;
  M.EntityList.random = () => SEQ[k++ % SEQ.length];
  pickup.tick();
  M.EntityList.random = null;
}

// ── blocked: dirt at (2,64,0), a solid stone wall at (1,64,0) directly on the ray between
// the enderman's own column and it -- vanilla's raycast (and this engine's, post-fix) must
// refuse the pickup even though the tag matches.
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);
  W.setBlock(2, 64, 0, dirt);
  W.setBlock(1, 64, 0, stone);   // the obstruction
  const pickup = new Em.PickUpBlockGoal(e);
  tickWithSeq(pickup);
  ok(e.carriedBlock === null, 'KW-43: a holdable block hidden behind a solid wall is NOT picked up');
  ok(W.getBlock(2, 64, 0) === dirt, 'KW-43: the hidden block is left in the world');
}

// ── anti-vacuity: SAME roll sequence, SAME target cell, wall removed -- must now succeed, so
// the assertion above is really about the wall and not some other reason that cell never hits.
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);   // SAME column as the blocked case above
  W.setBlock(2, 64, 0, dirt);
  W.setBlock(1, 64, 0, 0);   // clear the previous test's wall out of this shared world
  const pickup = new Em.PickUpBlockGoal(e);
  tickWithSeq(pickup);
  okAv(e.carriedBlock !== null && S.block[e.carriedBlock] === S.block[dirt],
    'the same roll sequence DOES pick up the same cell once the wall is gone — the block above the wall really is the gate');
}

// ── anti-vacuity #2: SAME clear line of sight as above, but the block is stone (not tagged
// enderman_holdable) -- must still be refused, so the "wall removed" success above is really
// about holdability + line-of-sight together, not a fluke where this cell always succeeds.
{
  const e = EL.spawn('enderman', 0.5, 64, 0.5);   // SAME column, SAME roll sequence, SAME cell
  W.setBlock(2, 64, 0, stone);   // swap the holdable dirt for a non-holdable block
  W.setBlock(1, 64, 0, 0);       // line of sight stays clear
  const pickup = new Em.PickUpBlockGoal(e);
  tickWithSeq(pickup);
  okAv(e.carriedBlock === null, 'a non-holdable block (stone) in plain sight is still never picked up -- the tag gate is real, not just the raycast');
}

console.log(`assertions passed .......... ${pass}`);
console.log(`failures .................... ${fails.length}`);
console.log(`anti-vacuity breaks caught .. ${breaks}`);
if (fails.length) { console.log('\nFAILED:'); for (const f of fails) console.log('  - ' + f); }
process.exit(fails.length ? 1 : 0);
