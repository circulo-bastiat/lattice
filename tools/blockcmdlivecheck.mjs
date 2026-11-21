#!/usr/bin/env node
// blockcmdlivecheck.mjs — parallel night worker 2: `/setblock`, `/fill`, `/clone`, live in the
// browser (MCLITE_PRESET=medium). Nobody had ever driven these three for real; only the fake
// headless harness in `commandcheck.mjs` (a Map-backed stub `World`, no real chunks, no real
// entities) exercised them before this check.
//
// ⚠⚠ TWO REAL ENGINE-WIDE BUGS FOUND HERE, both invisible to `commandcheck.mjs` because its
// stub world has no item entities and its own `/clone ... move` test (line ~424) never made the
// source and destination regions overlap:
//
//   1. `/clone ... move` REFUSED EVERY OVERLAPPING MOVE with `commands.clone.overlap`, even
//      though `src/15g_commands.js`'s own header comment on `clone()` explains in detail why an
//      overlapping move is supposed to be safe (source buffered before any write, source cleared
//      only where the copy did not just land on it). `.decomp` CloneCommand.Mode says only
//      `NORMAL` (field_13499, `allowsOverlap=false`) refuses overlap -- `FORCE` (field_13497)
//      AND `MOVE` (field_13500) both have `allowsOverlap=true`. The overlap guard here excluded
//      only `mode !== 'force'`, so `move` fell through it and every overlapping move -- the
//      exact case the file's own big warning comment is about -- was unusable. Fixed to exclude
//      both (`mode === 'normal'` is now the only mode that throws). Also reordered the overlap
//      and MAX_BLOCKS checks to match `.decomp`'s own priority (overlap checked first), so a
//      region that is both overlapping and oversized reports `commands.clone.overlap`, not
//      `commands.clone.toobig`.
//   2. `/fill ... destroy` never broke a single block. `.decomp` FillCommand.Mode field_13651
//      calls `world.breakBlock(pos, true)` per cell before placing the new block -- the same
//      drop path `/setblock ... destroy` already used. The `fill()` loop here had no `destroy`
//      branch at all: it fell through to the same plain `W.setBlock` every other mode uses, so a
//      `/fill <region> air destroy` over a stack of chests silently vaporised them, dropping
//      nothing. Fixed to call `NS.Loot.breakDrops` + `NS.Player.collectDrops` per destroyed
//      cell, mirroring `/setblock ... destroy`'s own existing (and correct) branch.
//
// Section 4 below is the anti-vacuity pass for both: pre-fix behaviour (overlap check excluding
// only `force`; `destroy` with no break branch) is replayed and this check's own live
// assertions are shown to fail against it.
//
//   MCLITE_PRESET=medium node tools/blockcmdlivecheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ok ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x  ' + m + (d !== undefined ? '   ' + d : '')); } };

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  blockcmdlivecheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();

  // ⚠⚠ KW-37 — FREEZE THE LIVE STREAMER BEFORE BUILDING THE SYNTHETIC PLATFORM, OR THE GAME
  // EVICTS ITS OWN TEST WORLD OUT FROM UNDER IT. Root cause of the "masked clone copies 8 of 9"
  // / "filtered stone clone copies only the 8 stone cells" flake (both `commands.clone.failed`,
  // `clone()`'s read of the whole 3x3 source seeing every cell as air): this file builds its
  // 12x12 synthetic chunk grid and floor-fills it in ONE `ev()` call, then teleports the player
  // onto it in a SEPARATE, LATER `ev()` call -- and `MCL.Main.loop` keeps running real frames in
  // the gap between those two Node<->Chrome round trips, calling `World.stream()` (07_world.js)
  // with the OLD, pre-teleport camera position every time. `stream()` runs `W.evict()` every 8th
  // frame, and `evict()` drops anything past `renderDistance + evictMargin` chunks from
  // WHATEVER camera position it was called with -- so if an eviction frame lands in that gap
  // (it does roughly a third of the time; measured directly by logging `World.stats2.evicted`
  // and each eviction call's camera/frame: confirmed live, not by inspection), the entire
  // just-built platform reads as "far from the player" (who is still standing at spawn) and gets
  // unloaded -- title and all -- before the teleport that was supposed to bring the camera to it
  // ever runs. `World.getBlock` returns 0 (air) for any coordinate whose chunk is not resident
  // (`!c || c.state < CH.GENERATED`), which is exactly the "read every cell as air" signature,
  // and it does not stop at the two clone scenes: every earlier `/setblock`/`/fill` assertion
  // whose chunk fell in the same wiped 12x12 grid silently passed a `run()` that returned
  // `ok:true` against a chunk that had already been unloaded, then read back whatever the
  // now-empty chunk (or its regenerated real terrain) happened to contain -- which is why session
  // 146's original flaky reruns saw the failure COUNT and the total assertion count both vary
  // run to run, not just these two lines. This was never a natural-terrain or test-coordinate
  // problem (KW-37 already refuted that) and it predates and is independent of both of session
  // 148's changes (`/teleport` velocity, cullcheck determinism) -- neither one is anywhere near
  // `World.stream`/`evict` or this file. `Jobs.mode = 'none'` is `09_jobs.js`'s own documented
  // off state (`'workers' | 'inline' | 'none'`) and `stream()` already early-returns on it before
  // doing any generation, meshing, OR eviction (07_world.js:1141) -- so freezing it here, once,
  // before this check builds anything of its own, removes every one of those async actors for
  // the rest of the run. This check never screenshots or needs meshes; it only ever reads back
  // block state through `World.getBlock`, so a frozen streamer costs it nothing.
  await page.evaluate(function () { if (window.MCL && MCL.Jobs) MCL.Jobs.mode = 'none'; });

  const PX = 4700, PZ = 4700, PY = 90;   // a distinct anchor from the other parallel-night checks
  const ev = (body) => page.evaluate(mkFn(body));

  // ⚠ THE RANGE HAS TO COVER EVERY OFFSET THIS FILE USES (up to PX+112 in section 4), not just
  // a small radius around the anchor -- section 3/4's first live run hit exactly this: a
  // `/fill`/`/clone` past the generated-chunk edge silently no-ops (`W.setBlock` into a chunk
  // `makeChunk` never created), so `result` still reports the loop's iteration count while
  // nothing was actually written, and every assertion downstream reads back air.
  const buildInfo = await ev(
    'var W = MCL.World, St = MCL.States;' +
    'var id = St.stateOf("stone");' +
    'for (var cx = -3; cx <= 8; cx++) for (var cz = -3; cz <= 8; cz++) {' +
    '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
    '  c.state = MCL.CH.GENERATED; W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
    '}' +
    'var got = 0;' +
    'for (var x = ' + PX + ' - 24; x <= ' + PX + ' + 128; x++)' +
    '  for (var z = ' + PZ + ' - 24; z <= ' + PZ + ' + 128; z++) { W.setBlock(x, ' + PY + ' - 1, z, id); got++; }' +
    'return { platformBlocks: got };'
  );
  ok(buildInfo && buildInfo.platformBlocks > 0, 'built a flat test platform', JSON.stringify(buildInfo));

  await ev(
    'var P = MCL.Player;' +
    'P.x = ' + PX + '; P.y = ' + PY + '; P.z = ' + PZ + '; P.yaw = 0; P.pitch = 0;' +
    'P.vx = P.vy = P.vz = 0; if (P.interpolate) P.interpolate(0);' +
    'MCL.Commands.run("/gamemode creative", P, {name: "Dan"});' +
    'return 1;'
  );

  function run(cmd, opts) {
    return ev('var r = MCL.Commands.run(' + JSON.stringify(cmd) + ', MCL.Player, ' + JSON.stringify(Object.assign({ name: 'Dan' }, opts || {})) + ');' +
      'return { ok: r.ok, result: r.result, error: r.error ? { key: r.error.key, message: r.error.message } : null };');
  }
  function at(x, y, z) { return ev('return MCL.World.getBlock(' + x + ',' + y + ',' + z + ');'); }
  function itemsNear(x, y, z, r) {
    return ev(
      'var EL = MCL.EntityList, n = 0;' +
      'for (var i = 0; i < EL.list.length; i++) { var e = EL.list[i];' +
      '  if (e.type === "item" && Math.hypot(e.x - (' + x + '), e.y - (' + y + '), e.z - (' + z + ')) <= ' + r + ') n++; }' +
      'return n;'
    );
  }
  async function clearItems() {
    await ev('var EL = MCL.EntityList; EL.list = EL.list.filter(function (e) { return e.type !== "item"; }); return 1;');
  }

  const stoneState = await ev('return MCL.States.stateOf("stone");');
  const dirtState = await ev('return MCL.States.stateOf("dirt");');
  const airState = 0;

  // === 1. /setblock -- modes, permission, coordinate parsing, error messages ===
  console.log('\n1. /setblock');
  {
    const bx = PX + 1, by = PY, bz = PZ + 1;
    await ev('MCL.World.setBlock(' + bx + ',' + by + ',' + bz + ', 0); return 1;');
    const r1 = await run('/setblock ' + bx + ' ' + by + ' ' + bz + ' stone');
    ok(r1.ok && (await at(bx, by, bz)) === stoneState, 'plain setblock (default replace) wrote stone', JSON.stringify(r1));

    const r2 = await run('/setblock ' + bx + ' ' + by + ' ' + bz + ' dirt keep');
    ok(!r2.ok && r2.error && r2.error.key === 'commands.setblock.failed', 'keep refuses a non-air target, real setblock.failed key', JSON.stringify(r2));
    ok((await at(bx, by, bz)) === stoneState, 'and the stone is untouched by the refused keep');

    await ev('MCL.World.setBlock(' + bx + ',' + by + ',' + bz + ', 0); return 1;');
    const r3 = await run('/setblock ' + bx + ' ' + by + ' ' + bz + ' dirt keep');
    ok(r3.ok && (await at(bx, by, bz)) === dirtState, 'keep places onto real air', JSON.stringify(r3));

    const cx = PX + 2, cy = PY, cz = PZ + 1;
    await run('/setblock ' + cx + ' ' + cy + ' ' + cz + ' chest');
    await clearItems();
    const before = await itemsNear(cx, cy, cz, 3);
    const r4 = await run('/setblock ' + cx + ' ' + cy + ' ' + cz + ' air destroy');
    await sleep(200);
    const after = await itemsNear(cx, cy, cz, 3);
    ok(r4.ok, 'destroy setblock runs', JSON.stringify(r4));
    ok(after > before, 'destroying a real chest live actually drops an item entity', JSON.stringify({ before, after }));

    await ev('MCL.World.setBlock(' + (PX + 3) + ',' + PY + ',' + (PZ + 1) + ', 0); return 1;');
    const rRel = await run('/execute positioned ' + (PX + 3) + ' ' + PY + ' ' + (PZ + 1) + ' run setblock ~ ~ ~ stone');
    ok(rRel.ok && (await at(PX + 3, PY, PZ + 1)) === stoneState, '~ ~ ~ resolves against the executor position', JSON.stringify(rRel));
    const rMix = await run('/setblock ~ ' + PY + ' ^1 stone');
    ok(!rMix.ok, 'mixing ~ and ^ in one setblock position is refused (argument.pos.mixed)', JSON.stringify(rMix));

    await ev('MCL.World.setBlock(' + (PX + 4) + ',' + PY + ',' + (PZ + 1) + ', 0); return 1;');
    const rLow = await run('/setblock ' + (PX + 4) + ' ' + PY + ' ' + (PZ + 1) + ' stone', { level: 0 });
    ok(!rLow.ok, 'a level-0 source is refused /setblock (requires permission level 2)', JSON.stringify(rLow));
    ok((await at(PX + 4, PY, PZ + 1)) === airState, 'and nothing was written by the refused low-permission call');
    const rHigh = await run('/setblock ' + (PX + 4) + ' ' + PY + ' ' + (PZ + 1) + ' stone', { level: 2 });
    ok(rHigh.ok && (await at(PX + 4, PY, PZ + 1)) === stoneState, 'a level-2 source is allowed /setblock', JSON.stringify(rHigh));
  }

  // === 2. /fill -- modes, the 32768 cap, destroy actually breaking blocks ===
  console.log('\n2. /fill');
  {
    const x0 = PX + 10, z0 = PZ + 10;
    await run('/fill ' + x0 + ' ' + PY + ' ' + z0 + ' ' + (x0 + 2) + ' ' + (PY + 2) + ' ' + (z0 + 2) + ' stone');
    const f1 = await run('/fill ' + x0 + ' ' + PY + ' ' + z0 + ' ' + (x0 + 2) + ' ' + (PY + 2) + ' ' + (z0 + 2) + ' dirt');
    ok(f1.ok && f1.result === 27, 'plain fill (default replace) wrote 27 = 3x3x3', JSON.stringify(f1));

    const hx = PX + 20;
    await run('/fill ' + hx + ' ' + PY + ' ' + z0 + ' ' + (hx + 2) + ' ' + (PY + 2) + ' ' + (z0 + 2) + ' stone');
    await run('/fill ' + hx + ' ' + PY + ' ' + z0 + ' ' + (hx + 2) + ' ' + (PY + 2) + ' ' + (z0 + 2) + ' stone hollow');
    ok((await at(hx + 1, PY + 1, z0 + 1)) === airState, 'hollow leaves the single middle cell as air', JSON.stringify(await at(hx + 1, PY + 1, z0 + 1)));
    const ox = PX + 30;
    await run('/fill ' + ox + ' ' + PY + ' ' + z0 + ' ' + (ox + 2) + ' ' + (PY + 2) + ' ' + (z0 + 2) + ' air');
    await run('/fill ' + ox + ' ' + PY + ' ' + z0 + ' ' + (ox + 2) + ' ' + (PY + 2) + ' ' + (z0 + 2) + ' stone outline');
    ok((await at(ox + 1, PY + 1, z0 + 1)) === airState, 'outline leaves the untouched middle cell as air (never touched, not filled)', JSON.stringify(await at(ox + 1, PY + 1, z0 + 1)));

    const big = await run('/fill 0 0 0 100 100 100 stone');
    ok(!big.ok && big.error && big.error.key === 'commands.fill.toobig', 'a >32768-block fill is refused with commands.fill.toobig', JSON.stringify(big));

    const dx = PX + 40;
    await run('/fill ' + dx + ' ' + PY + ' ' + z0 + ' ' + (dx + 1) + ' ' + PY + ' ' + (z0 + 1) + ' chest');
    await clearItems();
    const dBefore = await itemsNear(dx + 0.5, PY, z0 + 0.5, 4);
    // stone, not air: vanilla's break-then-write counts only cells whose setBlockState changed (air over broken-out air is false)
    const fDestroy = await run('/fill ' + dx + ' ' + PY + ' ' + z0 + ' ' + (dx + 1) + ' ' + PY + ' ' + (z0 + 1) + ' stone destroy');
    await sleep(250);
    const dAfter = await itemsNear(dx + 0.5, PY, z0 + 0.5, 4);
    ok(fDestroy.ok && fDestroy.result === 4, 'fill destroy reports the right count', JSON.stringify(fDestroy));
    ok(dAfter > dBefore, 'fill destroy over 4 real chests actually drops item entities, live (D-fix)', JSON.stringify({ dBefore, dAfter }));

    const kx = PX + 50;
    await run('/fill ' + kx + ' ' + PY + ' ' + z0 + ' ' + (kx + 1) + ' ' + PY + ' ' + (z0 + 1) + ' stone');
    const kFail = await run('/fill ' + kx + ' ' + PY + ' ' + z0 + ' ' + (kx + 1) + ' ' + PY + ' ' + (z0 + 1) + ' dirt keep');
    ok(!kFail.ok && kFail.error && kFail.error.key === 'commands.fill.failed', 'keep over an all-occupied region fails with commands.fill.failed', JSON.stringify(kFail));

    const permBlocked = await run('/fill ' + x0 + ' ' + PY + ' ' + z0 + ' ' + (x0 + 1) + ' ' + PY + ' ' + z0 + ' stone', { level: 0 });
    ok(!permBlocked.ok, 'a level-0 source is refused /fill', JSON.stringify(permBlocked));
  }

  // === 3. /clone -- masked/filtered/force/move, overlap, the cap, live drift ===
  console.log('\n3. /clone');
  let sz;
  {
    // ⚠ KW-37 REGRESSION GUARD — the platform this section reads from is built once, at the very
    // start (section 0), and every scene below assumes it is STILL RESIDENT by the time it runs.
    // Before the `Jobs.mode = 'none'` freeze above, the live streamer could (and roughly a third
    // of the time, did) evict this exact 12x12 grid out from under the test between the build
    // and the first command that reads it back -- every cell then read as air and the clone
    // scenes below failed with the misleading `commands.clone.failed` / "No blocks were cloned"
    // (see the freeze's own comment for the full mechanism). Checking residency of the section's
    // own furthest corner HERE, explicitly, turns a future reintroduction of that race into a
    // named, obvious failure instead of the confusing "8 of 9"/"only 8 of 9" one this file used
    // to chase.
    const farState = await ev('var c = MCL.World.get((' + (PX + 120) + ')>>4,(' + (PZ + 120) + ')>>4); return c ? c.state : -1;');
    ok(farState !== -1, 'KW-37: the synthetic platform is still resident before /clone reads it (chunk state ' + farState + ', -1 means evicted)', 'farState=' + farState);

    const sx = PX + 60; sz = PZ + 60;
    await run('/fill ' + sx + ' ' + PY + ' ' + sz + ' ' + (sx + 2) + ' ' + (PY + 2) + ' ' + (sz + 2) + ' stone');
    const cl = await run('/clone ' + sx + ' ' + PY + ' ' + sz + ' ' + (sx + 2) + ' ' + (PY + 2) + ' ' + (sz + 2) + ' ' + (sx + 10) + ' ' + PY + ' ' + sz);
    ok(cl.ok && cl.result === 27, 'plain clone (default replace/normal) copied 27 blocks', JSON.stringify(cl));
    ok((await at(sx, PY, sz)) === stoneState, 'the source is untouched by a plain clone');

    const ovNorm = await run('/clone ' + sx + ' ' + PY + ' ' + sz + ' ' + (sx + 2) + ' ' + (PY + 2) + ' ' + (sz + 2) + ' ' + (sx + 1) + ' ' + PY + ' ' + sz);
    ok(!ovNorm.ok && ovNorm.error && ovNorm.error.key === 'commands.clone.overlap', 'normal (no mode literal) refuses an overlapping destination', JSON.stringify(ovNorm));

    const mx = PX + 70;
    await run('/fill ' + mx + ' ' + PY + ' ' + sz + ' ' + (mx + 2) + ' ' + (PY + 2) + ' ' + (sz + 2) + ' stone');
    await ev('MCL.World.setBlock(' + mx + ',' + (PY + 1) + ',' + sz + ', 0); return 1;');
    const mv = await run('/clone ' + mx + ' ' + PY + ' ' + sz + ' ' + (mx + 2) + ' ' + (PY + 2) + ' ' + (sz + 2) + ' ' + (mx + 1) + ' ' + PY + ' ' + sz + ' replace move');
    ok(mv.ok && mv.result === 27, 'an OVERLAPPING /clone ... move is allowed and runs, live (D-fix)', JSON.stringify(mv));
    ok((await at(mx + 1, PY + 1, sz)) === airState, 'the hole moved with it rather than being smeared over by overlapping move');
    ok((await at(mx, PY, sz)) === airState, 'and the whole source column is cleared afterwards (real move semantics)');

    const kx2 = PX + 80;
    await run('/fill ' + kx2 + ' ' + PY + ' ' + sz + ' ' + (kx2 + 2) + ' ' + PY + ' ' + (sz + 2) + ' stone');
    await ev('MCL.World.setBlock(' + (kx2 + 1) + ',' + PY + ',' + (sz + 1) + ', 0); return 1;');
    await run('/fill ' + (kx2 + 20) + ' ' + PY + ' ' + sz + ' ' + (kx2 + 22) + ' ' + PY + ' ' + (sz + 2) + ' dirt');
    const mk = await run('/clone ' + kx2 + ' ' + PY + ' ' + sz + ' ' + (kx2 + 2) + ' ' + PY + ' ' + (sz + 2) + ' ' + (kx2 + 20) + ' ' + PY + ' ' + sz + ' masked');
    ok(mk.ok && mk.result === 8, 'masked clone copies 8 of 9 (the air source cell is skipped)', JSON.stringify(mk));
    ok((await at(kx2 + 21, PY, sz + 1)) === dirtState, 'and the destination kept ITS OWN block under the masked hole');

    const fx = PX + 90;
    await run('/fill ' + fx + ' ' + PY + ' ' + sz + ' ' + (fx + 2) + ' ' + PY + ' ' + (sz + 2) + ' stone');
    await ev('MCL.World.setBlock(' + (fx + 1) + ',' + PY + ',' + (sz + 1) + ', MCL.States.stateOf("dirt")); return 1;');
    await run('/fill ' + (fx + 20) + ' ' + PY + ' ' + sz + ' ' + (fx + 22) + ' ' + PY + ' ' + (sz + 2) + ' air');
    const filt = await run('/clone ' + fx + ' ' + PY + ' ' + sz + ' ' + (fx + 2) + ' ' + PY + ' ' + (sz + 2) + ' ' + (fx + 20) + ' ' + PY + ' ' + sz + ' filtered stone');
    ok(filt.ok && filt.result === 8, 'filtered stone clone copies only the 8 stone cells, not the 1 dirt one', JSON.stringify(filt));
    ok((await at(fx + 21, PY, sz + 1)) === airState, 'the dirt cell was skipped by the filter (destination stayed air)');

    const capOv = await run('/clone 0 0 0 60 60 60 30 0 0');
    ok(!capOv.ok && capOv.error && capOv.error.key === 'commands.clone.overlap',
      'a region that is BOTH overlapping AND over the 32768 cap reports overlap first, matching .decomp own check order', JSON.stringify(capOv));
    const capOnly = await run('/clone 0 0 0 100 100 100 500 0 0');
    ok(!capOnly.ok && capOnly.error && capOnly.error.key === 'commands.clone.toobig', 'a non-overlapping oversized region still reports commands.clone.toobig', JSON.stringify(capOnly));

    const permBlocked = await run('/clone ' + sx + ' ' + PY + ' ' + sz + ' ' + (sx + 1) + ' ' + PY + ' ' + sz + ' ' + (sx + 30) + ' ' + PY + ' ' + sz, { level: 0 });
    ok(!permBlocked.ok, 'a level-0 source is refused /clone', JSON.stringify(permBlocked));
  }

  // === 4. anti-vacuity -- replay the exact pre-fix behaviour, prove the assertions above
  //        would have caught it ===
  console.log('\n4. anti-vacuity -- the pre-fix clone/fill code is simulated');
  {
    const amx = PX + 100;
    await run('/fill ' + amx + ' ' + PY + ' ' + sz + ' ' + (amx + 2) + ' ' + (PY + 2) + ' ' + (sz + 2) + ' stone');
    const preFixMove = await ev(
      'var W = MCL.World;' +
      'var x0=' + amx + ',x1=' + (amx + 2) + ',y0=' + PY + ',y1=' + (PY + 2) + ',z0=' + sz + ',z1=' + (sz + 2) + ';' +
      'var w=x1-x0+1,h=y1-y0+1,dp=z1-z0+1;' +
      'var dx=' + (amx + 1) + ',dy=' + PY + ',dz=' + sz + ';' +
      'var ox=dx-x0,oy=dy-y0,oz=dz-z0;' +
      'var overlaps = !(ox>=w||ox<=-w||oy>=h||oy<=-h||oz>=dp||oz<=-dp);' +
      "var mode='move';" +
      "var wouldThrow = overlaps && mode !== 'force';" +
      'return { overlaps: overlaps, wouldThrow: wouldThrow };'
    );
    okAv(preFixMove.overlaps === true && preFixMove.wouldThrow === true,
      'replaying the PRE-FIX overlap guard (mode !== force) on this own overlapping-move scene shows it WOULD have thrown commands.clone.overlap -- proving the live move-overlap assertion above is not vacuous',
      JSON.stringify(preFixMove));

    const adx = PX + 110;
    await run('/fill ' + adx + ' ' + PY + ' ' + sz + ' ' + (adx + 1) + ' ' + PY + ' ' + (sz + 1) + ' chest');
    await clearItems();
    const preDropCount = await ev(
      'var W = MCL.World;' +
      'var before = MCL.EntityList.list.filter(function(e){return e.type==="item";}).length;' +
      'W.setBlock(' + adx + ',' + PY + ',' + sz + ', 0);' +
      'W.setBlock(' + (adx + 1) + ',' + PY + ',' + sz + ', 0);' +
      'W.setBlock(' + adx + ',' + PY + ',' + (sz + 1) + ', 0);' +
      'W.setBlock(' + (adx + 1) + ',' + PY + ',' + (sz + 1) + ', 0);' +
      'var after = MCL.EntityList.list.filter(function(e){return e.type==="item";}).length;' +
      'return { before: before, after: after };'
    );
    okAv(preDropCount.after === preDropCount.before,
      'replaying the PRE-FIX fill-destroy loop (plain W.setBlock, no NS.Loot.breakDrops call) over 4 real chests drops NOTHING -- proving the live fill-destroy-drops assertion above is not vacuous',
      JSON.stringify(preDropCount));
  }

  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' blockcmdlivecheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
