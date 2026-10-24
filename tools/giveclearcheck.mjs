#!/usr/bin/env node
// giveclearcheck.mjs — parallel night worker 1: `/give` and `/clear`, LIVE in the browser
// (MCLITE_PRESET=medium), against a real player/world. `tools/commandcheck.mjs` already
// exercises the happy path for both (§ /give, § /clear) but only ever with `@s`-to-self and
// small counts — never a scenario where the requested amount exceeds what vanilla actually
// allows, and never an empty-inventory or dry-run `/clear`. This file drove both commands for
// real and found three bugs nothing had ever caught:
//
//   1. `/give` HAD NO PER-ITEM CAP. Vanilla's own limit (`GiveCommand.MAX_STACKS` = 100,
//      `.decomp/net/minecraft/server/command/GiveCommand.java:19,54-56`) is
//      `item.getMaxCount() * 100` — 6400 for a full-stack-64 item, but only 100 for a
//      maxStack=1 item (tools, swords, armour…), and vanilla REJECTS an over-cap request with
//      `commands.give.failed.toomanyitems` rather than giving whatever fits. `src/15g_commands.js`
//      had only the grammar's flat `count` bound (1–6400, sized for a maxStack=64 item) and no
//      runtime check at all: `/give @s diamond_sword 200` (maxStack=1, vanilla cap=100) silently
//      ran anyway, claimed "Gave 200 Diamond Sword to Dan", and quietly under-delivered whatever
//      the inventory happened to have room for (36, in the case that exposed this — the
//      survival inventory's own 36 slots, not vanilla's 100-cap OR the loop's 512-iteration
//      guard). Fixed with a runtime `count > IT.maxStack(item) * 100` check that throws
//      `commands.give.failed.toomanyitems`, matching vanilla exactly, BEFORE anything is added.
//   2. `/clear` NEVER FAILED. Vanilla's `ClearCommand.execute` throws `clear.failed.single` /
//      `.multiple` whenever the matched total is 0 (`.decomp/…/ClearCommand.java:70-76`) — a red
//      error, not command success. `src/15g_commands.js`'s `clear()` had no such check: `/clear
//      @s stone` on a player with no stone reported "Removed 0 items from player Dan" as an
//      *ok* result. Fixed with a `removed === 0` check that throws the matching vanilla key.
//   3. `/clear <targets> <item> 0` DID NOT DRY-RUN. Vanilla's own "0" is not "remove nothing" —
//      it is COUNT-ONLY: `PlayerInventory.remove`'s `removeAll = (count == 0)` flag
//      (`.decomp/net/minecraft/entity/player/PlayerInventory.java:162-172` ->
//      `Inventories.remove`) counts every matching stack WITHOUT decrementing it, and the
//      feedback is `commands.clear.test.*`, not `.success.*`. `src/15g_commands.js`'s `take =
//      Math.min(st.n, max - removed)` collapsed to 0 for every stack when `max === 0`, so the
//      dry run correctly left the inventory untouched but reported "Removed 0 items" — the
//      WRONG number (0 instead of the real count) with the WRONG key (success, not test), and
//      after bug 2's fix above would have thrown a spurious failure on every non-empty dry run.
//      Fixed with an explicit `testMode = (max === 0)` branch that counts and reports through
//      the `.test.*` keys without ever calling `Iv.removeItem`.
//
// Sections:
//   1. /give — the happy path still works (regression), the exact-cap boundary (100 for a
//      maxStack=1 item) still succeeds, and one over the cap fails with the right message and
//      gives NOTHING (not a partial, silent under-delivery).
//   2. /clear — a dry run (`maxCount 0`) reports the real count and leaves the inventory
//      untouched; a `/clear` that matches nothing fails loudly instead of reporting a quiet
//      zero; and the ordinary partial-clear path is unaffected by either fix (regression).
//   3. anti-vacuity — the pre-fix `give`/`clear` are each simulated by monkey-patching
//      `MCL.Commands.run`, proving every assertion above would have failed on the old code.
//
//   MCLITE_PRESET=medium node tools/giveclearcheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  giveclearcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();
  const ev = (body) => page.evaluate(mkFn(body));

  async function resetScene() {
    await ev(
      'var P = MCL.Player;' +
      'P.flying = false; P.noclip = false; P.health = 20; P.dead = false;' +
      'MCL.Commands.run("/gamemode survival", P, {name:"Dan"});' +
      'MCL.Commands.run("/clear", P, {name:"Dan"});' +
      'return 1;'
    );
  }
  const countOf = (item) => ev('return MCL.Inventory.countOf(MCL.Player.inventory, "' + item + '");');
  const give = (item, n) => ev('return MCL.Commands.run("/give @s ' + item + ' ' + n + '", MCL.Player, {name:"Dan"});');
  const clear = (rest) => ev('return MCL.Commands.run("/clear ' + rest + '", MCL.Player, {name:"Dan"});');

  // ═══ 1. /give ═══
  console.log('\n1. /give -- happy path, the exact vanilla cap, and one over it');
  await resetScene();
  const g1 = await give('stone', 64);
  ok(g1.ok, '/give @s stone 64 still works (regression)', JSON.stringify(g1));
  ok((await countOf('stone')) === 64, '...and the stone landed in the inventory');

  await resetScene();
  const g2 = await give('diamond_sword', 100);   // maxStack=1 -> vanilla cap = 1*100 = 100
  ok(g2.ok, '/give @s diamond_sword 100 -- exactly at the vanilla cap -- still succeeds', JSON.stringify(g2));
  ok(g2.ok && /100/.test(g2.lines[0] || ''), '...and the feedback names the full 100', JSON.stringify(g2.lines));

  await resetScene();
  const g3 = await give('diamond_sword', 200);   // one push past what fits, well past vanilla's cap
  ok(!g3.ok, '/give @s diamond_sword 200 -- one push past a maxStack=1 item\'s cap -- FAILS', JSON.stringify(g3));
  ok(g3.error && /100/.test(g3.error.message) && /Diamond Sword/.test(g3.error.message),
    '...with vanilla\'s own "too many" message naming the real cap (100) and the item', JSON.stringify(g3.error));
  ok((await countOf('diamond_sword')) === 0, '...and gives NOTHING at all -- no silent partial delivery', JSON.stringify(await countOf('diamond_sword')));

  // ═══ 2. /clear ═══
  console.log('\n2. /clear -- dry run, failure on zero, ordinary partial clear unaffected');
  await resetScene();
  await give('stone', 40);
  const c1 = await clear('@s stone 0');
  ok(c1.ok, '/clear @s stone 0 -- the dry run -- succeeds', JSON.stringify(c1));
  ok(c1.ok && /40/.test(c1.lines[0] || ''), '...and reports the REAL count (40), not zero', JSON.stringify(c1.lines));
  ok((await countOf('stone')) === 40, '...and leaves every one of them in the inventory');

  await resetScene();
  const c2 = await clear('@s stone');
  ok(!c2.ok, '/clear @s stone on an EMPTY inventory FAILS (vanilla clear.failed.single)', JSON.stringify(c2));
  ok(c2.error && /No items were found/i.test(c2.error.message), '...with vanilla\'s own failure message', JSON.stringify(c2.error));

  await resetScene();
  await give('stone', 40);
  const c3 = await clear('@s stone 10');
  ok(c3.ok && /10/.test(c3.lines[0] || ''), '/clear @s stone 10 -- the ordinary partial path -- still works (regression)', JSON.stringify(c3));
  ok((await countOf('stone')) === 30, '...and takes exactly 10, leaving 30');

  await resetScene();
  await give('stone', 5);
  const c4 = await clear('@s dirt 0');   // dry run for an item the player does NOT have
  ok(!c4.ok, '/clear @s dirt 0 -- a dry run that matches nothing -- ALSO fails (not a silent "found 0")', JSON.stringify(c4));

  // ═══ 2b. item_stack NBT suffix (#6315) ═══
  console.log('\n2b. item_stack takes an NBT suffix -- /give writes it, /clear matches by it');
  const run = (cmd) => ev('return MCL.Commands.run(' + JSON.stringify(cmd) + ', MCL.Player, {name:"Dan"});');
  const nameOfFirst = (item) => ev('var inv=MCL.Player.inventory,I=MCL.Inventory;for(var k=0;k<I.SIZE;k++){var s=I.getItem(inv,k);if(!I.isEmpty(s)&&s.i===MCL.Items.of("' + item + '"))return JSON.stringify(s.t||null);}return "none";');
  await resetScene();
  const t1 = await run("/give @s stick{display:{Name:'\"x\"'}}");
  ok(t1.ok, "/give @s stick{display:{Name:'\"x\"'}} parses and succeeds", JSON.stringify(t1));
  const tagJson = await nameOfFirst('stick');
  ok(/"display"/.test(tagJson) && /"Name":"\\?"x\\?""/.test(tagJson), '...and the stack carries tag.display.Name', tagJson);
  await give('stick', 3);
  const t2 = await run('/clear @s stick{display:{Name:\'"x"\'}} 0');
  ok(t2.ok && /1\b/.test(t2.lines[0] || ''), '/clear by tag counts only the tagged stick (1 of 4)', JSON.stringify(t2));
  const t3 = await run('/clear @s stick{display:{Name:\'"y"\'}}');
  ok(!t3.ok, '/clear with a non-matching tag fails', JSON.stringify(t3));
  const t4 = await run('/give @s stick{display:');
  ok(!t4.ok && t4.error && /value|Expected/i.test(t4.error.message), '/give with a bad tag fails with the argument.nbt message', JSON.stringify(t4.error));
  await resetScene();
  const t5 = await run('/item replace entity @s hotbar.0 with stick{foo:1}');
  ok(t5.ok && /"foo":1/.test(await nameOfFirst('stick')), '/item replace ... with carries the tag', JSON.stringify(t5));

  // ═══ 3. anti-vacuity -- simulate the PRE-FIX /give and /clear ═══
  console.log('\n3. anti-vacuity -- the pre-fix give()/clear() are simulated');
  await resetScene();
  const patched = await ev(
    'window.__origRun = MCL.Commands.run;' +
    'MCL.Commands.run = function (line, player, opts) {' +
    '  var t = line.trim();' +
    '  var mg = /^\\/give @s ([a-z_]+) (\\d+)$/.exec(t);' +
    '  if (mg) {' +   // the OLD give(): no cap check at all
    '    var IT = MCL.Items, Iv = MCL.Inventory, item = IT.of(mg[1]), left = parseInt(mg[2], 10);' +
    '    var guard = 0;' +
    '    while (left > 0 && guard++ < 512) { var n = Math.min(left, IT.maxStack(item)); Iv.add(player.inventory, Iv.stack(item, n)); left -= n; }' +
    '    return { ok: true, lines: ["Gave " + mg[2] + " x to Dan"] };' +
    '  }' +
    '  var mc = /^\\/clear @s ([a-z_]+)(?: (\\d+))?$/.exec(t);' +
    '  if (mc) {' +   // the OLD clear(): always success, max===0 gave take=0 for everything
    '    var Iv2 = MCL.Inventory, IT2 = MCL.Items, item2 = IT2.of(mc[1]);' +
    '    var max = mc[2] === undefined ? -1 : parseInt(mc[2], 10);' +
    '    var removed = 0;' +
    '    for (var i = 0; i < Iv2.SIZE; i++) {' +
    '      var st = Iv2.getItem(player.inventory, i);' +
    '      if (Iv2.isEmpty(st) || st.i !== item2) continue;' +
    '      var take = (max < 0) ? st.n : Math.min(st.n, max - removed);' +
    '      if (take <= 0) continue;' +
    '      Iv2.removeItem(player.inventory, i, take); removed += take;' +
    '      if (max >= 0 && removed >= max) break;' +
    '    }' +
    '    return { ok: true, lines: ["Removed " + removed + " items from player Dan"] };' +
    '  }' +
    '  return window.__origRun.call(MCL.Commands, line, player, opts);' +
    '};' +
    'return 1;'
  );
  ok(patched === 1, 'the pre-fix give()/clear() can be simulated for the anti-vacuity pass');

  await resetScene();
  const bg = await give('diamond_sword', 200);
  okAv(bg.ok === true, 'on the pre-fix build /give @s diamond_sword 200 reports SUCCESS (no cap at all)',
    JSON.stringify(bg));
  const bgCount = await countOf('diamond_sword');
  okAv(bgCount !== 200, 'on the pre-fix build it silently under-delivers (only ' + bgCount + ' actually fit) -- proving section 1\'s "gives NOTHING at all" assertion is not vacuous',
    JSON.stringify(bgCount));

  await resetScene();
  const bc = await clear('@s stone');
  okAv(bc.ok === true, 'on the pre-fix build /clear @s stone with an EMPTY inventory reports SUCCESS -- proving section 2\'s "clear.failed" assertion is not vacuous',
    JSON.stringify(bc));

  await resetScene();
  await give('stone', 40);
  const bc2 = await clear('@s stone 0');
  okAv(bc2.ok === true && /Removed 0/.test(bc2.lines[0] || ''),
    'on the pre-fix build /clear @s stone 0 reports "Removed 0 items" (wrong number, wrong key) -- proving section 2\'s "reports the REAL count" assertion is not vacuous',
    JSON.stringify(bc2.lines));

  await ev('MCL.Commands.run = window.__origRun; return 1;');

  // tag copy dropped: Inventory.stack ignores its tag argument -> the Name assertion must fail
  await resetScene();
  await ev('var I = MCL.Inventory; window.__origStack = I.stack; I.stack = function (a, b, c) { return window.__origStack.call(I, a, b, c); }; return 1;');
  await run("/give @s stick{display:{Name:'\"x\"'}}");
  const dropped = await nameOfFirst('stick');
  okAv(!/"display"/.test(dropped), 'with the tag copy dropped the stack has no display.Name -- the section 2b assertion is not vacuous', dropped);
  await ev('MCL.Inventory.stack = window.__origStack; return 1;');
  await resetScene();

  ok(page.problems.length === 0, 'the page logged no errors', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' giveclearcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
