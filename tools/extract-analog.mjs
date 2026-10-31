#!/usr/bin/env node
// extract-analog.mjs — which blocks a COMPARATOR can read, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-analog.mjs [--if-missing]
//     -> tools/golden/signal-sources-1.18.2.tsv
//     -> tools/golden/analog-output-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. G15b needs two closed sets and NEITHER is in a data file, a tag or
// `minecraft-data`: which blocks emit redstone at all (`isSignalSource`), and which blocks a
// comparator can read a NUMBER out of (`hasAnalogOutputSignal`). Both are one-line Java
// overrides. G15a guessed the first one — "does this state have a `powered` property" — which
// is true of doors, trapdoors, fence gates, note blocks, rails, tripwire and bells, none of
// which is a source. A guess that is wrong in seven families is not a shortcut.
//
// ⚠ THE METHOD IS D-263's, AND THE OBFUSCATED METHOD NAMES ARE DERIVED, NOT LOOKED UP:
//
//   1. Disassemble every class in the jar and collect every `public boolean <name>(Lcov;)Z`
//      whose whole body is `iconst_1; ireturn`. That is the shape of both overrides and of
//      nothing else interesting — a one-line "yes" about a block state.
//   2. Group those by METHOD NAME. Two groups come out large enough to matter; which is which
//      is settled by ANCHORS THAT CANNOT BE IN DOUBT rather than by the obfuscated letter:
//      a LEVER is a redstone source and is not something a comparator reads a number out of;
//      a CHEST is the reverse. Each anchor must be in exactly one group, and each group must
//      contain its own anchor and not the other's — four assertions, not one.
//   3. Every class is named through `Blocks.<clinit>`, whose literal `ldc "<name>"` sits
//      immediately before the `new <class>` that builds that block — the same anchor the seven
//      earlier golden tables use. Abstract classes (the button, the pressure plate, the diode,
//      the torch) name no block themselves, so they are expanded through their SUBCLASSES,
//      which is where the twenty-two button and plate rows come from.
//
// ⚠ WHAT THE ANALOG TABLE'S SECOND COLUMN IS FOR. Knowing a chest is readable is half the
// answer; the comparator needs the FORMULA. Each row therefore carries the shape of its
// `getAnalogOutputSignal`, read from that method's own bytecode, so that `07f_redstone.js` can
// implement the ones whose inputs this engine actually has and `redcheck` can assert that every
// row is either implemented or on a named OWED list. A block that silently reads 0 is exactly
// the failure D-290 is about.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_SRC = join(MCLITE_ROOT, 'tools', 'golden', 'signal-sources-1.18.2.tsv');
const OUT_ANA = join(MCLITE_ROOT, 'tools', 'golden', 'analog-output-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT_SRC) && existsSync(OUT_ANA)) {
  say(' signal-sources / analog-output TSVs are present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSVs.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-analog-'));
say(` unpacking ${JAR}`);
execFileSync('unzip', ['-qo', JAR, '*.class', '-d', work]);
const classes = readdirSync(work).filter((f) => f.endsWith('.class'));
say(` ${classes.length} classes`);

