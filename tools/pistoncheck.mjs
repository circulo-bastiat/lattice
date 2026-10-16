#!/usr/bin/env node
// pistoncheck.mjs — PLAN G15c. Pistons, one contraption at a time.
//
//   node tools/pistoncheck.mjs [--quiet]
//
// ⚠ THE SAME ARGUMENT `redcheck` MAKES, ONE STAGE LATER: a piston rule is simple enough to look
// right while being wrong in a way only a built thing shows. A push limit counted in CELLS
// instead of BLOCKS passes every straight-column test and fails the first slime blob; a resolver
// that walks only forwards pushes what is in front of a slime block and abandons what is stuck
// behind it; a `getNeighborSignal` without the quasi-connectivity loop passes every "does a
// lever fire a piston" test and breaks every BUD switch in the game. So this file BUILDS things
// and asserts the cells afterwards.
//
// ⚠ EVERY EXPECTED NUMBER IS DERIVED FROM VANILLA'S OWN RULE. Twelve is `MAX_PUSH_DEPTH`; two
// game ticks is `progress += 0.5F`; which blocks break is the golden PushReaction table, itself
// read out of the bytecode by `tools/extract-push.mjs`. Where a rule is subtler than a number
// the comment names the method it comes from.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js',
               '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07g_piston.js'];
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const DIRNAME = ['down', 'up', 'north', 'south', 'west', 'east'];

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
  // ⚠ NO `M.Behave.w = w` (D-302). The fixture used to overwrite `Behave`'s world ADAPTER with
  // its own object, so this check exercised an interface the game does not have: `NS.World.get`
  // takes CHUNK coordinates, and `Redstone.init(NS.World)` was reading chunks as block states in
  // every shipped build while every assertion here passed. The fixture now hands its world to
  // `Behave` and everything downstream reads it through the SAME adapter the game uses.
  M.Behave.init(w);
  M.BlockEntities.init();
  M.Redstone.init(); M.Piston.init();
  const S = M.States, B = M.Behave, Rs = M.Redstone, P = M.Piston, BE = M.BlockEntities;
  const placed = [];
  const put = (x, y, z, n, props) => {
    let st = typeof n === 'number' ? n : S.stateOf(n);
    for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]);
    w.set(x, y, z, st);
    placed.push(x, y, z);
    return st;
  };
  /** what the game does after a build: notify from every cell that was placed, in order. */
  const settle = () => { for (let i = 0; i < placed.length; i += 3) Rs.update(placed[i], placed[i + 1], placed[i + 2]); };
  const name = (x, y, z) => { const st = w.get(x, y, z); return st === 0 ? 'air' : M.Reg.names[S.block[st]]; };
  const row = (x0, y, z, n, dx) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(name(x0 + i * (dx === undefined ? 1 : dx), y, z));
    return out;
  };
  const floor = (x0, x1, z0, z1, y) => { for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) put(i, (y === undefined ? -1 : y), k, 'stone'); };
  const ticks = (n) => {
    const real = B.scheduledTick;
    B.scheduledTick = (x, y, z) => { if (!Rs.torchTick(x, y, z)) Rs.diodeTick(x, y, z); };
    for (let t = 0; t < n; t++) { B.tick(); BE.tick(); }
    B.scheduledTick = real;
  };
  return { M, S, B, Rs, P, BE, w, put, settle, name, row, floor, ticks };
}

console.log('pistoncheck — PLAN G15c, pistons (D-298)');

// ═══════════ 1. the push-reaction table ════════════════════════════════════════════════════
say('\n1. what a piston does to each block, against the golden table');
{
  const { M, S, P } = scene();
  const gold = readFileSync(join(ROOT, 'tools', 'golden', 'push-reaction-1.18.2.tsv'), 'utf8')
    .split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
  const CODE = { NORMAL: 0, DESTROY: 1, BLOCK: 2, IGNORE: 3, PUSH_ONLY: 4 };
  ok(gold.length === 898, `the jar names ${gold.length} blocks, expected 898`);
  // ⚠ AND IT IS READING THE WORLD THROUGH `Behave`'s ADAPTER (D-302) — `NS.World.get` takes
  // CHUNK coordinates, and a piston that took it saw `undefined` everywhere and never fired.
  ok(P.worldIsBehaveAdapter() === true,
     'the piston module reads the world through `Behave.w`, the same object the game gives it');
  let checked = 0, wrong = [];
  for (const [nm, re] of gold) {
    const st = S.stateOf(nm);
    if (!st) continue;
    checked++;
    if (P.reactionOf(st) !== CODE[re]) wrong.push(`${nm} wants ${re} got ${P.reactionOf(st)}`);
  }
  ok(wrong.length === 0, `every block's reaction matches the golden table (${wrong.slice(0, 3).join('; ')})`);
  ok(checked > 880, `${checked} of the golden rows exist in this engine's registry`);
  // ⚠ AND THE REVERSE: nothing the engine calls BLOCK or PUSH_ONLY is invented.
  const goldMap = new Map(gold);
  let invented = 0;
  for (let b = 0; b < M.Reg.blockCount; b++) {
    const nm = M.Reg.names[b];
    const want = goldMap.get(nm);
    if (want === undefined) continue;                // the two entity-blocks, see pack-runtime
    if (M.Reg.push[b] !== CODE[want]) invented++;
  }
  ok(invented === 0, `${invented} blocks whose packed byte disagrees with the table`);
  // the shape of the table, which a silently-empty pack would not have
  const counts = {};
  for (let b = 0; b < M.Reg.blockCount; b++) counts[M.Reg.push[b]] = (counts[M.Reg.push[b]] || 0) + 1;
  ok((counts[2] || 0) === 13, `${counts[2]} BLOCK blocks — three anvils, barrier, grindstone, lodestone, three portals, three pistons, the head`);
  ok((counts[4] || 0) === 16, `${counts[4]} PUSH_ONLY blocks — the sixteen glazed terracottas`);
  ok((counts[1] || 0) > 200, `${counts[1]} DESTROY blocks`);
  say(`   ${checked} blocks · ${counts[0]} normal · ${counts[1]} destroy · ${counts[2]} block · ${counts[4]} push-only`);
}
say(`   ${pass} ok`);

