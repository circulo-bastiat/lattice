#!/usr/bin/env node
// pack-advancements.mjs — PLAN G26c. Vanilla's 1,141 advancement files into one runtime blob.
//
//   node tools/pack-advancements.mjs [--jar ...] [--out assets]
//
// Every advancement in 1.18.2 is DATA (`data/minecraft/advancements/**.json`): 95 tab/tree (displayed)
// advancements (story, nether, end, adventure, husbandry, plus the recipe-book roots) and 1,046
// `recipes/**` ones whose only job is to unlock a recipe. Nothing is hard-coded, so nothing is
// written here: each file is validated by the rules of `Advancement.Builder.fromJson` (the same
// checks, in the same order) and packed as parsed. A file that vanilla would REJECT fails the
// build rather than shipping as an advancement the manager silently drops.
//
// ⚠ CRITERION CONDITIONS ARE KEPT RAW. Deserialising them into predicates is the trigger
// layer's job (G26d); the packer only proves `trigger` is present and names it, so the blob is
// the single source for both.
//
// Requirements are STORED, not left to the loader: an empty/missing `requirements` array is
// expanded here to the AND merger's `[[a],[b],...]` exactly as `fromJson` does, so the runtime
// never has to remember the rule.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { JARS as MCLITE_JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flat = MCLITE_JARS + '/1.18.2.jar', nested = MCLITE_JARS + '/1.18.2/1.18.2.jar';
const JAR = opt('jar', existsSync(flat) ? flat : nested);
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);
const PREFIX = 'data/minecraft/advancements/';
const names = jar.names().filter((n) => n.startsWith(PREFIX) && n.endsWith('.json')).sort();
const FRAMES = ['task', 'challenge', 'goal'];
const bad = (id, m) => { console.error('pack-advancements: ' + id + ': ' + m); process.exit(1); };

const adv = {};
const report = { withDisplay: 0, roots: 0, recipes: 0, frames: {}, triggers: {}, criteria: 0 };
for (const n of names) {
  const id = 'minecraft:' + n.slice(PREFIX.length, -5);
  const j = JSON.parse(jar.read(n).toString('utf8'));
  const o = {};
  if (j.parent !== undefined) o.p = j.parent; else report.roots++;
  if (j.display !== undefined) {
    const d = j.display;
    if (!d.title || !d.description) bad(id, 'Both title and description must be set');
    if (!d.icon || !d.icon.item) bad(id, 'icon needs an item');
    if (d.icon.data !== undefined) bad(id, 'Disallowed data tag found');
    const frame = d.frame === undefined ? 'task' : d.frame;
    if (!FRAMES.includes(frame)) bad(id, "Unknown frame type '" + frame + "'");
    report.frames[frame] = (report.frames[frame] || 0) + 1;
    o.d = { t: d.title, ds: d.description, i: d.icon.item };
    if (d.icon.nbt !== undefined) o.d.n = d.icon.nbt;
    if (d.background !== undefined) o.d.b = d.background;
    o.d.f = FRAMES.indexOf(frame);
    o.d.s = d.show_toast === undefined ? true : !!d.show_toast;
    o.d.a = d.announce_to_chat === undefined ? true : !!d.announce_to_chat;
    o.d.h = !!d.hidden;
    report.withDisplay++;
  }
  if (j.rewards !== undefined) {
    const r = {};
    if (j.rewards.experience) r.xp = j.rewards.experience | 0;
    if (j.rewards.loot && j.rewards.loot.length) r.loot = j.rewards.loot;
    if (j.rewards.recipes && j.rewards.recipes.length) r.recipes = j.rewards.recipes;
    if (j.rewards.function) r.fn = j.rewards.function;
    o.r = r;
  }
  const keys = Object.keys(j.criteria || {});
  if (!keys.length) bad(id, 'Advancement criteria cannot be empty');
  o.c = {};
  for (const k of keys) {
    const c = j.criteria[k];
    if (typeof c.trigger !== 'string') bad(id, 'criterion ' + k + ' has no trigger');
    o.c[k] = c.conditions && Object.keys(c.conditions).length ? [c.trigger, c.conditions] : [c.trigger];
    report.triggers[c.trigger] = (report.triggers[c.trigger] || 0) + 1;
    report.criteria++;
  }
  let q = j.requirements || [];
  if (!q.length) q = keys.map((k) => [k]);
  for (const row of q) for (const k of row) if (!(k in o.c)) bad(id, "Unknown required criterion '" + k + "'");
  for (const k of keys) if (!q.some((row) => row.includes(k))) bad(id, "Criterion '" + k + "' isn't a requirement for completion");
  o.q = q;
  if (id.startsWith('minecraft:recipes/')) report.recipes++;
  adv[id] = o;
}
// every parent must exist, or the manager would never load it (AdvancementManager.load's break)
for (const [id, o] of Object.entries(adv)) if (o.p !== undefined && !adv[o.p]) bad(id, 'parent ' + o.p + ' is not an advancement');

const raw = Buffer.from(JSON.stringify({ v: '1.18.2', a: adv }), 'utf8');
const deflated = deflateRawSync(raw, { level: 9 });
if (Buffer.compare(inflateRawSync(deflated), raw) !== 0) bad('*', 'deflate round trip did not match');
writeFileSync(join(OUT, 'advancements.bin'), deflated);
writeFileSync(join(OUT, 'advancements.meta.json'), JSON.stringify({
  rawBytes: raw.length, files: names.length, withDisplay: report.withDisplay, roots: report.roots,
  recipes: report.recipes, criteria: report.criteria, frames: report.frames,
  triggers: Object.keys(report.triggers).length,
}, null, 2));
console.log('================ pack-advancements ================');
console.log(' advancement files .. ' + names.length + '  (' + report.recipes + ' recipe unlocks, ' + report.withDisplay + ' displayed, ' + report.roots + ' roots)');
console.log(' criteria ........... ' + report.criteria + ' over ' + Object.keys(report.triggers).length + ' triggers');
console.log(' advancements.bin ... ' + (raw.length / 1024).toFixed(1) + ' KB raw -> ' + (deflated.length / 1024).toFixed(1) + ' KB deflated');
console.log(' ' + (Date.now() - t0) + ' ms');
