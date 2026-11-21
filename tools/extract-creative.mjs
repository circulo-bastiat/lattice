#!/usr/bin/env node
// extract-creative.mjs — PLAN G11b. THE CREATIVE INVENTORY'S TABS, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-creative.mjs   -> tools/golden/creative-tabs-1.18.2.tsv
//
// ⚠⚠ **WHY THIS EXISTS AND WHY A REGEX LIST WAS WRONG.** The first draft of `15e_creative.js`
// classified items into tabs with eight ordered regular expressions typed from memory. It was
// wrong before it ran: it had ELEVEN tabs in an invented order, no `hotbar` tab at all, and
// `search` first instead of sixth. That file's own header says the contents must come from the
// item table and not from a list typed here — and then the file typed a list. A hand-written
// classification is a SECOND ROSTER free to disagree with the game's, which is the exact mistake
// D-304 caught in `guicheck`. This is the twelfth table D-263's referee technique has produced.
//
// ── HOW EACH CLASS IS IDENTIFIED, AND WHY THE ANSWER CANNOT BE A COINCIDENCE ─────────────────
//   1. `CreativeModeTab` is the class with 12-14 static finals OF ITS OWN TYPE whose `<clinit>`
//      passes a `(int, String)` pair to each constructor. ⚠ THE STRINGS ARE CLOSED AGAINST A
//      SOURCE THIS TOOL DID NOT GENERATE: the jar's own `lang/en_us.json` has exactly thirteen
//      `itemGroup.*` keys, and the constructed set plus the one ALIAS must equal it exactly, in
//      both directions. Thirteen keys and twelve constructions is not an error — `materials` is
//      a second name for `misc`, and the bytecode says so by storing one field into another.
//   2. ⚠ THE `int` IS NOT AN ORDINAL, IT IS THE COLUMN. Vanilla's tab strip is 6 wide and 2 deep
//      and the constructor's first argument is the cell. Reading it as a declaration index gives
//      a screen whose tabs are in the right order and the wrong PLACES: `misc` is declared fifth
//      and sits in cell 6, `search` is declared sixth and sits in cell 5, `hotbar` is declared
//      twelfth and sits in cell 4. Every one of those is off by at least one.
//   3. `Items` is the class with 1000+ static finals of one other type whose `<clinit>` reads
//      CreativeModeTab fields (1,083 times). `Blocks` is the 850-1000-field class that the same
//      `<clinit>` reads for its block items.
//   4. Each registration is one straight-line segment ending in `putstatic <f>:LItem;`. The name
//      is the segment's `ldc String` when it has one and otherwise its FIRST `Blocks` field —
//      first, because `StandingAndWallBlockItem` reads two and the item is named for the
//      standing one. The tab is the segment's `getstatic CreativeModeTab` field, or none.
//   5. ⚠⚠ **THE WALK IS CLOSED AGAINST THE REGISTRY.** The 1,101 names this produces must equal
//      the 1,101 items in `.mcdata/1.18.2/_registries.json` EXACTLY, both directions. A segment
//      boundary off by one, a missed helper, a block field read as an item — every one of those
//      changes the set, and the set is pinned to a file this tool did not write.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';
import { Jar } from './jarlib.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'creative-tabs-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' creative-tabs-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

// ── the two sources this tool does NOT generate ─────────────────────────────────────────────
const lang = JSON.parse(Buffer.from(new Jar(JAR).read('assets/minecraft/lang/en_us.json')).toString('utf8'));
const LANG_KEYS = new Set(Object.keys(lang).filter((k) => k.startsWith('itemGroup.'))
  .map((k) => k.slice('itemGroup.'.length)));
const REG = JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcdata', '1.18.2', '_registries.json'), 'utf8')).item;
const REG_ITEMS = new Set(Object.values(REG));
say(' lang itemGroup keys  ' + LANG_KEYS.size);
say(' registry items ..... ' + REG_ITEMS.size);

