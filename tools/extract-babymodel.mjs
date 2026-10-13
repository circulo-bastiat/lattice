#!/usr/bin/env node
// extract-babymodel.mjs — PLAN G18e unit 2. HOW A BABY IS DRAWN, out of the BYTECODE.
//
//   node tools/extract-babymodel.mjs [--if-missing]  -> tools/golden/babymodel-1.18.2.tsv
//
// ⚠⚠ WHY THIS EXISTS. A baby in Minecraft is not "the adult, smaller". `AgeableListModel`
// splits every model into HEAD parts and BODY parts and gives the two groups DIFFERENT
// transforms — the body is scaled down and the head very often is not, which is the entire
// reason a baby cow looks like a baby cow and not like a cow seen from far away. Each model
// class passes its own six numbers to that base class in its constructor, they are compiled
// Java, and `docs/archive/QUEUE.md` row 2 asks for "the child model with the model class's own
// head-scale ratio" by name. A ratio typed in here would be one mob right and a dozen wrong.
//
// ── THE RULE, READ FROM THE BASE CLASS RATHER THAN TRANSCRIBED ──────────────────────────────
// `AgeableListModel.renderToBuffer`, when `young`, is:
//     if (scaleHead) { f = 1.5F / babyHeadScale; scale(f, f, f); }
//     translate(0, babyYHeadOffset / 16, babyZHeadOffset / 16);   headParts().forEach(render)
//     f = 1.0F / babyBodyScale; scale(f, f, f);
//     translate(0, bodyYOffset / 16, 0);                          bodyParts().forEach(render)
// Section 3 below does not trust that sentence: it reads which FIELD each of the six
// constructor arguments is stored into, then reads the render method to see which field is
// divided into 1.5F, which two are divided by 16 before the head group, and which are used for
// the body group. The MEANING of each argument is therefore derived from the bytecode too.
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ────────────────
//   1. `AgeableListModel` is the only class in the jar with BOTH a `(boolean, float, float,
//      float, float, float)` constructor AND two abstract no-argument `Iterable` methods (the
//      head-part and body-part groups). Neither half is unique on its own; together they are.
//   2. A MODEL CLASS is any class that transitively extends it. Its six values are resolved by
//      following its `super(...)` call down the constructor chain, carrying literals and
//      forwarded parameters — `QuadrupedModel` takes seven arguments and passes six of them on,
//      with an `int` widened to a `float`, so nothing here can assume the argument positions.
//   3. HEAD PARTS are the fields the head-group `Iterable` method reads, named by the string
//      literal the declaring constructor passed to `PartDefinition.getChild` before storing
//      them — the same part names `tools/extract-models.mjs` already writes.
//   4. THE LAYER IS THE ENTITY, and it is read TWICE. An entity renderer's own generic
//      supertype names both its entity class and its model class — `euy extends ewp<bij, ejd>`
//      is Cow's renderer naming Cow and CowModel — and the same renderer reads exactly one
//      `ModelLayers` field. The entity class resolves to a registry name through
//      `tools/golden/entity-types-1.18.2.tsv`, and this file asserts the two agree.
//
// ⚠ ANCHORED ON A CASE THAT CANNOT BE IN DOUBT: cow's model passes
// `(false, 10.0F, 4.0F, 2.0F, 2.0F, 24.0F)` with `head` as its only head part — a baby cow's
// head is NOT scaled and its body is halved, which is exactly what the game shows.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'babymodel-1.18.2.tsv');
const TYPES = join(MCLITE_ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const stop = () => { if (failures) { say('\n aborted'); process.exit(1); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' babymodel-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
if (!existsSync(TYPES)) { say(' SKIP — entity-types-1.18.2.tsv is missing; run extract-entities first.'); process.exit(0); }
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-baby-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);
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

// ------------------------------------------------------------ 1. the class graph
// ⚠ GENERICS ARE STRIPPED BEFORE THE `extends` IS READ. `class ekr<T extends axk> extends eim<T>`
// carries the word `extends` twice, and a regex that takes the first one records every generic
// model class as extending its own type BOUND. Nothing downstream would notice: the subclass
// walk would simply come back empty, which is a silent wrong answer.
const stripGenerics = (s) => {
  let out = '', d = 0;
  for (const ch of s) { if (ch === '<') d++; else if (ch === '>') d--; else if (d === 0) out += ch; }
  return out;
};
const sigs = javap(['-p'], all);
const superOf = new Map(), declares = new Map(), rawHead = new Map();
{
  let cur = null;
  for (const line of sigs) {
    const bare = stripGenerics(line).trim();
    const d = bare.match(/^(?:public |final |abstract |protected |static )*(?:class|interface|enum) ([\w.$]+)(?: extends ([\w.$]+))?/);
    if (d && bare.endsWith('{')) {
      cur = d[1]; superOf.set(cur, d[2] || null); declares.set(cur, []); rawHead.set(cur, line.trim()); continue;
    }
    if (cur) declares.get(cur).push(line.trim());
  }
}
const chainOf = (c) => { const out = []; let x = c; while (superOf.get(x)) { out.push(superOf.get(x)); x = superOf.get(x); } return out; };

// ------------------------------------------------------------ 2. AgeableListModel, by shape
const CTOR6 = /^protected \w[\w.$]*\(boolean, float, float, float, float, float\);$/;
const ABSTRACT_ITER = /^protected abstract java\.lang\.Iterable<[\w.$]+> \w+\(\);$/;
const baseCands = [];
for (const [cls, members] of declares) {
  if (!members.some((m) => CTOR6.test(stripGenerics(m)))) continue;
  const iters = members.filter((m) => ABSTRACT_ITER.test(m));
  if (iters.length === 2) baseCands.push([cls, iters]);
}
ok(baseCands.length === 1, baseCands.length + ' classes have a (boolean,float x5) constructor AND two abstract no-arg Iterable methods — expected exactly one (AgeableListModel)');
stop();
const [BASE] = baseCands[0];
say(' AgeableListModel ... ' + BASE);

// ------------------------------------------------------------ 3. the disassembly helpers
const codeCache = new Map();
function methodsOf(cls) {
  if (codeCache.has(cls)) return codeCache.get(cls);
  const lines = javap(['-c', '-p'], [cls]);
  const methods = [];
  let head = null, body = [];
  for (const l of lines) {
    const isHead = /^ {2}\S/.test(l) && (l.trimEnd().endsWith(');') || l.trim().startsWith('static {}'));
    if (isHead) { if (head !== null) methods.push([head, body]); head = l.trim(); body = []; continue; }
    if (head !== null) body.push(l);
  }
  if (head !== null) methods.push([head, body]);
  codeCache.set(cls, methods);
  return methods;
}
const findBody = (cls, pred) => { for (const [h, b] of methodsOf(cls)) if (pred(h, b)) return b; return null; };
const RE_PUTF = /putfield\s+#\d+\s+\/\/ Field (\w+):([\w/$;]+)/;
const RE_GETF = /getfield\s+#\d+\s+\/\/ Field (?:([\w.$]+)\.)?(\w+):([\w/$;]+)/;
const RE_STR = /ldc(?:_w)?\s+#\d+\s+\/\/ String (.+)$/;
const floatOf = (l) => {
  let m;
  if ((m = l.match(/\/\/ float (-?[\d.E]+)f?$/))) return parseFloat(m[1]);
  if ((m = l.match(/:\s+fconst_(\d)\s*$/))) return +m[1];
  if ((m = l.match(/:\s+(?:sipush|bipush)\s+(-?\d+)\s*$/))) return +m[1];
  if ((m = l.match(/:\s+iconst_(\d)\s*$/))) return +m[1];
  if ((m = l.match(/:\s+iconst_m1\s*$/))) return -1;
  return null;
};
/** The argument expressions of the ONE `invokespecial <super>.<init>` in a constructor body. */
function superCall(cls, ctorBody) {
  const args = [];
  let target = null;
  for (const l of ctorBody) {
    let m;
    if ((m = l.match(/invokespecial\s+#\d+\s+\/\/ Method ([\w.$]+)\."<init>":\(([^)]*)\)V/))) {
      target = { cls: m[1], desc: m[2] };
      break;
    }
    // ⚠ `aload_0` IS `this`, NOT AN ARGUMENT, and it is matched by the load pattern below.
    // Testing it second pushes a phantom first argument and silently shifts every value by one.
    if (/:\s+aload_0\s*$/.test(l)) continue;
    if ((m = l.match(/:\s+[fial]load(?:_(\d)|\s+(\d+))\s*$/))) { args.push({ p: +(m[1] !== undefined ? m[1] : m[2]) }); continue; }
    if (/:\s+i2f\s*$/.test(l) || /:\s+f2i\s*$/.test(l)) continue;  // a widening is not an argument
    const v = floatOf(l);
    if (v !== null) { args.push({ v: v }); continue; }
    // ⚠ `invokedynamic` (a method reference / lambda, e.g. `RenderLayer::getEntityCutoutNoCull`
    // passed straight to `AnimalModel`'s own `Function` parameter, BipedEntityModel's 1-arg
    // ctor) pushes exactly one value the SAME as `getstatic`/`ldc` do, and belongs in this same
    // catch-all. Leaving it out doesn't fail loudly — it silently drops one entry from `args`,
    // which shifts every argument AFTER it by one position in a later hop's `mapped` lookup and
    // produces a wrong six rather than no six (found resolving `BipedEntityModel`'s chain).
    if (/getstatic|new |dup|invokestatic|invokevirtual|invokedynamic|ldc/.test(l)) { args.push({ other: l.trim() }); continue; }
  }
  return target ? { target, args } : null;
}

// ------------------------------------------------------------ 3b. what the six arguments MEAN
// Read the base class's own constructor to learn which FIELD each argument lands in, then read
// its render method to learn what each field is used for. Nothing below is transcribed.
// ⚠ THE CONSTRUCTOR THAT TAKES THE SIX ARGUMENTS IS NOT THE ONE THAT STORES THEM. The
// (boolean,float x5) form delegates to a seven-argument form whose first parameter is a
// texture-layer Function, and only that one writes the fields. Reading the delegating form
// finds six parameters and zero putfields, which is a silent empty answer.
const baseCtor = findBody(BASE, (h, b) => /"<init>"|^protected \w/.test(h)
  && b.filter((l) => RE_PUTF.test(l)).length === 6);
ok(!!baseCtor, 'could not isolate the ' + BASE + ' constructor that STORES the six fields');
stop();
const argField = [];            // constructor parameter index -> field name
{
  let pend = null;
  for (const l of baseCtor) {
    let m;
    if ((m = l.match(/:\s+[fi]load(?:_(\d)|\s+(\d+))\s*$/))) { pend = +(m[1] !== undefined ? m[1] : m[2]); continue; }
    if ((m = l.match(RE_PUTF)) && pend !== null) { argField[pend] = m[1]; pend = null; }
  }
}
const sixFields = argField.map((f, i) => [i, f]).filter(([, f]) => f).sort((a, b) => a[0] - b[0]).map(([, f]) => f);
ok(sixFields.length === 6, 'the storing constructor writes ' + sixFields.length + ' fields from parameters, not six');
stop();

const renderBody = findBody(BASE, (h, b) => /^public void \w+\(/.test(h) && b.some((l) => floatOf(l) === 1.5));
ok(!!renderBody, 'could not isolate ' + BASE + '\'s render method (no 1.5f)');
stop();
// walk it: the field divided INTO 1.5 is the head scale; the two fields divided by 16 before the
// first group call are the head offsets; after the body scale, the one divided by 16 is bodyYOffset
const role = {};                 // field -> role
{
  let pendFloat = null, pendField = null, seenHeadGroup = false, bodyScaleSeen = false;
  for (const l of renderBody) {
    let m;
    const v = floatOf(l);
    if (v !== null) { pendFloat = v; continue; }
    if ((m = l.match(RE_GETF))) { pendField = m[2]; continue; }
    if (/:\s+fdiv\s*$/.test(l)) {
      if (pendFloat === 1.5 && pendField) role[pendField] = 'babyHeadScale';
      else if (pendFloat === 16 && pendField) role[pendField] = seenHeadGroup ? 'bodyYOffset' : (role.__firstOffset ? 'babyZHeadOffset' : 'babyYHeadOffset');
      else if (pendFloat === 1 && pendField) { role[pendField] = 'babyBodyScale'; bodyScaleSeen = true; }
      if (pendFloat === 16 && !seenHeadGroup) role.__firstOffset = true;
      pendFloat = null; pendField = null; continue;
    }
    if (/invokevirtual.*Iterable|invokevirtual\s+#\d+\s+\/\/ Method \w+:\(\)Ljava\/lang\/Iterable;/.test(l)) {
      if (!seenHeadGroup) seenHeadGroup = true;
    }
  }
  delete role.__firstOffset;
  // the boolean is the only field never divided: it is the `scaleHead` gate
  const boolField = sixFields.find((f) => !role[f]);
  if (boolField) role[boolField] = 'scaleHead';
}
const ROLE_OF_ARG = sixFields.map((f) => role[f] || '?');
ok(ROLE_OF_ARG.join(',') === 'scaleHead,babyYHeadOffset,babyZHeadOffset,babyHeadScale,babyBodyScale,bodyYOffset',
  'the six arguments resolved to ' + ROLE_OF_ARG.join(',') + ' — the render walk disagrees with the constructor walk');
stop();
say(' argument roles ..... ' + ROLE_OF_ARG.join(' '));

// the two abstract group methods: which is head, which is body — by ORDER OF CALL in render
const groupCalls = [];
for (const l of renderBody) {
  const m = l.match(/invokevirtual\s+#\d+\s+\/\/ Method (\w+):\(\)Ljava\/lang\/Iterable;/);
  if (m) groupCalls.push(m[1]);
}
ok(groupCalls.length >= 2, 'the render method calls ' + groupCalls.length + ' group methods — expected two');
stop();
const HEAD_GROUP = groupCalls[0], BODY_GROUP = groupCalls[1];
say(' groups ............. head=' + HEAD_GROUP + '() body=' + BODY_GROUP + '()');

// ------------------------------------------------------------ 4. every model class's six values
const models = all.filter((c) => chainOf(c).includes(BASE));
ok(models.length > 20, 'only ' + models.length + ' model classes extend ' + BASE);
stop();
say(' model classes ...... ' + models.length);

/** The JVM descriptor's own parameter TYPES, in order — `Z`,`F`,`I`,... or `Lclass;`. */
function paramTypes(desc) {
  return desc.match(/\[*(?:[ZFIJDBCS]|L[^;]+;)/g) || [];
}
/** JVM descriptor arg count — `Z`,`F`,`I`,... and `Lclass;` each count once, `[` is skipped. */
function descArgCount(desc) { return paramTypes(desc).length; }
/**
 * The mapped call arguments at the positions the descriptor itself says are `Z` or `F` —
 * `AnimalModel`'s six are always boolean-then-five-floats, but the SEVEN-parameter storing
 * form's leading `Function` argument (a lambda, `RenderLayer::getEntityCutoutNoCull` — or, one
 * hop up the chain, a plain parameter FORWARDING that same lambda, e.g. `BipedEntityModel`'s own
 * two-arg constructor) is not one of the six and must not be counted as if it were. Selecting by
 * the descriptor's own type at each position, rather than "however many values `mapped` has",
 * is what keeps the Function argument out regardless of whether ITS value happens to be known.
 */
function primitiveSlots(desc, mapped) {
  const types = paramTypes(desc), out = [];
  for (let i = 0; i < types.length; i++) {
    if ((types[i] === 'Z' || types[i] === 'F') && mapped[i] !== undefined) out.push(mapped[i]);
  }
  return out;
}
/** The header's own Java-level parameter count, generics stripped first (a `Function<A,B>` is
 *  one parameter whose comma lives inside `<>` — `stripGenerics` erases it before the split). */
function headerArgCount(header) {
  const b = stripGenerics(header).trim();
  const m = b.match(/\(([^)]*)\)/);
  if (!m) return null;
  const inner = m[1].trim();
  return inner === '' ? 0 : inner.split(',').length;
}

/**
 * Resolve a model class's six base-constructor values, following the `super`/`this` chain.
 *
 * ⚠⚠ **`AnimalModel` OWNS FOUR OVERLOADS OF ITSELF, NOT ONE** (Yarn: `AnimalModel`; this file's
 * `BASE`). `AnimalModel(Z,F,F)` defaults the last three to `(2,2,24)`; `AnimalModel()` defaults
 * to `(false,5,2)` and THEN falls into the three-arg form; only the seven-arg
 * `(Function,Z,F,F,F,F,F)` form actually STORES the six fields (`baseCtor`, section 3). A
 * subclass that calls a SHORTER overload — chicken's parameterless `ChickenEntityModel(ModelPart)`
 * calls `AnimalModel()` by omission, wolf's own ctor omits `super()` entirely and so calls
 * `TintableAnimalModel`'s COMPILER-GENERATED no-arg constructor, which itself falls through to
 * `AnimalModel()` — was being treated as a DEAD END the moment `call.target.cls === BASE`, no
 * matter which overload was actually reached: a call to the THREE-arg or ZERO-arg form landed on
 * `BASE` too, produced fewer than six mapped values, and returned `null` instead of continuing
 * the walk one more hop INTO that overload's own body. The fix is to require the specific
 * overload that STORES the six fields (seven JVM parameters: the `Function` plus six), and
 * otherwise treat a call to `BASE` exactly like a call to any other ancestor — hop again, with
 * the ctor selected by matching PARAMETER COUNT (`wantArity`) rather than "whichever constructor
 * this class happens to declare first", since `BASE` alone has four constructors of four
 * different arities and picking the wrong one silently mixes their argument lists.
 */
function sixOf(cls) {
  let cur = cls, args = null, wantArity = null;
  for (let hop = 0; hop < 10; hop++) {
    let ctors = methodsOf(cur).filter(([h]) => {
      const b = stripGenerics(h);
      return new RegExp('^(?:public |protected |private )?' + cur.replace(/\$/g, '\\$') + '\\(').test(b);
    });
    if (wantArity !== null) {
      // narrow to the overload the PREVIOUS hop's invokespecial actually targeted; when nothing
      // narrows (a class with only one ctor, the common case) keep the unfiltered list.
      const narrowed = ctors.filter(([h]) => headerArgCount(h) === wantArity);
      if (narrowed.length) ctors = narrowed;
    }
    let call = null;
    for (const [, body] of ctors) { const c = superCall(cur, body); if (c) { call = c; break; } }
    if (!call) return null;
    // map this call's arguments through whatever the caller's own arguments were
    const mapped = call.args.map((a) => {
      if (a.v !== undefined) return a;
      if (a.p !== undefined && args) return args[a.p] !== undefined ? args[a.p] : { unknown: true };
      if (a.p !== undefined) return { p: a.p };
      return { unknown: true };
    });
    // A call to BASE (`AnimalModel`) is a candidate finalizer, but not automatically one: THREE
    // of `AnimalModel`'s four constructors also call `this(...)` right back into `AnimalModel`
    // itself (the zero-arg and three-arg forms), and only the true six get selected here — by
    // the DESCRIPTOR'S OWN TYPES at each position (`primitiveSlots`), not by how many values
    // `mapped` happens to hold. A short overload (0 or 3 primitive slots) is not a dead end
    // either: it falls through to the ordinary hop below, same as a call to any other class.
    if (call.target.cls === BASE) {
      const vals = primitiveSlots(call.target.desc, mapped);
      if (vals.length === 6) return vals;
    }
    // index the mapped arguments by the SUPER/THIS constructor's parameter slot (1-based,
    // long/double would take two — none here) so the next hop can look them up by `p`
    const byParam = [];
    mapped.forEach((a, i) => { byParam[i + 1] = a; });
    args = byParam;
    wantArity = descArgCount(call.target.desc);
    cur = call.target.cls;
  }
  return null;
}

/**
 * The part names the head group reads, from whichever ancestor declares a CONCRETE override —
 * not necessarily `protected`: `HorseEntityModel` widens it to `public` (its own baby handling
 * needs `getHeadParts` visible from `HorseBaseEntityRenderer`), and the original `protected`-only
 * regex here skipped straight past horse's own override to the abstract declaration in `BASE`,
 * which has no body at all (`:headGroup`, the docstring in 07j names this exact case).
 * ⚠ ZERO FIELDS READ IS A VALID ANSWER, NOT A FAILURE TO FIND ONE — axolotl's and bee's own
 * `getHeadParts()` return `ImmutableList.of()`: the whole model is one `body` group and there is
 * no separate head scale to apply (a fact this function must pass through, not paper over; see
 * the `:partNames` distinction where this is called).
 */
function headPartsOf(cls) {
  let cur = cls;
  for (let hop = 0; hop < 8 && cur; hop++) {
    const pair = methodsOf(cur).find(([h]) => {
      const b = stripGenerics(h).trim();
      return new RegExp('^(?:public|protected) java\\.lang\\.Iterable<[\\w.$]+> ' + HEAD_GROUP + '\\(\\);$').test(b)
        && !/\babstract\b/.test(b);
    });
    if (pair) return { owner: cur, fields: pair[1].map((l) => l.match(RE_GETF)).filter(Boolean).map((m) => m[2]) };
    cur = superOf.get(cur);
  }
  return null;
}
/** field -> the string literal stored into it by the declaring class's constructor. */
function partNames(cls) {
  const out = new Map();
  let lastStr = null;
  for (const [h, body] of methodsOf(cls)) {
    if (!new RegExp('^(?:public |protected |private )?' + cls.replace(/\$/g, '\\$') + '\\(').test(stripGenerics(h))) continue;
    for (const l of body) {
      let m;
      if ((m = l.match(RE_STR))) { lastStr = m[1]; continue; }
      if ((m = l.match(RE_PUTF))) { if (lastStr !== null) out.set(m[1], lastStr); lastStr = null; }
    }
  }
  return out;
}

// ------------------------------------------------------------ 5. the layer, from the renderer
// An entity renderer's own generic supertype names BOTH its entity class and its model class.
const namesByClass = new Map();
for (const l of readFileSync(TYPES, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const p = l.split('\t');
  if (p.length >= 7 && p[6]) namesByClass.set(p[6].trim(), p[0]);
}
const modelOfEntity = new Map();
for (const [cls, head] of rawHead) {
  const m = head.match(/extends [\w.$]+<\s*([\w.$]+)\s*,\s*([\w.$]+)(?:<[^>]*>)?\s*>/);
  if (!m) continue;
  const ent = m[1], mod = m[2];
  if (!namesByClass.has(ent) || !models.includes(mod)) continue;
  if (!modelOfEntity.has(ent)) modelOfEntity.set(ent, { model: mod, renderer: cls });
}
say(' entity->model ...... ' + modelOfEntity.size + ' pairs read off renderer generic supertypes');
ok(modelOfEntity.size >= 10, 'only ' + modelOfEntity.size + ' renderers named both an entity and an ageable model');
stop();

// ⚠⚠ **THE MODEL HAVING THE PLUMBING IS NOT THE SAME FACT AS THE MOB EVER USING IT.**
// `EndermanEntityModel`, `GiantEntityModel` and `VexEntityModel` all extend `BipedEntityModel`
// (`GiantEntityModel` via `AbstractZombieModel`, same as zombie) and resolve a full, valid six
// values the same way zombie's own does — but `sixOf`/`headPartsOf` only read the MODEL. Whether
// the child branch (`AnimalModel.render`'s `if (this.child)`) ever actually RUNS for a mob is a
// fact about the ENTITY: `LivingEntityRenderer` sets `this.model.child = entity.isBaby()`
// (net/minecraft/client/render/entity/LivingEntityRenderer.java), and `LivingEntity.isBaby()`
// is `return false;` UNCONDITIONALLY unless the entity class overrides it. `EndermanEntity`,
// `GiantEntity` and `VexEntity` declare no such override (`grep -rl "public boolean isBaby()"
// .decomp/net/minecraft/entity/` finds `LivingEntity`, `PassiveEntity` (real animals, breeding-
// age-driven), `ZombieEntity` (`return this.getDataTracker().get(BABY);` — a baby zombie is a
// real spawned variant) and `ArmorStandEntity` (`return this.isSmall();` — a small stand takes
// the SAME child branch as a baby mob) but NOT enderman, giant or vex) — so `model.child` is
// always false for those three and the six values this file could resolve for them are correct
// but dead code. They are named here rather than silently rostered with a row nothing will ever
// read, matching `ER.BABY_OWED`'s own ruling for them (07j_entityrender.js).
const NOT_BABYABLE = {
  enderman: 'EndermanEntity extends HostileEntity, no isBaby() override (net/minecraft/entity/mob/EndermanEntity.java)',
  giant: 'GiantEntity extends HostileEntity, no isBaby() override (net/minecraft/entity/mob/GiantEntity.java)',
  vex: 'VexEntity extends HostileEntity, no isBaby() override (net/minecraft/entity/mob/VexEntity.java)'
};
const ruled = [];

const rows = [], skipped = [];
for (const [ent, info] of [...modelOfEntity].sort((a, b) => namesByClass.get(a[0]).localeCompare(namesByClass.get(b[0])))) {
  const layerName = namesByClass.get(ent);
  if (NOT_BABYABLE[layerName]) { ruled.push(layerName + ' — ' + NOT_BABYABLE[layerName]); continue; }
  const six = sixOf(info.model);
  if (process.env.BABY_DEBUG) console.log('DBG', namesByClass.get(ent), info.model, JSON.stringify(six));
  // ⚠ THE SHORTFALL IS NAMED, NOT HIDDEN (the same rule extract-models.mjs's own 82-of-155
  // follows). A model whose constructor builds its six values rather than passing literals —
  // or whose head group is assembled by a helper — is LISTED as unread, so the day one of
  // those mobs is rostered it is a question somebody answers rather than a wrong baby.
  if (!six || six.some((a) => a.v === undefined)) { skipped.push(namesByClass.get(ent) + ':six'); continue; }
  const hp = headPartsOf(info.model);
  if (!hp) { skipped.push(namesByClass.get(ent) + ':headGroup'); continue; }
  const names = partNames(hp.owner);
  const parts = hp.fields.map((f) => names.get(f)).filter(Boolean);
  // ⚠ `hp.fields.length === 0` (axolotl, bee — see `headPartsOf`) is a READ, not a MISS: the
  // model concretely declared zero head parts. Only `fields.length > 0 && parts.length === 0`
  // (getfield targets found but none of them traced to a string-literal part name) is the real
  // `:partNames` failure this skip exists for.
  if (hp.fields.length && !parts.length) { skipped.push(namesByClass.get(ent) + ':partNames'); continue; }
  rows.push({
    layer: namesByClass.get(ent), ent, model: info.model, renderer: info.renderer,
    scaleHead: six[0].v ? 1 : 0,
    babyYHeadOffset: six[1].v, babyZHeadOffset: six[2].v,
    babyHeadScale: six[3].v, babyBodyScale: six[4].v, bodyYOffset: six[5].v,
    headParts: parts
  });
}
say(' rows ............... ' + rows.length + '  (' + skipped.length + ' unread: ' + skipped.join(' ') + ', '
    + ruled.length + ' ruled not-babyable: ' + ruled.map((r) => r.split(' — ')[0]).join(' ') + ')');

// the anchor that cannot be in doubt
const cow = rows.find((r) => r.layer === 'cow');
ok(!!cow, 'cow has no row — the entity->model link is wrong');
ok(cow && cow.scaleHead === 0 && cow.babyYHeadOffset === 10 && cow.babyZHeadOffset === 4
   && cow.babyHeadScale === 2 && cow.babyBodyScale === 2 && cow.bodyYOffset === 24
   && cow.headParts.join(',') === 'head',
  'cow is ' + JSON.stringify(cow) + ' — expected (false, 10, 4, 2, 2, 24) with head as its only head part');
// QUEUE 0.2 (baby remainder) — the two hardest cases the generalized `sixOf`/`headPartsOf` walk
// was built for, anchored so a regression in the ctor-chain hop or the public-override read
// breaks the build instead of silently reverting to `:six`/`:headGroup`.
const axolotl = rows.find((r) => r.layer === 'axolotl');
ok(!!axolotl, 'axolotl has no row — the AnimalModel(Z,F,F) short-ctor hop regressed');
ok(axolotl && axolotl.scaleHead === 1 && axolotl.babyYHeadOffset === 8 && axolotl.babyZHeadOffset === 3.35
   && axolotl.babyHeadScale === 2 && axolotl.babyBodyScale === 2 && axolotl.bodyYOffset === 24
   && axolotl.headParts.length === 0,
  'axolotl is ' + JSON.stringify(axolotl) + ' — expected (true, 8, 3.35, 2, 2, 24) with NO head parts '
  + '(AxolotlEntityModel.getHeadParts() returns ImmutableList.of())');
const horse = rows.find((r) => r.layer === 'horse');
ok(!!horse, 'horse has no row — the public getHeadParts() override was not read');
ok(horse && horse.scaleHead === 1 && horse.babyYHeadOffset === 16.2 && horse.babyZHeadOffset === 1.36
   && horse.babyHeadScale === 2.7272 && horse.babyBodyScale === 2 && horse.bodyYOffset === 20
   && horse.headParts.join(',') === 'head_parts',
  'horse is ' + JSON.stringify(horse) + ' — expected (true, 16.2, 1.36, 2.7272, 2, 20) with head_parts');
const zombie = rows.find((r) => r.layer === 'zombie');
ok(!!zombie, 'zombie has no row — the Zombie->AbstractZombieModel->BipedEntityModel(1)->(2)->BASE hop regressed');
ok(zombie && zombie.scaleHead === 1 && zombie.babyYHeadOffset === 16 && zombie.babyZHeadOffset === 0
   && zombie.babyHeadScale === 2 && zombie.babyBodyScale === 2 && zombie.bodyYOffset === 24
   && zombie.headParts.join(',') === 'head',
  'zombie is ' + JSON.stringify(zombie) + ' — expected BipedEntityModel\'s own (true, 16, 0, 2, 2, 24)');
ok(rows.length >= 20, 'only ' + rows.length + ' rows resolved (expected the original 10 plus the QUEUE 0.2 remainder)');
ok(ruled.length === 3, ruled.length + ' rulings, expected exactly enderman, giant, vex');
stop();

mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
const out = [];
out.push('# babymodel-1.18.2.tsv — generated by tools/extract-babymodel.mjs from the 1.18.2 jar.');
out.push('# ⚠ NOTHING HERE IS TYPED IN, INCLUDING WHAT THE COLUMNS MEAN: the six arguments were');
out.push('#   matched to their roles by reading which field each one lands in and what the base');
out.push('#   class\'s own render method then divides it by.  base=' + BASE);
out.push('# THE RULE (AgeableListModel.renderToBuffer, when young):');
out.push('#   head group: if scaleHead, scale by 1.5 / babyHeadScale; then translate');
out.push('#               (0, babyYHeadOffset/16, babyZHeadOffset/16) in BLOCKS');
out.push('#   body group: scale by 1 / babyBodyScale; then translate (0, bodyYOffset/16, 0)');
out.push('#   A poseStack scale followed by a translate means the offset is SCALED TOO:');
out.push('#   a point p ends at s * (p + t), not s * p + t.');
out.push('# UNREAD, and named rather than guessed: ' + (skipped.join(' ') || 'none') + '.');
out.push('#   `:six` = its constructor does not pass six literals up; `:headGroup` = its head');
out.push('#   group is not a plain field list; `:partNames` = its parts are not named by a literal.');
out.push('# RULED NOT BABYABLE, and named rather than omitted silently: ' + (ruled.map((r) => r.split(' — ')[0]).join(' ') || 'none') + '.');
out.push('#   the MODEL resolves fine (BipedEntityModel plumbing) but the ENTITY never reports');
out.push('#   isBaby() true (LivingEntity.isBaby() == false, no override) — see this file\'s own');
out.push('#   NOT_BABYABLE citations.');
out.push('# layer\tentityClass\tmodelClass\trenderer\tscaleHead\tbabyYHeadOffset\tbabyZHeadOffset\tbabyHeadScale\tbabyBodyScale\tbodyYOffset\theadParts');
for (const r of rows) {
  out.push([r.layer, r.ent, r.model, r.renderer, r.scaleHead, r.babyYHeadOffset, r.babyZHeadOffset,
            r.babyHeadScale, r.babyBodyScale, r.bodyYOffset, r.headParts.join(',')].join('\t'));
}
writeFileSync(OUT, out.join('\n') + '\n');
say(' wrote .............. ' + OUT);
