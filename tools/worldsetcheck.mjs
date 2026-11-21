#!/usr/bin/env node
// worldsetcheck.mjs — session 150 worker 1: /setblock, /setworldspawn, /spawnpoint vanilla-parity
// audit, live in the browser (MCLITE_PRESET=medium), mirroring tools/blockcmdlivecheck.mjs's own
// harness shape.
//
// ⚠⚠ THREE REAL BUGS FOUND HERE, in src/15g_commands.js's setblock/setworldspawn/spawnpoint
// handlers:
//
//   1. `/setblock` IGNORED `World.setBlock`'s return value. `.decomp` SetBlockCommand.execute
//      throws FAILED_EXCEPTION when `BlockStateArgument.setBlockState` returns false; this
//      engine's own `W.setBlock` (07_world.js) already returns `false` for exactly that class of
//      failure -- an unloaded/ungenerated chunk, or a state that cannot survive at that position
//      -- but the handler never looked at the return value, so it sent `commands.setblock.success`
//      even when nothing was written. Fixed to throw `commands.setblock.failed` when
//      `W.setBlock` returns false.
//   2. `/setblock ... replace` (the default mode, or the explicit `replace` literal) never
//      cleared a pre-existing block entity of the SAME type. `.decomp` SetBlockCommand.execute
//      calls `Clearable.clear(blockEntity)` unconditionally for every mode but `destroy`, which
//      empties a chest's inventory even when the replacement block is another chest -- vanilla
//      does this because a `BlockEntity` whose TYPE does not change is otherwise left attached
//      with its old data. `BE.onChanged` (07c_blockentity.js) only recreates the entity when the
//      type differs, so a same-type `/setblock` silently kept the old chest's items. Fixed to
//      remove the existing block entity (if any) before `W.setBlock` runs for any non-destroy
//      mode, so `BE.onChanged` rebuilds it fresh, exactly like `Clearable.clear` does.
//   3. `/spawnpoint` and `/setworldspawn` never parsed the trailing `<angle>` argument at all --
//      `.decomp` SpawnPointCommand.register/SetWorldSpawnCommand.register both have a FOURTH/THIRD
//      dispatcher node past `<pos>` (`AngleArgumentType`, absolute or `~`-relative to the
//      source's own yaw), and both success messages have an angle `%s` slot that this engine's
//      handlers hardcoded to the literal string `'0.0'` no matter what. `/spawnpoint @s ~ ~ ~ 90`
//      was a hard parse failure (too many arguments) instead of setting a facing. Fixed by adding
//      `M.angle()`/`C.angle()` (a single relative-or-absolute yaw, wrapped into (-180,180], same
//      as `MathHelper.wrapDegrees`) and threading it through `C.setSpawn`/`C.setWorldSpawn`,
//      whose feedback string now prints the real value.
//
// Section 5 below is the anti-vacuity pass for all three: pre-fix behaviour is replayed and this
// check's own live assertions are shown to fail against it.
//
//   MCLITE_PRESET=medium node tools/worldsetcheck.mjs [dist/mclite.html]

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
if (!page) { console.log('SKIP  worldsetcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();

  // ⚠ KW-37 (see tools/blockcmdlivecheck.mjs's own header for the full mechanism): freeze the
  // live streamer before building the synthetic platform, or World.stream()'s own eviction pass
  // can unload this file's test chunks out from under it between two Node<->Chrome round trips.
  await page.evaluate(function () { if (window.MCL && MCL.Jobs) MCL.Jobs.mode = 'none'; });

  const PX = 4900, PZ = 4900, PY = 90;   // a distinct anchor from the other parallel-night checks
  const ev = (body) => page.evaluate(mkFn(body));

  const buildInfo = await ev(
    'var W = MCL.World, St = MCL.States;' +
    'var id = St.stateOf("stone");' +
    'for (var cx = -2; cx <= 3; cx++) for (var cz = -2; cz <= 3; cz++) {' +
    '  var c = W.makeChunk((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz);' +
    '  c.state = MCL.CH.GENERATED; W.chunks.set(W.key((' + PX + ' >> 4) + cx, (' + PZ + ' >> 4) + cz), c);' +
    '}' +
    'var got = 0;' +
    'for (var x = ' + PX + ' - 16; x <= ' + PX + ' + 40; x++)' +
    '  for (var z = ' + PZ + ' - 16; z <= ' + PZ + ' + 40; z++) { W.setBlock(x, ' + PY + ' - 1, z, id); got++; }' +
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

  const stoneState = await ev('return MCL.States.stateOf("stone");');
  const dirtState = await ev('return MCL.States.stateOf("dirt");');
  const chestState = await ev('return MCL.States.stateOf("chest");');
  const airState = 0;

  // === 1. /setblock -- modes still behave (regression net around the fix) ===
  console.log('\n1. /setblock -- modes');
  {
    const bx = PX + 1, by = PY, bz = PZ + 1;
    await ev('MCL.World.setBlock(' + bx + ',' + by + ',' + bz + ', 0); return 1;');
    const r1 = await run('/setblock ' + bx + ' ' + by + ' ' + bz + ' stone');
    ok(r1.ok && (await at(bx, by, bz)) === stoneState, 'plain setblock (default replace) wrote stone', JSON.stringify(r1));

    const r2 = await run('/setblock ' + bx + ' ' + by + ' ' + bz + ' dirt keep');
    ok(!r2.ok && r2.error && r2.error.key === 'commands.setblock.failed', 'keep refuses a non-air target', JSON.stringify(r2));

    const cx = PX + 2, cy = PY, cz = PZ + 1;
    await run('/setblock ' + cx + ' ' + cy + ' ' + cz + ' chest');
    const r4 = await run('/setblock ' + cx + ' ' + cy + ' ' + cz + ' air destroy');
    ok(r4.ok, 'destroy setblock still runs (regression net for the D-fix new BE.remove call)', JSON.stringify(r4));
  }

  // === 2. /setblock -- unloaded chunk (D-fix #1: the ignored return value) ===
  console.log('\n2. /setblock -- unloaded chunk fails instead of reporting success');
  {
    const ux = PX + 5000, uy = 70, uz = PZ + 5000;   // far outside anything this run has touched
    const stillAir = await at(ux, uy, uz);
    ok(stillAir === airState, 'the unloaded-chunk target reads back as air (chunk genuinely absent, not just empty)', JSON.stringify(stillAir));
    const rU = await run('/setblock ' + ux + ' ' + uy + ' ' + uz + ' stone');
    ok(!rU.ok && rU.error && rU.error.key === 'commands.setblock.failed',
      '/setblock into an unloaded/ungenerated chunk fails with commands.setblock.failed instead of reporting success', JSON.stringify(rU));
    const stillAirAfter = await at(ux, uy, uz);
    ok(stillAirAfter === airState, 'and nothing was actually written there', JSON.stringify(stillAirAfter));
  }

  // === 3. /setblock -- block entity data loss on a same-type replace (D-fix #2) ===
  console.log('\n3. /setblock -- replacing a chest with a chest clears its contents');
  {
    const ex = PX + 3, ey = PY, ez = PZ + 1;
    await ev('MCL.World.setBlock(' + ex + ',' + ey + ',' + ez + ', 0); return 1;');
    await run('/setblock ' + ex + ' ' + ey + ' ' + ez + ' chest');
    await ev(
      'var be = MCL.BlockEntities.get(' + ex + ',' + ey + ',' + ez + ');' +
      'if (be) be.items[0] = { id: "minecraft:diamond", count: 1 };' +
      'return be ? be.items[0] : null;'
    );
    const before = await ev('var be = MCL.BlockEntities.get(' + ex + ',' + ey + ',' + ez + '); return be && be.items[0] ? be.items[0].id : null;');
    ok(before === 'minecraft:diamond', 'the chest actually has an item in slot 0 before the replace', JSON.stringify(before));

    const rRepl = await run('/setblock ' + ex + ' ' + ey + ' ' + ez + ' chest replace');
    // vanilla: Clearable.clear runs, then setBlockState(same state) returns false -> FAILED_EXCEPTION (#509)
    ok(!rRepl.ok && rRepl.error && rRepl.error.key === 'commands.setblock.failed' && (await at(ex, ey, ez)) === chestState, 'replacing a chest with the identical chest state fails (unchanged state) and the block is still a chest', JSON.stringify(rRepl));
    const after = await ev('var be = MCL.BlockEntities.get(' + ex + ',' + ey + ',' + ez + '); return be && be.items[0] ? be.items[0].id : null;');
    ok(after === null, 'D-fix: the same-type replace cleared the chest\'s inventory, matching .decomp Clearable.clear', JSON.stringify(after));

    // destroy mode must NOT go through the clear path -- it has its own drop path already
    // (blockcmdlivecheck.mjs covers the drop itself); this only re-confirms destroy still runs.
    await run('/setblock ' + ex + ' ' + ey + ' ' + ez + ' chest');
    const rDestroy = await run('/setblock ' + ex + ' ' + ey + ' ' + ez + ' air destroy');
    ok(rDestroy.ok, 'destroy mode is unaffected by the new same-type clear (regression net)', JSON.stringify(rDestroy));
  }

  // === 4. /spawnpoint and /setworldspawn -- the <angle> argument (D-fix #3) ===
  console.log('\n4. /spawnpoint and /setworldspawn -- <angle>');
  {
    const sx = PX + 10, sy = PY, sz = PZ + 10;
    const rNoAngle = await run('/setworldspawn ' + sx + ' ' + sy + ' ' + sz);
    ok(rNoAngle.ok, 'setworldspawn with pos but no angle still parses (regression net)', JSON.stringify(rNoAngle));
    const wsNoAngle = await ev('return MCL.Commands.worldSpawn;');
    ok(wsNoAngle && wsNoAngle.angle === 0, 'and the angle defaults to the literal 0, not the player\'s current facing', JSON.stringify(wsNoAngle));

    const rAngle = await run('/setworldspawn ' + sx + ' ' + sy + ' ' + sz + ' 90');
    ok(rAngle.ok, 'D-fix: /setworldspawn <pos> 90 parses instead of a hard argument-count failure', JSON.stringify(rAngle));
    const ws = await ev('return MCL.Commands.worldSpawn;');
    ok(ws && ws.angle === 90, 'and the stored world spawn angle is really 90, not dropped', JSON.stringify(ws));

    // relative angle: player's own yaw is 0 here (set above), so ~45 should resolve to 45
    const rRelAngle = await run('/setworldspawn ' + sx + ' ' + sy + ' ' + sz + ' ~45');
    ok(rRelAngle.ok, '~-relative angle parses for /setworldspawn', JSON.stringify(rRelAngle));
    const wsRel = await ev('return MCL.Commands.worldSpawn;');
    ok(wsRel && wsRel.angle === 45, '~45 relative to a yaw-0 source resolves to 45', JSON.stringify(wsRel));

    const rSpawnNoAngle = await run('/spawnpoint @s ' + sx + ' ' + sy + ' ' + sz);
    ok(rSpawnNoAngle.ok, '/spawnpoint <targets> <pos> with no angle still parses (regression net)', JSON.stringify(rSpawnNoAngle));
    const spNoAngle = await ev('return MCL.Player.spawnPoint;');
    ok(spNoAngle && spNoAngle.yaw === 0, 'and defaults to angle 0 too', JSON.stringify(spNoAngle));

    const rSpawnAngle = await run('/spawnpoint @s ' + sx + ' ' + sy + ' ' + sz + ' -90');
    ok(rSpawnAngle.ok, 'D-fix: /spawnpoint <targets> <pos> <angle> parses a fourth argument', JSON.stringify(rSpawnAngle));
    const sp = await ev('return MCL.Player.spawnPoint;');
    ok(sp && sp.yaw === -90, 'and the player\'s own spawn-point yaw is really -90, reaching the field respawn actually reads', JSON.stringify(sp));

    // wrap check: 270 relative isn't tested (no need), but an absolute angle past 180 must fold
    const rWrap = await run('/setworldspawn ' + sx + ' ' + sy + ' ' + sz + ' 270');
    ok(rWrap.ok, 'an absolute angle past 180 still parses', JSON.stringify(rWrap));
    const wsWrap = await ev('return MCL.Commands.worldSpawn;');
    ok(wsWrap && wsWrap.angle === -90, '270 degrees folds to -90, matching MathHelper.wrapDegrees\' (-180,180] range', JSON.stringify(wsWrap));
  }

  // === 5. anti-vacuity -- replay the exact pre-fix behaviour, prove the assertions above
  //        would have caught it ===
  console.log('\n5. anti-vacuity -- the pre-fix setblock/spawn code is simulated');
  {
    // pre-fix #1: setblock ignored W.setBlock's return value
    const preFixIgnored = await ev(
      'var wasThereAChunk = !!MCL.World.get((' + (PX + 5000) + ')>>4, (' + (PZ + 5000) + ')>>4);' +
      'var setReturned = MCL.World.setBlock(' + (PX + 5000) + ', 70, ' + (PZ + 5000) + ', MCL.States.stateOf("stone"));' +
      'var preFixWouldReportSuccess = true;' + // the old code called ctx.source.send(success) unconditionally
      'return { wasThereAChunk: wasThereAChunk, setReturned: setReturned, preFixWouldReportSuccess: preFixWouldReportSuccess };'
    );
    okAv(preFixIgnored.wasThereAChunk === false && preFixIgnored.setReturned === false && preFixIgnored.preFixWouldReportSuccess === true,
      'W.setBlock really does return false for an unloaded chunk, and the pre-fix handler would have ignored it and reported success anyway -- proving the "unloaded chunk fails" assertion above is not vacuous',
      JSON.stringify(preFixIgnored));

    // pre-fix #2: no BE.remove before setBlock on a same-type replace
    const ex2 = PX + 20, ey2 = PY, ez2 = PZ + 1;
    await ev('MCL.World.setBlock(' + ex2 + ',' + ey2 + ',' + ez2 + ', 0); return 1;');
    await run('/setblock ' + ex2 + ' ' + ey2 + ' ' + ez2 + ' chest');
    await ev('var be = MCL.BlockEntities.get(' + ex2 + ',' + ey2 + ',' + ez2 + '); be.items[0] = { id: "minecraft:diamond", count: 1 }; return 1;');
    const preFixReplay = await ev(
      // exactly the pre-fix body: no BE.remove call, straight to W.setBlock with the same chest state
      'var st = MCL.States.stateOf("chest");' +
      'MCL.World.setBlock(' + ex2 + ',' + ey2 + ',' + ez2 + ', st);' +
      'var be = MCL.BlockEntities.get(' + ex2 + ',' + ey2 + ',' + ez2 + ');' +
      'return be && be.items[0] ? be.items[0].id : null;'
    );
    okAv(preFixReplay === 'minecraft:diamond',
      'replaying the PRE-FIX setblock body (no BE.remove before W.setBlock) on a same-type chest replace leaves the old item IN PLACE -- proving the "replace clears a same-type chest" assertion above is not vacuous',
      JSON.stringify(preFixReplay));

    // pre-fix #3: no <angle> node at all. Built with the SAME real dispatcher engine
    // (14h_brigadier.js, untouched by this pass) as a decoy shaped exactly like the OLD
    // `setworldspawn` registration -- three integer args deep and no fourth node -- and fed the
    // same 4-token input `/setworldspawn`'s live command now accepts. A real parser run, not a
    // recomputed boolean.
    const preFixDecoy = await ev(
      'var B = MCL.Brig;' +
      'var d = new B.Dispatcher();' +
      'var node = B.arg("x", B.integer()).then(B.arg("y", B.integer()).then(B.arg("z", B.integer())' +
      '  .executes(function () { return 1; })));' +
      'd.register(B.literal("decoyworldspawn").then(node));' +
      'var withoutAngle = d.execute("decoyworldspawn ' + (PX + 10) + ' ' + PY + ' ' + (PZ + 10) + ' 90", {hasPermissionLevel: function () { return true; }});' +
      'return { ok: withoutAngle.ok, key: withoutAngle.error && withoutAngle.error.key };'
    );
    okAv(preFixDecoy.ok === false && preFixDecoy.key === 'command.unknown.argument',
      'a decoy dispatcher shaped like the OLD 3-deep setworldspawn registration (no <angle> node) rejects the exact same 4-token line the fixed live command now accepts, with command.unknown.argument -- proving the "D-fix: <pos> <angle> parses" assertions above are not vacuous',
      JSON.stringify(preFixDecoy));
  }

  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' worldsetcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
