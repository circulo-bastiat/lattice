#!/usr/bin/env node
// scorecritcheck.mjs -- #11046 G26: ScoreboardCriterion.getOrCreateStatCriterion. Only registry-valid stat
// types/ids are criteria (else argument.criteria.invalid); the score follows ServerPlayerEntity.increaseStat
// (the StatHandler counter saturates at 2^31-1, the score adds unsaturated and wraps like Java int).
// Breaks its own data: prints "<n> breaks caught".
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };
const reg = JSON.parse(readFileSync(MCLITE_ROOT + '.mcdata/1.18.2/_registries.json', 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07zzo_stats.js', '07zzo2_scoreboard.js'];
const mk = (patch) => { const E = loadEngine({ extra: EXTRA, dom: false, patch }); initRegistry(E); const A = MCLITE_ROOT + 'assets/'; E.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes }); return E; };
const valid = (E, s) => E.Scoreboard.isCriterion(s);
const E = mk(null);
ok(JSON.stringify(E.Stats.ENTITY_TYPES) === JSON.stringify(reg.entity_type.map((x) => x.replace(/^minecraft:/, ''))), 'ENTITY_TYPES == .mcdata entity_type');
for (const s of ['minecraft.mined:minecraft.stone', 'minecraft.crafted:minecraft.stick', 'minecraft.used:minecraft.apple',
  'minecraft.broken:minecraft.iron_pickaxe', 'minecraft.picked_up:minecraft.dirt', 'minecraft.dropped:minecraft.dirt',
  'minecraft.killed:minecraft.zombie', 'minecraft.killed_by:minecraft.creeper', 'minecraft.custom:minecraft.jump', 'dummy', 'deathCount'])
  ok(valid(E, s), s + ' valid');
for (const s of ['minecraft.mined:minecraft.nonsense', 'minecraft.mined:minecraft.apple', 'minecraft.bogus:minecraft.stone',
  'minecraft.killed:minecraft.stone', 'minecraft.custom:minecraft.stone', 'minecraft.mined', 'minecraft.mined:', 'foo.mined:minecraft.stone',
  'minecraft.mined:foo.stone', 'minecraft.mined:minecraft.stone:x', 'bogus'])
  ok(!valid(E, s), s + ' invalid');
// counter saturates, score wraps like Int add
{
  const e = mk(null), SB = e.Scoreboard, c = 'minecraft.custom:minecraft.jump';
  const o = SB.add('j', c); e.Player = { name: 'P' }; e.Stats.reset();
  e.Stats.increase(c, 5); ok(SB.getScore('P', o) === 5, 'score follows increase');
  e.Stats.set(c, 2147483646); e.Stats.increase(c, 10);
  ok(e.Stats.get(c) === 2147483647, 'counter saturates');
}
caught(valid(mk((f, s) => f === '07zzo_stats.js' ? s.replace("reg === 'block') return NS.Reg.id[v[1]] !== undefined", "reg === 'block') return true") : s), 'minecraft.mined:minecraft.nonsense'), 'block id validation dropped');
caught(valid(mk((f, s) => f === '07zzo_stats.js' ? s.replace("St.ENTITY_TYPES.indexOf(v[1]) >= 0", "true") : s), 'minecraft.killed:minecraft.stone'), 'entity validation dropped');
caught(valid(mk((f, s) => f === '07zzo_stats.js' ? s.replace("if (!reg) return false", "if (false) return false") : s), 'minecraft.bogus:minecraft.jump'), 'stat type validation dropped');
caught(valid(mk((f, s) => f === '07zzo2_scoreboard.js' ? s.replace('NS.Stats.criterionValid(name)', 'true') : s), 'bogus'), 'isCriterion wired to registry');
for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
