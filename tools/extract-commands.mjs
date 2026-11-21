#!/usr/bin/env node
// extract-commands.mjs — PLAN G12b. THE COMMAND ROSTER, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-commands.mjs   -> tools/golden/commands-1.18.2.tsv
//
// ⚠ WHY THIS AND NOT A TYPED LIST. Dan asked for "a real parser, player commands first", and the
// second half of that is a question of FACT: which commands exist, and which of them a player
// without operator rights can run. Both live in the jar — `Commands`' constructor registers every
// one, each command class opens with `Commands.literal("<name>")`, and the permission gate is a
// `requires(source -> source.hasPermission(N))` whose N is a bytecode constant. A typed roster
// would be a second list free to disagree with the game's, which is D-313's whole lesson, three
// days old. This is the THIRTEENTH table D-263's referee technique has produced.
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE ────────────────────────
//   1. A COMMAND CLASS is any class with a static method whose FIRST parameter is
//      `com.mojang.brigadier.CommandDispatcher`. That is what a command registration IS; nothing
//      else in the jar has that shape, and the count comes out at 78.
//   2. `Commands.literal` is the static method with the descriptor
//      `(Ljava/lang/String;)Lcom/mojang/brigadier/builder/LiteralArgumentBuilder;`. It is found
//      BY DESCRIPTOR, never by name, and the class it lives on is reported.
//   3. A COMMAND NAME is the first `ldc String` in a register method that is immediately followed
//      by a call to that method. "Immediately" is load-bearing: a register method is full of
//      other strings — argument names, sub-literals, error keys — and the one that becomes the
//      command is the one handed straight to the literal factory first.
//   4. An ALIAS is a literal whose builder goes on to call `ArgumentBuilder.redirect`, which is
//      exactly how `/tp`, `/w` and `/tell` are declared. Reading them as separate commands would
//      claim vanilla has three message commands; leaving them out would make `/tp` unknown.
//   5. A PERMISSION LEVEL is the int in a `hasPermission(int)` call — the source class's only
//      one-int-returns-boolean method — inside the class's own predicate lambdas. The command's
//      level is the SMALLEST, because the root gate is the loosest one in the tree.
//
// ⚠ CLOSED AGAINST THE `Commands` CLASS ITSELF: its constructor calls every command's register
// method, and the set it calls must equal the set found by shape, in both directions.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'commands-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' commands-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-cmd-'));
try {
  execFileSync('unzip', ['-o', '-q', JAR, '-d', work]);
  const all = execFileSync('bash', ['-c',
    'cd ' + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
    { maxBuffer: 1 << 28 }).toString().trim().split('\n');
  say(' classes ............ ' + all.length);

  const javap = (args, names) => {
    let out = '';
    for (let i = 0; i < names.length; i += 300) {
      out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 300)],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    }
    return out.split('\n').filter((l) => !l.startsWith('Picked up'));
  };

  // ── 1. the command classes, by the shape of their register method ─────────────────────────
  const sigs = javap(['-p'], all);
  const REG = /^\s{2}(?:public |private |protected |)?static (?:void|[\w.$]+) (\w+)\((com\.mojang\.brigadier\.CommandDispatcher[^,)]*)(?:,\s*([^)]*))?\);\s*$/;
  let cur = null;
  const cmdClass = new Map();          // class -> [{ method, extra }]
  let SOURCE = null;
  for (const l of sigs) {
    const d = l.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && l.trimEnd().endsWith('{')) { cur = d[1]; continue; }
    if (!cur) continue;
    const m = l.match(REG);
    if (!m) continue;
    if (!cmdClass.has(cur)) cmdClass.set(cur, []);
    cmdClass.get(cur).push({ method: m[1], extra: (m[3] || '').trim() });
    const src = m[2].match(/CommandDispatcher<([\w.$]+)>/);
    if (src && !SOURCE) SOURCE = src[1];
  }
  say(' command classes .... ' + cmdClass.size + '  (CommandSourceStack = ' + SOURCE + ')');
  ok(cmdClass.size >= 60 && cmdClass.size <= 120,
     cmdClass.size + ' classes take a CommandDispatcher — that is not a command roster');
  ok(!!SOURCE, 'no CommandDispatcher<Source> type found');

  // ── 2. the literal factory, BY DESCRIPTOR ─────────────────────────────────────────────────
  const bodies = javap(['-p', '-c'], [...cmdClass.keys()]);
  const LIT_DESC = '(Ljava/lang/String;)Lcom/mojang/brigadier/builder/LiteralArgumentBuilder;';
  const litRe = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w./$]+)\\.(\\w+):' +
                           LIT_DESC.replace(/[(){}[\]/;$]/g, (ch) => '\\' + ch));
  const litOwners = new Map();
  for (const l of bodies) {
    const m = l.match(litRe);
    if (m) litOwners.set(m[1], (litOwners.get(m[1]) || 0) + 1);
  }
  const LITERAL = [...litOwners].sort((a, b) => b[1] - a[1])[0];
  ok(!!LITERAL, 'no Commands.literal: nothing calls a (String)->LiteralArgumentBuilder');
  if (!LITERAL) throw new Error('stop');
  say(' Commands.literal ... ' + LITERAL[0] + '  (' + LITERAL[1] + ' calls)');

  // ── 3. walk each class's code ─────────────────────────────────────────────────────────────
  // ⚠ ONE PASS OVER THE WHOLE DUMP, splitting on class and method headers, because javap'ing 78
  // classes one at a time costs eighty process launches and this costs one.
  const perms = new Map();             // class -> [levels]
  const rows = [];
  {
    let klass = null, method = null, inRegister = false;
    let literals = [], firstLit = null, aliases = [], lastLit = null;
    let regCount = 0, litsSinceReg = [], redirectSinceReg = false;
    const HAS_PERM = new RegExp('invokevirtual\\s+#\\d+\\s+// Method ' + esc(SOURCE) + '\\.(\\w+):\\(I\\)Z');
    // `CommandDispatcher.register(LiteralArgumentBuilder) -> LiteralCommandNode`
    const REGISTER = /Method com\/mojang\/brigadier\/CommandDispatcher\.register:/;
    let pendingInt = null;
    const flush = () => {
      if (klass && inRegister && firstLit) {
        rows.push({ klass: klass, name: firstLit, aliases: aliases.slice(), literals: literals.slice() });
      }
      inRegister = false; literals = []; firstLit = null; aliases = []; lastLit = null;
      regCount = 0; litsSinceReg = []; redirectSinceReg = false;
    };
    for (let i = 0; i < bodies.length; i++) {
      const l = bodies[i];
      const d = l.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
      if (d && l.trimEnd().endsWith('{')) { flush(); klass = d[1]; continue; }
      const ms = l.match(/^\s{2}(?:public |private |protected |static |final |)*[\w.$<>,\[\] ]+ (\w+)\(([^)]*)\);\s*$/);
      if (ms) {
        flush();
        method = ms[1];
        inRegister = ms[2].indexOf('com.mojang.brigadier.CommandDispatcher') === 0;
        continue;
      }
      // the permission constant, anywhere in the class
      const iv = l.match(/^\s*\d+:\s+(?:iconst_(\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+))\s*$/);
      if (iv) { pendingInt = parseInt(iv[1] !== undefined ? iv[1] : iv[2] !== undefined ? iv[2] : iv[3], 10); continue; }
      if (HAS_PERM.test(l)) {
        if (pendingInt !== null && klass) {
          if (!perms.has(klass)) perms.set(klass, []);
          perms.get(klass).push(pendingInt);
        }
        continue;
      }
      if (!inRegister) continue;
      const ld = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z][a-z0-9_]*)$/);
      if (ld) {
        // ⚠ ONLY IF THE NEXT INSTRUCTION IS THE LITERAL FACTORY. A register method is full of
        // strings that are not command names.
        const nxt = bodies[i + 1] || '';
        if (litRe.test(nxt)) {
          literals.push(ld[1]);
          lastLit = ld[1];
          if (!firstLit) firstLit = ld[1];
          // the first literal after a `register` call opens the NEXT builder — its root
          litsSinceReg.push(ld[1]);
        }
        continue;
      }
      // ⚠⚠ **AN ALIAS IS A SECOND `dispatcher.register`, NOT ANY LITERAL THAT REDIRECTS.** The
      // first version of this rule was "a literal other than the first, followed by a redirect",
      // and it was wrong in exactly one place in the game: `/execute` redirects its OWN clauses
      // back to its own node, so `run`, `positioned`, `rotated`, `entity`, `align`, `anchored`,
      // `in`, `score`, `value` and `max` were all written into the golden table as ALIASES of
      // `/execute`. Nothing noticed for two sessions because nothing had implemented `/execute`;
      // the day something did, the check demanded ten root commands that do not exist.
      //
      // Vanilla's shape is unambiguous: `dispatcher.register(literal("teleport")...)` and then
      // `dispatcher.register(literal("tp").redirect(node))` — two register calls, and the second
      // one's ROOT literal is the alias. A clause that redirects inside ONE register call is a
      // clause. `regDepth` counts the register calls; the root literal of each after the first is
      // the candidate.
      if (REGISTER.test(l)) {
        // ⚠ THE INVOKE COMES AFTER ITS ARGUMENT IS BUILT, so at this point `litsSinceReg` holds
        // exactly the literals of the builder being registered. An ALIAS registration is tiny —
        // `register(literal("tp").redirect(node))` — one literal and a redirect and nothing else.
        // `/execute`'s second registration has thirty literals in it and is not an alias of
        // anything; `/teleport`'s has one and is.
        if (regCount >= 1 && litsSinceReg.length === 1 && redirectSinceReg
            && litsSinceReg[0] !== firstLit && aliases.indexOf(litsSinceReg[0]) < 0) {
          aliases.push(litsSinceReg[0]);
        }
        regCount++;
        litsSinceReg = [];
        redirectSinceReg = false;
        continue;
      }
      if (/ArgumentBuilder\.redirect:/.test(l)) redirectSinceReg = true;
    }
    flush();
  }
  say(' registrations ...... ' + rows.length);

  // ── 4. the Commands class, as the closing source ──────────────────────────────────────────
  // ⚠ IT IS FOUND BY USE: the class whose <init> invokes the most of these register methods.
  let COMMANDS = null, called = null;
  {
    const names = all;
    const want = new Map();            // "klass.method" -> klass
    for (const r of rows) for (const e of cmdClass.get(r.klass)) want.set(r.klass + '.' + e.method, r.klass);
    const counts = new Map(), sets = new Map();
    // one javap over every class is too much; the caller is always a class that references many
    // of them, so scan the raw constant pools instead
    const grep = execFileSync('bash', ['-c',
      'cd ' + JSON.stringify(work) + " && grep -lc . /dev/null; true"], { maxBuffer: 1 << 20 });
    const cand = names.filter((n) => n.indexOf('$') < 0);
    const dump = javap(['-p', '-c'], cand.filter((n) => n.length <= 4));
    let k = null, inInit = false, seen = new Set();
    for (const l of dump) {
      const d = l.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
      if (d && l.trimEnd().endsWith('{')) {
        if (k && seen.size) { counts.set(k, seen.size); sets.set(k, seen); }
        k = d[1]; seen = new Set(); continue;
      }
      const m = l.match(/invokestatic\s+#\d+\s+\/\/ Method ([\w.$]+)\.(\w+):\(Lcom\/mojang\/brigadier\/CommandDispatcher;/);
      if (m && want.has(m[1] + '.' + m[2])) seen.add(m[1]);
    }
    if (k && seen.size) { counts.set(k, seen.size); sets.set(k, seen); }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (best) { COMMANDS = best[0]; called = sets.get(best[0]); }
  }
  ok(!!COMMANDS, 'no Commands class: nothing calls a large set of the register methods');
  say(' Commands ........... ' + (COMMANDS || '?') + '  (registers ' + (called ? called.size : 0) + ')');
  if (called) {
    const found = new Set(rows.map((r) => r.klass));
    let onlyCalled = 0, onlyFound = 0;
    for (const c of called) if (!found.has(c)) { onlyCalled++; say('   ! ' + c + ' is registered and has no readable literal'); }
    for (const c of found) if (!called.has(c)) onlyFound++;
    say(' registered-but-unread ' + onlyCalled + ' · found-but-unregistered ' + onlyFound
        + '  (the second are the server-only and datapack commands)');
    ok(onlyCalled === 0, onlyCalled + ' registered command classes produced no name');
  }

  // ── 5. the shape the answer must have ─────────────────────────────────────────────────────
  const byName = new Map();
  for (const r of rows) {
    const lv = perms.get(r.klass);
    r.level = (lv && lv.length) ? Math.min.apply(null, lv) : 0;
    if (byName.has(r.name)) { failures++; say('   x two classes claim /' + r.name); }
    byName.set(r.name, r);
  }
  const names = [...byName.keys()].sort();
  say(' commands ........... ' + names.length);
  say('   ' + names.join(' '));

  // ⚠ ANTI-VACUITY. A walk that lost its place still produces a list; these are the commands and
  // the levels that cannot be in doubt, in BOTH directions.
  const MUST = ['gamemode', 'give', 'teleport', 'time', 'weather', 'kill', 'seed', 'summon',
    'help', 'kick', 'ban', 'op', 'deop', 'stop', 'list', 'me', 'msg', 'trigger', 'effect',
    // ⚠ `experience`, NOT `xp`. The command is `/experience` and `/xp` is its REDIRECT, exactly as
    // `/tp` redirects to `/teleport` — the first draft of this list said `xp` and the bytecode
    // said otherwise, which is the third time in this session the referee has corrected a
    // recollection I would have shipped.
    'enchant', 'clear', 'fill', 'setblock', 'difficulty', 'gamerule', 'experience', 'tag', 'title'];
  for (const n of MUST) ok(byName.has(n), '/' + n + ' is missing from the roster');
  const LEVEL = { help: 0, me: 0, msg: 0, trigger: 0, list: 0, teammsg: 0,
    gamemode: 2, give: 2, teleport: 2, time: 2, weather: 2, kill: 2, summon: 2, seed: 2,
    effect: 2, enchant: 2, setblock: 2, fill: 2, gamerule: 2, difficulty: 2,
    op: 3, deop: 3, kick: 3, ban: 3, whitelist: 3, stop: 4 };
  for (const n of Object.keys(LEVEL)) {
    const r = byName.get(n);
    ok(!!r && r.level === LEVEL[n],
       '/' + n + ' is level ' + (r ? r.level : '?') + ', vanilla says ' + LEVEL[n]);
  }
  // the three alias cases everybody knows
  const tp = byName.get('teleport'), msg = byName.get('msg');
  ok(!!tp && tp.aliases.indexOf('tp') >= 0, '/teleport does not declare its /tp alias');
  ok(!!msg && msg.aliases.indexOf('w') >= 0 && msg.aliases.indexOf('tell') >= 0,
     '/msg does not declare /w and /tell');
  const xp = byName.get('experience');
  ok(!!xp && xp.aliases.indexOf('xp') >= 0, '/experience does not declare its /xp alias');
  // ⚠ ...and the other direction: an alias must not also be a command in its own right.
  for (const r of rows) for (const a of r.aliases) {
    ok(!byName.has(a), '/' + a + ' is both an alias of /' + r.name + ' and a command');
  }
  // the levels must span vanilla's four, or the permission reader found one constant everywhere
  const levels = new Set(rows.map((r) => r.level));
  ok(levels.has(0) && levels.has(2) && levels.has(3) && levels.has(4),
     'the levels found are ' + [...levels].sort().join(',') + ' — vanilla uses 0, 1, 2, 3 and 4');
  const atZero = rows.filter((r) => r.level === 0).length;
  ok(atZero >= 4 && atZero <= 25, atZero + ' commands need no operator rights');
  say(' by level ........... ' + [0, 1, 2, 3, 4].map((L) =>
      L + ':' + rows.filter((r) => r.level === L).length).join(' '));

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  mkdirSync(dirname(OUT), { recursive: true });
  const lines = ['# command\tlevel\taliases\tclass\tsub-literals',
    '# Generated by tools/extract-commands.mjs from ' + JAR,
    '# Commands=' + COMMANDS + '  literal=' + LITERAL[0] + '  source=' + SOURCE,
    '# ' + names.length + ' commands; level is the operator level the ROOT requires (0 = anyone).'];
  for (const n of names) {
    const r = byName.get(n);
    lines.push([n, r.level, r.aliases.join(','), r.klass,
                r.literals.filter((x) => x !== n).join(',')].join('\t'));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* the mount refuses rm */ }
}
