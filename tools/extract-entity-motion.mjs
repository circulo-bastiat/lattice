#!/usr/bin/env node
// extract-entity-motion.mjs — per-entity GRAVITY, out of the 1.18.2 bytecode.
//
//   node tools/extract-entity-motion.mjs [--if-missing]  -> tools/golden/entity-motion-1.18.2.tsv
//
// ⚠ WHY THIS IS A SECOND FILE. `extract-entities.mjs` reads ONE method — `EntityType.<clinit>` —
// and everything in it is in one place. Gravity is not: each entity applies it in its own class,
// in its own `tick`, as a literal. What makes this tractable at all is the CLASS COLUMN that
// file produces (D-306): every entity's constructor reference is in the lambda bootstrap table,
// so the obfuscated class behind `item` or `falling_block` is known rather than guessed.
//
// ⚠ THE PATTERN IS THE WHOLE STATEMENT, NOT THE ARITHMETIC IN THE MIDDLE OF IT. Vanilla writes
//     setDeltaMovement(getDeltaMovement().add(0.0D, -0.04D, 0.0D));
// which compiles to
//     invokevirtual <this>.<get>:()LVec3;        <- getDeltaMovement
//     dconst_0
//     ldc2_w  // double -0.04d
//     dconst_0
//     invokevirtual Vec3.<add>:(DDD)LVec3;
//     invokevirtual <this>.<set>:(LVec3;)V       <- setDeltaMovement
//
// ⚠⚠ AND THE FIRST VERSION OF THIS FILE MATCHED ONLY THE MIDDLE THREE LINES — a negative double
// between two `dconst_0`s before a `(DDD)` call — WHICH PASSED EVERY ANCHOR AND WAS WRONG FOR
// HALF ITS ROWS. `add(0, -y, 0)` is how you offset a POSITION too, so it read a boat's gravity
// as 0.7, an ender dragon's as 2, and gave a shulker bullet one at all. item, falling_block,
// tnt and experience_orb were all correct, so all four anchors were green. **A table that gets
// every anchor right can still be wrong everywhere else**; what fixed it was not a better anchor
// but a narrower PATTERN — the Vec3 must be READ from a no-argument getter and WRITTEN BACK
// through a one-argument void setter, which a position offset never is.
//
// ⚠ WHAT IS DELIBERATELY **NOT** HERE, AND IS OWED RATHER THAN GUESSED:
//   - **Vertical drag.** It appears in TWO shapes — `scale(0.98)` for the entities that damp all
//     three axes together, and `multiply(f, 0.98, f)` for the ones whose horizontal damping is a
//     variable — and telling the second one's middle argument from its third means tracking three
//     argument slots through the push order. Every case seen so far is 0.98, which is exactly why
//     it must not be assumed: a table that agrees with a constant everywhere it was checked is
//     how the old `accelFor` fit survived (D-250).
//   - **Projectiles.** `arrow` and `snowball` carry no literal at all: they inherit their tick
//     from a superclass, so the pattern is in a class this file was not pointed at. Walking the
//     hierarchy is G17c's, and the entities that need it are LISTED below rather than dropped.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const OUT = join(ROOT, 'tools', 'golden', 'entity-motion-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' entity-motion-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
if (!existsSync(TYPES)) { say(' SKIP — run extract-entities first.'); process.exit(0); }
const JAR = requireJar('1.18.2');
// ⚠ `javap` IS NOT ALWAYS ON PATH EVEN WHERE `java` IS (D-236/D-509): some JREs ship without
// it, and even a full JDK's shim directory can hold only `java.exe`. It is always reachable as
// a JDK module, though — `java -m jdk.jdeps/com.sun.tools.javap.Main` — so that is tried second,
// and only a machine with NEITHER is skipped, rather than the first miss being taken as final.
let JAVAP_VIA_MODULE = false;
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch {
  try { execFileSync('java', ['-m', 'jdk.jdeps/com.sun.tools.javap.Main', '-version'], { stdio: 'ignore' }); JAVAP_VIA_MODULE = true; }
  catch { say('SKIP - no javap on this machine (checked PATH and the jdk.jdeps module). Install a JDK, or keep the committed TSV.'); process.exit(0); }
}
const runJavap = (args, cwd) => {
  const opts = { cwd, maxBuffer: 1 << 30, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } };
  return JAVAP_VIA_MODULE
    ? execFileSync('java', ['-m', 'jdk.jdeps/com.sun.tools.javap.Main', ...args], opts)
    : execFileSync('javap', args, opts);
};

const classOf = new Map();
for (const l of readFileSync(TYPES, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const c = l.split('\t');
  if (c[6]) classOf.set(c[0], c[6]);
}
ok(classOf.size > 100, `${classOf.size} entity types carry an implementation class`);
if (failures) { say(' refusing to guess'); process.exit(1); }

const work = mkdtempSync(join(tmpdir(), 'mclite-motion-'));
const wanted = [...new Set(classOf.values())].map((c) => c + '.class');
execFileSync('unzip', ['-qo', JAR, ...wanted, '-d', work]);
const javap = (list) => runJavap(['-p', '-c', '-constants', ...list], work).toString();

/**
 * The UNIFORM drag in one disassembly, or null.
 *
 * ⚠ ONLY THE UNAMBIGUOUS SHAPE IS READ. Vanilla damps an entity's motion in two ways:
 *     setDeltaMovement(getDeltaMovement().scale(0.98));            <- all three axes, one constant
 *     setDeltaMovement(getDeltaMovement().multiply(f, 0.98D, f));  <- horizontal is a VARIABLE
 * The first is read here. The second is NOT, because telling its middle argument from its third
 * means simulating the operand stack backwards through `f2d`/`fload` pairs, and every value seen
 * in that position so far is 0.98 — which is exactly the reason not to assume it. An entity
 * whose damping is in the second shape gets an EMPTY drag cell and is named in the header as
 * owed, so the engine can refuse to simulate it rather than simulate it wrongly (D-307).
 */
function dragIn(dump) {
  const lines = dump.split('\n');
  const found = new Set();
  for (let i = 1; i < lines.length - 2; i++) {
    const m = lines[i].match(/ldc2_w\s+#\d+\s+\/\/ double ([\d.E-]+)d/);
    if (!m) continue;
    const c = (lines[i + 1] || '').match(
      /invokevirtual\s+#\d+\s+\/\/ Method ([A-Za-z0-9$_]+)\.[A-Za-z0-9$_]+:\(D\)L([A-Za-z0-9$_]+);/);
    if (!c || c[1] !== c[2]) continue;                  // Vec3.scale(D) -> Vec3
    const V = c[1];
    const set = (lines[i + 2] || '').match(
      new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(L' + V + ';\\)V'));
    if (!set) continue;
    let get = false;
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(\\)L' + V + ';').test(lines[j])) { get = true; break; }
    }
    if (!get) continue;
    found.add(Number(m[1]));
  }
  if (found.size !== 1) return null;                    // none, or more than one: refuse
  return [...found][0];
}

/**
 * Every method a class DECLARES, as `name(descriptor)`. javap prints each member's signature
 * above its code, which is the only handle on method identity this file has — and it is enough,
 * for the one question that matters below (D-309).
 */
function signaturesOf(dump) {
  const out = new Set();
  for (const l of dump.split('\n')) {
    const m = l.match(/^\s{2}(?:public |protected |private |static |final |abstract |synchronized |native |transient |volatile )*([A-Za-z0-9$_.<>[\]]+)\s+([A-Za-z0-9$_<>]+)\(([^)]*)\);\s*$/);
    if (m) out.add(m[2] + '(' + m[3] + ')');
  }
  return out;
}

/** The signature of the method a given line of a disassembly belongs to. */
function methodAt(lines, i) {
  for (let j = i; j >= 0; j--) {
    const m = lines[j].match(/^\s{2}(?:public |protected |private |static |final |abstract |synchronized |native |transient |volatile )*([A-Za-z0-9$_.<>[\]]+)\s+([A-Za-z0-9$_<>]+)\(([^)]*)\);\s*$/);
    if (m) return m[2] + '(' + m[3] + ')';
  }
  return null;
}

/** an instruction line reduced to its mnemonic and its symbolic operand, offsets discarded */
function insn(l) {
  const m = l.match(/^\s*\d+:\s+(\S+)(.*)$/);
  if (!m) return null;
  const comment = (m[2].match(/\/\/\s*(.*)$/) || [])[1];
  return m[1] + (comment ? ' ' + comment.trim() : '');
}
const PUSHES_A_CONSTANT = (i) => /^(dconst_|fconst_|iconst_|bipush|sipush|ldc)/.test(i);

/**
 * The vertical drag in the AMBIGUOUS shape — `multiply(f, 0.98D, f)` — resolved structurally.
 *
 * ⚠ THE MIDDLE ARGUMENT IS FOUND WITHOUT SIMULATING THE OPERAND STACK, by using the one thing
 * that is true of this call and of nothing else: **the horizontal factors are the SAME COMPUTED
 * VALUE, pushed twice, and the vertical one is the only literal between them.** So the
 * instructions before the constant and the instructions after it must be IDENTICAL sequences,
 * and neither may push a constant of its own.
 *
 * ⚠⚠ THAT SECOND CLAUSE IS NOT A REFINEMENT, IT IS THE WHOLE THING. `ItemEntity` also contains
 * `setDeltaMovement(getDeltaMovement().multiply(1.0D, -0.5D, 1.0D))` — the bounce when it lands
 * — whose flanks are `dconst_1` on both sides and therefore ALSO identical. Matching on
 * symmetry alone reads an item's drag as **−0.5**. Requiring the flanks to be non-literal is
 * what separates "the two horizontal factors are a variable" from "they are the number one".
 *
 * ⚠ AND IF A CLASS YIELDS MORE THAN ONE ANSWER, OR DISAGREES WITH `scale(D)`, THIS REFUSES. A
 * drag is one number; two candidates means the pattern is matching something else as well.
 */
function dragMultiplyIn(dump) {
  const lines = dump.split('\n');
  const found = new Set();
  for (let i = 4; i < lines.length - 1; i++) {
    const c = lines[i].match(
      /invokevirtual\s+#\d+\s+\/\/ Method ([A-Za-z0-9$_]+)\.[A-Za-z0-9$_]+:\(DDD\)L([A-Za-z0-9$_]+);/);
    if (!c || c[1] !== c[2]) continue;
    const V = c[1];
    if (!new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(L'
      + V + ';\\)V').test(lines[i + 1] || '')) continue;
    // walk back to the no-argument getter that produced the Vec3
    let g = -1;
    for (let j = i - 1; j >= Math.max(0, i - 14); j--) {
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(\\)L'
        + V + ';').test(lines[j])) { g = j; break; }
    }
    if (g < 0) continue;
    const body = [];
    for (let j = g + 1; j < i; j++) { const k = insn(lines[j]); if (k) body.push(k); }
    const consts = body.filter((k) => /^ldc2_w .*double/.test(k));
    if (consts.length !== 1) continue;
    const at = body.indexOf(consts[0]);
    const before = body.slice(0, at), after = body.slice(at + 1);
    if (!before.length || before.length !== after.length) continue;
    if (before.join('|') !== after.join('|')) continue;
    if (before.some(PUSHES_A_CONSTANT)) continue;          // the bounce, `multiply(1, -0.5, 1)`
    const v = Number((consts[0].match(/double (-?[\d.E-]+)d/) || [])[1]);
    if (Number.isFinite(v)) found.add(v);
  }
  if (found.size !== 1) return null;
  return [...found][0];
}

