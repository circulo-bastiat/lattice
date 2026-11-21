#!/usr/bin/env node
// textnbtcheck.mjs — G17-TX3. JSON text component {"nbt":path,"block"|"entity"|"storage"} (NbtText).
// The resolver is stubbed with fixed NBT roots; the check grades Text.fromJson/runs: path, interpret, separator.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js']) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
const T = NS.Text;
const snbt = v => Array.isArray(v) ? '[' + v.map(snbt).join(', ') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => k + ': ' + snbt(v[k])).join(', ') + '}' : typeof v === 'string' ? '"' + v + '"' : String(v);
const roots = { 'block:1 2 3': { Items: [{ id: 'minecraft:stone', Count: 1 }] }, 'entity:@e': [{ Health: 20 }, { Health: 7 }].map(x => x),
  'storage:a:b': { c: { n: 1, s: 'x' }, j: '{"text":"hi"}' } };
const get = (o, p) => String(p).match(/[^.\[\]]+/g).reduce((a, k) => a.flatMap(v => v && v[k] !== undefined ? [v[k]] : []), [o]);
let broken = '';
const install = () => { T.nbtResolve = c => {
  let r = roots[c.source + ':' + c.target]; if (!r) return [];
  const list = c.source === 'entity' ? r : [r], out = [];
  for (const x of list) for (const v of get(x, c.nbt)) out.push({ snbt: snbt(v), str: typeof v === 'string' ? v : undefined });
  return out; }; };
const render = j => T.runs(T.fromJson(j)).map(r => r.text).join('');
const run = () => {
  install();
  const f = [];
  const t = (got, want, m) => { if (got !== want) f.push(m + ': ' + JSON.stringify(got) + ' != ' + JSON.stringify(want)); };
  t(render({ nbt: 'Items[0].id', block: '1 2 3' }), '"minecraft:stone"', 'chest id');
  t(render({ nbt: 'Health', entity: '@e', separator: ' | ' }), '20 | 7', 'entity health, separator');
  t(render({ nbt: 'Health', entity: '@e' }), '20, 7', 'default separator');
  t(render({ nbt: 'c', storage: 'a:b' }), '{n: 1, s: "x"}', 'storage compound');
  t(render({ nbt: 'j', storage: 'a:b', interpret: true }), 'hi', 'interpret');
  t(render({ nbt: 'nope', storage: 'a:b' }), '', 'missing path');
  t(JSON.stringify(T.JSON_OWED.includes('nbt')), 'false', 'nbt owed');
  return f;
};
const base = run();
let caught = 0;
const origRuns = T.runs;
// break 1: ignore interpret
{ const g = T.fromJson; T.fromJson = j => { const c = g(j); const w = n => { if (n && n.interpret) n.interpret = false; (n && n.extra || []).forEach(w); }; w(c); return c; };
  if (run().length) caught++; T.fromJson = g; }
// break 2: join without the separator
{ const g = T.fromJson; T.fromJson = j => { const c = g(j); const w = n => { if (n && n.separator) n.separator = T.literal(''); (n && n.extra || []).forEach(w); }; w(c); return c; };
  if (run().length) caught++; T.fromJson = g; }
console.log(base.length ? base.join('\n') : 'ok');
console.log('7 assertions, ' + base.length + ' failures, ' + caught + ' breaks caught');
process.exit(base.length || caught < 2 ? 1 : 0);