// ── 1. disassemble everything, in batches (one javap per class is ten minutes) ──────────────
let dump = '';
for (let i = 0; i < classes.length; i += 400) {
  dump += execFileSync('javap', ['-p', '-c', '-constants', ...classes.slice(i, i + 400)],
    { cwd: work, maxBuffer: 1 << 30, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).toString();
}
const lines = dump.split('\n');
say(` ${lines.length.toLocaleString()} lines of bytecode`);

// ── 2. every `public boolean <name>(cov)` that is a bare `return true` ──────────────────────
const byMethod = new Map();                       // method name -> Set(class)
const bodies = new Map();                         // `class.method` -> flat body
let cls = null;
for (let i = 0; i < lines.length; i++) {
  const c = lines[i].match(/^(?:public |final |abstract |)*(?:class|interface) ([A-Za-z0-9$_]+)/);
  if (c) { cls = c[1]; continue; }
  const m = lines[i].match(/^ {2}public boolean ([a-zA-Z0-9_$]+)\(cov\);$/);
  if (!m) continue;
  const body = [];
  for (let j = i + 2; j < lines.length && lines[j].trim() !== ''; j++) {
    body.push(lines[j].replace(/^\s*\d+:\s*/, '').split('//')[0].trim());
  }
  const flat = body.join(' | ');
  bodies.set(cls + '.' + m[1], flat);
  // ⚠ ONE OF THE SIXTEEN IS NOT A LITERAL `true`, AND DROPPING IT WOULD HAVE LOST THE MOST
  // IMPORTANT ROW IN THE TABLE. `RedStoneWireBlock.isSignalSource` returns its own
  // `shouldSignal` FIELD — the suppression flag G15a had to reproduce — so its body is
  // `aload_0 | getfield | ireturn`. The first run of this extractor filtered it out and the
  // "redstone_wire is a signal source" assertion caught it, which is what that assertion is for.
  if (flat !== 'iconst_1 | ireturn' && !/^aload_0 \| getfield\s+\S+ \| ireturn$/.test(flat)) continue;
  if (!byMethod.has(m[1])) byMethod.set(m[1], new Set());
  byMethod.get(m[1]).add(cls);
}

// ── 3. name every class through `Blocks.<clinit>` ───────────────────────────────────────────
// The one hook: `Blocks.register(String name, Block block)` is called once per block, and the
// literal name is pushed first. Between the two lies exactly one expression that produces the
// block — usually `new <class>`, but seventeen shulker boxes and a few others come out of a
// static HELPER whose return type is in the descriptor. Taking "the last thing in this window
// whose type is a Block subclass" covers both, and the first version of this file — which took
// the last `new` only — filed all seventeen shulker boxes under the name `block`, which is the
// literal that happened to precede them. A name that is not in the registry is a mis-read, so
// that is asserted rather than shrugged at.
const childrenOf = new Map();
for (const l of lines) {
  // ⚠ GENERICS. javap prints `public class ceo extends cck<cmw> implements cjv {`, and a
  // parent pattern that stops at the `<` files ChestBlock under a parent called `cck<cmw>`
  // that nothing else mentions — so the chest fell out of the Block hierarchy entirely and
  // the chest anchor could not be found. Both names are taken without their type arguments.
  const m = l.match(/^(?:public |final |abstract |)*class ([A-Za-z0-9$_]+)(?:<[^>]*>)? extends ([A-Za-z0-9$_.]+)/);
  if (!m) continue;
  if (!childrenOf.has(m[2])) childrenOf.set(m[2], []);
  childrenOf.get(m[2]).push(m[1]);
}
// `Block` itself is the class `stone` is built from — found by use, not by name.
let BLOCK_BASE = null;
{
  let last = null;
  for (const l of lines) {
    let m = l.match(/^\s*\d+: ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
    if (m) { last = m[1]; continue; }
    m = l.match(/^\s*\d+: new\s+#\d+\s+\/\/ class ([A-Za-z0-9$_]+)$/);
    if (m && last === 'stone') { BLOCK_BASE = m[1]; break; }
  }
}
ok(!!BLOCK_BASE, 'found the Block base class through the `stone` registration');
const blockClasses = new Set();
(function walk(c) { if (!c || blockClasses.has(c)) return; blockClasses.add(c); for (const k of (childrenOf.get(c) || [])) walk(k); })(BLOCK_BASE);
ok(blockClasses.size > 150, `${blockClasses.size} Block subclasses, expected 150+`);

const namesOf = new Map();                        // class -> [block names]
{
  let last = null, cands = [];
  for (const l of lines) {
    let m = l.match(/^\s*\d+: ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
    if (m) { last = m[1]; cands = []; continue; }
    m = l.match(/^\s*\d+: new\s+#\d+\s+\/\/ class ([A-Za-z0-9$_]+)$/);
    if (m) { if (blockClasses.has(m[1])) cands.push(m[1]); continue; }
    // ⚠ THE REGISTER CALL IS ITSELF AN `invokestatic` RETURNING A BLOCK, so it has to be
    // tested BEFORE the "a helper produced a block" case below. Testing it after made every
    // register line push `Block` onto the candidate list and `continue`, so the window never
    // closed and the table came out with zero rows — a loop that read 1.4 million lines and
    // found nothing, which is only visible because the row-count assertions exist.
    const isRegister = /invokestatic\s+#\d+\s+\/\/ Method a:\(Ljava\/lang\/String;L[A-Za-z0-9$_]+;\)L[A-Za-z0-9$_]+;$/.test(l);
    if (!isRegister) {
      m = l.match(/^\s*\d+: invokestatic\s+#\d+\s+\/\/ Method [^\s]*?\)L([A-Za-z0-9$_]+);$/);
      if (m) { if (blockClasses.has(m[1])) cands.push(m[1]); continue; }
    }
    if (isRegister && last && cands.length) {
      const c = cands[cands.length - 1];
      if (!namesOf.has(c)) namesOf.set(c, []);
      if (!namesOf.get(c).includes(last)) namesOf.get(c).push(last);
      last = null; cands = [];
    }
  }
}
ok(namesOf.size > 200, `Blocks.<clinit> named ${namesOf.size} block classes, expected 200+`);
{
  let total = 0;
  for (const ns of namesOf.values()) total += ns.length;
  ok(total > 700, `${total} block names registered, expected 700+ (1.18.2 has 898)`);
}

/** every block this class or its subclasses register, as [name, the class that registered it] */
function blocksFor(c, seen) {
  seen = seen || new Set();
  if (seen.has(c)) return [];
  seen.add(c);
  const out = (namesOf.get(c) || []).map((n) => [n, c]);
  for (const k of (childrenOf.get(c) || [])) out.push(...blocksFor(k, seen));
  return out;
}
const namesUnder = (c) => blocksFor(c).map((r) => r[0]);

// ── 4. WHICH group is which, by anchors that cannot be in doubt ─────────────────────────────
// A lever emits redstone and holds no number. A chest holds a number and emits nothing.
const groups = [...byMethod.entries()].filter(([, s]) => s.size >= 10);
const nameOfClass = (want) => [...namesOf.entries()].find(([, ns]) => ns.includes(want));
const leverClass = (nameOfClass('lever') || [])[0];
const chestClass = (nameOfClass('chest') || [])[0];
ok(!!leverClass, 'found the lever class through Blocks.<clinit>');
ok(!!chestClass, 'found the chest class through Blocks.<clinit>');

const hasLever = groups.filter(([, s]) => [...s].some((c) => namesUnder(c).includes('lever')));
const hasChest = groups.filter(([, s]) => [...s].some((c) => namesUnder(c).includes('chest')));
ok(hasLever.length === 1, `exactly one method group contains the lever (got ${hasLever.length})`);
ok(hasChest.length === 1, `exactly one method group contains the chest (got ${hasChest.length})`);
if (failures) { say(` ${failures} anchors failed — refusing to write a table`); process.exit(1); }
const SIG = hasLever[0][0], ANA = hasChest[0][0];
ok(SIG !== ANA, `isSignalSource (${SIG}) and hasAnalogOutputSignal (${ANA}) are different methods`);
// and the reverse direction, which is the one that catches a group that swallowed both
ok(!namesUnder([...byMethod.get(SIG)].find((c) => namesUnder(c).includes('lever'))).includes('chest'),
   'the lever group does not also carry the chest');
{
  const fieldish = [...byMethod.get(SIG)].filter((c) => /getfield/.test(bodies.get(c + '.' + SIG) || ''));
  ok(fieldish.length === 1 && namesUnder(fieldish[0]).includes('redstone_wire'),
     'exactly one signal source answers from a FIELD rather than a literal, and it is the wire');
}
say(` isSignalSource        -> ${SIG}(cov)   ${byMethod.get(SIG).size} classes`);
say(` hasAnalogOutputSignal -> ${ANA}(cov)   ${byMethod.get(ANA).size} classes`);

// ── 5. the analog FORMULA, per class, out of `getAnalogOutputSignal`'s own bytecode ─────────
// The shapes, each read from a body rather than assumed:
//   container   `... getBlockEntity(pos) ; <static>(...)`    the 14/1 count formula
//   state:<p>   the block's own int property, returned as is
//   const:<n>   a literal
//   derived     a small arithmetic expression on a property  (cake: (7 - bites) * 2)
//   entity      needs an ENTITY or an item this engine has no model for
const analogBody = new Map();
for (let i = 0; i < lines.length; i++) {
  const c = lines[i].match(/^(?:public |final |abstract |)*(?:class|interface) ([A-Za-z0-9$_]+)/);
  if (c) { cls = c[1]; continue; }
  if (!/^ {2}public int a\(cov, cav, gj\);$/.test(lines[i])) continue;
  const body = [];
  for (let j = i + 2; j < lines.length && lines[j].trim() !== ''; j++) body.push(lines[j]);
  analogBody.set(cls, body.join('\n'));
}
// The two static helpers every container block ends up in, found BY USE below rather than
// spelled here: `hopper` is a container and nothing else, so whatever static its
// `getAnalogOutputSignal` calls IS the container formula, and `chest` (a double chest, hence a
// different overload) gives the second.
const CONTAINER_HELPERS = [];
{
  const findStatic = (blockName) => {
    const hit = [...namesOf.entries()].find(([, ns]) => ns.includes(blockName));
    const body = hit ? analogBody.get(hit[0]) : undefined;
    if (!body) return null;
    const calls = [...body.matchAll(/invokestatic\s+#\d+\s+\/\/ (Method \S+)/g)].map((m) => m[1]);
    return calls.length ? calls[calls.length - 1] : null;
  };
  for (const anchor of ['hopper', 'chest', 'shulker_box']) {
    const h = findStatic(anchor);
    if (h && !CONTAINER_HELPERS.includes(h)) CONTAINER_HELPERS.push(h);
  }
  ok(CONTAINER_HELPERS.length >= 2,
     `found ${CONTAINER_HELPERS.length} container helpers via hopper/chest, expected 2+`);
}

const parentOf = new Map();
for (const [par, kids] of childrenOf) for (const k of kids) parentOf.set(k, par);
function shapeOf(c0) {
  // ⚠ THE CLASS THAT SAYS "YES" IS NOT ALWAYS THE CLASS THAT ANSWERS. `AbstractCauldronBlock`
  // declares `hasAnalogOutputSignal`, and the three cauldrons each override the VALUE in their
  // own subclass. Looking the shape up on the declaring class alone filed all three as
  // "inherited", which is a row that says nothing.
  let c = c0, b;
  while (c && (b = analogBody.get(c)) === undefined) c = parentOf.get(c);
  if (b === undefined) return ['inherited', 'no getAnalogOutputSignal anywhere up the chain'];
  // ⚠ THE CONTAINER FORMULA IS IDENTIFIED BY THE HELPER IT CALLS, NOT BY THE WORD "CONTAINER".
  // `AbstractContainerMenu.getRedstoneSignalFromContainer` takes a `Container` and a chest's
  // double-chest variant takes a `CompoundContainer`; both end in the same static. Matching on
  // "reads a block entity and calls a static" put the CHEST in the `other` bucket, because the
  // chest reaches its container through a helper of its own first.
  // ⚠ ENTITIES FIRST, AND THE DETECTOR RAIL IS WHY. Its `getAnalogOutputSignal` searches the
  // rail's own bounding box for a minecart and asks THAT for a container — so the container
  // helper does appear in its bytecode, and a container-first test filed a rail as a chest.
  // The tell is `getEntitiesOfClass`: a class literal handed to a predicate-taking call.
  if (/ldc\s+#\d+\s+\/\/ class /.test(b) && /java\/util\/function\/Predicate/.test(b)) {
    return ['entity', 'searches for an entity — this engine has no entities yet (G18)'];
  }
  if (CONTAINER_HELPERS.some((h) => b.includes(h))) {
    return ['container', 'AbstractContainerMenu.getRedstoneSignalFromContainer'];
  }
  const lit = b.match(/^\s*0: (?:iconst_(\d)|bipush\s+(\d+))\n\s*\d+: ireturn/);
  if (lit) return ['const', lit[1] || lit[2]];
  // a constant held in a static field — the candle cake's `CakeBlock.FULL_CAKE_SIGNAL`
  const stat = b.match(/^\s*0: getstatic\s+#\d+\s+\/\/ Field ([A-Za-z0-9$_.]+):I\n\s*\d+: ireturn/);
  if (stat) return ['const', 'static ' + stat[1]];
  if (/instanceof/.test(b)) return ['entity', 'reads a block entity field this engine has no model for'];
  if (/imul|isub|iadd/.test(b) || /invokestatic\s+#\d+\s+\/\/ Method \w+:\(Lcov;?I?\)I/.test(b) || /invokestatic\s+#\d+\s+\/\/ Method \w+:\(I\)I/.test(b)) return ['derived', 'arithmetic on a property'];
  if (/Boolean\.booleanValue/.test(b)) return ['bool', 'a boolean property, 15 or 0'];
  if (/Integer\.intValue/.test(b)) return ['level', 'an int property, returned as is'];
  return ['other', ''];
}

// ── 6. write ────────────────────────────────────────────────────────────────────────────────
function rows(method) {
  const out = [];
  for (const c of byMethod.get(method)) out.push(...blocksFor(c));
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
const srcRows = rows(SIG);
const anaRows = rows(ANA);
ok(srcRows.length >= 30, `${srcRows.length} signal sources, expected 30+ once the buttons and plates expand`);
ok(anaRows.length >= 25, `${anaRows.length} analog blocks, expected 25+`);
for (const must of ['lever', 'redstone_wire', 'redstone_torch', 'repeater', 'comparator',
                    'observer', 'redstone_block', 'tripwire_hook']) {
  ok(srcRows.some((r) => r[0] === must), `${must} is a signal source`);
}
for (const mustNot of ['oak_door', 'note_block', 'oak_trapdoor', 'oak_fence_gate', 'bell',
                       'powered_rail', 'tripwire', 'redstone_lamp']) {
  ok(!srcRows.some((r) => r[0] === mustNot), `${mustNot} is NOT a signal source (G15a thought it was)`);
}
for (const must of ['chest', 'hopper', 'barrel', 'furnace', 'composter', 'cake', 'beehive']) {
  ok(anaRows.some((r) => r[0] === must), `${must} has an analog output`);
}
for (const mustNot of ['lever', 'redstone_wire', 'stone']) {
  ok(!anaRows.some((r) => r[0] === mustNot), `${mustNot} has NO analog output`);
}

writeFileSync(OUT_SRC,
  '# isSignalSource — every block that emits redstone in 1.18.2.\n' +
  `# Derived by tools/extract-analog.mjs from ${SIG}(cov) overrides in the jar. Do not hand-edit.\n` +
  '# block\tclass\n' +
  srcRows.map((r) => r.join('\t')).join('\n') + '\n');

writeFileSync(OUT_ANA,
  '# hasAnalogOutputSignal — every block a comparator can read a NUMBER out of in 1.18.2.\n' +
  `# Derived by tools/extract-analog.mjs from ${ANA}(cov) overrides in the jar. Do not hand-edit.\n` +
  '# block\tclass\tshape\tnote\n' +
  anaRows.map(([n, c]) => { const [s, d] = shapeOf(c); return [n, c, s, d].join('\t'); }).join('\n') + '\n');

say(` wrote ${srcRows.length} signal sources -> tools/golden/signal-sources-1.18.2.tsv`);
say(` wrote ${anaRows.length} analog blocks  -> tools/golden/analog-output-1.18.2.tsv`);
if (failures) { say(` ${failures} assertions failed`); process.exit(1); }
say(' extract-analog: OK');
