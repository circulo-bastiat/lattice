#!/usr/bin/env node
// redcheck.mjs — PLAN G15a. The redstone SIGNAL, one circuit at a time.
//
//   node tools/redcheck.mjs [--quiet]
//
// ⚠ WHY CIRCUITS AND NOT UNIT TESTS. Every individual redstone rule is simple enough to look
// right while being wrong in a way that only a built circuit shows: a decay applied to the whole
// max instead of the wire term reads 14 where it should read 15, a wire that does not suppress
// its own signal latches at 15 for ever, and both of those pass any test that asks "does the
// wire have power". So this file BUILDS things — a run, a staircase, an inverter, a NOR — and
// asserts the power at named cells, which is what a player would see.
//
// ⚠ EVERY EXPECTED NUMBER IS DERIVED FROM VANILLA'S OWN RULE, NOT FROM THIS ENGINE. The decay is
// one per wire, so a run fed at 15 reads 15,14,13… and dies on the sixteenth wire; that is
// arithmetic, and if the engine disagrees the engine is wrong. Where a rule is subtler than
// arithmetic the comment names the vanilla method it comes from.
//
// The world here is a plain array with no chunks, no lighting and no renderer, which is the
// point: a circuit is a pure function of the cells around it, so it can be asserted in a
// millisecond and there is no excuse for not asserting twenty of them.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
import { parseRoster } from './stagecheck.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

// ⚠ THE BLOCK-ENTITY STORE IS PART OF THE ENGINE UNDER TEST, not scaffolding. A comparator
// keeps its 0..15 in a `ComparatorBlockEntity`, so a scene without the store would exercise a
// comparator that silently reads 0 — the shape of bug this whole file exists to catch. §8
// asserts the store is actually the one in use rather than assuming it.
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '09b_sky.js'];
// ⚠ `09b_sky.js` IS PASS 15's ADDITION (JOB 2): the daylight detector's arithmetic reads
// `Sky.sunAngle` and `Sky.weather`, and a fixture that never loads Sky exercises neither the day
// side nor the night side of it — every call would silently take the `Sky &&` fallback branch in
// `Redstone.updateDaylightDetector` and "test" a constant instead of a cycle.
// ⚠ `02g_items.js` NEEDS ITS PACKED BLOB. Without it `Inventory.stack('stone', 1)` returns
// EMPTY — silently, because an unknown item name is an empty stack by design — and the chest a
// comparator is supposed to read stays empty while every assertion about it reads a plausible
// 0. §12's chest rig caught that on its first run.
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');

/** A fresh little world, plus the engine bound to it. */
function scene() {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  const N = 64, MID = 32;
  const cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const inside = (x, y, z) => x + MID >= 0 && x + MID < N && y + MID >= 0 && y + MID < N
                           && z + MID >= 0 && z + MID < N;
  const w = {
    get: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
    set: (x, y, z, s) => { if (inside(x, y, z)) cells[idx(x, y, z)] = s; },
  };
  w.getBlock = w.get; w.setBlock = w.set;
  // PASS 15 JOB 2 — a controllable SKY LIGHT for the daylight detector, packed the way
  // `World.getLight` packs it: `(sky << 4) | block`. Defaults to full open sky (15) so every
  // OTHER test in this file, which never calls `setSkyLight`, keeps behaving exactly as before.
  const skyLight = new Map();
  w.getLight = (x, y, z) => { const k = x + ',' + y + ',' + z; return skyLight.has(k) ? skyLight.get(k) << 4 : (15 << 4); };
  const setSkyLight = (x, y, z, v) => skyLight.set(x + ',' + y + ',' + z, v);
  // ⚠ NO `M.Behave.w = w` (D-302). The fixture used to overwrite `Behave`'s world ADAPTER with
  // its own object, so this check exercised an interface the game does not have: `NS.World.get`
  // takes CHUNK coordinates, and `Redstone.init(NS.World)` was reading chunks as block states in
  // every shipped build while every assertion here passed. The fixture now hands its world to
  // `Behave` and everything downstream reads it through the SAME adapter the game uses.
  M.Behave.init(w);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.Redstone.init();
  if (M.Sky && M.Sky.init) M.Sky.init();
  const S = M.States, B = M.Behave, Rs = M.Redstone;
  // ⚠ EVERY PLACEMENT IS REMEMBERED, because one `Rs.update` at one cell is NOT what the game
  // does. In play, each `setBlock` runs `Behave.changed` at that cell, and the redstone update
  // is seeded from a one-block neighbourhood of it — deliberately, since G15a's lesson was to
  // follow what changed rather than to sweep a radius. A fixture that writes twenty cells
  // straight into the array and then pokes one of them leaves the far end of the circuit never
  // looked at; §6b's NOT gate passed for two sessions only because the wall torch was
  // oscillating and happened to be lit on the tick the check read it.
  const placed = [];
  const put = (x, y, z, name) => {
    w.set(x, y, z, typeof name === 'number' ? name : S.stateOf(name));
    placed.push(x, y, z);
  };
  /** what the game does after a build: notify from every cell that was placed, in order. */
  const settle = () => { for (let i = 0; i < placed.length; i += 3) Rs.update(placed[i], placed[i + 1], placed[i + 2]); };
  const power = (x, y, z) => Rs.powerOf(w.get(x, y, z));
  // ⚠ `'true'`, THE STRING. `Behave.propName` returns the registry's VALUE NAME, so a boolean
  // property reads back as `'true'`/`'false'` — and `=== true` is a comparison that can never
  // hold. The engine had the same bug in three places and §3 found it on the first run.
  const lit = (x, y, z) => M.Redstone.boolProp(w.get(x, y, z), 'lit');
  /** Run the scheduled-tick queue for `n` game ticks, routing torches to the redstone module. */
  const runTicks = (n) => {
    const realTick = B.scheduledTick;
    // only the redstone families, so a scheduled fluid or fire tick in a fixture cannot
    // rearrange the circuit under the check's feet
    B.scheduledTick = (x, y, z) => {
      if (Rs.torchTick(x, y, z)) return;
      if (Rs.diodeTick(x, y, z)) return;
      if (Rs.lampTick(x, y, z)) return;
      Rs.observerTick(x, y, z);
    };
    for (let t = 0; t < n; t++) B.tick();
    B.scheduledTick = realTick;
  };
  /**
   * A STRONG input into the block east of (x,y,z) (or `dir`-ward): a powered wall lever.
   * ⚠ A redstone block BESIDE a block does not power that block — it emits weak power only, and a
   * solid block passes on only STRONG power (`World.getEmittedRedstonePower`, .decomp; the real
   * server's redrefcheck `piston_pushes_power`). A torch's input has to be a strong one.
   */
  const lever = (facing) => B.setProp(B.setProp(B.setProp(S.stateOf('lever'), 'face', 'wall'), 'facing', facing || 'west'), 'powered', true);
  /** place a block with a named property set, e.g. `putP(0,0,0,'repeater',{facing:'east'})` */
  const putP = (x, y, z, name, props) => {
    let st = S.stateOf(name);
    for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]);
    w.set(x, y, z, st);
    placed.push(x, y, z);
    return st;
  };
  const prop = (x, y, z, name) => B.propName(w.get(x, y, z), name);
  const on = (x, y, z) => Rs.boolProp(w.get(x, y, z), 'powered');
  return { M, S, B, Rs, w, put, putP, prop, on, power, lit, runTicks, settle, setSkyLight, lever };
}

console.log('redcheck — PLAN G15a the signal, G15b the diodes (D-294, D-295..D-297)');

// ═══════════ 1. what conducts ══════════════════════════════════════════════════════════════
say('\n1. what conducts, and what only looks like it does');
{
  const { S, Rs } = scene();
  // ⚠ CONDUCTING IS NOT SOLIDITY AND NOT OPACITY. Each pair below is two blocks a player would
  // call equally "solid", on opposite sides of the rule.
  // soul_sand is `solidBlock(Blocks::always)`; pistons, glowstone and leaves are not (#337,
  // every state asserted in conductorcheck)
  const CONDUCTS = ['stone', 'dirt', 'oak_planks', 'iron_block', 'obsidian', 'wool', 'soul_sand'];
  const DOES_NOT = ['glass', 'tinted_glass', 'redstone_block', 'observer', 'piston', 'glowstone',
                    'oak_leaves', 'oak_slab', 'oak_stairs', 'oak_fence', 'redstone_wire', 'torch'];
  for (const n of CONDUCTS) {
    const st = S.stateOf(n);
    if (st) ok(Rs.isConductor(st) === true, `${n} conducts`);
  }
  for (const n of DOES_NOT) {
    const st = S.stateOf(n);
    if (st) ok(Rs.isConductor(st) === false, `${n} does NOT conduct`);
  }
  // ⚠ the pair that makes the rule legible: glass and stone are both full collision cubes.
  ok(Rs.isConductor(S.stateOf('stone')) && !Rs.isConductor(S.stateOf('glass')),
     'glass is a full collision cube and still does not conduct — the override list is doing work');
  say(`   ${CONDUCTS.length} conduct, ${DOES_NOT.length} do not`);
}
say(`   ${pass} ok`);

// ═══════════ 2. a straight run, and where it dies ══════════════════════════════════════════
say('\n2. a wire run from a redstone block');
{
  const { Rs, put, power } = scene();
  for (let i = -1; i < 20; i++) put(i, -1, 0, 'stone');
  for (let i = 0; i < 20; i++) put(i, 0, 0, 'redstone_wire');
  put(-1, 0, 0, 'redstone_block');
  Rs.update(-1, 0, 0);
  const got = [];
  for (let i = 0; i < 18; i++) got.push(power(i, 0, 0));
  say('   ' + got.join(','));
  // ⚠ 15 AT THE FIRST WIRE, NOT 14. The decay applies to the WIRE term only:
  // `max(blockSignal, wireMax - 1)`, so a source beside a wire gives it the full 15.
  ok(got[0] === 15, `the wire touching the source reads ${got[0]}, vanilla says 15`);
  for (let i = 1; i <= 15; i++) ok(got[i] === 15 - i, `wire ${i} reads ${got[i]}, expected ${15 - i}`);
  ok(got[15] === 0, 'the sixteenth wire is dark');
  ok(got[16] === 0 && got[17] === 0, 'and so is everything past it');
}
say(`   ${pass} ok`);

// ═══════════ 3. a lever, through a block ═══════════════════════════════════════════════════
say('\n3. a lever, and what STRONG power means');
{
  const { S, B, Rs, put, power, w } = scene();
  // a block with a lever on top, wire running away from the block at the same level
  put(0, 0, 0, 'stone');
  put(0, 1, 0, B.setProp(B.setProp(S.stateOf('lever'), 'face', 'floor'), 'powered', false));
  for (let i = 1; i < 6; i++) { put(i, -1, 0, 'stone'); put(i, 0, 0, 'redstone_wire'); }
  Rs.update(0, 1, 0);
  ok(power(1, 0, 0) === 0, 'a lever that is off powers nothing');
  Rs.setPowered(0, 1, 0, true);
  // ⚠ the lever strongly powers the block it is stuck to, and the block hands that on
  ok(power(1, 0, 0) === 15, `wire beside the lever's block reads ${power(1, 0, 0)}, expected 15`);
  ok(power(5, 0, 0) === 11, `four blocks along reads ${power(5, 0, 0)}, expected 11`);
  Rs.setPowered(0, 1, 0, false);
  ok(power(1, 0, 0) === 0 && power(5, 0, 0) === 0, 'turning it off puts the whole run out');

  // ⚠ AND A WIRE DOES NOT DO THE SAME. Wire strongly powers only the block BELOW it, so a wire
  // running onto a block does not light a second wire on the far side of that block.
  const s2 = scene();
  for (let i = 0; i < 4; i++) { s2.put(i, -1, 0, 'stone'); s2.put(i, 0, 0, 'redstone_wire'); }
  s2.put(-1, 0, 0, 'redstone_block'); s2.put(-1, -1, 0, 'stone');
  s2.put(4, 0, 0, 'stone');              // a block in the way
  s2.put(5, -1, 0, 'stone'); s2.put(5, 0, 0, 'redstone_wire');
  s2.Rs.update(-1, 0, 0);
  ok(s2.power(3, 0, 0) === 12, `the wire reaches the block at ${s2.power(3, 0, 0)}`);
  ok(s2.power(5, 0, 0) === 0,
     `a wire does not push power through a block sideways, got ${s2.power(5, 0, 0)}`);
}
say(`   ${pass} ok`);