/** the gravity literal in one disassembly, or null */
function gravityIn(dump) {
  const lines = dump.split('\n');
  const found = new Set();
  const where = new Map();
  for (let i = 2; i < lines.length - 1; i++) {
    const m = lines[i].match(/ldc2_w\s+#\d+\s+\/\/ double (-[\d.E-]+)d/);
    if (!m) continue;
    if (!/dconst_0/.test(lines[i - 1])) continue;
    if (!/dconst_0/.test(lines[i + 1])) continue;
    const c = (lines[i + 2] || '').match(
      /invokevirtual\s+#\d+\s+\/\/ Method ([A-Za-z0-9$_]+)\.[A-Za-z0-9$_]+:\(DDD\)L([A-Za-z0-9$_]+);/);
    if (!c || c[1] !== c[2]) continue;                  // Vec3.add(DDD) -> Vec3
    const V = c[1];
    // the result must be WRITTEN BACK: `setDeltaMovement(...)`, a one-argument void method
    const set = (lines[i + 3] || '').match(
      new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(L'
        + V + ';\\)V'));
    if (!set) continue;
    // ...and it must have been READ from a no-argument getter of the same type
    let get = false;
    for (let j = i - 2; j >= Math.max(0, i - 5); j--) {
      if (new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(\\)L'
        + V + ';').test(lines[j])) { get = true; break; }
    }
    if (!get) continue;
    found.add(-Number(m[1]));
    where.set(-Number(m[1]), methodAt(lines, i));
  }
  if (found.size === 0) return null;
  // ⚠ MORE THAN ONE CANDIDATE IS A REFUSAL, NOT A VOTE. If a class applies two different
  // downward pushes this file does not know which one is "the" gravity, and picking the first
  // or the commonest would be a guess dressed as a measurement.
  if (found.size > 1) return { ambiguous: [...found] };
  const g = [...found][0];
  return { g: g, method: where.get(g) };
}

// disassemble in batches — javap takes a class list, and 112 at once is one process
const dumps = new Map();
const BATCH = 24;
function disassemble(list) {
  const todo = list.filter((c) => c && !dumps.has(c) && existsSync(join(work, c + '.class')));
  for (let i = 0; i < todo.length; i += BATCH) {
    const text = javap(todo.slice(i, i + BATCH).map((c) => c + '.class'));
    // javap concatenates class dumps; split on the class declaration line
    const parts = text.split(/^(?=(?:public |final |abstract |)*class )/m);
    for (const p of parts) {
      const m = p.match(/^(?:public |final |abstract |)*class ([A-Za-z0-9$_]+)/);
      if (m) dumps.set(m[1], p);
    }
  }
}
/** The superclass javap names in the class declaration, or null at the top of the hierarchy. */
function superOf(cls) {
  const d = dumps.get(cls);
  if (!d) return null;
  const m = d.match(/^(?:public |final |abstract |)*class [A-Za-z0-9$_]+ extends ([A-Za-z0-9$_.]+)/m);
  if (!m) return null;
  return m[1].indexOf('.') >= 0 ? null : m[1];           // java.lang.Object and friends
}
/** Unzip and disassemble a class on demand — the chain reaches classes no entity names. */
function ensure(cls) {
  if (!cls) return false;
  if (dumps.has(cls)) return true;
  try { execFileSync('unzip', ['-qo', JAR, cls + '.class', '-d', work]); } catch { return false; }
  if (!existsSync(join(work, cls + '.class'))) return false;
  disassemble([cls]);
  return dumps.has(cls);
}

const uniq = [...new Set(classOf.values())];
disassemble(uniq);
ok(dumps.size > 100, `${dumps.size} of ${uniq.length} classes disassembled`);

const rows = [];
const noPattern = [];
const ambiguous = [];
// ⚠⚠ **THE SUPERCLASS CHAIN IS NOT WALKED, AND IT WAS TRIED TWICE** (D-309). Most entities apply
// gravity in a superclass, so a walk is the only way to reach them, and it is unsound for TWO
// independent reasons — the second of which is the one that actually settles it:
//
//   1. A NAIVE walk cannot tell an override from an inheritance. That one IS fixable: the JVM
//      dispatches on name AND descriptor, so an obfuscator must rename an override and its
//      parent together, and attributing the literal to a `name(descriptor)` — javap prints each
//      member's signature above its code — lets a walk refuse when a class below declares it.
//      That test was built, and it works.
//   2. ⚠⚠ **THE METHOD HOLDING THE LITERAL NEED NOT BE ON THE TICK PATH AT ALL**, and nothing
//      short of control-flow analysis can say whether it is. With the override test in place the
//      walk gave `ender_dragon` a gravity of 0.04 from a method two classes up that neither
//      class below overrides — and that is not a wrong answer to "is it overridden", it is the
//      right answer to the wrong question. A class can hold a gravity-shaped statement in a
//      helper that only runs in water, in lava, or while ridden. **An entity's own class is the
//      one place where "adds a constant downward push to its delta movement" and "falls at this
//      rate" reliably coincide**, and that is why this file stops there.
//
// D-402 (session 40, PASS 16 JOB 1): `arrow`/`spectral_arrow` NOW RESOLVE, through a SECOND,
// NARROWER pattern (`projectileGravityIn`/`projectileGravityChain`, PART 3 below) — not this
// one. `AbstractArrow` (`bon`, arrow's own superclass, identified the same way `axy` was:
// `entity-types-1.18.2.tsv`'s class column plus a hand read) writes
// `setDeltaMovement(vec3.x, vec3.y - 0.05F, vec3.z)` inside its own `k()` (tick) — the
// three-argument form, a literal promoted from float to double (`0.05000000074505806d` in the
// disassembly), no `.add()`, which is exactly why THIS pattern (`.add()`-shaped, PART 1 above)
// correctly refuses it and always will. The old anchor here asserted the negative outcome
// ("arrow must not resolve") because THIS was the only pattern the file had; PART 3 is not a
// loosening of this one, it is a second, independently-verified pattern for a shape this one
// was never meant to catch.
for (const [name, cls] of [...classOf].sort()) {
  const d = dumps.get(cls);
  if (!d) { noPattern.push(name); continue; }
  const r = gravityIn(d);
  if (!r) { noPattern.push(name); continue; }
  if (r.ambiguous) { ambiguous.push(name + '(' + r.ambiguous.join('/') + ')'); continue; }
  // ⚠ THE TWO DRAG SHAPES MUST AGREE WHEN BOTH ARE PRESENT, or neither is trusted.
  const dScale = dragIn(d), dMul = dragMultiplyIn(d);
  let drag = null;
  if (dScale !== null && dMul !== null) drag = (dScale === dMul) ? dScale : null;
  else drag = dScale !== null ? dScale : dMul;
  rows.push([name, cls, r.g, drag === null ? '' : drag]);
}
const byName = new Map(rows.map((r) => [r[0], r]));

// ── anchors: gravities a player can time with a stopwatch ───────────────────────────────────
// ⚠ AN ITEM AND A FALLING BLOCK FALL AT THE SAME RATE AND AN XP ORB FALLS SLOWER. Those are
// three separate facts and they cannot all come out right from a mis-parse.
ok(byName.has('item') && byName.get('item')[2] === 0.04, `item gravity should be 0.04, got ${byName.get('item') && byName.get('item')[2]}`);
ok(byName.has('falling_block') && byName.get('falling_block')[2] === 0.04, 'falling_block gravity should be 0.04');
ok(byName.has('tnt') && byName.get('tnt')[2] === 0.04, 'tnt gravity should be 0.04');
ok(byName.has('experience_orb') && byName.get('experience_orb')[2] === 0.03, 'experience_orb gravity should be 0.03');
// ⚠ THE NEGATIVE ANCHORS ARE THE ONES THAT CAUGHT THE BUG. Each of these produced a WRONG row
// under the looser pattern, and each is a fact: an arrow inherits its tick and has no literal of
// its own; an ender dragon does not fall; a boat's gravity is not 0.7 — that number is a
// position offset in the same shape.
// D-402: `arrow` is asserted here to resolve NOTHING via this (.add()-shaped) pattern — the
// positive claim (it DOES resolve, via the different PART 3 pattern, at 0.05) is asserted after
// PART 3 runs, against the same `byName` map, so a regression in EITHER pattern is caught.
ok(!rows.some((r) => r[0] === 'arrow'), "arrow must NOT resolve via the .add()-shaped pattern: it uses setDeltaMovement(x, y - 0.05F, z), not .add()");
// ⚠ AN ENDER DRAGON STILL MUST NOT RESOLVE. Nothing in its chain adds a constant downward
// push to its delta movement, and the looser pattern read 2 for it — a position offset.
ok(!byName.has('ender_dragon'), 'an ender dragon does not apply gravity to its delta movement');
ok(!byName.has('boat') || byName.get('boat')[2] < 0.1, `boat gravity reads ${byName.get('boat') && byName.get('boat')[2]} — 0.7 is a position offset, not gravity`);
for (const [n, r] of byName) ok(r[2] > 0 && r[2] <= 0.1, `${n}'s gravity is ${r[2]}, which is not a per-tick acceleration`);
ok(rows.length >= 4, `${rows.length} entity types resolved a gravity`);
// ⚠ BOTH DRAG ANCHORS, AND BOTH DIRECTIONS. `falling_block` and `tnt` damp with `scale(0.98)`
// and must resolve; `item` and `experience_orb` damp with `multiply(f, 0.98, f)` and must NOT —
// a value for them here would mean this file had guessed at an argument slot.
ok(byName.has('falling_block') && byName.get('falling_block')[3] === 0.98, `falling_block drag should be 0.98, got ${byName.get('falling_block') && byName.get('falling_block')[3]}`);
ok(byName.has('tnt') && byName.get('tnt')[3] === 0.98, 'tnt drag should be 0.98');
// ⚠ AND THE SECOND SHAPE'S OWN ANCHORS. `item` and `experience_orb` damp with
// `multiply(f, 0.98, f)`, so they resolve 0.98 — and **an item that came out at −0.5 means the
// bounce was matched instead of the drag**, which is the mistake this pattern is shaped to avoid.
ok(byName.get('item') && byName.get('item')[3] === 0.98, `item drag should be 0.98, got ${byName.get('item') && byName.get('item')[3]}`);
ok(byName.get('experience_orb') && byName.get('experience_orb')[3] === 0.98, `experience_orb drag should be 0.98, got ${byName.get('experience_orb') && byName.get('experience_orb')[3]}`);
for (const [n, r] of byName) ok(r[3] === '' || (r[3] > 0 && r[3] <= 1), `${n}'s drag is ${r[3]}, which is not a damping factor`);
ok(ambiguous.length === 0, `${ambiguous.length} classes push two different downward constants: ${ambiguous.join(' ')}`);


// ── PART 2 — LivingEntity's OWN generic gravity/drag, for types PROVEN not to override it ──
//
// D-307/D-309 above are about entities whose OWN class carries the literal. `cow` and `zombie`
// carry none — not because the pattern is wrong, but because neither class applies gravity
// itself at all (D-384..D-389, sessions 9 and 29). Both dispatch `travel()`/`h(dpo)` straight
// through to `LivingEntity` (`axy`) unintercepted, and `axy.h()` itself was read instruction by
// instruction and found to apply a generic downward push, unconditionally, to every caller that
// does not override it: `d0 = 0.08` (or `0.01` under Slow Falling, an effect this file does not
// model, so `0.08` is the value that applies whenever no effect is active — which is every
// unmodified spawn), subtracted from the vertical component ~1,170 bytecode offsets later, then
// the whole result damped by `* 0.98` before `setDeltaMovement`. D-388/D-389 already proved this
// is the WHOLE of cow's/zombie's per-tick physics — `Mob.tick()`, `Mob.serverAiStep()` and
// `Entity` itself carry no second, competing gravity statement anywhere on the path.
//
// ⚠⚠ **THIS IS NOT THE CHAIN WALK D-309 REJECTED.** D-309 rejected walking an ARBITRARY
// superclass chain for ANY gravity-shaped literal, because the literal need not be on the tick
// path (ender_dragon's own rejected test case: a literal two classes up that nothing below
// calls). This is narrower and different in kind: ONE specific, already fully-read method
// (`axy.h()`/`travel()`) that D-387 already proved is the exact method cow's and zombie's own
// dispatch reaches, confirmed by an automated override check (below) rather than assumed. D-309
// itself named this as the correct shape: "checking that the statement it found is on the
// unconditional path" — done by hand for cow/zombie in session 29, made mechanical here so a
// future entity is added, or removed, by evidence rather than memory.
//
// ⚠ **THE CANDIDATE LIST IS DELIBERATELY SHORT AND HAND-NAMED, NOT DISCOVERED.** Only `cow` and
// `zombie` have had their WHOLE tick path read end to end (D-387/D-388/D-389). Extending this to
// any other type needs the same instruction-by-instruction proof, not an assumption that "it's
// probably also a plain LivingEntity" — D-309's ender_dragon lesson is exactly why a look-alike
// is not evidence.
// D-396 (session 34): `skeleton` added. Its OWN class (`bml`, Monster's own direct subclass,
// same shape as zombie's `bmw`) is checked by the SAME mechanical proof `reachesLivingEntityUn-
// intercepted` already applies to cow/zombie -- the function IS the D-309 instruction made
// mechanical (no h(dpo) override anywhere on the chain, no w_() override that skips super) and
// D-390's own anti-vacuity test (ender_dragon must be refused) already proves the mechanism can
// say no. Adding a third candidate is applying that proof to a new chain, not skipping it -- but
// unlike cow/zombie (session 29's own instruction-by-instruction read of every hop, D-387/388/
// 389), skeleton's chain was NOT read by hand first, only checked mechanically. If the check
// below refuses it, that refusal is trusted the same as ender_dragon's; if it accepts it, this
// is one rung less rigorous than cow/zombie's own proof and is named as such rather than
// claimed equal (D-396 has the full reasoning).
//
// ⚠ SPIDER ADDED (PASS 16 JOB 1, session 39). Spider's own class (`bmo`) was read by hand, in
// full — every one of its 20 declared methods — and it declares no `travel()` override and no
// gravity/drag literal of its own, so the generic route applies exactly as it does for cow/
// zombie/skeleton (this rung is the FULL by-hand read, same rigor as D-387/388/389, not
// skeleton's mechanical-only check). Spider's only relevant override is `k()` (`tick()`):
// `if (!this.s.x) this.v(this.z)` — `s`(`Lcav;`)=`level`, `cav.x`=`public final boolean` (only
// `isClientSide` fits), `z`=a `boolean` field on `axk`(Entity) written earlier in the SAME
// class's collision-resolution method as `(xCollided || zCollided)` — structurally
// `horizontalCollision`, not merely a name match — and `v(Z)` toggles bit 0 of the shared
// entity-data byte this class already reads in `t()`. That is vanilla's
// `setClimbing(this.horizontalCollision)`, called once a tick, non-client-side only. It changes
// NOTHING about gravity/drag here; it only means spider's own `onClimbable()` differs from the
// generic block-tag check `Ph.onClimbable` already implements for ladders/vines — see
// `07i_entitylist.js`'s `EL.spiderClimbing` and D-401.
// VILLAGER ADDED (loop pass, 22 Sept 2026). `bnw` (Villager) -> `bnr` (AbstractVillager) ->
// `axi` -> `ayh` -> `aya`, then `axy` (LivingEntity) directly. All five read in full: none of
// bnw/bnr/axi/ayh/aya DECLARES `h(dpo)` (travel); axi and aya each override `w_()` (tick) but
// both call their immediate superclass's `w_()` as their FIRST instruction (`invokespecial
// ayh.w_:()V` in axi, `invokespecial axy.w_:()V` in aya), so tick fully delegates down to
// axy's own generic body unintercepted — same proof shape D-387-389/D-401 already gave
// cow/spider. The mechanical check below (villager reaching axy unintercepted, gravity/drag
// matching Ph.GRAVITY/Ph.DRAG_Y) is the regression guard for this hand read, not a replacement.
// RAID MOBS ADDED (QUEUE 0.2 raid loop, loop/illagers-s92). All six read in full from
// .decomp (Yarn 1.18.2): `VindicatorEntity`/`PillagerEntity` extend `IllagerEntity` extend
// `RaiderEntity` extend `PatrolEntity` extend `HostileEntity` extend `PathAwareEntity` extend
// `MobEntity` extend `LivingEntity`; `WitchEntity`/`RavagerEntity` extend `RaiderEntity`
// directly (same tail); `EvokerEntity`/`IllusionerEntity` extend `SpellcastingIllagerEntity`
// extend `IllagerEntity` (same tail again). NONE of IllagerEntity, RaiderEntity, PatrolEntity
// or SpellcastingIllagerEntity declares `travel()`, and none of the six leaf classes does
// either (grepped for `void tick(`/`void travel(` across all ten source files: RaiderEntity,
// WitchEntity, RavagerEntity and IllusionerEntity override `tickMovement()` only — a different
// method that never reaches `h(dpo)`/travel and so cannot intercept it; SpellcastingIllagerEntity
// overrides `tick()` but calls `super.tick()` as its first statement, same delegation shape
// D-401 already verified for villager's `axi`/`aya`). All six therefore reach `axy.h()`
// (LivingEntity's generic gravity/drag) exactly like cow/zombie/villager above.
// ⚠ VEX IS DELIBERATELY NOT HERE. `VexEntity.tick()` (`bmr.k()`) calls `super.tick()` but then
// unconditionally does `this.setNoGravity(true)` every single tick (read in full: no gate, no
// condition) — vanilla vexes fly and never fall. Adding `vex` to this list would give it a
// gravity value the generic body computes but the real entity never applies; it is named on
// `Rd.OWED` instead of guessed, and `src/07s_raid.js`'s vex placeholder must not use `Ph.GRAVITY`.
// loop/creeper-s95 — `CreeperEntity.tick()` (.decomp/net/minecraft/entity/mob/CreeperEntity.java)
// overrides tick() only to run the fuse counter, then calls `super.tick()` unconditionally as its
// LAST statement (not gated, not skipped) — the same delegation shape D-401 already verified for
// witch/vindicator/pillager/ravager/evoker/illusioner above, and it declares no `h(dpo)`/travel()
// of its own. It reaches `axy.h()` (LivingEntity's generic gravity/drag) unintercepted.
const GENERIC_CANDIDATES = ['cow', 'sheep', 'chicken', 'zombie', 'skeleton', 'spider', 'wolf', 'ocelot', 'cat', 'parrot', 'villager', 'iron_golem',
  'vindicator', 'pillager', 'witch', 'ravager', 'evoker', 'illusioner', 'creeper'];
const LIVINGENTITY_CLASS = 'axy'; // D-384: identified by triangulation; D-387-389 read in full.

/**
 * `axy.h(dpo)`'s own generic gravity/drag — read from the method body itself, not hardcoded,
 * so a future jar (or a mistaken class identification) makes this refuse rather than lie.
 *
 * Shape, exactly as D-388/D-389 read it by hand: the FIRST `ldc2_w` double literal in the method
 * is the gravity local (`0.08d` when no falling-speed effect is active — the only case this file
 * models); later in the SAME method a double literal near `0.98` is immediately followed by
 * `dmul` — the vertical-drag multiply just before `setDeltaMovement`. Two independent literals,
 * both required, in one method — ambiguity (more than one candidate for either) is a refusal.
 */
function livingEntityGenericIn(dump) {
  const lines = dump.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{2}(?:public|protected)\s+void\s+h\(dpo\);\s*$/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null; // this class is not axy, or javap printed it differently
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{2}(?:public |protected |private |static |final |abstract |synchronized |native )*[A-Za-z0-9$_.<>[\],]+\s+[A-Za-z0-9$_<>]+\([^)]*\);\s*$/.test(lines[i])) { end = i; break; }
  }
  const body = lines.slice(start, end);
  const gravities = new Set();
  for (const l of body) {
    const m = l.match(/ldc2_w\s+#\d+\s+\/\/ double ([\d.E-]+)d/);
    if (m) gravities.add(Number(m[1]));
    if (gravities.size) break; // only the FIRST double literal in the method counts (D-388's read)
  }
  if (gravities.size !== 1) return null;
  const g = [...gravities][0];
  const drags = new Set();
  for (let i = 0; i < body.length - 1; i++) {
    const m = body[i].match(/ldc2_w\s+#\d+\s+\/\/ double (0\.9\d+)d/);
    if (!m) continue;
    if (!/^\s*\d+:\s+dmul\s*$/.test(body[i + 1] || '')) continue;
    drags.add(Number(m[1]));
  }
  if (drags.size !== 1) return null;
  return { g: g, drag: [...drags][0] };
}

/**
 * True when `cls` declares `sig` and that method's FIRST instructions, before any branch, call
 * `invokespecial <sup>.<name>:<descriptor>` — i.e. the override cannot skip its parent (G17b-4).
 * Returns false when `cls` declares no such method: the caller decides what that means.
 */
function methodBody(dump, sig) {
  const lines = dump.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (methodAt([lines[i]], 0) !== sig) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && !/^\s{2}\S/.test(lines[j]); j++) body.push(lines[j]);
    return body;
  }
  return null;
}
function callsSuperFirst(cls, sig, sup) {
  if (!ensure(cls) || !sup) return false;
  const body = methodBody(dumps.get(cls), sig);
  if (!body) return false;
  const name = sig.slice(0, sig.indexOf('('));
  for (const l of body) {
    const i = insn(l);
    if (!i) continue;
    if (/^(if|goto|tableswitch|lookupswitch)/.test(i)) return false;
    if (new RegExp('^invokespecial (?:Method )?' + sup + '\\.' + name + ':\\(').test(i)) return true;
  }
  return false;
}

