#!/usr/bin/env node
// pack-entities.mjs — G17a's entity table, from the golden TSV into a shape the runtime wants.
//
//   node tools/pack-entities.mjs   ->  assets/entities.json  (+ entities.meta.json)
//
// ⚠ THIS FILE DOES NOT DECIDE ANY NUMBER. Every value comes from
// `tools/golden/entity-types-1.18.2.tsv`, which `tools/extract-entities.mjs` reads out of the
// 1.18.2 bytecode (D-306). All this does is turn 113 tab-separated rows into one small JSON
// object, and refuse to write anything if the table is not there or does not look like itself.
//
// ⚠ IT IS JSON AND NOT A PACKED BINARY, on purpose. 113 rows of six small values is about 4 KB
// of text and under a kilobyte deflated in the shipped file — a binary format with a header and
// an index would save a few hundred bytes and cost a decoder, a decoder bug and a check for the
// decoder. D-12 counts kilobytes; it does not ask for ceremony over them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSV = join(ROOT, 'tools', 'golden', 'entity-types-1.18.2.tsv');
const MOTION = join(ROOT, 'tools', 'golden', 'entity-motion-1.18.2.tsv');
const MOTION_SRC = join(ROOT, 'tools', 'golden', 'entity-motion-src-1.18.2.tsv');   // G17b-2: .decomp-proved generic rows
const MOTION_STATIC = join(ROOT, 'tools', 'golden', 'entity-motion-static-1.18.2.tsv');   // G17b-6: no-gravity types, proof named per row
const ATTRS = join(ROOT, 'tools', 'golden', 'entity-attributes-1.18.2.tsv');
const BREED = join(ROOT, 'tools', 'golden', 'breeding-1.18.2.tsv');
const BABY = join(ROOT, 'tools', 'golden', 'babymodel-1.18.2.tsv');
const GROUND = join(ROOT, 'tools', 'golden', 'entity-ground-1.18.2.tsv');
const ZARMS = join(ROOT, 'tools', 'golden', 'zombiearms-1.18.2.tsv');
const OUTDIR = join(ROOT, 'assets');
const say = (...a) => console.log(...a);

if (!existsSync(TSV)) {
  say(' SKIP — tools/golden/entity-types-1.18.2.tsv is missing; run extract-entities first.');
  process.exit(0);
}
const lines = readFileSync(TSV, 'utf8').split(/\r?\n/).filter((l) => l && l[0] !== '#');
const rows = lines.map((l) => l.split('\t'));
if (rows.length < 80) { console.error(`pack-entities: only ${rows.length} rows — the table is wrong`); process.exit(1); }

// name -> [width, height, fireImmune, trackingRange, updateInterval]
// ⚠ updateInterval is Integer.MAX_VALUE for the entities that never send an update (paintings,
// leash knots, the area-effect cloud). It is kept as that number rather than as null, because
// "never" and "not set" are different facts and the second one is not in the game.
const table = {};
let bad = 0;
for (const r of rows) {
  const [name, w, h, fire, track, upd] = r;
  if (!/^[a-z_]+$/.test(name || '')) { bad++; continue; }
  const W = Number(w), H = Number(h);
  if (!Number.isFinite(W) || !Number.isFinite(H)) { bad++; continue; }
  table[name] = [W, H, Number(fire) ? 1 : 0,
                 track === '' ? -1 : Number(track), upd === '' ? -1 : Number(upd)];
}
if (bad) { console.error(`pack-entities: ${bad} unreadable rows — refusing to ship a partial table`); process.exit(1); }

