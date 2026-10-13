#!/usr/bin/env node
// extract-entities.mjs — the ENTITY TYPE table, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-entities.mjs [--if-missing]  -> tools/golden/entity-types-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. G17's substrate cannot be written without the entity dimensions, and they
// are compiled Java from end to end: there is no JSON file for them, nothing in the data pack,
// nothing in `minecraft-data` that is not itself scraped from somebody's memory of the wiki. A
// zombie is 0.6 x 1.95 and a spider is 1.4 x 0.9 and an ender dragon is 16 x 8, and getting one
// wrong is a mob that walks through a doorway it should not fit through.
//
// ⚠ THE REFEREE'S RULES (D-263), because this is the TENTH table and every one of the previous
// nine corrected something this project believed:
//   - read the OBFUSCATED jar and trust no name;
//   - find a class by what USES it, never by what it looks like;
//   - anchor every derived fact on cases that cannot be in doubt;
//   - assert in BOTH directions — the thing is there, and the things that must not be are not;
//   - refuse to guess. A `|| default` that swallows an unresolved row is how a plausible wrong
//     table gets written (extract-push's own §2 bug, which hid 584 of them).
//
// WHAT IT READS
//   `EntityType.<clinit>` is one long chain of
//       register("zombie", Builder.of(Zombie::new, MobCategory.MONSTER)
//                                 .sized(0.6F, 1.95F).clientTrackingRange(8))
//   so the whole table is in one method body. The name is `register`'s FIRST argument, so it is
//   pushed BEFORE the builder chain is evaluated — which makes each `ldc String` the start of a
//   segment and the following `putstatic` its end.
//
// HOW EACH BUILDER METHOD IS IDENTIFIED — none of them by name:
//   `sized`          the only (FF)LBuilder; method. Its two floats are the last two pushed.
//   `clientTrackingRange` / `updateInterval`
//                    the two (I)LBuilder; methods. They are told apart STRUCTURALLY, not from
//                    memory: one is called by nearly every entity and the other by a minority,
//                    and the minority one NEVER appears without the common one before it in the
//                    same chain. Both facts are asserted; if they do not hold, this file stops.
//   `fireImmune`     one of several ()LBuilder; methods. It is the one whose caller set contains
//                    blaze and ghast and does NOT contain zombie or cow — a signature no other
//                    builder flag in the game has, and it is asserted rather than assumed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' entity-types-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-ent-'));
execFileSync('unzip', ['-qo', JAR, '*.class', '-d', work]);
const classes = readdirSync(work).filter((f) => f.endsWith('.class'));
say(` ${classes.length} classes`);
const javap = (list) => execFileSync('javap', ['-p', '-c', '-constants', ...list],
  { cwd: work, maxBuffer: 1 << 30, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).toString();

// ── 1. find EntityType BY USE ───────────────────────────────────────────────────────────────
// ⚠ NOT "the class called EntityType" — there are no names in this jar. It is the class whose
// constant pool carries entity ID strings that belong to nothing else. `leash_knot` and
// `ender_dragon` and `zombified_piglin` appear in the registry and in the language file, and
// the language file is not a class; a class holding all three is the registry.
const NEEDLES = ['ender_dragon', 'leash_knot', 'zombified_piglin'];
const candidates = classes.filter((f) => {
  const b = readFileSync(join(work, f));
  return NEEDLES.every((n) => b.includes(n));
});
say(` ${candidates.length} classes carry all of ${NEEDLES.join(', ')}`);
if (!ok(candidates.length >= 1, 'no class carries the entity id strings — the jar is not 1.18.2')) process.exit(1);

// Of those, EntityType is the one whose <clinit> also PUTSTATIC s the most fields of its own
// type: the registry holds one static field per entity.
let ET = null, etDump = null, best = -1;
for (const f of candidates) {
  const name = f.replace(/\.class$/, '');
  let d;
  try { d = javap([f]); } catch { continue; }
  const self = (d.match(new RegExp('putstatic\\s+#\\d+\\s+// Field [A-Za-z0-9$_]+:L'
    + name.replace(/\$/g, '\\$') + ';', 'g')) || []).length;
  if (self > best) { best = self; ET = name; etDump = d; }
}
ok(!!ET && best > 80, `EntityType is ${ET}, with ${best} static fields of its own type`);
if (failures) { say(' refusing to guess'); process.exit(1); }

// ── 2. the Builder class, BY USE: the second argument of the register method ─────────────────
// `register(String, Builder)` is the static method <clinit> calls once per entity, and it is the
// only static method in this class taking (String, X) and returning this class.
// ⚠ JAVAP OMITS THE CLASS PREFIX WHEN THE METHOD IS ON THE CLASS BEING DISASSEMBLED. The call
// prints as `// Method a:(Ljava/lang/String;Laxo$a;)Laxo;` with no `axo.` in front of it, so a
// pattern that demands the prefix matches nothing and this file's first run found zero register
// calls in a method that makes 113 of them. The prefix is optional here and mandatory for the
// Builder's methods below, which ARE on another class.
const regRe = new RegExp('invokestatic\\s+#\\d+\\s+// Method (?:' + ET.replace(/\$/g, '\\$')
  + '\\.)?([A-Za-z0-9$_]+):\\(Ljava/lang/String;L([A-Za-z0-9$_]+);\\)L' + ET.replace(/\$/g, '\\$') + ';', 'g');
const regHits = [...etDump.matchAll(regRe)];
ok(regHits.length > 80, `${regHits.length} calls to a (String, X) -> EntityType static — the register method`);
const REGISTER = regHits.length ? regHits[0][1] : null;
const B = regHits.length ? regHits[0][2] : null;
ok(!!B, `the Builder class is ${B}, found as register's second argument`);
if (failures) { say(' refusing to guess'); process.exit(1); }

// ── 3. the builder's method shapes ──────────────────────────────────────────────────────────
const bDump = javap([B + '.class']);
const shape = new Map();                                   // method -> descriptor
for (const l of bDump.split('\n')) {
  const m = l.match(/^\s{2}(?:public |protected |private |static |final |synchronized )*[A-Za-z0-9$_.<>[\]]+\s+([A-Za-z0-9$_]+)\(([^)]*)\);\s*$/);
  if (m) shape.set(m[1], m[2]);
}
// ⚠⚠ A BUILDER METHOD IS ITS NAME **AND** ITS DESCRIPTOR, NEVER ITS NAME. Obfuscation renames
// every overload to the same letter: on this builder, `a` is `of`, `sized`, `immuneTo` AND
// `clientTrackingRange` — four different methods, one letter. Keying by name alone made
// `calls.find(c => c.m === 'a')` return `immuneTo` for every entity that is immune to a block,
// so polar_bear, wither, wither_skeleton and snow_golem all came out with NO DIMENSIONS while
// every other entity looked fine. Four wrong rows out of 120 is exactly the size of mistake
// that gets shipped. The key below is `name + descriptor`.
const sig = (m, d) => m + ':' + d;
const byDesc = (desc) => [...new Set([...etDump.matchAll(new RegExp('invokevirtual\\s+#\\d+\\s+// Method '
  + B.replace(/\$/g, '\\$') + '\\.([A-Za-z0-9$_]+):' + desc.replace(/[()[\]$]/g, '\\$&')
  + 'L' + B.replace(/\$/g, '\\$') + ';', 'g'))].map((m) => sig(m[1], desc)))];