// ═══════════ 4. up and down a step ═════════════════════════════════════════════════════════
say('\n4. the asymmetric vertical rules');
{
  // UP: wire climbs the side of a block only if the cell above the LOWER wire is open
  const a = scene();
  for (let i = 0; i < 3; i++) { a.put(i, -1, 0, 'stone'); a.put(i, 0, 0, 'redstone_wire'); }
  a.put(-1, 0, 0, 'redstone_block'); a.put(-1, -1, 0, 'stone');
  a.put(3, -1, 0, 'stone'); a.put(3, 0, 0, 'stone');          // the step
  a.put(3, 1, 0, 'redstone_wire');                            // wire on top of the step
  a.Rs.update(-1, 0, 0);
  ok(a.power(2, 0, 0) === 13, `the wire below the step reads ${a.power(2, 0, 0)}`);
  ok(a.power(3, 1, 0) === 12, `the wire ON the step reads ${a.power(3, 1, 0)}, expected 12 — it climbed`);

  // ⚠ and the same staircase with a ROOF over the lower wire: it must NOT climb
  const b = scene();
  for (let i = 0; i < 3; i++) { b.put(i, -1, 0, 'stone'); b.put(i, 0, 0, 'redstone_wire'); }
  b.put(-1, 0, 0, 'redstone_block'); b.put(-1, -1, 0, 'stone');
  b.put(3, -1, 0, 'stone'); b.put(3, 0, 0, 'stone');
  b.put(3, 1, 0, 'redstone_wire');
  b.put(2, 1, 0, 'stone');                                     // the roof over wire 2
  b.Rs.update(-1, 0, 0);
  ok(b.power(2, 0, 0) === 13, 'the lower run is unaffected by the roof');
  ok(b.power(3, 1, 0) === 0,
     `a roofed wire must not climb the step, got ${b.power(3, 1, 0)}`);

  // DOWN: a wire steps down beside a non-conductor, and not beside a conductor
  const c = scene();
  c.put(0, 0, 0, 'stone'); c.put(0, 1, 0, 'redstone_block');
  c.put(1, 0, 0, 'stone'); c.put(1, 1, 0, 'redstone_wire');
  c.put(2, 1, 0, 'oak_fence');                                  // NOT a conductor
  c.put(2, 0, 0, 'stone'); c.put(2, -1, 0, 'stone');
  // hmm: the wire below must sit beside the fence's cell
  c.put(2, 0, 0, 0);                                            // clear it so the drop is open
  c.put(3, -1, 0, 'stone'); c.put(3, 0, 0, 'redstone_wire');
  c.Rs.update(0, 1, 0);
  ok(c.power(1, 1, 0) === 15, `the fed wire reads ${c.power(1, 1, 0)}`);
}
say(`   ${pass} ok`);

// ═══════════ 5. the torch: an inverter, to the tick ════════════════════════════════════════
say('\n5. the torch inverts, two ticks late');
{
  const { S, B, Rs, put, power, lit, runTicks, w, lever } = scene();
  // stone block with a torch on top; wire feeding the block from the side
  put(0, 0, 0, 'stone');
  put(0, 1, 0, 'redstone_torch');
  for (let i = 1; i < 5; i++) { put(i, -1, 0, 'stone'); put(i, 0, 0, 'redstone_wire'); }
  // and the torch's own output run
  for (let i = 1; i < 4; i++) { put(i, 1, 0, 'redstone_wire'); put(i, 0, 0, 'stone'); }
  Rs.update(0, 1, 0);
  ok(lit(0, 1, 0) === true, 'a torch with no input is LIT');
  ok(power(1, 1, 0) === 15, `and it feeds its wire 15, got ${power(1, 1, 0)}`);

  // now power the block the torch stands on
  put(0, -1, 0, 'stone');
  put(0, 0, 0, 'stone');
  put(-1, -1, 0, 'stone'); put(-1, 0, 0, lever());
  Rs.update(-1, 0, 0);
  ok(lit(0, 1, 0) === true, 'the torch has not flipped YET — the flip is scheduled, not instant');
  runTicks(1);
  ok(lit(0, 1, 0) === true, 'still lit one tick later');
  runTicks(1);
  ok(lit(0, 1, 0) === false, `and OUT on the second tick — Rs.TORCH_DELAY is ${Rs.TORCH_DELAY}`);
  ok(power(1, 1, 0) === 0, `its output run went dark, got ${power(1, 1, 0)}`);
}
say(`   ${pass} ok`);

// ═══════════ 5b. torch BURNOUT: the clock that stops ═══════════════════════════════════════
say('\n5b. a torch driven too often burns out (D-354)');
{
  const { Rs, put, lit, runTicks, w, S, B, lever } = scene();
  Rs.clearToggles();
  // a torch on a block, and a redstone block that can be put in and out of the cell feeding it
  put(0, -1, 0, 'stone');
  put(0, 0, 0, 'stone');
  put(0, 1, 0, 'redstone_torch');
  put(-1, -1, 0, 'stone');
  Rs.update(0, 1, 0);
  ok(lit(0, 1, 0) === true, 'the torch starts lit');

  /** drive its input one way, then run the two ticks the flip takes plus a little */
  const drive = (on) => {
    put(-1, 0, 0, on ? lever() : 0);
    Rs.update(-1, 0, 0);
    runTicks(3);
  };

  // ⚠ SEVEN OFF-EDGES IS UNDER THE BUDGET AND THE EIGHTH IS NOT. Vanilla logs a toggle when the
  // torch goes OUT and counts without logging when it tries to come back, so the budget is spent
  // by the OFF edges alone — which is why this loop counts them rather than counting flips.
  let offs = 0;
  for (let i = 0; i < Rs.BURNOUT_TOGGLES - 1; i++) {
    drive(true);
    if (lit(0, 1, 0) === false) offs++;
    drive(false);
  }
  ok(offs === Rs.BURNOUT_TOGGLES - 1,
     `it went out on each of the first ${Rs.BURNOUT_TOGGLES - 1} presses (${offs})`);
  ok(lit(0, 1, 0) === true, 'and came back on after each of them');

  // the eighth off-edge spends the budget
  drive(true);
  ok(lit(0, 1, 0) === false, 'the eighth press puts it out, as every press does');
  drive(false);
  // ⚠⚠ **THIS IS THE WHOLE BEHAVIOUR.** Vanilla would relight here and does not: the position has
  // had eight toggles inside sixty ticks, so the torch stays dark with NO input at all — which is
  // a state nothing else in this engine can produce and the thing a burnt-out torch looks like.
  ok(lit(0, 1, 0) === false,
     'and it does NOT come back on with its input removed — it has burned out');

  // ── and it recovers once the window has passed ─────────────────────────────────────────
  // ⚠ THE RECOVERY IS THE OTHER HALF. A torch that never relit would pass the line above and be
  // a worse bug than no burnout at all, and this is the direction a one-sided check misses.
  // ⚠ NO Rs.update KICK: vanilla's 160-tick retick (createAndScheduleBlockTick) does it alone.
  ok(Rs.burnoutEvents.length === 3 && Rs.burnoutEvents[0] === 0 && Rs.burnoutEvents[1] === 1,
     'the burnout edge emitted world event 1502 once, at the torch');
  runTicks(Rs.BURNOUT_RETICK + 4);
  ok(lit(0, 1, 0) === true,
     `and after ${Rs.BURNOUT_WINDOW} ticks the window clears and it lights again`);

  // ── the list is per LEVEL and the count is per POSITION ────────────────────────────────
  // ⚠ A HUNDRED TORCHES TOGGLING ELSEWHERE MUST NOT BURN THIS ONE OUT. The list is shared, so a
  // count that forgot to compare positions would pass every assertion above and burn out the
  // whole world at once.
  Rs.clearToggles();
  for (let i = 0; i < Rs.BURNOUT_TOGGLES * 3; i++) Rs.tooFrequent(50 + i, 5, 5, true);
  ok(Rs.tooFrequent(0, 1, 0, false) === false,
     `${Rs.BURNOUT_TOGGLES * 3} toggles at OTHER positions do not burn this one out`);
  for (let i = 0; i < Rs.BURNOUT_TOGGLES; i++) Rs.tooFrequent(0, 1, 0, true);
  ok(Rs.tooFrequent(0, 1, 0, false) === true, 'and its own eight do');
  void w; void S; void B;
}
say(`   ${pass} ok`);

// ═══════════ 6. a lamp, and what lights it ═════════════════════════════════════════════════
say('\n6. the lamp');
{
  const { Rs, put, lit, runTicks } = scene();
  put(0, 0, 0, 'redstone_lamp');
  put(1, -1, 0, 'stone'); put(1, 0, 0, 'redstone_wire');
  put(2, -1, 0, 'stone'); put(2, 0, 0, 'redstone_wire');
  put(3, -1, 0, 'stone'); put(3, 0, 0, 'redstone_block');
  Rs.update(3, 0, 0);
  ok(lit(0, 0, 0) === true, 'a lamp beside a powered wire is lit');
  put(3, 0, 0, 0);
  Rs.update(3, 0, 0);
  ok(lit(0, 0, 0) === true, 'still lit the moment the source goes — the turn-off is scheduled 4 ticks out');
  runTicks(3);
  ok(lit(0, 0, 0) === true, '...and still lit 3 ticks later');
  runTicks(1);
  ok(lit(0, 0, 0) === false, 'and goes out on the fourth tick (`RedstoneLampBlock`, redrefcheck lamp_*)');

  // ⚠ A LAMP AT THE FAR END OF A FULL RUN IS STILL LIT: any power above zero lights it, and the
  // asymmetry between "lit" (>0) and "signal strength" is where a comparator-based clone breaks.
  const b = scene();
  for (let i = 0; i < 16; i++) { b.put(i, -1, 0, 'stone'); b.put(i, 0, 0, 'redstone_wire'); }
  b.put(-1, -1, 0, 'stone'); b.put(-1, 0, 0, 'redstone_block');
  b.put(16, 0, 0, 'redstone_lamp');
  b.Rs.update(-1, 0, 0);
  ok(b.power(14, 0, 0) === 1, `the last live wire reads ${b.power(14, 0, 0)}`);
  ok(b.power(15, 0, 0) === 0, 'and the sixteenth is dark');
  ok(b.lit(16, 0, 0) === false, 'so the lamp past the end does NOT light');
}
say(`   ${pass} ok`);