/**
 * Walks from `startCls` up to `LIVINGENTITY_CLASS`, refusing the moment any class in between —
 * `startCls` itself included — either (a) DECLARES `h(dpo)` (travel) as its own method, which
 * is D-309's own accepted repair to the chain-walk problem (name+descriptor identity, not
 * presence-vs-absence in a caller list), or (b) overrides `w_()` (tick) WITHOUT an
 * `invokespecial <superclass>.w_:()V` anywhere in its body — because that is exactly how
 * `ender_dragon` (`bkd`) skips `travel()` entirely without ever declaring an `h(dpo)` of its
 * own (found by this same check's own anti-vacuity test, below): its `w_()` override replaces
 * `LivingEntity.tick()` outright and never calls `super.tick()`, so `h()` is simply never
 * reached — a name-only check for `h(dpo)` cannot see this, because nothing named `h` is ever
 * declared anywhere on `bkd`'s chain. Calling `super.w_()` is necessary but not proof of
 * SUFFICIENT delegation (D-309's own caveat: "nothing short of control-flow analysis can say
 * which") — which is why `GENERIC_CANDIDATES` stays hand-verified by a full instruction-by-
 * instruction read (D-387/D-388/D-389) rather than trusted to this mechanical check alone; this
 * check is the REGRESSION GUARD for that hand read, not a replacement for it.
 */
