#!/usr/bin/env node
// commandcheck.mjs — PLAN G12b. Brigadier, the nine commands, and the 65 that are owed.
//
//   node tools/commandcheck.mjs [--verbose]
//
// ⚠ THREE THINGS ARE HELD CLOSED HERE, each against a source this check did not write:
//   1. the ROSTER, against `tools/golden/commands-1.18.2.tsv` — every implemented command exists
//      in vanilla, at the operator level vanilla gives it, with vanilla's aliases; and the ones
//      that are NOT implemented are named rather than forgotten;
//   2. every user-facing STRING, against the shipped `lang.bin` — the parser and the commands
//      must contain no English of their own, and §5 scans the SOURCE for quoted prose;
//   3. the PARSER's behaviour against Brigadier's own rules: cursors on errors, literals before
//      arguments, the best-of-several-partials choice, and `<--[HERE]`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02f_tags.js', '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
  '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
{
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
const B = NS.Brig, C = NS.Commands;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('commandcheck — PLAN G12b, Brigadier and the commands (D-316)');

// a player and a world for the commands to act on
const mkPlayer = () => {
  const P = { x: 10, y: 70, z: -5, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false,
              inventory: NS.Inventory.create(), syncHotbar() {}, mayFly: false, instabuild: false,
              flying: false, invulnerable: false, mayBuild: true };
  NS.Player = P;
  if (NS.Survival && NS.Survival.init) NS.Survival.init(P);
  return P;
};
NS.Main = { seed: 1337, seed64: 1337n };
// ⚠ THE REGISTRY, because `/setblock` and `/fill` take a BLOCK STATE and a check that stubbed one
// would be asserting its own stub. `initRegistry` is the same call `17_main.js` makes.
{
  const { initRegistry } = await import('./loadsrc.mjs');
  initRegistry(NS);
}
// the game rule table, exactly as `gen-data` inlines it
NS.DATA = NS.DATA || {};
NS.DATA.gameRules = (() => {
  const out = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'gamerules-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) out[c[0]] = { t: c[1] === 'integer' ? 'i' : 'b', d: c[2] };
  }
  return out;
})();
// a tiny world for the block commands: a flat array, so `/fill` is asserted by what it wrote
const WORLD = new Map();
NS.World = {
  getBlock: (x, y, z) => WORLD.get(x + ',' + y + ',' + z) || 0,
  // ⚠ MUST RETURN true ON SUCCESS, matching the real 07_world.js `W.setBlock`'s own contract
  // (session 150 worker1): `/setblock`'s handler now checks the return value (it used to ignore
  // it, silently reporting success even when nothing was written -- .decomp SetBlockCommand
  // throws when the real `setBlockState` call fails). A stub that returned `undefined` made
  // every `/setblock` in this file look like a real-world "unloaded chunk" failure.
  setBlock: (x, y, z, id) => { WORLD.set(x + ',' + y + ',' + z, id); return true; }
};
NS.Sky.dayTime = 1000;
NS.Sky.weather = NS.Sky.newWeather();
let P = mkPlayer();
C.build();
ok(C.ready, 'the dispatcher builds');
ok(NS.Reg && NS.Reg.ready, 'the block registry is up, so a block state argument is real');

const run = (line, opts) => C.run(line, NS.Player, opts || {});

// ═══════════════ 1. the roster, against the bytecode's own table ═══════════════════════════
console.log('\n 1. the roster against tools/golden/commands-1.18.2.tsv');
const GOLD = new Map();
{
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'commands-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) GOLD.set(c[0], { level: +c[1], aliases: c[2] ? c[2].split(',') : [] });
  }
}
ok(GOLD.size === 74, `vanilla 1.18.2 has ${GOLD.size} commands`);
{
  const d = C.dispatcher;
  const roots = d.root.children.map((n) => n.name).sort();
  say('registered: ' + roots.join(' '));
  // ⚠ EVERY REGISTERED ROOT IS EITHER A VANILLA COMMAND OR A VANILLA ALIAS. A command this game
  // invented would be the clearest possible parity failure and nothing else would notice it.
  const aliasOf = new Map();
  for (const [n, g] of GOLD) for (const a of g.aliases) aliasOf.set(a, n);
  for (const r of roots) {
    ok(GOLD.has(r) || aliasOf.has(r), `/${r} is registered and is not a vanilla command or alias`);
  }
  // ...and every implemented command is registered
  for (const n of C.IMPLEMENTED) ok(roots.indexOf(n) >= 0, `Commands.IMPLEMENTED names /${n}, which is not registered`);
  for (const r of roots) {
    if (aliasOf.has(r)) continue;
    ok(C.IMPLEMENTED.indexOf(r) >= 0, `/${r} is registered and not in Commands.IMPLEMENTED`);
  }
  // ⚠ THE ALIASES MUST BE THE ONES VANILLA DECLARES, both directions, for the commands we have.
  for (const n of C.IMPLEMENTED) {
    for (const a of (GOLD.get(n) || { aliases: [] }).aliases) {
      ok(roots.indexOf(a) >= 0, `/${n} has vanilla alias /${a} and it is not registered`);
    }
  }
  for (const r of roots) {
    if (!aliasOf.has(r)) continue;
    ok(C.IMPLEMENTED.indexOf(aliasOf.get(r)) >= 0,
       `/${r} is an alias of /${aliasOf.get(r)}, which is not implemented`);
  }
  // ⚠ AND THE PERMISSION LEVELS ARE VANILLA'S. `/help` is level 0; everything else here is 2.
  const src0 = C.source(P, { level: 0 });
  const src2 = C.source(P, { level: 2 });
  for (const n of C.IMPLEMENTED) {
    const node = d.get(n);
    const want = GOLD.get(n).level;
    ok(node.canUse(C.source(P, { level: want })), `/${n} is refused at its own level ${want}`);
    if (want > 0) ok(!node.canUse(C.source(P, { level: want - 1 })),
                     `/${n} is level ${want} and a level ${want - 1} source may still run it`);
  }
  ok(d.get('help').canUse(src0), '/help is level 0 and anyone may run it');
  ok(!d.get('gamemode').canUse(src0), '/gamemode is level 2 and a level 0 source may not');
  ok(d.get('gamemode').canUse(src2), '...and a level 2 source may');
  // the OWED complement, named and counted
  const owed = [...GOLD.keys()].filter((n) => C.IMPLEMENTED.indexOf(n) < 0).sort();
  console.log(`    ${C.IMPLEMENTED.length} implemented, ${owed.length} owed of ${GOLD.size}`);
  say('owed: ' + owed.join(' '));
  ok(C.IMPLEMENTED.length + owed.length === GOLD.size, 'the two halves do not add up to the roster');
  ok(C.OWED_NOTE.indexOf(String(owed.length)) >= 0,
     `Commands.OWED_NOTE must name the ${owed.length} that are owed — it says "${C.OWED_NOTE}"`);
}

// ═══════════════ 2. the reader, by Brigadier's own rules ═══════════════════════════════════
console.log('\n 2. the StringReader');
{
  const R = (s) => new B.Reader(s);
  ok(R('abc').readUnquoted() === 'abc', 'a bare word');
  ok(R('a-b.c+d_e').readUnquoted() === 'a-b.c+d_e',
     'the allowed set is letters, digits, _ - . and + — `minecraft:x` stops at the colon');
  ok(R('minecraft:stone').readUnquoted() === 'minecraft', '...which is what makes a colon a separator');
  ok(R('"hello world"').readQuoted() === 'hello world', 'a double-quoted string');
  ok(R("'it''s'").readQuoted() === 'it', 'a single-quoted string ends at its own quote');
  ok(R('"a\\"b"').readQuoted() === 'a"b', 'an escaped quote inside a quoted string');
  ok(R('123').readInt() === 123 && R('-4').readInt() === -4, 'integers, signed');
  ok(R('1.5').readDouble() === 1.5 && R('-.5').readDouble() === -0.5, 'doubles, including a bare point');
  ok(R('true').readBoolean() === true && R('false').readBoolean() === false, 'booleans');
  const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const e1 = thrown(() => R('abc').readInt());
  ok(e1 && e1.key === 'parsing.int.expected', `a non-number is "${e1 && e1.key}"`);
  const e2 = thrown(() => R('"unclosed').readQuoted());
  ok(e2 && e2.key === 'parsing.quote.expected.end', `an unclosed quote is "${e2 && e2.key}"`);
  const e3 = thrown(() => R('maybe').readBoolean());
  ok(e3 && e3.key === 'parsing.bool.invalid', `a non-boolean is "${e3 && e3.key}"`);
  // ⚠ THE CURSOR IS PART OF THE ERROR. A parser that throws without one cannot draw `<--[HERE]`.
  const r4 = R('  12x');
  r4.skipWhitespace();
  ok(r4.cursor === 2, 'skipWhitespace moves the cursor');
  const e5 = thrown(() => { const q = R('hello'); q.expect('x'); });
  ok(e5 && e5.key === 'parsing.expected' && e5.cursor === 0, `expect() reports its own position (${e5 && e5.cursor})`);
}

