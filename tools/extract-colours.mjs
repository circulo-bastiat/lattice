#!/usr/bin/env node
// extract-colours.mjs — vanilla's DYE COLOURS and its FLOWER→EFFECT map, read out of the
// 1.18.2 client jar's BYTECODE.
//
//   node tools/extract-colours.mjs [--if-missing]   -> tools/golden/dye-colours-1.18.2.tsv
//                                                   -> tools/golden/flower-effects-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. G9 has five `crafting_special_*` recipes that cannot be implemented from
// data at all, because the numbers they need are compiled Java — in no JSON, in no
// `minecraft-data` file, in no tag and in no recipe:
//
//   crafting_special_armordye        blends `DyeColor.getTextureDiffuseColors()` into leather
//   crafting_special_firework_star   writes `DyeColor.getFireworkColor()` into the star NBT
//   crafting_special_firework_star_fade   the same, as the fade list
//   crafting_special_firework_rocket      carries those stars
//   crafting_special_suspiciousstew  writes the FLOWER's MobEffect and duration into the stew
//
// Inventing plausible RGB values is the one unacceptable outcome here: leather armour, banners,
// maps, fireworks and every dyed block would all be subtly the wrong colour forever, and nothing
// would ever notice. Crafting and item behaviour are ABSOLUTE FULL PARITY under the charter, so
// these get generated tables with the same standing as `fuel-1.18.2.tsv`.
//
// ⚠ AND IT NEEDS NO MAPPINGS, exactly as D-263 established. Mojang's mapping host is outside this
// container's egress allowlist, so the obfuscated jar is read STRUCTURALLY. Nothing below trusts
// a name:
//
//   1. `Items` is the class with 1000-1200 static finals of one Item type; `Blocks` is the class
//      with 850-1000 static finals of one Block type. (The technique `extract-fuel.mjs`,
//      `extract-equipment.mjs` and `extract-materials.mjs` already use.)
//   2. `DyeColor` is IDENTIFIED BY USE, not by shape. FIVE classes in the jar are enums with
//      exactly sixteen constants of their own type, so "an enum with 16 constants" finds nothing.
//      Exactly ONE of the five is read by the `Items` class — sixteen times, once per dye item —
//      and that is `DyeColor`. Section 3 asserts the candidate set narrows to one.
//   3. The per-colour ints are LABELLED BY ANCHOR, not by position. The enum constructor takes
//      several ints and their order is not something a reading of obfuscated bytecode can assert.
//      So section 5 finds which int SLOT carries 16383998 for white, 1908001 for black and
//      11546150 for red — that slot is `textureDiffuseColor` — and which slot carries 15790320
//      for white — that slot is `fireworkColor`. The slot that equals the ordinal is `id`. What
//      is left is `textColor`, and section 6 then asserts the labelling in BOTH directions over
//      eight more colours, on values a player would notice.
//   4. `MaterialColor` is whatever non-int, non-String type that same constructor takes; its own
//      `<clinit>` is `new MaterialColor(id, rgb)` sixty-odd times, so each dye's map/banner colour
//      comes out as a number too.
//   5. `FlowerBlock` is the ONLY class in all of `Blocks.<clinit>` constructed through a
//      `(Object, int, Object)` constructor — twelve times. Its first argument is always a
//      `getstatic` from one holder class, and that holder is `MobEffects`. The duration is the
//      `int`, in SECONDS.
//   6. `WitherRoseBlock` is found as the subclass: the one other class in `Blocks.<clinit>` whose
//      constructor's first parameter is the same MobEffect type. It has NO int — its duration is
//      a literal inside its own `<init>`, which delegates to `FlowerBlock`'s. It is read from
//      there, not assumed.
//   7. Effects are named from `MobEffects.<clinit>`'s own string literals, each preceded by the
//      effect's numeric id. Flowers are named from `Blocks.<clinit>`'s string literals.
//
// ⚠ DURATIONS ARE SECONDS, not ticks. `SuspiciousStewItem` multiplies by 20 at eat time. The
// table writes what the bytecode holds and names the unit in its header; a consumer multiplies.
//
// ⚠ THIRTEEN FLOWERS, not eleven. The four tulips are four separate blocks that happen to share
// weakness/9s, and wither_rose is the thirteenth through the subclass of section 6.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DYE = join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv');
const OUT_FLOWER = join(MCLITE_ROOT, 'tools', 'golden', 'flower-effects-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const die = () => { if (failures) { say('\n x ' + failures + ' failures - NEITHER file written'); process.exit(1); } };

// ⚠ `tools/golden/` IS GITIGNORED (D-6 — it is Mojang's compiled code), so these are required
// inputs a fresh clone does not have, exactly like `fuel-1.18.2.tsv`. The suite runs this stage
// with `--if-missing`, a no-op when both tables are already there.
if (process.argv.includes('--if-missing') && existsSync(OUT_DYE) && existsSync(OUT_FLOWER)) {
  say(' dye-colours-1.18.2.tsv and flower-effects-1.18.2.tsv are present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSVs.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-colours-'));
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

  // ------------------------------------------------------------ 1. the jar's shape, once
  const sigs = javap(['-p'], all);
  let cur = null;
  const plainCount = new Map();   // "<class> <type>" -> n static finals of that type
  const selfCount = new Map();    // <class> -> n static finals of its OWN type
  const isEnum = new Map();       // <class> -> extends java.lang.Enum<self>
  const superOf = new Map();      // <class> -> superclass, or null
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && line.trimEnd().endsWith('{')) {
      cur = d[1];
      isEnum.set(cur, /extends java\.lang\.Enum</.test(line));
      const s = line.match(/ extends ([\w.$]+)/);
      superOf.set(cur, s && !/^java\.lang\.Enum$/.test(s[1]) ? s[1] : null);
      continue;
    }
    if (!cur) continue;
    const f = line.match(/static final ([\w.$[\]]+) /);
    if (!f) continue;
    if (f[1] === cur) selfCount.set(cur, (selfCount.get(cur) || 0) + 1);
    const k = cur + ' ' + f[1];
    plainCount.set(k, (plainCount.get(k) || 0) + 1);
  }
  const pick = (lo, hi, what) => {
    const c = [...plainCount].filter(([, n]) => n >= lo && n <= hi).sort((a, b) => b[1] - a[1])[0];
    ok(!!c, 'no ' + what + ' candidate: no class with ' + lo + '-' + hi + ' static finals of one type');
    return c;
  };
  const itemsCand = pick(1000, 1200, 'Items');
  const blocksCand = pick(850, 1000, 'Blocks');
  die();
  const [ITEMS, ITEMTYPE] = itemsCand[0].split(' ');
  const [BLOCKS, BLOCKTYPE] = blocksCand[0].split(' ');
  say(' Items class ........ ' + ITEMS + ' of ' + ITEMTYPE + ' (' + itemsCand[1] + ' fields)');
  say(' Blocks class ....... ' + BLOCKS + ' of ' + BLOCKTYPE + ' (' + blocksCand[1] + ' fields)');

  // ------------------------------------------------------------ 2. a tiny bytecode reader
  // Every constant table in this jar has the same shape:
  //     new C; dup; <operands...>; invokespecial C."<init>":(desc); putstatic F:LC;
  // so one walker reads DyeColor, MaterialColor, MobEffects, Blocks and FlowerBlock alike.
  const RE_STR = /ldc(?:_w)?\s+#\d+\s+\/\/ String (.*)$/;
  const RE_INT = /:\s+(?:ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+)|sipush\s+(-?\d+)|bipush\s+(-?\d+)|iconst_(m?\d))\s*$/;
  const RE_GET = /getstatic\s+#\d+\s+\/\/ Field (?:([\w$]+)\.)?([\w$]+):L([\w$/]+);/;
  const RE_NEW = /new\s+#\d+\s+\/\/ class "?([\w$/]+)"?\s*$/;
  const RE_INIT = /invokespecial\s+#\d+\s+\/\/ Method (?:([\w$]+)\.)?"<init>":(\(([^)]*)\)V)/;
  const RE_PUT = /putstatic\s+#\d+\s+\/\/ Field ([\w$]+):L([\w$/]+);/;

  const intOf = (l) => {
    const m = l.match(RE_INT);
    if (!m) return null;
    if (m[1] !== undefined) return +m[1];
    if (m[2] !== undefined) return +m[2];
    if (m[3] !== undefined) return +m[3];
    return m[4][0] === 'm' ? -(+m[4].slice(1)) : +m[4];
  };
  /** split a JVM method descriptor's parameter list into type tokens. */
  const params = (desc) => {
    const out = []; let i = 0;
    while (i < desc.length) {
      if (desc[i] === 'L') { const j = desc.indexOf(';', i); out.push(desc.slice(i, j + 1)); i = j + 1; }
      else if (desc[i] === '[') { let j = i; while (desc[j] === '[') j++; if (desc[j] === 'L') j = desc.indexOf(';', j); out.push(desc.slice(i, j + 1)); i = j + 1; }
      else { out.push(desc[i]); i++; }
    }
    return out;
  };
  const clinitOf = (cls) => {
    const lines = javap(['-c', '-p'], [cls]);
    const i = lines.findIndex((l) => l.trim().startsWith('static {}'));
    ok(i >= 0, cls + ' has no <clinit>');
    return lines.slice(i < 0 ? 0 : i);
  };
  /**
   * Walk a <clinit> and return every `new C(...)` that is stored into a static field, with its
   * operands in source order and typed by the constructor descriptor. Operands are
   * {int:n} | {str:s} | {field:[class,name,type]}. Anything not recognised becomes {op:line},
   * which keeps a builder chain from silently shifting the positional args.
   */
  // ⚠ The `putstatic` does NOT always follow the `<init>` directly. `DyeColor` and `MaterialColor`
  // store the new object straight away, but `Blocks.<clinit>` passes it through `register(name, b)`
  // first and the field it lands in is typed `Block`, not the concrete subclass. So the
  // construction is recorded AT the `<init>` and the field name is attached at whatever
  // `putstatic` comes next — which is why `field` is a separate step below and not a guard.
  const constructions = (lines, ofClass) => {
    const out = [];
    let cls = null, ops = [], depth = 0, pending = null;
    for (const l of lines) {
      let m;
      if ((m = l.match(RE_NEW))) {
        const c = m[1].replace(/\//g, '.');
        if (cls === null) { cls = c; ops = []; depth = 0; }
        else depth++;                              // a nested `new` inside the argument list
        continue;
      }
      if ((m = l.match(RE_PUT))) {
        if (pending && pending.field === null) { pending.field = m[1]; pending.fieldType = m[2].replace(/\//g, '.'); }
        pending = null; cls = null; ops = []; depth = 0;
        continue;
      }
      if (cls === null) continue;
      if (/:\s+dup\s*$/.test(l)) continue;
      if ((m = l.match(RE_INIT))) {
        if (depth > 0) { depth--; ops.push({ op: l.trim() }); continue; }
        pending = { field: null, fieldType: null, cls, desc: m[3], params: params(m[3]), ops };
        out.push(pending);
        cls = null; ops = []; depth = 0;
        continue;
      }
      if ((m = l.match(RE_STR))) { ops.push({ str: m[1] }); continue; }
      const v = intOf(l); if (v !== null) { ops.push({ int: v }); continue; }
      if ((m = l.match(RE_GET))) { ops.push({ field: [m[1] || null, m[2], m[3].replace(/\//g, '.')] }); continue; }
      ops.push({ op: l.trim() });
    }
    return out.filter((c) => !ofClass || c.cls === ofClass);
  };

  // ------------------------------------------------------------ 3. DyeColor, BY USE
  // ⚠ FIVE classes are enums with exactly sixteen constants of their own type. Counting
  // constants finds all five and picks the wrong one four times in five. The `Items` class reads
  // exactly one of them — once per dye item — so USE is what separates them.
  const enum16 = [...selfCount].filter(([c, n]) => n === 16 && isEnum.get(c)).map(([c]) => c);
  say(' enums with 16 constants: ' + enum16.join(' ') + ' (' + enum16.length + ')');
  ok(enum16.length >= 1, 'no enum in the jar has exactly 16 constants of its own type');
  die();
  const itemsCode = javap(['-c', '-p'], [ITEMS]);
  const readByItems = enum16.map((c) => {
    const re = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + c.replace(/\$/g, '\\$') + '\\.\\w+:L' + c.replace(/\$/g, '\\$') + ';');
    return [c, itemsCode.filter((l) => re.test(l)).length];
  }).filter(([, n]) => n > 0);
  ok(readByItems.length === 1,
    readByItems.length + ' of the ' + enum16.length + ' sixteen-constant enums are read by '
    + ITEMS + ' — expected exactly one (DyeColor)');
  die();
  const DYE = readByItems[0][0];
  ok(readByItems[0][1] === 16,
    ITEMS + ' reads ' + readByItems[0][1] + ' constants of ' + DYE + ' — expected 16, one per dye item');
  say(' DyeColor class ..... ' + DYE + '  (read ' + readByItems[0][1] + 'x by ' + ITEMS + ')');

  // ------------------------------------------------------------ 4. read the sixteen constants
  const dyeCons = constructions(clinitOf(DYE), DYE);
  ok(dyeCons.length === 16, dyeCons.length + ' constants parsed out of ' + DYE + '.<clinit> — expected 16');
  die();
  // The javac-synthesised enum constructor is (String name, int ordinal, ...declared params).
  const DESCS = new Set(dyeCons.map((c) => c.desc));
  ok(DESCS.size === 1, DYE + '.<clinit> uses ' + DESCS.size + ' distinct constructors — expected one');
  const P = dyeCons[0].params;
  ok(P.length >= 2 && P[0] === 'Ljava/lang/String;' && P[1] === 'I',
    DYE + "'s constructor does not start (String,int) — it is not a javac enum constructor");
  die();
  for (const c of dyeCons) {
    ok(c.ops.length === P.length,
      DYE + '.' + c.field + ' pushed ' + c.ops.length + ' operands for ' + P.length + ' parameters');
    ok(!c.ops.some((o) => o.op), DYE + '.' + c.field + ' has an operand this reader did not understand: '
      + JSON.stringify(c.ops.find((o) => o.op)));
  }
  die();
  // the declared parameters, in order, with the synthetic (name, ordinal) pair stripped
  const SLOTS = P.slice(2);
  const INTSLOTS = SLOTS.map((t, i) => [t, i]).filter(([t]) => t === 'I').map(([, i]) => i);
  const STRSLOTS = SLOTS.map((t, i) => [t, i]).filter(([t]) => t === 'Ljava/lang/String;').map(([, i]) => i);
  const OBJSLOTS = SLOTS.map((t, i) => [t, i]).filter(([t]) => t !== 'I' && t !== 'Ljava/lang/String;').map(([, i]) => i);
  say(' constructor ........ (' + SLOTS.join(' ') + ')  ' + INTSLOTS.length + ' int slots, '
    + STRSLOTS.length + ' string slot(s), ' + OBJSLOTS.length + ' object slot(s)');
  ok(INTSLOTS.length >= 3, 'only ' + INTSLOTS.length + ' int parameters — expected at least id, diffuse, firework, text');
  ok(STRSLOTS.length === 1, STRSLOTS.length + ' String parameters after the synthetic pair — expected one (the registry name)');
  ok(OBJSLOTS.length === 1, OBJSLOTS.length + ' object parameters — expected one (MaterialColor)');
  die();

  const colours = dyeCons.map((c) => {
    const args = c.ops.slice(2);
    return {
      field: c.field,
      enumName: c.ops[0].str,
      ordinal: c.ops[1].int,
      name: args[STRSLOTS[0]].str,
      ints: INTSLOTS.map((i) => args[i].int),
      mcField: args[OBJSLOTS[0]].field,
    };
  }).sort((a, b) => a.ordinal - b.ordinal);
  const byName = new Map(colours.map((c) => [c.name, c]));

  // ------------------------------------------------------------ 5. LABEL the int slots, by anchor
  // ⚠ Nothing here assumes an order. Four values that cannot be in doubt decide which slot is
  // which, and section 6 then checks the answer against eight more colours in both directions.
  const slotWhere = (want) => {
    const hits = [];
    for (let s = 0; s < INTSLOTS.length; s++) {
      if (Object.entries(want).every(([n, v]) => byName.has(n) && byName.get(n).ints[s] === v)) hits.push(s);
    }
    return hits;
  };
  const idSlot = (() => {
    const hits = [];
    for (let s = 0; s < INTSLOTS.length; s++) if (colours.every((c) => c.ints[s] === c.ordinal)) hits.push(s);
    return hits;
  })();
  const diffuseHits = slotWhere({ white: 16383998, black: 1908001, red: 11546150 });
  const fireworkHits = slotWhere({ white: 15790320 });
  ok(idSlot.length === 1, idSlot.length + ' int slots equal the ordinal for all 16 colours — expected exactly one (id)');
  ok(diffuseHits.length === 1, diffuseHits.length + ' int slots carry white=0xF9FFFE, black=0x1D1D21 AND red=0xB02E26'
    + ' — expected exactly one (textureDiffuseColor)');
  ok(fireworkHits.length === 1, fireworkHits.length + ' int slots carry white=0xF0F0F0 — expected exactly one (fireworkColor)');
  die();
  const S_ID = idSlot[0], S_DIFFUSE = diffuseHits[0], S_FIREWORK = fireworkHits[0];
  ok(new Set([S_ID, S_DIFFUSE, S_FIREWORK]).size === 3,
    'the id, diffuse and firework anchors landed on the same int slot — the labelling is degenerate');
  die();
  const rest = INTSLOTS.map((_, i) => i).filter((i) => i !== S_ID && i !== S_DIFFUSE && i !== S_FIREWORK);
  ok(rest.length === 1, rest.length + ' unlabelled int slots left — expected exactly one (textColor)');
  die();
  const S_TEXT = rest[0];
  say(' int slots .......... id=' + S_ID + '  textureDiffuseColor=' + S_DIFFUSE
    + '  fireworkColor=' + S_FIREWORK + '  textColor=' + S_TEXT);

  // MaterialColor: the one object parameter. Its own <clinit> is `new MaterialColor(id, rgb)`.
  const MC = SLOTS[OBJSLOTS[0]].slice(1, -1).replace(/\//g, '.');
  const mcCons = constructions(clinitOf(MC), MC);
  const mcById = new Map();
  for (const c of mcCons) {
    const ints = c.ops.filter((o) => o.int !== undefined).map((o) => o.int);
    if (c.params.length === 2 && c.params[0] === 'I' && c.params[1] === 'I' && ints.length === 2) {
      mcById.set(c.field, { id: ints[0], rgb: ints[1] });
    }
  }
  ok(mcById.size >= 50, 'only ' + mcById.size + ' MaterialColor constants parsed out of ' + MC
    + '.<clinit> — expected 50+ of shape (int id, int rgb)');
  say(' MaterialColor ...... ' + MC + ' (' + mcById.size + ' constants)');
  for (const c of colours) {
    ok(c.mcField && c.mcField[2] === MC, c.name + "'s MaterialColor operand is not a field of " + MC);
    const mc = c.mcField && mcById.get(c.mcField[1]);
    ok(!!mc, c.name + ' reads ' + MC + '.' + (c.mcField ? c.mcField[1] : '?') + ', which is not in ' + MC + '.<clinit>');
    c.mc = mc || { id: -1, rgb: -1 };
  }
  die();

  // ------------------------------------------------------------ 6. ANTI-VACUITY, dyes
  // ⚠ BOTH DIRECTIONS, on values a player would notice in one crafting grid. A table that is
  // merely self-consistent is worthless.
  const DIFFUSE = {
    white: 16383998, orange: 16351261, magenta: 13061821, light_blue: 3847130,
    yellow: 16701501, lime: 8439583, pink: 15961002, gray: 4673362,
    light_gray: 10329495, cyan: 1481884, purple: 8991416, blue: 3949738,
    brown: 8606770, green: 6192150, red: 11546150, black: 1908001,
  };
  const FIREWORK = { white: 15790320, red: 11743532, black: 1973019, green: 3887386, blue: 2437522 };
  const TEXT = { white: 16777215, black: 0, blue: 255, green: 65280, red: 16711680 };
  const NAMES = Object.keys(DIFFUSE);
  ok(colours.length === 16, colours.length + ' dye colours — expected 16');
  ok(NAMES.every((n) => byName.has(n)),
    'the 16 registry names in ' + DYE + '.<clinit> are not the 16 vanilla dye names: got '
    + colours.map((c) => c.name).join(','));
  die();
  for (const [n, v] of Object.entries(DIFFUSE)) {
    ok(byName.get(n).ints[S_DIFFUSE] === v,
      n + ' textureDiffuseColor is ' + byName.get(n).ints[S_DIFFUSE] + ', expected ' + v);
  }
  // ⚠ AND THE OTHER DIRECTION. A column that merely CONTAINS the anchors proves nothing if a
  // second column contains them too: `slotWhere` returned every slot that matched and section 5
  // asserted the count was one, so re-assert it here over the FULL sixteen rather than the three.
  ok(slotWhere(DIFFUSE).length === 1, slotWhere(DIFFUSE).length
    + ' int slots reproduce all 16 textureDiffuseColors — expected exactly one');
  ok(slotWhere(FIREWORK).length === 1, slotWhere(FIREWORK).length
    + ' int slots reproduce the five anchored fireworkColors — expected exactly one');
  ok(slotWhere(TEXT).length === 1, slotWhere(TEXT).length
    + ' int slots reproduce the five anchored textColors — expected exactly one');
  for (const [n, v] of Object.entries(FIREWORK)) {
    ok(byName.get(n).ints[S_FIREWORK] === v,
      n + ' fireworkColor is ' + byName.get(n).ints[S_FIREWORK] + ', expected ' + v);
  }
  for (const [n, v] of Object.entries(TEXT)) {
    ok(byName.get(n).ints[S_TEXT] === v, n + ' textColor is ' + byName.get(n).ints[S_TEXT] + ', expected ' + v);
  }
  // the columns must be DISTINCT columns, not three views of one number
  ok(colours.some((c) => c.ints[S_DIFFUSE] !== c.ints[S_FIREWORK]),
    'textureDiffuseColor and fireworkColor are identical for all 16 colours — the two slots are the same column');
  ok(colours.some((c) => c.ints[S_DIFFUSE] !== c.ints[S_TEXT]),
    'textureDiffuseColor and textColor are identical for all 16 colours — the two slots are the same column');
  // ids and names are a clean 0..15
  ok(colours.map((c) => c.ints[S_ID]).join() === [...Array(16).keys()].join(), 'dye ids are not 0..15 in order');
  ok(new Set(colours.map((c) => c.name)).size === 16, 'two dye colours share a registry name');
  ok(new Set(colours.map((c) => c.ints[S_DIFFUSE])).size === 16, 'two dye colours share a textureDiffuseColor');
  // every colour must be a real 24-bit RGB
  for (const c of colours) {
    for (const [label, v] of [['textureDiffuseColor', c.ints[S_DIFFUSE]], ['fireworkColor', c.ints[S_FIREWORK]],
      ['textColor', c.ints[S_TEXT]], ['materialColorRgb', c.mc.rgb]]) {
      ok(v >= 0 && v <= 0xFFFFFF, c.name + ' ' + label + ' = ' + v + ' is not a 24-bit RGB');
    }
    ok(c.mc.id >= 0 && c.mc.id < 64, c.name + ' MaterialColor id ' + c.mc.id + ' is outside 0..63');
    ok(c.enumName.toLowerCase() === c.name, c.name + ' is enum constant ' + c.enumName + ' — the two names disagree');
  }
  // white's MaterialColor is SNOW, pure white — the one map colour nobody has to look up
  ok(byName.get('white').mc.rgb === 16777215,
    "white's MaterialColor rgb is " + byName.get('white').mc.rgb + ', expected 16777215 (SNOW)');
  die();
  say(' dye colours ........ ' + colours.length + ' parsed, all anchors held');

  // ------------------------------------------------------------ 7. FlowerBlock, by ctor SHAPE
  // ⚠ Exactly ONE constructor in the whole of Blocks.<clinit> has the shape (Object, int, Object)
  // — twelve calls, the twelve small flowers. That is FlowerBlock, and it is found without
  // knowing a single name.
  const blockLines = clinitOf(BLOCKS);
  const blockCons = constructions(blockLines);
  const byCtor = new Map();
  for (const c of blockCons) {
    if (c.params.length !== 3 || c.params[1] !== 'I') continue;
    if (c.params[0] === 'Ljava/lang/String;' || c.params[2] === 'Ljava/lang/String;') continue;
    if (c.params[0][0] !== 'L' || c.params[2][0] !== 'L') continue;
    const k = c.cls + ' ' + c.desc;
    if (!byCtor.has(k)) byCtor.set(k, []);
    byCtor.get(k).push(c);
  }
  const flowerCands = [...byCtor].filter(([, v]) => v.length >= 8);
  ok(flowerCands.length === 1, flowerCands.length + ' classes in ' + BLOCKS
    + '.<clinit> are built 8+ times through an (Object,int,Object) constructor — expected exactly one (FlowerBlock)');
  die();
  const FLOWER = flowerCands[0][0].split(' ')[0];
  const EFFECT = flowerCands[0][1][0].params[0].slice(1, -1).replace(/\//g, '.');
  // the MobEffect argument is always a getstatic from ONE holder class — that is MobEffects
  const holders = new Set(flowerCands[0][1].map((c) => (c.ops[0].field || [null])[0]));
  ok(holders.size === 1 && !holders.has(null) && !holders.has(undefined),
    'the FlowerBlock effect arguments come from ' + holders.size + ' classes — expected one (MobEffects)');
  die();
  const EFFECTS = [...holders][0];
  ok((plainCount.get(EFFECTS + ' ' + EFFECT) || 0) >= 20,
    EFFECTS + ' has only ' + (plainCount.get(EFFECTS + ' ' + EFFECT) || 0) + ' static finals of ' + EFFECT
    + ' — it does not look like MobEffects');
  say(' FlowerBlock ........ ' + FLOWER + '(' + EFFECT + ', int seconds, props) x ' + flowerCands[0][1].length);
  say(' MobEffects ......... ' + EFFECTS + ' of ' + EFFECT + ' (' + plainCount.get(EFFECTS + ' ' + EFFECT) + ' fields)');
  die();

  // the subclass: same first parameter type, no int of its own — its duration is a literal in
  // its own <init>, which delegates to FlowerBlock's. Read it; never assume it.
  const subCons = blockCons.filter((c) => c.cls !== FLOWER && c.params[0] === 'L' + EFFECT.replace(/\./g, '/') + ';'
    && !c.params.includes('I'));
  const subClasses = [...new Set(subCons.map((c) => c.cls))];
  say(' FlowerBlock subclasses in ' + BLOCKS + ': ' + (subClasses.join(' ') || '(none)'));
  const subDuration = new Map();
  for (const sc of subClasses) {
    ok(superOf.get(sc) === FLOWER, sc + ' takes a ' + EFFECT + ' but does not extend ' + FLOWER
      + ' (extends ' + superOf.get(sc) + ') — it is not a flower');
    const code = javap(['-c', '-p'], [sc]);
    // isolate its <init> and find the super call into FlowerBlock's (effect,int,props) ctor
    const i = code.findIndex((l) => /^ {2}(?:public |protected |)?[\w.$]+\(/.test(l) && l.includes(EFFECT));
    const body = i < 0 ? [] : code.slice(i, i + 40);
    const rx = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const SUPER = new RegExp('invokespecial\\s+#\\d+\\s+// Method ' + rx(FLOWER)
      + '\\."<init>":' + rx('(' + flowerCands[0][1][0].desc + ')V') + '\\s*$');
    const at = body.findIndex((l) => SUPER.test(l));
    ok(at > 0, 'could not find the super(' + EFFECT + ',int,props) call inside ' + sc + '.<init>');
    let secs = null;
    for (let k = at - 1; k > 0 && k > at - 8; k--) { const v = intOf(body[k]); if (v !== null) { secs = v; break; } }
    ok(secs !== null, sc + '.<init> pushes no int literal before its super() call — no duration to read');
    if (secs !== null) subDuration.set(sc, secs);
  }
  die();

  // ------------------------------------------------------------ 8. name the effects and flowers
  const effCons = constructions(clinitOf(EFFECTS));
  const effName = new Map(), effId = new Map();
  {
    // MobEffects registers through a static helper, not a constructor: `a(id, "name", effect)`.
    // So this one is a plain literal walk — first int and first string before each putstatic.
    let firstInt = null, firstStr = null;
    for (const l of clinitOf(EFFECTS)) {
      let m;
      const v = intOf(l); if (v !== null) { if (firstInt === null) firstInt = v; continue; }
      if ((m = l.match(RE_STR))) { if (firstStr === null) firstStr = m[1]; continue; }
      if ((m = l.match(RE_PUT)) && m[2].replace(/\//g, '.') === EFFECT) {
        if (firstStr !== null) { effName.set(m[1], firstStr); effId.set(m[1], firstInt); }
        firstInt = null; firstStr = null;
      }
    }
  }
  ok(effName.size >= 20, 'only ' + effName.size + ' effects named out of ' + EFFECTS + '.<clinit>');
  ok(new Set(effName.values()).size === effName.size, 'two ' + EFFECTS + ' fields resolved to the same effect name');
  say(' effects named ...... ' + effName.size + ' (ids ' + Math.min(...effId.values()) + '-' + Math.max(...effId.values()) + ')');
  die();

  // Blocks.<clinit> registers each block as `register("name", new SomeBlock(...))`, and the name
  // literal is pushed BEFORE the `new`. The construction walker already recorded the operands, so
  // this second pass just pairs the most recent pre-`new` string with each flower construction.
  const flowerRows = [];
  {
    let pendingName = null;
    let inside = 0;
    for (const l of blockLines) {
      let m;
      if ((m = l.match(RE_NEW))) { inside++; continue; }
      if ((m = l.match(RE_STR))) { if (inside === 0) pendingName = m[1]; continue; }
      if ((m = l.match(RE_INIT))) { if (inside > 0) inside--; continue; }
      if ((m = l.match(RE_PUT)) && m[2].replace(/\//g, '.') === BLOCKTYPE) {
        const c = blockCons.find((x) => x.field === m[1] && (x.cls === FLOWER || subClasses.includes(x.cls)));
        if (c) {
          ok(!!pendingName, 'a flower construction at ' + BLOCKS + '.' + m[1] + ' has no name literal before it');
          const ef = c.ops[0].field;
          ok(ef && ef[0] === EFFECTS, (pendingName || m[1]) + " does not read its effect from " + EFFECTS);
          const name = ef ? effName.get(ef[1]) : null;
          ok(!!name, (pendingName || m[1]) + ' reads ' + EFFECTS + '.' + (ef ? ef[1] : '?')
            + ', which has no name in ' + EFFECTS + '.<clinit>');
          const secs = c.cls === FLOWER ? c.ops[1].int : subDuration.get(c.cls);
          ok(typeof secs === 'number', (pendingName || m[1]) + ' has no duration');
          flowerRows.push({
            flower: pendingName, effect: name, effectId: ef ? effId.get(ef[1]) : -1,
            seconds: secs, ticks: effName.get(ef[1]) === 'saturation' ? secs : secs * 20, cls: c.cls,
          });
        }
        pendingName = null; inside = 0;
        continue;
      }
    }
  }
  say(' flowers ............ ' + flowerRows.length);
  die();

  // ------------------------------------------------------------ 9. ANTI-VACUITY, flowers
  // ⚠ Anchors, in BOTH directions. Every one of these is a stew a player can eat.
  const FLOWERS = {
    dandelion: ['saturation', 7], poppy: ['night_vision', 5], blue_orchid: ['saturation', 7],
    allium: ['fire_resistance', 4], azure_bluet: ['blindness', 8],
    red_tulip: ['weakness', 9], orange_tulip: ['weakness', 9],
    white_tulip: ['weakness', 9], pink_tulip: ['weakness', 9],
    oxeye_daisy: ['regeneration', 8], cornflower: ['jump_boost', 6],
    lily_of_the_valley: ['poison', 12], wither_rose: ['wither', 8],
  };
  const fByName = new Map(flowerRows.map((r) => [r.flower, r]));
  ok(flowerRows.length === Object.keys(FLOWERS).length,
    flowerRows.length + ' flower rows — vanilla 1.18.2 has ' + Object.keys(FLOWERS).length);
  for (const [f, [e, s]] of Object.entries(FLOWERS)) {
    const r = fByName.get(f);
    ok(!!r, f + ' is not in the extracted flower table at all');
    if (!r) continue;
    ok(r.effect === e, f + ' gives ' + r.effect + ', expected ' + e);
    ok(r.seconds === s, f + ' lasts ' + r.seconds + 's, expected ' + s + 's');
  }
  // and the other direction: nothing that is not a flower may have crept in
  for (const bad of ['sunflower', 'lilac', 'rose_bush', 'peony', 'grass', 'fern', 'oak_sapling',
    'brown_mushroom', 'red_mushroom', 'sugar_cane', 'wheat', 'stone']) {
    ok(!fByName.has(bad), bad + ' is not a small flower in vanilla, but it is in this table');
  }
  // the effect ids must be the real registry ids, not row numbers
  ok(effId.get([...effName].find(([, n]) => n === 'wither')[0]) === 20, 'wither is not effect id 20');
  ok(effId.get([...effName].find(([, n]) => n === 'poison')[0]) === 19, 'poison is not effect id 19');
  ok(effId.get([...effName].find(([, n]) => n === 'speed')[0]) === 1, 'speed is not effect id 1');
  for (const r of flowerRows) {
    ok(r.seconds > 0 && r.seconds <= 60, r.flower + ' has an impossible duration ' + r.seconds + 's');
    ok(r.effectId >= 1 && r.effectId <= 40, r.flower + ' has an impossible effect id ' + r.effectId);
  }
  ok(new Set(flowerRows.map((r) => r.flower)).size === flowerRows.length, 'the flower table has a duplicate key');
  ok(new Set(flowerRows.map((r) => r.effect)).size >= 8,
    'only ' + new Set(flowerRows.map((r) => r.effect)).size + ' distinct effects across the flowers — expected 9+');
  // the subclass path has to have BITTEN: wither_rose's 8 lives in its own <init>, not in Blocks
  ok(subClasses.length === 1, subClasses.length + ' FlowerBlock subclasses built in ' + BLOCKS
    + '.<clinit> — expected exactly one (WitherRoseBlock)');
  ok(fByName.get('wither_rose') && fByName.get('wither_rose').cls === subClasses[0],
    'wither_rose did not come through the subclass path — the super() literal read is vacuous');

  die();

  // ------------------------------------------------------------ 10. write
  mkdirSync(dirname(OUT_DYE), { recursive: true });
  const hex = (v) => '#' + v.toString(16).toUpperCase().padStart(6, '0');
  const dyeLines = [
    '# name\tid\ttextureDiffuseColor\ttextureDiffuseHex\tfireworkColor\tfireworkHex\ttextColor\ttextHex\tmaterialColorId\tmaterialColorRgb',
    '# Generated by tools/extract-colours.mjs from ' + JAR,
    '# DyeColor=' + DYE + '  MaterialColor=' + MC + '  Items=' + ITEMS + '  Blocks=' + BLOCKS,
    '# Identified WITHOUT mappings: ' + DYE + ' is the only one of the ' + enum16.length + ' enums in the jar with',
    '# exactly 16 constants of its own type that ' + ITEMS + ' reads (16 times, one per dye item).',
    '# Constructor is (' + SLOTS.join(' ') + ') after javac\'s synthetic (String,int).',
    '# COLUMNS ARE LABELLED BY ANCHOR, not by position: the int slot carrying white=0xF9FFFE,',
    '# black=0x1D1D21 and red=0xB02E26 is textureDiffuseColor; the slot carrying white=0xF0F0F0 is',
    '# fireworkColor; the slot that equals the ordinal is id; the one left is textColor. Slots used:',
    '# id=' + S_ID + ' textureDiffuseColor=' + S_DIFFUSE + ' fireworkColor=' + S_FIREWORK + ' textColor=' + S_TEXT + '.',
    '# WHAT EACH COLUMN IS FOR:',
    '#   textureDiffuseColor - leather dyeing (crafting_special_armordye averages these, weighted by',
    '#                         the brightest component), banner/map/shulker/bed tint, sheep wool tint.',
    '#   fireworkColor       - crafting_special_firework_star and _fade write THIS into the star NBT.',
    '#                         It is NOT the diffuse colour: white is 0xF0F0F0, not 0xF9FFFE.',
    '#   textColor           - the chat/sign text colour. Pure primaries (blue is 0x0000FF).',
    '#   materialColor*      - the block MaterialColor this dye maps to, for map colours.',
    '# Rows are in vanilla ordinal order, which is also the dye id order 0..15.',
  ];
  for (const c of colours) {
    dyeLines.push([c.name, c.ints[S_ID],
      c.ints[S_DIFFUSE], hex(c.ints[S_DIFFUSE]),
      c.ints[S_FIREWORK], hex(c.ints[S_FIREWORK]),
      c.ints[S_TEXT], hex(c.ints[S_TEXT]),
      c.mc.id, c.mc.rgb].join('\t'));
  }
  writeFileSync(OUT_DYE, dyeLines.join('\n') + '\n');

  const flowerLines = [
    '# flower\teffect\teffect-id\tseconds\tticks',
    '# Generated by tools/extract-colours.mjs from ' + JAR,
    '# FlowerBlock=' + FLOWER + '  WitherRoseBlock=' + subClasses.join(',') + '  MobEffects=' + EFFECTS
      + '  MobEffect=' + EFFECT + '  Blocks=' + BLOCKS,
    '# Identified WITHOUT mappings: ' + FLOWER + ' is the ONLY class in ' + BLOCKS + '.<clinit> constructed',
    '# 8+ times through an (Object,int,Object) constructor; its first argument is always a static of',
    '# ' + EFFECTS + ', which is therefore MobEffects. ' + subClasses.join(',') + ' is the one other class built with a',
    '# ' + EFFECT + ' first parameter and NO int — its duration is a literal inside its own <init>,',
    '# read from the super() call rather than assumed.',
    '# ⚠ THE BYTECODE HOLDS SECONDS, not ticks. SuspiciousStewItem multiplies by 20 when eaten.',
    '# The ticks column is seconds*20, computed here so a consumer cannot forget - EXCEPT instant effects',
    '# (saturation): FlowerBlock stores `effect.isInstant() ? seconds : seconds*20`, so 7, not 140.',
    '# ⚠ THIRTEEN ROWS, not eleven: the four tulips are four blocks that share weakness/9s.',
    '# Rows are in Blocks registry order.',
  ];
  for (const r of flowerRows) flowerLines.push([r.flower, r.effect, r.effectId, r.seconds, r.ticks].join('\t'));
  writeFileSync(OUT_FLOWER, flowerLines.join('\n') + '\n');

  const nAsserts = Object.keys(DIFFUSE).length + Object.keys(FIREWORK).length + Object.keys(TEXT).length
    + Object.keys(FLOWERS).length * 2 + 12;
  say('\n wrote ' + OUT_DYE);
  say(' wrote ' + OUT_FLOWER);
  say(' ' + colours.length + ' dye rows - ' + flowerRows.length + ' flower rows - '
    + nAsserts + '+ anchored assertions - 0 failures');
} finally {
  rmSync(work, { recursive: true, force: true });
}
