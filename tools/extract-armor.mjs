#!/usr/bin/env node
// extract-armor.mjs — armour points, toughness and durability, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-armor.mjs [--if-missing]   -> tools/golden/armor-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. `14d_survival.js` has carried `Sv.afterArmor` — `CombatRules.getDamage
// AfterAbsorb`, read out of the bytecode — since G5, and it has **never once had a non-zero
// input**, because nothing computes what the player is wearing into a number. G8 gave the player
// four armour slots and D-266 made shift-click put a helmet in the right one; the points those
// pieces are worth are compiled Java and exist in no JSON file, no tag and no `minecraft-data`
// export. So this is the SIXTH table the bytecode referee has produced (D-263), after Material,
// EquipmentSlot, the furnace fuel map, DyeColor and SoundType.
//
// ⚠ AND IT ALREADY CORRECTED ME ONCE, WHICH IS THE WHOLE POINT. Writing it, I expected TURTLE's
// protection array to have a single non-zero entry, because the turtle helmet is the only piece
// of that material. It is `{2, 5, 6, 2}` — the same as iron. A table written from memory would
// have shipped a turtle helmet worth 2 points instead of 2 in the head slot of an iron-strength
// set, and no count of anything would have noticed.
//
// ⚠ THE METHOD IS D-263's, AND NOTHING TRUSTS A NAME:
//
//   1. `Items` is the class with 1000-1200 static finals of one Item type (the same hook four
//      other extractors use). Its `<clinit>` names every item as a string literal.
//   2. `ArmorMaterials` is picked BY USE, not by shape: it is the enum `Items.<clinit>` reads
//      **25 times — six constants four times each and one constant once.** That 6x4+1 is the
//      signature of the armour roster itself: six materials with a full set, and one material
//      with only a helmet. Shape alone offered two candidates and would have been the D-263
//      mistake again.
//   3. WHICH constant is which is derived TWICE and the two must agree: once from the item names
//      each constant is used beside (`leather_helmet` … name it), and once from the enum's own
//      `Enum(String, int)` name literal (`LEATHER`). Seven of seven, in both directions.
//   4. The array is indexed by `EquipmentSlot.getIndex()`, so the slot order is READ from that
//      enum's own constructor — each constant carries its own lowercase name AND its index —
//      rather than assumed from the order the values happen to appear in.
//   5. Durability is `HEALTH_PER_SLOT[index] * material.durabilityMultiplier`, and
//      `HEALTH_PER_SLOT` is the `int[]` built at the very end of the same `<clinit>`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'armor-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' armor-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