// ═══════════ 6b. gates: the circuits a player would actually build ═════════════════════════
say('\n6b. gates');
{
  // ── a NOT gate: wire in, block, torch on the side, wire out ─────────────────────────────
  const notGate = (input) => {
    const s = scene();
    s.put(0, -1, 0, 'stone'); s.put(0, 0, 0, 'stone');            // the gate's block
    // the torch hangs on the block's east face, so it powers the wire to its east
    const wt = s.B.setProp(s.S.stateOf('redstone_wall_torch'), 'facing', 'east');
    s.put(1, 0, 0, wt);
    s.put(2, -1, 0, 'stone'); s.put(2, 0, 0, 'redstone_wire');    // the output
    if (input) { s.put(-1, -1, 0, 'stone'); s.put(-1, 0, 0, s.lever()); }
    s.settle();
    s.runTicks(4);
    return { out: s.power(2, 0, 0), lit: s.lit(1, 0, 0) };
  };
  const off = notGate(false), on = notGate(true);
  ok(off.lit === true && off.out > 0, `NOT(0) = 1 — torch lit, output ${off.out}`);
  ok(on.lit === false && on.out === 0, `NOT(1) = 0 — torch out, output ${on.out}`);
  ok(off.out === 15, `and the output is a full 15, got ${off.out}`);

  // ── a NOR gate: two inputs into one block, one torch ─────────────────────────────────────
  const nor = (a, b) => {
    const s = scene();
    s.put(0, -1, 0, 'stone'); s.put(0, 0, 0, 'stone');
    const wt = s.B.setProp(s.S.stateOf('redstone_wall_torch'), 'facing', 'east');
    s.put(1, 0, 0, wt);
    s.put(2, -1, 0, 'stone'); s.put(2, 0, 0, 'redstone_wire');
    if (a) { s.put(-1, -1, 0, 'stone'); s.put(-1, 0, 0, s.lever('west')); }
    if (b) { s.put(0, -1, 1, 'stone'); s.put(0, 0, 1, s.lever('south')); }
    s.settle();
    s.runTicks(4);
    return s.power(2, 0, 0) > 0 ? 1 : 0;
  };
  ok(nor(0, 0) === 1, 'NOR(0,0) = 1');
  ok(nor(1, 0) === 0, 'NOR(1,0) = 0');
  ok(nor(0, 1) === 0, 'NOR(0,1) = 0');
  ok(nor(1, 1) === 0, 'NOR(1,1) = 0');
  say('   NOR truth table: 1 0 0 0');

  // ── OR: two runs meeting, and the stronger one wins ─────────────────────────────────────
  {
    const s = scene();
    for (let i = 0; i < 9; i++) { s.put(i, -1, 0, 'stone'); s.put(i, 0, 0, 'redstone_wire'); }
    s.put(-1, -1, 0, 'stone'); s.put(-1, 0, 0, 'redstone_block');   // feeds from the west
    s.put(4, -1, 1, 'stone'); s.put(4, 0, 1, 'redstone_block');      // and a second, in the middle
    s.Rs.update(-1, 0, 0);
    s.Rs.update(4, 0, 1);
    // ⚠ THE MAX WINS, IT DOES NOT ADD. Two sources into one wire give 15, never 30 and never 16.
    ok(s.power(4, 0, 0) === 15, `the wire beside both sources reads ${s.power(4, 0, 0)}, expected 15`);
    ok(s.power(8, 0, 0) === 11, `four past the second source reads ${s.power(8, 0, 0)}, expected 11`);
    ok(s.power(1, 0, 0) === 14, 'and the first run is unchanged by the second source');
  }

  // ── a T junction: power splits without weakening the split ───────────────────────────────
  {
    const s = scene();
    for (let i = 0; i < 5; i++) { s.put(i, -1, 0, 'stone'); s.put(i, 0, 0, 'redstone_wire'); }
    for (let k = 1; k < 5; k++) { s.put(2, -1, k, 'stone'); s.put(2, 0, k, 'redstone_wire'); }
    s.put(-1, -1, 0, 'stone'); s.put(-1, 0, 0, 'redstone_block');
    s.Rs.update(-1, 0, 0);
    ok(s.power(2, 0, 0) === 13, `the junction reads ${s.power(2, 0, 0)}`);
    ok(s.power(4, 0, 0) === 11, 'the straight arm continues to 11');
    ok(s.power(2, 0, 2) === 11, 'and the branch reaches the same 11 — a split costs nothing');
  }

  // ── a redstone block powers all six of its neighbours ────────────────────────────────────
  {
    const s = scene();
    s.put(0, 0, 0, 'redstone_block');
    const around = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
    // ⚠ the floor under the TOP wire is the redstone block itself — this loop's first version
    // laid stone under every one of them and quietly replaced the source with stone, which is
    // why both assertions failed. A fixture that destroys its own subject fails honestly; one
    // that half-destroys it is how a check ends up testing nothing.
    for (const [dx, dy, dz] of around) {
      if (!(dx === 0 && dz === 0)) s.put(dx, dy - 1, dz, 'stone');
      s.put(dx, dy, dz, 'redstone_wire');
    }
    s.put(0, -1, 0, 'redstone_wire'); s.put(0, -2, 0, 'stone');
    ok(s.S.name(s.w.get(0, 0, 0)) === 'redstone_block', 'the source survived the fixture');
    s.Rs.update(0, 0, 0);
    let allFull = true;
    for (const [dx, dy, dz] of around) if (s.power(dx, dy, dz) !== 15) allFull = false;
    ok(allFull, 'a redstone block gives all its side and top neighbours 15');
    ok(s.power(0, -1, 0) === 15, 'and the one underneath it too');
  }

  // ── a torch does NOT power the block it stands on ────────────────────────────────────────
  {
    const s = scene();
    s.put(0, 0, 0, 'stone');
    s.put(0, 1, 0, 'redstone_torch');
    s.put(1, -1, 0, 'stone'); s.put(1, 0, 0, 'redstone_wire');   // wire beside the torch's block
    s.put(1, 1, 0, 'redstone_wire'); s.put(1, 0, 0, 'stone');    // and wire beside the torch itself
    s.Rs.update(0, 1, 0);
    ok(s.power(1, 1, 0) === 15, `wire beside the torch reads ${s.power(1, 1, 0)}`);
    const b = scene();
    b.put(0, 0, 0, 'stone');
    b.put(0, 1, 0, 'redstone_torch');
    b.put(1, -1, 0, 'stone'); b.put(1, 0, 0, 'redstone_wire');
    b.Rs.update(0, 1, 0);
    // ⚠ the torch's block is NOT powered by it, so the wire beside that block stays dark
    ok(b.power(1, 0, 0) === 0,
       `a torch does not power the block it stands on, so the wire beside it reads ${b.power(1, 0, 0)}`);
  }

  // ── vertical transmission: a torch tower ────────────────────────────────────────────────
  {
    const s = scene();
    // block, torch on top, block on the torch? no — the classic tower is block/torch alternating
    s.put(0, 0, 0, 'stone');
    s.put(0, 1, 0, 'redstone_torch');
    s.put(0, 2, 0, 'stone');
    s.put(1, 2, 0, 'redstone_wire'); s.put(1, 1, 0, 'stone');
    s.Rs.update(0, 1, 0);
    s.runTicks(4);
    // the torch strongly powers the block above it, and that block hands it to the wire
    ok(s.power(1, 2, 0) === 15,
       `a torch strongly powers the block above, lighting wire on it: ${s.power(1, 2, 0)}`);
  }
}
say(`   ${pass} ok`);

// ═══════════ 8. the two golden tables, and whether the engine agrees with them ═════════════
say('\n8. the closed sets: what emits redstone, and what a comparator can read');
{
  const { M, S, Rs } = scene();
  const read = (f) => readFileSync(join(ROOT, 'tools', 'golden', f), 'utf8')
    .split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
  const GOLD_SRC = read('signal-sources-1.18.2.tsv').map((r) => r[0]);
  const GOLD_ANA = read('analog-output-1.18.2.tsv');

  // ⚠ BOTH DIRECTIONS. A list that is a SUBSET of the golden one passes every "is X a source"
  // test ever written; the assertion that catches a missing row is the reverse one.
  ok(GOLD_SRC.length === 38, `the jar names ${GOLD_SRC.length} signal sources`);
  const MINE = Rs.SIGNAL_SOURCES;
  for (const n of GOLD_SRC) ok(MINE.includes(n), `${n} is in the engine's SIGNAL_SOURCES`);
  for (const n of MINE) ok(GOLD_SRC.includes(n), `${n} is in the jar's list and not invented`);
  ok(MINE.length === GOLD_SRC.length, `${MINE.length} engine rows vs ${GOLD_SRC.length} golden rows`);

  // and the RULE, not just the list: the seven families G15a wrongly called sources
  for (const n of ['oak_door', 'note_block', 'oak_trapdoor', 'oak_fence_gate', 'bell',
                   'powered_rail', 'tripwire', 'redstone_lamp']) {
    const st = S.stateOf(n);
    if (st) ok(Rs.isSignalSource(st) === false, `${n} is NOT a source (it has a 'powered' property)`);
  }
  for (const n of ['lever', 'redstone_wire', 'redstone_block', 'repeater', 'comparator']) {
    ok(Rs.isSignalSource(S.stateOf(n)) === true, `${n} IS a source`);
  }

  // ⚠ THE ANALOG SET MUST BE CLOSED: every row of the golden table is either implemented here
  // or on the engine's own OWED list. A block that quietly reads 0 is D-290's failure again.
  let impl = 0, owed = 0, missing = [];
  for (const [name] of GOLD_ANA) {
    const st = S.stateOf(name);
    if (!st) continue;                       // not in this engine's registry at all
    if (!Rs.hasAnalogOutput(st)) { missing.push(name); continue; }
    if (Rs.analogKindOf(st) === Rs.ANALOG_OWED) owed++; else impl++;
  }
  ok(missing.length === 0, `every analog block is accounted for (missing: ${missing.join(' ')})`);
  ok(impl >= 50, `${impl} analog blocks implemented`);
  ok(owed === 0, `${owed} analog blocks named as OWED — none (jukebox and lectern are built)`);
  // the reverse: nothing the engine calls analog is absent from the jar's table
  const GOLD_SET = new Set(GOLD_ANA.map((r) => r[0]));
  let invented = 0;
  for (let st = 1; st < S.count; st++) {
    if (!Rs.hasAnalogOutput(st)) continue;
    const nm = M.Reg.blockNames ? M.Reg.blockNames[S.block[st]] : null;
    if (nm && !GOLD_SET.has(nm)) invented++;
  }
  ok(invented === 0, `${invented} blocks the engine calls analog that the jar does not`);
  // ⚠ AND THE SOURCE SET IS CLOSED, THE SAME WAY THE ANALOG SET IS. Every source is either
  // answered by a branch in `Rs.signal` or on the named OWED list with the stage it waits for.
  {
    const owed = Object.keys(Rs.OWED_SOURCES);
    let live = 0, silent = [];
    for (const n of GOLD_SRC) {
      if (owed.includes(n)) continue;
      // ⚠ THE COMPARATOR IS THE ONE SOURCE THIS QUESTION CANNOT ASK. Its strength is not in its
      // block state at all — it is in a `ComparatorBlockEntity` — so a state driven to
      // `powered` still answers 0 here, correctly. §12 asserts it where it lives.
      if (n === 'comparator') continue;
      // ⚠ D-432 — AND SO IS THE TRAPPED CHEST, for exactly the same reason. `clg.a` is
      // `clamp(ChestBlockEntity.getOpenCount(level, pos), 0, 15)`: its strength is an OPENER
      // COUNT on a block entity, not anything in its block state, so a state driven to
      // `powered` answers 0 here and is right to. §17 asserts it where it lives.
      if (n === 'trapped_chest') continue;
      const st = S.stateOf(n);
      if (!st) continue;
      // drive it to its powered form where it has one, then ask for a signal in some direction
      let p = st;
      for (const [k, v] of [['powered', true], ['lit', true], ['power', 15]]) {
        const cur = M.Behave.propName(st, k);
        if (cur !== null && cur !== undefined) p = M.Behave.setProp(p, k, v);
      }
      let any = 0;
      for (let d = 0; d < 6; d++) any = Math.max(any, Rs.signal(p, d, 0, 0, 0));
      if (any > 0) live++; else silent.push(n);
    }
    ok(silent.length === 0, `every non-owed source emits something (silent: ${silent.join(' ')})`);
    ok(live === GOLD_SRC.length - owed.length - 2,
       `${live} sources are live, ${owed.length} are named as owed, and the comparator (§12) and the trapped chest (§17) are asserted where their strength actually lives`);
    for (const n of owed) ok(GOLD_SRC.includes(n), `the owed source ${n} is a real source in the jar`);
  }
  // a pressure plate strongly powers the block BENEATH it and nothing else
  {
    const plate = M.Behave.setProp(S.stateOf('stone_pressure_plate'), 'powered', true);
    ok(Rs.directSignal(plate, Rs.UP, 0, 0, 0) === 15, 'a plate strongly powers the block below it');
    for (const d of [0, 2, 3, 4, 5]) {
      ok(Rs.directSignal(plate, d, 0, 0, 0) === 0, `...and gives no STRONG power in direction ${d}`);
    }
    ok(Rs.signal(plate, 3, 0, 0, 0) === 15, '...while its WEAK power goes in every direction');
  }
  // ⚠ AND IT IS READING THE WORLD THROUGH `Behave`'s ADAPTER, which is the question no check
  // asked until a browser stage found every circuit dead in the game (D-302).
  ok(Rs.worldIsBehaveAdapter() === true,
     'the redstone module reads the world through `Behave.w`, the same object the game gives it');
  ok(Rs.comparatorStore === 'blockentity',
     `a comparator's output is stored in the block-entity store, not nowhere (got ${Rs.comparatorStore})`);
  say(`   ${GOLD_SRC.length} sources · ${impl} analog implemented · ${owed} owed`);
}
say(`   ${pass} ok`);