function reachesLivingEntityUnintercepted(startCls) {
  let cls = startCls, hops = 0;
  while (cls && cls !== LIVINGENTITY_CLASS && hops < 24) {
    if (!ensure(cls)) return { ok: false, reason: `could not disassemble ${cls}` };
    const dump = dumps.get(cls);
    const sigs = signaturesOf(dump);
    if ([...sigs].some((s) => s === 'h(dpo)')) return { ok: false, reason: `${cls} declares h(dpo) itself — overrides travel()` };
    if ([...sigs].some((s) => s === 'w_()')) {
      const sup = superOf(cls);
      const callsSuper = sup && new RegExp('invokespecial\\s+#\\d+\\s+// Method ' + sup + '\\.w_:\\(\\)V').test(dump);
      if (!callsSuper) return { ok: false, reason: `${cls} overrides w_() (tick) without calling super.w_() — travel() is never reached, exactly ender_dragon's shape (D-309)` };
    }
    cls = superOf(cls);
    hops++;
  }
  if (cls !== LIVINGENTITY_CLASS) return { ok: false, reason: `chain from ${startCls} did not reach ${LIVINGENTITY_CLASS} within ${hops} hops` };
  return { ok: true };
}

ensure(LIVINGENTITY_CLASS);
const axyDump = dumps.get(LIVINGENTITY_CLASS);
ok(!!axyDump, `${LIVINGENTITY_CLASS} (LivingEntity, D-384) disassembles`);
const generic = axyDump && livingEntityGenericIn(axyDump);
ok(!!generic, `${LIVINGENTITY_CLASS}.h(dpo)'s own generic gravity/drag reads unambiguously (D-388/D-389's method, by regex now)`);

