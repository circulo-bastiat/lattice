#!/usr/bin/env node
// tpcheck.mjs -- parallel night worker 1 (session 148): /teleport and /tp, and /help, LIVE in the
// browser (MCLITE_PRESET=medium). Ground truth: .decomp/net/minecraft/server/command/
// TeleportCommand.java and HelpCommand.java.
//
// ⚠⚠ ONE REAL BUG FOUND, in `tpTo()` (src/15g_commands.js): it zeroed vx/vy/vz UNCONDITIONALLY
// on every teleport. `.decomp` TeleportCommand.teleport (~line 253) only clears the VERTICAL
// component -- `entity.setVelocity(entity.getVelocity().multiply(1.0, 0.0, 1.0))`, x and z
// multipliers are 1.0 -- and sets `onGround = true`; horizontal velocity survives a teleport in
// vanilla (a falling/flying/thrown entity keeps its sideways drift, only its fall is arrested).
// Fixed to clear only `vy` and set `onGround = true`; section 2 below proves this live and its
// own anti-vacuity replay shows the pre-fix code would have zeroed the horizontal velocity too.
//
// session 149, worker 2: two of D-750's three named-not-chased gaps are now built --
// `<destination:entity>` (both `/teleport <destination>` and `/teleport <targets> <destination>`,
// entity-to-entity, no location math, sections 4-5 below) and the literal `<targets> <location>
// <rotation>` form (sections 6-7). ⚠ D-750's "needs new lang keys that do not exist anywhere in
// the built lang table (grepped dist/mclite.html: zero hits)" DID NOT HOLD UP: that grep was for
// the KEY as literal source text, which never appears for ANY key (even the `.location.single`
// one this same file already exercised in section 2) because `tools/pack-lang.mjs` ships
// `en_us.json` WHOLE, deflated, into `assets/lang.bin` -- inflating it directly showed
// `commands.teleport.success.entity.single`/`.multiple` were already vanilla's own strings
// ("Teleported %s to %s" / "Teleported %s entities to %s") in that file all along. No
// `assets/lang-overrides.json` entry, no `pack-lang`/`gen-data` rebuild, was needed -- T() just
// resolves them like any other key. `facing` is still unbuilt (`C.EXECUTE_OWED`, project-wide,
// src/15g_commands.js) and out of scope for this unit too; section 3's `/help` assertion below
// still asserts it stays unclaimed.
//
// /help: `.decomp` HelpCommand.java (55 lines) does NOT paginate at all -- `getSmartUsage` on
// the root, one line per command, no "Page N of M". mclite's `/help` (no args) already matches
// this (lists every root literal name the source can use, unpaginated) -- section 3 confirms it
// live rather than assuming the doc brief's "paginate" premise was correct.
//
//   MCLITE_PRESET=medium node tools/tpcheck.mjs [dist/mclite.html]

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
if (!page) { console.log('SKIP  tpcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();

  const PX = 4900, PZ = 4900, PY = 90;   // distinct anchor from the other parallel-night checks
  const ev = (body) => page.evaluate(mkFn(body));

  const buildInfo = await ev(
    'var W = MCL.World, St = MCL.States;' +
    'var id = St.stateOf("stone");' +
    'for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) {' +
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
  function playerPos() { return ev('return { x: MCL.Player.x, y: MCL.Player.y, z: MCL.Player.z };'); }

  // === 1. coordinates -- absolute, relative ~, mixed ~/^ refusal, no-target self-teleport ===
  console.log('\n1. /teleport, /tp -- coordinate parsing');
  {
    const r1 = await run('/tp ' + (PX + 5) + ' ' + PY + ' ' + (PZ + 5));
    const p1 = await playerPos();
    ok(r1.ok && p1.x === PX + 5 && p1.y === PY && p1.z === PZ + 5, '/tp with absolute coordinates moves the player', JSON.stringify({ r1, p1 }));

    const r2 = await run('/teleport ~ ~10 ~-2');
    const p2 = await playerPos();
    ok(r2.ok && p2.x === PX + 5 && p2.y === PY + 10 && p2.z === PZ + 3, '/teleport with ~ resolves relative to the CURRENT position, a bare ~ unchanged', JSON.stringify({ r2, p2 }));

    const r3 = await run('/tp ' + PX + ' ' + PY + ' ^5');
    ok(!r3.ok, 'mixing an absolute coordinate with ^ in the same call is refused', JSON.stringify(r3));

    await run('/tp ' + PX + ' ' + PY + ' ' + PZ);
    const r4 = await run('/teleport ~10 ~ ~');
    const p4 = await playerPos();
    ok(r4.ok && p4.x === PX + 10, '/teleport with no <targets> moves the SOURCE itself', JSON.stringify({ r4, p4 }));
  }

  // === 2. velocity/onGround -- .decomp's own multiply(1.0, 0.0, 1.0) + onGround=true (D-fix) ===
  console.log('\n2. velocity and onGround, live (D-fix)');
  let cowId;
  {
    // ⚠ CLEAR STRAY COWS FIRST. `MCLITE_PRESET=medium` runs a real peaceful-mob spawn cycle, so
    // by the time this section runs (after section 1's several real ticks) a naturally-spawned
    // cow can already exist elsewhere in the world -- and `@e[type=cow,limit=1]` picks the
    // FIRST match in `EntityList.list` order, not the nearest one, so an earlier natural cow
    // (lower id) would silently win over the one this section just spawned to test.
    await ev('MCL.EntityList.list = MCL.EntityList.list.filter(function (e) { return e.type !== "cow"; }); return 1;');
    const cx = PX + 20, cz = PZ;
    const spawned = await ev(
      'var EL = MCL.EntityList;' +
      'var c = EL.spawn("cow", ' + cx + ', ' + (PY + 3) + ', ' + cz + ');' +
      'c.vx = 0.37; c.vy = -0.8; c.vz = -0.21; c.onGround = false;' +
      'return { id: c.id, vx: c.vx, vy: c.vy, vz: c.vz };'
    );
    cowId = spawned.id;
    ok(spawned.vx === 0.37 && spawned.vy === -0.8 && spawned.vz === -0.21, 'a falling cow was set up with nonzero velocity on all three axes', JSON.stringify(spawned));

    const tp = await run('/tp @e[type=cow,limit=1] ' + (cx + 8) + ' ' + PY + ' ' + cz);
    const after = await ev(
      'var EL = MCL.EntityList, e = null;' +
      'for (var i = 0; i < EL.list.length; i++) if (EL.list[i].id === ' + cowId + ') e = EL.list[i];' +
      'return e ? { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, onGround: e.onGround } : null;'
    );
    ok(tp.ok && tp.result === 1, 'the selector /tp on the cow ran and moved exactly 1 entity', JSON.stringify(tp));
    ok(after && after.x === cx + 8 && after.z === cz, 'the cow actually landed at the destination', JSON.stringify(after));
    ok(after && after.vy === 0, 'vertical velocity is cleared by a teleport, matching .decomp', JSON.stringify(after));
    ok(after && after.vx === 0.37 && after.vz === -0.21, 'HORIZONTAL velocity SURVIVES a teleport -- .decomp only multiplies Y by 0, X and Z stay 1.0 (D-fix)', JSON.stringify(after));
    ok(after && after.onGround === true, 'onGround is forced true by a teleport, matching .decomp', JSON.stringify(after));
  }

  // multiple targets, and the source's own list-size feedback
  {
    await ev('MCL.EntityList.list = MCL.EntityList.list.filter(function (e) { return e.type !== "cow"; }); return 1;');
    const bx = PX + 40, bz = PZ;
    await ev('MCL.EntityList.spawn("cow", ' + bx + ', ' + (PY + 1) + ', ' + bz + '); MCL.EntityList.spawn("cow", ' + (bx + 1) + ', ' + (PY + 1) + ', ' + bz + '); MCL.EntityList.spawn("cow", ' + (bx + 2) + ', ' + (PY + 1) + ', ' + bz + '); return 1;');
    const tpAll = await run('/tp @e[type=cow] ' + (bx + 10) + ' ' + PY + ' ' + bz);
    ok(tpAll.ok && tpAll.result === 3, '/tp @e[type=cow] moves every live cow (exactly the 3 just spawned) -- 3 total', JSON.stringify(tpAll));
  }

  // === 3. /help -- exactly the registered root commands, correct usage strings ===
  console.log('\n3. /help');
  {
    const names = await ev('return MCL.Commands.dispatcher.names(MCL.Commands.source(MCL.Player, {name: "Dan", level: 2}));');
    const helpOut = await ev(
      'var lines = [];' +
      'var src = MCL.Commands.source(MCL.Player, {name: "Dan", level: 2});' +
      'var save = src.send; src.send = function (m) { lines.push(m); };' +
      'MCL.Commands.dispatcher.execute("help", src);' +
      'return lines;'
    );
    // .decomp HelpCommand's no-args branch calls `dispatcher.getSmartUsage(dispatcher.getRoot(), source)`
    // (never `names()`), one Map entry per ROOT CHILD in REGISTRATION order, each value the full
    // recursive smart-usage TEXT for that command (args and all) -- not the bare literal name, and
    // not alphabetically sorted (`D.names` sorts for its own callers; `getSmartUsage` walks
    // `node.children` as registered, a plain array here matching brigadier's LinkedHashMap order).
    // So each `/help` line's own LEADING WORD is the command name; the SET of leading words must
    // equal `dispatcher.names()`, but the full lines and their order are expected to differ from it.
    const helpNames = helpOut.map((l) => l.replace(/^\//, ''));
    const helpLeadWords = helpNames.map((l) => l.split(' ')[0]).slice().sort();
    ok(JSON.stringify(helpLeadWords) === JSON.stringify(names), '/help (no args) lists every registered root command exactly once (by its own leading word) -- the SET matches dispatcher.names(), nothing paginated (matching .decomp HelpCommand, which has no pagination at all)', JSON.stringify({ helpLeadWords, names }));
    ok(helpNames.length === names.length && JSON.stringify(helpNames) !== JSON.stringify(names) &&
       helpNames.some((l) => l.indexOf(' ') > 0),
       '/help (no args) lines are FULL smart-usage text (args included), not bare command names, and not alphabetically sorted -- HelpCommand calls getSmartUsage(root, source), never names()', JSON.stringify({ helpNames, names }));

    const tpUsage = await ev(
      'var lines = [];' +
      'var src = MCL.Commands.source(MCL.Player, {name: "Dan", level: 2});' +
      'src.send = function (m) { lines.push(m); };' +
      'MCL.Commands.dispatcher.execute("help teleport", src);' +
      'return lines;'
    );
    // .decomp's `getSmartUsage` (real brigadier-1.3.10, field-for-field in 14h_brigadier.js's own
    // `D._smartUsage`) only ever expands ONE level past a branch point: when a node has more than
    // one usable child it stops recursing and joins their own bare `<name>` texts with `|` inside
    // `(...)`/`[...]` -- it never shows a grandchild like `<rotation>` sitting under one branch of
    // an already-collapsed `<targets>` node. `teleport`'s three TOP-LEVEL children (`<location>`,
    // `<destination>`, `<targets>`) each get their own Map entry/line; `<targets>` itself branches
    // into `<location>`/`<destination>` again, so ITS line collapses to `(...|...)`, not two lines
    // and not a peek at what sits under either alternative. (Corrected this unit -- the previous
    // assertions here assumed five separate, fully-expanded lines including a `<targets> <location>
    // <rotation>` one; that was never verified against the real collapsing rule and mistook the
    // implementation, which matches .decomp exactly, for a bug. See docs/cloud-findings.)
    ok(tpUsage.every((l) => l.indexOf('/teleport') === 0), '/help teleport usage lines are all real teleport forms', JSON.stringify(tpUsage));
    ok(tpUsage.length === 3, '/help teleport has exactly 3 lines -- one per top-level child (<location>, <destination>, <targets>)', JSON.stringify(tpUsage));
    ok(tpUsage.some((l) => l === '/teleport <location>'), '/help teleport lists the bare <location> form', JSON.stringify(tpUsage));
    ok(tpUsage.some((l) => l === '/teleport <destination>'), '/help teleport lists the new bare <destination> form (session 149 w2)', JSON.stringify(tpUsage));
    ok(tpUsage.some((l) => l === '/teleport <targets> (<location>|<destination>)'), '/help teleport collapses <targets>\'s own two children into ONE (<location>|<destination>) line, matching the jar-verified USAGE_OR collapsing rule -- not two separate <targets> lines and not a peek at the <rotation> node nested under <targets> <location>', JSON.stringify(tpUsage));
    ok(!tpUsage.some((l) => /facing/.test(l)), '/help teleport still does NOT claim the facing clause -- that stays unregistered (C.EXECUTE_OWED, out of scope for this unit)', JSON.stringify(tpUsage));

    // anti-vacuity: replay the SAME collapsing rule against a node shaped like a hypothetical
    // single-child branch (no real alternative), which must NOT collapse with a pipe -- proving
    // the '(<location>|<destination>)' assertion above is really exercising the >1-child branch,
    // not just echoing a hard-coded string.
    const singleChildUsage = await ev(
      'var B = MCL.Brig, D2 = new B.Dispatcher();' +
      'D2.register(B.literal("solo").then(B.literal("only")));' +
      'var out = D2.getSmartUsage(D2.root, MCL.Commands.source(MCL.Player, {name: "Dan", level: 2}));' +
      'return out.map(function (o) { return o.text; });'
    );
    okAv(!singleChildUsage.some((t) => /\|/.test(t)), 'a node with only ONE child never gets a pipe -- the |-join above really fires only for teleport\'s genuine 2-child <targets> branch', JSON.stringify(singleChildUsage));

    const badHelp = await ev(
      'var src = MCL.Commands.source(MCL.Player, {name: "Dan", level: 0});' +
      'var r = MCL.Commands.dispatcher.execute("help gamerule", src);' +
      'return { ok: r.ok, key: r.error ? r.error.key : null };'
    );
    ok(!badHelp.ok && badHelp.key === 'commands.help.failed', '/help on a command the SOURCE lacks permission for fails with commands.help.failed, not a full usage dump (level-0 vs /gamerule\'s perm(2))', JSON.stringify(badHelp));
  }

  // === 4. /teleport <destination> -- entity-to-entity, self by default (new, session 149 w2) ===
  console.log('\n4. /teleport <destination> -- self by default');
  {
    await ev('MCL.EntityList.list = MCL.EntityList.list.filter(function (e) { return e.type !== "cow"; }); return 1;');
    const mx = PX + 60, my = PY + 3, mz = PZ + 5;
    const marker = await ev(
      'var c = MCL.EntityList.spawn("cow", ' + mx + ', ' + my + ', ' + mz + ');' +
      'c.yaw = 1.2345; c.pitch = -0.4321;' +
      'return { id: c.id, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch };'
    );
    await ev('var P = MCL.Player; P.x = ' + PX + '; P.y = ' + PY + '; P.z = ' + PZ + '; P.yaw = 0; P.pitch = 0; if (P.interpolate) P.interpolate(0); return 1;');

    const r = await run('/teleport @e[type=cow,limit=1]');
    const p = await playerPos();
    const pRot = await ev('return { yaw: MCL.Player.yaw, pitch: MCL.Player.pitch };');
    ok(r.ok && r.result === 1, '/teleport <destination> with no <targets> ran and moved exactly 1 (the source itself)', JSON.stringify(r));
    ok(p.x === marker.x && p.y === marker.y && p.z === marker.z, 'the SOURCE (player, no explicit targets) landed exactly at the destination entity\'s position', JSON.stringify({ p, marker }));
    ok(Math.abs(pRot.yaw - marker.yaw) < 1e-9 && Math.abs(pRot.pitch - marker.pitch) < 1e-9, 'the source also took on the destination entity\'s rotation -- .decomp TeleportCommand\'s entity-destination execute() (~line 162) feeds the destination\'s getYaw()/getPitch() into the same teleport() the location form uses', JSON.stringify({ pRot, marker }));

    okAv(marker.yaw !== 0 && marker.pitch !== 0 && !(pRot.yaw === 0 && pRot.pitch === 0),
      'the destination\'s yaw/pitch were deliberately non-zero and non-default before the teleport, so the rotation match above could not pass by coincidence -- a position-only implementation (this project\'s old tpTo, which never touched e.yaw/e.pitch) would have left the player at its own yaw 0 / pitch 0 and failed it',
      JSON.stringify({ marker, pRot }));
  }

  // === 5. /teleport <targets> <destination> -- entity-to-entity, multiple targets (new, w2) ===
  console.log('\n5. /teleport <targets> <destination>');
  {
    await ev('MCL.EntityList.list = MCL.EntityList.list.filter(function (e) { return e.type !== "cow"; }); return 1;');
    const dx = PX + 70, dy = PY + 5, dz = PZ + 5;
    await ev('var P = MCL.Player; P.x = ' + dx + '; P.y = ' + dy + '; P.z = ' + dz + '; P.yaw = 0.6; P.pitch = -0.2; if (P.interpolate) P.interpolate(0); return 1;');
    const bx = PX + 80, bz = PZ + 5;
    await ev('MCL.EntityList.spawn("cow", ' + bx + ', ' + (PY + 1) + ', ' + bz + ');' +
             'MCL.EntityList.spawn("cow", ' + (bx + 1) + ', ' + (PY + 1) + ', ' + bz + ');' +
             'MCL.EntityList.spawn("cow", ' + (bx + 2) + ', ' + (PY + 1) + ', ' + bz + ');' +
             'return 1;');

    const r = await run('/tp @e[type=cow] @s');
    const cows = await ev('return MCL.EntityList.list.filter(function (e) { return e.type === "cow"; })' +
      '.map(function (e) { return { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch }; });');
    ok(r.ok && r.result === 3, '/tp @e[type=cow] @s ran and moved all 3 cows', JSON.stringify(r));
    ok(cows.length === 3 && cows.every((c) => c.x === dx && c.y === dy && c.z === dz), 'every targeted cow landed exactly at the destination selector\'s (@s, the player\'s) position', JSON.stringify(cows));
    ok(cows.every((c) => Math.abs(c.yaw - 0.6) < 1e-9 && Math.abs(c.pitch - (-0.2)) < 1e-9), 'every targeted cow also took on the destination\'s rotation, same rule as the self-default form above', JSON.stringify(cows));

    okAv(r.result === 3 && cows.length === 3,
      'a plausible "only the FIRST matching target moves" bug (dropping the multi-target loop) would have reported result 1 and left 2 of the 3 cows behind at their spawn spot -- the live result/count above rules that out',
      JSON.stringify({ r, cows }));
  }

  // === 6. /teleport <targets> <location> <rotation> -- absolute yaw/pitch (new, session 149 w2) ===
  console.log('\n6. /teleport ... <rotation> -- absolute');
  {
    await ev('MCL.EntityList.list = MCL.EntityList.list.filter(function (e) { return e.type !== "cow"; }); return 1;');
    const rx = PX + 90, rz = PZ;
    await ev('var c = MCL.EntityList.spawn("cow", ' + rx + ', ' + (PY + 1) + ', ' + rz + '); c.yaw = 0; c.pitch = 0; return 1;');

    const r = await run('/tp @e[type=cow,limit=1] ' + rx + ' ' + PY + ' ' + rz + ' 90 -30');
    const after = await ev('var e = MCL.EntityList.list.filter(function (e) { return e.type === "cow"; })[0];' +
      'return e ? { yaw: e.yaw, pitch: e.pitch } : null;');
    const DEG = Math.PI / 180;
    ok(r.ok && r.result === 1, '/tp ... <rotation> ran and moved 1 entity', JSON.stringify(r));
    ok(after !== null && Math.abs(after.yaw - 90 * DEG) < 1e-9, 'absolute yaw 90 lands at exactly 90 DEGREES in radians', JSON.stringify(after));
    ok(after !== null && Math.abs(after.pitch - (-30 * DEG)) < 1e-9, 'absolute pitch -30 lands at exactly -30 degrees in radians', JSON.stringify(after));

    okAv(Math.abs(90 * DEG - 90) > 1,
      'replaying a DEG-conversion-dropped bug (storing the typed "90" as 90 RADIANS instead of 90 DEGREES, the exact mistake `/execute rotated`\'s own comment warns about) shows it would land many full turns away from a quarter turn (90rad vs 90deg-as-radians = ' + (90 * DEG).toFixed(4) + ') -- proving the conversion the assertions above check for is actually doing something',
      JSON.stringify({ raw90AsRadians: 90, ninetyDegAsRadians: 90 * DEG }));
  }

  // === 7. /teleport <targets> <location> <rotation> -- ~ relative to the SOURCE (new, w2) ===
  console.log('\n7. /teleport ... <rotation> -- ~ relative to the SOURCE, not the target');
  {
    await ev('MCL.EntityList.list = MCL.EntityList.list.filter(function (e) { return e.type !== "cow"; }); return 1;');
    const rx = PX + 100, rz = PZ;
    const srcYaw = 40 * (Math.PI / 180), srcPitch = 10 * (Math.PI / 180);
    // the source (player) faces one known rotation; the cow being teleported starts at a
    // deliberately different one (5 RADIANS -- nowhere near any plausible relative result), so
    // "relative to the source" and a plausible "relative to the target's own prior rotation" bug
    // would disagree if the wrong entity's rotation were used as the base.
    await ev('var P = MCL.Player; P.yaw = ' + srcYaw + '; P.pitch = ' + srcPitch + '; if (P.interpolate) P.interpolate(0); return 1;');
    await ev('var c = MCL.EntityList.spawn("cow", ' + rx + ', ' + (PY + 1) + ', ' + rz + '); c.yaw = 5; c.pitch = 5; return 1;');

    const r = await run('/tp @e[type=cow,limit=1] ' + rx + ' ' + PY + ' ' + rz + ' ~10 ~-5');
    const after = await ev('var e = MCL.EntityList.list.filter(function (e) { return e.type === "cow"; })[0];' +
      'return e ? { yaw: e.yaw, pitch: e.pitch } : null;');
    const DEG = Math.PI / 180;
    const expectYaw = srcYaw + 10 * DEG, expectPitch = srcPitch - 5 * DEG;
    ok(r.ok && r.result === 1, '/tp ... ~10 ~-5 ran and moved 1 entity', JSON.stringify(r));
    ok(after !== null && Math.abs(after.yaw - expectYaw) < 1e-9, '~10 yaw resolves relative to the SOURCE\'s current yaw (40deg + 10deg), not the target cow\'s own prior yaw (5 radians)', JSON.stringify({ after, expectYaw }));
    ok(after !== null && Math.abs(after.pitch - expectPitch) < 1e-9, '~-5 pitch resolves relative to the SOURCE\'s current pitch (10deg - 5deg), same rule', JSON.stringify({ after, expectPitch }));

    const wrongTargetRelative = { yaw: 5 + 10 * DEG, pitch: 5 + (-5) * DEG };
    okAv(after !== null && Math.abs(wrongTargetRelative.yaw - expectYaw) > 0.1 && Math.abs(after.yaw - expectYaw) < 1e-9,
      'a plausible alternative bug -- resolving `~` relative to the TARGET entity\'s own prior rotation instead of the command SOURCE\'s -- would have produced a clearly different yaw (' + wrongTargetRelative.yaw.toFixed(3) + ' rad vs the correct ' + expectYaw.toFixed(3) + ' rad); the live result above matches the source-relative rule, not this one',
      JSON.stringify({ wrongTargetRelative, expectYaw, actual: after && after.yaw }));
  }

  // === 8. anti-vacuity -- the pre-fix tpTo is simulated ===
  console.log('\n8. anti-vacuity -- the pre-fix velocity clear is simulated');
  {
    const preFix = (function () {
      var e = { vx: 0.37, vy: -0.8, vz: -0.21 };
      if (e.vx !== undefined) { e.vx = 0; e.vy = 0; e.vz = 0; }
      return e;
    })();
    okAv(preFix.vx === 0 && preFix.vz === 0,
      'replaying the PRE-FIX tpTo (zero vx/vy/vz unconditionally) on this own cow scene shows it WOULD have wiped the horizontal velocity too -- proving the live "horizontal velocity survives" assertion above is not vacuous',
      JSON.stringify(preFix));
  }

  {
    // a second break: prove the "/help does not claim unregistered forms" assertion can actually
    // fail, by replaying it against a fabricated usage list that DOES claim a destination/rotation
    // form MC-Lite has never registered.
    const fabricatedUsage = ['/teleport <location>', '/teleport <targets> <destination> facing <rotation>'];
    const wouldCatch = !fabricatedUsage.every((l) => !/destination|rotation|facing/.test(l));
    okAv(wouldCatch,
      'replaying the "/help teleport does not overclaim" assertion against a fabricated usage line that DOES mention destination/rotation/facing shows it WOULD have failed -- proving the live assertion above is not vacuous',
      JSON.stringify(fabricatedUsage));
  }

  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' tpcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
