#!/usr/bin/env node
// extract-blockitems.mjs — PLAN G7/G10 (D-331). WHICH ITEM PLACES WHICH BLOCK, out of the BYTECODE.
//
//   node tools/extract-blockitems.mjs   -> tools/golden/blockitems-1.18.2.tsv
//
// ⚠⚠ WHY THIS EXISTS, and it is the largest single thing this project has had wrong. Dan,
// session 11: *"some items like zombie eggs and candles dont work and place"*. It is not two
// items. It is **two hundred and twelve**.
//
// The engine decided "can this item be placed, and as what" from ONE precomputed number,
// `Items.state[i]`, and `pack-items.mjs` wrote that number only when `kind === 'block'` — where
// `kind` is set by whether the item's INVENTORY MODEL inherits from a `block/...` parent.
// ⚠⚠ **THAT IS A RENDERING FACT STANDING IN FOR A GAMEPLAY FACT.** Vanilla's set of BlockItems
// and vanilla's set of items drawn as 3D blocks are not the same set, and every BlockItem whose
// icon is a flat sprite falls out of the gap between them: every candle, torch, door, sign, rail,
// lever, repeater, sapling, flower, ladder, lantern, chain, glass pane, iron bar, cake, hopper,
// sea pickle and turtle egg, plus every `builtin/entity` one — beds, banners, chests, shulker
// boxes, skulls. All of them got the sentinel 0xFFFF, `syncHotbar` left the hotbar slot at 0, and
// `Player.placeBlock` refused on its second line **with no swing, no sound and no message**.
//
// ⚠ AND THE CANDLE RULE WAS ALREADY IMPLEMENTED, TWICE, CORRECTLY, AND WAS UNREACHABLE.
// `States.canBeReplacedBy` and `Player.stackOnto` both carry vanilla's `candles < 4` increment and
// `placecheck` §3 and §4 assert it — by driving them with raw block STATES. **A check that enters
// the system below the broken layer cannot see the broken layer.**
//
// ⚠ AND THE BUILD REPORTED SUCCESS: `pack-items` printed "block items ........ 558 (default state
// resolved)" and warned only when its `noState` list was non-empty, which it never was, because
// an item that was never classified as a block is never asked for a state. **A report of what
// worked is not a report of what was attempted.**
//
// ── HOW EACH THING IS IDENTIFIED, AND WHY IT CANNOT BE A COINCIDENCE (D-263) ────────────────
//   1. A REGISTRY CLASS is any class whose `<clinit>` assigns 100 or more of its own static
//      fields of one type. In 1.18.2 that is a short list, and the two that matter are found by
//      their RELATIONSHIP rather than by their size: `Items` is the registry class whose
//      `<clinit>` reads hundreds of fields OF ANOTHER registry class, and `Blocks` is the class
//      it reads them from. Nothing else in the jar has that shape.
//   2. A REGISTRY NAME is the FIRST `ldc String` after the previous `putstatic` — the first
//      argument of `register(String, T)`, which is pushed before the thing being registered is
//      constructed. "First since the last store", not "last before the next store": a block's
//      constructor can carry strings of its own and the registry name is always the earliest.
//   3. AN ITEM'S BLOCK is the first `Blocks` field read in that item's own segment. `Items`
//      registers a BlockItem two ways — `registerBlock(Block, ...)`, where the item takes the
//      BLOCK's name, and `registerItem("name", new SomeBlockItem(Blocks.X, ...))`, where it does
//      not — and the difference is exactly whether the segment carries a string of its own. That
//      is what makes `wheat_seeds -> wheat` and `redstone -> redstone_wire` fall out rather than
//      having to be typed. ⚠ Two Blocks fields in one segment is a standing-and-wall pair
//      (`oak_sign` / `oak_wall_sign`); the FIRST is the one `BlockItem.getBlock` returns, and the
//      second is recorded in its own column rather than thrown away.
//   4. A SPAWN EGG is an instance of the class constructed exactly once per egg — found by being
//      the most-constructed class in `Items.<clinit>` whose first constructor parameter is a
//      registry class's own field type. Its entity is the field it is handed.
//
// ⚠ CLOSED IN BOTH DIRECTIONS. Every item name produced must be in the item registry and every
// block name in the block registry; the number of items found must equal the registry's own item
// count; and no item may appear twice. A table that is merely plausible is not a referee.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'blockitems-1.18.2.tsv');
const REG = join(MCLITE_ROOT, '.mcdata', '1.18.2', '_registries.json');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' blockitems-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

