#!/usr/bin/env node
// registry11766check.mjs — #11766: src/02q_registry.js (net/minecraft/util/registry ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02q_registry.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.UtilRegistry; }
const ops = (regs) => ({ getRegistry: (k) => regs.get(k) || null, createString: (s) => ({ s }), getString: (t) => t && typeof t.s === 'string' ? { value: t.s } : { error: 'not a string' },
  createList: (l) => ({ l }), getList: (t) => t && t.l ? { value: t.l } : { error: 'not a list' }, createMap: (o) => ({ m: o }), getMap: (t) => t.m });
function scenario(R) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const msg = (fn) => { try { fn(); } catch (e) { return e.message; } return ''; };
  const throws = (fn) => { try { fn(); } catch (e) { return true; } return false; };
  const K = R.RegistryKey, rk = K.ofRegistry('minecraft:thing');
  chk(K.of(rk, 'minecraft:a') === K.of(rk, 'minecraft:a') && K.of(rk, 'minecraft:a') !== K.of(rk, 'minecraft:b'), 'key interning');
  chk(K.of(rk, 'minecraft:a').toString() === 'ResourceKey[minecraft:thing / minecraft:a]' && K.of(rk, 'x:y').isOf(rk), 'key toString/isOf');
  const reg = R.SimpleRegistry(rk, 'stable', null), A = { n: 'A' }, B = { n: 'B' }, C = { n: 'C' };
  const ea = reg.add(K.of(rk, 'minecraft:a'), A, 'stable'); reg.set(5, K.of(rk, 'minecraft:b'), B, 'experimental');
  const ec = reg.add(K.of(rk, 'minecraft:c'), C, 'stable');
  chk(reg.getRawId(A) === 0 && reg.getRawId(B) === 5 && reg.getRawId(C) === 6 && reg.getRawId({}) === -1 && reg.getRawId(null) === -1, 'raw ids');
  chk(reg.get(5) === B && reg.get(3) === null && reg.get(-1) === null && reg.get(99) === null, 'get by int');
  chk(reg.get('minecraft:c') === C && reg.get(K.of(rk, 'minecraft:a')) === A && reg.getId(B) === 'minecraft:b' && reg.getId({}) === null, 'get by id/key');
  chk(reg.size() === 3 && !reg.isEmpty() && reg.containsId('minecraft:a') && !reg.containsId('minecraft:z') && reg.contains(K.of(rk, 'minecraft:b')), 'size/contains');
  chk(reg.getLifecycle() === 'experimental' && reg.getEntryLifecycle(B) === 'experimental' && reg.getEntryLifecycle(A) === 'stable', 'lifecycle');
  chk(Array.from(reg).join() === [A, B, C].join() && reg.streamEntries().length === 3 && reg.getEntry(5).getValue() === B && reg.getEntry(2) === null, 'iteration skips gaps');
  chk(ea.getKey() === K.of(rk, 'minecraft:a') && ea.matchesId('minecraft:a') && ea.matchesRegistry(reg) && !ea.matchesRegistry(R.SimpleRegistry(rk, 'stable', null)) && ea.hasKeyAndValue(), 'reference');
  const rd = R.SimpleRegistry(rk, 'stable', null), n0 = R.errors.length; rd.add(K.of(rk, 'minecraft:a'), A, 'stable');
  rd.add(K.of(rk, 'minecraft:a'), {}, 'stable'); chk(R.errors.length === n0 + 1 && /duplicate key/.test(R.errors[n0]), 'duplicate key logged, not thrown');
  rd.add(K.of(rk, 'minecraft:d'), A, 'stable'); chk(R.errors.length === n0 + 2 && /duplicate value/.test(R.errors[n0 + 1]), 'duplicate value logged, not thrown');
  const D = { n: 'D' }; reg.replace(null, K.of(rk, 'minecraft:a'), D, 'stable');
  chk(reg.get('minecraft:a') === D && reg.getRawId(D) === 0 && reg.getRawId(A) === -1, 'replace keeps id');
  chk(throws(() => reg.replace(9, K.of(rk, 'minecraft:a'), { n: 'E' }, 'stable')), 'replace id mismatch');
  const u = reg.getOrCreateEntry(K.of(rk, 'minecraft:later')); chk(!u.hasKeyAndValue() && throws(() => u.getValue()), 'unbound entry');
  chk(throws(() => reg.freeze()), 'freeze unbound'); 
  const r2 = R.SimpleRegistry(rk, 'stable', null); r2.add(K.of(rk, 'minecraft:a'), A, 'stable'); r2.freeze();
  chk(throws(() => r2.add(K.of(rk, 'minecraft:b'), B, 'stable')) && throws(() => r2.getOrCreateEntry(K.of(rk, 'minecraft:q'))), 'frozen');
  const rn = R.SimpleRegistry(rk, 'stable', null); rn.set(10, K.of(rk, 'a:x'), {}, 'stable'); rn.set(2, K.of(rk, 'a:y'), {}, 'stable'); chk(rn.add(K.of(rk, 'a:z'), {}, 'stable') && rn.getRawId(rn.get('a:z')) === 11, 'nextId stays max');
  const r6 = R.SimpleRegistry(rk, 'stable', (v) => r6.createEntry(v)); chk(/without value/.test(msg(() => r6.getOrCreateEntry(K.of(rk, 'a:b')))), 'intrusive registry cannot create entries');
  // tags
  const T = { id: 'minecraft:t' }, r3 = R.SimpleRegistry(rk, 'stable', null), e1 = r3.add(K.of(rk, 'minecraft:a'), A, 'stable'), e2 = r3.add(K.of(rk, 'minecraft:b'), B, 'stable');
  const nl = r3.getOrCreateEntryList(T); chk(nl === r3.getOrCreateEntryList(T) && nl.size() === 0 && r3.containsTag(T) && nl.isOf(r3), 'named list');
  r3.populateTags(new Map([[T, [e2]]]));
  chk(nl.size() === 1 && nl.get(0) === e2 && nl.contains(e2) && !nl.contains(e1) && e2.isIn(T) && !e1.isIn(T) && r3.iterateEntries(T)[0] === e2, 'populateTags');
  chk(/direct holder/.test(msg(() => r3.populateTags(new Map([[T, [R.RegistryEntry.of(A)]]])))), 'direct in tag');
  chk(/outside registry/.test(msg(() => r3.populateTags(new Map([[T, [R.SimpleRegistry(rk, 'stable', null).getOrCreateEntry(K.of(rk, 'x:y'))]]])))), 'foreign entry in tag');
  r3.clearTags(); chk(nl.size() === 0 && !e2.isIn(T), 'clearTags');
  // intrusive
  const r4 = R.SimpleRegistry(rk, 'stable', (v) => r4.createEntry(v)), X = { n: 'X' }, ix = r4.createEntry(X);
  const r5 = R.SimpleRegistry(rk, 'stable', (v) => R.RegistryEntry.Reference.intrusive(r5, v)); r5.createEntry({});
  chk(!ix.hasKeyAndValue() && throws(() => r5.freeze()), 'intrusive unbound'); r4.add(K.of(rk, 'minecraft:x'), X, 'stable');
  chk(ix.hasKeyAndValue() && r4.getEntry(0) === ix && r4.freeze() === r4 && throws(() => r4.createEntry({})) && throws(() => r4.getOrCreateEntry(K.of(rk, 'a:b'))), 'intrusive');
  // direct entries and lists
  const d = R.RegistryEntry.of(A); chk(d.getType() === 'DIRECT' && d.getKey() === null && !d.isIn(T) && d.getKeyOrValue().right === A && d.matchesRegistry(reg), 'direct entry');
  const dl = R.RegistryEntryList.of([e1, e2]); chk(dl.size() === 2 && dl.contains(e1) && dl.isOf(reg) && dl.getStorage().right.length === 2 && dl.getRandom(() => 0.99) === e2 && R.RegistryEntryList.of([]).getRandom(() => 0) === null, 'direct list');
  chk(throws(() => dl.get(2)), 'list bounds');
  // defaulted
  const dr = R.DefaultedRegistry('minecraft:air', rk, 'stable', null), air = { n: 'air' }, stone = { n: 'stone' };
  dr.add(K.of(rk, 'minecraft:air'), air, 'stable'); dr.add(K.of(rk, 'minecraft:stone'), stone, 'stable');
  chk(dr.get('minecraft:nope') === air && dr.get(77) === air && dr.getRawId({}) === 0 && dr.getId({}) === 'minecraft:air' && dr.getOrEmpty('minecraft:nope') === null && dr.get('minecraft:stone') === stone && dr.getRawId(stone) === 1 && dr.getDefaultId() === 'minecraft:air', 'defaulted');
  chk(dr.getRandom(() => 0).getValue() === air, 'defaulted random');
  // codecs
  const regs = new Map([[rk, reg]]), o = ops(regs), fx = R.RegistryFixedCodec.of(rk);
  const enc = fx.encode(ec, o); chk(enc.value && enc.value.s === 'minecraft:c', 'fixed encode');
  chk(fx.encode(d, o).error && fx.encode(ec, ops(new Map())).error && fx.encode(R.SimpleRegistry(rk, 'stable', null).getOrCreateEntry(K.of(rk, 'a:b')), o).error, 'fixed encode errors');
  chk(fx.decode(o, { s: 'minecraft:c' }).value.first === ec && fx.decode(ops(new Map()), { s: 'x' }).error && fx.decode(o, 5).error, 'fixed decode');
  const lc = R.RegistryCodecs.entryList(rk, null, false), lt = lc.decode(o, { s: '#minecraft:t' });
  chk(lt.value && lt.value.first.getTag().id === 'minecraft:t' && lt.value.first.isOf(reg), 'list codec tag');
  const ll = lc.decode(o, { l: [{ s: 'minecraft:b' }, { s: 'minecraft:c' }] }); chk(ll.value && ll.value.first.size() === 2 && ll.value.first.get(1) === ec, 'list codec list');
  const lo = lc.decode(o, { s: 'minecraft:c' }); chk(lo.value && lo.value.first.size() === 1, 'list codec single');
  chk(R.RegistryCodecs.entryList(rk, null, true).decode(o, { s: 'minecraft:c' }).error, 'alwaysList rejects single');
  const le = lc.encode(ll.value.first, o); chk(le.value && le.value.l.length === 2, 'list encode');
  chk(lc.encode(R.RegistryEntryList.of([ec]), o).value.s === 'minecraft:c', 'single list encodes as one entry');
  chk(R.RegistryCodecs.entryList(rk, null, true).encode(R.RegistryEntryList.of([ec]), o).value.l.length === 1, 'alwaysList encodes list');
  chk(lc.encode(r3.getOrCreateEntryList(T), o).error, 'foreign list encode error');
  chk(lc.encode(nl, ops(new Map([[rk, r3]]))).value.s === '#minecraft:t', 'tag encode');
  chk(lc.decode(ops(new Map()), { s: 'x' }).error && lc.decode(ops(new Map()), { l: [{ s: 'x' }] }).error, 'no registry: refs fail');
  chk(lc.encode(R.RegistryEntryList.of([d]), ops(new Map())).error, 'direct no registry: fixed codec errors');
  const refCodec = { decode: (o2, t) => ({ value: { first: ec, second: t } }), encode: () => ({ error: 'x' }) };
  chk(/without registry/.test(R.RegistryEntryListCodec.create(rk, refCodec, true).decode(ops(new Map()), { l: [{ s: 'x' }] }).error || ''), 'no registry: reference entry rejected');
  chk(throws(() => ea.setKeyAndValue(K.of(rk, 'z:z'), D)), 'holder key change');
  // registry codec
  const eC = { encode: (v) => ({ value: { s: v.n } }), decode: (ops2, t) => ({ value: { first: { n: t.s }, second: t } }) };
  const rc = R.RegistryCodecs.createRegistryCodec(rk, 'experimental', eC), enc2 = rc.encode(reg, o);
  chk(enc2.value && enc2.value.l.length === 3 && enc2.value.l[1].m.id === 5, 'registry codec encode');
  const dec2 = rc.decode(o, enc2.value); chk(dec2.value && dec2.value.first.getRawId(dec2.value.first.get('minecraft:b')) === 5 && dec2.value.first.size() === 3 && dec2.value.first.getLifecycle() === 'experimental', 'registry codec roundtrip');
  // builtin + dynamic manager
  const B2 = R.BuiltinRegistries, bk = K.ofRegistry('minecraft:biome'), br = B2.addRegistry(bk, 'stable', null);
  B2.add(br, 'plains', { n: 'plains' }); chk(br.get('minecraft:plains').n === 'plains' && B2.ROOT.get(bk) === br && B2.ROOT.getRawId(br) === 0, 'builtin add');
  chk(throws(() => B2.validate(B2.ROOT)) === false, 'validate ok'); B2.addRegistry(K.ofRegistry('minecraft:empty'), 'stable', null); chk(throws(() => B2.validate(B2.ROOT)), 'validate empty fails');
  const M = R.DynamicRegistryManager, mm = M.createMutableRegistryManager([bk]);
  chk(mm.getMutable(bk).isSimple && mm.getOptionalManaged(K.ofRegistry('x:y')) === null && throws(() => mm.getManaged(K.ofRegistry('x:y'))) && mm.getOptional(bk) !== null && mm.getOptional(K.ofRegistry('minecraft:empty')) !== null, 'mutable manager');
  mm.getMutable(bk).add(K.of(bk, 'minecraft:p'), { n: 'p' }, 'experimental');
  const im = mm.toImmutable(); chk(im.toImmutable() === im && im.get(bk).size() === 1 && throws(() => im.get(bk).add(K.of(bk, 'a:b'), {}, 'stable')) && mm.getRegistryLifecycle() === 'experimental', 'immutable manager freezes');
  chk(B2.DYNAMIC_REGISTRY_MANAGER.get(bk) === br && B2.DYNAMIC_REGISTRY_MANAGER.streamManagedRegistries().length >= 2 && throws(() => im.get(K.ofRegistry('minecraft:nope'))) , 'manager of root');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const cuts = [
  (s) => s.replace("return k;\n  }\n  var ROOT_ID", "return {registry: reg, value: val, getValue: k.getValue};\n  }\n  var ROOT_ID"),
  (s) => s.replace("return LC[a] >= LC[b] ? a : b;", "return LC[a] >= LC[b] ? b : a;"),
  (s) => s.replace("return v == null || !entryToRawId.has(v) ? -1 : entryToRawId.get(v);", "return v == null || !entryToRawId.has(v) ? 0 : entryToRawId.get(v);"),
  (s) => s.replace("if (nextId <= id) nextId = id + 1;", "nextId = id + 1;"),
  (s) => s.replace("if (checkDupKey && keyToEntry.has(key))", "if (false)"),
  (s) => s.replace("R.errors.push(\"Adding duplicate key", "throw new Error(\"Adding duplicate key"),
  (s) => s.replace("if (valueToEntry.has(value)) R.errors", "if (false) R.errors"),
  (s) => s.replace("if (optId != null && optId !== id) throw new Error('ID mismatch');", ""),
  (s) => s.replace("entryToLifecycle.delete(ov); entryToRawId.delete(ov); valueToEntry.delete(ov);", ""),
  (s) => s.replace("if (frozen) throw new Error('Registry is already frozen (trying", "if (false) throw new Error('Registry is already frozen (trying"),
  (s) => s.replace("if (unbound.length) throw", "if (false) throw"),
  (s) => s.replace("rawIdToEntry.filter(function (e) { return e != null; })", "rawIdToEntry.filter(function (e) { return true; })"),
  (s) => s.replace("if (valueToEntryFn) throw new Error(\"This registry can't create new", "if (false) throw new Error(\"This registry can't create new"),
  (s) => s.replace("if (bad.length) throw new Error('Some intrusive", "if (false) throw new Error('Some intrusive"),
  (s) => s.replace("if (!e.matchesRegistry(self)) throw", "if (false) throw"),
  (s) => s.replace("if (!e.isReference) throw", "if (false) throw"),
  (s) => s.replace("back.forEach(function (tags, e) { e.setTags(tags); });", ""),
  (s) => s.replace("l.contains = function (e) { return e.isIn(tag); };", "l.contains = function (e) { return true; };"),
  (s) => s.replace("l.isOf = function (r) { return registry === r; };", "l.isOf = function (r) { return true; };"),
  (s) => s.replace("keyToEntry.forEach(function (e) { e.setTags([]); }); };", "};"),
  (s) => s.replace("return i === -1 ? getRawId(defaultEntry.getValue()) : i;", "return i;"),
  (s) => s.replace("return i == null ? defaultId : i;", "return i;"),
  (s) => s.replace("return v == null ? defaultEntry.getValue() : v;", "return v;"),
  (s) => s.replace("s.getOrEmpty = function (x) { return get(x); };", "s.getOrEmpty = function (x) { return s.get(x); };"),
  (s) => s.replace("if (defaultId === key.value) defaultEntry = e;", ""),
  (s) => s.replace("return kv.left ? ok(", "return true ? ok("),
  (s) => s.replace("if (!entry.matchesRegistry(reg)) return err(", "if (false) return err("),
  (s) => s.replace("if (isTag(ops, t)) {", "if (false) {"),
  (s) => s.replace("if (!alwaysList && l.length === 1) return entryCodec.encode(l[0], ops);", ""),
  (s) => s.replace("if (r.error && !alwaysList) {", "if (r.error) {"),
  (s) => s.replace("if (!list.isOf(reg)) return err(", "if (false) return err("),
  (s) => s.replace("if (!d.value.first[i].isDirect) return err(", "if (false) return err("),
  (s) => s.replace("ok(ops.createString('#' + st.left.id))", "ok(ops.createString(st.left.id))"),
  (s) => s.replace("reg.set(m.id, keyOf(", "reg.set(0, keyOf("),
  (s) => s.replace("if (r.isEmpty()) bad.push", "if (false) bad.push"),
  (s) => s.replace("ROOT.add(key, reg, lifecycle); return reg;", "return reg;"),
  (s) => s.replace("toImmutable: function () { return mutable ?", "toImmutable: function () { return false ?"),
  (s) => s.replace("return R.Lifecycle.add(a, e.registry.getLifecycle());", "return a;"),
  (s) => s.replace("getOptional: function (k) { return map.get(k) || ROOT.getOrEmpty(k.value) || null; }", "getOptional: function (k) { return map.get(k) || null; }"),
  (s) => s.replace("if (key != null && k !== key) throw", "if (false) throw"),
  (s) => s.replace("return l.length ? l[Math.floor(rnd() * l.length)]", "return l.length ? l[0]").replace("list.length ? list[Math.floor(rnd() * list.length)]", "list.length ? list[0]"),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply', c.toString()); process.exit(1); } let r; try { r = scenario(load(s2)).length; } catch (e) { r = 1; } if (r) caught++; else console.log('uncaught cut', c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS registry11766check — ' + caught + ' breaks caught');
