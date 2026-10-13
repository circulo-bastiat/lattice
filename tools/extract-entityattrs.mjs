#!/usr/bin/env node
// extract-entityattrs.mjs — PLAN G17/G18 (D-336). WHAT A MOB IS WORTH, out of the BYTECODE.
//
//   node tools/extract-entityattrs.mjs [--if-missing]
//        -> tools/golden/entity-attributes-1.18.2.tsv
//
// ⚠⚠ WHY THIS EXISTS. Dan, session 11: *"there is no combat"*. There is no combat partly because
// **no entity in this engine has any health**: `EntityList.spawn` builds a position, a velocity
// and a hitbox, and nothing that can be reduced. Vanilla keeps those numbers in each mob class's
// `createAttributes()` as calls on an `AttributeSupplier.Builder` — compiled Java, in no JSON
// file, no tag and no `minecraft-data` export. This is the NINETEENTH table D-263's referee
// technique has produced.
//
// ⚠ AND IT IS ALSO G18's GROUNDWORK, which is why it reads five attributes rather than one. Max
// health, movement speed, attack damage, follow range and knockback resistance are what a mob IS
// before any behaviour is written; extracting them once is cheaper and safer than extracting max
// health now and the rest later from a slightly different walk.
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ────────────────
//   1. `Attributes` is the class whose `<clinit>` registers the STRING `generic.max_health`.
//      That string is the attribute's registry name and it appears in exactly two classes: the
//      registry itself and the legacy-name map, and only one of them STORES it into a field.
//   2. Each attribute's FIELD is the one stored immediately after its own name string, which is
//      the same "first string since the last store" rule every other extractor here uses.
//   3. An ENTITY CLASS comes from `tools/golden/entity-types-1.18.2.tsv`, which already carries
//      the obfuscated class for all 113 types — so nothing about the type roster is re-derived
//      here and the two tables cannot drift apart.
//   4. AN ATTRIBUTE VALUE is the double constant between a `getstatic Attributes.<field>` and the
//      `Builder.add` call that follows it. ⚠ A mob that does not declare one INHERITS it, so the
//      superclass chain is walked until the attribute is found — which is how a cow gets its
//      movement speed from `Animal` and a zombie its follow range from `Monster`.
//
// ⚠ ANCHORED ON CASES THAT CANNOT BE IN DOUBT: a zombie has 20 health, a creeper 20, an ender
// dragon 200, a bat 6, a wither 300, and the villager's follow range is 48 where a zombie's is 35.
// ⚠ CLOSED: every type in the entity table is looked up, and the ones with NO attributes at all
// are listed — they are the non-living entities (items, arrows, boats), and that list must not
// quietly grow.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'entity-attributes-1.18.2.tsv');
const TYPES = join(MCLITE_ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' entity-attributes-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }
if (!existsSync(TYPES)) { say('SKIP - run tools/extract-entities.mjs first.'); process.exit(0); }

say('extract-entityattrs — mob attributes, out of the 1.18.2 bytecode (D-336)');

const work = mkdtempSync(join(tmpdir(), 'mclite-eattr-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);
const javap = (args, names) => {
  let out = '';
  for (let i = 0; i < names.length; i += 300) {
    out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 300)],
      { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  }
  return out.split('\n').filter((l) => !l.startsWith('Picked up'));
};

// ── 1. the entity type -> class map, from the table that already owns it ──────────────────────
const typeClass = new Map();
for (const line of readFileSync(TYPES, 'utf8').split(/\r?\n/)) {
  if (!line || line[0] === '#') continue;
  const c = line.split('\t');
  if (c.length >= 7 && c[6]) typeClass.set(c[0], c[6]);
}
say(' entity types .................. ' + typeClass.size + ' with a class');
ok(typeClass.size > 100, 'only ' + typeClass.size + ' types carry a class — regenerate entity-types');

// ── 2. the Attributes class and its fields, by the registry names they are stored beside ──────
const withName = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && grep -rl 'generic.max_health' --include='*.class' . | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean);
say(' classes naming the attribute ... ' + withName.join(' '));

const STR = /\bldc(?:_w)?\s+#\d+\s+\/\/ String (\S.*?)\s*$/;
const DBL = /\bldc2_w\s+#\d+\s+\/\/ double (-?[\d.E]+)d?/;
// ⚠⚠ D-462: 0.0 AND 1.0 ARE NOT CONSTANT-POOL DOUBLES. javac emits `dconst_0` / `dconst_1` for
// them, and until D-462 this matched only `ldc2_w` — so every attribute VALUE of exactly 0 or 1
// was invisible. An iron golem's knockback resistance (1.0), a hoglin's attack knockback (1.0)
// read as "not declared", and the registry DEFAULT of any attribute whose default is 0
// (knockback resistance, attack knockback) was taken from the NEXT double — its maximum.
// `dbl()` reads both forms; the attack-knockback anchors below are what caught it.
const DCONST = /\bdconst_([01])\b/;
const dbl = (l) => { const m = l.match(DBL); if (m) return +m[1]; const c = l.match(DCONST); return c ? +c[1] : null; };

let ATTR = null, attrField = new Map(), attrDefault = new Map();   // registry name -> field / default
for (const klass of withName) {
  const lines = javap(['-p', '-c'], [klass]);
  const i = lines.findIndex((l) => /^\s{2}static \{\};\s*$/.test(l));
  if (i < 0) continue;
  const put = /putstatic\s+#\d+\s+\/\/ Field (\w+):L([\w/$]+);/;
  const fields = new Map(), defs = new Map();
  let first = null, firstDouble = null;
  for (const l of lines.slice(i)) {
    const sm = l.match(STR);
    if (sm && first === null) { first = sm[1]; firstDouble = null; continue; }
    // ⚠⚠ THE ATTRIBUTE'S OWN DEFAULT IS THE FIRST DOUBLE AFTER ITS NAME, and it is the number
    // that matters most: `LivingEntity.createLivingAttributes()` adds MAX_HEALTH with **no
    // value at all**, so a zombie's twenty hearts are not written anywhere in `Zombie` — they
    // are `new RangedAttribute("attribute.name.generic.max_health", 20.0, 1.0, 1024.0)`.
    // Reading only the valued adds found 57 of 112 types and silently dropped every monster.
    const dv = dbl(l);
    if (dv !== null && firstDouble === null) firstDouble = dv;
    const p = l.match(put);
    if (!p) continue;
    if (first !== null) { fields.set(first, p[1]); if (firstDouble !== null) defs.set(first, firstDouble); }
    first = null; firstDouble = null;
  }
  if (fields.has('generic.max_health')) { ATTR = klass; attrField = fields; attrDefault = defs; break; }
}
ok(!!ATTR, 'no class stores generic.max_health into a static field — Attributes was not found');
if (!ATTR) { say('FAILED'); process.exit(1); }
say(' Attributes .................... ' + ATTR + '  (' + attrField.size + ' attributes)');

const WANT = [
  ['generic.max_health', 'maxHealth'],
  ['generic.movement_speed', 'movementSpeed'],
  ['generic.attack_damage', 'attackDamage'],
  ['generic.follow_range', 'followRange'],
  ['generic.knockback_resistance', 'knockbackResistance'],
  // D-462: `Mob.doHurtTarget` reads ATTACK_KNOCKBACK on every strike. `Mob.createMobAttributes`
  // adds it with NO value (its registry default, 0), so every mob carries a 0 — and a few
  // (hoglin, zoglin, ravager) override it. Appended LAST so older columns keep their index.
  ['generic.attack_knockback', 'attackKnockback'],
];
const fieldOf = new Map(), defaultOf = new Map();  // field -> our column name / its own default
for (const [reg, col] of WANT) {
  const f = attrField.get(reg);
  ok(!!f, 'the Attributes registry has no ' + reg);
  if (f) { fieldOf.set(f, col); if (attrDefault.has(reg)) defaultOf.set(col, attrDefault.get(reg)); }
}
say(' attributes read ............... ' +
    [...fieldOf].map(([f, c]) => c + '=' + f + '(' + defaultOf.get(c) + ')').join(' '));
ok(defaultOf.get('maxHealth') === 20,
   'the MAX_HEALTH attribute default reads as ' + defaultOf.get('maxHealth') + '; vanilla\'s is 20');

// ── 3. every class in the jar, its superclass, and the attributes it declares ─────────────────
// ⚠ ONE PASS, because javap'ing 113 classes one at a time costs 113 process launches, and the
// SUPERCLASS CHAIN can walk anywhere in the jar — a cow's speed is on `Animal`, not on `Cow`.
const all = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 28 }).toString().trim().split('\n').filter(Boolean);
say(' classes ....................... ' + all.length + ' (one javap pass)');