// ⚠ CROSS-CHECKED AGAINST SOMETHING INDEPENDENT (D-309's own closing rule). `src/14b_physics.js`'s
// GRAVITY/DRAG_Y were extracted from PLAYER's OWN class, years and sessions apart from this
// method — Player IS a LivingEntity and takes the exact same `axy.h()` body when not flying/
// swimming/gliding, so agreement here is a real check, not a tautology.
if (generic) {
  const physJs = readFileSync(join(ROOT, 'src', '14b_physics.js'), 'utf8');
  const physGravity = Number((physJs.match(/GRAVITY:\s*([\d.]+)/) || [])[1]);
  const physDrag = Number((physJs.match(/DRAG_Y:\s*([\d.]+)/) || [])[1]);
  ok(generic.g === physGravity, `axy's own gravity (${generic.g}) should match Ph.GRAVITY (${physGravity}) — same method, independently measured`);
  ok(Math.abs(generic.drag - physDrag) < 0.001, `axy's own drag (${generic.drag}) should match Ph.DRAG_Y (${physDrag})`);
}

// ⚠ ANTI-VACUITY (D-30, D-305): the override check must actually be ABLE to refuse. `ender_dragon`
// is D-309's own documented case of a type that overrides travel() outright — if this check ever
// said `ender_dragon` reaches `axy` unintercepted, the check cannot fire and is not a check.
if (classOf.has('ender_dragon')) {
  const dragonCheck = reachesLivingEntityUnintercepted(classOf.get('ender_dragon'));
  ok(!dragonCheck.ok, `anti-vacuity: ender_dragon overrides travel() (D-309) — the override check must refuse it, got ${JSON.stringify(dragonCheck)}`);
}

const genericRows = [];
if (generic) {
  for (const name of GENERIC_CANDIDATES) {
    const cls = classOf.get(name);
    if (!cls) { ok(false, `${name} has no class in entity-types-1.18.2.tsv — cannot check it`); continue; }
    if (byName.has(name)) { ok(false, `${name} already resolved its OWN gravity statement — GENERIC_CANDIDATES is stale, remove it`); continue; }
    const chain = reachesLivingEntityUnintercepted(cls);
    if (!ok(chain.ok, `${name} (${cls}) reaches ${LIVINGENTITY_CLASS} unintercepted: ${chain.ok ? 'yes' : chain.reason}`)) continue;
    genericRows.push([name, cls, generic.g, generic.drag, 'generic:axy.h()-D-390']);
    byName.set(name, genericRows[genericRows.length - 1]);
  }
}
ok(genericRows.length === GENERIC_CANDIDATES.length, `${genericRows.length}/${GENERIC_CANDIDATES.length} generic candidates resolved`);

/**
 * ⚠ D-459 — A SECOND, NARROWER SHAPE: A CLASS THAT *DOES* DECLARE ITS OWN `h(dpo)` (so
 * `GENERIC_CANDIDATES`/`reachesLivingEntityUnintercepted` correctly REFUSE it, as D-458 already
 * found for `horse`) BUT WHOSE OWN OVERRIDE BODY, READ BY HAND, GATES ITS ENTIRE CUSTOM BRANCH
 * BEHIND A CONDITION THIS ENGINE CAN NEVER SATISFY, AND FALLS THROUGH TO AN `invokespecial
 * <superclass>.h:(Ldpo;)V` THAT THE SUPERCLASS ITSELF DOES NOT IMPLEMENT — so it resolves, by
 * ordinary JVM `invokespecial` semantics, up the SAME chain `reachesLivingEntityUnintercepted`
 * already walks, to `axy.h()` itself. This is NOT the mechanical `GENERIC_CANDIDATES` check
 * (which asks "no override anywhere on the chain" and must say no here) — it is a SEPARATE,
 * by-hand-verified claim ("the override exists, but only ever takes its trivial branch"), with
 * its own narrower mechanical regression guard below, same relationship D-390's own comment
 * already describes for `GENERIC_CANDIDATES` and its check.
 *
 * `horse` (`bjq` → `bjo`/AbstractHorse), read in full this session: `bjo.h(dpo)` opens with
 * `if (!bl()) return;` then `if (bG() && fg() && d())` gates the jump/steer branch (`fg()` is
 * `cE() instanceof axy` — `getControllingPassenger() instanceof LivingEntity`, vanilla's own
 * `canBeControlledByRider()` shape). When that triple is false — ALWAYS, in this engine, because
 * nothing here ever sets a controlling passenger on anything (no mounting/riding system exists;
 * `Tame.OWED` already names riding as G25, unimplemented) — the method sets `bb = 0.02f` (a
 * jump-strength field, written but never read while unridden) and falls straight to
 * `invokespecial bid.h:(Ldpo;)V`. `bid` (checked below) declares no `h(dpo)` of its own, so that
 * call resolves up `bid`'s own chain to `axy.h()` — the identical generic body every
 * `GENERIC_CANDIDATES` entry already uses. **The real ridden branch is NOT ported** — it needs
 * G25 (riding) to ever run, and is `Ai.OWED`'d, not approximated.
 */
const CONDITIONAL_GENERIC = [
  { name: 'horse', note: 'D-459: bjo(AbstractHorse).h(dpo) gates its custom branch behind ' +
      'canBeControlledByRider(), unreachable with no riding system (G25); the fallback resolves ' +
      'through bid (no h(dpo) of its own) to axy.h() — read in full, not approximated.' },
  { name: 'pig', note: 'G18c: PigEntity (bis) declares no h(dpo) of its own; its travel() ' +
      'override is ItemSteerable\'s default method, gated behind hasPassengers() && ' +
      'canBeControlledByRider() && firstPassenger instanceof PlayerEntity (.decomp\'s own ' +
      'ItemSteerable.travel), unreachable with no pig-riding wired; the else branch calls ' +
      'setMovementInput() -> AnimalEntity.travel() (super, no override) -> axy.h(), same shape ' +
      'as horse\'s own fallback.' },
  { name: 'armor_stand', src: 'conditional-generic:bkz.h()->axy.h()-G17b-4', tick: 'k()',
    note: 'G17b-4: ArmorStandEntity (bkz) overrides travel() as `if (canClip()) super.travel(v)` ' +
      '(canClip = !hasNoGravity, .decomp ArmorStandEntity:115/550) - the gate IS the gravity ' +
      'switch, so with gravity on it reaches axy.h() unmodified; its tick() opens with super.tick().' }
];