say('extract-blockitems — which item places which block, out of the 1.18.2 bytecode');

const work = mkdtempSync(join(tmpdir(), 'mclite-bi-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);
const all = execFileSync('bash', ['-c',
  'cd ' + JSON.stringify(work) + " && find . -name '*.class' ! -name '*$*' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
  { maxBuffer: 1 << 28 }).toString().trim().split('\n').filter(Boolean);
say(' top-level classes ............ ' + all.length);

const javap = (args, names) => {
  let out = '';
  for (let i = 0; i < names.length; i += 400) {
    out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 400)],
      { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  }
  return out.split('\n').filter((l) => !l.startsWith('Picked up'));
};

// ── 1. the registry classes, by shape then by relationship ────────────────────────────────────
// A registry class declares 100+ public static final fields of ONE type. That is a handful of
// classes; which of them is Items and which is Blocks is decided by who reads whom.
const staticOf = new Map();          // class -> Map(type -> count)
{
  let cur = null;
  for (const l of javap(['-p'], all)) {
    const d = l.match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && l.trimEnd().endsWith('{')) { cur = d[1]; continue; }
    if (!cur) continue;
    // ⚠ THE TYPE MAY BE GENERIC — `axo<bkc> a;` — so the type is taken up to the first `<`.
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
say(' registry classes .............. ' + registries.map((r) => r.klass + '(' + r.n + ')').join(' '));
ok(registries.length >= 2 && registries.length <= 12,
   registries.length + ' classes declare 100+ static finals of one type — that is not a registry set');

const clinitOf = new Map();
for (const r of registries) {
  const lines = javap(['-p', '-c'], [r.klass]);
  const i = lines.findIndex((l) => /^\s{2}static \{\};\s*$/.test(l));
  clinitOf.set(r.klass, i < 0 ? [] : lines.slice(i));
}
// Items is the registry class that READS another registry class hundreds of times.
let ITEMS = null, BLOCKS = null, bestReads = 0;
for (const r of registries) {
  for (const o of registries) {
    if (o.klass === r.klass) continue;
    const re = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + o.klass.replace(/\$/g, '\\$') + '\\.');
    const reads = clinitOf.get(r.klass).filter((l) => re.test(l)).length;
    if (reads > bestReads) { bestReads = reads; ITEMS = r; BLOCKS = o; }
  }
}
ok(!!ITEMS && bestReads >= 300,
   'no registry class reads another one hundreds of times in its <clinit> — Items was not found');
if (!ITEMS) { say('FAILED'); process.exit(1); }
say(' Items ......................... ' + ITEMS.klass + ' (' + ITEMS.n + ' fields of ' + ITEMS.type + ')');
say(' Blocks ........................ ' + BLOCKS.klass + ' (' + BLOCKS.n + ' fields of ' + BLOCKS.type + '), ' +
    bestReads + ' reads');

// ── 2. field -> registry name, for any registry class ─────────────────────────────────────────
// ⚠ THE FIRST STRING SINCE THE LAST STORE. `register("stone", new Block(...))` pushes the name
// before it builds the block, and a block's own constructor can carry strings; taking the LAST
// string before the store would give one of those instead, silently, for exactly the blocks whose
// constructors are interesting.
const STR = /\bldc(?:_w)?\s+#\d+\s+\/\/ String (\S.*?)\s*$/;
function namesOf(klass, type) {
  const put = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + type.replace(/[.$]/g, (c) => '\\' + c) + ';');
  const out = new Map();
  let first = null, n = 0;
  for (const l of clinitOf.get(klass) || []) {
    const s = l.match(STR);
    if (s && first === null) { first = s[1]; continue; }
    const p = l.match(put);
    if (!p) continue;
    n++;
    if (first !== null) out.set(p[1], first);
    first = null;
  }
  return { map: out, stores: n };
}
const blockNames = namesOf(BLOCKS.klass, BLOCKS.type);
say(' block names ................... ' + blockNames.map.size + ' of ' + blockNames.stores + ' stores');
ok(blockNames.map.size === blockNames.stores,
   (blockNames.stores - blockNames.map.size) + ' block fields were stored with no name before them');

// ── 3. the spawn-egg class, by use ────────────────────────────────────────────────────────────
// The most-constructed class in Items.<clinit> whose first constructor parameter is some registry
// class's own field type. That parameter type IS the EntityType class, found the same way.
const itemsClinit = clinitOf.get(ITEMS.klass);
const built = new Map();
for (const l of itemsClinit) {
  const m = l.match(/\bnew\s+#\d+\s+\/\/ class ([\w$]+)/);
  if (m) built.set(m[1], (built.get(m[1]) || 0) + 1);
}
const ctorArg = new Map();       // class -> first ctor parameter type, as used here
for (const l of itemsClinit) {
  const m = l.match(/invokespecial\s+#\d+\s+\/\/ Method ([\w$]+)\."<init>":\(L([\w/$]+);/);
  if (m && !ctorArg.has(m[1])) ctorArg.set(m[1], m[2].replace(/\//g, '.'));
}
let EGG = null, ENTITY = null;
for (const [klass, n] of [...built].sort((a, b) => b[1] - a[1])) {
  const arg = ctorArg.get(klass);
  if (!arg) continue;
  const reg = registries.find((r) => r.type === arg && r.klass !== BLOCKS.klass && r.klass !== ITEMS.klass);
  if (reg && n >= 20) { EGG = { klass, n }; ENTITY = reg; break; }
}
ok(!!EGG, 'no item class is constructed 20+ times with a registry type as its first argument — ' +
          'the spawn eggs were not found');
let entityNames = { map: new Map(), stores: 0 };
if (EGG) {
  entityNames = namesOf(ENTITY.klass, ENTITY.type);
  say(' spawn eggs .................... ' + EGG.klass + ' x' + EGG.n +
      ', EntityType = ' + ENTITY.klass + ' (' + entityNames.map.size + ' names)');
}

// ── 4. walk Items.<clinit>, one field at a time ───────────────────────────────────────────────
const putItem = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + ITEMS.type.replace(/[.$]/g, (c) => '\\' + c) + ';');
const getBlock = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + BLOCKS.klass.replace(/\$/g, '\\$') + '\\.(\\w+):');
const getEntity = ENTITY
  ? new RegExp('getstatic\\s+#\\d+\\s+// Field ' + ENTITY.klass.replace(/\$/g, '\\$') + '\\.(\\w+):')
  : null;
const newEgg = EGG ? new RegExp('\\bnew\\s+#\\d+\\s+// class ' + EGG.klass.replace(/\$/g, '\\$') + '\\b') : null;

const rows = [];
let seg = { strings: [], blocks: [], entities: [], egg: false };
for (const l of itemsClinit) {
  const s = l.match(STR); if (s) seg.strings.push(s[1]);
  const b = l.match(getBlock); if (b) seg.blocks.push(b[1]);
  if (getEntity) { const e = l.match(getEntity); if (e) seg.entities.push(e[1]); }
  if (newEgg && newEgg.test(l)) seg.egg = true;
  const p = l.match(putItem);
  if (!p) continue;
  const explicit = seg.strings.length ? seg.strings[0] : null;
  const blockField = seg.blocks.length ? seg.blocks[0] : null;
  const block = blockField ? blockNames.map.get(blockField) : null;
  const name = explicit || block;
  if (name) {
    rows.push({
      name,
      block: block || '-',
      second: seg.blocks.length > 1 ? (blockNames.map.get(seg.blocks[1]) || '-') : '-',
      egg: seg.egg && seg.entities.length ? (entityNames.map.get(seg.entities[0]) || '-') : '-',
      named: explicit ? 1 : 0
    });
  }
  seg = { strings: [], blocks: [], entities: [], egg: false };
}
say(' items walked .................. ' + rows.length + ' of ' + ITEMS.n + ' fields');

// ── 5. closure, in both directions ────────────────────────────────────────────────────────────
ok(rows.length === ITEMS.n, rows.length + ' items produced from ' + ITEMS.n + ' static fields');
{
  const seen = new Set();
  const dup = rows.filter((r) => (seen.has(r.name) ? true : (seen.add(r.name), false)));
  ok(dup.length === 0, dup.length + ' items appear twice: ' + dup.slice(0, 5).map((r) => r.name).join(' '));
}
if (existsSync(REG)) {
  const reg = JSON.parse(readFileSync(REG, 'utf8'));
  const items = new Set(reg.item), blocks = new Set(reg.block), ents = new Set(reg.entity_type);
  const badI = rows.filter((r) => !items.has(r.name));
  const badB = rows.filter((r) => r.block !== '-' && !blocks.has(r.block));
  const badE = rows.filter((r) => r.egg !== '-' && !ents.has(r.egg));
  ok(badI.length === 0, badI.length + ' produced names are not items: ' + badI.slice(0, 6).map((r) => r.name).join(' '));
  ok(badB.length === 0, badB.length + ' produced blocks are not blocks: ' + badB.slice(0, 6).map((r) => r.block).join(' '));
  ok(badE.length === 0, badE.length + ' produced entities are not entity types: ' + badE.slice(0, 6).map((r) => r.egg).join(' '));
  ok(rows.length === reg.item.length,
     rows.length + ' items found, the registry has ' + reg.item.length);
  const produced = new Set(rows.map((r) => r.name));
  const missing = reg.item.filter((n) => !produced.has(n));
  ok(missing.length === 0, missing.length + ' registry items are missing from the table: ' + missing.slice(0, 8).join(' '));
  const eggs = rows.filter((r) => r.egg !== '-');
  const regEggs = reg.item.filter((n) => n.endsWith('_spawn_egg'));
  ok(eggs.length === regEggs.length,
     eggs.length + ' spawn eggs found, the registry has ' + regEggs.length);
  ok(eggs.every((r) => r.name.endsWith('_spawn_egg')),
     'something that is not named a spawn egg was read as one');
  say(' registry closure .............. items ' + rows.length + '/' + reg.item.length +
      ' · eggs ' + eggs.length + '/' + regEggs.length);
}
const placeable = rows.filter((r) => r.block !== '-');
const renamed = rows.filter((r) => r.block !== '-' && r.block !== r.name);
say(' block items ................... ' + placeable.length +
    ' (' + renamed.length + ' whose block is not their own name)');
ok(placeable.length > 500 && placeable.length < ITEMS.n,
   placeable.length + ' block items out of ' + ITEMS.n + ' — that is not a plausible split');
ok(renamed.length >= 5,
   'only ' + renamed.length + ' items place a block of a different name — the string rule is not firing');
say('   renamed: ' + renamed.map((r) => r.name + '->' + r.block).join(' '));

// ── 6. the table ──────────────────────────────────────────────────────────────────────────────
const lines = [
  '# blockitems-1.18.2.tsv — read out of the 1.18.2 bytecode by tools/extract-blockitems.mjs',
  '# Items = ' + ITEMS.klass + '   Blocks = ' + BLOCKS.klass +
    (ENTITY ? '   EntityType = ' + ENTITY.klass + '   SpawnEggItem = ' + EGG.klass : ''),
  '# block  = the block this item places, or - if it places nothing',
  '# second = the second block a standing-and-wall item carries (the wall variant), or -',
  '# egg    = the entity a spawn egg summons, or -',
  '# named  = 1 when the item was registered with its own name string, 0 when it took the block\'s',
  'item\tblock\tsecond\tegg\tnamed',
  ...rows.map((r) => [r.name, r.block, r.second, r.egg, r.named].join('\t')),
];
mkdirSync(join(MCLITE_ROOT, 'tools', 'golden'), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
say('');
say(' -> ' + OUT.slice(MCLITE_ROOT.length));
if (failures) { say(' ' + failures + ' FAILURES'); process.exit(1); }
say(' 0 failures');