const superOf = new Map();
const declares = new Map();            // class -> { col: value }
{
  const getAttr = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + ATTR.replace(/\$/g, '\\$') + '\\.(\\w+):');
  let cur = null, pendingCol = null;
  for (const l of javap(['-p', '-c'], all)) {
    const d = l.match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)(?: extends ([\w.$]+))?/);
    if (d && l.trimEnd().endsWith('{')) {
      cur = d[1];
      if (d[2] && d[2] !== 'java.lang.Object') superOf.set(cur, d[2]);
      pendingCol = null;
      continue;
    }
    if (!cur) continue;
    const g = l.match(getAttr);
    if (g) { pendingCol = fieldOf.get(g[1]) || null; continue; }
    if (pendingCol === null) continue;
    const v = dbl(l);
    const note = (val) => {
      if (!declares.has(cur)) declares.set(cur, {});
      const own = declares.get(cur);
      // ⚠ THE FIRST ONE WINS. A class that sets the same attribute twice is setting a base and
      // then a variant (a baby, a tamed wolf); the base is what `createAttributes` declares.
      if (own[pendingCol] === undefined) own[pendingCol] = val;
      pendingCol = null;
    };
    if (v !== null) { note(v); continue; }
    // ⚠ A ONE-ARGUMENT `add` MEANS "AT ITS OWN DEFAULT" — `add(Attribute)` rather than
    // `add(Attribute, double)`. Telling the two apart by the DESCRIPTOR is the whole of why a
    // zombie has health at all; the two overloads share a name in the obfuscated jar (D-306).
    // ⚠⚠ **AND THE RETURN TYPE IS WHAT TELLS THE TWO APART** (D-306, a third time).
    // `AttributeSupplier.Builder.add(Attribute)` and `LivingEntity.getAttributeValue(Attribute)`
    // take the SAME single Attribute parameter, and in the obfuscated jar they even share the
    // letter. The first returns the Builder; the second returns a `D`. Matching on the parameter
    // alone read `getAttributeValue(ATTACK_DAMAGE)` inside `LivingEntity` as a bare add, so
    // **every passive mob in the game came out carrying the attack-damage attribute's default of
    // 2** — a wrong number that looked entirely reasonable on every row. Requiring a reference
    // return type is the whole fix.
    // ⚠⚠ **AND THE RETURN TYPE MUST BE THE CALL'S OWN CLASS** (cloud focused-planck, 27 Sept 2026). A
    // Builder's `add` returns the Builder itself; `LivingEntity.getAttributeInstance(Attribute)` also
    // takes one Attribute and returns a REFERENCE (the instance), so `HorseEntity.initAttributes`'s
    // `getAttributeInstance(MAX_HEALTH)` read as a bare add and every horse-family row came out at the
    // attribute defaults (20 health, 0.7 speed) instead of `createBaseHorseAttributes`' 53 / 0.225F.
    const call = l.match(/invokevirtual\s+#\d+\s+\/\/ Method (?:([\w/$]+)\.)?\w+:\(L[\w/$]+;(D?)\)L([\w/$]+);/);
    if (call && call[1] !== call[3]) { pendingCol = null; continue; }   // no owner = a same-class call, never a Builder
    if (call) {
      if (call[2] === '' && defaultOf.has(pendingCol)) note(defaultOf.get(pendingCol));
      pendingCol = null;
      continue;
    }
    // any other instruction between the getstatic and the add means this was not an add at all
    if (/^\s*\d+:/.test(l) && !/\b(dup|aload|ldc|invokeinterface|invokestatic)\b/.test(l)) {
      pendingCol = null;
    }
  }
}
say(' classes declaring attributes ... ' + declares.size);
ok(declares.size > 40, 'only ' + declares.size + ' classes declare an attribute — the walk is wrong');