// ── the motion table, and the rule that decides what the engine may simulate ────────────────
// ⚠ AN ENTITY IS SIMULATABLE ONLY WHEN **BOTH** ITS GRAVITY AND ITS DRAG WERE MEASURED. Ten
// types resolved a gravity and six of those also resolved a drag; the rest are OWED (D-307) and
// are packed with neither, so `EntityList.spawn` can REFUSE them by name instead of guessing a
// default. A default here would be invisible: the entity would fall, at the wrong rate, for ever.
const motion = {};
for (const F of [MOTION, MOTION_SRC, MOTION_STATIC]) {
  if (!existsSync(F)) continue;
  for (const l of readFileSync(F, 'utf8').split(/\r?\n/)) {
    if (F !== MOTION && l[0] !== '#' && l) { const nm = l.split('\t')[0]; if (motion[nm]) { console.error(`pack-entities: ${nm} is in both motion tables`); process.exit(1); } }
    if (!l || l[0] === '#') continue;
    const [name, , g, d] = l.split('\t');
    if (!name) continue;
    const G = Number(g);
    if (!Number.isFinite(G)) continue;
    if (d === undefined || d === '') continue;          // drag unread -> not simulatable
    const D = Number(d);
    if (!Number.isFinite(D)) continue;
    motion[name] = [G, D];
  }
}
for (const n of Object.keys(motion)) {
  if (!table[n]) { console.error(`pack-entities: ${n} has motion but is not an entity type`); process.exit(1); }
}