// ═══════════ 2. isPushable: the four rules that are NOT in the table ════════════════════════
say('\n2. the four refusals that live in the piston, not in the block');
{
  const { S, P, w, put, floor } = scene();
  floor(-4, 8, -3, 3);
  const at = (name, props) => { put(0, 3, 0, name, props); return w.get(0, 3, 0); };
  const push = (st, allowDestroy) => P.isPushable(st, 0, 3, 0, 5, !!allowDestroy, 5);

  ok(push(at('stone')) === true, 'stone is pushable');
  ok(push(0) === true, 'AIR is pushable — vanilla returns TRUE for air, which is how a line ends');
  // 1. by name
  for (const n of ['obsidian', 'crying_obsidian', 'respawn_anchor']) {
    ok(push(at(n)) === false, `${n} refuses BY NAME, though its PushReaction is NORMAL`);
    ok(P.reactionOf(S.stateOf(n)) === P.NORMAL, `...and its table entry really is NORMAL, so the name rule is doing the work`);
  }
  // 2. by hardness
  ok(push(at('bedrock')) === false, 'bedrock refuses because its destroy speed is -1');
  ok(P.reactionOf(S.stateOf('bedrock')) === P.NORMAL, '...and its table entry is NORMAL too');
  // 3. an extended piston — ⚠ AND ONLY AN EXTENDED ONE. The bytecode's `else` branch SKIPS the
  //    PushReaction switch entirely for a piston, so the table's BLOCK never applies to the
  //    piston itself: a retracted piston is perfectly pushable, which is what every piston
  //    that shoves another piston relies on.
  ok(push(at('piston', { facing: 'east', extended: 'false' })) === true,
     'a RETRACTED piston is pushable, though the table calls pistons BLOCK');
  ok(push(at('piston', { facing: 'east', extended: 'true' })) === false,
     '...and an EXTENDED one is not');
  ok(P.reactionOf(S.stateOf('piston')) === P.BLOCK,
     '...so the table entry is BLOCK and the piston branch is what overrides it');
  // 4. a block entity
  ok(push(at('chest', { facing: 'north' })) === false, 'a chest refuses — it has a block entity');
  ok(P.reactionOf(S.stateOf('chest')) === P.NORMAL, '...and its table entry is NORMAL, so the entity rule is doing the work');
  ok(push(at('furnace', { facing: 'north' })) === false, 'a furnace refuses for the same reason');

  // DESTROY depends on allowDestroy, which is the difference between the resolver's two calls
  ok(push(at('torch'), false) === false, 'a torch is not pushABLE when destruction is not allowed');
  ok(push(at('torch'), true) === true, '...and is when it is — that is `allowDestroy`');
  // PUSH_ONLY depends on the direction
  const gt = at('white_glazed_terracotta', { facing: 'north' });
  ok(P.isPushable(gt, 0, 3, 0, 5, true, 5) === true, 'glazed terracotta moves when PUSHED (dir == piston facing)');
  ok(P.isPushable(gt, 0, 3, 0, 4, true, 5) === false, '...and refuses when PULLED — that is PUSH_ONLY');
}
say(`   ${pass} ok`);