// ── 3b. the DEFAULT ATTRIBUTE REGISTRY: which class's builder each type is built by ────────────
// ⚠ (cloud focused-planck, 27 Sept 2026) A mob's attributes are whatever `DefaultAttributeRegistry`
// maps its EntityType to — `put(EntityType.X, Owner.createXAttributes().build())` — and that owner
// is NOT always on the mob's own superclass chain: a slime, a magma cube and a phantom are built by
// `HostileEntity.createHostileAttributes()` (attack damage 2) though none of them extends
// HostileEntity. So the walk starts at the registry's owner class when there is one. The registry is
// found BY USE: the class whose <clinit> pairs a `getstatic EntityType.<f>` with an argument-less
// `invokestatic Owner.m:()L<Builder>;` most often; the field -> type name comes from EntityType's own
// <clinit> (the last string before each `putstatic`).
const ET = (readFileSync(TYPES, 'utf8').match(/^# EntityType=(\S+)/m) || [])[1];
const ownerOf = new Map();   // type -> class whose static builder the registry calls
let BUILDER = null;          // the Builder class those static methods return
if (ET) {
  const etE = ET.replace(/\$/g, '\\$');
  const fieldType = new Map();
  let lastStr = null;
  for (const l of javap(['-p', '-c'], [ET])) {
    const m = l.match(STR); if (m) { lastStr = m[1]; continue; }
    const p = l.match(new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + etE + ';'));
    if (p && lastStr) { fieldType.set(p[1], lastStr); lastStr = null; }
  }
  const pairRe = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + etE + '\\.(\\w+):L' + etE + ';');
  const callRe = /invokestatic\s+#\d+\s+\/\/ Method ([\w$\/]+)\.\w+:\(\)L([\w$\/]+);/;
  const cands = execFileSync('bash', ['-c', 'cd ' + JSON.stringify(work) +
    " && grep -rl --include='*.class' 'ImmutableMap' . | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
    { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean);
  let best = new Map();
  for (const k of cands) {
    const got = new Map();
    let f = null;
    for (const l of javap(['-p', '-c'], [k])) {
      const g = l.match(pairRe); if (g) { f = g[1]; continue; }
      const c = f && l.match(callRe);
      if (c && fieldType.has(f)) { got.set(fieldType.get(f), c[1].replace(/\//g, '.')); BUILDER = c[2]; }
      if (!/^\s*\d+:\s*(getstatic|invokestatic)/.test(l)) continue;
      f = null;
    }
    if (got.size > best.size) best = got;
  }
  for (const [t, c] of best) ownerOf.set(t, c);
}
say(' registry builder owners ........ ' + ownerOf.size + ' types');
ok(ownerOf.size > 60, 'only ' + ownerOf.size + ' types found in the default attribute registry');
ok(ownerOf.get('slime') && ownerOf.get('slime') !== typeClass.get('slime'),
   'the slime is not built by a foreign class (HostileEntity.createHostileAttributes) — the registry read is wrong');

// A builder that starts from ANOTHER class's builder (`MagmaCubeEntity.createMagmaCubeAttributes()` is
// `HostileEntity.createHostileAttributes().add(...)`) continues the walk in that class, not its super.
const baseCache = new Map();
const baseBuilderOf = (c) => {
  if (!BUILDER) return null;
  if (!baseCache.has(c)) {
    const re = new RegExp('invokestatic\\s+#\\d+\\s+// Method ([\\w$/]+)\\.\\w+:\\(\\)L' + BUILDER.replace(/\$/g, '\\$') + ';');
    let hit = null;
    for (const l of javap(['-p', '-c'], [c])) { const m = l.match(re); if (m && m[1] !== c) { hit = m[1].replace(/\//g, '.'); break; } }
    baseCache.set(c, hit);
  }
  return baseCache.get(c);
};

// ── 4. resolve each type through its builder owner's superclass chain ─────────────────────────
const rows = [], noAttrs = [];
for (const [type, klass] of [...typeClass].sort()) {
  const out = {};
  let c = ownerOf.get(type) || klass, guard = 0;
  while (c && guard++ < 40) {
    const own = declares.get(c);
    if (own) for (const k in own) if (out[k] === undefined) out[k] = own[k];
    c = (own && baseBuilderOf(c)) || superOf.get(c);
  }
  if (out.maxHealth === undefined) { noAttrs.push(type); continue; }
  rows.push({ type, klass, ...out });
}
say(' types with attributes ......... ' + rows.length + ', without ' + noAttrs.length);
say('   without: ' + noAttrs.join(' '));

// ── 5. the anchors ────────────────────────────────────────────────────────────────────────────
const by = new Map(rows.map((r) => [r.type, r]));
const anchor = (t, hp) => {
  const r = by.get(t);
  ok(!!r, t + ' has no attributes at all');
  if (r) ok(r.maxHealth === hp, `${t} comes out at ${r.maxHealth} health; vanilla's is ${hp}`);
};
anchor('zombie', 20); anchor('creeper', 20); anchor('bat', 6);
anchor('ender_dragon', 200); anchor('wither', 300); anchor('iron_golem', 100);
anchor('turtle', 30); anchor('guardian', 30); anchor('dolphin', 10);
// createBaseHorseAttributes' 53 (a horse's initAttributes re-rolls the BASE, not the table row) and the
// registry's foreign builders: a slime/magma cube/phantom carry HostileEntity's attack damage 2.
anchor('horse', 53); anchor('llama', 53);
ok(by.get('horse') && Math.abs(by.get('horse').movementSpeed - 0.225) < 1e-6, 'horse speed reads ' + (by.get('horse') || {}).movementSpeed + '; createBaseHorseAttributes says 0.225F');
for (const t of ['slime', 'magma_cube', 'phantom']) ok(by.get(t) && by.get(t).attackDamage === 2, t + ' attack damage reads ' + (by.get(t) || {}).attackDamage + '; HostileEntity.createHostileAttributes gives 2');
{
  const z = by.get('zombie'), v = by.get('villager');
  ok(z && z.followRange === 35, `a zombie's follow range is ${z && z.followRange}; vanilla's is 35`);
  ok(v && v.followRange === 48, `a villager's is ${v && v.followRange}; vanilla's is 48`);
  ok(z && z.attackDamage === 3, `a zombie's attack damage is ${z && z.attackDamage}; vanilla's is 3`);
  // D-462 anchors: a zombie inherits Mob's bare add (default 0); hoglin/zoglin 1, ravager 1.5.
  ok(z && z.attackKnockback === 0, `a zombie's attack knockback is ${z && z.attackKnockback}; vanilla's is 0`);
  // ...and the iron golem's knockback resistance is 1.0 — a dconst_1, invisible before D-462.
  const ig = by.get('iron_golem');
  ok(ig && ig.knockbackResistance === 1, `an iron golem's knockback resistance is ${ig && ig.knockbackResistance}; vanilla's is 1`);
  for (const [t, k] of [['hoglin', 1], ['zoglin', 1], ['ravager', 1.5]]) {
    const r = by.get(t);
    ok(r && r.attackKnockback === k, `${t}'s attack knockback is ${r && r.attackKnockback}; vanilla's is ${k}`);
  }
}

// ── 6. the table ──────────────────────────────────────────────────────────────────────────────
const COLS = ['maxHealth', 'movementSpeed', 'attackDamage', 'followRange', 'knockbackResistance', 'attackKnockback'];
const lines = [
  '# entity-attributes-1.18.2.tsv — mob attributes, out of the 1.18.2 bytecode (D-336).',
  '# Attributes = ' + ATTR + '. Values are resolved through the SUPERCLASS CHAIN, because a mob',
  '# that does not declare an attribute inherits it — a cow gets its speed from Animal.',
  '# An empty cell means no class in the chain declares that attribute.',
  '# Types with no maxHealth at all are not living entities and are listed in this header:',
  '#   ' + noAttrs.join(' '),
  ['type', 'class', ...COLS].join('\t'),
  ...rows.map((r) => [r.type, r.klass, ...COLS.map((c) => (r[c] === undefined ? '' : r[c]))].join('\t')),
];
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
say('');
for (const t of ['zombie', 'creeper', 'cow', 'turtle', 'dolphin', 'guardian', 'ender_dragon']) {
  const r = by.get(t);
  if (r) say('   ' + t.padEnd(14) + ' hp ' + String(r.maxHealth).padStart(5) +
             '  speed ' + String(r.movementSpeed).padStart(6) +
             '  dmg ' + String(r.attackDamage === undefined ? '-' : r.attackDamage).padStart(4) +
             '  follow ' + String(r.followRange === undefined ? '-' : r.followRange).padStart(4));
}
say('');
say(' -> ' + OUT.slice(MCLITE_ROOT.length));
if (failures) { say(' ' + failures + ' FAILURES'); process.exit(1); }
say(' 0 failures');
