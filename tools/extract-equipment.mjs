#!/usr/bin/env node
// extract-equipment.mjs — which slot a piece of armour goes in, out of the 1.18.2 BYTECODE.
//
//   node tools/extract-equipment.mjs [--if-missing]   -> tools/golden/item-equipment-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. D-266. `InventoryMenu.quickMoveStack` checks two branches before the
// backpack/hotbar ones: shift-click a helmet and it flies to the head slot, shift-click a shield
// and it flies to the offhand. Both ask `Mob.getEquipmentSlotForItem`, which is compiled Java —
// in no JSON, no `minecraft-data` file and no tag. G8 shipped WITHOUT those branches rather than
// approximate them from a name suffix, because "ends in _helmet" is right about most of the
// roster and wrong about `turtle_helmet`, `elytra`, `carved_pumpkin` and the skulls — and a
// constant derived from nothing is the D-263 mistake in a new place.
//
// ⚠ THE METHOD IS D-263's, REUSED. No mappings; nothing trusts a name:
//
//   1. `Items` is the class with 1000-1200 static finals of one Item type. Its `<clinit>` names
//      every item as a string literal in registry order.
//   2. `EquipmentSlot` is the SIX-constant enum that `Items.<clinit>` reads — picked by USE, the
//      correction D-263 had to make after picking a class by shape alone.
//   3. WHICH constant is which is DERIVED, not assumed: `iron_helmet`, `iron_chestplate`,
//      `iron_leggings` and `iron_boots` are four items whose slot cannot be in doubt, and they
//      name four of the six constants between them. The remaining two are MAINHAND and OFFHAND,
//      and `shield` names OFFHAND. Section 4 then asserts the whole mapping in both directions.
//   4. Vanilla's own four special cases are `getEquipmentSlotForItem`'s own literals — it names
//      CARVED_PUMPKIN, the skull blocks, ELYTRA and SHIELD in source — so carrying them as names
//      here is quoting vanilla, not guessing it. They are marked `special` in the output.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'item-equipment-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };
const esc = (s) => s.replace(/[$]/g, '\\$');

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' item-equipment-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-equip-'));
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

  // ------------------------------------------------------------ 1. Items
  const sigs = javap(['-p'], all);
  let cur = null;
  const selfCount = new Map(), otherCount = new Map();
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
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
  const [ITEMS, ITEMTYPE] = itemsCand[0].split(' ');
  say(' Items class ........ ' + ITEMS + ' of ' + ITEMTYPE + ' (' + itemsCand[1] + ' fields)');

  // ------------------------------------------------------------ 2. EquipmentSlot, picked by use
  const itemCode = javap(['-c', '-p'], [ITEMS]);
  const ci = itemCode.findIndex((l) => l.trim().startsWith('static {}'));
  const clinit = itemCode.slice(ci);
  const useCount = new Map();
  for (const l of clinit) {
    const g = l.match(/getstatic\s+#\d+\s+\/\/ Field ([\w.$]+)\.\w+:L[\w/$]+;/);
    if (g) useCount.set(g[1], (useCount.get(g[1]) || 0) + 1);
  }
  // ⚠ TWO SIX-CONSTANT ENUMS ARE READ EXACTLY THIRTY TIMES EACH by `Items.<clinit>`, so counting
  // uses cannot separate them — the refinement D-263's "pick by use" needed the moment a second
  // class tied. The one that is EquipmentSlot is the one whose constants land on the four iron
  // armour pieces, four DISTINCT constants for four pieces. That is evidence, not a tiebreak.
  const scan = (cls) => {
    const re = new RegExp('getstatic\\s+#\\d+\\s+// Field ' + esc(cls) + '\\.(\\w+):L' + esc(cls) + ';');
    const map = new Map();
    let nm2 = null;
    for (const l of clinit) {
      const nm = l.trim().match(/ldc(?:_w)?\s+#\d+\s+\/\/ String ([a-z0-9_]+)$/);
      if (nm && /^[a-z][a-z0-9_]*$/.test(nm[1])) { nm2 = nm[1]; if (!map.has(nm2)) map.set(nm2, null); continue; }
      if (!nm2) continue;
      const g = l.match(re);
      if (g && map.get(nm2) === null) map.set(nm2, g[1]);
    }
    return map;
  };
  const ANCHORS = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
  const cands = [...selfCount].filter(([c, n]) => n === 6 && useCount.has(c)).map(([c]) => c);
  say(' six-constant enums Items reads: ' + cands.join(' '));
  let SLOT = null, slotOf = null;
  for (const c of cands) {
    const m2 = scan(c);
    const got = ANCHORS.map((a) => m2.get(a));
    if (got.every(Boolean) && new Set(got).size === 4) { SLOT = c; slotOf = m2; break; }
  }
  ok(!!SLOT, 'no six-constant enum puts the four iron armour pieces on four distinct constants');
  if (failures) { say('\n aborted'); process.exit(1); }
  const armour = [...slotOf].filter((e) => e[1] !== null);
  say(' EquipmentSlot ...... ' + SLOT + ' (chosen because the four iron pieces land on four constants)');
  say(' items .............. ' + slotOf.size + '  (with an EquipmentSlot: ' + armour.length + ')');

  // ------------------------------------------------------------ 4. name the constants
  // ⚠ DERIVED FROM CASES THAT CANNOT BE IN DOUBT, then asserted in both directions.
  const NAMED = {};
  const anchor = (item, slotName) => {
    const f = slotOf.get(item);
    ok(!!f, item + ' has no EquipmentSlot in the bytecode — the anchor set is wrong');
    if (f) {
      ok(NAMED[f] === undefined || NAMED[f] === slotName,
        'constant ' + f + ' would be both ' + NAMED[f] + ' and ' + slotName);
      NAMED[f] = slotName;
    }
  };
  anchor('iron_helmet', 'HEAD');
  anchor('iron_chestplate', 'CHEST');
  anchor('iron_leggings', 'LEGS');
  anchor('iron_boots', 'FEET');
  // the two that are not armour slots: shield names OFFHAND, and the one constant left is MAINHAND
  const shieldSlot = slotOf.get('shield');
  if (shieldSlot) NAMED[shieldSlot] = 'OFFHAND';
  const allConsts = new Set([...slotOf.values()].filter(Boolean));
  ok(allConsts.size >= 4, 'only ' + allConsts.size + ' distinct EquipmentSlot constants used by Items');
  for (const c of allConsts) if (!NAMED[c]) NAMED[c] = 'MAINHAND';

  // every armour piece of a full set must land on four DIFFERENT slots — a mapping that collapsed
  // would still produce a table, and this is what notices.
  for (const set of ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite']) {
    const pieces = [
      [set === 'leather' ? 'leather_helmet' : set + '_helmet', 'HEAD'],
      [set === 'leather' ? 'leather_chestplate' : set + '_chestplate', 'CHEST'],
      [set === 'leather' ? 'leather_leggings' : set + '_leggings', 'LEGS'],
      [set === 'leather' ? 'leather_boots' : set + '_boots', 'FEET'],
    ];
    for (const [item, want] of pieces) {
      const f = slotOf.get(item);
      ok(f && NAMED[f] === want, item + ' is ' + (f ? NAMED[f] : 'absent') + ', expected ' + want);
    }
  }
  ok(!slotOf.get('stone') || NAMED[slotOf.get('stone')] === 'MAINHAND', 'stone is not armour');
  ok(slotOf.get('turtle_helmet') && NAMED[slotOf.get('turtle_helmet')] === 'HEAD',
    'turtle_helmet is HEAD — the case a name-suffix rule gets right and a material rule would not');

  // vanilla's own four literal special cases, quoted from `Mob.getEquipmentSlotForItem`
  const SPECIAL = {
    carved_pumpkin: 'HEAD', elytra: 'CHEST', shield: 'OFFHAND',
    skeleton_skull: 'HEAD', wither_skeleton_skull: 'HEAD', player_head: 'HEAD',
    zombie_head: 'HEAD', creeper_head: 'HEAD', dragon_head: 'HEAD',
  };
  // ⚠ `carved_pumpkin` and the six skulls are BLOCK items: `Items.<clinit>` registers them from
  // `Blocks.X` with no string literal, so they are absent from the scan above by construction.
  // They are still checked — against the built item registry, which is the roster the game
  // actually has — so a name that has gone stale fails here rather than silently doing nothing.
  {
    const REG = join(MCLITE_ROOT, 'assets', 'item-registry.json');
    if (existsSync(REG)) {
      const reg = JSON.parse(readFileSync(REG, 'utf8'));
      const raw = Array.isArray(reg) ? reg
        : (Array.isArray(reg.items) ? reg.items : Object.keys(reg.items || {}));
      const names = new Set(raw.map((e) => (typeof e === 'string' ? e : e.name))
        .filter(Boolean).map((n) => n.replace(/^minecraft:/, '')));
      ok(names.size > 900, 'the item registry has only ' + names.size + ' names — cannot check the quote');
      for (const k of Object.keys(SPECIAL)) {
        ok(names.has(k), 'special case "' + k + '" is not an item in this version — the quote has gone stale');
      }
    } else {
      say('   ! assets/item-registry.json is absent — the special-case names are unchecked this run');
    }
  }
  ok(slotOf.has('elytra') && slotOf.has('shield'),
    'elytra and shield are not in Items.<clinit> — the quote has gone stale');

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  mkdirSync(dirname(OUT), { recursive: true });
  const lines = ['# item\tslot\tsource',
    '# Generated by tools/extract-equipment.mjs from ' + JAR,
    '# Items=' + ITEMS + '  EquipmentSlot=' + SLOT + '  constants: '
      + Object.keys(NAMED).sort().map((k) => k + '=' + NAMED[k]).join(' '),
    '# "armor" = an EquipmentSlot read out of Items.<clinit>; "special" = one of the four literal'
    + ' cases Mob.getEquipmentSlotForItem names in source; everything else is MAINHAND.'];
  let nArmour = 0, nSpecial = 0;
  // ⚠ THE UNION, not just what the scan saw: `carved_pumpkin` and the six skulls are BLOCK items
  // and never appear as string literals in `Items.<clinit>`, so iterating the scan alone would
  // silently drop the very cases a name-suffix rule gets wrong — which is the whole point of
  // this file existing.
  const every = [...new Set([...slotOf.keys(), ...Object.keys(SPECIAL)])].sort();
  for (const item of every) {
    if (SPECIAL[item]) { lines.push(item + '\t' + SPECIAL[item] + '\tspecial'); nSpecial++; continue; }
    const f = slotOf.get(item);
    if (f && NAMED[f] !== 'MAINHAND') { lines.push(item + '\t' + NAMED[f] + '\tarmor'); nArmour++; }
  }
  ok(nSpecial === Object.keys(SPECIAL).length,
    nSpecial + ' special cases written, expected ' + Object.keys(SPECIAL).length);
  if (failures) { say('\n x ' + failures + ' failures after writing — the table is suspect'); process.exit(1); }
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
  say(' ' + nArmour + ' armour items - ' + nSpecial + ' special cases - 0 failures');
} finally {
  rmSync(work, { recursive: true, force: true });
}