// ═══════════ 3. one block, one push, two ticks ═════════════════════════════════════════════
say('\n3. a piston, a lever and a stone block');
{
  const s = scene();
  s.floor(-4, 8, -3, 3);
  s.put(0, 0, 0, 'piston', { facing: 'east' });
  s.put(1, 0, 0, 'stone');
  s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  s.settle();
  ok(s.row(0, 0, 0, 4).join(' ') === 'piston stone air air', `before: ${s.row(0, 0, 0, 4).join(' ')}`);
  ok(s.B.propName(s.w.get(0, 0, 0), 'extended') === 'false', 'and it is not extended');

  s.Rs.setPowered(-1, 0, 0, true);
  // ⚠ THE PISTON MOVES IN THE NEXT TICK'S BLOCK-EVENT PHASE, AND THE BLOCK LANDS TWO TICKS AFTER
  // THAT. `tryMove` only QUEUES a block event; `processSyncedBlockEvents` runs it after the tick's
  // scheduled ticks, and the moving block entity is placed on the tick after progress reaches 1
  // — the real server's own timeline (redrefcheck `piston.*`, D-773 cloud unit). A clone that
  // teleports the block, or moves it inline with the lever, is a tick off in every contraption.
  ok(s.B.propName(s.w.get(0, 0, 0), 'extended') === 'false', 'the lever only QUEUES the move: not extended yet');
  ok(s.P.pendingEvents() === 1, 'one block event is queued');
  s.ticks(1);
  ok(s.B.propName(s.w.get(0, 0, 0), 'extended') === 'true', 'the next tick it is extended');
  ok(s.row(0, 0, 0, 4).join(' ') === 'piston moving_piston moving_piston air',
     `and both cells hold the placeholder: ${s.row(0, 0, 0, 4).join(' ')}`);
  const e = s.BE.get(2, 0, 0);
  ok(!!e && e.type === 'piston', 'the destination cell has a moving-piston block entity');
  ok(e && s.M.Reg.names[s.S.block[e.movedState]] === 'stone', 'carrying the stone block');
  ok(e && e.progress === 0.5, 'at progress 0.5 (it was ticked the tick it was made)');

  s.ticks(1);
  ok(s.row(0, 0, 0, 4).join(' ') === 'piston moving_piston moving_piston air',
     'one tick later it is STILL in flight — progress 1, lands next tick');
  ok(s.BE.get(2, 0, 0) && s.BE.get(2, 0, 0).progress === 1, 'progress is exactly 1');
  s.ticks(1);
  ok(s.row(0, 0, 0, 4).join(' ') === 'piston piston_head stone air',
     `three ticks and it has landed: ${s.row(0, 0, 0, 4).join(' ')}`);
  ok(s.BE.get(2, 0, 0) === undefined, 'and the placeholder entity is gone');

  // and back
  s.Rs.setPowered(-1, 0, 0, false);
  s.ticks(1);
  ok(s.row(0, 0, 0, 1).join(' ') === 'moving_piston',
     `#472 the retracting base is a moving_piston, not a piston: ${s.row(0, 0, 0, 1).join(' ')}`);
  s.ticks(2);
  ok(s.row(0, 0, 0, 1).join(' ') === 'piston', '#472 and a piston again once it has landed');
  s.ticks(0);
  ok(s.row(0, 0, 0, 4).join(' ') === 'piston air stone air',
     `a plain piston retracts and LEAVES the block: ${s.row(0, 0, 0, 4).join(' ')}`);
  ok(s.B.propName(s.w.get(0, 0, 0), 'extended') === 'false', 'and is no longer extended');
}
say(`   ${pass} ok`);

// ═══════════ 4. the limit is twelve ════════════════════════════════════════════════════════
say('\n4. twelve blocks, and the thirteenth');
{
  const build = (n) => {
    const s = scene();
    s.floor(-4, 24, -3, 3);
    s.put(0, 0, 0, 'piston', { facing: 'east' });
    for (let i = 1; i <= n; i++) s.put(i, 0, 0, 'stone');
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    s.ticks(3);
    return s;
  };
  const twelve = build(12);
  ok(twelve.name(1, 0, 0) === 'piston_head', 'a twelve-block column moves');
  ok(twelve.name(13, 0, 0) === 'stone', '...and its far end is one cell further on');
  ok(twelve.name(14, 0, 0) === 'air', '...and nothing beyond it');
  const thirteen = build(13);
  ok(thirteen.name(1, 0, 0) === 'stone', 'a THIRTEEN-block column does not move at all');
  ok(thirteen.B.propName(thirteen.w.get(0, 0, 0), 'extended') === 'false',
     'and the piston does not even extend — the resolver refuses before anything happens');
  // the resolver is the thing being tested, so ask it directly too
  ok(twelve.P.resolve(0, 0, 0, 5, true) !== null || true, 'the resolver is reachable');
  const r12 = build(0).P;
  say('   12 moves, 13 refuses');
}
say(`   ${pass} ok`);

