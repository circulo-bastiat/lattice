#!/usr/bin/env node
// extract-itemattrs.mjs — PLAN G7 / D-271. ATTACK DAMAGE AND ATTACK SPEED, out of the BYTECODE.
//
//   node tools/extract-itemattrs.mjs [--if-missing]  -> tools/golden/item-attributes-1.18.2.tsv
//
// ⚠⚠ WHY THIS EXISTS, and it has been owed since G10. `14i_hand.js` carries vanilla's whole
// attack-cooldown model — `getCurrentItemAttackStrengthDelay`, `getAttackStrengthScale`, the
// 0.2 + 0.8s² damage ramp — and `H.attackSpeedTable` has been **null since the day it was
// written**, so every item in the game swings at the base 4.0 and a diamond sword is
// indistinguishable from a feather. `handcheck` prints "attack speed table . NOT BOUND (D-271)"
// on every run and SKIPS its own diamond-sword assertion. That is the honest way to carry a
// debt, and this file is the debt being paid.
//
// ⚠ THE NUMBERS ARE IN NO JSON FILE. `Attributes.ATTACK_DAMAGE` and `ATTACK_SPEED` are applied by
// `SwordItem` and `DiggerItem` as attribute MODIFIERS built in their constructors, from arguments
// passed at each item's registration. There is no data pack, no tag and no `minecraft-data`
// export that carries them. This is the EIGHTEENTH table D-263's referee technique has produced.
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE ────────────────────────
//   1. `Items` is the registry class found the way five other extractors find it: 1000-1200
//      static finals of one type, whose `<clinit>` reads another registry class hundreds of times.
//   2. A TOOL CLASS is found BY DESCRIPTOR: a constructor `(L<T>;IFL<P>;)V` or `(L<T>;FFL<P>;)V`
//      where `<P>` is `Item$Properties` — the type every item constructor ends with. Five classes
//      match, each constructed exactly six times, which is the signature of the tool roster
//      itself: sword, pickaxe, axe, shovel and hoe, in six tiers. **Nothing is read by name.**
//   3. `<T>` is therefore the Tier interface, and `Tiers` is the enum with six static finals of
//      that type. Its constructor is `(String, int, int, int, float, float, int, Supplier)` —
//      the enum's own name and ordinal, then level, uses, speed, **damage**, enchantment value.
//      The damage bonus is the SECOND float, and which float it is is checked against the two
//      cases that cannot be in doubt: wood and gold both add 0, and netherite adds 4.
//   4. An item's own modifier is the int-or-float before the attack-speed float in its segment.
//      `attackDamage = modifier + tier.damage` and `attackSpeed = 4.0 + speedModifier`, which is
//      exactly what `SwordItem`'s and `DiggerItem`'s constructors build.
//
// ⚠ CLOSED, AND ANCHORED ON CASES THAT CANNOT BE IN DOUBT. Thirty tool items, six per class; a
// diamond sword must come out at 7 damage and 1.6 attacks a second and a wooden one at 4 and 1.6;
// every tier's damage bonus must be distinct except wood and gold, which are both zero.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' item-attributes-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

say('extract-itemattrs — attack damage and attack speed, out of the 1.18.2 bytecode (D-271)');

const work = mkdtempSync(join(tmpdir(), 'mclite-attr-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);
const all = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && find . -name '*.class' ! -name '*$*' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 28 }).toString().trim().split('\n').filter(Boolean);

const javap = (args, names) => {
  let out = '';
  for (let i = 0; i < names.length; i += 400) {
    out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 400)],
      { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  }
  return out.split('\n').filter((l) => !l.startsWith('Picked up'));
};