const work = mkdtempSync(join(tmpdir(), 'mclite-cre-'));
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

  // ── 1. the three classes, by shape ────────────────────────────────────────────────────────
  const sigs = javap(['-p'], all);
  let cur = null;
  const selfCount = new Map(), fieldsOf = new Map();
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |static |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && line.trimEnd().endsWith('{')) { cur = d[1]; continue; }
    if (!cur) continue;
    const f = line.trim().match(/^(?:public |protected |private |)?static final ([\w.$]+) (\w+);$/);
    if (!f) continue;
    if (f[1] === cur) selfCount.set(cur, (selfCount.get(cur) || 0) + 1);
    if (!fieldsOf.has(cur)) fieldsOf.set(cur, new Map());
    const m = fieldsOf.get(cur);
    m.set(f[1], (m.get(f[1]) || 0) + 1);
  }

  // CreativeModeTab: 12-14 own-type static finals, and its <clinit> must mention every lang key.
  let TAB = null;
  for (const [c, n] of selfCount) {
    if (n < 12 || n > 14) continue;
    const code = javap(['-p', '-c'], [c]).join('\n');
    const got = new Set([...code.matchAll(/\/\/ String ([A-Za-z]+)$/gm)].map((x) => x[1]));
    let hit = 0; for (const k of LANG_KEYS) if (got.has(k)) hit++;
    if (hit >= LANG_KEYS.size - 1) { TAB = c; break; }
  }
  ok(!!TAB, 'no CreativeModeTab: no 12-14-own-field class whose <clinit> names the itemGroup keys');
  if (!TAB) throw new Error('stop');
  say(' CreativeModeTab .... ' + TAB);

  // Items: 1000+ static finals of one type, whose <clinit> reads TAB fields.
  let ITEMS = null, ITEMTYPE = null, tabReads = 0;
  for (const [c, m] of fieldsOf) {
    for (const [t, n] of m) {
      if (n < 1000 || t === c) continue;
      const code = javap(['-p', '-c'], [c]).join('\n');
      const r = (code.match(new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(TAB) + '\\.', 'g')) || []).length;
      if (r > 500) { ITEMS = c; ITEMTYPE = t; tabReads = r; }
    }
    if (ITEMS) break;
  }
  ok(!!ITEMS, 'no Items: no class with 1000+ fields of one type whose <clinit> reads ' + TAB);
  if (!ITEMS) throw new Error('stop');
  say(' Items .............. ' + ITEMS + ' of ' + ITEMTYPE + '  (' + tabReads + ' tab reads)');

  const itemCode = javap(['-p', '-c'], [ITEMS]);
  const ici = itemCode.findIndex((l) => l.trim().startsWith('static {}'));
  ok(ici >= 0, ITEMS + ' has no <clinit>');

  // Blocks: the 850-1000-own-field class Items.<clinit> reads.
  const readTypes = new Map();
  for (const l of itemCode.slice(ici)) {
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field ([\w.$]+)\.\w+:L([\w/$]+);/);
    if (g) readTypes.set(g[1], (readTypes.get(g[1]) || 0) + 1);
  }
  // ⚠ NOT own-type: `Blocks` holds fields of `Block`, and `Blocks` is not a `Block`. The shape is
  // "850-1000 static finals OF ONE OTHER TYPE, read by Items.<clinit>", which in this jar is one
  // class and nothing else.
  let BLOCKS = null, BLOCKCOUNT = 0;
  for (const [c] of [...readTypes].sort((a, b) => b[1] - a[1])) {
    const m = fieldsOf.get(c); if (!m) continue;
    for (const [t, n] of m) {
      if (t !== c && n >= 850 && n <= 1000) { BLOCKS = c; BLOCKCOUNT = n; break; }
    }
    if (BLOCKS) break;
  }
  ok(!!BLOCKS, 'no Blocks: Items.<clinit> reads no class with 850-1000 static finals of one type');
  if (!BLOCKS) throw new Error('stop');
  say(' Blocks ............. ' + BLOCKS + ' (' + BLOCKCOUNT + ' fields)');

  // ── 2. the tab table — column and lang key per field ──────────────────────────────────────
  const tabCode = javap(['-p', '-c'], [TAB]);
  const tci = tabCode.findIndex((l) => l.trim().startsWith('static {}'));
  const tabOf = new Map();                       // TAB field -> { col, lang, alias }
  const aliasOf = new Map();
  // ⚠⚠ THE COLUMN IS THE INT **IMMEDIATELY BEFORE THE LANG STRING**, and nothing looser will do.
  // `CreativeModeTab(int, String)` takes them adjacent, but four of these constructions go on to
  // build an array of enchantment categories — `bipush 12; anewarray; iconst_0; ... aastore` —
  // and "the last int before the putstatic" reads the array's length or its final index instead.
  // That gave tools column 3 (it is 8) and combat column 11 (it is 9): a tab strip with two tabs
  // stacked on one cell and two cells empty, from a rule that looked right on the first five.
  {
    let lastInt = null, col = null, langId = null, impl = null;
    const INT = /^\s*\d+:\s+(?:iconst_(\d)|bipush\s+(-?\d+)|sipush\s+(-?\d+))\s*$/;
    for (const l of tabCode.slice(tci)) {
      const iv = l.match(INT);
      if (iv) { lastInt = parseInt(iv[1] !== undefined ? iv[1] : iv[2] !== undefined ? iv[2] : iv[3], 10); continue; }
      const nw = l.match(/new\s+#\d+\s+\/\/ class ([\w.$]+)$/);
      if (nw) { impl = nw[1]; continue; }
      const st = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([A-Za-z]+)$/);
      if (st && LANG_KEYS.has(st[1])) { langId = st[1]; col = lastInt; continue; }
      const ali = l.match(new RegExp('getstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(TAB) + ';'));
      if (ali && tabOf.has(ali[1])) { col = tabOf.get(ali[1]).col; langId = null; aliasOf.set(ali[1], true); continue; }
      const pu = l.match(new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(TAB) + ';'));
      if (pu) {
        if (col === null) { failures++; say('   x tab field ' + pu[1] + ' has no column'); }
        tabOf.set(pu[1], { col: col, lang: langId, alias: langId === null, impl: impl });
        lastInt = null; col = null; langId = null; impl = null;
      }
    }
  }
  // ⚠ the alias's own lang key: the field that copied another field's column has no `ldc` of its
  // own, and the key it is missing is the one the jar's lang file has and no construction used.
  const used = new Set([...tabOf.values()].map((t) => t.lang).filter(Boolean));
  const spare = [...LANG_KEYS].filter((k) => !used.has(k));
  for (const [f, t] of tabOf) if (!t.lang && spare.length === 1) t.lang = spare[0];
  say(' tabs ............... ' + tabOf.size + '  columns ' +
      [...tabOf.values()].map((t) => t.col).sort((a, b) => a - b).join(','));
  for (const [f, t] of tabOf) say('    ' + f + '  col ' + String(t.col).padStart(2) + '  ' + t.lang);

  // ⚠ BOTH DIRECTIONS, against the lang file.
  const langs = new Set([...tabOf.values()].map((t) => t.lang));
  for (const k of LANG_KEYS) ok(langs.has(k), 'lang has itemGroup.' + k + ' and the bytecode has no tab for it');
  for (const k of langs) ok(LANG_KEYS.has(k), 'bytecode has a tab "' + k + '" the lang file does not');
  const cols = [...tabOf.values()].map((t) => t.col);
  ok(Math.min(...cols) === 0, 'the lowest tab column is ' + Math.min(...cols) + ', not 0');
  ok(Math.max(...cols) === 11, 'the highest tab column is ' + Math.max(...cols) + ', not 11');
  ok(new Set(cols).size === 12, 'the 13 tabs occupy ' + new Set(cols).size + ' columns, not 12');

  // ── 3. Blocks.<clinit>: field -> registry name ────────────────────────────────────────────
  const blkCode = javap(['-p', '-c'], [BLOCKS]);
  const bci = blkCode.findIndex((l) => l.trim().startsWith('static {}'));
  const blockName = new Map();
  {
    const rePut = new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L[\\w/$]+;');
    let name = null;
    for (const l of blkCode.slice(bci)) {
      const nm = l.match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z][a-z0-9_]*)$/);
      if (nm) { name = nm[1]; continue; }
      const pu = l.match(rePut);
      if (pu && name) { blockName.set(pu[1], name); name = null; }
    }
  }
  say(' block fields ....... ' + blockName.size);
  ok(blockName.size >= 850, 'only ' + blockName.size + ' block fields resolved to names');

  // ── 4. Items.<clinit>: one segment per registration ───────────────────────────────────────
  const reLdc = /ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z][a-z0-9_]*)$/;
  const reGetBlk = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(BLOCKS) + '\\.(\\w+):');
  const reGetTab = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(TAB) + '\\.(\\w+):');
  const rePutItem = new RegExp('putstatic\\s+#\\d+\\s+// Field \\w+:L' + esc(ITEMTYPE) + ';');
  const tabOfItem = new Map();
  const itemFieldName = new Map();               // Items field -> registry name, for the tab icons
  const order = [];
  {
    let name = null, blk = null, tab = null, tabs = 0;
    for (const l of itemCode.slice(ici)) {
      const nm = l.match(reLdc);
      if (nm && REG_ITEMS.has(nm[1]) && name === null) { name = nm[1]; continue; }
      const gb = l.match(reGetBlk);
      if (gb && blk === null) { blk = blockName.get(gb[1]) || null; continue; }
      const gt = l.match(reGetTab);
      if (gt) { tab = gt[1]; tabs++; continue; }
      const pi = l.match(new RegExp('putstatic\\s+#\\d+\\s+// Field (\\w+):L' + esc(ITEMTYPE) + ';'));
      if (pi) {
        const n = name || blk;
        if (n) itemFieldName.set(pi[1], n);
        if (n) {
          if (tabOfItem.has(n)) { failures++; say('   x ' + n + ' is registered twice'); }
          tabOfItem.set(n, tab); order.push(n);
        } else { failures++; say('   x a registration segment named nothing'); }
        name = null; blk = null; tab = null;
      }
    }
    say(' registrations ...... ' + order.length + '  (tab reads consumed ' + tabs + ')');
  }

  // ⚠⚠ CLOSED AGAINST THE REGISTRY, BOTH DIRECTIONS.
  for (const n of REG_ITEMS) ok(tabOfItem.has(n), 'registry item "' + n + '" has no registration segment');
  for (const n of tabOfItem.keys()) ok(REG_ITEMS.has(n), 'segment produced "' + n + '", which is not an item');
  ok(order.length === REG_ITEMS.size,
     order.length + ' segments for ' + REG_ITEMS.size + ' items');

  // ── 5. the shape the answer must have ─────────────────────────────────────────────────────
  // ⚠ ANTI-VACUITY. A segment walk that is off by one still produces a full map; these are the
  // items whose tab cannot be in doubt, in BOTH directions, and the no-tab set is pinned too.
  // ⚠ AN ALIAS IS THE SAME TAB. `TAB_MATERIALS` is `TAB_MISC` — one object stored into a second
  // field — so an item that reads the alias is in Miscellaneous, and a map keyed by FIELD reports
  // a thirteenth tab that the screen does not have. Everything downstream goes through the
  // CANONICAL tab of the column, which is the one the bytecode actually constructed.
  const canonOfCol = new Map();
  for (const [f, t] of tabOf) if (!t.alias) canonOfCol.set(t.col, t);
  const tabInfo = (f) => { const t = tabOf.get(f); return t ? (canonOfCol.get(t.col) || t) : null; };
  const langOf = (n) => { const t = tabOfItem.get(n); const i = t && tabInfo(t); return i ? i.lang : null; };
  const MUST = [['stone', 'buildingBlocks'], ['oak_planks', 'buildingBlocks'], ['torch', 'decorations'],
    ['painting', 'decorations'], ['redstone', 'redstone'], ['repeater', 'redstone'],
    ['minecart', 'transportation'], ['oak_boat', 'transportation'], ['apple', 'food'],
    ['cooked_beef', 'food'], ['diamond_pickaxe', 'tools'], ['shears', 'tools'],
    ['diamond_sword', 'combat'], ['bow', 'combat'], ['iron_chestplate', 'combat'],
    ['potion', 'brewing'], ['blaze_powder', 'brewing'], ['stick', 'misc'], ['iron_ingot', 'misc']];
  for (const [n, want] of MUST) ok(langOf(n) === want, n + ' is in "' + langOf(n) + '", not "' + want + '"');
  const NOTAB = [...tabOfItem.keys()].filter((n) => !tabOfItem.get(n)).sort();
  say(' items with no tab .. ' + NOTAB.length + '  ' + NOTAB.join(' '));
  // ⚠ `bedrock` IS NOT ON THIS LIST, and the first draft of it put bedrock here on the strength
  // of a recollection. The bytecode says building blocks, and the bytecode is the referee.
  for (const n of ['air', 'barrier', 'command_block', 'repeating_command_block', 'jigsaw',
                   'structure_block', 'structure_void', 'debug_stick', 'knowledge_book',
                   'light', 'spawner'])
    ok(NOTAB.indexOf(n) >= 0, n + ' must be in no creative tab and is in "' + langOf(n) + '"');
  for (const [n] of MUST) ok(NOTAB.indexOf(n) < 0, n + ' must be in a tab and is in none');

  // ── 5b. the tab icons ─────────────────────────────────────────────────────────────────────
  // ⚠ EACH TAB IS AN ANONYMOUS SUBCLASS AND THE ICON IS ITS ONE OVERRIDE: a no-argument method
  // whose whole body is `new ItemStack(<one static field>)`. The field is an `Items` field or a
  // `Blocks` field, and both resolve through maps built above — so the icon is READ, not chosen.
  // A tab strip drawn with icons somebody picked is a strip that looks like Minecraft's and is
  // not, which is the failure mode the charter's "absolute full parity" line exists to forbid.
  const ICON = new Map();
  {
    const impls = [...tabOf.values()].map((t) => t.impl).filter(Boolean);
    const code = javap(['-p', '-c'], [...new Set(impls)]);
    let klass = null, body = [];
    const flush = () => {
      if (!klass || !body.length) return;
      const src = body.join('\n');
      const gi = src.match(new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(ITEMS) + '\\.(\\w+):'));
      const gb = src.match(new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(BLOCKS) + '\\.(\\w+):'));
      const n = gi ? itemFieldName.get(gi[1]) : gb ? blockName.get(gb[1]) : null;
      if (n) ICON.set(klass, n);
      body = [];
    };
    for (const l of code) {
      const d = l.trim().match(/^(?:public |final |abstract |static |)*class ([\w.$]+)/);
      if (d && l.trimEnd().endsWith('{')) { flush(); klass = d[1]; continue; }
      const m = l.match(/^\s{2}(?:public |private |protected |)?[\w.$]+ (\w+)\(\);\s*$/);
      if (m) { flush(); continue; }
      if (/^\s{2}\w/.test(l)) { flush(); continue; }      // any other member signature
      body.push(l);
    }
    flush();
  }
  for (const [f, t] of tabOf) if (!t.alias) t.icon = ICON.get(t.impl) || null;
  say(' tab icons .......... ' + [...tabOf.values()].filter((t) => !t.alias)
      .sort((a, b) => a.col - b.col).map((t) => t.col + ':' + t.lang + '=' + t.icon).join(' '));
  // ⚠ BOTH DIRECTIONS: every tab has an icon, every icon is a real item, and they are distinct —
  // a resolver that fell through to one field would give twelve tabs the same picture.
  const icons = [];
  for (const [f, t] of tabOf) {
    if (t.alias) continue;
    ok(!!t.icon, 'tab "' + t.lang + '" has no icon');
    ok(!t.icon || REG_ITEMS.has(t.icon), 'tab "' + t.lang + '" icon "' + t.icon + '" is not an item');
    if (t.icon) icons.push(t.icon);
  }
  ok(new Set(icons).size === icons.length, 'two tabs share an icon: ' + icons.join(' '));

  // ⚠ AND THE TABS MUST NOT BE LOPSIDED. A walk that lost its place would pile everything into
  // one tab and still pass every anchor above; every tab that items can be assigned to must have
  // some, and none may hold more than half of everything.
  const per = new Map();
  for (const n of tabOfItem.keys()) { const L = langOf(n); if (L) per.set(L, (per.get(L) || 0) + 1); }
  say(' per tab ............ ' + [...per].sort((a, b) => b[1] - a[1]).map((e) => e[0] + '=' + e[1]).join(' '));
  for (const L of ['buildingBlocks', 'decorations', 'redstone', 'transportation', 'misc',
                   'food', 'tools', 'combat', 'brewing'])
    ok((per.get(L) || 0) > 0, 'tab "' + L + '" holds no items at all');
  for (const [L, n] of per) ok(n < tabOfItem.size / 2, 'tab "' + L + '" holds ' + n + ' of ' + tabOfItem.size);
  // ⚠ ...and the three tabs that are NOT an item's home must never be one.
  for (const L of ['search', 'inventory', 'hotbar'])
    ok(!per.has(L), 'tab "' + L + '" is a view, not a home, and ' + per.get(L) + ' items claim it');

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  mkdirSync(dirname(OUT), { recursive: true });
  const lines = ['# item\ttab\tcolumn',
    '# Generated by tools/extract-creative.mjs from ' + JAR,
    '# CreativeModeTab=' + TAB + '  Items=' + ITEMS + '  Blocks=' + BLOCKS,
    '# tabs: ' + [...canonOfCol.keys()].sort((a, b) => a - b)
      .map((c) => c + '=' + canonOfCol.get(c).lang + '/' + canonOfCol.get(c).icon).join(' '),
    '# ' + tabOfItem.size + ' items, ' + NOTAB.length + ' in no tab.'];
  for (const n of [...tabOfItem.keys()].sort()) {
    const i = tabInfo(tabOfItem.get(n));
    lines.push(n + '\t' + (i ? i.lang : '-') + '\t' + (i ? i.col : -1));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* the mount refuses rm */ }
}
