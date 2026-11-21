#!/usr/bin/env node
// predicate11747check.mjs — #11747: net/minecraft/predicate (the net/minecraft/predicate section of src/02l_advancements.js). Each class is driven directly and through the
// real entry (Adv.pred.entity / location / extended, which the advancement triggers call); then each behaviour is cut and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
const P02 = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
function load(cut) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', readFileSync(join(ROOT, `src/${f}.js`), 'utf8'))(NS);
  let src = P02;
  if (cut) { const n = src.split(cut[0]).length - 1; if (n < 1) throw new Error('cut target missing: ' + cut[0]); src = src.split(cut[0]).join(cut[1]); }
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  return NS;
}
function scenario(cut) { try { return scenario0(cut); } catch (e) { return ['threw: ' + e.message]; } }
function scenario0(cut) {
  const NS = load(cut), Q = NS.Predicate, P = NS.Adv.pred, f = [];
  const chk = (c, m) => { if (!c) f.push(m); };
  const thr = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  const tags = { 'entity_type:minecraft:arrows': ['minecraft:arrow'], 'fluid:minecraft:water': ['minecraft:water', 'minecraft:flowing_water'] };
  const ctx = { origin: [0, 64, 0], inTag: (k, t, id) => (tags[k + ':' + t] || []).includes(id), lightAt: () => 9, fluidAt: () => ({ id: 'minecraft:water', state: { level: 0 } }) };
  // FluidPredicate
  const fp = Q.FluidPredicate.fromJson({ tag: 'water', fluid: 'minecraft:water', state: { level: 0 } });
  chk(fp.test(ctx, { id: 'water', state: { level: 0 } }) && !fp.test(ctx, { id: 'lava', state: { level: 0 } }) && !fp.test(ctx, { id: 'water', state: { level: 3 } }) && !fp.test(ctx, null), 'FluidPredicate tag+fluid+state');
  chk(Q.FluidPredicate.fromJson(null) === Q.FluidPredicate.ANY && Q.FluidPredicate.ANY.test(ctx, null) && Q.FluidPredicate.ANY.toJson() === null, 'FluidPredicate ANY');
  chk(JSON.stringify(fp.toJson()) === '{"fluid":"minecraft:water","tag":"minecraft:water","state":{"level":0}}', 'FluidPredicate toJson ' + JSON.stringify(fp.toJson()));
  // LightPredicate
  const lp = Q.LightPredicate.fromJson({ light: { min: 8, max: 10 } });
  chk(lp.test(ctx, 0, 0, 0) && !Q.LightPredicate.fromJson({ light: { min: 10 } }).test(ctx, 0, 0, 0) && !lp.test({}, 0, 0, 0), 'LightPredicate range / unloaded fails');
  chk(JSON.stringify(lp.toJson()) === '{"light":{"min":8,"max":10}}' && Q.LightPredicate.ANY.test({}, 0, 0, 0), 'LightPredicate toJson/ANY');
  // BlockStatePredicate
  const bs = Q.BlockStatePredicate.forBlock('oak_stairs', ['facing', 'half']).with('facing', (v) => v === 'east');
  chk(bs.test({ id: 'minecraft:oak_stairs', state: { facing: 'east' } }) && !bs.test({ id: 'oak_stairs', state: { facing: 'west' } }) && !bs.test({ id: 'stone', state: { facing: 'east' } }) && !bs.test(null), 'BlockStatePredicate block+property');
  chk(/cannot support property/.test(thr(() => bs.with('waterlogged', () => true))), 'BlockStatePredicate rejects unknown property');
  // Serializer
  const conds = [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:pig' } }], out = Q.AdvancementEntityPredicateSerializer.INSTANCE.conditionsToJson(conds);
  chk(JSON.stringify(out) === JSON.stringify(conds) && out !== conds && out[0] !== conds[0], 'serializer deep copies conditions');
  chk(P.extended(conds, ctx, { this: { type: 'pig' } }) && !P.extended(conds, ctx, { this: { type: 'cow' } }), 'extended through serializer');
  // Distance
  const dp = Q.DistancePredicate.fromJson({ horizontal: { min: 5 }, y: { max: 2 } });
  chk(dp.test(0, 0, 0, 6, 1, 0) && !dp.test(0, 0, 0, 3, 1, 0) && !dp.test(0, 0, 0, 6, 3, 0), 'DistancePredicate horizontal/y');
  chk(Q.DistancePredicate.absolute({ min: 5 }).test(0, 0, 0, 3, 4, 0) && !Q.DistancePredicate.absolute({ min: 5.1 }).test(0, 0, 0, 3, 4, 0), 'DistancePredicate absolute is sqrt');
  chk(Q.DistancePredicate.ANY.test(0, 0, 0, 99, 99, 99) && Q.DistancePredicate.fromJson(null) === Q.DistancePredicate.ANY, 'DistancePredicate ANY');
  // Flags
  const fl = Q.EntityFlagsPredicate.fromJson({ is_on_fire: true, is_baby: false });
  chk(fl.test({ onFire: true, baby: false }) && !fl.test({ onFire: false, baby: false }) && !fl.test({ onFire: true, baby: true }) && fl.test({ onFire: true }) && Q.EntityFlagsPredicate.fromJson({ is_baby: true }).test({}), 'EntityFlagsPredicate (baby only on living)');
  chk(/Boolean/.test(thr(() => Q.EntityFlagsPredicate.fromJson({ is_sneaking: 'yes' }))) && JSON.stringify(fl.toJson()) === '{"is_on_fire":true,"is_baby":false}', 'EntityFlagsPredicate parse/toJson');
  // EntityType
  const t1 = Q.EntityTypePredicate.fromJson('minecraft:pig'), t2 = Q.EntityTypePredicate.fromJson('#arrows');
  chk(t1.matches('pig') && !t1.matches('cow') && t2.matches('arrow', ctx) && !t2.matches('pig', ctx) && t2.toJson() === '#minecraft:arrows' && t1.toJson() === 'minecraft:pig' && Q.EntityTypePredicate.ANY.matches('x'), 'EntityTypePredicate single/tag/any');
  // Enchantment
  const ep = Q.EnchantmentPredicate.deserialize({ enchantment: 'sharpness', levels: { min: 3 } }), anyLv = Q.EnchantmentPredicate.deserialize({ levels: { min: 5 } });
  chk(ep.test({ 'minecraft:sharpness': 3 }) && !ep.test({ 'minecraft:sharpness': 2 }) && !ep.test({}) && anyLv.test({ a: 1, b: 5 }) && !anyLv.test({ a: 1 }) && Q.EnchantmentPredicate.deserialize({ enchantment: 'x' }).test({ 'minecraft:x': 1 }), 'EnchantmentPredicate');
  chk(Q.EnchantmentPredicate.deserializeAll(null) === Q.EnchantmentPredicate.ARRAY_OF_ANY && Q.EnchantmentPredicate.deserializeAll([{ levels: 1 }]).length === 1 && ep.serialize().enchantment === 'minecraft:sharpness' && ep.serialize().levels.min === 3, 'EnchantmentPredicate deserializeAll/serialize');
  // Equipment
  const eq = Q.EntityEquipmentPredicate.fromJson({ head: { items: ['minecraft:iron_helmet'] }, mainhand: { enchantments: [{ enchantment: 'sharpness', levels: { min: 3 } }] } });
  const ent = { equipment: { head: { id: 'iron_helmet', count: 1 }, mainhand: { id: 'iron_sword', count: 1, enchants: { 'minecraft:sharpness': 4 } } } };
  chk(eq.test(ctx, ent) && !eq.test(ctx, { equipment: { head: { id: 'iron_helmet', count: 1 }, mainhand: { id: 'x', count: 1 } } }) && !eq.test(ctx, { type: 'x' }) && Q.EntityEquipmentPredicate.ANY.test(ctx, {}), 'EntityEquipmentPredicate');
  // real entry points
  chk(P.entity({ type: '#arrows', distance: { horizontal: { min: 5 } }, flags: { is_on_fire: true }, equipment: { head: { items: ['minecraft:iron_helmet'] } } }, ctx, { type: 'arrow', x: 6, y: 64, z: 0, onFire: true, equipment: ent.equipment }), 'Adv.pred.entity runs all');
  chk(!P.entity({ type: '#arrows' }, ctx, { type: 'pig' }) && !P.entity({ flags: { is_on_fire: true } }, ctx, { type: 'arrow', onFire: false }), 'Adv.pred.entity rejects');
  chk(P.location({ light: { light: { min: 8 } }, fluid: { fluid: 'water' } }, ctx, 1, 64, 1) && !P.location({ light: { light: { min: 12 } } }, ctx, 1, 64, 1) && !P.location({ fluid: { fluid: 'lava' } }, ctx, 1, 64, 1), 'Adv.pred.location light/fluid');
  chk(P.item({ enchantments: [{ enchantment: 'sharpness', levels: { min: 3 } }] }, ctx, { id: 'iron_sword', count: 1, enchants: { 'minecraft:sharpness': 3 } }) && !P.item({ enchantments: [{ levels: { min: 9 } }] }, ctx, { id: 'iron_sword', count: 1, enchants: { 'minecraft:sharpness': 3 } }), 'Adv.pred.item enchantments');
  return f;
}
const base = scenario(null);
if (base.length) { console.log('FAIL baseline:\n  ' + base.join('\n  ')); process.exit(1); }
const cuts = [
  ['if (this === FluidPredicate.ANY) return true;', 'if (false) return true;'],
  ['this.fluid !== ns(f.id)', 'false'],
  ['return stateOk(this.state, f.state);', 'return true;'],
  ['return rtest(this.range, ctx.lightAt(x, y, z));', 'return true;'],
  ['if (!(ctx && ctx.lightAt)) return false;', ''],
  ['if (!b || ns(b.id) !== this.block) return false;', 'if (!b) return false;'],
  ['this.props.indexOf(prop) < 0', 'false'],
  ['return JSON.parse(JSON.stringify(conds));', 'return conds;'],
  ['rtestSqrt(this.absolute, f(dx * dx + dy * dy + dz * dz))', 'rtest(this.absolute, f(dx * dx + dy * dy + dz * dz))'],
  ['rtestSqrt(this.horizontal,', 'rtest(this.horizontal,'],
  ['if (FLAGS[i][0] === \'is_baby\' && e.baby === undefined) continue;', ''],
  ['if (!!e[FLAGS[i][1]] !== want) return false;', ''],
  ['p.matches = function (type) { return this.type === ns(type); };', 'p.matches = function () { return true; };'],
  ['return !!(ctx && ctx.inTag && ctx.inTag(\'entity_type\'', 'return !(ctx && ctx.inTag && ctx.inTag(\'entity_type\''],
  ['var lvl = have[this.enchantment];\n      if (lvl === undefined) return false;', 'var lvl = have[this.enchantment]; if (lvl === undefined) return true;'],
  ['for (var k in have) if (rtest(this.levels, have[k])) return true;\n      return false;', 'return true;'],
  ['if (!e || !e.equipment) return false;', 'if (!e || !e.equipment) return true;'],
  ['I.item(has(items[s]) ? items[s] : null, ctx, e.equipment[s])', 'I.item(null, ctx, e.equipment[s])'],
  ['o.levels = this.levels; return o;', 'return o;'],
];
let caught = 0, bad = 0;
for (const c of cuts) { const r = scenario(c); if (r.length) caught++; else { bad++; console.log('NOT CAUGHT: ' + c[0]); } }
console.log(`predicate11747check: ${bad ? 'FAIL' : 'ok'} - ${caught} breaks caught of ${cuts.length}`);
process.exit(bad ? 1 : 0);