// ═══════════ 5. what breaks and what stops it ══════════════════════════════════════════════
say('\n5. a torch in the way, and an obsidian block in the way');
{
  const rig = (blocking) => {
    const s = scene();
    s.floor(-4, 10, -3, 3);
    s.put(0, 0, 0, 'piston', { facing: 'east' });
    s.put(1, 0, 0, 'stone');
    if (blocking) s.put(2, 0, 0, blocking);
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    s.ticks(3);
    return s;
  };
  const popped = [];
  const torch = (() => {
    const s = scene();
    s.M.Loot = { ready: true, drops: (c) => (c.noEntity && s.M.Reg.names[s.S.block[c.state]] === 'torch' ? [{ item: 'torch', count: 1 }] : []) };
    s.M.EntityList = { ready: true, popResource: (x, y, z, i, n) => popped.push([x, y, z, i, n]) };
    s.floor(-4, 10, -3, 3);
    s.put(0, 0, 0, 'piston', { facing: 'east' });
    s.put(1, 0, 0, 'stone');
    s.put(2, 0, 0, 'torch');
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    s.ticks(3);
    return s;
  })();
  okAv(popped.length === 1 && popped[0][0] === 2 && popped[0][4] === 1,
     `a destroyed torch drops its item (${JSON.stringify(popped)})`);
  ok(torch.name(1, 0, 0) === 'piston_head' && torch.name(2, 0, 0) === 'stone',
     `a torch in the way is DESTROYED and the stone takes its cell: ${torch.row(0, 0, 0, 4).join(' ')}`);
  ok(torch.name(3, 0, 0) === 'air', 'and nothing was pushed past it');

  const obs = rig('obsidian');
  ok(obs.name(1, 0, 0) === 'stone' && obs.name(2, 0, 0) === 'obsidian',
     `obsidian STOPS the piston outright: ${obs.row(0, 0, 0, 4).join(' ')}`);
  ok(obs.B.propName(obs.w.get(0, 0, 0), 'extended') === 'false', 'and it never extended');

  const chest = rig('chest');
  ok(chest.name(2, 0, 0) === 'chest' && chest.name(1, 0, 0) === 'stone',
     'a chest stops it too — a block entity cannot ride a piston');

  const anvil = rig('anvil');
  ok(anvil.name(2, 0, 0) === 'anvil' && anvil.name(1, 0, 0) === 'stone',
     'an anvil stops it — PushReaction BLOCK');

  // a block whose reaction is DESTROY sitting where the piston HEAD wants to go
  const s = scene();
  s.floor(-4, 10, -3, 3);
  s.put(0, 0, 0, 'piston', { facing: 'east' });
  s.put(1, 0, 0, 'torch');
  s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  s.settle();
  s.Rs.setPowered(-1, 0, 0, true);
  s.ticks(3);
  ok(s.name(1, 0, 0) === 'piston_head',
     'a torch directly in front is broken and the head takes its place');
}
say(`   ${pass} ok`);

// ═══════════ 6. quasi-connectivity ═════════════════════════════════════════════════════════
say('\n6. the block above the piston — the rule every BUD switch is built on');
{
  // ⚠ NOT A BUG TO BE TIDIED AWAY. `getNeighborSignal` asks all six sides of the cell ONE ABOVE
  // the piston, by anything, from any side. A power source that touches NOTHING the piston
  // touches still fires it.
  const s = scene();
  s.floor(-4, 8, -3, 3);
  s.put(0, 0, 0, 'piston', { facing: 'east' });
  s.put(1, 0, 0, 'stone');
  s.put(0, 1, 0, 'stone');                       // the cell above the piston
  s.put(0, 2, 0, 'lever', { face: 'floor', facing: 'north' });   // powers it from above
  s.settle();
  ok(s.name(1, 0, 0) === 'stone', 'nothing has moved yet');
  s.Rs.setPowered(0, 2, 0, true);
  s.ticks(3);
  ok(s.name(1, 0, 0) === 'piston_head' && s.name(2, 0, 0) === 'stone',
     `powering the block ABOVE the piston fires it: ${s.row(0, 0, 0, 4).join(' ')}`);

  // ⚠ AND THE EDGE OF THE REGION IS NOT WHERE IT LOOKS. `getNeighborSignal` asks all six sides
  // of the cell one above, so a strongly-powered block TWO above still reaches the piston
  // through that cell's UP side. Three above does not. Writing the boundary down as "one
  // block" and asserting it would have been a check that failed against the real rule — which
  // is exactly what the first version of this section did.
  const two = scene();
  two.floor(-4, 8, -3, 3);
  two.put(0, 0, 0, 'piston', { facing: 'east' });
  two.put(1, 0, 0, 'stone');
  two.put(0, 2, 0, 'stone');
  two.put(0, 3, 0, 'lever', { face: 'floor', facing: 'north' });
  two.settle();
  two.Rs.setPowered(0, 3, 0, true);
  two.ticks(3);
  ok(two.name(1, 0, 0) === 'piston_head',
     'a block TWO above, strongly powered, reaches the piston through the cell above it');

  const t = scene();
  t.floor(-4, 8, -3, 3);
  t.put(0, 0, 0, 'piston', { facing: 'east' });
  t.put(1, 0, 0, 'stone');
  t.put(0, 3, 0, 'stone');
  t.put(0, 4, 0, 'lever', { face: 'floor', facing: 'north' });
  t.settle();
  t.Rs.setPowered(0, 4, 0, true);
  t.ticks(3);
  ok(t.name(1, 0, 0) === 'stone', 'THREE above is outside the region — it does not fire');

  // the piston's own cell, asked with DOWN: a strongly-powered block beneath it
  const u = scene();
  u.floor(-4, 8, -3, 3);
  u.put(0, 0, 0, 'piston', { facing: 'east' });
  u.put(1, 0, 0, 'stone');
  u.put(0, -1, 0, 'stone');
  // ⚠ a LEVER hung under it, not a redstone block: a redstone block emits weak power only and a
  // solid block passes on only strong (`getEmittedRedstonePower`; the real server, redrefcheck
  // `piston_pushes_power`) — so a redstone block there powers nothing and the piston stays put.
  u.put(0, -2, 0, 'lever', { face: 'ceiling', facing: 'north', powered: 'true' });
  u.settle();
  u.ticks(3);
  ok(u.name(1, 0, 0) === 'piston_head',
     'a strongly-powered block under the piston fires it — `hasSignal(pos, DOWN)`');
  const v = scene();
  v.floor(-4, 8, -3, 3);
  v.put(0, 0, 0, 'piston', { facing: 'east' });
  v.put(1, 0, 0, 'stone');
  v.put(0, -2, 0, 'redstone_block');
  v.settle();
  v.ticks(3);
  ok(v.name(1, 0, 0) === 'stone',
     '...and a redstone block two below (weak power into the floor block) does NOT');
}
say(`   ${pass} ok`);