// ═══════════ 9. what a wire actually powers ════════════════════════════════════════════════
say('\n9. the end of a run, and the two rules G15a had backwards');
{
  // ⚠ THE BUG THIS SECTION EXISTS FOR. `RedStoneWireBlock.getSignal` asks whether the wire is
  // connected in `direction.getOpposite()` — the side FACING THE ASKER — and it asks the
  // COMPLETED connection state, in which an axis with nothing on it grows both its sides back.
  // G15a had `direction` and the raw sides, and its twenty circuits could not see either,
  // because a straight run is wire at both ends and symmetric in both respects.
  const s = scene();
  for (let i = -1; i <= 5; i++) s.put(i, -1, 0, 'stone');
  s.put(-1, 0, 0, 'redstone_block');
  for (let i = 0; i <= 3; i++) s.put(i, 0, 0, 'redstone_wire');
  s.put(4, 0, 0, 'redstone_lamp');
  s.Rs.update(-1, 0, 0);
  ok(s.power(3, 0, 0) === 12, `the last wire reads ${s.power(3, 0, 0)}, expected 12`);
  ok(s.lit(4, 0, 0) === true, 'a run of dust ENDING at a lamp lights it — the axis-completion rule');
  // and the lamp is not a connection: the wire did not connect to it, it grew its own line
  ok(s.Rs.connectsToRedstone(s.S.stateOf('redstone_lamp'), 5) === false,
     'dust does NOT "connect to" a lamp — vanilla says a lamp is not a signal source');

  // an L bend: dust turns north at x=3, so its SOUTH side is the only one left empty by the
  // completion rule, and a lamp to the EAST of the bend gets nothing.
  const t = scene();
  for (let i = -1; i <= 5; i++) for (let k = -2; k <= 2; k++) t.put(i, -1, k, 'stone');
  t.put(-1, 0, 0, 'redstone_block');
  for (let i = 0; i <= 3; i++) t.put(i, 0, 0, 'redstone_wire');
  t.put(3, 0, -1, 'redstone_wire');            // the bend, heading north
  t.put(4, 0, 0, 'redstone_lamp');             // straight on past the bend
  t.Rs.update(-1, 0, 0);
  ok(t.power(3, 0, 0) === 12, `the corner wire reads ${t.power(3, 0, 0)}`);
  ok(t.power(3, 0, -1) === 11, `the wire after the bend reads ${t.power(3, 0, -1)}`);
  ok(t.lit(4, 0, 0) === false,
     'a lamp straight on past a BEND stays dark — the corner has a west and a north side, so no axis is empty');

  // a lone dot: nothing raw, so `getConnectionState` returns early and it powers nothing sideways
  const u = scene();
  u.put(0, -1, 0, 'stone'); u.put(0, 0, 0, 'redstone_wire');
  u.put(1, -1, 0, 'stone'); u.put(1, 0, 0, 'redstone_lamp');
  u.put(0, 1, 0, 'lever');                      // a lever on top, face=floor, powers downward
  u.Rs.setPowered(0, 1, 0, true);
  ok(u.power(0, 0, 0) === 15, `the dot under the lever reads ${u.power(0, 0, 0)}`);
  ok(u.lit(1, 0, 0) === false,
     'a lone dust DOT does not power the block beside it — `getConnectionState` returns early for a dot');
}
say(`   ${pass} ok`);

// ═══════════ 9b. climbing onto glass and hoppers (#340) ════════════════════════════════════
say('\n9b. the up-connection is `canRunOnTop`, not the conductor test (#340)');
{
  // `RedstoneWireBlock.getRenderConnectionType` connects UP when the side block `canRunOnTop`
  // (`isSideSolidFullSquare(UP) || isOf(HOPPER)`) — glass, glowstone and a hopper all count, none
  // conducts. The lower wire L then connects N + E(up), so axis completion leaves SOUTH empty and
  // the lamp south of L stays dark. The conductor test gave L no east side: N+S, lamp lit.
  const N = 1 << 2, S_ = 1 << 3, E = 1 << 5;
  const rig = (sideBlock, patch) => {
    const s = scene();
    if (patch) patch(s.Rs);
    for (let x = -1; x <= 1; x++) for (let z = -2; z <= 1; z++) s.put(x, -1, z, 'stone');
    s.put(0, 0, -2, 'redstone_block');
    s.put(0, 0, -1, 'redstone_wire');
    s.put(0, 0, 0, 'redstone_wire');                 // L
    s.put(1, 0, 0, sideBlock);
    s.put(1, 1, 0, 'redstone_wire');                 // dust on top of the side block
    s.put(0, 0, 1, 'redstone_lamp');
    s.settle();
    return { sides: s.Rs.wireSides(0, 0, 0), lamp: s.lit(0, 0, 1), up: s.power(1, 1, 0), L: s.power(0, 0, 0) };
  };
  for (const blk of ['glass', 'hopper', 'glowstone', 'stone']) {
    const r = rig(blk);
    ok(r.sides === (N | E), `${blk}: L's sides are N+E(up) (mask ${r.sides}, expected ${N | E})`);
    ok(r.lamp === false, `${blk}: the lamp south of L stays OFF — south is NONE`);
    ok(r.L === 14, `${blk}: L reads ${r.L}, expected 14`);
  }
  // power still climbs: the upper wire's own DOWN rule reaches L past a non-conductor ...
  const g = rig('glass');
  ok(g.up === 13, `glass: the wire on top reads ${g.up}, expected 13 — power climbs the glass`);
  // ... and does not come down: the power rule's up-step is the conductor test (isSolidBlock)
  {
    const s = scene();
    for (let x = -1; x <= 2; x++) s.put(x, -1, 0, 'stone');
    s.put(0, 0, 0, 'redstone_wire');                 // L
    s.put(1, 0, 0, 'glass');
    s.put(1, 1, 0, 'redstone_wire');
    s.put(2, 1, 0, 'redstone_block');
    s.settle();
    ok(s.power(1, 1, 0) === 15, `the wire on the glass reads ${s.power(1, 1, 0)}, expected 15`);
    ok(s.power(0, 0, 0) === 0,
       `power does NOT come down a glass step, L reads ${s.power(0, 0, 0)} — the connection is drawn, the power rule refuses`);
    ok((s.Rs.wireSides(0, 0, 0) & E) !== 0, 'yet L still CONNECTS east, up onto the glass');
  }
  const Sx = scene();
  ok(Sx.Rs.canRunOnTop(Sx.putP(5, 5, 5, 'oak_slab', { type: 'top' })) &&
     !Sx.Rs.canRunOnTop(Sx.putP(6, 5, 5, 'oak_slab', { type: 'bottom' })),
     'a top slab can carry dust and a bottom slab cannot — a sturdy full UP face');
  // ⚠ anti-vacuity: put the conductor test back and the glass/hopper circuits must go wrong
  for (const blk of ['glass', 'hopper']) {
    const b = rig(blk, (R) => { R.canRunOnTop = R.isConductor; });
    okAv(b.sides === (N | S_) && b.lamp === true,
      `with the conductor test in place of canRunOnTop, ${blk}'s L goes N+S (${b.sides}) and lights the lamp — the #340 bug, caught`);
  }
}
say(`   ${pass} ok`);

// ═══════════ 10. the repeater ══════════════════════════════════════════════════════════════
say('\n10. the repeater: a diode, a booster and a delay');
{
  // ⚠ FACING POINTS AT THE INPUT. A repeater at x=3 with facing 'west' reads x=2 and writes
  // x=4. Getting this backwards gives a circuit that is alive and runs the wrong way.
  const mk = (delay) => {
    const s = scene();
    for (let i = -1; i <= 10; i++) s.put(i, -1, 0, 'stone');
    s.put(-1, 0, 0, 'redstone_block');
    for (const i of [0, 1, 2]) s.put(i, 0, 0, 'redstone_wire');
    s.putP(3, 0, 0, 'repeater', { facing: 'west', delay: String(delay) });
    for (const i of [4, 5, 6]) s.put(i, 0, 0, 'redstone_wire');
    s.Rs.update(-1, 0, 0);
    return s;
  };
  const r = mk(1);
  ok(r.power(2, 0, 0) === 13, `the wire into the repeater reads ${r.power(2, 0, 0)}`);
  ok(r.on(3, 0, 0) === false, 'the repeater has NOT turned on in the same tick — it scheduled');
  r.runTicks(1);
  ok(r.on(3, 0, 0) === false, 'nor one tick later: delay 1 is TWO game ticks');
  r.runTicks(1);
  ok(r.on(3, 0, 0) === true, 'on at game tick 2');
  ok(r.power(4, 0, 0) === 15, `the wire out of the repeater reads ${r.power(4, 0, 0)}, expected a full 15`);
  ok(r.power(5, 0, 0) === 14 && r.power(6, 0, 0) === 13, 'and decays normally after it');

  // the delay setting, in game ticks: 2, 4, 6, 8
  for (const d of [1, 2, 3, 4]) {
    const s = mk(d);
    s.runTicks(2 * d - 1);
    const early = s.on(3, 0, 0);
    s.runTicks(1);
    const late = s.on(3, 0, 0);
    ok(early === false && late === true, `delay ${d} fires on game tick ${2 * d} and not before`);
  }

  // ⚠ A DIODE: nothing gets back through it. A source on the OUTPUT side must not reach the
  // input side, which is the whole point of the block.
  const b = scene();
  for (let i = -1; i <= 8; i++) b.put(i, -1, 0, 'stone');
  for (const i of [0, 1]) b.put(i, 0, 0, 'redstone_wire');
  b.putP(2, 0, 0, 'repeater', { facing: 'west' });
  for (const i of [3, 4]) b.put(i, 0, 0, 'redstone_wire');
  b.put(5, 0, 0, 'redstone_block');
  b.Rs.update(5, 0, 0);
  b.runTicks(4);
  ok(b.power(4, 0, 0) === 15 && b.power(3, 0, 0) === 14, 'the far side of the repeater is powered');
  ok(b.power(1, 0, 0) === 0 && b.power(0, 0, 0) === 0,
     'and NOTHING got back through the repeater — it is a diode');

  // ⚠ A BOOSTER: a repeater restores 15, which is what lets a line run further than fifteen.
  const c = scene();
  for (let i = -1; i <= 40; i++) c.put(i, -1, 0, 'stone');
  c.put(-1, 0, 0, 'redstone_block');
  for (let i = 0; i <= 34; i++) if (i !== 14) c.put(i, 0, 0, 'redstone_wire');
  c.putP(14, 0, 0, 'repeater', { facing: 'west' });
  c.Rs.update(-1, 0, 0);
  c.runTicks(4);
  ok(c.power(13, 0, 0) === 2, `the wire into the repeater reads ${c.power(13, 0, 0)}`);
  ok(c.power(15, 0, 0) === 15, `the wire out of it is back to ${c.power(15, 0, 0)}`);
  ok(c.power(29, 0, 0) === 1 && c.power(30, 0, 0) === 0,
     'and the line reaches thirty blocks, which fifteen of wire alone cannot');

  // ⚠ THE PULSE EXTENDER. `DiodeBlock.tick`'s "turn on, and if the input has already gone,
  // schedule the turn-OFF for `delay` ticks later" branch. Without it a repeater swallows a
  // pulse shorter than its delay; with it, a one-tick pulse comes out `delay` ticks long.
  const p = scene();
  for (let i = -1; i <= 8; i++) p.put(i, -1, 0, 'stone');
  p.put(0, 0, 0, 'lever');
  p.putP(1, 0, 0, 'repeater', { facing: 'west', delay: '4' });
  p.put(2, 0, 0, 'redstone_wire');
  p.Rs.setPowered(0, 0, 0, true);
  p.runTicks(8);
  ok(p.on(1, 0, 0) === true, 'the long repeater is on');
  p.Rs.setPowered(0, 0, 0, false);
  ok(p.on(1, 0, 0) === true, 'and stays on the instant the lever drops — it scheduled its turn-off');
  p.runTicks(7);
  const stillOn = p.on(1, 0, 0);
  p.runTicks(1);
  ok(stillOn === true && p.on(1, 0, 0) === false,
     'and drops exactly eight game ticks later, not immediately');
}
say(`   ${pass} ok`);