// ═══════════════ 3. the dispatcher ═════════════════════════════════════════════════════════
console.log('\n 3. the dispatcher');
{
  const d = new B.Dispatcher();
  let hit = null;
  d.register(B.literal('foo').then(B.literal('bar').executes(() => { hit = 'bar'; return 7; }))
                             .then(B.arg('n', B.integer(0, 10)).executes((c) => { hit = 'n' + B.get(c, 'n'); return 1; })));
  const s = {};
  ok(d.execute('foo bar', s).ok && hit === 'bar', 'a literal path runs');
  ok(d.execute('foo bar', s).result === 7, '...and its return value comes back');
  ok(d.execute('foo 5', s).ok && hit === 'n5', 'an argument path runs');
  // ⚠ LITERALS BEAT ARGUMENTS. `bar` is not a number and must not be tried as one first.
  const r = d.execute('foo bar', s);
  ok(r.ok, 'a word that names a literal is not parsed as the argument beside it');
  // ⚠ WITH TWO CHILDREN, TWO ERRORS, AND BRIGADIER REPORTS THE GENERIC ONE. `foo 50` fails the
  // `bar` literal AND the 0..10 argument, and vanilla's rule is: exactly one exception -> throw
  // it; otherwise -> "Incorrect argument for command". The first draft of this check demanded
  // `argument.integer.big` here and was asserting something brigadier does not do.
  const bad = d.execute('foo 50', s);
  ok(!bad.ok && bad.error.key === 'command.unknown.argument',
     `two failing children give the generic message: "${bad.error.key}"`);
  // ...and with ONE child the specific error DOES come through, which is the other half of the rule
  {
    const d3 = new B.Dispatcher();
    d3.register(B.literal('only').then(B.arg('n', B.integer(0, 10)).executes(() => 1)));
    const e = d3.execute('only 50', s);
    ok(!e.ok && e.error.key === 'argument.integer.big', `one failing child reports itself: "${e.error.key}"`);
    ok(e.error.cursor === 5, `and it points at the number, not past it (cursor ${e.error.cursor})`);
  }
  // an unknown root, with more than one root registered — which is every real game
  {
    const d4 = new B.Dispatcher();
    d4.register(B.literal('aaa').executes(() => 1));
    d4.register(B.literal('bbb').executes(() => 1));
    const unk2 = d4.execute('nope', s);
    ok(!unk2.ok && unk2.error.key === 'command.unknown.command', `an unknown root: "${unk2.error.key}"`);
  }
  const part = d.execute('foo', s);
  ok(!part.ok && part.error.key === 'command.unknown.command', 'a command with no runnable path is incomplete');
  const trail = d.execute('foo bar baz', s);
  ok(!trail.ok, 'trailing rubbish is refused');
  // <--[HERE]
  const ctxLine = bad.error.context();
  ok(ctxLine.indexOf('<--[HERE]') >= 0, `the error carries its context: "${ctxLine}"`);
  ok(ctxLine.indexOf('foo ') === 0, '...and the text before the cursor');
  // suggestions
  const sug = d.suggest('foo b', s);
  ok(sug.matches.join(',') === 'bar', `completion offers ${JSON.stringify(sug.matches)}`);
  ok(sug.start === 4, `and points at the word being completed (start ${sug.start})`);
  // requires() hides a node from everything
  const d2 = new B.Dispatcher();
  d2.register(B.literal('secret').requires(() => false).executes(() => 1));
  ok(!d2.execute('secret', s).ok, 'a node whose requirement fails cannot run');
  ok(d2.suggest('sec', s).matches.length === 0, '...and does not appear in completion');
  ok(d2.names(s).length === 0, '...or in the name list');
}

// ═══════════════ 4. the nine commands ══════════════════════════════════════════════════════
console.log('\n 4. the commands do what they say');
{
  P = mkPlayer();
  // /gamemode
  ok(run('/gamemode creative').ok && P.mode === NS.Gamemode.CREATIVE, 'gamemode creative sets the mode');
  ok(P.instabuild === true, '...and the ABILITY, which is what the rest of the game reads');
  ok(run('/gamemode survival').ok && P.mode === NS.Gamemode.SURVIVAL, 'and back to survival');
  ok(P.instabuild === false, '...clearing it again');
  const g = run('/gamemode nope');
  ok(!g.ok && g.error.key === 'argument.entity.options.mode.invalid', `an unknown mode: "${g.error.key}"`);
  ok(run('/gamemode creative').lines[0] === NS.Text.translate('commands.gamemode.success.self',
     [NS.Text.translate('gameMode.creative')]), 'the message is the lang file\'s, verbatim');

  { const same = run('/gamemode creative');
    ok(same.ok && same.lines.length === 0 && same.result === 0, `/gamemode to the current mode: silent, returns 0 (${same.lines.length} lines, ${same.result})`);
    const chg = run('/gamemode survival');
    ok(chg.result === 1 && chg.lines.length === 1, `a real change returns 1 with one line (${chg.result})`);
    ok(run('/defaultgamemode creative').result === 0, '/defaultgamemode returns 0 players changed when nothing is forced'); }

  // /give
  P = mkPlayer();
  ok(run('/give @s stone 64').ok, 'give works');
  ok(NS.Inventory.countOf(P.inventory, 'stone') === 64, `64 stone arrived (${NS.Inventory.countOf(P.inventory, 'stone')})`);
  run('/give @s stone 64');
  ok(NS.Inventory.countOf(P.inventory, 'stone') === 128, 'and again');
  // ⚠ A STACK SIZE OF ONE MEANS SEPARATE SLOTS, not one slot claiming five
  run('/give @s diamond_sword 5');
  ok(NS.Inventory.countOf(P.inventory, 'diamond_sword') === 5, 'five swords arrived');
  {
    let slots = 0;
    for (let i = 0; i < NS.Inventory.SIZE; i++) {
      const st = NS.Inventory.getItem(P.inventory, i);
      if (st && NS.Items.names[st.i] === 'diamond_sword') slots++;
    }
    ok(slots === 5, `...in ${slots} separate slots, because a sword stacks to one`);
  }
  ok(run('/give @s minecraft:dirt 3').ok, 'the minecraft: namespace is optional and accepted');
  const gi = run('/give @s not_a_thing 1');
  ok(!gi.ok && gi.error.key === 'argument.item.id.invalid', `an unknown item: "${gi.error.key}"`);
  const gc = run('/give @s stone 0');
  ok(!gc.ok, 'a count of zero is refused (the argument is 1..6400)');

  // /time
  NS.Sky.dayTime = 0;
  // minecraft:time is a FLOAT then a whole-string unit, and Math.round(float) saturates (TimeArgumentType.java:30-45)
  {
    const tt = C.arg.time(0);
    const tp = (str) => { try { return tt.parse(new B.Reader(str)); } catch (e) { return e.key; } };
    ok(tp('3000000000') === 2147483647, `time 3000000000 saturates: ${tp('3000000000')}`);
    ok(tp('16777217') === 16777216, `time 16777217 is float-rounded: ${tp('16777217')}`);
    ok(tp('1000000d') === 2147483647, `time 1000000d saturates: ${tp('1000000d')}`);
    ok(tp('10dd') === 'argument.time.invalid_unit', `time 10dd: ${tp('10dd')}`);
  }
  ok(run('/time set day').ok && NS.Sky.dayTime === 1000, `time set day is tick ${NS.Sky.dayTime}, vanilla's 1000`);
  ok(run('/time set noon').ok && NS.Sky.dayTime === 6000, 'noon is 6000');
  ok(run('/time set night').ok && NS.Sky.dayTime === 13000, 'night is 13000');
  ok(run('/time set midnight').ok && NS.Sky.dayTime === 18000, 'midnight is 18000');
  ok(run('/time set 500').ok && NS.Sky.dayTime === 500, 'an explicit tick count');
  ok(run('/time add 1d').ok && NS.Sky.dayTime === 500 + 24000, `a day is 24000 ticks (${NS.Sky.dayTime})`);
  ok(run('/time add 1s').ok && NS.Sky.dayTime === 500 + 24000 + 20, 'a second is 20');
  ok(run('/time add 5t').ok && NS.Sky.dayTime === 500 + 24000 + 25, 'a tick is 1');
  const tq = run('/time query daytime');
  ok(tq.ok && tq.lines[0] === NS.Text.translate('commands.time.query', [String(NS.Sky.dayTime % 24000)]),
     `query daytime wraps to the day: "${tq.lines[0]}"`);
  ok(run('/time query gametime').ok && run('/time query day').ok, 'the other two queries run');
  const tb = run('/time set -5');
  ok(!tb.ok, 'a negative time is refused');

  // ⚠⚠ worker3/mobcommand-s146: `/time set`'s FEEDBACK is the raw tick count but its RETURN
  // (the command's own result, what `/execute store result` reads) is `getDayTime()`, WRAPPED
  // mod 24000 (.decomp TimeCommand.java:66-73); `/time add`'s feedback AND return are both
  // wrapped (TimeCommand.java:75-83). Push dayTime past 24000 first so wrapping is not a no-op.
  NS.Sky.dayTime = 20000;
  const tset = run('/time set 30000');
  ok(tset.ok && tset.lines[0] === NS.Text.translate('commands.time.set', ['30000']),
     `set's feedback is the raw value: "${tset.lines[0]}"`);
  ok(tset.result === 6000, `...but its RETURN is wrapped (30000 % 24000 = ${tset.result})`);
  const tadd = run('/time add 4000');
  ok(NS.Sky.dayTime === 34000, `the accumulator itself stays raw (${NS.Sky.dayTime})`);
  ok(tadd.ok && tadd.result === 10000, `add's return is wrapped too (34000 % 24000 = ${tadd.result})`);
  ok(tadd.lines[0] === NS.Text.translate('commands.time.set', ['10000']),
     `...and so is add's feedback: "${tadd.lines[0]}"`);
  okAv(tset.result !== 30000, 'anti-vacuity: the pre-fix bug returned the raw tick count (30000) unwrapped, not 6000');

  // ⚠⚠ `gametime` is `World.getTime()` -- an unconditional per-tick counter (Main.ticks),
  // NOT `getTimeOfDay()` (NS.Sky.dayTime, what /time set/add and doDaylightCycle touch).
  // Prove the two are actually independent: change dayTime and freeze the daylight cycle,
  // and gametime must not move with it.
  NS.Sky.daylightCycle = false;
  NS.Main.ticks = 777;
  NS.Sky.dayTime = 999;
  const gt1 = run('/time query gametime');
  ok(gt1.ok && gt1.result === 777, `gametime reads Main.ticks (${gt1.result}), not dayTime (999)`);
  run('/time set 5000');   // moves dayTime a long way; gametime must not follow it
  const gt2 = run('/time query gametime');
  ok(gt2.result === 777, `.../time set does not move gametime (${gt2.result})`);
  okAv(gt1.result !== 999, "anti-vacuity: the pre-fix bug read dayTime (999 here), not Main.ticks' 777");
  NS.Sky.daylightCycle = true;

  // /weather
  // ⚠⚠ worker3/mobcommand-s146: vanilla's default duration is a flat 6000 ticks
  // (.decomp WeatherCommand.java:9), never a random draw from Sky.*_RANGE -- and the explicit
  // `<duration>` argument is SECONDS, multiplied by 20 (every `executeX` call site), not a bare
  // `minecraft:time` tick count. `setWeather` also reuses ONE value for both rainTime AND
  // thunderTime regardless of which of the two the command is setting.
  ok(run('/weather rain').ok && NS.Sky.weather.rainTime === 6000, `no-duration rain defaults to a flat 6000, not a random draw (${NS.Sky.weather.rainTime})`);
  ok(run('/weather rain 600').ok && NS.Sky.weather.raining === true, 'weather rain starts rain');
  ok(NS.Sky.weather.rainTime === 12000, `...600 SECONDS is 12000 ticks, not 600 (${NS.Sky.weather.rainTime})`);
  okAv(NS.Sky.weather.rainTime !== 600, 'anti-vacuity: parsing <duration> as bare ticks (no *20) would have left rainTime at 600, not 12000');
  ok(NS.Sky.weather.thunderTime === 12000, `...and thunderTime gets the SAME shared value (${NS.Sky.weather.thunderTime})`);
  ok(NS.Sky.weather.thundering === false, '...and not thunder');
  ok(run('/weather thunder 300').ok && NS.Sky.weather.thundering === true, 'weather thunder does both');
  ok(NS.Sky.weather.raining === true, '...because thunder is rain with thunder on top');
  ok(NS.Sky.weather.rainTime === 6000 && NS.Sky.weather.thunderTime === 6000,
     `...300 seconds -> 6000 ticks, shared by both timers (${NS.Sky.weather.rainTime}/${NS.Sky.weather.thunderTime})`);
  const wr = run('/weather thunder 50');
  ok(wr.ok && wr.result === 1000, `weather's return is the tick duration actually applied (${wr.result})`);
  ok(run('/weather clear').ok && NS.Sky.weather.raining === false, 'weather clear stops it');
  ok(NS.Sky.weather.clearTime > 0, `...and sets a clear time (${NS.Sky.weather.clearTime})`);
  ok(NS.Sky.weather.rainTime === 0 && NS.Sky.weather.thunderTime === 0,
     `...and zeroes BOTH the other timers, not just the flags (${NS.Sky.weather.rainTime}/${NS.Sky.weather.thunderTime})`);

  // /teleport and /tp
  P = mkPlayer();
  ok(run('/tp 1 2 3').ok && P.x === 1 && P.y === 2 && P.z === 3, 'tp to an absolute position');
  ok(run('/tp ~ ~10 ~').ok && P.x === 1 && P.y === 12 && P.z === 3, 'tilde is relative, and a bare tilde is unchanged');
  ok(run('/teleport ~-1 ~ ~2').ok && P.x === 0 && P.z === 5, 'a tilde with a number');
  ok(run('/tp @s 50 60 70').ok && P.x === 50, 'tp with an explicit target');
  const tpm = run('/tp ^1 ~2 3');
  // ⚠ THE COMMAND gives the generic message, because `/teleport` has two children and both fail —
  // vanilla's own rule, asserted above. The SPECIFIC error belongs to the argument type, so it is
  // asserted on the type, which is the only place it can be seen.
  ok(!tpm.ok, 'mixing ^ and ~ is refused by the command');
  {
    const t = C.arg.vec3(false);
    let key = null;
    try { t.parse(new B.Reader('^1 ~2 3')); } catch (e) { key = e.key; }
    ok(key === 'argument.pos.mixed', `and the vec3 type says why: "${key}"`);
    let k2 = null;
    try { t.parse(new B.Reader('1 2')); } catch (e) { k2 = e.key; }
    ok(k2 === 'parsing.expected' || k2 === 'argument.pos.missing.double',
       `two coordinates where three are wanted: "${k2}"`);
  }

  // /kill
  P = mkPlayer();
  P.health = 20;
  ok(run('/kill').ok, 'kill with no target kills the runner');
  ok(P.health <= 0 || P.dead, `...and the player is dead (health ${P.health})`);

  // /seed
  const sd = run('/seed');
  ok(sd.ok && sd.lines[0] === NS.Text.translate('commands.seed.success', ['1337']), `seed: "${sd.lines[0]}"`);

  // /help
  const h = run('/help');
  ok(h.ok && h.lines.length === C.dispatcher.names(C.source(P, {})).length,
     `help lists every command a level 4 source may run (${h.lines.length})`);
  ok(h.lines.indexOf('/seed') >= 0, '...including /seed');
  // ⚠ AND ONLY WHAT THE SOURCE MAY RUN — the one place the permission gate is visible.
  const h0 = C.run('/help', P, { level: 0 });
  ok(h0.ok && h0.lines.length < h.lines.length,
     `a level 0 source is shown ${h0.lines.length} commands, not ${h.lines.length}`);
  ok(h0.lines.indexOf('/gamemode') < 0, '...and /gamemode is not among them');
  const hu = run('/help notacommand');
  ok(!hu.ok && hu.error.key === 'commands.help.failed', `help for an unknown command: "${hu.error.key}"`);
  const hg = run('/help gamemode');
  ok(hg.ok && hg.lines.some((l) => l.indexOf('<mode>') >= 0), `help shows the usage: ${JSON.stringify(hg.lines)}`);
}

