#!/usr/bin/env node
// extract-gamerules.mjs — PLAN G12c. THE 35 GAME RULES, OUT OF `GameRules.<clinit>`.
//
//   node tools/extract-gamerules.mjs [--if-missing]  -> tools/golden/gamerules-1.18.2.tsv
//
// ⚠⚠ **THIS FILE IS A REWRITE, AND WHY IT HAD TO BE REWRITTEN IS THE POINT (D-360).** `suite.mjs`
// has listed `extract-gamerules` since G12c, `gen-data` refuses to build without its output and
// `commandcheck` reads the same table — and **the extractor was in neither the repository nor
// the working tree**. It was written in a cloud container, its output was written beside it, and
// neither was ever committed or copied back, so the project on Dan's own disk **could not be
// built at all**: `gen-data` died on `ENOENT: gamerules-1.18.2.tsv` at the first attempt.
//
// That is the cost of NEXT.md's "THE COMMIT IS OWED" line, made concrete. A tool that exists
// only in a container that has been reclaimed does not exist.
//
// ── HOW THE CLASS IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ──────────────────
// Game-rule ids are not obfuscated — they are the strings the `/gamerule` command matches on —
// so the class is found as the ONE class in 6,352 whose constant pool holds `doFireTick`,
// `keepInventory` AND `randomTickSpeed` together. Any one of them could appear in a command
// class or a language file; the three together are the rule table itself, and uniqueness is
// asserted rather than assumed.
//
// ── HOW A ROW IS READ ────────────────────────────────────────────────────────────────────────
// `<clinit>` is a flat sequence of registrations, each one:
//
//     ldc "<id>"                       the rule's name
//     getstatic  Category.<x>          which section of the /gamerule menu it is in
//     <the default, as a constant>     iconst_0/1 for a boolean, bipush/sipush/ldc for an int
//     invokestatic <Type>.create(...)  (Z)L...;  for boolean, (I)L...;  for integer
//     invokestatic register(...)
//
// ⚠ **THE TYPE COMES FROM THE `create` DESCRIPTOR, NOT FROM THE SHAPE OF THE DEFAULT.** `iconst_1`
// is a perfectly good `int` as well as a `true`, so reading the type off the constant would call
// every `1`-defaulted integer rule a boolean — and `randomTickSpeed`'s default of 3 would be the
// only one that looked different. The descriptor is unambiguous and is what is read.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tools', 'golden', 'gamerules-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (c) say('   ok ' + m); else { failures++; say('   x  ' + m); } return c; };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' gamerules-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const jar = requireJar('1.18.2');
const tmp = mkdtempSync(join(tmpdir(), 'mclite-gr-'));
execFileSync('unzip', ['-oq', jar, '*.class', '-d', tmp], { stdio: 'ignore' });
const classes = readdirSync(tmp).filter((f) => f.endsWith('.class'));

// ── 1. the class, by three rule ids at once ─────────────────────────────────────────────────
const MARKERS = ['doFireTick', 'keepInventory', 'randomTickSpeed'];
const hits = classes.filter((f) => {
  const s = readFileSync(join(tmp, f)).toString('latin1');
  return MARKERS.every((m) => s.includes(m));
});
ok(hits.length === 1, `exactly one class holds ${MARKERS.join(', ')} together (${hits.join(',') || 'none'})`);
if (hits.length !== 1) process.exit(1);
const CLS = hits[0];
say(` GameRules = ${CLS}`);