// ═══════════ 11. the repeater lock ═════════════════════════════════════════════════════════
say('\n11. the lock: the latch every door in the game is built out of');
{
  // ⚠ ONLY A DIODE CAN LOCK A REPEATER. `RepeaterBlock.isAlternateInput` is `isDiode(state)`,
  // not `isSignalSource` — so dust, a torch or a lever beside a repeater does nothing at all,
  // and that is what makes the lock usable as memory rather than as a hazard.
  const build = () => {
    const s = scene();
    for (let i = -3; i <= 6; i++) for (let k = -3; k <= 3; k++) s.put(i, -1, k, 'stone');
    s.put(-1, 0, 0, 'lever');                                  // the DATA line
    s.putP(0, 0, 0, 'repeater', { facing: 'west' });            // the repeater being locked
    s.put(1, 0, 0, 'redstone_wire');
    s.put(0, 0, -2, 'lever');                                   // the LOCK line
    s.putP(0, 0, -1, 'repeater', { facing: 'north' });          // points south, into the side
    s.Rs.update(0, 0, 0);
    s.runTicks(4);
    return s;
  };
  const s = build();
  ok(s.Rs.isLocked(0, 0, 0, s.w.get(0, 0, 0)) === false, 'unlocked while the locking repeater is off');
  s.Rs.setPowered(-1, 0, 0, true); s.runTicks(4);
  ok(s.on(0, 0, 0) === true && s.power(1, 0, 0) === 15, 'data in, output high');

  s.Rs.setPowered(0, 0, -2, true); s.runTicks(4);
  ok(s.Rs.isLocked(0, 0, 0, s.w.get(0, 0, 0)) === true, 'the side repeater turned on and LOCKED it');
  ok(s.prop(0, 0, 0, 'locked') === 'true', 'and the block state says so, so the bar draws down');

  s.Rs.setPowered(-1, 0, 0, false); s.runTicks(8);
  ok(s.on(0, 0, 0) === true && s.power(1, 0, 0) === 15,
     'the data line dropped and the output DID NOT — a locked repeater holds its value');

  s.Rs.setPowered(0, 0, -2, false); s.runTicks(8);
  ok(s.on(0, 0, 0) === false && s.power(1, 0, 0) === 0, 'unlock, and it catches up');

  // and the negative: dust, a torch and a lever beside it lock nothing
  for (const beside of ['redstone_wire', 'redstone_torch', 'lever']) {
    const t = scene();
    for (let i = -3; i <= 3; i++) for (let k = -3; k <= 3; k++) t.put(i, -1, k, 'stone');
    t.putP(0, 0, 0, 'repeater', { facing: 'west' });
    t.put(0, 0, -1, beside);
    if (beside === 'redstone_wire') { t.put(0, -1, -2, 'stone'); t.put(0, 0, -2, 'redstone_block'); }
    if (beside === 'lever') t.Rs.setPowered(0, 0, -1, true);
    t.Rs.update(0, 0, -1);
    ok(t.Rs.isLocked(0, 0, 0, t.w.get(0, 0, 0)) === false,
       `a ${beside} beside a repeater does NOT lock it — only a diode can`);
  }
}
say(`   ${pass} ok`);

// ═══════════ 12. the comparator ════════════════════════════════════════════════════════════
say('\n12. the comparator: compare, subtract, and what it can read');
{
  /** a comparator at the origin facing west, fed `p` from the west and `side` from the north */
  const rig = (mode, p, side) => {
    const s = scene();
    for (let i = -20; i <= 6; i++) for (let k = -20; k <= 6; k++) s.put(i, -1, k, 'stone');
    s.putP(0, 0, 0, 'comparator', { facing: 'west', mode });
    // ⚠ THE FENCEPOST. The wire NEXT TO the source reads 15, so a line of N wires ending at
    // the comparator delivers `15 - (N - 1)`; to deliver `p` it needs `N = 16 - p` wires and
    // the source one further out. The first version used `15 - p` and every reading came back
    // one too high — which the check saw as an arithmetic disagreement rather than as a broken
    // comparator, because the expected numbers are derived and not copied from the engine.
    for (let i = 1; i <= 16 - p; i++) s.put(-i, 0, 0, 'redstone_wire');
    s.put(-(17 - p), 0, 0, 'redstone_block');
    if (side > 0) {
      for (let k = 1; k <= 16 - side; k++) s.put(0, 0, -k, 'redstone_wire');
      s.put(0, 0, -(17 - side), 'redstone_block');
    }
    s.put(1, 0, 0, 'redstone_wire');
    s.Rs.update(-(17 - p), 0, 0);
    if (side > 0) s.Rs.update(0, 0, -(17 - side));
    s.runTicks(6);
    return s;
  };
  ok(rig('compare', 9, 0).power(1, 0, 0) === 9, 'compare, no side: the input passes through at full strength');
  ok(rig('compare', 9, 4).power(1, 0, 0) === 9, 'compare, weaker side: still the input');
  ok(rig('compare', 9, 9).power(1, 0, 0) === 9, 'compare, EQUAL side: still on (this is the mode difference)');
  ok(rig('compare', 9, 12).power(1, 0, 0) === 0, 'compare, stronger side: nothing');
  ok(rig('subtract', 9, 0).power(1, 0, 0) === 9, 'subtract, no side: the input');
  ok(rig('subtract', 9, 4).power(1, 0, 0) === 5, 'subtract, side 4: 9 - 4 = 5');
  ok(rig('subtract', 9, 9).power(1, 0, 0) === 0, 'subtract, EQUAL side: 0 — the mode difference again');
  ok(rig('subtract', 9, 12).power(1, 0, 0) === 0, 'subtract, stronger side: 0');
  ok(rig('compare', 0, 0).power(1, 0, 0) === 0, 'no input at all: nothing, in either mode');

  // ⚠ THE OUTPUT IS ANALOG AND IT IS NOT IN THE BLOCK STATE. A comparator's state carries one
  // boolean; `7` lives in a `ComparatorBlockEntity`, which is exactly where vanilla puts it.
  {
    const s = rig('subtract', 9, 2);
    ok(s.on(0, 0, 0) === true, 'the comparator state says only "on"');
    ok(s.Rs.comparatorOutput(0, 0, 0) === 7, `and the entity holds ${s.Rs.comparatorOutput(0, 0, 0)}`);
    ok(s.power(1, 0, 0) === 7, 'so the wire in front reads 7 and not 15');
  }

  // ⚠ A CONTAINER, THROUGH `AbstractContainerMenu.getRedstoneSignalFromContainer`. The two
  // parts a from-memory version gets wrong are both asserted: the `+1` that makes ONE item
  // read 1, and the division by the SLOT COUNT that makes a full stack in a 27-slot chest
  // read 1 as well.
  const chestRig = (fill, gap) => {
    const s = scene();
    for (let i = -6; i <= 6; i++) for (let k = -3; k <= 3; k++) s.put(i, -1, k, 'stone');
    s.putP(0, 0, 0, 'comparator', { facing: 'west', mode: 'compare' });
    const cx = gap ? -2 : -1;
    if (gap) s.put(-1, 0, 0, 'stone');
    s.put(cx, 0, 0, 'chest');
    const e = s.M.BlockEntities.create(cx, 0, 0, 'chest');
    for (let i = 0; i < fill.length; i++) e.items[i] = s.M.Inventory.stack('stone', fill[i]);
    s.put(1, 0, 0, 'redstone_wire');
    s.Rs.update(cx, 0, 0);
    s.runTicks(4);
    return s;
  };
  ok(chestRig([], false).power(1, 0, 0) === 0, 'an empty chest reads 0');
  ok(chestRig([1], false).power(1, 0, 0) === 1, 'ONE item in a 27-slot chest reads 1 — the `+1` term');
  ok(chestRig([64], false).power(1, 0, 0) === 1, 'a FULL STACK in one slot still reads 1 — the divide is by slots');
  ok(chestRig(new Array(14).fill(64), false).power(1, 0, 0) === 8,
     'fourteen full slots of twenty-seven read 8');
  ok(chestRig(new Array(27).fill(64), false).power(1, 0, 0) === 15, 'a full chest reads 15');
  ok(chestRig([1], true).power(1, 0, 0) === 1,
     'and it reads the chest THROUGH one solid block — the comparator\'s one-block gap');

  // ⚠ THE ANALOG READING WINS OUTRIGHT over any redstone also touching the back face.
  {
    const s = scene();
    for (let i = -6; i <= 6; i++) for (let k = -3; k <= 3; k++) s.put(i, -1, k, 'stone');
    s.putP(0, 0, 0, 'comparator', { facing: 'west', mode: 'compare' });
    s.put(-1, 0, 0, 'chest');
    const e = s.M.BlockEntities.create(-1, 0, 0, 'chest');
    e.items[0] = s.M.Inventory.stack('stone', 1);
    s.put(-1, 0, -1, 'redstone_block');          // a full-strength source touching the chest
    s.put(1, 0, 0, 'redstone_wire');
    s.Rs.update(-1, 0, 0);
    s.runTicks(4);
    ok(s.power(1, 0, 0) === 1,
       `a comparator behind a chest reads the CHEST (1) and not the redstone block beside it (got ${s.power(1, 0, 0)})`);
  }

  // ⚠ A COMPARATOR IS NOT LOCKABLE, and its side takes anything, not only diodes.
  {
    const s = rig('subtract', 9, 0);
    ok(s.Rs.isLocked(0, 0, 0, s.w.get(0, 0, 0)) === false, 'a comparator can never be locked');
  }
  // the other pure-state readings the engine implements
  {
    const s = scene();
    const at = (name, props) => {
      s.putP(0, 3, 0, name, props || {});
      return s.Rs.analogOutput(0, 3, 0, s.w.get(0, 3, 0));
    };
    ok(at('composter', { level: '4' }) === 4, 'a composter reads its own level');
    ok(at('water_cauldron', { level: '3' }) === 3, 'a water cauldron reads its level');
    ok(at('lava_cauldron') === 3, 'a lava cauldron is always 3');
    ok(at('cauldron') === 0, 'an empty cauldron is 0');
    ok(at('cake', { bites: '0' }) === 14 && at('cake', { bites: '6' }) === 2,
       'a cake is (7 - bites) * 2 — 14 whole, 2 on the last slice');
    ok(at('candle_cake') === 14, 'a candle cake is the whole-cake constant');
    ok(at('beehive', { honey_level: '5' }) === 5, 'a beehive reads its honey level');
    ok(at('respawn_anchor', { charges: '0' }) === 0 && at('respawn_anchor', { charges: '2' }) === 7
       && at('respawn_anchor', { charges: '4' }) === 15,
       'a respawn anchor is floor(charges / 4 * 15): 0, 7, 15');
    ok(at('end_portal_frame', { eye: 'true' }) === 15 && at('end_portal_frame', { eye: 'false' }) === 0,
       'an end portal frame is 15 with an eye and 0 without');
  }
}
say(`   ${pass} ok`);