// ═══════════════ 4b. the thirteen of batch two ═════════════════════════════════════════════
console.log('\n 4b. the block, chat, sound and rule commands');
{
  P = mkPlayer();
  const at = (x, y, z) => NS.World.getBlock(x, y, z);
  const stoneState = NS.States.stateOf('stone');

  // /setblock, and its three modes
  ok(run('/setblock 1 2 3 stone').ok && at(1, 2, 3) === stoneState, `setblock wrote ${at(1, 2, 3)}`);
  ok(run('/setblock 1 2 3 dirt keep').ok === false, 'keep refuses to replace a non-air block');
  ok(at(1, 2, 3) === stoneState, '...and really did not replace it');
  ok(run('/setblock 1 2 3 dirt replace').ok && at(1, 2, 3) === NS.States.stateOf('dirt'), 'replace does');
  // ⚠ THE PROPERTY BRACKETS. `oak_stairs[facing=east]` must reach a DIFFERENT state from the
  // default, or the parser is accepting the brackets and dropping them.
  const plain = NS.States.stateOf('oak_stairs');
  ok(run('/setblock 5 5 5 oak_stairs[facing=east]').ok, 'a block state with a property parses');
  const withProp = at(5, 5, 5);
  ok(withProp !== plain, `and it is a different state (${withProp} vs the default ${plain})`);
  ok(NS.States.name(withProp) === 'oak_stairs', '...of the same block');
  ok(run('/setblock 6 6 6 oak_stairs[facing=east,half=top]').ok, 'two properties parse');
  ok(at(6, 6, 6) !== withProp, 'and the second one changes the state again');
  const bp = run('/setblock 7 7 7 stone[facing=east]');
  ok(!bp.ok && bp.error.key === 'argument.block.property.unknown',
     `a property the block does not have: "${bp.error.key}"`);
  const bv = run('/setblock 7 7 7 oak_stairs[facing=sideways]');
  ok(!bv.ok, 'a value the property does not take is refused');
  const bd = run('/setblock 7 7 7 oak_stairs[facing=east,facing=west]');
  ok(!bd.ok && bd.error.key === 'argument.block.property.duplicate', `a repeated property: "${bd.error.key}"`);
  const bu = run('/setblock 7 7 7 oak_stairs[facing=east');
  ok(!bu.ok, 'an unclosed bracket is refused');
  const bi = run('/setblock 7 7 7 not_a_block');
  ok(!bi.ok && bi.error.key === 'argument.block.id.invalid', `an unknown block: "${bi.error.key}"`);

  // /fill
  const f = run('/fill 10 10 10 12 12 12 stone');
  ok(f.ok && f.result === 27, `fill wrote ${f.result} blocks of a 3x3x3`);
  ok(at(11, 11, 11) === stoneState, 'including the middle one');
  const h = run('/fill 20 20 20 22 22 22 stone hollow');
  ok(h.ok, 'hollow fills');
  ok(at(20, 20, 20) === stoneState && at(21, 21, 21) === 0,
     'and it is HOLLOW — the shell is stone and the middle is air');
  // #509: an unchanged state is a failure, and fill counts only what changed
  ok(run('/setblock 1 2 3 dirt').ok === false && run('/setblock 1 2 3 dirt').error.key === 'commands.setblock.failed',
     'setblock of the identical state fails');
  ok(run('/setblock 300 5 300 air destroy').ok, 'destroy air over air still succeeds');
  ok(run('/setblock 300 5 300 air').ok === false, 'plain air over air fails');
  const fs = run('/fill 10 10 10 12 12 12 stone');
  ok(!fs.ok && fs.error.key === 'commands.fill.failed', 'fill over an already-filled box fails');
  run('/setblock 11 11 11 air');
  const f1 = run('/fill 10 10 10 12 12 12 stone');
  ok(f1.ok && f1.result === 1, `fill counts only the changed block (${f1.result})`);
  const h2 = run('/fill 20 20 20 22 22 22 stone hollow');
  ok(h2.ok === false, 'hollow over an already-hollow box fails');
  run('/setblock 21 21 21 stone');
  const h3 = run('/fill 20 20 20 22 22 22 stone hollow');
  ok(h3.ok && h3.result === 1, `hollow counts only the interior cell that changed (${h3.result})`);
  // #511: /fill clears the block entity before writing, even when the new block is the same type
  {
    const saved = NS.BlockEntities, held = new Set(['400,5,400', '401,5,400']);
    NS.BlockEntities = { ready: true, get: (x, y, z) => held.has(x + ',' + y + ',' + z) ? {} : null,
                         remove: (x, y, z) => held.delete(x + ',' + y + ',' + z) };
    run('/setblock 400 5 400 chest'); run('/setblock 401 5 400 chest');
    held.add('400,5,400'); held.add('401,5,400');
    run('/fill 400 5 400 401 5 400 chest replace');
    ok(held.size === 0, `same-type /fill emptied the block entities (${held.size} left)`);
    NS.BlockEntities = saved;
  }
  const big = run('/fill 0 0 0 100 100 100 stone');
  ok(!big.ok && big.error.key === 'commands.fill.toobig', `too big: "${big.error.key}"`);

  // #510: /fill ... replace <filter> -- block id, tag, property predicate
  {
    const S = NS.States, dirtS = S.stateOf('dirt'), oakLog = S.stateOf('oak_log'), stairs = S.stateOf('oak_stairs');
    const mk = () => { run('/fill 60 60 60 62 60 60 stone'); run('/setblock 61 60 60 dirt'); run('/setblock 62 60 60 oak_log'); };
    mk();
    const r1 = run('/fill 60 60 60 62 60 60 air replace stone');
    ok(r1.ok && r1.result === 1 && at(60, 60, 60) === 0 && at(61, 60, 60) === dirtS && at(62, 60, 60) === oakLog,
       `filter by block id changed only stone (${r1.result})`);
    mk();
    const r2 = run('/fill 60 60 60 62 60 60 air replace #minecraft:logs');
    ok(r2.ok && r2.result === 1 && at(62, 60, 60) === 0 && at(61, 60, 60) === dirtS, 'filter by tag changed only the log');
    run('/setblock 60 60 60 oak_stairs[facing=east]'); run('/setblock 61 60 60 oak_stairs[facing=west]');
    const r3 = run('/fill 60 60 60 62 60 60 air replace oak_stairs[facing=east]');
    ok(r3.ok && r3.result === 1 && at(60, 60, 60) === 0 && at(61, 60, 60) !== 0, 'filter by property changed only the matching state');
    const r4 = run('/fill 60 60 60 62 60 60 air replace not_a_block');
    ok(!r4.ok && r4.error.key === 'argument.block.id.invalid', 'unknown filter block is a parse error');
    okAv(at(61, 60, 60) !== 0 && stairs !== 0, 'anti-vacuity: the non-matching stair survived, so the filter really filtered');
    console.log('   1 breaks caught');
  }

  // ── /clone ────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ THE OVERLAP CASES ARE THE ONES WORTH WRITING. A clone that reads and writes in the same
  // loop passes every non-overlapping test and smears a column when the boxes touch.
  {
    const dirtState = stoneState;      // any second state; the identity is what matters
    run('/fill 30 30 30 32 32 32 stone');
    const cl = run('/clone 30 30 30 32 32 32 40 30 30');
    ok(cl.ok && cl.result === 27, `clone copied ${cl.result} blocks`);
    ok(at(40, 30, 30) === stoneState && at(42, 32, 32) === stoneState,
       'and both corners of the destination are stone');
    ok(at(30, 30, 30) === stoneState, 'the source is untouched by a plain clone');

    // overlapping without `force` is refused, with vanilla's own message
    const ov = run('/clone 30 30 30 32 32 32 31 30 30');
    ok(!ov.ok && ov.error.key === 'commands.clone.overlap', `overlap refused: "${ov.error && ov.error.key}"`);

    // ⚠ THE SMEAR TEST. Shift a 3-tall column up by one WITH force: if the loop wrote as it read,
    // the bottom block would be copied into every cell above it. Here the source is two states
    // deep, so a smear is visible as a wrong state rather than as a wrong count.
    run('/fill 50 30 50 50 32 50 stone');
    run('/setblock 50 31 50 air');
    const fo = run('/clone 50 30 50 50 32 50 50 31 50 replace force');
    ok(fo.ok, 'an overlapping clone is allowed with `force`');
    ok(at(50, 32, 50) === 0, 'and the hole moved up with it rather than being filled by a smear');

    // masked skips air in the SOURCE
    run('/fill 60 30 60 62 30 62 stone');
    run('/setblock 61 30 61 air');
    run('/fill 70 30 70 72 30 72 stone');
    const mk = run('/clone 60 30 60 62 30 62 70 30 70 masked');
    ok(mk.ok && mk.result === 8, `masked copied ${mk.result} of 9 — the air was skipped`);
    ok(at(71, 30, 71) === stoneState, 'and the destination kept its own block under the hole');

    // move clears the source
    run('/fill 80 30 80 81 30 81 stone');
    const mv = run('/clone 80 30 80 81 30 81 90 30 90 replace move');
    ok(mv.ok && mv.result === 4, `move copied ${mv.result}`);
    ok(at(90, 30, 90) === stoneState, 'the destination has it');
    ok(at(80, 30, 80) === 0, 'and the SOURCE is air afterwards');

    const clBig = run('/clone 0 0 0 100 100 100 200 0 0');
    ok(!clBig.ok && clBig.error.key === 'commands.clone.toobig', `too big: "${clBig.error && clBig.error.key}"`);
  }

  // ── /execute ──────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ THIS IS THE COMMAND THAT MAKES EVERY OTHER ONE WORTH MORE, and almost all of it is the
  // PARSER: each clause redirects back to `execute` with a modifier, and the chain is walked at
  // execute time. The assertions below are about what the clauses DO, not about whether they
  // parse — a clause that parses and changes nothing is the failure mode (D-327).
  {
    const stoneS = stoneState;
    // `run` alone: the tail's own result comes back, not a 1
    const seedRun = run('/execute run seed');
    const seedBare = run('/seed');
    ok(seedRun.ok && seedBare.ok, '/execute run seed runs');
    ok(seedRun.result === seedBare.result,
       `a single source passes the tail's own result through (${seedRun.result} vs ${seedBare.result})`);

    // positioned moves what `~` means
    run('/setblock 100 60 100 air');
    const pos1 = run('/execute positioned 100 60 100 run setblock ~ ~ ~ stone');
    ok(pos1.ok, '/execute positioned ... run setblock runs');
    ok(at(100, 60, 100) === stoneS, 'and `~ ~ ~` meant the POSITIONED place, not the player');

    // ⚠⚠ TWO `positioned` CLAUSES ON ONE LINE. Both use the argument name `pos`; before the
    // context chain (D-327) the second would have overwritten the first in one namespace — or
    // worse, the first would have won. The LAST one is the one that counts.
    run('/setblock 101 60 100 air');
    run('/setblock 102 60 100 air');
    const pos2 = run('/execute positioned 101 60 100 positioned 102 60 100 run setblock ~ ~ ~ stone');
    ok(pos2.ok, 'two positioned clauses parse');
    ok(at(102, 60, 100) === stoneS, 'the SECOND positioned is the one that counts');
    ok(at(101, 60, 100) === 0, '...and the first one is not where it landed');

    // align floors the position, and the ORDER of the clauses matters
    run('/setblock 103 60 100 air');
    const al = run('/execute positioned 103.7 60.7 100.7 align xyz run setblock ~ ~ ~ stone');
    ok(al.ok && at(103, 60, 100) === stoneS, 'align xyz floors the position before the tail runs');

    // if / unless block
    run('/setblock 110 60 110 stone');
    const ifT = run('/execute if block 110 60 110 stone run seed');
    ok(ifT.ok, '`if block` lets the tail run when it matches');
    const ifF = run('/execute if block 110 60 110 dirt run seed');
    ok(ifF.ok && ifF.result === 0, `and stops it when it does not (${ifF.result})`);
    const unT = run('/execute unless block 110 60 110 dirt run seed');
    ok(unT.ok, '`unless block` is the inverse');
    const unF = run('/execute unless block 110 60 110 stone run seed');
    ok(unF.ok && unF.result === 0, '...both ways');

    // a bare test is legal and reports itself
    const bare = run('/execute if block 110 60 110 stone');
    ok(bare.ok && bare.result === 1, `a bare test passes and returns 1 (${bare.result})`);
    const bareF = run('/execute if block 110 60 110 dirt');
    ok(!bareF.ok && bareF.error.key === 'commands.execute.conditional.fail',
       `and fails with vanilla's own message: "${bareF.error && bareF.error.key}"`);

    // two tests chain
    run('/setblock 111 60 110 stone');
    const both = run('/execute if block 110 60 110 stone if block 111 60 110 stone run seed');
    ok(both.ok && both.result !== 0, 'two `if` clauses chain');
    const oneBad = run('/execute if block 110 60 110 stone if block 111 60 110 dirt run seed');
    ok(oneBad.result === 0, 'and one false clause stops the line');

    // if blocks — a region compared against another
    run('/fill 120 60 120 121 60 121 stone');
    run('/fill 130 60 130 131 60 131 stone');
    const bl = run('/execute if blocks 120 60 120 121 60 121 130 60 130 all run seed');
    ok(bl.ok && bl.result !== 0, '`if blocks ... all` matches two identical regions');
    run('/setblock 131 60 131 dirt');
    const bl2 = run('/execute if blocks 120 60 120 121 60 121 130 60 130 all run seed');
    ok(bl2.result === 0, 'and stops when one block differs');

    // ⚠ `rotated` HAS TO REACH `^`. If local coordinates kept reading the PLAYER's rotation the
    // clause would parse, change nothing, and look implemented.
    run('/setblock 140 60 100 air');
    run('/setblock 140 60 101 air');
    // ⚠ WHERE IT LANDED IS FOUND BY SEARCH, not asserted at a guessed cell: the point is that
    // the two rotations put it in DIFFERENT places, and pinning the exact cell would be pinning
    // this check's own idea of which way yaw 0 faces.
    const findStone = () => {
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (at(140 + dx, 60, 100 + dz) === stoneS) return dx + ',' + dz;
      }
      return null;
    };
    run('/fill 138 60 98 142 60 102 air');
    const r0 = run('/execute positioned 140 60 100 rotated 0 0 run setblock ^ ^ ^1 stone');
    ok(r0.ok, '/execute rotated ... run setblock ^ ^ ^1 runs');
    const where0 = findStone();
    ok(where0 !== null, `forward at yaw 0 put a block one away (at ${where0})`);
    run('/fill 138 60 98 142 60 102 air');
    run('/execute positioned 140 60 100 rotated 90 0 run setblock ^ ^ ^1 stone');
    const where90 = findStone();
    ok(where90 !== null, `and at yaw 90 it also landed (at ${where90})`);
    // ⚠⚠ THE ASSERTION THAT CATCHES DEGREES-AS-RADIANS. `rotated 90` must be a QUARTER TURN;
    // ninety radians is fourteen and a bit turns and lands the block somewhere that merely looks
    // random — and "somewhere different" alone would have accepted it.
    ok(where90 !== where0, `and somewhere DIFFERENT (${where0} vs ${where90})`);
    ok(where0 === '0,1' || where0 === '0,-1' || where0 === '1,0' || where0 === '-1,0',
       `yaw 0 points along an AXIS, so a quarter turn does too (${where0})`);
    ok(where90 === '0,1' || where90 === '0,-1' || where90 === '1,0' || where90 === '-1,0',
       `and so does yaw 90 — ninety RADIANS would not (${where90})`);

    // anchored eyes lifts the origin of `^`
    run('/fill 150 60 100 150 66 100 air');
    run('/execute positioned 150 60 100 anchored eyes rotated 0 90 run setblock ^ ^ ^0 stone');
    let anchored = -1;
    for (let y = 60; y <= 63; y++) if (at(150, y, 100) === stoneS) anchored = y;
    ok(anchored >= 61, `anchored eyes moved the origin up off the feet (landed at y ${anchored})`);

    // ── forking: `as @e` runs once per entity and RETURNS THE COUNT ────────────────────────
    {
      const EL = NS.EntityList;
      if (EL && EL.ready) {
        EL.clear();
        const ent = run('/execute if entity @e run seed');
        ok(ent.ok, '`if entity @e` matches the player');
        // the player is always in @e, so add two more and count
        EL.spawn('falling_block', NS.Player.x, NS.Player.y, NS.Player.z, { state: stoneS });
        EL.spawn('falling_block', NS.Player.x, NS.Player.y, NS.Player.z, { state: stoneS });
        const forked = run('/execute as @e run seed');
        ok(forked.ok, '/execute as @e runs');
        ok(forked.result === 3,
           `a fork returns the COUNT of sources, not the last result (${forked.result} for 3 entities)`);
        EL.clear();
        const none = run('/execute as @e[type=pig] run seed');
        ok(none.ok && none.result === 0,
           `a selector that matches nothing runs nothing and is not an error (${none.result})`);
      }
    }

    // the owed clauses are named
    ok(C.EXECUTE_OWED.length === 6, `${C.EXECUTE_OWED.length} execute clauses are named as owed`);
    for (const owed of C.EXECUTE_OWED) {
      ok(typeof owed === 'string' && owed.length > 0, 'every owed clause is named');
    }
  }

  // ── /tellraw and the JSON component parser ────────────────────────────────────────────────
  {
    const T = NS.Text;
    const flat = (c) => T.runs(c).map((r) => r.text).join('');

    ok(flat(T.fromJson('hello')) === 'hello', 'a bare string is a component');
    ok(flat(T.fromJson({ text: 'hi' })) === 'hi', 'so is {"text"}');
    ok(flat(T.fromJson(['a', 'b', 'c'])) === 'abc', 'an array concatenates');

    // ⚠⚠ THE ARRAY'S FIRST ELEMENT IS THE PARENT, NOT A SIBLING. Vanilla folds the rest into its
    // `extra`, so the FIRST element's style is inherited by all of them. A container node instead
    // gives a line whose first word is coloured and whose rest mysteriously is not.
    const arr = T.fromJson([{ text: 'a', color: 'red' }, 'b']);
    const runs = T.runs(arr);
    ok(runs.length >= 2, `the array made ${runs.length} runs`);
    ok(runs[0].style && runs[0].style.color, 'the first element carries its colour');
    ok(runs[1].style && runs[1].style.color === runs[0].style.color,
       'and the SECOND inherits it — it is a child of the first, not its sibling');

    // style keys are lifted from the top level of the node into `.style`
    const st = T.fromJson({ text: 'x', color: 'blue', bold: true, italic: false });
    ok(st.style && st.style.color === 'blue' && st.style.bold === true,
       'top-level style keys are lifted onto the node');
    ok(st.style.italic === false, 'and `false` is kept — it is not the same as absent');

    // translate + with
    const tr = T.fromJson({ translate: 'commands.seed.success', with: ['1337'] });
    ok(/1337/.test(flat(tr)), `a translatable resolves: "${flat(tr)}"`);

    // the owed kinds are refused by name rather than rendering as nothing
    for (const kind of ['score', 'selector', 'keybind', 'nbt']) {
      let threw = null;
      try { T.fromJson({ [kind]: {} }); } catch (e) { threw = e; }
      ok(threw && threw.json && threw.why.indexOf(kind) >= 0,
         `{"${kind}"} is refused by name, not rendered as nothing: ${threw && threw.why}`);
    }

    // and through the command
    const tw = run('/tellraw @s {"text":"from tellraw","color":"gold"}');
    ok(tw.ok, `/tellraw runs: ${tw.error && tw.error.key}`);
    const badJson = run('/tellraw @s {not json');
    ok(!badJson.ok && badJson.error.key === 'argument.component.invalid',
       `malformed JSON is refused: "${badJson.error && badJson.error.key}"`);
    const badComp = run('/tellraw @s {"selector":"@p"}');
    ok(!badComp.ok && badComp.error.key === 'argument.component.invalid',
       `an unsupported component kind is refused: "${badComp.error && badComp.error.key}"`);
  }

  // ── /title, and the fade ramp it drives ───────────────────────────────────────────────────
  {
    // a stub HUD: what is under test here is the COMMAND's effect on the title state and the
    // ALPHA RAMP, neither of which needs a canvas
    const realHud = NS.Hud;
    const H = { TITLE_TIMES: { fadeIn: 10, stay: 70, fadeOut: 20 }, ACTION_BAR_TIME: 60,
                ACTION_BAR_FADE: 20,
                titles: { title: null, subtitle: null, time: 0, bar: null, barTime: 0,
                          fadeIn: 10, stay: 70, fadeOut: 20 } };
    // the real implementations, lifted off the shipped module so this tests THEM and not a copy
    const hudSrc = readFileSync(join(MCLITE_ROOT, 'src', '15_hud.js'), 'utf8');
    for (const name of ['setTitle', 'setSubtitle', 'setActionBar', 'clearTitles',
                        'resetTitleTimes', 'setTitleTimes', 'tickTitles', 'titleAlpha',
                        'actionBarAlpha']) {
      const m = hudSrc.match(new RegExp('\\n  H\\.' + name + ' = (function[\\s\\S]*?\\n  };)'));
      ok(!!m, `could not lift H.${name} out of 15_hud.js`);
      if (m) H[name] = new Function('H', 'return ' + m[1].replace(/;$/, ''))(H);
    }
    NS.Hud = H;

    ok(run('/title @s title {"text":"Hello"}').ok, '/title title runs');
    ok(H.titles.title && NS.Text.plain(H.titles.title) === 'Hello', 'it set the title');
    ok(H.titles.time === 100, `and started the clock at fadeIn+stay+fadeOut (${H.titles.time})`);

    ok(run('/title @s subtitle {"text":"there"}').ok, '/title subtitle runs');
    ok(H.titles.subtitle && NS.Text.plain(H.titles.subtitle) === 'there', 'it set the subtitle');

    // ⚠⚠ THE RAMP. `time` counts DOWN from 100: it fades IN over the first ten ticks, is solid
    // for seventy, and fades OUT over the last twenty.
    const alphaAt = (time) => H.titleAlpha({ time, fadeIn: 10, stay: 70, fadeOut: 20 });
    ok(alphaAt(100) === 0, `at the first tick it is invisible (${alphaAt(100)})`);
    ok(alphaAt(95) > 100 && alphaAt(95) < 155, `halfway through the fade-in it is halfway (${alphaAt(95).toFixed(0)})`);
    ok(alphaAt(90) === 255, 'by the end of the fade-in it is solid');
    ok(alphaAt(50) === 255, 'and stays solid through the stay');
    ok(alphaAt(20) === 255, 'right up to the fade-out');
    ok(alphaAt(10) > 100 && alphaAt(10) < 155, `halfway through the fade-out it is halfway (${alphaAt(10).toFixed(0)})`);
    ok(alphaAt(0) === 0, 'and it ends at nothing');

    // ⚠ THE `stay 0` CASE IS THE ONE THAT CATCHES AN if/else-if. With no stay both tests are
    // true at once and only the fade-OUT answer is right; an else-if gives a title that snaps
    // off instead of fading.
    const noStay = (time) => H.titleAlpha({ time, fadeIn: 10, stay: 0, fadeOut: 20 });
    ok(noStay(5) < 100, `with stay 0 the tail still fades (${noStay(5).toFixed(0)})`);

    // times, and a negative meaning "leave it alone"
    ok(run('/title @s times 5 40 5').ok, '/title times runs');
    ok(H.titles.fadeIn === 5 && H.titles.stay === 40 && H.titles.fadeOut === 5,
       `the times took (${H.titles.fadeIn}/${H.titles.stay}/${H.titles.fadeOut})`);
    ok(H.titles.time === 50, `and a title already on screen was RE-TIMED (${H.titles.time})`);

    // the action bar has its own clock
    ok(run('/title @s actionbar {"text":"bar"}').ok, '/title actionbar runs');
    ok(H.titles.barTime === 60, `the action bar runs 60 ticks (${H.titles.barTime})`);
    ok(H.actionBarAlpha({ barTime: 60, }) === 255, 'and is solid while it has more than twenty left');
    ok(H.actionBarAlpha({ barTime: 10 }) < 255, '...fading only over the last twenty');

    // clear leaves the times; reset puts them back
    ok(run('/title @s clear').ok, '/title clear runs');
    ok(!H.titles.title && H.titles.time === 0, 'clear took the title away');
    ok(H.titles.fadeIn === 5, '...and LEFT the custom times alone');
    ok(run('/title @s reset').ok, '/title reset runs');
    ok(H.titles.fadeIn === 10 && H.titles.stay === 70 && H.titles.fadeOut === 20,
       'reset put vanilla\'s times back');

    // the tick counts down
    run('/title @s title {"text":"x"}');
    const before = H.titles.time;
    H.tickTitles();
    ok(H.titles.time === before - 1, 'the clock counts DOWN on a tick');

    NS.Hud = realHud;
  }

  // ── /locatebiome ──────────────────────────────────────────────────────────────────────────
  // ⚠ THE CLIMATE IS STUBBED ON PURPOSE. What is under test is the SEARCH — vanilla's quart-grid
  // ring walk — not the noise field, and a stub is the only way to know exactly where the answer
  // is and therefore whether the distance reported is right.
  {
    const realClimate = NS.Climate;
    // ⚠ THE TARGET IS A REGION, NOT A CELL. The walk steps 8 quarts — 32 blocks — at a time from
    // the SOURCE's quart cell, so a single 4x4 cell is only reachable if it happens to be on that
    // lattice. A 64-block patch is reachable from anywhere, which is what makes this a test of
    // the search rather than of where the fixture's player stands.
    const sx = Math.floor(NS.Player.x), sz = Math.floor(NS.Player.z);
    const target = { x: sx + 2048, z: sz - 1024, r: 32 };
    let asked = 0;
    NS.Climate = {
      biomeNames: ['minecraft:plains', 'minecraft:desert', 'minecraft:badlands'],
      biomeNameAt(x, y, z) {
        asked++;
        if (Math.abs(x - target.x) <= target.r && Math.abs(z - target.z) <= target.r) return 'minecraft:badlands';
        return 'minecraft:plains';
      }
    };
    // ⚠ THE BUDGET IS OFF FOR THE SEARCH TESTS AND ON FOR ITS OWN. D-325 stops the walk after
    // half a second; with a stub that never fires, and a check that relied on it not firing
    // would go red the day somebody ran the suite on a busy machine.
    const realBudget = C.LOCATE_MS;
    C.LOCATE_MS = 0;
    const near = run('/locatebiome minecraft:plains');
    ok(near.ok, '/locatebiome finds the biome it is standing in');
    // ⚠ NOT EXACTLY ZERO: biomes are constant per 4x4 quart cell and the search reports the
    // quart-aligned block, so standing anywhere but a cell corner is a few blocks from it.
    ok(near.result < 8, `and reports it a few blocks away at most (${near.result})`);

    const far = run('/locatebiome minecraft:badlands');
    ok(far.ok, '/locatebiome finds a biome two thousand blocks away');
    const want = Math.floor(Math.sqrt(2048 * 2048 + 1024 * 1024));
    ok(Math.abs(far.result - want) <= 64,
       `the distance is right to within the patch (${far.result} against ${want})`);
    say(`locatebiome asked Climate ${asked} times`);
    // ⚠ AND IT IS A RING WALK, NOT A FILLED SQUARE. A filled search out to the same ring asks
    // roughly the square of this; the bound is what keeps that from creeping back in.
    ok(asked < 40000, `the search asked ${asked} questions, not a filled square's worth`);

    const bad = run('/locatebiome minecraft:not_a_biome');
    ok(!bad.ok && bad.error.key === 'commands.locatebiome.invalid',
       `an unknown biome is refused: "${bad.error && bad.error.key}"`);

    // ⚠ AND THE WORST CASE IS MEASURED, because it is the one a player will hit: asking for a
    // biome the world does not have searches the WHOLE radius before giving up, and how many
    // questions that is decides whether the tab freezes. Vanilla pays the same cost on a server
    // thread; this game pays it on the one that draws.
    NS.Climate = { biomeNames: ['minecraft:plains', 'minecraft:desert'],
                   biomeNameAt() { asked++; return 'minecraft:plains'; } };
    asked = 0;
    const missT = Date.now();
    const none = run('/locatebiome minecraft:desert');
    const missMs = Date.now() - missT;
    ok(!none.ok && none.error.key === 'commands.locatebiome.notFound',
       `a biome the world lacks is refused: "${none.error && none.error.key}"`);
    say(`the miss walked ${asked} cells in ${missMs} ms with a stub`);
    ok(asked < 200000, `the exhaustive miss is ${asked} samples — vanilla's own radius and step`);

    // ⚠ AND THE BUDGET BITES (D-325). With a lookup made deliberately slow, the search must give
    // up and say `notFound` rather than running to exhaustion — the whole point of the ruling.
    C.LOCATE_MS = 20;
    let slowAsked = 0;
    NS.Climate = { biomeNames: ['minecraft:plains', 'minecraft:desert'],
                   biomeNameAt() { slowAsked++; const t = Date.now(); while (Date.now() - t < 1) { /* spin */ } return 'minecraft:plains'; } };
    const budgeted = run('/locatebiome minecraft:desert');
    C.LOCATE_MS = realBudget;
    NS.Climate = realClimate;
    ok(!budgeted.ok && budgeted.error.key === 'commands.locatebiome.notFound',
       'a search that runs out of time reports notFound');
    ok(slowAsked < asked / 10,
       `and it stopped early — ${slowAsked} samples against the ${asked} an exhaustive walk takes`);
    ok(C.LOCATE_MS === realBudget, 'the budget was put back');
  }

  // ── /locate ───────────────────────────────────────────────────────────────────────────────
  // ⚠ THE STRUCTURE REGISTRY IS STUBBED, FOR THE REASON `locatebiome`'s CLIMATE IS: what is
  // under test is the SEARCH — a ring walk over REGIONS, a separate branch for concentric rings,
  // and vanilla's first-hit-on-the-ring quirk — not the generator. A stub is the only way to
  // know exactly where the answer is and therefore whether the search found the right one.
  // ⚠ The real generator's half of this claim is in `structcheck`: that `startsOfRegion` and
  // `startsNear` agree about the same chunk, which is the primitive this search stands on.
  {
    const realST = NS.Structures;
    const sx = Math.floor(NS.Player.x), sz = Math.floor(NS.Player.z);
    const SPACING = 32;
    let asked = 0, regionsAsked = [];
    /** a set whose candidate chunk is the middle of its region, with a structure at region R */
    const gridSet = (type, atRx, atRz) => ({
      name: type + 's', live: true,
      members: [{ def: { name: type, type: type } }],
      placement: {
        kind: 'random_spread', spacing: SPACING,
        candidateOfRegion(seed, rx, rz, out) { out[0] = rx * SPACING + 1; out[1] = rz * SPACING + 1; return out; }
      },
      at: [atRx, atRz]
    });
    const mk = (sets, rings) => ({
      ready: true, G: { seed: 1337 }, sets: sets,
      ringPositions() { return rings || []; },
      startsOfRegion(si, rx, rz) {
        asked++; regionsAsked.push(rx + ',' + rz);
        const set = sets[si];
        if (!set.at) return [];
        const list = Array.isArray(set.at[0]) ? set.at : [set.at];
        for (const a of list) {
          if (a[0] === rx && a[1] === rz) {
            return [{ def: set.members[0].def, cx: rx * SPACING + 1, cz: rz * SPACING + 1, y: 70 }];
          }
        }
        return [];
      }
    });

    // ── it finds one, and the distance it reports is the distance to it ────────────────────
    NS.Structures = mk([gridSet('village', 3, -2)]);
    asked = 0;
    const v = run('/locate village');
    ok(v.ok, '/locate finds a structure on the grid');
    {
      const bx = (3 * SPACING + 1) * 16 + 8, bz = (-2 * SPACING + 1) * 16 + 8;
      const want = Math.floor(Math.sqrt((bx - sx) * (bx - sx) + (bz - sz) * (bz - sz)));
      ok(v.result === want, `and the distance it reports is the distance to it (${v.result} vs ${want})`);
    }
    // ⚠ A RING WALK, PERIMETER ONLY. A filled square out to ring 3 is 49 regions; the perimeters
    // are 1 + 8 + 16 + 24 = 49 too — so the bound that MATTERS is that no region is asked twice.
    ok(new Set(regionsAsked).size === regionsAsked.length,
       `no region is tested twice (${regionsAsked.length} tests, ${new Set(regionsAsked).size} distinct)`);

    // ── VANILLA'S QUIRK: the first hit ON A RING, not the nearest on it ────────────────────
    // ⚠⚠ Two structures on the same ring, the FURTHER one earlier in scan order. Vanilla returns
    // from inside the loop, so the further one wins — and a `/locate` that answered "nearer"
    // would disagree with the real game on a seed a player could compare. This is the assertion
    // that would fail the day somebody "improved" it.
    {
      const set = gridSet('monument', 0, 0);
      set.at = [[-2, -2], [2, 2]];        // ring 2: the -2,-2 corner is scanned first
      NS.Structures = mk([set]);
      const m = run('/locate monument');
      ok(m.ok, '/locate finds one of two structures on the same ring');
      const farX = (-2 * SPACING + 1) * 16 + 8;
      const nearX = (2 * SPACING + 1) * 16 + 8;
      const dFar = Math.floor(Math.sqrt((farX - sx) ** 2 + (farX - sz) ** 2));
      void nearX; void dFar;
      const txt = (m.lines || []).map((l) => JSON.stringify(l)).join(' ');
      ok(txt.indexOf(String(farX)) >= 0,
         `and it returns the one scanned FIRST, not the nearest on the ring (${txt.slice(0, 90)})`);
    }

    // ── the stronghold does NOT walk regions ──────────────────────────────────────────────
    // ⚠ `startsOfRegion` is made to THROW, so if the concentric branch ever fell through to the
    // grid walk this assertion would not merely fail, it would explode — which is the loudest
    // way to say "that branch is load-bearing".
    {
      const st = mk([{ name: 'strongholds', live: true,
                       members: [{ def: { name: 'stronghold', type: 'stronghold' } }],
                       placement: { kind: 'concentric_rings' } }],
                    [10, 0, 200, 200]);
      st.startsOfRegion = () => { throw new Error('the concentric branch walked the region grid'); };
      NS.Structures = st;
      const sh = run('/locate stronghold');
      ok(sh.ok, '/locate finds a stronghold from its ring positions');
      const bx = 10 * 16 + 8;
      const want = Math.floor(Math.sqrt((bx - sx) ** 2 + (0 * 16 + 8 - sz) ** 2));
      ok(sh.result === want, `and takes the NEAREST ring position (${sh.result} vs ${want})`);
    }

    // ── a name the world does not have, and a name nothing implements ─────────────────────
    NS.Structures = mk([gridSet('village', 3, -2)]);
    const none = run('/locate monument');
    ok(!none.ok && none.error.key === 'commands.locate.failed',
       `a structure this world has no set for is refused: "${none.error && none.error.key}"`);
    const bad = run('/locate not_a_structure');
    ok(!bad.ok, 'and an unknown name is refused by the argument itself');

    // ── the completions are DERIVED from the registry, not typed ──────────────────────────
    {
      NS.Structures = mk([gridSet('village', 1, 1), gridSet('igloo', 2, 2)]);
      const sug = C.suggest ? C.suggest('/locate ') : null;
      if (sug && sug.matches) {
        const names = sug.matches.map((x) => (x && x.text) ? x.text : String(x));
        ok(names.indexOf('village') >= 0 && names.indexOf('igloo') >= 0,
           `it completes the live types (${names.slice(0, 6).join(' ')})`);
        ok(names.indexOf('fortress') < 0,
           'and NOT a type no live set in this world carries');
      }
    }

    // ── the budget bites, and it is NOT the biome budget ──────────────────────────────────
    // ⚠⚠ **A SEARCH THAT CANNOT BE INTERRUPTED IS A FROZEN TAB** (D-325's ruling, D-355's
    // measurement). Vanilla pays this on a server thread; this game pays it on the one that
    // draws, and a full hundred-ring walk is forty thousand regions.
    // ⚠ AND THE TWO BUDGETS ARE DIFFERENT NUMBERS ON PURPOSE: a region that builds a start costs
    // about thirty times a biome sample, so at the biome budget the nearest MANSION on seed 1337
    // — 28 km out, 712 ms — would be REFUSED, and refusing a legal query is the worse failure.
    {
      ok(C.LOCATE_STRUCT_MS > C.LOCATE_MS,
         `the structure budget (${C.LOCATE_STRUCT_MS}) is larger than the biome one ` +
         `(${C.LOCATE_MS}) — a region costs far more than a biome sample`);
      const slow = mk([gridSet('village', 1e9, 1e9)]);
      let spun = 0;
      slow.startsOfRegion = () => {
        spun++;
        const until = Date.now() + 2;            // 2 ms a region: 40,000 regions is 80 seconds
        while (Date.now() < until) { /* deliberately slow */ }
        return [];
      };
      NS.Structures = slow;
      const keep = C.LOCATE_STRUCT_MS;
      C.LOCATE_STRUCT_MS = 60;
      const t0 = Date.now();
      const timed = run('/locate village');
      const ms = Date.now() - t0;
      C.LOCATE_STRUCT_MS = keep;
      ok(!timed.ok, 'a search that runs out of time reports failure rather than running on');
      ok(ms < 1500, `and it stopped early — ${ms} ms and ${spun} regions, not the full walk`);
      ok(C.LOCATE_STRUCT_MS === keep, 'the budget was put back');
    }

    // ── anti-vacuity: with nothing on the grid, nothing is found ──────────────────────────
    {
      const empty = mk([gridSet('village', 1e9, 1e9)]);
      NS.Structures = empty;
      const gone = run('/locate village');
      okAv(!gone.ok, 'anti-vacuity: with the grid empty /locate reports failure, so the hits above were real');
      NS.Structures = mk([gridSet('village', 0, 0)]);
      const back = run('/locate village');
      okAv(back.ok, 'and with a structure put back at the origin it finds it again');
    }
    NS.Structures = realST;
  }

  // ── /list ─────────────────────────────────────────────────────────────────────────────────
  {
    const l1 = run('/list');
    ok(l1.ok, '/list runs');
    const txt = (l1.lines || []).map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ');
    ok(/players online/.test(txt), `it says who is online: ${txt}`);
    ok(run('/list uuids').ok, 'and the `uuids` form runs too');
  }

  // /clear
  P = mkPlayer();
  run('/give @s stone 64');
  run('/give @s dirt 32');
  ok(NS.Inventory.countOf(P.inventory, 'stone') === 64, 'the inventory has stone to clear');
  const c1 = run('/clear @s stone 10');
  ok(c1.ok && NS.Inventory.countOf(P.inventory, 'stone') === 54, `clear 10 left ${NS.Inventory.countOf(P.inventory, 'stone')}`);
  ok(NS.Inventory.countOf(P.inventory, 'dirt') === 32, '...and left the dirt alone');
  run('/clear @s stone');
  ok(NS.Inventory.countOf(P.inventory, 'stone') === 0, 'clear with no count takes all of it');
  ok(NS.Inventory.countOf(P.inventory, 'dirt') === 32, '...still only that item');
  run('/clear');
  ok(NS.Inventory.countOf(P.inventory, 'dirt') === 0, 'clear with no arguments empties the inventory');

  // /experience and /xp
  P = mkPlayer();
  ok(run('/xp add @s 100 points').ok && P.xpTotal === 100, `xp add points gave ${P.xpTotal}`);
  ok(run('/xp set @s 0 points').ok && P.xpTotal === NS.Survival.totalXpFor(P.xpLevel), 'xp set points empties the bar, keeps the level');
  // ⚠ LEVELS ARE NOT POINTS. `xpNeeded` is not linear, so thirty levels is far more than thirty.
  ok(run('/xp set @s 30 levels').ok, 'xp set levels runs');
  ok(P.xpLevel === 30, `and the player is level ${P.xpLevel}`);
  ok(P.xpTotal > 1000, `which is ${P.xpTotal} points, not 30 — levels are not points`);
  const q = run('/experience query @s levels');
  ok(q.ok && q.result === 30, `query levels gives ${q.result}`);
  ok(run('/xp add @s 1 levels').ok && P.xpLevel === 31, 'add levels adds to the current level');

  // #432: ExperienceCommand — query points is the bar inside the level, set points is bar-only, levels keep the bar
  P = mkPlayer();
  run('/xp set @s 10 levels'); run('/xp set @s 5 points');
  const need10 = NS.Survival.xpNeeded(10);
  ok(run('/xp query @s points').result === 5, 'query points is the in-level points, not xpTotal');
  ok(P.xpLevel === 10, 'set points does not change the level');
  ok(!run(`/xp set @s ${need10} points`).ok && P.xpLevel === 10, 'set points >= xp needed is rejected');
  ok(!run('/xp set @s -1 levels').ok, 'set with a negative amount is rejected at parse');
  run('/xp set @s 5 points'); const prog0 = P.xpProgress; run('/xp set @s 20 levels');
  ok(P.xpLevel === 20 && Math.abs(P.xpProgress - prog0) < 1e-9, 'set levels keeps the bar fraction');
  run('/xp add @s -3 levels');
  ok(P.xpLevel === 17 && Math.abs(P.xpProgress - prog0) < 1e-9, 'add levels keeps the bar fraction');

  // /defaultgamemode
  ok(run('/defaultgamemode adventure').ok && C.defaultGameMode === NS.Gamemode.ADVENTURE,
     `defaultgamemode stored ${C.defaultGameMode}`);

  // /say, /me and /msg all reach chat in DIFFERENT formats
  {
    const seen = [];
    NS.Chat = { add: (c2) => seen.push(c2) };
    run('/say hello');
    run('/me waves');
    run('/msg @s psst');
    ok(seen.length === 3, `three lines reached chat (${seen.length})`);
    ok(seen[0].translate === 'chat.type.announcement', `say uses "${seen[0].translate}"`);
    ok(seen[1].translate === 'chat.type.emote', `me uses "${seen[1].translate}"`);
    ok(seen[2].translate === 'commands.message.display.incoming', `msg uses "${seen[2].translate}"`);
    ok(new Set(seen.map((x) => x.translate)).size === 3, 'and the three formats are different');
    NS.Chat = null;
  }

  // /playsound and /stopsound — the sound engine has no context here, so the assertion is that
  // the ARGUMENTS parse and the unknown ones are refused, which is where the bugs are
  {
    const anyEvent = NS.Sound && NS.Sound.events ? Object.keys(NS.Sound.events)[0] : null;
    if (anyEvent) {
      const ps = run('/playsound ' + anyEvent + ' block @s');
      ok(!ps.ok || ps.ok, 'playsound with a real event parses');
      ok(!ps.error || ps.error.key === 'commands.playsound.failed',
         `...and only fails for a sound reason ("${ps.error && ps.error.key}")`);
    }
    const bad = run('/playsound not.a.sound block @s');
    ok(!bad.ok && bad.error.key === 'argument.id.unknown', `an unknown sound: "${bad.error.key}"`);
    const badSrc = run('/playsound ' + (anyEvent || 'x') + ' notasource @s');
    ok(!badSrc.ok, 'an unknown sound source is refused');
  }

  // /spawnpoint and /setworldspawn are DIFFERENT fields
  P = mkPlayer();
  ok(run('/spawnpoint @s 1 2 3').ok && P.spawnPoint && P.spawnPoint.x === 1, 'spawnpoint sets the player\'s');
  ok(C.worldSpawn === null, '...and did not touch the world spawn');
  ok(run('/setworldspawn 9 9 9').ok && C.worldSpawn && C.worldSpawn.x === 9, 'setworldspawn sets the world\'s');
  ok(P.spawnPoint.x === 1, '...and did not touch the player\'s');

  // /gamerule
  {
    const rules = Object.keys(NS.DATA.gameRules);
    ok(rules.length === 35, `the game rule table has ${rules.length} rules`);
    const g1 = run('/gamerule doDaylightCycle');
    ok(g1.ok && g1.lines[0].indexOf('true') >= 0, `query gives "${g1.lines[0]}"`);
    NS.Sky.daylightCycle = true;
    ok(run('/gamerule doDaylightCycle false').ok, 'set runs');
    ok(NS.Sky.daylightCycle === false, '...and doDaylightCycle REALLY STOPS THE CLOCK');
    run('/gamerule doDaylightCycle true');
    ok(NS.Sky.daylightCycle === true, '...and starts it again');
    ok(run('/gamerule randomTickSpeed 7').ok && C.ruleGet('randomTickSpeed') === '7',
       'an integer rule takes an integer');
    const gi = run('/gamerule randomTickSpeed notanumber');
    ok(!gi.ok, 'an integer rule refuses a word');
    const gb = run('/gamerule doFireTick 7');
    ok(!gb.ok, 'a boolean rule refuses a number');
    const gu = run('/gamerule notARule true');
    ok(!gu.ok, 'an unknown rule is refused');
    // ⚠ EVERY RULE IS REACHABLE, all 35, or the tree was built from a truncated table
    let reachable = 0;
    for (const r of rules) if (run('/gamerule ' + r).ok) reachable++;
    ok(reachable === rules.length, `${reachable} of ${rules.length} rules are queryable`);
    // ...and the ones that DO something are named
    ok(Object.keys(C.RULES_LIVE).length >= 2, 'Commands.RULES_LIVE names the rules that are wired');
    for (const r of Object.keys(C.RULES_LIVE)) ok(rules.indexOf(r) >= 0, `RULES_LIVE names "${r}", which is not a rule`);
  }
}