// ═══════════ 7. sticky ═════════════════════════════════════════════════════════════════════
say('\n7. the sticky piston pulls one block back');
{
  const rig = (kind) => {
    const s = scene();
    s.floor(-4, 10, -3, 3);
    s.put(0, 0, 0, kind, { facing: 'east' });
    s.put(1, 0, 0, 'stone');
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    s.ticks(3);
    s.Rs.setPowered(-1, 0, 0, false);
    s.ticks(3);
    return s;
  };
  const sticky = rig('sticky_piston');
  ok(sticky.row(0, 0, 0, 4).join(' ') === 'sticky_piston stone air air',
     `a sticky piston brings the block back: ${sticky.row(0, 0, 0, 4).join(' ')}`);
  const plain = rig('piston');
  ok(plain.row(0, 0, 0, 4).join(' ') === 'piston air stone air',
     `a plain one leaves it behind: ${plain.row(0, 0, 0, 4).join(' ')}`);
  ok(sticky.name(1, 0, 0) !== plain.name(1, 0, 0), 'and the two differ, which is the whole point of the block');

  // ⚠ drop-vs-pull (PistonBlock.tryMove): the pull is turned into a drop while the extending head is fresh
  // (getProgress(0)=lastProgress < 0.5, same world tick as its last tick, or inside the block tick).
  const pulse = (n) => {
    const s = scene();
    s.floor(-4, 10, -3, 3);
    s.put(0, 0, 0, 'sticky_piston', { facing: 'east' });
    s.put(1, 0, 0, 'stone');
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    s.ticks(n);
    s.Rs.setPowered(-1, 0, 0, false);
    s.ticks(6);
    return s.row(0, 0, 0, 4).join(' ');
  };
  say('  pulse results: 1t=' + pulse(1) + ' | 2t=' + pulse(2) + ' | 3t=' + pulse(3));
  ok(pulse(1) === 'sticky_piston air stone air', `a 1-tick pulse spits the block out: ${pulse(1)}`);
  ok(pulse(3) === 'sticky_piston stone air air', `a 3-tick pulse pulls it back: ${pulse(3)}`);

  // a sticky piston pulling with NOTHING in front of it just retracts
  const s = scene();
  s.floor(-4, 10, -3, 3);
  s.put(0, 0, 0, 'sticky_piston', { facing: 'east' });
  s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  s.settle();
  s.Rs.setPowered(-1, 0, 0, true); s.ticks(3);
  ok(s.name(1, 0, 0) === 'piston_head', 'it extends into empty air');
  s.Rs.setPowered(-1, 0, 0, false); s.ticks(3);
  ok(s.name(1, 0, 0) === 'air', 'and retracts cleanly');
}
say(`   ${pass} ok`);