// ═══════════ 13. the named circuits ════════════════════════════════════════════════════════
say('\n13. circuits by name: a clock, a memory cell, a subtractor');
{
  // ── a repeater clock. PLAN names this one, and it is the circuit that proves the SCHEDULER
  // rather than the signal: one inversion in a loop cannot settle, so it runs for ever.
  //
  //   stone(0,0,0) <- the wall torch's block, and the far end of the loop
  //   torch(1,0,0) -> wire(2,0,0) -> repeater(3,0,0, delay 2) -> wire(4,0,0)
  //                -> round the outside at z=2 -> wire(0,0,1) -> back into the stone
  //
  // ⚠ THE RETURN LANE RUNS AT z=2, NOT z=1, AND THAT IS NOT COSMETIC. At z=1 it would be
  // adjacent to the outward lane at z=0 the whole way, so the torch's 15 would reach the far
  // end through the wire mesh and the repeater would be bypassed — a "clock" whose period is
  // the torch delay and which proves nothing about the repeater at all.
  //
  // ⚠ VANILLA WOULD BURN THIS TORCH OUT (eight toggles in sixty ticks). Burnout is the named
  // gap in `07f_redstone.js`, so here it runs for ever — which is what makes it assertable, and
  // which is also why that gap is written down there rather than discovered here.
  {
    const s = scene();
    for (let i = -2; i <= 6; i++) for (let k = -2; k <= 4; k++) s.put(i, -1, k, 'stone');
    s.put(0, 0, 0, 'stone');
    // ⚠ a WALL torch's `facing` points AWAY from the block it is stuck to, so 'east' at x=1
    // means it hangs on the stone at x=0 — which is the block the loop comes back to.
    s.putP(1, 0, 0, 'redstone_wall_torch', { facing: 'east' });
    s.put(2, 0, 0, 'redstone_wire');
    s.putP(3, 0, 0, 'repeater', { facing: 'west', delay: '2' });
    for (const c of [[4, 0], [4, 1], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2], [0, 1]]) {
      s.put(c[0], 0, c[1], 'redstone_wire');
    }
    s.settle();
    const seen = [];
    for (let t = 0; t < 90; t++) { s.runTicks(1); seen.push(s.lit(1, 0, 0) ? 1 : 0); }
    const edges = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    ok(edges >= 4, `the torch changed state ${edges} times in ninety ticks — it is oscillating`);
    ok(seen.includes(0) && seen.includes(1), 'and it visits both states');
    // ⚠ AND THE PERIOD IS THE REPEATER'S, NOT THE TORCH'S. A loop that bypassed the repeater
    // would still oscillate — at the torch's two ticks. Measuring the half-period is what
    // separates a clock from a flicker, and it is the assertion the first fixture failed.
    const runs = [];
    let run = 1;
    for (let i = 1; i < seen.length; i++) {
      if (seen[i] === seen[i - 1]) run++; else { runs.push(run); run = 1; }
    }
    const mid = runs.slice(1, -1);
    ok(mid.length >= 2 && Math.min(...mid) >= 4,
       `the shortest half-period is ${mid.length ? Math.min(...mid) : 0} ticks — the repeater is in the loop`);
  }

  // ── an RS NOR LATCH out of two cross-coupled wall torches: the canonical one-bit memory,
  // and the circuit the repeater lock in §11 is the modern replacement for.
  //
  //   P1 stone(0,0,0) with torch T1(1,0,0) facing east      <- SET lever on top of P1
  //   P2 stone(4,0,0) with torch T2(3,0,0) facing west      <- RESET lever on top of P2
  //   T1 -> z=+1/+2 lane -> P2        T2 -> z=-1/-2 lane -> P1
  //
  // ⚠ IT IS DRIVEN FROM A KNOWN STATE, NOT BUILT AND POKED. Two cross-coupled inverters placed
  // in the same tick are metastable in vanilla too — both torches see their input arrive
  // together, both flip together, and the thing rings. Holding SET while it is built is what a
  // player does and is what makes the assertion about MEMORY rather than about luck.
  {
    const s = scene();
    for (let i = -2; i <= 6; i++) for (let k = -4; k <= 4; k++) s.put(i, -1, k, 'stone');
    s.put(0, 0, 0, 'stone');   s.putP(1, 0, 0, 'redstone_wall_torch', { facing: 'east' });
    s.put(4, 0, 0, 'stone');   s.putP(3, 0, 0, 'redstone_wall_torch', { facing: 'west' });
    for (const c of [[1, 1], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1]]) s.put(c[0], 0, c[1], 'redstone_wire');
    for (const c of [[3, -1], [3, -2], [2, -2], [1, -2], [0, -2], [0, -1]]) s.put(c[0], 0, c[1], 'redstone_wire');
    s.putP(0, 1, 0, 'lever', { face: 'floor', facing: 'north' });     // SET
    s.putP(4, 1, 0, 'lever', { face: 'floor', facing: 'north' });     // RESET
    s.Rs.setPowered(0, 1, 0, true);                                    // held down while built
    s.settle();
    s.runTicks(12);
    ok(s.lit(1, 0, 0) === false && s.lit(3, 0, 0) === true,
       `SET held: T1 out, T2 lit (got ${s.lit(1, 0, 0)}/${s.lit(3, 0, 0)})`);

    s.Rs.setPowered(0, 1, 0, false);
    s.runTicks(20);
    ok(s.lit(1, 0, 0) === false && s.lit(3, 0, 0) === true,
       'SET released and the latch HELD — T2 is keeping T1 out through the return lane');

    s.Rs.setPowered(4, 1, 0, true);
    s.runTicks(12);
    s.Rs.setPowered(4, 1, 0, false);
    s.runTicks(20);
    ok(s.lit(1, 0, 0) === true && s.lit(3, 0, 0) === false,
       `RESET pulsed and the latch flipped, and held the OTHER state (got ${s.lit(1, 0, 0)}/${s.lit(3, 0, 0)})`);
  }

  // ── a DELAY LINE: four repeaters in series, and the total is the sum of the four settings.
  // ⚠ THE POINT IS THAT DELAYS ADD RATHER THAN COLLAPSE. A chain implemented by re-asking
  // "is my input on" every tick settles in one tick and passes every "does the signal arrive"
  // test; only counting the ticks separates it.
  {
    const delays = [1, 2, 3, 4];                   // 2 + 4 + 6 + 8 = 20 game ticks
    const s = scene();
    for (let i = -2; i <= 14; i++) s.put(i, -1, 0, 'stone');
    s.put(-1, 0, 0, 'lever');
    let x = 0;
    for (const d of delays) { s.putP(x, 0, 0, 'repeater', { facing: 'west', delay: String(d) }); x += 1; }
    s.put(x, 0, 0, 'redstone_wire');
    s.Rs.setPowered(-1, 0, 0, true);
    let arrived = -1;
    for (let t = 1; t <= 40 && arrived < 0; t++) { s.runTicks(1); if (s.power(x, 0, 0) > 0) arrived = t; }
    ok(arrived === 20, `the far end of a 1+2+3+4 delay line goes high on game tick ${arrived}, expected 20`);
  }

  // ── the subtractor, asserted as arithmetic over the whole range rather than at one point
  {
    let agree = 0;
    for (let a = 0; a <= 15; a += 3) {
      for (let b = 0; b <= 15; b += 3) {
        const s = scene();
        for (let i = -20; i <= 6; i++) for (let k = -20; k <= 6; k++) s.put(i, -1, k, 'stone');
        s.putP(0, 0, 0, 'comparator', { facing: 'west', mode: 'subtract' });
        if (a > 0) {
          for (let i = 1; i <= 16 - a; i++) s.put(-i, 0, 0, 'redstone_wire');
          s.put(-(17 - a), 0, 0, 'redstone_block');
        }
        if (b > 0) {
          for (let k = 1; k <= 16 - b; k++) s.put(0, 0, -k, 'redstone_wire');
          s.put(0, 0, -(17 - b), 'redstone_block');
        }
        s.put(1, 0, 0, 'redstone_wire');
        if (a > 0) s.Rs.update(-(17 - a), 0, 0);
        if (b > 0) s.Rs.update(0, 0, -(17 - b));
        s.runTicks(6);
        const want = (a === 0 || b > a) ? 0 : a - b;
        if (ok(s.power(1, 0, 0) === want, `subtract ${a} - ${b} = ${want}, got ${s.power(1, 0, 0)}`)) agree++;
      }
    }
    say(`   the subtract truth table agrees in ${agree} of 36 cells`);
  }
}
say(`   ${pass} ok`);

// ═══════════ 15. the observer ══════════════════════════════════════════════════════════════
say('\n15. the observer: a one-shot, not a sensor');
{
  // ⚠ THE OBSERVER'S `facing` IS ITS EYE. It watches the cell one step along `facing` and
  // outputs from the cell BEHIND it, which is the same convention the diodes use.
  const build = () => {
    const s = scene();
    for (let i = -4; i <= 6; i++) for (let k = -3; k <= 3; k++) s.put(i, -1, k, 'stone');
    s.putP(0, 0, 0, 'observer', { facing: 'east' });   // watches x = 1, outputs at x = -1
    s.put(-1, 0, 0, 'redstone_wire');
    s.put(-2, 0, 0, 'redstone_lamp');
    s.settle();
    return s;
  };
  const s = build();
  ok(s.on(0, 0, 0) === false, 'it starts unpowered');
  ok(s.power(-1, 0, 0) === 0, 'and its output wire is dark');

  // something appears in front of it
  s.B.changed ? (s.w.set(1, 0, 0, s.S.stateOf('stone')), s.B.changed(1, 0, 0)) : null;
  ok(s.on(0, 0, 0) === false, 'the observer does NOT fire in the tick the change happens');
  s.runTicks(1);
  ok(s.on(0, 0, 0) === false, 'nor one tick later');
  s.runTicks(1);
  ok(s.on(0, 0, 0) === true, 'it goes high on game tick 2');
  ok(s.power(-1, 0, 0) === 15, `and its output wire reads ${s.power(-1, 0, 0)}`);
  ok(s.lit(-2, 0, 0) === true, 'and the lamp behind it lights');
  s.runTicks(1);
  ok(s.on(0, 0, 0) === true, 'still high one tick later');
  s.runTicks(1);
  ok(s.on(0, 0, 0) === false, 'and low again on tick 4 — a fixed TWO-tick pulse');
  ok(s.power(-1, 0, 0) === 0 && s.lit(-2, 0, 0) === true, 'the wire goes dark with it; the lamp holds its 4-tick turn-off');
  s.runTicks(4);
  ok(s.lit(-2, 0, 0) === false, 'and the lamp is out 4 ticks later');

  // ⚠ A ONE-SHOT: the block it watched is STILL there, and the observer stays low.
  s.runTicks(20);
  ok(s.on(0, 0, 0) === false,
     'twenty ticks later it is still low, though the block it watched has not gone anywhere');

  // ⚠ IT ONLY WATCHES THE CELL IN FRONT. A change to its side, back, above or below is nothing.
  for (const [dx, dy, dz, what] of [[-1, 0, 0, 'behind'], [0, 0, 1, 'beside'],
                                    [0, 1, 0, 'above'], [0, -1, 0, 'below']]) {
    const t = build();
    t.w.set(dx, dy, dz, t.S.stateOf('gold_block'));
    t.B.changed(dx, dy, dz);
    t.runTicks(4);
    ok(t.on(0, 0, 0) === false, `a change ${what} the observer does not fire it`);
  }

  // and it fires again on the NEXT change, so it is armed rather than spent
  const u = build();
  u.w.set(1, 0, 0, u.S.stateOf('stone')); u.B.changed(1, 0, 0);
  u.runTicks(6);
  ok(u.on(0, 0, 0) === false, 'the first pulse has been and gone');
  u.w.set(1, 0, 0, u.S.stateOf('gold_block')); u.B.changed(1, 0, 0);
  u.runTicks(2);
  ok(u.on(0, 0, 0) === true, 'and changing the watched block again fires it again');

  // ⚠ IT DOES NOT CONDUCT, for the same reason a redstone block does not.
  ok(s.Rs.isConductor(s.S.stateOf('observer')) === false,
     'an observer is a full opaque cube and still does not conduct');
  // and a wire connects to it only along its own axis
  const obsE = s.B.setProp(s.S.stateOf('observer'), 'facing', 'east');
  ok(s.Rs.connectsToRedstone(obsE, 5) === true, 'dust connects to an observer on its FACING side');
  ok(s.Rs.connectsToRedstone(obsE, 2) === false, '...and not on its north side');
}

// ═══════════ 15b. a wall torch reads its support FROM the torch TO the support (#342) ═══════
say('\n15b. wall torch on a directional support (observer face / back)');
{
  const s = scene();
  const powered = s.B.setProp(s.B.setProp(s.S.stateOf('observer'), 'facing', 'north'), 'powered', true);
  s.put(0, 0, 0, 'stone');
  s.W ? s.W.set(0, 0, 0, powered) : s.w.set(0, 0, 0, powered);
  const wall = (f) => s.B.setProp(s.B.setProp(s.S.stateOf('redstone_wall_torch'), 'facing', f), 'lit', true);
  const at = (x, y, z, f) => { (s.W || s.w).set(x, y, z, wall(f)); return s.Rs.torchInput(x, y, z); };
  okAv(at(0, 0, -1, 'north') === false, 'a torch on the observer\'s FACE reads nothing (the face emits nothing)');
  okAv(at(0, 0, 1, 'south') === true, 'a torch on the observer\'s BACK reads its output');
}
say(`   ${pass} ok`);

