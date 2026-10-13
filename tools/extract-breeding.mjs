#!/usr/bin/env node
// extract-breeding.mjs — PLAN G18e. WHAT AN ANIMAL EATS TO BREED, and every constant the
// breeding loop runs on, read out of the 1.18.2 client jar's BYTECODE.
//
//   node tools/extract-breeding.mjs [--if-missing]   -> tools/golden/breeding-1.18.2.tsv
//
// ⚠⚠ WHY THIS EXISTS. `docs/archive/QUEUE.md` row 2 asks for "the breeding item per family read from
// the jar's own `isFood`/`FOOD_ITEMS` (not memory)". Everyone knows a cow takes wheat and a pig
// takes carrots; nobody knows from memory that a pig ALSO takes beetroot, that a fox takes a
// TAG rather than a list, that a rabbit's third food is a BLOCK's item (the dandelion), or that
// a wolf's rule is not a list at all but "any edible item whose FoodProperties say meat". A
// hand table would be right for cow and wrong for four of the twenty-nine, invisibly (D-263).
//
// ⚠ AND THE CONSTANTS COME WITH IT, because the same two classes own them and reading them in
// one pass is how they cannot drift: love mode's 600 ticks, the 6000-tick breeding cooldown the
// parents are aged to, the experience orb's `nextInt(7) + 1`, the baby's -24000 start age, the
// 20 ticks one `ageUp` unit is worth, the 40-tick forced-age timer, and the two particle
// cadences (a heart every 10 ticks in love mode, a growth puff every 4 while forced age runs).
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ────────────────
//   1. `Items` is the class with 1000-1200 static finals of one Item type and `Blocks` the one
//      with 850-1000 of one Block type — `extract-fuel.mjs`'s own shape test, unchanged.
//   2. `ItemTags` is the only class with 40+ static finals of some `Generic<Item>`, by GENERIC
//      SIGNATURE, which is what separates it from the block, fluid and entity tag holders.
//   3. `AgeableMob` is the ONE class in the jar that writes both NBT keys `Age` and `ForcedAge`.
//      Those two strings appear together nowhere else, and a save key is not obfuscated.
//   4. `Animal` is the direct subclass of `AgeableMob` with the most subclasses of its own,
//      CONFIRMED by carrying both the 600 and the 6000 — if the confirmation fails this aborts
//      rather than guessing, because the whole table hangs off that one class.
//   5. `isFood(ItemStack)` is `Animal`'s own one-argument boolean method taking the ItemStack
//      type; a subclass OVERRIDES it by declaring the same descriptor. Every override resolves
//      to one of five shapes and the fifth (a predicate over FoodProperties) is REPORTED AS A
//      PREDICATE rather than expanded into a list, because it is not one.
//   6. An animal's registry NAME comes from `tools/golden/entity-types-1.18.2.tsv`, so the type
//      roster is never re-derived here and the two tables cannot disagree.
//
// ⚠ ANCHORED ON CASES THAT CANNOT BE IN DOUBT: a cow inherits wheat, a pig takes exactly three
// items, a chicken takes the seed list, a fox takes a tag, and the count of Animal subclasses
// is asserted against the entity table rather than typed in.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'breeding-1.18.2.tsv');
const TYPES = join(MCLITE_ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const stop = () => { if (failures) { say('\n aborted'); process.exit(1); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' breeding-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}
if (!existsSync(TYPES)) {
  say(' SKIP — tools/golden/entity-types-1.18.2.tsv is missing; run extract-entities first.');
  process.exit(0);
}
const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-breed-'));
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

// ------------------------------------------------------------ 1. the shape of the jar
const sigs = javap(['-p'], all);
let cur = null;
const superOf = new Map();          // class -> superclass
const declares = new Map();         // class -> [member lines]
const plainCount = new Map();
const genericCount = new Map();
for (const line of sigs) {
  const d = line.trim().match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)(?: extends ([\w.$]+))?/);
  if (d && line.trimEnd().endsWith('{')) {
    cur = d[1]; declares.set(cur, []); superOf.set(cur, d[2] || null); continue;
  }
  if (!cur) continue;
  declares.get(cur).push(line.trim());
  const g = line.match(/static final ([\w.$]+)<([\w.$]+)> \w+;/);
  if (g) { const k = cur + ' ' + g[1] + ' ' + g[2]; genericCount.set(k, (genericCount.get(k) || 0) + 1); continue; }
  const f = line.match(/static final ([\w.$[\]]+) /);
  if (!f || f[1] === cur) continue;
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
stop();
const [ITEMS, ITEMTYPE] = itemsCand[0].split(' ');
const [BLOCKS, BLOCKTYPE] = blocksCand[0].split(' ');
say(' Items class ........ ' + ITEMS + ' of ' + ITEMTYPE + ' (' + itemsCand[1] + ' fields)');
say(' Blocks class ....... ' + BLOCKS + ' of ' + BLOCKTYPE + ' (' + blocksCand[1] + ' fields)');
const tagCands = [...genericCount].filter(([k, n]) => k.endsWith(' ' + ITEMTYPE) && n >= 40)
  .sort((a, b) => b[1] - a[1]);
ok(tagCands.length === 1, tagCands.length + ' classes have 40+ static finals of Generic<' + ITEMTYPE + '> — expected one (ItemTags)');
stop();
const [TAGS, TAGTYPE] = tagCands[0][0].split(' ');
say(' ItemTags class ..... ' + TAGS + ' of ' + TAGTYPE + '<' + ITEMTYPE + '>');

// ------------------------------------------------------------ 2. the disassembly, per method
const RE_GET = /getstatic\s+#\d+\s+\/\/ Field (?:(\w+)\.)?(\w+):L([\w/$]+);/;
const RE_STR = /ldc(?:_w)?\s+#\d+\s+\/\/ String (\S+)$/;
const RE_PUT = /putstatic\s+#\d+\s+\/\/ Field (\w+):L([\w/$]+);/;
const intOf = (l) => {
  let m;
  if ((m = l.match(/:\s+(?:sipush|bipush)\s+(-?\d+)\s*$/))) return +m[1];
  if ((m = l.match(/:\s+iconst_(\d)\s*$/))) return +m[1];
  if ((m = l.match(/:\s+ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+)\s*$/))) return +m[1];
  return null;
};
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
const bodyOf = (cls, pred) => { for (const [h, b] of methodsOf(cls)) if (pred(h)) return b; return null; };

// ------------------------------------------------------------ 3. the two base classes, by their
// own NBT KEYS. `ForcedAge` appears in exactly one constant pool in the jar and `InLove` in
// exactly one other: a save key is not obfuscated, and these two are not words any other class
// happens to store. The class FILES are searched, not their disassembly, so this costs one grep
// rather than six thousand javap launches.
const poolHolders = (needle) => execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && grep -rl " + JSON.stringify(needle)
  + " --include='*.class' . | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 26 }).toString().trim().split('\n').filter(Boolean);
const ageables = poolHolders('ForcedAge');
const animals = poolHolders('InLove');
ok(ageables.length === 1, ageables.length + ' classes carry the `ForcedAge` NBT key — expected exactly one (AgeableMob)');
ok(animals.length === 1, animals.length + ' classes carry the `InLove` NBT key — expected exactly one (Animal)');
stop();
const AGEABLE = ageables[0], ANIMAL = animals[0];
ok(superOf.get(ANIMAL) === AGEABLE, ANIMAL + ' does not extend ' + AGEABLE + ' — the two anchors disagree');
stop();
say(' AgeableMob ......... ' + AGEABLE);
say(' Animal ............. ' + ANIMAL + ' (extends ' + AGEABLE + ')');

// ------------------------------------------------------------ 4. the constants, from those two
// Each one is taken from the METHOD that owns it, never from "the only 600 in the class".
const pushesIn = (cls, pred) => {
  const b = bodyOf(cls, pred) || [];
  return b.map(intOf).filter((v) => v !== null);
};
// setInLove(Player): the only Animal method that pushes a literal and reads a UUID.
const AM = methodsOf(ANIMAL);
const findBody = (list, pred) => { for (const [h, b] of list) if (pred(h, b)) return b; return null; };
const setInLove = findBody(AM, (h, b) => /^public void \w+\(\w+\);$/.test(h)
  && b.some((l) => l.includes('UUID')) && b.some((l) => intOf(l) !== null && intOf(l) > 1));
ok(!!setInLove, 'could not isolate Animal.setInLove(Player) — no one-arg void method reads a UUID');
const IN_LOVE_TICKS = setInLove ? setInLove.map(intOf).filter((v) => v !== null && v > 1)[0] : null;
// spawnChildFromBreeding: the Animal method that pushes 6000 twice and rolls a Random.
const breedBody = findBody(AM, (h, b) =>
  b.filter((l) => intOf(l) === 6000).length === 2 && b.some((l) => l.includes('Random.nextInt')));
ok(!!breedBody, 'could not isolate Animal.spawnChildFromBreeding — no method pushes 6000 twice and rolls a Random');
const BREED_COOLDOWN_AGE = breedBody ? 6000 : null;
let XP_BOUND = null;
if (breedBody) {
  for (let i = 0; i < breedBody.length; i++) {
    if (breedBody[i].includes('Random.nextInt')) { XP_BOUND = intOf(breedBody[i - 1]); break; }
  }
}
// Animal.aiStep: the love-mode particle's own `irem` divisor.
const remOf = (b) => { for (let i = 0; i < b.length; i++) if (/:\s+irem\s*$/.test(b[i])) return intOf(b[i - 1]); return null; };
const aiStep = findBody(AM, (h, b) => /^public void \w+\(\);$/.test(h)
  && b.some((l) => /:\s+irem\s*$/.test(l)) && b.some((l) => l.includes('nextGaussian')));
const HEART_INTERVAL = aiStep ? remOf(aiStep) : null;
const AGM = methodsOf(AGEABLE);
// AgeableMob.setBaby(boolean): the only one-arg boolean method, and it pushes the start age.
const setBaby = findBody(AGM, (h) => /^public void \w+\(boolean\);$/.test(h));
const BABY_START_AGE = setBaby ? setBaby.map(intOf).filter((v) => v !== null && v < 0)[0] : null;
// ageUp(int, boolean): pushes the seconds-to-ticks unit before an imul, and the forced-age timer.
const ageUp = findBody(AGM, (h) => /^public void \w+\(int, boolean\);$/.test(h)) || [];
let AGE_UP_UNIT = null;
for (let i = 0; i < ageUp.length; i++) if (/:\s+imul\s*$/.test(ageUp[i])) { AGE_UP_UNIT = intOf(ageUp[i - 1]); break; }
const FORCED_AGE_TIMER = ageUp.map(intOf).filter((v) => v !== null && v !== AGE_UP_UNIT && v > 1)[0];
// AgeableMob.tick(): the growth puff's own cadence, the same `irem` shape.
const growTick = findBody(AGM, (h, b) => /^public void \w+\(\);$/.test(h) && b.some((l) => /:\s+irem\s*$/.test(l)));
const GROW_PARTICLE_INTERVAL = growTick ? remOf(growTick) : null;

const CONSTS = {
  inLoveTicks: IN_LOVE_TICKS,
  breedCooldownAge: BREED_COOLDOWN_AGE,
  xpBound: XP_BOUND,
  babyStartAge: BABY_START_AGE,
  ageUpUnit: AGE_UP_UNIT,
  forcedAgeTimer: FORCED_AGE_TIMER,
  heartInterval: HEART_INTERVAL,
  growParticleInterval: GROW_PARTICLE_INTERVAL
};
for (const [k, v] of Object.entries(CONSTS)) ok(Number.isFinite(v), 'constant ' + k + ' was not found in the bytecode');
// The four that cannot be in doubt — if the walk slips, it slips here and not in the game.
ok(CONSTS.inLoveTicks === 600, 'love mode is ' + CONSTS.inLoveTicks + ' ticks, not 600 — the walk has slipped');
ok(CONSTS.babyStartAge === -24000, 'a baby starts at ' + CONSTS.babyStartAge + ', not -24000');
ok(CONSTS.ageUpUnit === 20, 'one ageUp unit is ' + CONSTS.ageUpUnit + ' ticks, not 20');
stop();
say(' constants .......... ' + JSON.stringify(CONSTS));

// ------------------------------------------------------------ 5. name the constants, the way
// `extract-fuel.mjs` does: every <clinit> registers from a string literal in registry order,
// FIRST string wins, and a block item takes the name of its block.
const clinitOf = (cls) => {
  const b = findBody(methodsOf(cls), (h) => h.startsWith('static {}'));
  ok(!!b, cls + ' has no <clinit>');
  return b || [];
};
const simpleNames = (cls, type) => {
  const out = new Map(); let first = null;
  for (const l of clinitOf(cls)) {
    let m;
    if ((m = l.match(RE_STR))) { if (first === null) first = m[1]; continue; }
    if ((m = l.match(RE_PUT)) && m[2] === type) { if (first !== null) out.set(m[1], first); first = null; }
  }
  return out;
};
const blockName = simpleNames(BLOCKS, BLOCKTYPE);
const tagName = simpleNames(TAGS, TAGTYPE);
const itemName = new Map(), itemOfBlockField = new Map();
{
  let lastStr = null, lastBlk = null, lastDesc = null;
  for (const l of clinitOf(ITEMS)) {
    let m;
    if ((m = l.match(RE_STR))) { if (lastStr === null) lastStr = m[1]; continue; }
    if ((m = l.match(RE_GET))) { if (m[1] === BLOCKS && m[3] === BLOCKTYPE && lastBlk === null) lastBlk = m[2]; continue; }
    if ((m = l.match(/invokestatic\s+#\d+\s+\/\/ Method \w+:(\([^)]*\)L\w+;)$/))) { lastDesc = m[1]; continue; }
    if ((m = l.match(RE_PUT)) && m[2] === ITEMTYPE) {
      if (lastDesc && lastDesc.startsWith('(Ljava/lang/String;') && lastStr) itemName.set(m[1], lastStr);
      else if (lastBlk) {
        const n = blockName.get(lastBlk);
        if (n) { itemName.set(m[1], n); itemOfBlockField.set(lastBlk, m[1]); }
      }
      lastStr = null; lastBlk = null; lastDesc = null;
    }
  }
}
ok(new Set(itemName.values()).size === itemName.size, 'two Items fields resolved to the same name — the <clinit> walk has slipped');
say(' items named ........ ' + itemName.size + ' · blocks ' + blockName.size + ' · item tags ' + tagName.size);

// ------------------------------------------------------------ 6. isFood, by DESCRIPTOR
// Animal's own `isFood` is the one-argument public boolean method whose body reads an `Items`
// field — the default rule is `stack.is(Items.WHEAT)` and nothing else in Animal has that shape.
const isFoodHeads = [];
for (const [h, b] of AM) {
  const m = h.match(/^public boolean (\w+)\(([\w.$]+)\);$/);
  if (!m) continue;
  if (b.some((l) => { const g = l.match(RE_GET); return g && g[1] === ITEMS; })) isFoodHeads.push([m[1], m[2], b]);
}
ok(isFoodHeads.length === 1, isFoodHeads.length + ' one-argument public boolean methods in ' + ANIMAL
  + ' read an ' + ITEMS + ' field — expected exactly one (isFood)');
stop();
const [ISFOOD, STACKTYPE, ANIMAL_ISFOOD] = isFoodHeads[0];
say(' isFood ............. ' + ANIMAL + '.' + ISFOOD + '(' + STACKTYPE + ')');

/** Decode one isFood-shaped body into { kind, items[] }. `seen` stops a cyclic helper. */
function decodeFood(cls, body, seen) {
  // ⚠ A CONSTANT FALSE IS A FACT, NOT A GAP. `Parrot.isFood` and `PolarBear.isFood` are
  // `return false;` — those two animals cannot be bred at all in vanilla, and a table that
  // recorded them as "no rule found" would invite a future session to fill the hole in.
  const ins = body.map((l) => l.trim()).filter((l) => /^\d+:/.test(l));
  if (ins.length === 2 && /iconst_0$/.test(ins[0]) && /ireturn$/.test(ins[1])) {
    return { kind: 'none', items: [], tags: [] };
  }
  const items = [];
  const tags = [];
  let kind = null;
  const ingredientFields = [];
  const helpers = [];
  for (const l of body) {
    let m;
    if ((m = l.match(RE_GET))) {
      const owner = m[1] || cls, field = m[2], type = m[3];
      if (owner === ITEMS && type === ITEMTYPE) { const n = itemName.get(field); if (n) items.push(n); else kind = 'unresolved'; continue; }
      if (owner === BLOCKS && type === BLOCKTYPE) { const n = blockName.get(field); if (n) items.push(n); else kind = 'unresolved'; continue; }
      if (owner === TAGS && type === TAGTYPE) { const n = tagName.get(field); if (n) tags.push('#minecraft:' + n); else kind = 'unresolved'; continue; }
      if (type !== ITEMTYPE && type !== BLOCKTYPE && type !== TAGTYPE) ingredientFields.push([owner, field, type]);
      continue;
    }
    if ((m = l.match(/invokestatic\s+#\d+\s+\/\/ Method (?:([\w.$]+)\.)?(\w+):\(L([\w/$]+);\)Z$/))) {
      if (m[3] === STACKTYPE) helpers.push([m[1] || cls, m[2]]);
      continue;
    }
  }
  // an Ingredient constant: its own <clinit> builds it from an array of ItemLike constants
  for (const [owner, field] of ingredientFields) {
    const lines = clinitOf(owner);
    let armed = false;
    for (const l of lines) {
      let m;
      if (/anewarray/.test(l)) { armed = true; continue; }
      if (armed && (m = l.match(RE_GET))) {
        const o = m[1] || owner, f = m[2], t = m[3];
        if (o === ITEMS && t === ITEMTYPE) { const n = itemName.get(f); if (n) items.push(n); }
        else if (o === BLOCKS && t === BLOCKTYPE) { const n = blockName.get(f); if (n) items.push(n); }
        continue;
      }
      if (armed && (m = l.match(RE_PUT))) { if (m[1] === field) break; armed = false; items.length = items.length; }
    }
  }
  for (const [owner, name] of helpers) {
    const key = owner + '.' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    const hb = findBody(methodsOf(owner), (h) => h.includes(' ' + name + '(' + STACKTYPE + ');'));
    if (!hb) { kind = kind || 'predicate'; continue; }
    const sub = decodeFood(owner, hb, seen);
    items.push(...sub.items); tags.push(...sub.tags);
    if (sub.kind === 'predicate' || sub.kind === 'unresolved') kind = sub.kind;
  }
  const uniq = [...new Set(items)];
  if (kind === 'unresolved') return { kind: 'unresolved', items: uniq, tags };
  if (tags.length && !uniq.length) return { kind: 'tag', items: [], tags };
  if (uniq.length) return { kind: tags.length ? 'mixed' : 'items', items: uniq, tags };
  return { kind: 'predicate', items: [], tags: [] };
}

// ------------------------------------------------------------ 7. every Animal subclass
const namesByClass = new Map();
for (const l of readFileSync(TYPES, 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const p = l.split('\t');
  if (p.length >= 7 && p[6]) namesByClass.set(p[6].trim(), p[0]);
}
const chainOf = (c) => { const out = []; let x = c; while (superOf.get(x)) { out.push(superOf.get(x)); x = superOf.get(x); } return out; };
const subclasses = all.filter((c) => chainOf(c).includes(ANIMAL));
ok(subclasses.length > 20, 'only ' + subclasses.length + ' subclasses of ' + ANIMAL + ' — the superclass walk is wrong');
stop();

const rows = [];
for (const cls of subclasses.sort()) {
  const name = namesByClass.get(cls) || '';
  const own = findBody(methodsOf(cls), (h) => h === 'public boolean ' + ISFOOD + '(' + STACKTYPE + ');');
  let res, src;
  if (own) { res = decodeFood(cls, own, new Set()); src = 'own'; }
  else {
    // no override: walk up to the nearest ancestor that declares one, which is Animal at worst
    let anc = chainOf(cls).find((a) => findBody(methodsOf(a), (h) => h === 'public boolean ' + ISFOOD + '(' + STACKTYPE + ');'));
    const ab = anc ? findBody(methodsOf(anc), (h) => h === 'public boolean ' + ISFOOD + '(' + STACKTYPE + ');') : ANIMAL_ISFOOD;
    res = decodeFood(anc || ANIMAL, ab, new Set());
    src = 'inherit:' + (anc || ANIMAL);
  }
  rows.push({ name, cls, src, kind: res.kind, items: res.items, tags: res.tags });
}
const named = rows.filter((r) => r.name);
say(' animal classes ..... ' + rows.length + ' (' + named.length + ' with a registry name)');
ok(named.length >= 25, 'only ' + named.length + ' Animal subclasses resolved to a registry name');
// the anchors: they cannot be in doubt, and if the walk slipped they are where it shows
const byName = new Map(named.map((r) => [r.name, r]));
const anchor = (n, pred, what) => { const r = byName.get(n); ok(r && pred(r), n + ' ' + what + ' — got ' + (r ? r.kind + ' ' + r.items.join(',') + r.tags.join(',') : 'no row')); };
anchor('cow', (r) => r.src.startsWith('inherit') && r.items.length === 1 && r.items[0] === 'wheat', 'must inherit Animal\'s own wheat rule');
anchor('pig', (r) => r.kind === 'items' && r.items.length === 3, 'must take exactly three items');
anchor('fox', (r) => r.kind === 'tag' && r.tags.length === 1, 'must take a tag');
anchor('wolf', (r) => r.kind === 'predicate', 'must be a predicate, not a list');
anchor('parrot', (r) => r.kind === 'none', 'must be unbreedable (isFood is a constant false)');
anchor('horse', (r) => r.items.includes('golden_apple') && r.items.includes('hay_block'), 'must take the horse food list');
stop();

// ------------------------------------------------------------ 8. write it
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
const out = [];
out.push('# breeding-1.18.2.tsv — generated by tools/extract-breeding.mjs from the 1.18.2 jar.');
out.push('# ⚠ NOTHING HERE IS TYPED IN. `AgeableMob` is the one class carrying the `ForcedAge` NBT');
out.push('#   key and `Animal` the one carrying `InLove`; every constant is read from the method');
out.push('#   that owns it and every food list from that species\' own `isFood` override.');
out.push('# constants:  !const  <name>  <ticks or age>');
out.push('# rows:       <entity>  <class>  <source>  <kind>  <comma-separated items>  <comma-separated tags>');
out.push('# kind: items = an explicit list · tag = an item tag · mixed = both · none = isFood is a');
out.push('#   constant false and the animal CANNOT be bred (parrot, polar bear) · predicate = a rule');
out.push('#   over the item itself (wolf: any edible item whose FoodProperties say meat), which is');
out.push('#   NOT expanded into a list here because in vanilla it is not one.');
out.push('# source: own = this class overrides isFood · inherit:<class> = it uses that one\'s rule.');
for (const [k, v] of Object.entries(CONSTS)) out.push('!const\t' + k + '\t' + v);
for (const r of rows) out.push([r.name || '-', r.cls, r.src, r.kind, r.items.join(','), r.tags.join(',')].join('\t'));
writeFileSync(OUT, out.join('\n') + '\n');
say(' wrote .............. ' + OUT + '  (' + rows.length + ' rows)');