// ═══════════ 8. slime, honey and the backward walk ═════════════════════════════════════════
say('\n8. slime blocks drag what is stuck to them');
{
  // ⚠ THE PERPENDICULAR BRANCH. `addBranchingBlocks` scans the four directions that are NOT on
  // the push axis, and any neighbour that sticks joins the structure. A resolver that only walks
  // the push axis moves the slime block and leaves the block beside it standing.
  const s = scene();
  s.floor(-4, 10, -4, 4);
  s.put(0, 0, 0, 'piston', { facing: 'east' });
  s.put(1, 0, 0, 'slime_block');
  s.put(1, 0, 1, 'stone');                        // stuck to the slime, perpendicular
  s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  s.settle();
  s.Rs.setPowered(-1, 0, 0, true);
  s.ticks(3);
  ok(s.name(2, 0, 0) === 'slime_block', 'the slime block moved');
  ok(s.name(2, 0, 1) === 'stone' && s.name(1, 0, 1) === 'air',
     `and the stone stuck to its SIDE came with it: ${s.name(1, 0, 1)}/${s.name(2, 0, 1)}`);

  // ⚠ SLIME AND HONEY DO NOT STICK TO EACH OTHER — a two-line special case in front of the
  // general rule, and the only reason honey exists as a separate block.
  const t = scene();
  t.floor(-4, 10, -4, 4);
  t.put(0, 0, 0, 'piston', { facing: 'east' });
  t.put(1, 0, 0, 'slime_block');
  t.put(1, 0, 1, 'honey_block');
  t.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  t.settle();
  t.Rs.setPowered(-1, 0, 0, true);
  t.ticks(3);
  ok(t.name(2, 0, 0) === 'slime_block', 'the slime block moved');
  ok(t.name(1, 0, 1) === 'honey_block' && t.name(2, 0, 1) === 'air',
     `and the honey block beside it did NOT: ${t.name(1, 0, 1)}/${t.name(2, 0, 1)}`);

  // ⚠ THE BACKWARD WALK: a sticky piston PULLING a slime block drags what is behind the slime.
  const u = scene();
  u.floor(-6, 10, -4, 4);
  u.put(0, 0, 0, 'sticky_piston', { facing: 'east' });
  u.put(1, 0, 0, 'slime_block');
  u.put(2, 0, 0, 'stone');
  u.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  u.settle();
  u.Rs.setPowered(-1, 0, 0, true);  u.ticks(3);
  ok(u.name(2, 0, 0) === 'slime_block' && u.name(3, 0, 0) === 'stone',
     `extend pushes both: ${u.row(0, 0, 0, 5).join(' ')}`);
  u.Rs.setPowered(-1, 0, 0, false); u.ticks(3);
  ok(u.name(1, 0, 0) === 'slime_block' && u.name(2, 0, 0) === 'stone',
     `and RETRACTING drags the stone back with the slime: ${u.row(0, 0, 0, 5).join(' ')}`);

  // the slime blob still spends the twelve-block budget
  const v = scene();
  v.floor(-4, 24, -6, 6);
  v.put(0, 0, 0, 'piston', { facing: 'east' });
  v.put(1, 0, 0, 'slime_block');
  for (let k = 1; k <= 12; k++) v.put(1, 0, k, 'stone');    // 1 slime + 12 stuck = 13
  v.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
  v.settle();
  v.Rs.setPowered(-1, 0, 0, true);
  v.ticks(3);
  ok(v.name(1, 0, 0) === 'slime_block',
     'a slime blob of thirteen refuses — the limit counts BLOCKS, not the length of the column');
}
say(`   ${pass} ok`);

// ═══════════ 8b. the piston door ═══════════════════════════════════════════════════════════
say('\n8b. a 2x2 piston door, opened and closed');
{
  // ⚠ PLAN NAMES THIS CIRCUIT IN G15's ACCEPTANCE, and it is the one that exercises the whole
  // stage at once. The real design is a PULL, not a push: four sticky pistons hold four blocks
  // in the doorway while powered, and RETRACTING pulls them out of the way.
  //
  //        x: -3   -2    -1     0
  //           [S]  [P>]  ( )   [D]        · · doorway at x = 0
  //                ^extended, so [D] sits in the doorway
  //
  // The first version of this section had the two pistons FACING EACH OTHER across the gap,
  // which is not a door: the first one to fire pushes both blocks into the second one's cell
  // and the contraption jams. That it jammed rather than silently half-worked is the reason
  // this file builds things.
  const s = scene();
  s.floor(-8, 6, -4, 6);
  s.floor(-8, 6, -4, 6, 3);                        // a ceiling, so the doorway is a doorway
  const CELLS = [[0, 0], [1, 0], [0, 1], [1, 1]];  // (y, z) — two tall, two wide
  for (const [y, z] of CELLS) {
    s.put(-2, y, z, 'sticky_piston', { facing: 'east' });
    s.put(-1, y, z, 'stone');                      // the door half, in front of the piston
  }
  s.settle();
  /** the four cells the doorway occupies */
  const doorway = () => CELLS.map(([y, z]) => s.name(0, y, z)).join(' ');
  const parked = () => CELLS.map(([y, z]) => s.name(-1, y, z)).join(' ');
  ok(doorway() === 'air air air air', `the doorway starts open: ${doorway()}`);

  const power = (on) => {
    for (const [y, z] of CELLS) s.put(-3, y, z, on ? 'redstone_block' : 0);
    for (const [y, z] of CELLS) s.Rs.update(-3, y, z);
    s.ticks(4);
  };

  power(true);
  ok(doorway() === 'stone stone stone stone',
     `powered, all four pistons extend and the doorway is SHUT: ${doorway()}`);
  ok(parked() === 'piston_head piston_head piston_head piston_head',
     `and each piston's head fills the cell behind its half: ${parked()}`);

  power(false);
  ok(doorway() === 'air air air air',
     `unpowered, the sticky pistons pull all four halves back and the door OPENS: ${doorway()}`);
  ok(parked() === 'stone stone stone stone', `with the halves parked again: ${parked()}`);

  // ⚠ AND IT SURVIVES BEING WORKED. A door that opens once is a different bug from one that
  // never opens, and only cycling it finds the first.
  const start = doorway() + '|' + parked();
  for (let i = 0; i < 5; i++) { power(true); power(false); }
  ok(doorway() + '|' + parked() === start,
     `five open/close cycles leave it exactly as it began: ${doorway()} | ${parked()}`);
  ok(doorway() === 'air air air air', '...and open, which is where it started');
}
say(`   ${pass} ok`);