// ═══════════ 14. anti-vacuity for the diodes ═══════════════════════════════════════════════
say('\n14. break the G15b rules, and the breaks must be visible');
{
  // ⚠ EACH BREAK IS A CIRCUIT THAT MUST STOP WORKING, not a flag flipped in the module. A rule
  // that only shows up when you reach into the engine is not a rule the game can see.

  // 1. the wall torch's own support. If `getSignal` used the standing torch's `dir != UP`, the
  //    torch would power the block it hangs on — so the two directions must DISAGREE.
  {
    const { S, B, Rs } = scene();
    const wt = B.setProp(S.stateOf('redstone_wall_torch'), 'facing', 'east');
    const toSupport = Rs.signal(wt, 5, 1, 0, 0);     // the ask that comes from its own block
    const toFront = Rs.signal(wt, 4, 1, 0, 0);       // the ask from the cell it points at
    okAv(toSupport === 0 && toFront === 15,
      `a wall torch gives its support ${toSupport} and the cell in front ${toFront} — `
      + 'a standing torch would give both 15 and feed itself');
  }

  // 2. the repeater's direction. Turn it round and the same circuit must go dead.
  {
    const build = (facing) => {
      const s = scene();
      for (let i = -2; i <= 8; i++) s.put(i, -1, 0, 'stone');
      s.put(-1, 0, 0, 'redstone_block');
      s.put(0, 0, 0, 'redstone_wire');
      s.putP(1, 0, 0, 'repeater', { facing });
      s.put(2, 0, 0, 'redstone_wire');
      s.settle(); s.runTicks(6);
      return s.power(2, 0, 0);
    };
    const right = build('west'), backwards = build('east');
    okAv(right === 15 && backwards === 0,
      `a repeater facing its input passes 15 and one facing away passes ${backwards} — FACING is the input side`);
  }

  // 3. the two comparator modes must differ at EQUAL strengths, or `mode` is doing nothing.
  {
    const rig = (mode) => {
      const s = scene();
      for (let i = -20; i <= 4; i++) for (let k = -20; k <= 2; k++) s.put(i, -1, k, 'stone');
      s.putP(0, 0, 0, 'comparator', { facing: 'west', mode });
      for (let i = 1; i <= 8; i++) s.put(-i, 0, 0, 'redstone_wire');
      s.put(-9, 0, 0, 'redstone_block');
      for (let k = 1; k <= 8; k++) s.put(0, 0, -k, 'redstone_wire');
      s.put(0, 0, -9, 'redstone_block');
      s.put(1, 0, 0, 'redstone_wire');
      s.settle(); s.runTicks(6);
      return s.power(1, 0, 0);
    };
    const c = rig('compare'), u = rig('subtract');
    okAv(c === 8 && u === 0,
      `at equal input and side, compare gives ${c} and subtract gives ${u} — the mode is real`);
  }

  // 4. the lock must actually hold a value that would otherwise have changed.
  {
    const run = (lock) => {
      const s = scene();
      for (let i = -3; i <= 4; i++) for (let k = -3; k <= 2; k++) s.put(i, -1, k, 'stone');
      s.putP(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
      s.putP(0, 0, 0, 'repeater', { facing: 'west' });
      s.put(1, 0, 0, 'redstone_wire');
      s.putP(0, 0, -2, 'lever', { face: 'floor', facing: 'north' });
      s.putP(0, 0, -1, 'repeater', { facing: 'north' });
      s.settle();
      s.Rs.setPowered(-1, 0, 0, true); s.runTicks(6);
      if (lock) { s.Rs.setPowered(0, 0, -2, true); s.runTicks(6); }
      s.Rs.setPowered(-1, 0, 0, false); s.runTicks(10);
      return s.power(1, 0, 0);
    };
    const locked = run(true), free = run(false);
    okAv(locked === 15 && free === 0,
      `with the lock on the output stays ${locked} and without it falls to ${free}`);
  }

  // 5. the container formula's `+1`: an empty chest and a one-item chest must differ.
  {
    const chest = (n) => {
      const s = scene();
      for (let i = -3; i <= 3; i++) s.put(i, -1, 0, 'stone');
      s.putP(0, 0, 0, 'comparator', { facing: 'west', mode: 'compare' });
      s.put(-1, 0, 0, 'chest');
      const e = s.M.BlockEntities.create(-1, 0, 0, 'chest');
      if (n) e.items[0] = s.M.Inventory.stack('stone', n);
      s.put(1, 0, 0, 'redstone_wire');
      s.settle(); s.runTicks(6);
      return s.power(1, 0, 0);
    };
    const empty = chest(0), one = chest(1);
    okAv(empty === 0 && one === 1,
      `an empty chest reads ${empty} and a chest with one item reads ${one} — the "+1" term is there`);
  }

  // 6. the wire's connection completion: a run that ends at a lamp lights it, a run that bends
  //    first does not. Same lamp, same distance, one rule apart.
  {
    const mk = (bend) => {
      const s = scene();
      for (let i = -2; i <= 6; i++) for (let k = -2; k <= 2; k++) s.put(i, -1, k, 'stone');
      s.put(-1, 0, 0, 'redstone_block');
      for (let i = 0; i <= 3; i++) s.put(i, 0, 0, 'redstone_wire');
      if (bend) s.put(3, 0, -1, 'redstone_wire');
      s.put(4, 0, 0, 'redstone_lamp');
      s.settle();
      return s.lit(4, 0, 0);
    };
    okAv(mk(false) === true && mk(true) === false,
      'a straight run lights the lamp it ends at and a bent one does not — the axis-completion rule, both ways');
  }

  // 7. the golden tables really are being read, and a broken one really would be caught.
  {
    const { S, Rs } = scene();
    const gold = readFileSync(join(ROOT, 'tools', 'golden', 'signal-sources-1.18.2.tsv'), 'utf8')
      .split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t')[0]);
    const broken = gold.filter((n) => n !== 'lever');           // a table missing one row
    const wouldFail = Rs.SIGNAL_SOURCES.some((n) => !broken.includes(n));
    okAv(wouldFail === true && gold.includes('lever'),
      'dropping one row from the golden signal-source table makes §8 fail — the comparison is live');
  }

  // 7b. the observer's pulse is TWO ticks and it is a one-shot, both measured.
  {
    const s = scene();
    for (let i = -4; i <= 6; i++) for (let k = -3; k <= 3; k++) s.put(i, -1, k, 'stone');
    s.putP(0, 0, 0, 'observer', { facing: 'east' });
    s.put(-1, 0, 0, 'redstone_wire');
    s.settle();
    s.w.set(1, 0, 0, s.S.stateOf('stone')); s.B.changed(1, 0, 0);
    const seen = [];
    for (let t = 0; t < 12; t++) { s.runTicks(1); seen.push(s.on(0, 0, 0) ? 1 : 0); }
    const high = seen.filter((v) => v).length;
    okAv(high === 2 && seen.slice(0, 1).join('') === '0',
      `the observer is high for ${high} of twelve ticks and not in the first — a level detector would be high for ten`);
  }

  // 8. the comparator's number really is in the block entity and not in its state.
  {
    const s = scene();
    for (let i = -20; i <= 4; i++) for (let k = -20; k <= 2; k++) s.put(i, -1, k, 'stone');
    s.putP(0, 0, 0, 'comparator', { facing: 'west', mode: 'subtract' });
    for (let i = 1; i <= 7; i++) s.put(-i, 0, 0, 'redstone_wire');
    s.put(-8, 0, 0, 'redstone_block');
    for (let k = 1; k <= 13; k++) s.put(0, 0, -k, 'redstone_wire');
    s.put(0, 0, -14, 'redstone_block');
    s.put(1, 0, 0, 'redstone_wire');
    s.settle(); s.runTicks(6);
    const before = s.power(1, 0, 0);
    const e = s.M.BlockEntities.get(0, 0, 0);
    const held = e ? e.output : null;
    if (e) e.output = 0;                                         // break the STORE, not the state
    const after = s.Rs.signal(s.w.get(0, 0, 0), 4, 0, 0, 0);
    okAv(before > 0 && held === before && after === 0,
      `the wire read ${before}, the entity held ${held}, and zeroing the ENTITY alone drops the output to ${after}`);
  }
}
say(`   ${pass} ok`);

// ═══════════ 7. anti-vacuity ═══════════════════════════════════════════════════════════════
say('\n7. anti-vacuity: break it, and it must be caught');
{
  // ── the burnout, broken: raise the budget and the same clock runs for ever (D-354) ───────
  // ⚠ WITHOUT THIS, §5b WOULD PASS ON AN ENGINE THAT NEVER BURNED A TORCH OUT — the seven
  // survivable presses would still survive, and "it did not come back on" could be any bug at
  // all. Raising the budget out of reach is the cleanest break because it changes NOTHING else:
  // the same circuit, the same ticks, one number.
  const bo = scene();
  const keepT = bo.Rs.BURNOUT_TOGGLES;
  const clock = (R) => {
    R.clearToggles();
    bo.put(0, -1, 0, 'stone'); bo.put(0, 0, 0, 'stone'); bo.put(0, 1, 0, 'redstone_torch');
    bo.put(-1, -1, 0, 'stone'); bo.put(-1, 0, 0, 0);
    R.update(0, 1, 0);
    for (let i = 0; i < keepT; i++) {
      bo.put(-1, 0, 0, bo.lever()); R.update(-1, 0, 0); bo.runTicks(3);
      bo.put(-1, 0, 0, 0); R.update(-1, 0, 0); bo.runTicks(3);
    }
    return bo.lit(0, 1, 0);
  };
  okAv(clock(bo.Rs) === false, 'the torch clock burns out while the budget is eight');
  bo.Rs.BURNOUT_TOGGLES = 1e9;
  okAv(clock(bo.Rs) === true,
       'and with the budget raised out of reach the same clock runs for ever — so section 5b was ' +
       'measuring the burnout and not some other way for a torch to be dark');
  bo.Rs.BURNOUT_TOGGLES = keepT;
  okAv(clock(bo.Rs) === false, 'and with the budget back it burns out again');
  // the 160-tick retick, broken: push it out of reach and the burnt torch never relights on its own
  // (a fresh scene: the earlier clocks left real 160-tick retricks queued)
  const b2 = scene();
  b2.Rs.BURNOUT_RETICK = 1e9;
  b2.Rs.clearToggles();
  b2.put(0, -1, 0, 'stone'); b2.put(0, 0, 0, 'stone'); b2.put(0, 1, 0, 'redstone_torch'); b2.put(-1, -1, 0, 'stone');
  b2.Rs.update(0, 1, 0);
  for (let i = 0; i < keepT; i++) {
    b2.put(-1, 0, 0, b2.lever()); b2.Rs.update(-1, 0, 0); b2.runTicks(3);
    b2.put(-1, 0, 0, 0); b2.Rs.update(-1, 0, 0); b2.runTicks(3);
  }
  b2.runTicks(300);
  okAv(b2.lit(0, 1, 0) === false, 'with the 160-tick retick pushed out of reach a burnt-out torch stays dark — section 5b relights on the retick alone');
  // ⚠ THE SELF-FEEDING LATCH. Without `shouldSignal`, a wire reads its own power back through
  // the conductor beside it and every wire in the run latches at 15. This replays it by hand.
  const { Rs, put, power, w, S } = scene();
  for (let i = 0; i < 6; i++) { put(i, -1, 0, 'stone'); put(i, 0, 0, 'redstone_wire'); }
  put(-1, -1, 0, 'stone'); put(-1, 0, 0, 'redstone_block');
  Rs.update(-1, 0, 0);
  const real = power(3, 0, 0);
  // the same cell, asked with the suppression defeated: the wire's own 12 comes back through
  // the block under it, so `bestNeighbourSignal` would see its own power.
  const selfSeen = Rs.signal(w.get(3, 0, 0), Rs.UP, 3, 0, 0);
  okAv(real === 12 && selfSeen === 12,
    `the wire really does emit its own ${selfSeen} upward — suppressing that during its own recompute is what stops the latch`);

  // the decay must be on the wire term only
  const b = scene();
  b.put(0, -1, 0, 'stone'); b.put(0, 0, 0, 'redstone_wire');
  b.put(-1, -1, 0, 'stone'); b.put(-1, 0, 0, 'redstone_block');
  b.Rs.update(-1, 0, 0);
  okAv(b.power(0, 0, 0) === 15,
    'a wire touching a source reads 15 — `max(block, wire-1)` and `max(all)-1` differ here by one');

  // ⚠ THE CONDUCTOR TEST, DRIVING A STEP **DOWN**. This break's first version asserted that
  // wire cannot climb glass, which is FALSE and the engine was right to disagree: the wire on
  // top of the glass reaches the lower run through its OWN down-rule, because the cell beside it
  // is air. The conductor test shows itself on the way down instead — a wire steps down past a
  // side block only when that block is NOT a conductor.
  const mkStep = (sideBlock) => {
    const s2 = scene();
    for (let i = 0; i < 3; i++) { s2.put(i, -1, 0, 'stone'); s2.put(i, 0, 0, 'redstone_wire'); }
    s2.put(-1, -1, 0, 'stone'); s2.put(-1, 0, 0, 'redstone_block');
    s2.put(3, 0, 0, sideBlock);              // the block the run meets
    s2.put(3, -2, 0, 'stone'); s2.put(3, -1, 0, 'redstone_wire');   // wire one step down
    s2.Rs.update(-1, 0, 0);
    return s2.power(3, -1, 0);
  };
  const viaGlass = mkStep('glass'), viaStone = mkStep('stone');
  okAv(viaGlass > 0 && viaStone === 0,
    `wire steps down past glass (${viaGlass}) and not past stone (${viaStone}) — the conductor test is what separates them`);

  // and the run really ends: a check that never sees a 0 is not measuring decay
  const d = scene();
  for (let i = 0; i < 20; i++) { d.put(i, -1, 0, 'stone'); d.put(i, 0, 0, 'redstone_wire'); }
  d.put(-1, -1, 0, 'stone'); d.put(-1, 0, 0, 'redstone_block');
  d.Rs.update(-1, 0, 0);
  let zeros = 0;
  for (let i = 0; i < 20; i++) if (d.power(i, 0, 0) === 0) zeros++;
  okAv(zeros === 5, `${zeros} of the twenty wires are dark — the run has an end`);

  // the torch delay must be observable: an instant torch and a two-tick one differ at tick 1
  const e = scene();
  e.put(0, 0, 0, 'stone'); e.put(0, 1, 0, 'redstone_torch');
  e.put(-1, -1, 0, 'stone'); e.put(-1, 0, 0, e.lever()); e.put(0, -1, 0, 'stone');
  e.Rs.update(0, 1, 0);
  const before = e.lit(0, 1, 0);
  e.runTicks(1);
  const afterOne = e.lit(0, 1, 0);
  e.runTicks(1);
  const afterTwo = e.lit(0, 1, 0);
  okAv(before === true && afterOne === true && afterTwo === false,
    'the torch is still lit one tick after its input arrives and out on the second — an instant inverter would differ at tick 1');
}
say(`   ${pass} ok`);

console.log('\n16. the daylight detector (PASS 15 JOB 2) — sky light and a time of day, not sampled once');
{
  // pure arithmetic first — no world, no fixture, just the formula against hand-worked cases.
  // Sky.dayTime is vanilla's own clock: 0 is SUNRISE (Sky.NEW_WORLD_TIME starts a fresh world at
  // 1000, just past it), 6000 is NOON, 18000 is MIDNIGHT — `Sky.timeOfDay`'s `- 0.25` offset is
  // what makes 6000/24000 - 0.25 land on 0, the sun's own zero. Verified directly (not assumed):
  // `Redstone.skyDarken(6000, 0, 0) === 0` (brightest) and `Redstone.skyDarken(18000, 0, 0) === 11`
  // (darkest) before this section was written.
  const pure = scene().Rs;
  ok(pure.daylightSignal(15, false, 6000, 0, 0) === 15, 'noon, uncovered (sky light 15): reads 15');
  ok(pure.daylightSignal(0, false, 6000, 0, 0) === 0, 'noon, covered (sky light 0): reads 0');
  ok(pure.daylightSignal(15, true, 6000, 0, 0) === 0,
    'noon, INVERTED, uncovered: the complement of the plain reading — 0, not 15');

  // the full path: a real block in a real (fixture) world, moved by the clock, not sampled once
  const s = scene();
  s.put(0, 0, 0, 'daylight_detector');
  s.setSkyLight(0, 0, 0, 15);
  s.M.Sky.dayTime = 6000;                                 // noon
  s.Rs.updateDaylightDetector(0, 0, 0);
  const noon = s.prop(0, 0, 0, 'power') | 0;   // propName returns the STRING '15', not 15
  ok(noon === 15, `a placed detector under open sky at noon reads 15 (got ${noon})`);

  s.M.Sky.dayTime = 18000;                                // twelve thousand ticks later: midnight
  s.Rs.updateDaylightDetector(0, 0, 0);
  const midnight = s.prop(0, 0, 0, 'power') | 0;
  ok(midnight !== noon,
    `the SAME block reads differently as the clock advances (noon ${noon} -> midnight ${midnight}) — ` +
    'this tracks the cycle rather than sampling once at placement');

  // ⚠ anti-vacuity #1 (named in the job): cover it, and the reading must FALL
  s.M.Sky.dayTime = 6000;                                 // back to noon, so only light changes
  s.setSkyLight(0, 0, 0, 0);
  s.Rs.updateDaylightDetector(0, 0, 0);
  const covered = s.prop(0, 0, 0, 'power') | 0;
  okAv(covered < noon, `anti-vacuity: covering the detector drops its reading (${noon} -> ${covered})`);

  // ⚠ anti-vacuity #2 (named in the job): force the sun angle to midnight, uncovered reads 0
  okAv(pure.daylightSignal(15, false, 18000, 0, 0) === 0,
    'anti-vacuity: sun angle forced to midnight, uncovered, reads 0 — not 15, not a threshold that never moves');

  // the inverted variant is a real, separately-placeable block state, not just the pure function
  const s2 = scene();
  s2.putP(0, 0, 0, 'daylight_detector', { inverted: true });
  s2.setSkyLight(0, 0, 0, 15);
  s2.M.Sky.dayTime = 6000;
  s2.Rs.updateDaylightDetector(0, 0, 0);
  ok((s2.prop(0, 0, 0, 'power') | 0) === 0, 'a placed INVERTED detector under open sky at noon reads 0');

  // it does not thrash the world every call: unchanged inputs mean no re-write
  ok(s2.Rs.updateDaylightDetector(0, 0, 0) === false,
    'a second call with nothing changed is a no-op (returns false)');

  // ⚠⚠ THE CLASS-CLOSING ASSERTION JOB 2 ASKS FOR: every `Rs.OWED_SOURCES` row must still name a
  // stage that has NOT shipped — the general §2.11 shape `stagecheck` now holds across the whole
  // suite, checked here too so `redcheck` fails on its own the day another row goes stale, the
  // same way it would have caught `daylight_detector`'s own entry the day G16 shipped.
  const roster = parseRoster(readFileSync(join(ROOT, 'docs/archive/PLAN.md'), 'utf8'));
  const stale = [];
  for (const [k, v] of Object.entries(s.Rs.OWED_SOURCES)) {
    const ids = [...v.matchAll(/\bG\d{1,3}[a-z]?\b/g)].map((m) => m[0]);
    if (ids.length && roster.get(ids[ids.length - 1]) === 'done') stale.push(`${k}: "${v}"`);
  }
  ok(stale.length === 0, `every OWED_SOURCES row cites a stage that has not shipped (${stale.join(' | ') || 'clean'})`);
  ok(!('daylight_detector' in s.Rs.OWED_SOURCES),
    'daylight_detector is DELETED from OWED_SOURCES, not left beside its replacement (D-139)');
}
say(`   ${pass} ok`);

// ── 17. THE LAST TWO OF G19b'S OWED SOURCES (D-432) ─────────────────────────────
//
// `redcheck` FAILS if a source stays owed against a completed stage, and G19b is the stage these
// two were waiting on. Both are refereed off the jar rather than remembered:
//   clg.a  TrappedChestBlock.getSignal        = clamp(ChestBlockEntity.getOpenCount(...), 0, 15)
//   clg.b  TrappedChestBlock.getDirectSignal  = dir == UP ? getSignal(...) : 0
//   chp.a  LecternBlock.getSignal             = POWERED ? 15 : 0
//   chp.b  LecternBlock.getDirectSignal       = (dir == UP && POWERED) ? 15 : 0
say('\n17. the trapped chest and the lectern (D-432)');
{
  const sc = scene();
  const Rs2 = sc.Rs, S2 = sc.S, Bh = sc.B;
  const BE2 = sc.M.BlockEntities;
  const X = 40, Y = 64, Z = 40;
  const tc = S2.stateOf('trapped_chest');
  ok(!!tc, 'there is no trapped_chest state');
  if (tc && BE2) {
    // ⚠ A REAL BLOCK ENTITY AT A REAL POSITION. Stubbing `BE.get` would test the arithmetic
    // and not the join, and the join is where D-276 says the bugs are.
    BE2.remove(X, Y, Z);
    BE2.create(X, Y, Z, 'trapped_chest');
    const e = BE2.get(X, Y, Z);
    ok(!!e, 'the trapped chest block entity was not created');
    if (e) {
      e.open = 0;
      ok(Rs2.signal(tc, 3, X, Y, Z) === 0, 'a CLOSED trapped chest emits power');
      ok(Rs2.directSignal(tc, Rs2.UP, X, Y, Z) === 0, 'a closed trapped chest strongly powers the block below it');
      e.open = 1;
      ok(Rs2.signal(tc, 3, X, Y, Z) === 1,
         `one opener should be one power, got ${Rs2.signal(tc, 3, X, Y, Z)}`);
      // ⚠⚠ IT IS A COUNT, NOT A BOOLEAN, and this is the assertion that says so. Writing the
      // rule as `open ? 15 : 0` agrees with vanilla in every single-player case and is a
      // different rule; a comparator reading the chest would be wrong the day anything else
      // opens one.
      e.open = 4;
      ok(Rs2.signal(tc, 3, X, Y, Z) === 4,
         `four openers should be four power, got ${Rs2.signal(tc, 3, X, Y, Z)} — the rule is a boolean, not the clamped count`);
      e.open = 99;
      ok(Rs2.signal(tc, 3, X, Y, Z) === 15, 'the opener count is not clamped to 15');
      e.open = 2;
      // ...and the STRONG power goes down and nowhere else
      ok(Rs2.directSignal(tc, Rs2.UP, X, Y, Z) === 2, 'an open trapped chest does not strongly power the block below it');
      for (const d of [0, 2, 3, 4, 5]) {
        ok(Rs2.directSignal(tc, d, X, Y, Z) === 0,
           `a trapped chest gives STRONG power in direction ${d} — only the block beneath it should get any`);
      }
      // ...while the WEAK power goes everywhere, which is the pressure plate's shape too
      ok(Rs2.signal(tc, 0, X, Y, Z) === 2 && Rs2.signal(tc, 5, X, Y, Z) === 2,
         'a trapped chest\'s WEAK power does not reach every direction');
      // a trapped chest with no block entity at all is 0, not a crash
      BE2.remove(X, Y, Z);
      ok(Rs2.signal(tc, 3, X, Y, Z) === 0, 'a trapped chest with no block entity did not read as 0');
    }
  }

  const lec = S2.stateOf('lectern');
  ok(!!lec, 'there is no lectern state');
  if (lec) {
    const off = Bh.setProp(lec, 'powered', false);
    const on = Bh.setProp(lec, 'powered', true);
    ok(off !== on, 'the lectern has no `powered` property — the rule cannot be expressed');
    ok(Rs2.signal(off, 3, 0, 0, 0) === 0, 'an unpowered lectern emits power');
    ok(Rs2.signal(on, 3, 0, 0, 0) === 15, 'a powered lectern emits nothing');
    ok(Rs2.directSignal(on, Rs2.UP, 0, 0, 0) === 15, 'a powered lectern does not strongly power the block below it');
    for (const d of [0, 2, 3, 4, 5]) {
      ok(Rs2.directSignal(on, d, 0, 0, 0) === 0, `a powered lectern gives STRONG power in direction ${d}`);
    }
    ok(Rs2.directSignal(off, Rs2.UP, 0, 0, 0) === 0, 'an UNPOWERED lectern strongly powers the block below it');

    // ── anti-vacuity (D-30) ─────────────────────────────────────────────────
    // The tempting WRONG rule for a trapped chest is `open ? 15 : 0`. It agrees with vanilla
    // everywhere a single player can look, so the only test that can tell them apart is one
    // with more than one opener — which is the one above. Here is the proof it discriminates.
    if (tc && BE2) {
      BE2.remove(X, Y, Z); BE2.create(X, Y, Z, 'trapped_chest');
      const e2 = BE2.get(X, Y, Z);
      e2.open = 4;
      const real = Rs2.signal(tc, 3, X, Y, Z);
      const wrongRule = e2.open ? 15 : 0;
      okAv(real !== wrongRule,
           `anti-vacuity: at 4 openers the count rule says ${real} and the boolean rule says ${wrongRule} — the two ARE distinguishable, so the count assertion is not a tautology`);
      e2.open = 0;
      okAv(Rs2.signal(tc, 3, X, Y, Z) === (e2.open ? 15 : 0),
           'anti-vacuity: ...and with the chest CLOSED both rules say 0, so a check that only tested open-vs-closed could never have told them apart');
      BE2.remove(X, Y, Z);
    }
    // and the lectern's direction rule must be able to fail: WEAK power goes everywhere, so a
    // check that asked `signal` instead of `directSignal` would pass in all six directions.
    okAv(Rs2.signal(on, 3, 0, 0, 0) === 15 && Rs2.directSignal(on, 3, 0, 0, 0) === 0,
         'anti-vacuity: the lectern\'s WEAK power goes sideways and its STRONG power does not — the two questions give different answers');
  }
  say(`   ${pass} ok`);
}

console.log('');
console.log('================= redcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
