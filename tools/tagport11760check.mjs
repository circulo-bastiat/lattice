#!/usr/bin/env node
// tagport11760check.mjs — #11760: src/02t_tagclasses.js (net/minecraft/tag) against the decompiled constants and vanilla semantics.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'src/02t_tagclasses.js'), 'utf8');
const dec = n => readFileSync(join(ROOT, '.decomp/net/minecraft/tag/' + n + '.java'), 'utf8');
const names = (t, re) => [...t.matchAll(re)].map(m => m[1]);
const decNames = n => names(dec(n), /(?:register|of)\("([^"]+)"\)/g);
function scenario(code) { try { return s0(code); } catch (e) { return ['threw: ' + e.message]; } }
function s0(code) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const members = { blocks: { logs: ['a', 'b'] }, entity_types: { skeletons: ['skeleton'] } };
  const NS = { Tags: { members: (r, n) => members[r] && members[r][n] }, WG: { biomeTag: n => n === 'is_ocean' ? ['ocean'] : undefined } };
  new Function('MCL', code)(NS);
  const T = NS.TagClasses, { Tag, TagKey, TagGroupLoader, TagPacketSerializer } = T;
  for (const [h, n] of [['BiomeTags', 'BiomeTags'], ['EntityTypeTags', 'EntityTypeTags'], ['GameEventTags', 'GameEventTags']])
    chk(Object.keys(T[h]).join() === decNames(n).join(), h + ' names/order');
  chk(TagKey.of('block', 'logs') === TagKey.of('block', 'minecraft:logs'), 'interned');
  chk(TagKey.of('block', 'logs') !== TagKey.of('item', 'logs'), 'registry distinguishes');
  chk(TagKey.of('block', 'logs').toString() === 'TagKey[minecraft:block / minecraft:logs]', 'toString');
  chk(TagKey.stringCodecDecode('block', 'logs') === null && TagKey.stringCodecDecode('block', '#logs').id === 'minecraft:logs', 'string codec');
  // loader: nested tags, optional, missing, replace
  const reg = { 'minecraft:a': 1, 'minecraft:b': 2, 'minecraft:c': 3 };
  const L = new TagGroupLoader(id => reg[id], 'tags/blocks');
  const g = L.load([
    { id: 'minecraft:outer', packName: 'p', json: { values: ['#minecraft:inner', 'minecraft:c', { id: 'minecraft:zz', required: false }] } },
    { id: 'minecraft:inner', packName: 'p', json: { values: ['minecraft:a', 'minecraft:b'] } },
    { id: 'minecraft:inner', packName: 'q', json: { values: ['minecraft:c'] } },
    { id: 'minecraft:bad', packName: 'p', json: { values: ['minecraft:nope'] } },
    { id: 'minecraft:badtag', packName: 'p', json: { values: ['#minecraft:bad'] } },
    { id: 'minecraft:opt', packName: 'p', json: { values: [{ id: '#minecraft:bad', required: false }, 'minecraft:a'] } },
    { id: 'minecraft:first', packName: 'p', json: { values: [{ id: '#minecraft:later', required: false }] } },
    { id: 'minecraft:later', packName: 'p', json: { values: ['minecraft:b'] } },
    { id: 'minecraft:rep', packName: 'p', json: { values: ['minecraft:a'] } },
    { id: 'minecraft:rep', packName: 'q', json: { values: ['minecraft:b'], replace: true } }
  ]);
  chk(g.get('minecraft:inner').values.join() === '1,2,3', 'merge across packs ' + (g.get('minecraft:inner') || {}).values);
  chk(g.get('minecraft:outer').values.join() === '1,2,3', 'nested tag + optional missing (dedup) ' + (g.get('minecraft:outer') || {}).values);
  chk(!g.has('minecraft:bad') && !g.has('minecraft:badtag'), 'missing reference drops tag and dependents');
  chk(g.has('minecraft:opt') && g.get('minecraft:opt').values.join() === '1', 'optional tag ref tolerated');
  chk(g.get('minecraft:rep').values.join() === '2', 'replace clears');
  chk(g.has('minecraft:first') && g.get('minecraft:first').values.join() === '2', 'optional tag ref ordered after its target');
  // cycle must terminate
  const cyc = L.load([{ id: 'minecraft:x', packName: 'p', json: { values: ['#minecraft:y'] } }, { id: 'minecraft:y', packName: 'p', json: { values: ['#minecraft:x'] } }]);
  chk(cyc instanceof Map, 'cycle terminates');
  // packet serializer round trip
  const rr = { tags: new Map([['minecraft:logs', ['a', 'b']], ['minecraft:big', ['c']]]), getRawId: v => ({ a: 0, b: 300, c: 5 })[v], getEntry: n => ({ 0: 'a', 300: 'b', 5: 'c' })[n] };
  const ser = TagPacketSerializer.serializeTags(rr);
  const rt = TagPacketSerializer.Serialized.fromBuf(ser.writeBuf());
  const got = []; TagPacketSerializer.loadTags('block', rr, rt, (k, v) => got.push(k.id + '=' + v.join('')));
  chk(got.join() === 'minecraft:logs=ab,minecraft:big=c', 'packet round trip ' + got);
  chk(ser.writeBuf()[1] === 'minecraft:logs'.length, 'varint-length id prefix');
  chk(new TagPacketSerializer.Serialized(new Map()).isEmpty(), 'isEmpty');
  // reach
  chk(NS.Tags.ofKey && NS.Tags.ofKey(T.EntityTypeTags.skeletons).join() === 'skeleton', 'Tags.ofKey entity');
  chk(NS.Tags.ofKey(T.BiomeTags.is_ocean).join() === 'ocean', 'Tags.ofKey biome');
  chk(NS.Tags.ofKey(TagKey.of('block', 'logs')).length === 2, 'Tags.ofKey block');
  return f;
}
const bad = scenario(src);
if (bad.length) { console.log('FAIL: ' + bad.join('; ')); process.exit(1); }
const breaks = [
  [s => s.replace("'is_deep_ocean', 'is_ocean'", "'is_ocean', 'is_deep_ocean'"), 'biome tag order'],
  [s => s.replace("return interned[k] ||", "return "), 'interning'],
  [s => s.replace("if (json.replace === true) this.entries.length = 0;", ""), 'replace'],
  [s => s.replace("case 'tag': { var t = tg(this.id); if (!t) return false;", "case 'tag': { var t = tg(this.id); if (!t) return true;"), 'required tag'],
  [s => s.replace("if (d) d.forEach(visit);", ""), 'dependency order'],
  [s => s.replace("this.kind === 'optionaltag') f(this.id); };", "false) f(this.id); };"), 'group ids'],
  [s => s.replace("(b & 127) << s", "(b & 127) << 0"), 'varint decode'],
  [s => s.replace("s.charAt(0) === '#' ?", "true ?"), 'string codec'],
  [s => s.replace("if (NS.Tags) NS.Tags.ofKey", "if (false) NS.Tags.ofKey"), 'reach']
];
let caught = 0;
for (const [fn, why] of breaks) {
  const b = fn(src); if (b === src) { console.log('break did not apply: ' + why); process.exit(1); }
  if (scenario(b).length) caught++; else console.log('NOT caught: ' + why);
}
if (caught !== breaks.length) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('PASS tagport11760check — ' + caught + ' breaks caught; 8 net/minecraft/tag classes ported');
