#!/usr/bin/env node
// lootproviderscheck.mjs — #11742: net/minecraft/loot/provider (number: constant/binomial/score; score: fixed/context;
// nbt: context/storage) via Loot.rollTable (set_count with a score provider, copy_nbt storage). Each is then cut.
import { loadEngine } from './loadsrc.mjs';
console.log('lootproviderscheck — loot number/score/nbt providers');
function scenario(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07e_loot.js'], dom: false });
  const L = M.Loot; L.ready = true;
  const sc = { n: 7 };
  M.Scoreboard = { get: (o) => (o === 'pts' ? 'OB' : null), getScore: (h, o) => (h === 'Steve' || h === 'Alex') && o === 'OB' ? (h === 'Steve' ? sc.n : 3) : null };
  M.Commands = { storage: { 'mod:s': { a: 1 } } };
  const setc = (count) => ({ pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:apple', functions: [{ function: 'minecraft:set_count', count }] }] }] });
  const T = {
    fixed: setc({ type: 'score', target: { type: 'fixed', name: 'Steve' }, score: 'pts' }),
    scaled: setc({ type: 'score', target: { type: 'fixed', name: 'Steve' }, score: 'pts', scale: 2 }),
    ctx: setc({ type: 'score', target: { type: 'context', target: 'killer' }, score: 'pts' }),
    none: setc({ type: 'score', target: { type: 'fixed', name: 'Nobody' }, score: 'pts' }),
    con: setc({ type: 'constant', value: 4 }),
    bin: setc({ type: 'binomial', n: 5, p: 1 }),
    nbt: { pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:apple', functions: [{ function: 'minecraft:copy_nbt', source: { type: 'storage', source: 'mod:s' } }] }] }] },
  };
  L.table = (n) => T[L.key(n)];
  if (patch) patch(M);
  const f = []; const chk = (c, m) => { if (!c) f.push(m); };
  const r = (t, extra) => L.rollTable(t, Object.assign({ rng: new M.JRandom(1) }, extra))[0] || {};
  chk(r('fixed').count === 7, 'fixed score provider: ' + r('fixed').count);
  chk(r('scaled').count === 14, 'score scale: ' + r('scaled').count);
  chk(r('ctx', { killer: { name: 'Alex' } }).count === 3, 'context score provider (killer): ' + JSON.stringify(r('ctx', { killer: { name: 'Alex' } })));
  chk(r('none').count === 0 || r('none').count === undefined, 'missing score -> 0');
  chk(r('con').count === 4, 'constant provider');
  chk(r('bin').count === 5, 'binomial provider');
  chk((r('nbt').nbt || {}).storage && r('nbt').nbt.storage.a === 1, 'storage nbt provider');
  chk(L.NUMBER_PROVIDER_TYPES.length === 4 && L.SCORE_PROVIDER_TYPES.length === 2 && L.NBT_PROVIDER_TYPES.length === 2, 'provider type registries');
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (name, patch) => { const f = scenario(patch); if (f.length) breaks++; else fails.push('cut not caught: ' + name); };
cut('score number', (M) => { M.Loot.scoreNumber = () => 0; });
cut('score holder', (M) => { M.Loot.scoreHolder = () => undefined; });
cut('nbt provider', (M) => { M.Loot.nbtOf = () => undefined; });
cut('registry', (M) => { M.Loot.NUMBER_PROVIDER_TYPES = []; });
console.log(` ${base.length === 0 ? 'baseline clean' : 'baseline dirty'}, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const m of fails) console.log('FAIL ' + m); process.exit(1); }
console.log('PASS lootproviderscheck — 8 assertions, 0 failures, ' + breaks + ' breaks caught');