// ── the ATTRIBUTES table (D-336) ────────────────────────────────────────────────────────────
// ⚠ AN ENTITY WITH NO MAX HEALTH IS NOT A LIVING ENTITY, and the distinction is the jar's, not a
// judgement: 74 types resolve a max health through their class chain and 38 do not — items,
// arrows, boats, minecarts, TNT. `EntityList` uses exactly that to decide what can be hurt, so
// "can this be attacked" is a fact about vanilla rather than a list somebody kept.
const attrs = {};
if (existsSync(ATTRS)) {
  for (const l of readFileSync(ATTRS, 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.split('\t');
    if (!c[0] || c[0] === 'type') continue;
    const hp = Number(c[2]);
    if (!Number.isFinite(hp)) continue;
    const num = (v) => (v === undefined || v === '' ? null : Number(v));
    attrs[c[0]] = { hp: hp, speed: num(c[3]), dmg: num(c[4]), follow: num(c[5]), kbRes: num(c[6]), atkKb: num(c[7]) };
  }
}
for (const n of Object.keys(attrs)) {
  if (!table[n]) { console.error(`pack-entities: ${n} has attributes but is not an entity type`); process.exit(1); }
}

// ── the BREEDING table (G18e) ──────────────────────────────────────────────────────
// ⚠ FOUR KINDS, AND THE DIFFERENCE BETWEEN THEM IS THE POINT (extract-breeding.mjs). `items`
// is an explicit list, `tag` is an item tag resolved at runtime, `none` means the animal CANNOT
// be bred in vanilla (parrot, polar bear) and `predicate` means the rule is not a list at all
// (wolf: any edible item whose FoodProperties say meat). A packer that flattened `none` and
// `predicate` into "no items" would turn "vanilla forbids this" into "we have not built it".
const breeding = {}; const breedConst = {};
if (existsSync(BREED)) {
  for (const l of readFileSync(BREED, 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.split('\t');
    if (c[0] === '!const') { breedConst[c[1]] = Number(c[2]); continue; }
    const name = c[0];
    if (!name || name === '-') continue;               // abstract bases carry no registry name
    const kind = c[3];
    const items = (c[4] || '').split(',').filter(Boolean);
    const tags = (c[5] || '').split(',').filter(Boolean);
    breeding[name] = { k: kind, i: items, t: tags };
  }
}
for (const n of Object.keys(breeding)) {
  if (!table[n]) { console.error(`pack-entities: ${n} has a breeding row but is not an entity type`); process.exit(1); }
}
if (Object.keys(breeding).length &&
    !['inLoveTicks', 'breedCooldownAge', 'xpBound', 'babyStartAge', 'ageUpUnit', 'forcedAgeTimer', 'babyScale'].every((k) => Number.isFinite(breedConst[k]))) {
  console.error('pack-entities: the breeding table is missing one of its constants'); process.exit(1);
}

// ── the BABY MODEL table (G18e unit 2) ─────────────────────────────────────────
// ⚠ A BABY IS TWO GROUPS WITH TWO DIFFERENT TRANSFORMS, not one smaller mob:
// `AgeableListModel` scales and shifts the HEAD parts and the BODY parts separately, and for a
// cow the head is not scaled at all. `tools/extract-babymodel.mjs` reads the six numbers per
// model class out of the bytecode -- including what each of them MEANS.
const baby = {};
if (existsSync(BABY)) {
  for (const l of readFileSync(BABY, 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.split('\t');
    if (!c[0] || c.length < 11) continue;
    baby[c[0]] = {
      sh: Number(c[4]) ? 1 : 0,
      hy: Number(c[5]), hz: Number(c[6]),
      hs: Number(c[7]), bs: Number(c[8]), by: Number(c[9]),
      head: c[10].split(',').filter(Boolean)
    };
  }
}
for (const n of Object.keys(baby)) {
  if (!table[n]) { console.error(`pack-entities: ${n} has a baby model but is not an entity type`); process.exit(1); }
  const b = baby[n];
  // ⚠ QUEUE 0.2 (Tame/Breed remainder) — AN EMPTY `head` LIST IS A VALID ANSWER FOR SOME MOBS,
  // NOT A MISSING ONE: axolotl's and bee's own `AnimalModel` subclasses declare
  // `getHeadParts() { return ImmutableList.of(); }` (.decomp AxolotlEntityModel.java,
  // BeeEntityModel.java) — the whole model is one `body` group with no separate head scale, and
  // `ER.babyTransform` (07j_entityrender.js) already treats "not in `b.head`" as "use the body
  // branch", which an empty list satisfies for every part. Only a zero SCALE is still refused.
  if (!(b.hs > 0) || !(b.bs > 0)) {
    console.error(`pack-entities: ${n}'s baby row has a zero head/body scale`); process.exit(1);
  }
}

// ── the ON-GROUND law (D-427) ─────────────────────────────────────────────
// ⚠ A TYPE WITH NO ROW KEEPS THE UNIFORM DRAG AND IS NOT AN ERROR. `extract-entity-motion.mjs`
// refuses to guess a drag and `EntityList.spawn` refuses the type outright; this table is one
// level gentler, because an entity with no on-ground branch in its tick (an arrow, a mob, which
// travels through `Physics.travelMob` instead) is CORRECTLY described by the uniform drag alone.
// The empty cell means "vanilla has nothing extra here", not "we did not look".
const ground = {};
if (existsSync(GROUND)) {
  for (const l of readFileSync(GROUND, 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.split('\t');
    const name = c[0], mode = c[2];
    if (!name || !mode) continue;
    if (mode !== 'block' && mode !== 'flat') {
      console.error(`pack-entities: ${name} has an unknown on-ground mode "${mode}"`); process.exit(1);
    }
    const num = (v) => (v === undefined || v === '' ? null : Number(v));
    const row = { m: mode, k: num(c[3]), dy: num(c[4]), f: num(c[5]), b: num(c[6]), g: c[7] || 'always', rs: num(c[8]) || 0 };
    if (mode === 'block' && !(row.k > 0 && row.dy > 0)) {
      console.error(`pack-entities: ${name}'s block-friction row has no factor`); process.exit(1);
    }
    if (mode === 'flat' && !(row.f > 0)) {
      console.error(`pack-entities: ${name}'s flat row has no ground friction`); process.exit(1);
    }
    if (!(row.b < 0)) { console.error(`pack-entities: ${name}'s bounce ${row.b} is not negative`); process.exit(1); }
    ground[name] = row;
  }
}
for (const n of Object.keys(ground)) {
  if (!table[n]) { console.error(`pack-entities: ${n} has an on-ground law but is not an entity type`); process.exit(1); }
  if (!motion[n]) { console.error(`pack-entities: ${n} has an on-ground law but no measured motion`); process.exit(1); }
}

// ── the ZOMBIE-ARM layer (D-429) ─────────────────────────────────────────
// ⚠ IT IS A LIST OF ENTITIES AND IT IS NOT A LIST SOMEBODY KEPT. `AbstractZombieModel` is not
// the only caller of `animateZombieArms` — the illager model calls it too, which is why a
// vindicator charges with its arms out — so the set comes off the jar's own call graph rather
// than from the word "zombie". A hand-written list would have had four of the five wrong.
const zarms = { c: {}, on: [] };
if (existsSync(ZARMS)) {
  for (const l of readFileSync(ZARMS, 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.split('\t');
    if (c[0] === '!const') { zarms.c[c[1]] = Number(c[2]); continue; }
    if (c[0] === '!class') continue;
    if (c[0] && table[c[0]]) zarms.on.push(c[0]);
    else if (c[0]) { console.error(`pack-entities: ${c[0]} has a zombie-arm row but is not an entity type`); process.exit(1); }
  }
  const need = ['yawBase', 'yawSwing', 'aggrDiv', 'calmDiv', 'swing1', 'swing2', 'bobZFreq', 'bobXFreq', 'bobAmp'];
  if (zarms.on.length && !need.every((k) => Number.isFinite(zarms.c[k]))) {
    console.error('pack-entities: the zombie-arm table is missing one of its constants'); process.exit(1);
  }
  if (zarms.on.length && !(zarms.c.aggrDiv < zarms.c.calmDiv)) {
    console.error('pack-entities: the aggressive divisor is not the smaller one'); process.exit(1);
  }
}

// ── fall damage (#5792): types whose handleFallDamage chain is a bare `return false;` ──
const fallNone = {};
{
  const F = join(ROOT, 'tools', 'golden', 'fall-entities-1.18.2.tsv');
  if (existsSync(F)) for (const l of readFileSync(F, 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.split('\t');
    if (c[2] === 'false') fallNone[c[0]] = 1;
  }
}

const names = Object.keys(table).sort();
const json = JSON.stringify({ v: 7, zarms: zarms, types: table, motion: motion, attrs: attrs, breeding: breeding, breedConst: breedConst, baby: baby, ground: ground, fallNone: fallNone });
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(join(OUTDIR, 'entities.json'), json);
writeFileSync(join(OUTDIR, 'entities.meta.json'), JSON.stringify({
  count: names.length, bytes: json.length,
  fireImmune: names.filter((n) => table[n][2]).length,
  motion: Object.keys(motion).length,
  attrs: Object.keys(attrs).length,
  breeding: Object.keys(breeding).length,
  baby: Object.keys(baby).length,
  ground: Object.keys(ground).length,
  zarms: zarms.on.length,
}));
say('================ pack-entities ================');
say(` entity types ...... ${names.length}`);
say(` fire-immune ....... ${names.filter((n) => table[n][2]).length}`);
say(` bodiless (0 x 0) .. ${names.filter((n) => table[n][0] === 0 && table[n][1] === 0).join(' ')}`);
say(` with motion ....... ${Object.keys(motion).length}  (${Object.keys(motion).sort().join(' ') || 'none'})`);
say(` living (max health) ${Object.keys(attrs).length} of ${names.length}   (D-336)`);
say(` breedable ......... ${Object.values(breeding).filter((b) => b.k === 'items' || b.k === 'tag' || b.k === 'mixed').length} of ${Object.keys(breeding).length} animals  (${Object.values(breeding).filter((b) => b.k === 'none').length} cannot breed, ${Object.values(breeding).filter((b) => b.k === 'predicate').length} by predicate)`);
say(` on-ground law ..... ${Object.keys(ground).length}  (${Object.keys(ground).map((n) => n + ':' + ground[n].m).sort().join(' ') || 'none'})`);
say(` zombie-arm layer .. ${zarms.on.length}  (${zarms.on.join(' ') || 'none'})`);
say(` baby models ....... ${Object.keys(baby).length}  (${Object.keys(baby).filter((n) => baby[n].sh).length} scale the head, ${Object.keys(baby).filter((n) => !baby[n].sh).length} do not)`);
say(` json .............. ${(json.length / 1024).toFixed(1)} KB`);
say(` -> ${join(OUTDIR, 'entities.json')}`);
say('==============================================');