// ── 2. its <clinit>, read as a sequence ─────────────────────────────────────────────────────
const dump = execFileSync('javap', ['-p', '-c', join(tmp, CLS)],
  { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const at = dump.indexOf('static {};');
ok(at > 0, 'the class has a <clinit>');
const body = dump.slice(at).split('\n');

const rows = [];
let pendingName = null, pendingConst = null;
for (const line of body) {
  let m = /ldc(?:_w)?\s+#\d+\s+\/\/ String (.+?)\s*$/.exec(line);
  if (m) { pendingName = m[1]; pendingConst = null; continue; }
  m = /\b(iconst_(\d)|bipush|sipush)\b(?:\s+(-?\d+))?/.exec(line);
  if (m) {
    pendingConst = m[2] !== undefined ? parseInt(m[2], 10) : parseInt(m[3], 10);
    continue;
  }
  m = /ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+)/.exec(line);
  if (m) { pendingConst = parseInt(m[1], 10); continue; }
  // ⚠ THE TYPE IS THE FACTORY'S **FIRST** ARGUMENT, AND TWO RULES TAKE A SECOND ONE. The first
  // version of this regex demanded `(Z)L` — exactly one parameter — and silently lost
  // `doImmediateRespawn` and `reducedDebugInfo`, which are registered through the
  // `create(boolean, BiConsumer)` overload that fires a callback when the rule changes. **33 of
  // 35, with no error**, and `commandcheck` was the only thing that noticed because it happens
  // to own the count. §3's registration-count assertion now closes that hole here.
  m = /invokestatic\s+#\d+\s+\/\/ Method .*\.\w+:\((Z|I)[^)]*\)L/.exec(line);
  if (m && pendingName !== null && pendingConst !== null) {
    const type = m[1] === 'Z' ? 'boolean' : 'integer';
    const def = type === 'boolean' ? (pendingConst ? 'true' : 'false') : String(pendingConst);
    rows.push({ name: pendingName, type: type, def: def });
    pendingName = null; pendingConst = null;
  }
}

// ── 3. the anchors: rules whose value cannot be in doubt ────────────────────────────────────
// ⚠ EACH ONE IS A CASE A WRONG READING WOULD GET WRONG. `randomTickSpeed` is the only common
// integer whose default is neither 0 nor 1, so a type read off the constant misses exactly it;
// `keepInventory` is the one famous FALSE among a run of trues, so an off-by-one in the walk
// shows up as `keepInventory true`, which is a rule people would notice in play and not in a
// table.
const byName = new Map(rows.map((r) => [r.name, r]));
const anchor = (n, t, d) => ok(byName.has(n) && byName.get(n).type === t && byName.get(n).def === d,
  `${n} is ${t} = ${d}` + (byName.has(n) ? ` (read ${byName.get(n).type} = ${byName.get(n).def})` : ' — MISSING'));
anchor('doFireTick', 'boolean', 'true');
anchor('keepInventory', 'boolean', 'false');
anchor('mobGriefing', 'boolean', 'true');
anchor('randomTickSpeed', 'integer', '3');
anchor('maxEntityCramming', 'integer', '24');
anchor('playersSleepingPercentage', 'integer', '100');
// ⚠⚠ **THE COUNT IS ASSERTED AGAINST THE REGISTRATIONS, NOT AGAINST A REMEMBERED NUMBER.** Every
// rule is one `register(String, Category, Type)` call, so counting those calls is the same
// question asked from the other side — and it is what a missed factory overload fails on.
const registrations = body.filter((l) => /invokestatic\s+#\d+\s+\/\/ Method a:\(Ljava\/lang\/String;/.test(l)).length;
ok(rows.length === registrations,
   `${rows.length} rules read, and the class registers ${registrations} — every registration produced a row`);
ok(rows.length >= 30 && rows.length <= 45, `${rows.length} rules, which is 1.18.2's count`);
ok(new Set(rows.map((r) => r.name)).size === rows.length, 'every rule id is distinct');
ok(rows.filter((r) => r.type === 'integer').length >= 4,
   `${rows.filter((r) => r.type === 'integer').length} of them are integers — a table that is all booleans was read from the constant, not the descriptor`);

mkdirSync(join(ROOT, 'tools', 'golden'), { recursive: true });
const out = ['# GENERATED by tools/extract-gamerules.mjs from the 1.18.2 jar. Do not hand-edit.',
             '# name\ttype\tdefault']
  .concat(rows.sort((a, b) => a.name.localeCompare(b.name)).map((r) => `${r.name}\t${r.type}\t${r.def}`))
  .join('\n') + '\n';
writeFileSync(OUT, out);

say('');
say('=========== extract-gamerules ============');
say(` class .............. ${CLS}`);
say(` rules .............. ${rows.length}  (${rows.filter((r) => r.type === 'integer').length} integer)`);
say(` written ............ ${OUT.replace(ROOT, '')}`);
say(` failures ........... ${failures}`);
say('==========================================');
process.exit(failures ? 1 : 0);