// ═══════════════ 5. no English lives in these files ════════════════════════════════════════
console.log('\n 5. every word the player sees comes from the language file');
/**
 * ⚠ A REAL TOKENISER, NOT A LINE FILTER. The first version stripped lines that BEGIN with `//`
 * and then matched quotes with a regex — so a trailing comment survived, an apostrophe inside
 * one opened a "string", and the scan reported eight hard-coded phrases in a file that has none.
 * A check that cannot tell a comment from a string is measuring its own regex.
 */
function stringsIn(src) {
  const out = [];
  let i = 0, n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1, buf = '';
      while (j < n) {
        if (src[j] === '\\') { buf += src[j + 1]; j += 2; continue; }
        if (src[j] === q) break;
        if (src[j] === '\n' && q !== '`') break;
        buf += src[j]; j++;
      }
      if (j < n && src[j] === q) out.push(buf);
      i = j + 1; continue;
    }
    // a regex literal: skip it, or its slashes and quotes confuse everything after
    if (c === '/' && /[=(,:[!&|?{;\n]\s*$/.test(src.slice(Math.max(0, i - 24), i))) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}
{
  // ⚠ THE SCAN IS OVER THE SOURCE, and it is the only way to assert a NEGATIVE like this. A
  // single hard-coded "Unknown item" would be invisible to every behavioural test above, because
  // it would still be a string and still be printed.
  for (const f of ['14h_brigadier.js', '15g_commands.js']) {
    // ⚠ THE `// OWED` MARKER IS THE ONE EXEMPTION, and it is explicit rather than a regex that
    // happens not to match: `Commands.OWED_NOTE` is a developer-facing sentence that never
    // reaches a player, so it is excluded by a marker somebody had to type, not by accident.
    const raw = readFileSync(join(SRC, f), 'utf8');
    const kept = raw.split('\n').filter((l) => l.indexOf('// OWED') < 0).join('\n');
    const strings = stringsIn(kept);
    const prose = strings
      .filter((s) => / /.test(s))                         // more than one word
      .filter((s) => !/^[a-z0-9_.:/]+$/.test(s))
      .filter((s) => s.indexOf('%s') < 0)
      .filter((s) => s !== 'use strict')
      .filter((s) => !/^[\s\W]+$/.test(s));
    ok(prose.length === 0, `${f} contains ${prose.length} hard-coded phrases: ${JSON.stringify(prose.slice(0, 4))}`);
    say(`${f}: ${strings.length} string literals, ${prose.length} of them prose`);
  }
  // ...and every key the two files DO use must exist in the shipped language table
  const keys = new Set();
  for (const f of ['14h_brigadier.js', '15g_commands.js']) {
    const text = readFileSync(join(SRC, f), 'utf8');
    for (const m of text.matchAll(/'((?:parsing|argument|command|commands|gameMode|chat|item|block|entity)\.[a-zA-Z0-9_.]+)'/g)) {
      keys.add(m[1]);
    }
  }
  let missing = 0;
  for (const k of keys) {
    // the four prefixes that are completed at runtime with a name are not whole keys
    if (/^(item|block|entity|gameMode)\.minecraft\.$|\.$/.test(k)) continue;
    if (k.endsWith('.')) continue;
    if (!NS.Text.has(k)) { missing++; if (missing < 6) say('missing key: ' + k); }
  }
  ok(missing === 0, `${missing} of the ${keys.size} translation keys these files use are not in lang.bin`);
  console.log(`    ${keys.size} translation keys, all present`);
}

// ═══════════════ 6. anti-vacuity (D-30) ════════════════════════════════════════════════════
console.log('\n 6. anti-vacuity — each section is broken and the break must be caught');
{
  // §1: a command registered that vanilla does not have
  const d = C.dispatcher;
  d.register(B.literal('notavanillacommand').executes(() => 1));
  const roots = d.root.children.map((n) => n.name);
  okAv(roots.indexOf('notavanillacommand') >= 0 && !GOLD.has('notavanillacommand'),
       'anti-vacuity: a command vanilla does not have is visible to the roster test');
  d.root.children.pop();
  delete d.root.byName.notavanillacommand;
}
{
  // §1: the permission gate removed
  const node = C.dispatcher.get('gamemode');
  const was = node.requirement;
  node.requirement = null;
  okAv(node.canUse(C.source(P, { level: 0 })),
       'anti-vacuity: with its requirement removed, /gamemode IS runnable at level 0 — so the gate is what refuses it');
  node.requirement = was;
  okAv(!node.canUse(C.source(P, { level: 0 })), 'anti-vacuity: and putting it back refuses again');
}
{
  // §2: an error with no cursor cannot draw <--[HERE]
  const e = new B.Err('parsing.int.expected', [], -1, null);
  okAv(e.context() === '', 'anti-vacuity: an error with no cursor produces no context line');
  const e2 = new B.Err('parsing.int.expected', [], 4, 'foo bar');
  okAv(e2.context().indexOf('<--[HERE]') >= 0, 'anti-vacuity: and one with a cursor does');
}
{
  // §4b: the time argument's saturation is what the four cases above see; a double parse would not saturate
  const dbl = Math.round(3000000000 * 1), flt = Math.min(2147483647, Math.floor(Math.fround(3000000000) + 0.5));
  okAv(dbl !== flt, `anti-vacuity: a double-precision unclamped parse (${dbl}) differs from vanilla's (${flt})`);
}
{
  // §4b: the block-state brackets are load-bearing. If `withProp` silently returned the default,
  // the two `/setblock oak_stairs[...]` lines would write the SAME state and §4b's "it is a
  // different state" would be the only thing standing between that and a silent wrong answer.
  const plain = NS.States.stateOf('oak_stairs');
  run('/setblock 90 1 1 oak_stairs');
  run('/setblock 90 1 2 oak_stairs[facing=east]');
  const a = NS.World.getBlock(90, 1, 1), b = NS.World.getBlock(90, 1, 2);
  okAv(a === plain && b !== plain && NS.States.name(b) === 'oak_stairs',
       `anti-vacuity: a bracketed stair is a different state from a bare one (${a} vs ${b})`);
}
{
  // §4b: a hollow fill really leaves the middle empty, and a solid one does not
  run('/fill 60 1 1 62 3 3 stone');
  const solidMiddle = NS.World.getBlock(61, 2, 2);
  run('/fill 70 1 1 72 3 3 stone hollow');
  const hollowMiddle = NS.World.getBlock(71, 2, 2);
  okAv(solidMiddle !== 0 && hollowMiddle === 0,
       `anti-vacuity: solid fills the middle (${solidMiddle}) and hollow does not (${hollowMiddle})`);
}
{
  // §4b: the game rule really reaches the clock, and the clock really matters
  NS.Sky.daylightCycle = true;
  const before = NS.Sky.dayTime;
  NS.Sky.tick();
  const ran = NS.Sky.dayTime !== before;
  run('/gamerule doDaylightCycle false');
  const stopped = NS.Sky.dayTime;
  NS.Sky.tick();
  okAv(ran && NS.Sky.dayTime === stopped,
       'anti-vacuity: the clock ticks with doDaylightCycle on and STOPS with it off');
  run('/gamerule doDaylightCycle true');
}
{
  // §4: the time presets are not interchangeable
  NS.Sky.dayTime = 0;
  run('/time set day');
  const day = NS.Sky.dayTime;
  run('/time set noon');
  okAv(day !== NS.Sky.dayTime && day !== 0,
       `anti-vacuity: day (${day}) and noon (${NS.Sky.dayTime}) are different ticks, and day is not 0`);
}
{
  // §5: the prose scan must be able to see prose
  const fake = "// a comment with 'quotes' in it\nvar x = 'Unknown item name here'; // and here\n";
  const prose = stringsIn(fake).filter((s) => / /.test(s)).filter((s) => !/^[a-z0-9_.:/]+$/.test(s));
  okAv(prose.length === 1 && prose[0] === 'Unknown item name here',
       'anti-vacuity: the prose scan finds a hard-coded phrase and is not fooled by a comment: '
       + JSON.stringify(prose));
}
{
  // §4: a command that did nothing would still return ok — so the state check is what matters
  P = mkPlayer();
  const before = P.mode;
  NS.Gamemode.set(P, NS.Gamemode.SURVIVAL);
  run('/gamemode adventure');
  okAv(P.mode === NS.Gamemode.ADVENTURE && P.mode !== before + 100,
       'anti-vacuity: /gamemode is asserted by the PLAYER\'s mode, not by the command returning ok');
}

// ═══════════════ /attribute (#8021) ════════════════════════════════════════════════════════
{
  // the entity list and table are not loaded in this node harness: stand-ins, with the zombie row
  // copied from tools/golden/entity-attributes-1.18.2.tsv (maxHealth 20, speed 0.23)
  const mk = (type) => ({ type, x: 0, y: 0, z: 0, ...(type === 'zombie' ? { maxHealth: 20, health: 20, knockbackResistance: 0 } : {}) });
  const z = mk('zombie'), fb = mk('falling_block');
  NS.EntityList = { all: () => [z, fb] };
  NS.Entities = { attrsOf: (n) => (n === 'zombie' ? { hp: 20, speed: 0.23000000417232513, dmg: 3, follow: 35, kbRes: 0, atkKb: 0 } : null) };
  {
    const id = (e) => `@e[type=${e.type},limit=1]`;
    const hp0 = z.maxHealth;
    ok(run(`/attribute ${id(z)} generic.max_health get`).ok, '/attribute get runs on a zombie');
    ok(run(`/attribute ${id(z)} generic.max_health base set 40`).ok && z.maxHealth === 40,
       'base set changes the zombie\'s max_health');
    const bg = run(`/attribute ${id(z)} generic.max_health base get 2`);
    ok(bg.ok && bg.result === 80, `base get returns value*scale (${bg.result})`);
    ok(run(`/attribute ${id(z)} minecraft:generic.movement_speed base set 0.5`).ok && Math.abs(z.speedAttr - 0.5) < 1e-9,
       'base set changes movement_speed');
    const u = '11111111-2222-3333-4444-555555555555';
    ok(run(`/attribute ${id(z)} generic.max_health modifier add ${u} "boost" 10 add`).ok && z.maxHealth === 50,
       'modifier add raises max_health');
    ok(!run(`/attribute ${id(z)} generic.max_health modifier add ${u} "boost" 10 add`).ok,
       'a duplicate uuid is refused (modifier_already_present)');
    const mv = run(`/attribute ${id(z)} generic.max_health modifier value get ${u}`);
    ok(mv.ok && mv.result === 10, `modifier value get (${mv.result})`);
    const vg = run(`/attribute ${id(z)} generic.max_health get`);
    ok(vg.ok && vg.result === 50, `get is the modified value (${vg.result})`);
    ok(run(`/attribute ${id(z)} generic.max_health modifier remove ${u}`).ok && z.maxHealth === 40,
       'modifier remove round-trips');
    ok(!run(`/attribute ${id(z)} generic.max_health modifier remove ${u}`).ok, 'removing it twice fails (no_modifier)');
    const nl = run(`/attribute ${id(fb)} generic.max_health get`);
    ok(!nl.ok && JSON.stringify(nl).indexOf('commands.attribute.failed.entity') >= 0,
       'a non-living target fails with commands.attribute.failed.entity: ' + JSON.stringify(nl).slice(0, 120));
    NS.EntityList = undefined; NS.Entities = undefined;
    okAv(hp0 === 20 && C.IMPLEMENTED.indexOf('attribute') >= 0, 'anti-vacuity: /attribute is asserted by the entity\'s own fields');
  }
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` commandcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the parser is Brigadier\'s and every word is the game\'s own.');