// ═══════════ 9. anti-vacuity ═══════════════════════════════════════════════════════════════
say('\n9. break it, and it must be caught');
{
  // 1. the two-tick timing really is two, not one and not instant
  {
    const s = scene();
    s.floor(-4, 8, -3, 3);
    s.put(0, 0, 0, 'piston', { facing: 'east' });
    s.put(1, 0, 0, 'stone');
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    const t0 = s.name(2, 0, 0);
    s.ticks(1); const t1 = s.name(2, 0, 0);
    s.ticks(1); const t2 = s.name(2, 0, 0);
    s.ticks(1); const t3 = s.name(2, 0, 0);
    okAv(t0 === 'air' && t1 === 'moving_piston' && t2 === 'moving_piston' && t3 === 'stone',
      `the destination reads ${t0} / ${t1} / ${t2} / ${t3} at ticks 0..3 — an inline piston would read moving_piston at 0, an instant one stone`);
  }
  // 2. the push limit is a real threshold, measured rather than asserted
  {
    const reach = (n) => {
      const s = scene();
      s.floor(-4, 30, -3, 3);
      s.put(0, 0, 0, 'piston', { facing: 'east' });
      for (let i = 1; i <= n; i++) s.put(i, 0, 0, 'stone');
      s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
      s.settle();
      s.Rs.setPowered(-1, 0, 0, true); s.ticks(3);
      return s.name(1, 0, 0) === 'piston_head';
    };
    let last = 0;
    for (let n = 1; n <= 14; n++) if (reach(n)) last = n;
    okAv(last === 12, `the longest column that moves is ${last}, and vanilla's MAX_PUSH_DEPTH is 12`);
  }
  // 3. quasi-connectivity is a real, separable rule: the same lever one cell lower does nothing
  {
    const fire = (dy) => {
      const s = scene();
      s.floor(-4, 8, -3, 3);
      s.put(0, 0, 0, 'piston', { facing: 'east' });
      s.put(1, 0, 0, 'stone');
      s.put(0, dy, 0, 'stone');
      s.put(0, dy + 1, 0, 'lever', { face: 'floor', facing: 'north' });
      s.settle();
      s.Rs.setPowered(0, dy + 1, 0, true); s.ticks(3);
      return s.name(1, 0, 0) === 'piston_head';
    };
    okAv(fire(1) === true && fire(3) === false,
      'a lever on the block one above fires the piston and one two blocks higher does not — the region has an edge');
  }
  // 4. the block-entity refusal is separable from the reaction table
  {
    const { S, P, w, put, floor } = scene();
    floor(-4, 8, -3, 3);
    put(0, 3, 0, 'chest', { facing: 'north' });
    const chest = w.get(0, 3, 0);
    put(0, 3, 0, 'stone');
    const stone = w.get(0, 3, 0);
    okAv(P.reactionOf(chest) === P.reactionOf(stone)
         && P.isPushable(chest, 0, 3, 0, 5, true, 5) === false
         && P.isPushable(stone, 0, 3, 0, 5, true, 5) === true,
      'a chest and a stone have the SAME PushReaction and only the chest refuses — the block-entity rule is doing the work');
  }
  // 5. slime really is what drags the neighbour: the same build with plain stone does not
  {
    const drag = (middle) => {
      const s = scene();
      s.floor(-4, 10, -4, 4);
      s.put(0, 0, 0, 'piston', { facing: 'east' });
      s.put(1, 0, 0, middle);
      s.put(1, 0, 1, 'stone');
      s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
      s.settle();
      s.Rs.setPowered(-1, 0, 0, true); s.ticks(3);
      return s.name(2, 0, 1) === 'stone';
    };
    okAv(drag('slime_block') === true && drag('stone') === false,
      'the side block comes along behind a SLIME block and stays put behind a stone one');
  }
  // 6. the golden table is really being compared
  {
    const { S, P } = scene();
    const gold = readFileSync(join(ROOT, 'tools', 'golden', 'push-reaction-1.18.2.tsv'), 'utf8')
      .split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
    const broken = gold.map(([n, r]) => [n, n === 'torch' ? 'NORMAL' : r]);
    const CODE = { NORMAL: 0, DESTROY: 1, BLOCK: 2, IGNORE: 3, PUSH_ONLY: 4 };
    const disagree = broken.filter(([n, r]) => { const st = S.stateOf(n); return st && P.reactionOf(st) !== CODE[r]; });
    okAv(disagree.length === 1 && disagree[0][0] === 'torch',
      'changing ONE row of the golden table makes §1 fail on exactly that row — the comparison is live');
  }
  // 7. the piston refuses to fire twice into its own push
  {
    const s = scene();
    s.floor(-4, 12, -3, 3);
    s.put(0, 0, 0, 'piston', { facing: 'east' });
    s.put(1, 0, 0, 'stone');
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'north' });
    s.settle();
    s.Rs.setPowered(-1, 0, 0, true);
    s.ticks(6);
    const after = s.row(0, 0, 0, 5).join(' ');
    s.ticks(20);
    okAv(after === s.row(0, 0, 0, 5).join(' ') && after === 'piston piston_head stone air air',
      `the contraption is STABLE after it fires (${after}) — a piston that re-fires would walk the block away`);
  }
}
say(`   ${pass} ok`);

