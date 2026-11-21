#!/usr/bin/env node
// extract-combat-enchant.mjs — QUEUE row 0 item 5 (D-461, extended D-470). WHAT A WEAPON ENCHANTMENT ADDS TO A
// MELEE BLOW, which mobs are UNDEAD or ARTHROPOD, and the sweep's own knockback and range — all
// read out of the 1.18.2 client jar's BYTECODE.
//
//   node tools/extract-combat-enchant.mjs [--if-missing]   -> tools/golden/combat-enchant-1.18.2.tsv
//
// ⚠ WHY. `Cb.OWED` named "enchantment damage bonuses", "the Sweeping Edge ratio" and "the
// Knockback enchantment" as unbuilt. Everybody "knows" Sharpness is +1.25 a level — that is Java
// 1.8's number and Bedrock's; 1.18.2's is `1 + 0.5 * max(0, lvl - 1)`. And the sweep's knockback
// is 0.4F, NOT the 0.5-per-level of the main blow, which is exactly the number this engine had
// wrong before this file existed (D-461). So nothing below is typed from memory.
//
// ── HOW EACH THING IS FOUND (save keys and registry names are never obfuscated) ─────────────
//   1. `Enchantments` is the class that loads BOTH bare strings "bane_of_arthropods" and
//      "sweeping" with `ldc` (the datafixer carries them only as "minecraft:…", so it cannot match).
//   2. `DamageEnchantment` is the class `new`-ed straight after "sharpness"; smite and bane are
//      the same class with a different int, and that int is read from the same bytecode.
//   3. Its `(I, <MobType>)F` method is the bonus: type 0's `1 + max(0,l-1) * A`, type 1's and
//      type 2's `l * B` compared against two static fields of `<MobType>` — so the TYPE each one
//      beats is read from the branch, not assumed.
//   4. `SweepingEdgeEnchantment` is the class `new`-ed after "sweeping"; its one static `(I)F`
//      must be the opcode sequence of `1 - 1/(l+1)` or this aborts.
//   5. A mob's type: every class whose `()L<MobType>;` method returns one static of MobType,
//      inherited down the superclass chain, named through `entity-types-1.18.2.tsv`.
//   6. `Player.attack` is the Player method holding both double 9.0 and the float 0.017453292
//      degree factor; the sweep's knockback is the double loaded between them.
//   7. The level read: `EnchantmentHelper` is the class with private static final "id" and "lvl";
//      its `(<CompoundTag>)I` clamps "lvl" to [0, the sipush it loads].
//   8. **D-470: Fire Aspect's ignite duration.** `EnchantmentHelper` (already `helper` below,
//      found by #7) declares a `public static int _(LivingEntity)` one-liner for every combat
//      enchantment that reads its own static field off `Enchantments` and forwards to the
//      generic level-lookup — the SAME shape as Knockback's own getter. The one whose field
//      matches the `new` called after the string "fire_aspect" is Fire Aspect's. `Player.attack`
//      (`atk[0]`, already isolated by #6) calls it exactly twice: once with a bare `iconst_1`
//      (an immediate 1-second poke, gated on `!target.fireImmune()`, before the hit even lands —
//      vanilla's own visual head-start) and once, ONLY inside the "the hit landed" branch, as
//      `level * 4` — both calls to the identical `(I)V` method on the target, which is the proof
//      the two are the same mechanism and not a coincidence of two unrelated `(I)V` methods.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'tools', 'golden', 'combat-enchant-1.18.2.tsv');
const TYPES = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } return c; };
const stop = () => { if (failures) { say('\n aborted — nothing written'); process.exit(1); } };