const sizedSet = byDesc('(FF)');
ok(sizedSet.length === 1, `exactly one (float,float) builder method — sized (${sizedSet.join(',')})`);
const SIZED_M = sizedSet[0];

const intMethods = byDesc('(I)');
ok(intMethods.length === 2, `${intMethods.length} (int) builder methods, expected 2 (tracking range and update interval)`);
const flagMethods = byDesc('()');
ok(flagMethods.length >= 3, `${flagMethods.length} no-argument builder flags`);
if (failures) { say(' refusing to guess'); process.exit(1); }

// ── 3b. entity id -> IMPLEMENTATION CLASS, through the lambda bootstrap table ────────────────
// ⚠ THIS IS THE MOST USEFUL COLUMN IN THE FILE AND IT IS FREE. Every registration passes its
// constructor as a method reference — `Builder.of(Zombie::new, MobCategory.MONSTER)` — which
// compiles to an `invokedynamic` whose bootstrap entry carries
// `REF_newInvokeSpecial <TheClass>."<init>"`. So the obfuscated class behind every entity id is
// written down in the jar, and G17b and G17c can find `ItemEntity` or `FallingBlockEntity` BY
// USE instead of guessing at a letter — which is the whole referee rule (D-263) applied to
// classes rather than to constants.
//
// ⚠ `javap -c` does NOT print this attribute; `javap -v` does. That is the only reason for a
// second disassembly of the same class.
const vDump = execFileSync('javap', ['-p', '-v', ET + '.class'],
  { cwd: work, maxBuffer: 1 << 30, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).toString();
const bsmClass = new Map();                                // bootstrap index -> impl class
{
  const bs = vDump.slice(vDump.indexOf('BootstrapMethods:'));
  let idx = null;
  for (const l of bs.split('\n')) {
    let m = l.match(/^\s{2}(\d+):\s+#\d+\s+REF_/);
    if (m) { idx = Number(m[1]); continue; }
    m = l.match(/REF_newInvokeSpecial\s+([A-Za-z0-9$_]+)\."<init>"/);
    if (m && idx !== null) bsmClass.set(idx, m[1]);
  }
}
ok(bsmClass.size > 80, `${bsmClass.size} constructor references in the bootstrap table`);

// ── 4. walk <clinit> and cut it into one segment per entity ─────────────────────────────────
const lines = etDump.split('\n');
let inClinit = false;
const segs = [];
let cur = null;
const pushFloat = (v) => { if (cur) cur.floats.push(v); };
const pushInt = (v) => { if (cur) cur.ints.push(v); };
for (const l of lines) {
  if (/^\s{2}static \{\};\s*$/.test(l)) { inClinit = true; continue; }
  // a new member declaration at two-space indent ends the method body; the body's own lines
  // are indented further and `}` is at column 0
  if (inClinit && /^ {2}\S.*\(.*\);\s*$/.test(l)) break;
  if (!inClinit) continue;
  let m = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z_]+)$/);
  if (m) { cur = { name: m[1], floats: [], ints: [], calls: [] }; segs.push(cur); continue; }
  if (!cur) continue;
  if ((m = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ float ([-0-9.E]+)f/))) { pushFloat(Number(m[1])); continue; }
  if (/fconst_0/.test(l)) { pushFloat(0); continue; }
  if (/fconst_1/.test(l)) { pushFloat(1); continue; }
  if (/fconst_2/.test(l)) { pushFloat(2); continue; }
  if ((m = l.match(/(?:bipush|sipush)\s+(-?\d+)/))) { pushInt(Number(m[1])); continue; }
  if ((m = l.match(/iconst_(\d)/))) { pushInt(Number(m[1])); continue; }
  if ((m = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+)/))) { pushInt(Number(m[1])); continue; }
  if ((m = l.match(new RegExp('invokevirtual\\s+#\\d+\\s+\\/\\/ Method ' + B.replace(/\$/g, '\\$')
      + '\\.([A-Za-z0-9$_]+):(\\([^)]*\\))L')))) {
    cur.calls.push({ m: m[1] + ':' + m[2], floatsAt: cur.floats.length, intsAt: cur.ints.length });
    continue;
  }
  if ((m = l.match(/invokedynamic\s+#\d+,\s+0\s+\/\/ InvokeDynamic #(\d+):/))) {
    if (cur.bsm === undefined) cur.bsm = Number(m[1]);
    continue;
  }
  if (new RegExp('invokestatic\\s+#\\d+\\s+\\/\\/ Method (?:' + ET.replace(/\$/g, '\\$') + '\\.)?'
      + REGISTER + ':\\(Ljava/lang/String;').test(l)) { cur.registered = true; continue; }
}
const rows = segs.filter((s) => s.registered);
ok(rows.length > 80, `${rows.length} registered entity types parsed out of <clinit>`);

// ── 5. tell the two (int) methods apart, structurally ───────────────────────────────────────
const callers = (mname) => new Set(rows.filter((r) => r.calls.some((c) => c.m === mname)).map((r) => r.name));
const [i0, i1] = intMethods;
const c0 = callers(i0), c1 = callers(i1);
const common = c0.size >= c1.size ? i0 : i1;
const rare = common === i0 ? i1 : i0;
const cCommon = common === i0 ? c0 : c1, cRare = common === i0 ? c1 : c0;
ok(cCommon.size > rows.length * 0.8,
   `clientTrackingRange is ${common}, called by ${cCommon.size} of ${rows.length} entities`);
ok(cRare.size < rows.length * 0.5,
   `updateInterval is ${rare}, called by ${cRare.size} of ${rows.length} entities`);
// ⚠ AND THE ORDER, ASSERTED: vanilla writes .clientTrackingRange(n).updateInterval(m), so the
// rare one never appears in a chain without the common one BEFORE it. That is what makes "the
// first (int) call is the tracking range" safe to rely on when both are present.
let orderBad = 0;
for (const r of rows) {
  const ci = r.calls.findIndex((c) => c.m === common);
  const ri = r.calls.findIndex((c) => c.m === rare);
  if (ri >= 0 && !(ci >= 0 && ci < ri)) orderBad++;
}
ok(orderBad === 0, `${orderBad} entities call the update interval without a tracking range before it`);

// ── 6. tell the flags apart by the SET of entities that call each ───────────────────────────
const FIRE_YES = ['blaze', 'ghast'];
const FIRE_NO = ['zombie', 'cow'];
let FIRE_M = null;
for (const f of flagMethods) {
  const s = callers(f);
  if (FIRE_YES.every((n) => s.has(n)) && FIRE_NO.every((n) => !s.has(n))) FIRE_M = f;
}
ok(!!FIRE_M, `fireImmune is ${FIRE_M}, the only flag blaze and ghast set and zombie and cow do not`);
const fireSet = FIRE_M ? callers(FIRE_M) : new Set();

// ── 7. the table ────────────────────────────────────────────────────────────────────────────
const out = [];
for (const r of rows) {
  const sz = r.calls.find((c) => c.m === SIZED_M);
  if (!sz) { say('   x ' + r.name + ' has no sized() call'); failures++; continue; }
  const w = r.floats[sz.floatsAt - 2], h = r.floats[sz.floatsAt - 1];
  // ⚠ ZERO IS A SIZE. `marker` and `lightning_bolt` really are `sized(0.0F, 0.0F)` — a marker is
  // a positional entity with no body and a lightning bolt is an effect — so a `w > 0` guard
  // rejects two correct rows and calls the parse broken. The guard is that the two floats were
  // THERE, which is a fact about the parse, not about the game.
  if (!(sz.floatsAt >= 2 && Number.isFinite(w) && Number.isFinite(h))) {
    say('   x ' + r.name + ' has no dimensions'); failures++; continue;
  }
  const ci = r.calls.find((c) => c.m === common);
  const ri = r.calls.find((c) => c.m === rare);
  out.push([r.name, w, h, fireSet.has(r.name) ? 1 : 0,
            ci ? r.ints[ci.intsAt - 1] : '', ri ? r.ints[ri.intsAt - 1] : '',
            (r.bsm !== undefined && bsmClass.get(r.bsm)) || '']);
}
const byName = new Map(out.map((r) => [r[0], r]));

// ── 7b. THE SET IS CLOSED, against a source this file did not produce ───────────────────────
// ⚠ A COUNT THIS FILE CHECKS AGAINST ITSELF PROVES NOTHING. `.mcdata/1.18.2/_registries.json`
// is the game's own registry dump, fetched by `tools/fetch-vanilla-data.mjs` and never touched
// by anything here, so it is an independent list of exactly which entity types exist. Both
// directions are asserted: nothing in the registry is missing from this table, and nothing in
// this table is absent from the registry. A parse that silently dropped four rows — which an
// earlier version of this file did — cannot survive that.
{
  const regFile = join(ROOT, '.mcdata', '1.18.2', '_registries.json');
  if (existsSync(regFile)) {
    const reg = JSON.parse(readFileSync(regFile, 'utf8'))['entity_type'] || [];
    ok(reg.length > 80, `the registry dump lists ${reg.length} entity types`);
    const missing = reg.filter((n) => !byName.has(n));
    const extra = out.map((r) => r[0]).filter((n) => reg.indexOf(n) < 0);
    ok(missing.length === 0, `${missing.length} registry entity types are missing from the table: ${missing.slice(0, 8).join(' ')}`);
    ok(extra.length === 0, `${extra.length} table rows are not entity types at all: ${extra.slice(0, 8).join(' ')}`);
    say(` set closed against the registry dump: ${reg.length} types, 0 missing, 0 extra`);
  } else {
    say(' ⓘ no .mcdata registry dump — the SET is unchecked. Run tools/fetch-vanilla-data.mjs.');
  }
}

// ── 8. anchors that cannot be in doubt ──────────────────────────────────────────────────────
// ⚠ THESE ARE NOT A SAMPLE, THEY ARE THE PROOF. Each is a number a player can measure in-game
// by walking a mob into a one-block gap, and they span the range so that a systematic error —
// swapped width and height, a factor, the wrong pair of floats off the stack — cannot pass.
const ANCHOR = [
  ['zombie', 0.6, 1.95], ['creeper', 0.6, 1.7], ['spider', 1.4, 0.9],
  ['enderman', 0.6, 2.9], ['ghast', 4, 4], ['ender_dragon', 16, 8],
  ['item', 0.25, 0.25], ['tnt', 0.98, 0.98], ['arrow', 0.5, 0.5],
];
for (const [n, w, h] of ANCHOR) {
  const r = byName.get(n);
  if (!ok(!!r, `the table has ${n}`)) continue;
  ok(Math.abs(r[1] - w) < 1e-4 && Math.abs(r[2] - h) < 1e-4,
     `${n} is ${w} x ${h}, got ${r[1]} x ${r[2]}`);
}
// ⚠ AND THE OTHER DIRECTION. A table that got every anchor right by reading the same wrong
// float twice would still have a spider taller than it is wide.
ok(byName.get('spider') && byName.get('spider')[1] > byName.get('spider')[2],
   'a spider is WIDER than it is tall — the two floats are not the same one read twice');
ok(byName.get('blaze') && byName.get('blaze')[3] === 1, 'a blaze is fire-immune');
// ⚠ THE CLASS COLUMN IS CHECKED THE ONLY WAY IT CAN BE WITHOUT NAMES: distinctness. 113 entity
// types must not share a handful of classes, and the four that legitimately have NO constructor
// reference are the ones whose builder is `createNothing` — they are named, not tolerated.
{
  const withClass = out.filter((r) => r[6]);
  const distinct = new Set(withClass.map((r) => r[6]));
  ok(withClass.length > 100, `${withClass.length} of ${out.length} types resolved to a class`);
  ok(distinct.size > withClass.length * 0.9,
     `${distinct.size} distinct classes for ${withClass.length} types — the mapping is not one-to-one`);
  const none = out.filter((r) => !r[6]).map((r) => r[0]).sort();
  say(' types with no constructor reference: ' + (none.join(' ') || 'none'));
}
ok(byName.get('zombie') && byName.get('zombie')[3] === 0, 'a zombie is NOT fire-immune');
ok(fireSet.size >= 5 && fireSet.size <= 20, `${fireSet.size} fire-immune types — a plausible count`);
// ⚠ AND THE SET OF BODILESS ENTITIES IS CLOSED, not waved through. Exactly two types are
// `sized(0, 0)`; a third would mean the parse dropped a pair of floats somewhere.
const zero = out.filter((r) => r[1] === 0 && r[2] === 0).map((r) => r[0]).sort();
ok(zero.length === 2 && zero.join(',') === 'lightning_bolt,marker',
   `the only zero-sized types are lightning_bolt and marker, got ${zero.join(',') || 'none'}`);

if (failures) { say(` ${failures} assertion(s) failed — refusing to write a table it cannot vouch for`); process.exit(1); }

out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
const head = [
  '# entity-types-1.18.2.tsv — generated by tools/extract-entities.mjs from the 1.18.2 jar.',
  '# name\twidth\theight\tfireImmune\tclientTrackingRange\tupdateInterval\tclass',
  '# EntityType=' + ET + ' Builder=' + B + ' register=' + REGISTER,
  '# sized=' + SIZED_M + ' clientTrackingRange=' + common + ' updateInterval=' + rare + ' fireImmune=' + FIRE_M,
].join('\n');
writeFileSync(OUT, head + '\n' + out.map((r) => r.join('\t')).join('\n') + '\n');
say('');
say('=============== extract-entities ==============');
say(` entity types ...... ${out.length}`);
say(` fire-immune ....... ${fireSet.size}  (${[...fireSet].sort().join(' ')})`);
say(` tracking ranges ... ${[...new Set(out.map((r) => r[4]).filter((v) => v !== ''))].sort((a,b)=>a-b).join(' ')}`);
say(` update intervals .. ${[...new Set(out.map((r) => r[5]).filter((v) => v !== ''))].sort((a,b)=>a-b).join(' ')}`);
say(` -> ${OUT}`);
say('==============================================');