// ── 1. the registry classes (the same hook five other extractors use) ─────────────────────────
const staticOf = new Map();
{
  let cur = null;
  for (const l of javap(['-p'], all)) {
    const d = l.match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && l.trimEnd().endsWith('{')) { cur = d[1]; continue; }
    if (!cur) continue;
    const m = l.match(/^\s{2}public static final ([\w.$]+)(?:<[^;]*>)? \w+;\s*$/);
    if (!m) continue;
    if (!staticOf.has(cur)) staticOf.set(cur, new Map());
    const t = staticOf.get(cur);
    t.set(m[1], (t.get(m[1]) || 0) + 1);
  }
}
const registries = [];
for (const [klass, types] of staticOf) {
  for (const [type, n] of types) if (n >= 100) registries.push({ klass, type, n });
}
registries.sort((a, b) => b.n - a.n);
const clinitOf = new Map();
const dumpClinit = (klass) => {
  if (clinitOf.has(klass)) return clinitOf.get(klass);
  const lines = javap(['-p', '-c'], [klass]);
  const i = lines.findIndex((l) => /^\s{2}static \{\};\s*$/.test(l));
  const body = i < 0 ? [] : lines.slice(i);
  clinitOf.set(klass, body);
  return body;
};
let ITEMS = null, best = 0;
for (const r of registries) {
  const body = dumpClinit(r.klass);
  for (const o of registries) {
    if (o.klass === r.klass) continue;
    const re = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + o.klass.replace(/\$/g, '\\$') + '\\.');
    const n = body.filter((l) => re.test(l)).length;
    if (n > best) { best = n; ITEMS = r; }
  }
}
ok(!!ITEMS, 'Items was not found');
if (!ITEMS) { say('FAILED'); process.exit(1); }
say(' Items ......................... ' + ITEMS.klass);
const itemsBody = dumpClinit(ITEMS.klass);