if (process.argv.includes('--if-missing') && existsSync(OUT)) { say(' present — nothing to do'); process.exit(0); }
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const JAR = requireJar('1.18.2');
const work = mkdtempSync(join(tmpdir(), 'mclite-ench-'));
execFileSync('unzip', ['-o', '-q', JAR, '*.class', '-d', work]);
const files = readdirSync(work).filter((f) => f.endsWith('.class'));   // 1.18.2 is flat, obfuscated
const bytes = new Map(files.map((f) => [f.slice(0, -6), readFileSync(join(work, f))]));
const has = (c, s) => bytes.get(c).includes(Buffer.from(s, 'utf8'));
const javap = (c) => execFileSync('javap', ['-c', '-p', '-constants', '-cp', work, c],
  { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
const methods = (lines) => {               // name/descriptor line -> body lines
  const out = []; let cur = null;
  for (const l of lines) {
    if (/^  \S.*\(.*\).*;$/.test(l)) { cur = { sig: l.trim(), body: [] }; out.push(cur); continue; }
    if (cur) cur.body.push(l);
  }
  return out;
};

// ── 1. Enchantments ──────────────────────────────────────────────────────────────────────
const ench = [...bytes.keys()].filter((c) => has(c, 'bane_of_arthropods') && has(c, 'sweeping') &&
  !has(c, 'minecraft:bane_of_arthropods'));
ok(ench.length === 1, `Enchantments: expected one class, found ${ench.length}`); stop();
const EL = javap(ench[0]);
const ctorAfter = (name) => {
  const i = EL.findIndex((l) => new RegExp(`// String ${name}$`).test(l));
  const n = i >= 0 && EL.slice(i, i + 3).map((l) => l.match(/new\s+#\d+\s+\/\/ class (\S+)/)).find(Boolean);
  const args = [];
  for (let j = i + 1; j < i + 12; j++) { const a = EL[j].match(/(iconst_(\d)|bipush\s+(\d+))$/); if (a) args.push(+(a[2] ?? a[3])); }
  return { idx: i, cls: n && n[1], ints: args };
};
// D-470: the static FIELD a registration is stored into, read forward from the same string.
const fieldAfter = (name) => {
  const { idx } = ctorAfter(name);
  for (let j = idx; j >= 0 && j < idx + 20 && j < EL.length; j++) {
    const f = EL[j] && EL[j].match(/putstatic\s+#\d+\s+\/\/ Field (\w+):Lbyq;/);
    if (f) return f[1];
  }
  return null;
};
const sharp = ctorAfter('sharpness'), smite = ctorAfter('smite'), bane = ctorAfter('bane_of_arthropods');
const sweepC = ctorAfter('sweeping'), knockC = ctorAfter('knockback');
ok(sharp.cls && sharp.cls === smite.cls && smite.cls === bane.cls,
   'sharpness/smite/bane are not one DamageEnchantment class');
ok(knockC.cls && sweepC.cls, 'knockback / sweeping classes not found'); stop();
// the int passed is the first iconst after the category getstatic (the next is the slot array's size 1)
const typeOf = { sharpness: sharp.ints[0], smite: smite.ints[0], bane_of_arthropods: bane.ints[0] };
ok(typeOf.sharpness === 0 && typeOf.smite === 1 && typeOf.bane_of_arthropods === 2,
   'the three damage types are not 0/1/2: ' + JSON.stringify(typeOf)); stop();

// ── 2/3. DamageEnchantment's bonus ────────────────────────────────────────────────────────
const DE = methods(javap(sharp.cls));
const bonus = DE.find((m) => /float \w+\(int, (\w+)\);$/.test(m.sig));
ok(!!bonus, 'no (int, MobType)F method on DamageEnchantment'); stop();
const MOBTYPE = bonus.sig.match(/float \w+\(int, (\w+)\);$/)[1];
const floats = bonus.body.map((l) => l.match(/\/\/ float ([\d.]+)f/)).filter(Boolean).map((m) => +m[1]);
const gets = bonus.body.map((l) => l.match(new RegExp(`getstatic.*Field ${MOBTYPE}\\.(\\w+):`))).filter(Boolean).map((m) => m[1]);
ok(bonus.body.some((l) => /fconst_1/.test(l)) && bonus.body.some((l) => /Math\.max:\(II\)I/.test(l)),
   'type 0 is not 1 + max(0, l-1) * k');
ok(floats.length === 3 && gets.length === 2, `bonus shape: floats ${floats} statics ${gets}`); stop();
const [SHARP_PER, SMITE_PER, BANE_PER] = floats;

// MobType's statics in <clinit> order — which one is UNDEAD and which ARTHROPOD is read from
// the branch above (type 1 = smite beats gets[0], type 2 = bane beats gets[1]).
const MT = javap(MOBTYPE).filter((l) => /putstatic.*Field (\w+):L/.test(l)).map((l) => l.match(/Field (\w+):/)[1]);
ok(MT.length === 5, `MobType should have five instances, has ${MT.length}`); stop();
const UNDEAD = gets[0], ARTHROPOD = gets[1];

// ── 4. Sweeping Edge ratio ────────────────────────────────────────────────────────────────
const SW = methods(javap(sweepC.cls)).find((m) => /static float \w+\(int\);$/.test(m.sig));
const swOps = SW ? SW.body.map((l) => (l.match(/^\s+\d+: (\w+)/) || [])[1]).filter(Boolean).join(' ') : '';
ok(swOps === 'fconst_1 fconst_1 iload_0 iconst_1 iadd i2f fdiv fsub freturn',
   'SweepingEdgeEnchantment ratio is not 1 - 1/(l+1): ' + swOps); stop();

// ── 5. mob types ──────────────────────────────────────────────────────────────────────────
const direct = new Map();
// only a class carrying the descriptor `()L<MobType>;` can declare the method — filter on the
// raw bytes first, then ONE javap over the survivors (a javap per class is minutes, not seconds)
const cand = [...bytes.keys()].filter((c) => c !== MOBTYPE && bytes.get(c).includes(Buffer.from(`()L${MOBTYPE};`, 'utf8')));
{
  let cur = null;
  const all = execFileSync('javap', ['-c', '-p', '-cp', work, ...cand],
    { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
  const byClass = new Map();
  for (const l of all) {
    const d = l.match(/^(?:public |final |abstract )*class (\S+)/);
    if (d) { cur = d[1]; byClass.set(cur, []); continue; }
    if (cur) byClass.get(cur).push(l);
  }
  for (const [c, lines] of byClass) for (const m of methods(lines)) {
    if (!new RegExp(`public ${MOBTYPE} \\w+\\(\\);$`).test(m.sig)) continue;
    const g = m.body.map((l) => l.match(new RegExp(`getstatic.*Field ${MOBTYPE}\\.(\\w+):`))).filter(Boolean);
    if (g.length === 1 && m.body.some((l) => /areturn/.test(l))) direct.set(c, g[0][1]);
  }
}
// the superclass straight out of the class file: constant pool, then this_class/super_class
const superCache = new Map();
const superOf2 = (c) => {
  if (superCache.has(c)) return superCache.get(c);
  const b = bytes.get(c); let o = 10; const n = b.readUInt16BE(8); const utf = [], cls = [];
  for (let i = 1; i < n; i++) {
    const t = b[o];
    if (t === 1) { const L = b.readUInt16BE(o + 1); utf[i] = b.toString('utf8', o + 3, o + 3 + L); o += 3 + L; }
    else if (t === 7) { cls[i] = b.readUInt16BE(o + 1); o += 3; }
    else if (t === 8 || t === 16 || t === 19 || t === 20) o += 3;
    else if (t === 15) o += 4;
    else if (t === 5 || t === 6) { o += 9; i++; }
    else o += 5;
  }
  const sup = b.readUInt16BE(o + 4);
  const r = sup ? utf[cls[sup]] : null;
  superCache.set(c, r); return r;
};
const types = readFileSync(TYPES, 'utf8').split(/\r?\n/).filter((l) => l && l[0] !== '#')
  .map((l) => l.split('\t')).map((c) => [c[0], c[c.length - 1]]).filter(([, k]) => k);
const mobRows = [];
for (const [name, cls] of types) {
  let k = cls, t = null, guard = 0;
  while (k && bytes.has(k) && guard++ < 20) { if (direct.has(k)) { t = direct.get(k); break; } k = superOf2(k); }
  if (t === UNDEAD) mobRows.push(['undead', name]);
  if (t === ARTHROPOD) mobRows.push(['arthropod', name]);
}
const names = (t) => mobRows.filter((r) => r[0] === t).map((r) => r[1]);
// anchors that cannot be in doubt: a zombie is undead, a spider an arthropod, a cow neither
ok(names('undead').includes('zombie') && names('undead').includes('skeleton'), 'zombie/skeleton not undead');
ok(names('arthropod').includes('spider') && names('arthropod').includes('bee'), 'spider/bee not arthropod');
ok(!mobRows.some((r) => r[1] === 'cow' || r[1] === 'creeper'), 'a cow or a creeper got a mob type'); stop();

// ── 6. Player.attack's sweep ──────────────────────────────────────────────────────────────
const player = [...bytes.keys()].filter((c) => has(c, 'SleepTimer') && has(c, 'XpSeed'));
ok(player.length === 1, 'Player: expected one class'); stop();
const atk = methods(javap(player[0])).filter((m) => m.body.some((l) => /double 9\.0d/.test(l)) &&
  m.body.some((l) => /float 0\.017453292f/.test(l)) && m.body.some((l) => /float 1\.5f/.test(l)));
ok(atk.length === 1, `Player.attack: expected one method, found ${atk.length}`); stop();
const B = atk[0].body;
const i9 = B.findIndex((l) => /double 9\.0d/.test(l));
const kbLine = B.slice(i9 + 1, i9 + 8).map((l) => l.match(/\/\/ double ([\d.]+)d/)).find(Boolean);
ok(!!kbLine, 'no double between the 9.0 range test and the knockback call'); stop();
const SWEEP_KB = +kbLine[1];
const cmp = B[i9 + 1] && /dcmpg/.test(B[i9 + 1]) && /ifge/.test(B[i9 + 2] || '');
ok(cmp, 'the range test is not `distanceToSqr < 9.0` (dcmpg; ifge)'); stop();
const sweepInflate = B.map((l) => l.match(/\/\/ double (0\.25)d/)).filter(Boolean);
ok(sweepInflate.length >= 1, 'the sweep box inflate 0.25 is gone'); stop();

// ── 7. the level read ────────────────────────────────────────────────────────────────────
const helper = [...bytes.keys()].filter((c) => has(c, 'Enchantments') && has(c, 'lvl') &&
  javap(c).some((l) => /private static final java\.lang\.String \w+ = "lvl";/.test(l)));
ok(helper.length === 1, `EnchantmentHelper: expected one, found ${helper.length}`); stop();
const lvlRead = methods(javap(helper[0])).find((m) => m.body.some((l) => /String lvl$/.test(l)) &&
  / static int \w+\(\w+\);$/.test(m.sig));
const clampHi = lvlRead && lvlRead.body.map((l) => l.match(/sipush\s+(\d+)/)).find(Boolean);
ok(!!clampHi && lvlRead.body.some((l) => /iconst_0/.test(l)), 'lvl is not clamped to [0, N]'); stop();

// ── 8. Fire Aspect's ignite duration (D-470) ────────────────────────────────────────────────
const faField = fieldAfter('fire_aspect');
ok(!!faField, 'fire_aspect: no static field found after its registration string'); stop();
const HM = methods(javap(helper[0]));
const faGetter = HM.find((m) => /public static int \w+\(axy\);$/.test(m.sig) &&
  m.body.some((l) => l.includes(`Field byu.${faField}:Lbyq;`)));
ok(!!faGetter, `Fire Aspect: no (LivingEntity)I getter reads Field byu.${faField}`); stop();
const getterName = faGetter.sig.match(/int (\w+)\(axy\);/)[1];
const callIdx = B.findIndex((l) => l.includes(`Method ${helper[0]}.${getterName}:(Laxy;)I`));
ok(callIdx >= 0, 'Player.attack never calls the Fire Aspect getter'); stop();
const localVar = (B[callIdx + 1].match(/istore\s+(\d+)/) || [])[1];
ok(!!localVar, 'Fire Aspect level is not stored to a local right after the getter call'); stop();
const ivCalls = B.map((l, i) => ({ i, m: l.match(/invokevirtual\s+#\d+\s+\/\/ Method (\S+):\(I\)V/) }))
  .filter((x) => x.i > callIdx && x.m).map((x) => ({ i: x.i, target: x.m[1] }));
// call A: the pre-ignite — `iconst_1` directly above the call, gated on the level being > 0
// somewhere between the getter and here (loose: just require it comes first and uses iconst_1)
const preIgnite = ivCalls[0] && /iconst_1$/.test(B[ivCalls[0].i - 1] || '') ? ivCalls[0] : null;
ok(!!preIgnite, 'no pre-ignite (I)V call with a bare iconst_1 after the Fire Aspect getter');
// call B: `iload <localVar>; iconst_4; imul` directly above the call — the level*4 formula
const igniteFor = ivCalls.find((c) => c.i > (preIgnite ? preIgnite.i : callIdx) &&
  new RegExp(`iload\\s+${localVar}$`).test(B[c.i - 3] || '') &&
  /iconst_4$/.test(B[c.i - 2] || '') && /imul$/.test(B[c.i - 1] || ''));
ok(!!igniteFor, 'no `level * 4` ignite call found after the pre-ignite'); stop();
ok(preIgnite.target === igniteFor.target,
   `pre-ignite and level*4 ignite call different methods: ${preIgnite.target} vs ${igniteFor.target}`); stop();
const FIRE_ASPECT_SECONDS_PER_LEVEL = 4;      // proven by the `iconst_4; imul` shape just asserted
const FIRE_ASPECT_PRE_IGNITE_SECONDS = 1;     // proven by the `iconst_1` shape just asserted
const FA_CLS = ctorAfter('fire_aspect').cls;
const faMax = methods(javap(FA_CLS)).find((m) => /public int \w+\(\);$/.test(m.sig) &&
  m.body.some((l) => /iconst_2/.test(l)));
ok(!!faMax, 'Fire Aspect max level is not the iconst_2 no-arg int method'); stop();
const FIRE_ASPECT_MAX_LEVEL = 2;

// ── write ─────────────────────────────────────────────────────────────────────────────────
const out = [
  '# combat-enchant-1.18.2.tsv — generated by tools/extract-combat-enchant.mjs from the 1.18.2 jar. Do not edit.',
  '# kind\tkey\tvalue',
  `const\tsharpness_base\t1.0`,
  `const\tsharpness_per_level_above_1\t${SHARP_PER}`,
  `const\tsmite_per_level\t${SMITE_PER}`,
  `const\tbane_per_level\t${BANE_PER}`,
  `const\tsweep_knockback\t${SWEEP_KB}`,
  `const\tsweep_range_sq\t9.0`,
  `const\tsweep_ratio\t1-1/(level+1)`,
  `const\tlevel_clamp_max\t${clampHi[1]}`,
  `const\tfire_aspect_seconds_per_level\t${FIRE_ASPECT_SECONDS_PER_LEVEL}`,
  `const\tfire_aspect_pre_ignite_seconds\t${FIRE_ASPECT_PRE_IGNITE_SECONDS}`,
  `const\tfire_aspect_max_level\t${FIRE_ASPECT_MAX_LEVEL}`,
  ...mobRows.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])).map((r) => `mobtype\t${r[0]}\t${r[1]}`)
];
writeFileSync(OUT, out.join('\n') + '\n');
say(` wrote ${OUT}\n sharpness +${SHARP_PER}/lvl · smite ${SMITE_PER} · bane ${BANE_PER} · sweep kb ${SWEEP_KB} · ` +
    `undead ${names('undead').length} · arthropod ${names('arthropod').length} · lvl clamp ${clampHi[1]} · ` +
    `fire aspect ${FIRE_ASPECT_SECONDS_PER_LEVEL}s/lvl (+${FIRE_ASPECT_PRE_IGNITE_SECONDS}s pre-ignite, max ${FIRE_ASPECT_MAX_LEVEL})`);