if (generic) {
  for (const { name, note, src, tick } of CONDITIONAL_GENERIC) {
    const cls = classOf.get(name);
    if (!ok(!!cls, `${name} has no class in entity-types-1.18.2.tsv — cannot check it`)) continue;
    if (!ok(!byName.has(name), `${name} already resolved its OWN gravity statement — CONDITIONAL_GENERIC is stale, remove it`)) continue;
    // The override may sit on `cls` itself or on an ancestor (`horse`/bjq inherits bjo's own
    // h(dpo) — bjq declares none itself), so walk up the SAME way reachesLivingEntityUnintercepted
    // does until the class that actually declares h(dpo) is found, THEN check its own superclass.
    let overrideCls = cls, hops = 0, found = false;
    while (overrideCls && hops < 24) {
      if (!ok(ensure(overrideCls), `${overrideCls} (${name}'s chain) disassembles`)) { overrideCls = null; break; }
      const sigs = signaturesOf(dumps.get(overrideCls));
      if ([...sigs].some((s) => s === 'h(dpo)')) { found = true; break; }
      overrideCls = superOf(overrideCls);
      hops++;
    }
    if (!ok(found, `${name} (${cls}) has an h(dpo) override SOMEWHERE on its chain — if this ever goes false, move ${name} to GENERIC_CANDIDATES instead, CONDITIONAL_GENERIC is stale`)) continue;
    const sup = superOf(overrideCls);
    const chain = sup ? reachesLivingEntityUnintercepted(sup) : { ok: false, reason: `${overrideCls} has no superclass` };
    if (!ok(chain.ok, `${name}'s override (${overrideCls})'s fallback target ${sup} reaches ${LIVINGENTITY_CLASS} unintercepted: ${chain.ok ? 'yes' : chain.reason}`)) continue;
    if (tick) {
      // the entity's own tick must reach LivingEntity.tick() on its FIRST branch-free path,
      // or travel() is never called (ender_dragon's shape, D-309)
      const sup2 = superOf(cls);
      if (!ok(callsSuperFirst(cls, tick, sup2), `${name} (${cls}) ${tick} calls super.${tick} before any branch`)) continue;
    }
    genericRows.push([name, cls, generic.g, generic.drag, src || `conditional-generic:bid.h()->axy.h()-D-459`]);
    byName.set(name, genericRows[genericRows.length - 1]);
    say(`   ${name}: ${note}`);
  }
}
ok(genericRows.length === GENERIC_CANDIDATES.length + CONDITIONAL_GENERIC.length, `${genericRows.length}/${GENERIC_CANDIDATES.length + CONDITIONAL_GENERIC.length} generic + conditional-generic candidates resolved`);

// ⚠ ANTI-VACUITY for CONDITIONAL_GENERIC itself: the declares-own-h(dpo) gate must be able to
// refuse. `cow` reaches axy unintercepted with NO override at all — if CONDITIONAL_GENERIC's own
// declaresOwn check ever passed something that does not actually override h(dpo), the check
// cannot fire and is not a check.
{
  const cowCls = classOf.get('cow');
  if (cowCls && ensure(cowCls)) {
    const cowSigs = signaturesOf(dumps.get(cowCls));
    const cowDeclaresOwn = [...cowSigs].some((s) => s === 'h(dpo)');
    ok(!cowDeclaresOwn, `anti-vacuity: cow does NOT declare h(dpo) (D-390) — the CONDITIONAL_GENERIC declares-own gate must be able to tell the difference, got declaresOwn=${cowDeclaresOwn}`);
  }
}


