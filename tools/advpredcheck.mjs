#!/usr/bin/env node
// advpredcheck.mjs — G17-AT0. Adv.pred.* driven by conditions read from the real packed advancements.
//   node tools/advpredcheck.mjs
// Match and no-match cases for entity / distance / damage / item predicates; then each predicate is broken
// in a copy of the module and the checks must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function load(src) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', readFileSync(join(ROOT, `src/${f}.js`), 'utf8'))(NS);
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  return NS.Adv;
}
let asserted = 0;
function verify(A) {
  const f = [], P = A.pred, no = (c, m) => { asserted++; if (!c) f.push(m); };
  const cond = (adv, name) => A.data[adv].c[name][1];
  const tags = { 'entity_type:minecraft:arrows': ['minecraft:arrow', 'minecraft:spectral_arrow'] };
  const ctx = { origin: [0, 64, 0], inTag: (k, t, id) => (tags[k + ':' + t] || []).includes(id) };
  // kill_all_mobs: every criterion is a bare type match
  const blaze = cond('minecraft:adventure/kill_all_mobs', 'minecraft:blaze');
  no(P.extended(blaze.entity, ctx, { this: { type: 'minecraft:blaze', x: 1, y: 64, z: 1 } }), 'blaze should match');
  no(!P.extended(blaze.entity, ctx, { this: { type: 'minecraft:creeper', x: 1, y: 64, z: 1 } }), 'creeper must not match blaze');
  no(!P.extended(blaze.entity, ctx, { }), 'missing entity must not match');
  // sniper_duel: skeleton at horizontal distance >= 50, killing blow projectile
  const sd = cond('minecraft:adventure/sniper_duel', 'killed_skeleton');
  const sk = (x) => ({ this: { type: 'minecraft:skeleton', x, y: 64, z: 0 } });
  no(P.extended(sd.entity, ctx, sk(60)), 'skeleton at 60 matches');
  no(P.extended(sd.entity, ctx, sk(50)), 'skeleton at exactly 50 matches (min inclusive)');
  no(!P.extended(sd.entity, ctx, sk(49.9)), 'skeleton at 49.9 must not match');
  no(P.damage(sd.killing_blow, ctx, { projectile: true }) && !P.damage(sd.killing_blow, ctx, { projectile: false }), 'killing_blow projectile');
  // shoot_arrow: projectile damage whose direct entity is in #arrows
  const sa = cond('minecraft:adventure/shoot_arrow', 'shot_arrow').damage.type;
  no(P.damage(sa, ctx, { projectile: true, source: { type: 'minecraft:arrow' } }), 'arrow damage matches');
  no(!P.damage(sa, ctx, { projectile: true, source: { type: 'minecraft:snowball' } }), 'snowball not an arrow');
  no(!P.damage(sa, ctx, { projectile: false, source: { type: 'minecraft:arrow' } }), 'non-projectile fails');
  no(!P.damage(sa, ctx, { projectile: true }), 'no direct entity fails');
  // totem_of_undying: item predicate
  const it = cond('minecraft:adventure/totem_of_undying', 'used_totem').item;
  no(P.item(it, ctx, { id: 'minecraft:totem_of_undying', count: 1 }), 'totem matches');
  no(!P.item(it, ctx, { id: 'minecraft:stick', count: 1 }), 'stick not a totem');
  no(!P.item(it, ctx, null), 'no stack fails');
  // ranges / item extras
  no(P.item({ count: { min: 2 } }, ctx, { id: 'a', count: 2 }) && !P.item({ count: { min: 2 } }, ctx, { id: 'a', count: 1 }), 'count range');
  no(P.item({ durability: { max: 10 } }, ctx, { id: 'a', count: 1, maxDamage: 100, damage: 95 }) && !P.item({ durability: 1 }, ctx, { id: 'a', count: 1 }), 'durability');
  no(P.location({ position: { y: { min: 100 } } }, ctx, 0, 120, 0) && !P.location({ position: { y: { min: 100 } } }, ctx, 0, 90, 0), 'location y');
  return f;
}
const base = verify(load(SRC));
if (base.length) { console.log('FAIL', base.join('; ')); process.exit(1); }
const breaks = [
  ['entityType', (s) => s.replace("return stripNs(j) === stripNs(type);", "return true;")],
  ['horizontal distance', (s) => s.replace("P.rangeSqrt(j.horizontal,", "P.rangeSqrt(null,")],
  ['range min', (s) => s.replace("(has(min) && min > v) ||", "")],
  ['damage projectile', (s) => s.replace("!flag(j.is_projectile, d.projectile) ||", "")],
  ['tag lookup', (s) => s.replace("return !!(ctx && ctx.inTag && ctx.inTag('entity_type'", "return !!(ctx && ctx.inTag && !ctx.inTag('entity_type'")],
  ['item list', (s) => s.replace("if (j.items && j.items.map(stripNs).indexOf(stripNs(st.id)) < 0) return false;", "")],
  ['null entity', (s) => s.replace("if (!e) return false;\n    if (!P.entityType", "if (!P.entityType")],
];
let caught = 0;
for (const [name, fn] of breaks) {
  const bs = fn(SRC);
  if (bs === SRC) { console.log('FAIL: break did not apply:', name); process.exit(1); }
  let r; try { r = verify(load(bs)); } catch (e) { r = [String(e)]; }
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else { console.log('FAIL: break not caught:', name); process.exit(1); }
}
console.log(`assertions passed ..... ${asserted}`);
console.log(`${breaks.length} breaks caught (advpredcheck OK)`);