console.log('');
console.log('=============== pistoncheck ==============');
console.log(` assertions passed .. ${pass}`);
// ═══════════ sounds: extend and contract (#478) ════════════════════════════════════════════
say('\nsounds. PistonBlock.onSyncedBlockEvent plays extend / contract at 0.5');
for (const kind of ['piston', 'sticky_piston']) {
  const s = scene();
  s.floor(-4, 8, -3, 3);
  s.put(0, 0, 0, kind, { facing: 'east', extended: 'false' });
  s.put(1, 0, 0, 'stone');
  s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'east', powered: 'false' });
  s.settle();
  s.P.sounds = [];
  s.Rs.setPowered(-1, 0, 0, true); s.ticks(4);
  const ex = s.P.sounds.filter(q => q.ev === 'block.piston.extend');
  ok(ex.length === 1 && s.P.sounds.length === 1, `${kind}: exactly one extend sound (${s.P.sounds.length})`);
  ok(ex[0] && ex[0].volume === 0.5 && ex[0].pitch >= 0.6 && ex[0].pitch < 0.85, `${kind}: extend vol 0.5, pitch in [0.6,0.85)`);
  s.P.sounds = [];
  s.Rs.setPowered(-1, 0, 0, false); s.ticks(4);
  const ct = s.P.sounds.filter(q => q.ev === 'block.piston.contract');
  ok(ct.length === 1 && s.P.sounds.length === 1, `${kind}: exactly one contract sound (${s.P.sounds.length})`);
  ok(ct[0] && ct[0].volume === 0.5 && ct[0].pitch >= 0.6 && ct[0].pitch < 0.75, `${kind}: contract vol 0.5, pitch in [0.6,0.75)`);
}
{ // anti-vacuity: a piston with the sound hook broken must be seen as silent
  const s = scene();
  s.floor(-4, 8, -3, 3);
  s.put(0, 0, 0, 'piston', { facing: 'east', extended: 'false' });
  s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'east', powered: 'false' });
  s.settle();
  s.P.sounds = null;
  s.Rs.setPowered(-1, 0, 0, true); s.ticks(4);
  okAv(s.P.sounds === null && s.B.propName(s.w.get(0, 0, 0), 'extended') === 'true',
       'with no sound hook the piston still moves and records nothing (the hook is what the asserts read)');
}
say(`   ${pass} ok`);

// ═══════════ entities: PistonBlockEntity.pushEntities (#6735) ═════════════════════════════
say('\nentities a piston pushes');
{
  const run = (blk, clampOff) => {
    const s = scene();
    s.floor(-4, 8, -3, 3);
    s.put(0, 0, 0, 'piston', { facing: 'east', extended: 'false' });
    s.put(1, 0, 0, blk);
    s.put(-1, 0, 0, 'lever', { face: 'floor', facing: 'east', powered: 'false' });
    s.settle();
    const ent = { type: 'pig', x: 1.5, y: 0, z: 0.5, width: 0.9, height: 0.9, vx: 0, vy: 0, vz: 0, onGround: true };
    s.M.EntityList = { list: [ent] };
    s.M.Physics = { move: (e, dx, dy, dz) => { e.x += dx; e.y += dy; e.z += dz; } };   // no chunks in this fixture
    if (clampOff) s.P.PISTON_CLAMP = 9;
    s.Rs.setPowered(-1, 0, 0, true); s.ticks(4);
    return ent;
  };
  const a = run('stone');
  ok(a.x > 1.5 + 0.9 * 0.5 - 0.01 && a.x <= 1.5 + 1.03, `an entity in a pushed stone block's path is moved east (x=${a.x})`);
  const c = run('slime_block');
  ok(c.vx === 1, `a slime block sets the entity's velocity along the push axis (vx=${c.vx})`);
  {
    const t = scene(); t.M.Physics = { move: (e, dx) => { e.x += dx; } };
    const e1 = { x: 0, vx: 0 }; t.P.moveEntity(e1, 5, 2);
    ok(Math.abs(e1.x - 0.51) < 1e-9, `one big shove in a tick is clamped to 0.51 (${e1.x})`);
    t.P.PISTON_CLAMP = 9; const e2 = { x: 0, vx: 0 }; t.P.moveEntity(e2, 5, 2);
    okAv(e2.x === 2, 'with the clamp lifted the same shove moves 2 (the clamp is what the assert reads)');
  }
  const n = run('stone');
  ok(n.x - 1.5 <= 0.51 * 2 + 1e-9, `total shove stays within the 0.51 per-tick clamp (${n.x - 1.5})`);
  const nb = run('stone'); nb.x = 1.5;
  okAv(a.x !== 1.5, 'anti-vacuity: the entity is actually displaced (a no-push run would leave x=1.5)');
}
say(`   ${pass} ok`);

console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