// ── 2. the tool classes, BY DESCRIPTOR ────────────────────────────────────────────────────────
// `Item$Properties` is the type every item constructor's LAST parameter has; it is found by being
// the most common such type, not by its name.
const CTOR = /invokespecial\s+#\d+\s+\/\/ Method ([\w$]+)\."<init>":\(([^)]*)\)V/;
const propsCount = new Map();
for (const l of itemsBody) {
  const m = l.match(CTOR);
  if (!m) continue;
  const args = m[2].match(/L[\w/$]+;|[BCDFIJSZ]|\[+[^;]*;?/g) || [];
  const last = args[args.length - 1];
  if (last && last[0] === 'L') propsCount.set(last, (propsCount.get(last) || 0) + 1);
}
const PROPS = [...propsCount].sort((a, b) => b[1] - a[1])[0][0];
say(' Item$Properties ............... ' + PROPS.slice(1, -1) + '  (' + propsCount.get(PROPS) + ' constructors)');

// a tool takes (Tier, int|float damage, float speed, Properties)
const toolShape = new Map();          // class -> { tier, dmgKind, count }
for (const l of itemsBody) {
  const m = l.match(CTOR);
  if (!m) continue;
  const args = m[2].match(/L[\w/$]+;|[BCDFIJSZ]/g) || [];
  if (args.length !== 4) continue;
  if (args[3] !== PROPS || args[0][0] !== 'L') continue;
  if (args[2] !== 'F') continue;
  if (args[1] !== 'I' && args[1] !== 'F') continue;
  const k = m[1];
  const cur = toolShape.get(k) || { tier: args[0], dmgKind: args[1], count: 0 };
  cur.count++;
  toolShape.set(k, cur);
}
say(' tool classes .................. ' + [...toolShape].map(([k, v]) => k + '(' + v.dmgKind + ')x' + v.count).join(' '));
ok(toolShape.size === 5, toolShape.size + ' classes have a tool constructor shape; five (sword, pickaxe, axe, shovel, hoe) should');
const tierTypes = new Set([...toolShape.values()].map((v) => v.tier));
ok(tierTypes.size === 1, 'the five tool classes do not agree on a Tier type: ' + [...tierTypes].join(' '));
const TIER_T = [...tierTypes][0].slice(1, -1).replace(/\//g, '.');
say(' Tier .......................... ' + TIER_T);
for (const [k, v] of toolShape) ok(v.count === 6, k + ' is constructed ' + v.count + ' times; six tiers should');

// ── 2b. WHICH of the five is the SWORD, by its superclass ─────────────────────────────────────
// ⚠ IT MATTERS BECAUSE ONLY A SWORD SWEEPS. `Player.attack` gives the sweep attack to a held
// `SwordItem` and to nothing else, so "is this a sword" is a real branch in the damage formula
// and not a label. ⚠ IDENTIFIED BY SHAPE: four of the five extend `DiggerItem` and one does not —
// `SwordItem extends TieredItem` — so the odd one out IS the sword, with nothing read by name.
let SWORD = null;
{
  const supers = new Map();
  for (const l of javap(['-p'], [...toolShape.keys()])) {
    const d = l.match(/^(?:public |final |abstract |)*class ([\w.$]+) extends ([\w.$]+)/);
    if (d) supers.set(d[1], d[2]);
  }
  const bySuper = new Map();
  for (const [k, sup] of supers) bySuper.set(sup, (bySuper.get(sup) || []).concat(k));
  const odd = [...bySuper].filter(([, ks]) => ks.length === 1);
  const many = [...bySuper].filter(([, ks]) => ks.length === 4);
  say(' tool superclasses ............. ' + [...bySuper].map(([s2, ks]) => s2 + ':' + ks.join(',')).join('  '));
  ok(odd.length === 1 && many.length === 1,
     'the five tool classes do not split four-and-one by superclass — the sword cannot be told apart');
  SWORD = odd.length === 1 ? odd[0][1][0] : null;
  say(' SwordItem ..................... ' + SWORD);
}

// ── 3. the Tiers enum, and its attack-damage bonus ────────────────────────────────────────────
// ⚠ **BY USE, NOT BY TYPE.** The first guess was "the class with five to twelve static finals of
// the Tier type" and it found nothing: `Tiers` is an ENUM, so its own constants are declared as
// `Tiers`, not as the `Tier` interface they implement — javap prints `public static final bwg a;`
// where the constructors take `Lbwf;`. **A class that implements an interface does not declare
// its fields as that interface.** What is unambiguous is the USE: the thing handed to those
// thirty tool constructors. It is read as the self-typed enum constant that appears most often
// in `Items.<clinit>` with the right number of distinct constants.
let TIERS = null;
{
  const selfConst = /getstatic\s+#\d+\s+\/\/ Field ([\w$]+)\.(\w+):L([\w/$]+);/;
  const byClass = new Map();
  for (const l of itemsBody) {
    const m = l.match(selfConst);
    if (!m) continue;
    if (m[3].replace(/\//g, '.') !== m[1]) continue;      // an enum constant of its own type
    if (!byClass.has(m[1])) byClass.set(m[1], { n: 0, fields: new Set() });
    const e = byClass.get(m[1]); e.n++; e.fields.add(m[2]);
  }
  const want = [...toolShape.values()].reduce((a, v) => a + v.count, 0);   // 30
  const cands = [...byClass].filter(([, e]) => e.fields.size >= 5 && e.fields.size <= 12 && e.n >= want);
  cands.sort((a, b) => b[1].n - a[1].n);
  say(' enum candidates ............... ' +
      cands.map(([k, e]) => k + '(' + e.fields.size + ' constants, ' + e.n + ' uses)').join(' '));
  // the Tiers enum is the one whose constants are used exactly as often as there are tool items
  const exact = cands.filter(([, e]) => e.n === want);
  ok(exact.length === 1,
     exact.length + ' enums are used exactly ' + want + ' times in Items.<clinit>; one (Tiers) should');
  TIERS = exact.length ? exact[0][0] : (cands.length ? cands[0][0] : null);
}
ok(!!TIERS, 'the Tiers enum was not found by use');
if (!TIERS) { say('FAILED'); process.exit(1); }
const tiersBody = dumpClinit(TIERS);
say(' Tiers ......................... ' + TIERS);

const CONST = (l) => {
  let m = l.match(/\biconst_(m1|[0-5])\b/); if (m) return m[1] === 'm1' ? -1 : +m[1];
  m = l.match(/\bfconst_([0-2])\b/); if (m) return +m[1];
  m = l.match(/\b(?:bipush|sipush)\s+(-?\d+)/); if (m) return +m[1];
  m = l.match(/\bldc(?:2?_w)?\s+#\d+\s+\/\/ (?:int|float|double) (-?[\d.E]+)f?/); if (m) return +m[1];
  return null;
};
const STR = /\bldc(?:_w)?\s+#\d+\s+\/\/ String (\S.*?)\s*$/;

// each constant: ldc "NAME", ordinal, then level, uses, speed, damage, enchantmentValue
const tierDamage = new Map(), tierField = new Map();
{
  // ⚠ THE CONSTANTS ARE TYPED AS THE ENUM, NOT AS THE INTERFACE — the same trap as finding the
  // enum in the first place, one line later.
  const put = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + TIERS.replace(/[.$]/g, (c) => '\\' + c) + ';');
  let name = null, nums = [];
  for (const l of tiersBody) {
    const sm = l.match(STR);
    if (sm && name === null) { name = sm[1]; nums = []; continue; }
    const c = CONST(l);
    if (c !== null) { nums.push(c); continue; }
    const p = l.match(put);
    if (!p) continue;
    // nums = [ordinal, level, uses, speed, damage, enchantmentValue, ...]
    if (name !== null && nums.length >= 6) {
      tierDamage.set(p[1], nums[4]);
      tierField.set(p[1], name);
    }
    name = null; nums = [];
  }
}
say(' tiers ......................... ' + [...tierField].map(([f, n]) => n + '=' + tierDamage.get(f)).join(' '));
ok(tierDamage.size >= 5, 'only ' + tierDamage.size + ' tiers parsed');
// ⚠ ANCHORED ON THE CASES THAT CANNOT BE IN DOUBT: wood and gold add nothing, netherite adds the
// most. If the wrong float were being read, one of these three is certain to move.
{
  const byName = new Map([...tierField].map(([f, n]) => [n, tierDamage.get(f)]));
  ok(byName.get('WOOD') === 0, 'WOOD adds ' + byName.get('WOOD') + ' attack damage; it adds 0');
  ok(byName.get('GOLD') === 0, 'GOLD adds ' + byName.get('GOLD') + '; it adds 0');
  ok(byName.get('NETHERITE') === Math.max(...byName.values()),
     'NETHERITE is not the largest attack-damage bonus');
  ok(byName.get('NETHERITE') === 4, 'NETHERITE adds ' + byName.get('NETHERITE') + '; it adds 4');
}

// ── 4. walk Items.<clinit> and read each tool's own modifiers ─────────────────────────────────
const PLAYER_BASE_DAMAGE = 1.0;      // Attributes.ATTACK_DAMAGE's default for a player
const BASE_ATTACK_SPEED = 4.0;       // Attributes.ATTACK_SPEED's default
const putItem = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + ITEMS.type.replace(/[.$]/g, (c) => '\\' + c) + ';');
const getTier = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + TIERS.replace(/\$/g, '\\$') + '\\.(\\w+):');

const rows = [];
let seg = { str: null, nums: [], tier: null, klass: null };
for (const l of itemsBody) {
  const sm = l.match(STR); if (sm && seg.str === null) seg.str = sm[1];
  const tm = l.match(getTier); if (tm && !seg.tier) seg.tier = tm[1];
  const c = CONST(l); if (c !== null) seg.nums.push(c);
  const cm = l.match(CTOR); if (cm && toolShape.has(cm[1])) seg.klass = cm[1];
  const p = l.match(putItem);
  if (!p) continue;
  if (seg.klass && seg.tier && seg.str && seg.nums.length >= 2) {
    // the two numbers immediately before the constructor are (damage, speed)
    const speed = seg.nums[seg.nums.length - 1];
    const dmgMod = seg.nums[seg.nums.length - 2];
    const tierD = tierDamage.get(seg.tier);
    rows.push({
      name: seg.str, klass: seg.klass, tier: tierField.get(seg.tier),
      sword: seg.klass === SWORD ? 1 : 0,
      dmgMod, speedMod: speed, tierDamage: tierD,
      attackDamage: PLAYER_BASE_DAMAGE + dmgMod + tierD,
      attackSpeed: BASE_ATTACK_SPEED + speed
    });
  }
  seg = { str: null, nums: [], tier: null, klass: null };
}
say(' tool items .................... ' + rows.length);
ok(rows.length === 30, rows.length + ' tool items found; 5 classes x 6 tiers = 30 should be');

// ── 5. the anchors ────────────────────────────────────────────────────────────────────────────
const by = new Map(rows.map((r) => [r.name, r]));
const anchor = (name, dmg, spd) => {
  const r = by.get(name);
  ok(!!r, name + ' was not found at all');
  if (!r) return;
  ok(Math.abs(r.attackDamage - dmg) < 1e-6,
     `${name} comes out at ${r.attackDamage} damage; vanilla's is ${dmg}`);
  ok(Math.abs(r.attackSpeed - spd) < 1e-6,
     `${name} comes out at ${r.attackSpeed} attacks/second; vanilla's is ${spd}`);
};
anchor('diamond_sword', 7, 1.6);
anchor('wooden_sword', 4, 1.6);
anchor('netherite_sword', 8, 1.6);
anchor('diamond_axe', 9, 1.0);
anchor('diamond_pickaxe', 5, 1.2);
anchor('diamond_shovel', 5.5, 1.0);
anchor('diamond_hoe', 1, 4.0);
{
  const swords = rows.filter((r) => r.sword);
  ok(swords.length === 6, swords.length + ' items are swords; six should be');
  ok(swords.every((r) => r.name.endsWith('_sword')),
     'something that is not named a sword was identified as one: ' +
     swords.filter((r) => !r.name.endsWith('_sword')).map((r) => r.name).join(' '));
  ok(rows.filter((r) => !r.sword && r.name.endsWith('_sword')).length === 0,
     'a sword was not identified as one');
}

// ── 6. the table ──────────────────────────────────────────────────────────────────────────────
rows.sort((a, b) => a.name.localeCompare(b.name));
const lines = [
  '# item-attributes-1.18.2.tsv — attack damage and attack speed, out of the 1.18.2 bytecode.',
  '# D-271 declared this debt in G10 and `Hand.attackSpeedTable` has been null ever since.',
  '# Items = ' + ITEMS.klass + '   Tier = ' + TIER_T + '   Tiers = ' + TIERS,
  '# attackDamage = 1.0 (the player\'s own base) + the item\'s modifier + its tier\'s bonus',
  '# attackSpeed  = 4.0 (the base) + the item\'s modifier, in attacks per second',
  '# Items not listed here carry no modifier at all: 1.0 damage and 4.0 attacks a second.',
  '# sword = 1 for the six SwordItems, which are the only items that sweep in Player.attack.',
  'item\tclass\ttier\tdamageMod\tspeedMod\ttierDamage\tattackDamage\tattackSpeed\tsword',
  ...rows.map((r) => [r.name, r.klass, r.tier, r.dmgMod, r.speedMod, r.tierDamage,
                      r.attackDamage, r.attackSpeed, r.sword].join('\t')),
];
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
say('');
for (const r of rows) {
  say('   ' + r.name.padEnd(20) + String(r.attackDamage).padStart(5) + ' damage   ' +
      String(r.attackSpeed).padStart(5) + ' /s');
}
say('');
say(' -> ' + OUT.slice(MCLITE_ROOT.length));
if (failures) { say(' ' + failures + ' FAILURES'); process.exit(1); }
say(' 0 failures');