say('extract-armor — ArmorMaterials out of the 1.18.2 bytecode (D-291)');
const work = mkdtempSync(join(tmpdir(), 'mclite-armor-'));
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

  // ── 1. Items, the same way four other extractors find it ────────────────────────────────
  const sigs = javap(['-p'], all);
  let cur = null;
  const selfCount = new Map(), otherCount = new Map();
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && line.trimEnd().endsWith('{')) { cur = d[1]; continue; }
    if (!cur) continue;
    const f = line.match(/static final ([\w.$[\]]+) /);
    if (!f) continue;
    if (f[1] === cur) selfCount.set(cur, (selfCount.get(cur) || 0) + 1);
    else otherCount.set(cur + ' ' + f[1], (otherCount.get(cur + ' ' + f[1]) || 0) + 1);
  }
  const itemsCand = [...otherCount].filter(([, n]) => n >= 1000 && n <= 1200).sort((a, b) => b[1] - a[1])[0];
  ok(!!itemsCand, 'no Items candidate: no class with 1000-1200 static finals of one Item type');
  if (failures) { say('\n aborted'); process.exit(1); }
  const ITEMS = itemsCand[0].split(' ')[0];
  say(' Items class ........ ' + ITEMS + ' (' + itemsCand[1] + ' fields)');

  const itemCode = javap(['-c', '-p'], [ITEMS]);
  const ci = itemCode.findIndex((l) => l.trim().startsWith('static {}'));
  const clinit = itemCode.slice(ci);

  // ── 2. ArmorMaterials, BY USE: 6 constants x 4 pieces + 1 constant x 1 piece = 25 reads ──
  const readsOf = new Map();       // class -> Map(constant -> count)
  for (const l of clinit) {
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field ([\w.$]+)\.(\w+):L[\w/$]+;/);
    if (!g) continue;
    if (!readsOf.has(g[1])) readsOf.set(g[1], new Map());
    const m = readsOf.get(g[1]);
    m.set(g[2], (m.get(g[2]) || 0) + 1);
  }
  const byShape = [...selfCount].filter(([c, n]) => n >= 6 && n <= 8).map(([c]) => c);
  const MATS = byShape.filter((c) => {
    const m = readsOf.get(c);
    if (!m) return false;
    const counts = [...m.values()].sort((a, b) => b - a);
    // the armour roster's own signature: full sets of four, and exactly one lone piece
    return counts.length >= 6 && counts.filter((n) => n === 4).length >= 6
        && counts.filter((n) => n === 1).length === 1;
  });
  say(' 6..8-constant classes Items reads: '
    + byShape.filter((c) => readsOf.has(c)).join(' '));
  ok(MATS.length === 1, `ArmorMaterials must be unambiguous by USE, got [${MATS.join(', ')}]`);
  if (failures) { say('\n aborted'); process.exit(1); }
  const MAT = MATS[0];
  const uses = readsOf.get(MAT);
  say(' ArmorMaterials ..... ' + MAT + '  (' + [...uses.values()].reduce((a, b) => a + b, 0)
    + ' reads: ' + [...uses.values()].sort((a, b) => b - a).join('+') + ')');

  // ── 3. constant -> item names, from the string literal each is used beside ───────────────
  const matItems = new Map();
  {
    const re = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(MAT) + '\\.(\\w+):L' + esc(MAT) + ';');
    let name = null;
    for (const l of clinit) {
      const nm = l.trim().match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
      if (nm) { name = nm[1]; continue; }
      const g = l.match(re);
      if (g && name) {
        if (!matItems.has(g[1])) matItems.set(g[1], []);
        matItems.get(g[1]).push(name);
      }
    }
  }

  // ── 4. the enum itself: its own name, the protections, toughness, knockback, durability ──
  const matCode = javap(['-c', '-p'], [MAT]);
  const mi = matCode.findIndex((l) => l.trim().startsWith('static {}'));
  ok(mi >= 0, 'ArmorMaterials has no <clinit>');
  const mat = matCode.slice(mi);

  const intAt = (l) => {
    let m = l.match(/iconst_(\d)/); if (m) return +m[1];
    m = l.match(/(?:bipush|sipush)\s+(-?\d+)/); if (m) return +m[1];
    return null;
  };
  const floatAt = (l) => {
    let m = l.match(/fconst_(\d)/); if (m) return +m[1];
    m = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ float ([\d.]+)f/); if (m) return parseFloat(m[1]);
    return null;
  };

  // ⚠ AN EXPLICIT PHASE MACHINE, BECAUSE THE FIRST VERSION READ THE WRONG INT. Each constructor
  // runs in a fixed order and the ints are NOT interchangeable:
  //
  //     ldc "LEATHER"      the enum constant's own name
  //     iconst_0           ordinal
  //     ldc "leather"      the material's lowercase name
  //     iconst_5           durabilityMultiplier   <- wanted
  //     iconst_4           the array length
  //     newarray int       -----------------------------  the boundary
  //     (dup; <i>; <v>; iastore) x4                        slotProtections
  //     bipush 15          enchantmentValue       <- NOT the durability multiplier
  //     getstatic sound
  //     fconst_0           toughness
  //     fconst_0           knockbackResistance
  //
  // The first version took the first int AFTER the array, which is the enchantment value, and
  // produced a leather helmet more durable than an iron one (165 against 99). It passed the
  // "every piece has a positive durability" assertion, which is why that assertion is now joined
  // by a POSITIONAL one: the two ints before the boundary must be exactly [multiplier, 4].
  const mats = [];
  {
    let c = null, phase = 0, pre = [], post = [], floats = [], arr = [], ints = [];
    for (const raw of mat) {
      const l = raw.trim();
      const up = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z][A-Z0-9_]*)$/);
      if (up) { c = { enumName: up[1] }; phase = 1; pre = []; post = []; floats = []; arr = []; ints = []; continue; }
      if (!c) continue;
      const lo = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z][a-z0-9_]*)$/);
      if (lo && !c.lower) { c.lower = lo[1]; pre = []; continue; }     // ordinal is before this
      if (/newarray\s+int/.test(l)) { phase = 2; continue; }
      if (/iastore/.test(l)) { if (ints.length >= 2) arr.push(ints[ints.length - 1]); ints = []; phase = 2; continue; }
      const fv = floatAt(l);
      if (fv !== null) { floats.push(fv); continue; }
      const iv = intAt(l);
      if (iv !== null) { if (phase === 1) pre.push(iv); else if (phase === 2) ints.push(iv); continue; }
      if (/getstatic/.test(l) && phase === 2) { phase = 3; post = ints; ints = []; continue; }
      const put = l.match(/putstatic\s+#\d+\s+\/\/ Field (\w+):L/);
      if (put) {
        c.field = put[1]; c.prot = arr; c.pre = pre; c.enchant = post.length ? post[0] : null;
        c.toughness = floats.length >= 2 ? floats[floats.length - 2] : 0;
        c.knockback = floats.length >= 1 ? floats[floats.length - 1] : 0;
        mats.push(c); c = null; phase = 0;
      }
    }
  }
  const found = mats.filter((m) => m.field && m.prot.length === 4);
  ok(found.length === uses.size, `parsed ${found.length} materials, Items reads ${uses.size}`);
  for (const m of found) {
    ok(m.prot.every((v) => typeof v === 'number'),
      `${m.enumName}: protection array did not parse (${JSON.stringify(m.prot)})`);
    // ⚠ POSITIONAL: [durabilityMultiplier, arrayLength]. If this is not exactly two ints ending
    // in 4, the walk has drifted and every durability below is somebody else's number.
    ok(m.pre.length === 2 && m.pre[1] === 4,
      `${m.enumName}: expected [multiplier, 4] before the array, got ${JSON.stringify(m.pre)}`);
    m.durMult = m.pre[0];
  }
  // ⚠ and the two ints must really be two DIFFERENT fields: leather's multiplier is not its
  // enchantment value, so a parse that grabbed the same number twice cannot pass this.
  ok(found.some((m) => m.durMult !== m.enchant),
     'the durability multiplier and the enchantment value are the same for every material — one of them is being read twice');

  let tailAt = -1;
  for (let i = 0; i < mat.length; i++) if (/newarray\s+int/.test(mat[i])) tailAt = i;
  ok(tailAt >= 0, 'no int[] is built in ArmorMaterials.<clinit>');
  const HEALTH = [];
  { // dup; <index>; <value>; iastore — take the value, which is the SECOND int of each triple
    let ints = [];
    for (const raw of mat.slice(tailAt)) {
      const l = raw.trim();
      if (/iastore/.test(l)) { if (ints.length >= 2) HEALTH.push(ints[ints.length - 1]); ints = []; continue; }
      const v = intAt(l);
      if (v !== null) ints.push(v);
    }
  }
  ok(HEALTH.length === 4, `HEALTH_PER_SLOT must be four values, got ${JSON.stringify(HEALTH)}`);
  say(' HEALTH_PER_SLOT .... ' + JSON.stringify(HEALTH));

  // ── 5. EquipmentSlot's own index per slot, so the array order is READ, not assumed ───────
  const slotCands = [...selfCount].filter(([c2, n]) => n === 6 && readsOf.has(c2)).map(([c2]) => c2);
  let SLOTIDX = null, SLOTCLS = null;
  for (const cls of slotCands) {
    const code = javap(['-c', '-p'], [cls]);
    const si = code.findIndex((l) => l.trim().startsWith('static {}'));
    if (si < 0) continue;
    const body = code.slice(si);
    const seen = new Map();
    let pendingInts = [], lower = null;
    for (const raw of body) {
      const l = raw.trim();
      const up = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Z][A-Z0-9_]*)$/);
      if (up) { pendingInts = []; lower = null; continue; }
      const lo = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z][a-z0-9_]*)$/);
      if (lo) { lower = lo[1]; continue; }
      const v = intAt(l);
      if (v !== null) { pendingInts.push(v); continue; }
      if (/invokespecial .*"<init>"/.test(l) && lower) {
        // (name, ordinal, type, index, filterFlag, lowerName): ordinal, index, filterFlag
        if (pendingInts.length >= 3) seen.set(lower, pendingInts[1]);
        lower = null; pendingInts = [];
      }
    }
    const need = ['feet', 'legs', 'chest', 'head'];
    if (need.every((n) => seen.has(n))) { SLOTIDX = seen; SLOTCLS = cls; break; }
  }
  ok(!!SLOTIDX, 'EquipmentSlot not found: no six-constant enum names feet/legs/chest/head');
  if (failures) { say('\n aborted'); process.exit(1); }
  const IDX = { feet: SLOTIDX.get('feet'), legs: SLOTIDX.get('legs'),
                chest: SLOTIDX.get('chest'), head: SLOTIDX.get('head') };
  say(' EquipmentSlot ...... ' + SLOTCLS + '  feet=' + IDX.feet + ' legs=' + IDX.legs
    + ' chest=' + IDX.chest + ' head=' + IDX.head);
  // ⚠ derived, then asserted: the four armour indices must be a permutation of 0..3, or the
  // array lookup lands on the wrong slot and every piece is worth somebody else's points.
  ok([...new Set(Object.values(IDX))].sort().join(',') === '0,1,2,3',
     `the four armour indices must be a permutation of 0..3, got ${JSON.stringify(IDX)}`);

  // ── 6. join, and assert in BOTH directions ──────────────────────────────────────────────
  const SUFFIX = { helmet: 'head', chestplate: 'chest', leggings: 'legs', boots: 'feet' };
  const rows = [];
  for (const m of found) {
    const items = matItems.get(m.field) || [];
    ok(items.length > 0, `${m.enumName} (${m.field}) is used by no item`);
    // ⚠ BOTH DIRECTIONS: the enum's own name and the items' shared prefix must agree.
    const prefix = items[0].split('_')[0];
    ok(m.enumName.toLowerCase().startsWith(prefix.slice(0, 4).toLowerCase())
       || prefix.startsWith(m.enumName.slice(0, 4).toLowerCase())
       || (m.lower && (prefix === m.lower || prefix === 'golden' && m.lower === 'gold')),
       `${m.enumName} names items beginning "${prefix}" — the two derivations disagree`);
    const durMult = m.durMult;
    const toughness = m.toughness;
    const knockback = m.knockback;
    for (const item of items) {
      const suf = item.split('_').pop();
      const slot = SUFFIX[suf];
      ok(!!slot, `${item} does not end in a known armour suffix`);
      if (!slot) continue;
      const i = IDX[slot];
      rows.push({ item, material: m.enumName.toLowerCase(), slot,
                  defense: m.prot[i], toughness, knockback,
                  maxDamage: HEALTH[i] * durMult });
    }
  }
  rows.sort((a, b) => (a.item < b.item ? -1 : 1));
  ok(rows.length === 25, `${rows.length} armour items, the roster has 25`);

  // ⚠ STRUCTURAL ASSERTIONS, NOT REMEMBERED VALUES. Each of these is a property of the table's
  // shape that a mis-parse breaks and a correct parse cannot.
  const byMat = new Map();
  for (const r of rows) { if (!byMat.has(r.material)) byMat.set(r.material, []); byMat.get(r.material).push(r); }
  ok(byMat.size === 7, `${byMat.size} materials, expected 7`);
  const lone = [...byMat].filter(([, rs]) => rs.length === 1);
  ok(lone.length === 1 && lone[0][1][0].slot === 'head',
     `exactly one material has a single piece and it is a helmet, got ${JSON.stringify(lone.map(([k, v]) => [k, v[0].slot]))}`);
  for (const [mname, rs] of byMat) {
    if (rs.length !== 4) continue;
    const chest = rs.find((r) => r.slot === 'chest').defense;
    const boots = rs.find((r) => r.slot === 'feet').defense;
    ok(chest >= boots, `${mname}: the chestplate (${chest}) must be worth at least the boots (${boots})`);
  }
  // ⚠ THE ASSERTION THAT WOULD HAVE CAUGHT THE FIRST VERSION'S BUG, and it is DERIVED: whichever
  // material this table says is the least protective must also be the least durable, in every
  // slot. Reading the enchantment value as the durability multiplier made leather helmets (165)
  // more durable than iron ones (99), and nothing then in this file objected.
  {
    const total = new Map();
    for (const [mname, rs] of byMat) total.set(mname, rs.reduce((a, r) => a + r.defense, 0) / rs.length);
    const weakest = [...total].sort((a, b) => a[1] - b[1])[0][0];
    for (const r of byMat.get(weakest)) {
      const rivals = rows.filter((o) => o.slot === r.slot && o.material !== weakest);
      ok(rivals.every((o) => o.maxDamage > r.maxDamage),
        `${weakest} is the least protective material but its ${r.slot} piece (${r.maxDamage}) `
        + `outlasts ${rivals.filter((o) => o.maxDamage <= r.maxDamage).map((o) => o.material + ' ' + o.maxDamage).join(', ')}`);
    }
    say(' least protective ... ' + weakest + ', and least durable in all four slots');
  }
  const tough = [...new Set(rows.map((r) => r.toughness))].sort((a, b) => a - b);
  ok(tough[0] === 0, `the weakest toughness must be 0, got ${tough[0]}`);
  ok(rows.every((r) => r.maxDamage > 0), 'every piece has a positive durability');
  ok(rows.every((r) => r.defense >= 0 && r.defense <= 12), 'every defence value is in 0..12');

  const lines = [
    '# armor-1.18.2.tsv — every armour piece, from the 1.18.2 jar\'s own bytecode (D-291).',
    '#',
    '# `ArmorMaterials` is compiled Java: these numbers are in no JSON file, no tag and no',
    '# `minecraft-data` export, which is why `Sv.afterArmor` had carried vanilla\'s own damage',
    '# formula since G5 with nothing ever able to give it a non-zero armour value.',
    '#',
    '# defense   `slotProtections[EquipmentSlot.getIndex()]` — the index is READ from that enum,',
    '#           not assumed from the order the values appear in.',
    '# toughness `ArmorMaterials.toughness`, the second float. Only diamond and netherite are',
    '#           non-zero, and only netherite has any knockback resistance.',
    '# maxDamage `HEALTH_PER_SLOT[index] * durabilityMultiplier`, both from the same <clinit>.',
    '#',
    '# ⚠ TURTLE is `{2, 5, 6, 2}` — iron\'s array, not a lone value. Writing this table from',
    '# memory would have got that wrong, which is what the referee is for.',
    '#',
    '# item\tmaterial\tslot\tdefense\ttoughness\tknockback\tmaxDamage',
    ...rows.map((r) => [r.item, r.material, r.slot, r.defense, r.toughness, r.knockback, r.maxDamage].join('\t')),
  ];
  if (failures) { say(`\n ${failures} assertion(s) failed — refusing to write ${OUT}`); process.exit(1); }
  writeFileSync(OUT, lines.join('\n') + '\n');
  say(' materials .......... ' + byMat.size + ' over ' + rows.length + ' items');
  for (const [mname, rs] of byMat) {
    say('   ' + mname.padEnd(10) + rs.map((r) => r.slot + ' ' + r.defense).join('  ')
      + '   toughness ' + rs[0].toughness + (rs[0].knockback ? ', knockback ' + rs[0].knockback : ''));
  }
  say(' wrote .............. ' + OUT);
} finally {
  rmSync(work, { recursive: true, force: true });
}