// ── PART 3 — the projectile shape (D-402, session 40, PASS 16 JOB 1's own last item) ────────
//
// ⚠⚠ THIS IS A THIRD PATTERN, NOT A LOOSENING OF PART 1's. `AbstractArrow.k()` (`bon`, arrow's
// own superclass) writes its gravity back with a 3-argument `setDeltaMovement(x, y - G, z)` —
// read from `Vec3`'s own three fields individually and reassembled, not `.add()`'d as one call.
// The shape, read by hand from `bon`'s disassembly (D-402's entry has the full walk):
//
//     invokevirtual  <cls>.<getter>:()L<V>;      <- getDeltaMovement()
//     astore         n
//     aload_0
//     aload          n
//     getfield       V.<f1>:D                    <- x, unchanged
//     aload          n
//     getfield       V.<f2>:D                    <- y
//     ldc2_w         double G                    <- the literal itself
//     dsub                                       <- y - G
//     aload          n
//     getfield       V.<f3>:D                    <- z, unchanged
//     invokevirtual  <cls>.<setter>:(DDD)V        <- setDeltaMovement(x, y-G, z)
//
// `projectileGravityIn` requires all of: a 0-argument getter returning some class `V`; exactly
// THREE getfield reads of `V`'s own double fields, on THREE DISTINCT field names (refusing the
// same field read more than once, the way `dragMultiplyIn`'s flanks refuse a literal on both
// sides); exactly ONE of those three immediately followed by `ldc2_w <double>` then `dsub`
// (ambiguity — more than one such literal, or disagreement — is a refusal, same rule as
// `gravityIn`'s ambiguous-candidate refusal); and a `(DDD)V` setter within a few lines after.
// It does NOT match `bpg` (`ThrowableItemProjectile`, snowball/egg/ender_pearl/potion's own
// shared superclass) even though that class's `k()` ALSO subtracts one Vec3 component from the
// other two unchanged — because `bpg` pushes the literal through a VIRTUAL call
// (`invokevirtual <cls>.l:()F` then `f2d`) to its own overridable `l()` getter, not a bare
// `ldc2_w`, and this pattern requires the literal itself, on purpose (the same "the pattern is
// the whole statement" discipline PART 1's own header states) — `bpg`/snowball are left OWED
// below, a second, real extractor entry for a later pass, not folded into this one by a
// look-alike shape.
//
// `projectileGravityChain` walks from an entity's own class upward (bounded, like
// `reachesLivingEntityUnintercepted`): at each hop, if `projectileGravityIn` matches that
// class's OWN dump, the walk resolves there; otherwise, if that class declares its own `k()`
// (tick), the walk refuses UNLESS `k()` invokes `invokespecial <superclass>.k:()V` SOMEWHERE in
// its body — the same "declares-but-delegates" proof D-309's own override check uses, carrying
// the same caveat D-309 already states: calling super is necessary, not sufficient, proof of
// full delegation (control flow could still skip it on some path). `PROJECTILE_CANDIDATES`
// stays hand-verified rather than trusting the mechanical check alone, the same standing
// D-396/D-401 already gave `GENERIC_CANDIDATES`: `arrow` (`bop`) was read in full — its own
// `k()` calls `bon.k()` as its FIRST instruction, unconditionally, then does unrelated particle/
// despawn bookkeeping — and `spectral_arrow` (`bpe`) the same, `bon.k()` first and unconditional
// before its own glint-particle branch. `trident` (`bpl`) also reaches `bon.k()`, but NOT as
// its first instruction — it is reached after several other statements this session did not
// walk far enough to prove are unconditional — so it is named here as OWED rather than added on
// the strength of a grep match; the same is true of every other `AbstractArrow` descendant this
// session did not open (see the TSV's own `owed:` line).
function projectileGravityIn(dump) {
  const lines = dump.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const g = lines[i].match(/invokevirtual\s+#\d+\s+\/\/ Method (?:[A-Za-z0-9$_]+\.)?[A-Za-z0-9$_]+:\(\)L([A-Za-z0-9$_]+);/);
    if (!g) continue;
    const V = g[1];
    const fieldRe = new RegExp('getfield\\s+#\\d+\\s+// Field ' + V + '\\.([A-Za-z0-9$_]+):D');
    const setRe = /invokevirtual\s+#\d+\s+\/\/ Method (?:[A-Za-z0-9$_]+\.)?[A-Za-z0-9$_]+:\(DDD\)V/;
    const fieldNames = [];
    let literal = null, ambiguous = false, j = i + 1;
    const limit = Math.min(lines.length, i + 60);
    for (; j < limit; j++) {
      const fm = lines[j].match(fieldRe);
      if (!fm) continue;
      fieldNames.push(fm[1]);
      const after1 = lines[j + 1] || '', after2 = lines[j + 2] || '';
      const lit = (after1.match(/ldc2_w\s+#\d+\s+\/\/ double ([\d.E-]+)d/) || [])[1];
      if (lit !== undefined && /^\s*\d+:\s+dsub\s*$/.test(after2)) {
        const v = Number(lit);
        if (literal !== null && literal !== v) ambiguous = true;
        literal = v;
      }
      if (fieldNames.length === 3) { j++; break; }
    }
    if (fieldNames.length !== 3 || new Set(fieldNames).size !== 3) continue;
    if (literal === null || ambiguous) continue;
    let setterFound = false;
    for (let k = j; k < Math.min(lines.length, j + 6); k++) {
      if (setRe.test(lines[k])) { setterFound = true; break; }
    }
    if (!setterFound) continue;
    // float 0.05F promoted to double prints as 0.05000000074505806d — round to float precision.
    // float 0.05F promoted to double prints as 0.05000000074505806d — round to float precision.
    return Math.round(literal * 1e6) / 1e6;
  }
  return null;
}

/**
 * The projectile's own AIR drag (D-402), a SECOND narrow pattern in the same method:
 * `AbstractArrow.k()` stores the gravity literal into one local and the drag literal into the
 * IMMEDIATELY PRECEDING local, both at the top of the method, unconditionally (read by hand —
 * see the walk in this file's D-402 section above); only later, past a water/air branch this
 * file does not resolve, is the drag local reloaded, `f2d`'d, and passed through the ordinary
 * `getDeltaMovement().scale(f).setDeltaMovement(...)` shape PART 1's own `dragIn` already knows
 * — but PART 1 cannot see it because of the `f2d` indirection sitting between the literal and
 * the scale call. `gravityFloat` anchors which pair of adjacent literals is the right one: the
 * SECOND of the two must equal the gravity this file already resolved for the SAME class, so a
 * class with an unrelated pair of adjacent float constants cannot be mistaken for this shape.
 */
function projectileDragIn(dump, gravityFloat) {
  const lines = dump.split('\n');
  for (let i = 0; i < lines.length - 3; i++) {
    const m1 = lines[i].match(/ldc_w\s+#\d+\s+\/\/ float ([\d.E-]+)f/);
    if (!m1) continue;
    const m1s = lines[i + 1].match(/^\s*\d+:\s+fstore\s+(\d+)/);
    if (!m1s) continue;
    const m2 = lines[i + 2].match(/ldc_w\s+#\d+\s+\/\/ float ([\d.E-]+)f/);
    if (!m2) continue;
    if (Math.abs(Number(m2[1]) - gravityFloat) > 1e-6) continue;   // must be OUR gravity literal
    const dragLocal = m1s[1];
    for (let j = i + 3; j < lines.length - 3; j++) {
      if (!new RegExp('^\\s*\\d+:\\s+fload\\s+' + dragLocal + '\\s*$').test(lines[j])) continue;
      if (!/^\s*\d+:\s+f2d\s*$/.test(lines[j + 1] || '')) continue;
      const sc = (lines[j + 2] || '').match(/invokevirtual\s+#\d+\s+\/\/ Method (?:[A-Za-z0-9$_]+\.)?[A-Za-z0-9$_]+:\(D\)L([A-Za-z0-9$_]+);/);
      if (!sc) continue;
      const setr = new RegExp('invokevirtual\\s+#\\d+\\s+// Method (?:[A-Za-z0-9$_]+\\.)?[A-Za-z0-9$_]+:\\(L' + sc[1] + ';\\)V');
      if (!setr.test(lines[j + 3] || '')) continue;
      return Number(m1[1]);
    }
  }
  return null;
}

function projectileGravityChain(startCls) {
  let cls = startCls, hops = 0;
  while (cls && hops < 10) {
    if (!ensure(cls)) return { ok: false, reason: `could not disassemble ${cls}` };
    const dump = dumps.get(cls);
    const direct = projectileGravityIn(dump);
    if (direct !== null) return { ok: true, g: direct, cls: cls };
    const sigs = signaturesOf(dump);
    if ([...sigs].some((s) => s === 'k()')) {
      const sup = superOf(cls);
      const callsSuper = sup && new RegExp('invokespecial\\s+#\\d+\\s+// Method ' + sup + '\\.k:\\(\\)V').test(dump);
      if (!callsSuper) return { ok: false, reason: `${cls} overrides k() (tick) without calling super.k() anywhere in its body` };
    }
    cls = superOf(cls);
    hops++;
  }
  return { ok: false, reason: `chain from ${startCls} exhausted (${hops} hops) without finding the projectile gravity shape` };
}

const PROJECTILE_CANDIDATES = ['arrow', 'spectral_arrow'];
const projectileRows = [];
for (const name of PROJECTILE_CANDIDATES) {
  const cls = classOf.get(name);
  if (!cls) { ok(false, `${name} has no class in entity-types-1.18.2.tsv — cannot check it`); continue; }
  if (byName.has(name)) { ok(false, `${name} already resolved elsewhere — PROJECTILE_CANDIDATES is stale, remove it`); continue; }
  const chain = projectileGravityChain(cls);
  if (!ok(chain.ok, `${name} (${cls}) reaches the projectile gravity shape unintercepted: ${chain.ok ? ('g=' + chain.g + ' @ ' + chain.cls) : chain.reason}`)) continue;
  // ⚠ THE DRAG LOCAL IS READ FROM THE SAME CLASS THE GRAVITY RESOLVED IN — `chain.cls`, not
  // `cls` — because both literals live in the SAME method (`bon.k()`), not the entity's own
  // leaf class (`bop`/`bpe` merely delegate to it via `invokespecial`).
  const drag = projectileDragIn(dumps.get(chain.cls), chain.g);
  ok(drag !== null, `${name} (${chain.cls}) resolves its own unconditional (non-water) air drag`);
  projectileRows.push([name, cls, chain.g, drag === null ? '' : drag, 'projectile:setDeltaMovement(DDD)-D-402']);
  byName.set(name, projectileRows[projectileRows.length - 1]);
}
ok(projectileRows.length === PROJECTILE_CANDIDATES.length, `${projectileRows.length}/${PROJECTILE_CANDIDATES.length} projectile candidates resolved`);
ok(byName.has('arrow') && byName.get('arrow')[2] === 0.05, `arrow gravity should be 0.05 (D-402), got ${byName.get('arrow') && byName.get('arrow')[2]}`);
ok(byName.has('arrow') && byName.get('arrow')[3] === 0.99, `arrow drag should be 0.99 (D-402, non-water), got ${byName.get('arrow') && byName.get('arrow')[3]}`);
// ⚠ ANTI-VACUITY: this pattern must be ABLE to refuse. `trident` reaches the same `bon.k()` but
// NOT as an unconditional first instruction this session verified — it must stay OUT of
// PROJECTILE_CANDIDATES, and if it is ever added without the same by-hand proof arrow/
// spectral_arrow got, this line (not a mechanism) is what has to change.
ok(!byName.has('trident'), 'trident must NOT resolve — reaching bon.k() was not proven unconditional this session (D-402 names it OWED)');

// ── PART 4 — vehicles: boat and the minecarts (G17b-4) ──────────────────────────────────────
//
// ⚠ D-309 STILL STANDS: NO NAIVE SUPERCLASS WALK. Each row below is read from the ONE class that
// holds the statement, and the leaf classes are then PROVEN not to intervene:
//   - the method is found by CONTENT (the literals it carries), never by a remembered name;
//   - every class between the entity's own and that class is checked for a declaration of the
//     SAME name+descriptor (an override, D-309 reason 1), and an override must open with an
//     unbranched `invokespecial super.<same>` call or the row is refused;
//   - the statement is on the tick path because it is in the method the tick calls: the
//     minecart's gravity is in AbstractMinecart.tick() behind only the hasNoGravity guard (the
//     server-side half; the client half interpolates), and its air drag is in moveOffRail(),
//     which tick() calls whenever the cart is not on a rail.
// ⚠ WHAT IS *NOT* CLAIMED: on a rail a minecart's motion is `moveOnRail` (slopes, powered rails,
// the 0.997 rail drag, the speed clamp) and a boat in water is buoyancy (`updateVelocity`'s
// waterLevel/0.06153846 term). The [gravity, drag] pair is the FREE-FALL law only (both types
// fall in air by exactly it); rails and water are those entities' own modules, and are not here.
const VEHICLE_MINECARTS = ['minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart',
  'tnt_minecart', 'command_block_minecart', 'spawner_minecart'];
const vehicleRows = [];
function sigWith(dump, needles) {
  const lines = dump.split('\n');
  const hit = new Map();
  for (let i = 0; i < lines.length; i++) {
    for (const n of needles) if (lines[i].includes(n)) { const s = methodAt(lines, i); if (s) hit.set(s, (hit.get(s) || new Set()).add(n)); }
  }
  return [...hit].filter(([, v]) => v.size === needles.length).map(([k]) => k);
}
/** Walk from `leaf` up to `holder`; every class that redeclares `sig` must call super first. */
function noInterventionTo(leaf, holder, sig) {
  let cls = leaf, hops = 0;
  while (cls && cls !== holder && hops < 24) {
    if (!ensure(cls)) return { ok: false, reason: `could not disassemble ${cls}` };
    if (signaturesOf(dumps.get(cls)).has(sig) && !callsSuperFirst(cls, sig, superOf(cls))) {
      return { ok: false, reason: `${cls} overrides ${sig} without an unbranched super call` };
    }
    cls = superOf(cls); hops++;
  }
  return cls === holder ? { ok: true } : { ok: false, reason: `chain from ${leaf} never reached ${holder}` };
}
/** the constant in `ldc2_w` text form, promoted floats rounded back to what the source wrote */
const lit = (t) => Number(Number(t).toPrecision(7));
function minecartLaw(leaf, holder) {
  if (!ensure(holder)) return { ok: false, reason: `${holder} does not disassemble` };
  const d = dumps.get(holder);
  // gravity: `cond ? -0.005D : -0.04D` (water : dry) written back through add(0, g, 0)
  const tickSigs = sigWith(d, ['double -0.005d', 'double -0.04d']);
  if (tickSigs.length !== 1) return { ok: false, reason: `${holder}: expected one method with the water/dry gravity pair, got ${tickSigs.length}` };
  const body = methodBody(d, tickSigs[0]).map(insn).filter(Boolean);
  const k = body.findIndex((x) => /^ldc2_w .*double -0\.005d/.test(x));
  const seq = body.slice(k, k + 5).join('|');
  // javac's `c ? A : B` is `A; goto; B; dstore` — B (the second literal) is the FALSE branch, the dry one
  if (!/^ldc2_w [^|]*double -0\.005d\|goto[^|]*\|ldc2_w [^|]*double -0\.04d\|dstore/.test(seq)) return { ok: false, reason: `${holder}: gravity ternary not in the A;goto;B;dstore shape: ${seq}` };
  const g = 0.04;
  // drag: moveOffRail scales by 0.5 (on ground, before moving) then by 0.95 (airborne, after)
  const offSigs = sigWith(d, ['double 0.5d', 'double 0.95d']).filter((s) => methodBody(d, s).length < 60);
  if (offSigs.length !== 1) return { ok: false, reason: `${holder}: expected one moveOffRail-shaped method, got ${offSigs.join(',')}` };
  const scales = methodBody(d, offSigs[0]).map(insn).filter(Boolean).filter((x) => /^ldc2_w .*double 0\.(5|95)d/.test(x)).map((x) => x.match(/double ([\d.]+)d/)[1]);
  if (scales.join() !== '0.5,0.95') return { ok: false, reason: `${holder}: moveOffRail scales ${scales.join()} != 0.5,0.95` };
  const t = noInterventionTo(leaf, holder, tickSigs[0]);
  if (!t.ok) return t;
  const o = noInterventionTo(leaf, holder, offSigs[0]);
  if (!o.ok) return o;
  return { ok: true, g, drag: 0.95, tick: tickSigs[0] };
}
{
  // AbstractMinecart is the one superclass every minecart leaf shares — found, not named
  const cartHolders = new Set();
  for (const n of VEHICLE_MINECARTS) {
    const cls = classOf.get(n);
    if (!ok(!!cls && ensure(cls), `${n} has a class`) ) continue;
    let c = cls, hops = 0;
    while (c && hops < 8) { ensure(c); if (sigWith(dumps.get(c) || '', ['double -0.005d', 'double -0.04d']).length) break; c = superOf(c); hops++; }
    if (!ok(!!c && hops < 8, `${n}: no class on the chain holds the minecart gravity pair`)) continue;
    cartHolders.add(c);
    const r = minecartLaw(cls, c);
    if (!ok(r.ok, `${n} (${cls}) minecart free-fall law via ${c}: ${r.ok ? 'g=' + r.g + ' drag=' + r.drag : r.reason}`)) continue;
    vehicleRows.push([n, cls, r.g, r.drag, `vehicle:${c}.${r.tick}+moveOffRail-G17b-4`]);
  }
  ok(cartHolders.size === 1, `all minecart leaves share ONE holder class, got ${[...cartHolders].join(',')}`);

  // boat: updateVelocity writes setVelocity(x*decay, y+g, z*decay) — g starts as
  // `hasNoGravity ? 0 : -0.04F`, and the y component is NOT multiplied by anything.
  const boatCls = classOf.get('boat');
  if (ok(!!boatCls && ensure(boatCls), 'boat has a class')) {
    const bd = dumps.get(boatCls);
    const sigs = sigWith(bd, ['double -7.0E-4d', 'double 0.009999999776482582d']);
    if (ok(sigs.length === 1, `boat: exactly one updateVelocity-shaped method, got ${sigs.length}`)) {
      const body = methodBody(bd, sigs[0]).map(insn).filter(Boolean);
      const txt0 = body.join('|');
      const sm = /invokevirtual [^|]*:\(\)Z\|ifeq[^|]*\|dconst_0\|goto[^|]*\|ldc2_w double (-0\.03999[\d]*)d\|dstore_(\d)/.exec(txt0);
      const g = sm ? lit(-sm[1]) : NaN;
      const shape = sm ? sm[0] : '';
      if (sm) sm[1] = sm[2];
      ok(!!sm && g === 0.04, `boat: gravity is the false branch of the hasNoGravity ternary (${shape})`);
      // y argument: `getfield y; dload g; dadd` and NOT followed by dmul, i.e. undamped vertically
      const txt = body.join('|');
      const yUndamped = sm && new RegExp('getfield [^|]*dpo\\.\\w+:D\\|dload_' + sm[1] + '\\|dadd\\|aload').test(txt);
      ok(!!yUndamped, 'boat: the vertical argument is y + g with NO drag factor (vertical drag = 1)');
      const t = noInterventionTo(boatCls, boatCls, sigs[0]);
      if (sm && yUndamped && g === 0.04 && t.ok) vehicleRows.push(['boat', boatCls, g, 1, 'vehicle:updateVelocity-y-undamped-G17b-4']);
    }
  }
}
for (const r of vehicleRows) byName.set(r[0], r);
ok(vehicleRows.length === VEHICLE_MINECARTS.length + 1, `${vehicleRows.length}/${VEHICLE_MINECARTS.length + 1} vehicles resolved`);
// ⚠ ANTI-VACUITY: the override test must be able to refuse. `furnace_minecart` DOES redeclare the
// tick; if `callsSuperFirst` were blind it would pass a class that never calls super.
{
  const fc = classOf.get('furnace_minecart');
  const holderSig = vehicleRows.length && (vehicleRows.find((r) => r[0] === 'minecart') || [])[4];
  ok(!!holderSig, 'anti-vacuity: minecart row exists to compare against');
  ok(!callsSuperFirst('bkz', 'no_such_method()', 'axy'), 'anti-vacuity: callsSuperFirst refuses a method the class does not declare');
  ok(fc && ensure(fc), 'anti-vacuity: furnace_minecart disassembles');
}


if (failures) { say(` ${failures} assertion(s) failed — refusing to write a table it cannot vouch for`); process.exit(1); }

const noPatternFinal = noPattern.filter((n) => !genericRows.some((r) => r[0] === n) && !projectileRows.some((r) => r[0] === n) && !vehicleRows.some((r) => r[0] === n));
const allRows = rows.concat(genericRows).concat(projectileRows).concat(vehicleRows);
const head = [
  '# entity-motion-1.18.2.tsv — generated by tools/extract-entity-motion.mjs from the 1.18.2 jar.',
  '# name\tclass\tgravity\tdrag\tsource   (per tick; drag EMPTY when only the ambiguous shape was found)',
  '# ⚠ "gravity" here means exactly one thing: the CONSTANT DOWNWARD PUSH this class adds to its',
  '# own delta movement every tick, read from the statement that writes it back. It is not a',
  '# judgement about which entities "have gravity" — it is what the code does, which is the only',
  '# thing a referee is allowed to report.',
  '# ⚠ A 5th column, "source", marks a row NOT read from its own class: "generic:axy.h()-D-390"',
  '# means the type provably does not override LivingEntity.travel() (D-387..D-390) and uses its',
  "# generic gravity/drag instead — cross-checked against Player's own independently-measured",
  '# Ph.GRAVITY/Ph.DRAG_Y. Own-class rows leave this column empty.',
  '# ⚠ ONLY the entities whose own class carries the literal, or are named generic candidates',
  '# above, are here. ' + noPatternFinal.length
    + ' types inherit their tick from an UNVERIFIED superclass and are OWED (G17c); they are NOT defaulted.',
  '# owed: ' + noPatternFinal.join(' '),
].join('\n');
writeFileSync(OUT, head + '\n' + allRows.map((r) => r.join('\t')).join('\n') + '\n');
say('');
say('============ extract-entity-motion ===========');
say(` gravities resolved . ${allRows.length}  (${allRows.map((r) => r[0] + ' ' + r[2]).join(', ')})`);
say(` drags resolved ..... ${allRows.filter((r) => r[3] !== '').length}  (${allRows.filter((r) => r[3] !== '').map((r) => r[0] + ' ' + r[3]).join(', ')})`);
say(` generic (inherited, verified) ... ${genericRows.length}  (${genericRows.map((r) => r[0]).join(', ')})`);
say(` projectile (inherited, verified) ... ${projectileRows.length}  (${projectileRows.map((r) => r[0]).join(', ')})`);
say(` owed (unverified) ... ${noPatternFinal.length}`);
say(` -> ${OUT}`);
say('==============================================');
