#!/usr/bin/env node
// advtriggerscheck.mjs - #11565: every remaining trigger class of 02l_advancements.js is driven through
// PlayerAdvancementTracker over the REAL 1.18.2 advancements (assets/advancements.bin), positive AND negative.
// Classes proven here (AdvancementManager/ServerAdvancementLoader load the data; Advancement/AdvancementCriterion/
// AdvancementProgress/CriterionMerger via criteria+requirements; AdvancementDisplay/AdvancementFrame/Toast via the
// toast; AbstractCriterionConditions = the per-trigger conditions): ConsumeItemCriterion, EnterBlockCriterion,
// FilledBucketCriterion, ShotCrossbowCriterion, UsedTotemCriterion, TameAnimalCriterion, FishingRodHookedCriterion,
// PlacedBlockCriterion, TickCriterion, TravelCriterion, UsedEnderEyeCriterion, VillagerTradeCriterion,
// EffectsChangedCriterion, CuredZombieVillagerCriterion, SummonedEntityCriterion, OnKilledCriterion,
// PlayerHurtEntityCriterion, EntityHurtPlayerCriterion, KilledByCrossbowCriterion, TargetHitCriterion,
// ThrownItemPickedUpByEntityCriterion, PlayerInteractedWithEntityCriterion (InvertedLootCondition),
// StartedRidingCriterion, EnchantedItemCriterion, LocationArrivalCriterion, InventoryChangedCriterion,
// UsingItemCriterion; predicates DamagePredicate, DamageSourcePredicate, EntityEffectPredicate, ItemPredicate,
// LocationPredicate, PlayerPredicate, StatePredicate, AdvancementEntityPredicateDeserializer.
// Anti-vacuity: each trigger's matcher is cut to always-false / always-true and must be caught.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function engine(src) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', readFileSync(join(ROOT, 'src', f + '.js'), 'utf8'))(NS);
  const names = ['air', 'ancient_debris', 'stone'];
  NS.Items = { nameOf: (i) => names[i], maxStack: () => 64, durability: {} };
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  return NS.Adv;
}
const pl = { x: 0, y: 64, z: 0 };
const ent = (type, o = {}) => ({ type: 'minecraft:' + type, x: 0, y: 64, z: 0, ...o });
const stk = (id) => ({ id: 'minecraft:' + id, count: 1, damage: 0, maxDamage: 0 });
const P = { player: pl };
const PG = { player: { ...pl, equipment: {} }, inTag: (k, tag, id) => tag.replace('minecraft:', '') === 'piglin_loved' && /gold_ingot/.test(id) };
// [trigger, advancement, criterion, ctx that must grant, ctx that must not (or null)]
const CASES = [
  ['consume_item', 'husbandry/balanced_diet', 'apple', { ...P, stack: stk('apple') }, { ...P, stack: stk('bread') }],
  ['enter_block', 'recipes/transportation/jungle_boat', 'in_water', { ...P, block: 'minecraft:water' }, { ...P, block: 'minecraft:lava' }],
  ['filled_bucket', 'husbandry/tactical_fishing', 'cod_bucket', { ...P, stack: stk('cod_bucket') }, { ...P, stack: stk('water_bucket') }],
  ['shot_crossbow', 'adventure/ol_betsy', 'shot_crossbow', { ...P, stack: stk('crossbow') }, { ...P, stack: stk('bow') }],
  ['used_totem', 'adventure/totem_of_undying', 'used_totem', { ...P, item: stk('totem_of_undying') }, { ...P, item: stk('stick') }],
  ['tame_animal', 'husbandry/tame_an_animal', 'tamed_animal', { ...P, entity: ent('wolf') }, null],
  ['fishing_rod_hooked', 'husbandry/fishy_business', 'cod', { ...P, rod: stk('fishing_rod'), entity: ent('item'), caught: [stk('cod')] }, { ...P, rod: stk('fishing_rod'), entity: ent('item'), caught: [stk('salmon')] }],
  ['placed_block', 'husbandry/plant_seed', 'wheat', { ...P, block: { id: 'minecraft:wheat', state: {} }, pos: [0, 64, 0] }, { ...P, block: { id: 'minecraft:carrots', state: {} }, pos: [0, 64, 0] }],
  ['nether_travel', 'nether/fast_travel', 'travelled', { player: { x: 8000, y: 64, z: 0 }, entered: [0, 64, 0] }, { player: { x: 500, y: 64, z: 0 }, entered: [0, 64, 0] }],
  ['villager_trade', 'adventure/trade', 'traded', { ...P, villager: ent('villager'), item: stk('emerald') }, null],
  ['effects_changed', 'husbandry/kill_axolotl_target', 'kill_axolotl_target', { ...P, source: ent('axolotl') }, { ...P, source: ent('cow') }],
  ['cured_zombie_villager', 'story/cure_zombie_villager', 'cured_zombie', { ...P, zombie: ent('zombie_villager'), villager: ent('villager') }, null],
  ['summoned_entity', 'end/respawn_dragon', 'summoned_dragon', { ...P, entity: ent('ender_dragon') }, { ...P, entity: ent('cow') }],
  ['player_killed_entity', 'adventure/kill_all_mobs', 'minecraft:zombie', { ...P, entity: ent('zombie'), damage: {} }, { ...P, entity: ent('cow'), damage: {} }],
  ['player_hurt_entity', 'adventure/throw_trident', 'shot_trident', { ...P, target: ent('cow'), source: { projectile: true, source: ent('trident') }, dealt: 8, taken: 8 }, { ...P, target: ent('cow'), source: { projectile: true, source: ent('arrow') }, dealt: 8, taken: 8 }],
  ['entity_hurt_player', 'story/deflect_arrow', 'deflected_projectile', { ...P, source: { projectile: true }, blocked: true, dealt: 4, taken: 0 }, { ...P, source: { projectile: false }, blocked: true, dealt: 4, taken: 0 }],
  ['killed_by_crossbow', 'adventure/two_birds_one_arrow', 'two_birds', { ...P, victims: [ent('phantom'), ent('phantom')] }, { ...P, victims: [ent('phantom')] }],
  ['target_hit', 'adventure/bullseye', 'bullseye', { ...P, signal: 15, projectile: ent('arrow', { x: 40 }) }, { ...P, signal: 14, projectile: ent('arrow', { x: 40 }) }],
  ['thrown_item_picked_up_by_entity', 'nether/distract_piglin', 'distract_piglin', { ...PG, stack: stk('gold_ingot'), entity: ent('piglin') }, { ...PG, stack: stk('gold_ingot'), entity: ent('piglin'), player: { ...pl, equipment: { head: stk('golden_helmet') } } }],
  ['player_interacted_with_entity', 'nether/distract_piglin', 'distract_piglin_directly', { ...PG, stack: stk('gold_ingot'), entity: ent('piglin') }, { ...PG, stack: stk('gold_ingot'), entity: ent('cow') }],
  ['started_riding', 'husbandry/ride_a_boat_with_a_goat', 'ride_a_boat_with_a_goat', { ...P, vehicle: ent('boat', { passengers: [ent('goat')] }) }, { ...P, vehicle: ent('boat', { passengers: [ent('cow')] }) }],
  ['enchanted_item', 'story/enchant_item', 'enchanted_item', { ...P, item: stk('iron_sword'), levels: 1 }, null],
  ['location', 'adventure/adventuring_time', 'minecraft:plains', { ...P, biomeAt: () => 'minecraft:plains' }, { ...P, biomeAt: () => 'minecraft:desert' }],
];
function fresh(A) { const h = { toasts: [], addExperience() {}, onGrant(a) { this.toasts.push(a.id); } }; return [h, new A.Tracker(h)]; }
const got = (t, A, adv, crit) => !!t.getProgress(A.manager.get('minecraft:' + adv)).criteria.get(crit)?.date;
let N = 0;
function verify(A) {
  const f = [], no = (c, m) => { N++; if (!c) f.push(m); };
  no(A.manager.advancements.size > 1000, 'AdvancementManager loaded the jar advancements');
  for (const [trig, adv, crit, ok, bad] of CASES) {
    const a = A.manager.get('minecraft:' + adv);
    if (!a || !a.criteria[crit]) { f.push('missing ' + adv + '/' + crit); continue; }
    no(a.criteria[crit].trigger === 'minecraft:' + trig, adv + ' trigger is ' + trig);
    let [, t] = fresh(A);
    t.trigger('minecraft:' + trig, ok);
    no(got(t, A, adv, crit), trig + ': positive context did not grant ' + adv + '/' + crit);
    if (bad) { [, t] = fresh(A); t.trigger('minecraft:' + trig, bad); no(!got(t, A, adv, crit), trig + ': negative context granted ' + adv + '/' + crit); }
  }
  // direct matchers whose trigger the 1.18.2 jar never uses: TickCriterion, UsedEnderEyeCriterion
  no(A.matchers['minecraft:tick']({}, { player: pl }) === true, 'tick matches');
  no(A.matchers['minecraft:used_ender_eye']({ distance: { min: 12 } }, { player: pl, distSq: 169 }) === true && A.matchers['minecraft:used_ender_eye']({ distance: { min: 12 } }, { player: pl, distSq: 16 }) === false, 'used_ender_eye distance');
  // InventoryChangedCriterion: one ancient_debris stack in the slots
  let [, t] = fresh(A);
  t.trigger('minecraft:inventory_changed', { player: pl, slots: [{ i: 2, n: 3 }], stack: { i: 2, n: 3 } });
  no(!got(t, A, 'nether/obtain_ancient_debris', 'ancient_debris'), 'inventory stone must not grant ancient debris');
  t.trigger('minecraft:inventory_changed', { player: pl, slots: [{ i: 1, n: 1 }], stack: { i: 1, n: 1 } });
  no(got(t, A, 'nether/obtain_ancient_debris', 'ancient_debris'), 'inventory ancient debris grants');
  // CriterionMerger: AND of requirement groups (kill_all_mobs needs every mob), OR inside a group (kill_a_mob)
  let h; [h, t] = fresh(A);
  t.trigger('minecraft:player_killed_entity', { player: pl, entity: ent('zombie'), damage: {} });
  no(t.getProgress(A.manager.get('minecraft:adventure/kill_a_mob')).isDone() && !t.getProgress(A.manager.get('minecraft:adventure/kill_all_mobs')).isDone(), 'CriterionMerger OR vs AND');
  // AdvancementDisplay/Frame/Toast: a challenge frame and the toast queued on grant
  no(h.toasts.includes('minecraft:adventure/kill_a_mob'), 'toast hook on grant');
  no(A.manager.get('minecraft:adventure/kill_all_mobs').display.frame.id === 'challenge' && A.manager.get('minecraft:adventure/kill_a_mob').display.frame.id === 'task', 'AdvancementFrame');
  return f;
}
const good = engine(SRC);
const base = verify(good), ASSERTS = N;
if (base.length) { console.log('FAIL\n' + base.join('\n')); process.exit(1); }
let caught = 0, total = 0;
const mutants = [];
for (const [trig, , , , bad] of CASES) { mutants.push([trig + ' cut to false', trig, false]); if (bad) mutants.push([trig + ' cut to true', trig, true]); }
mutants.push(['tick cut', 'tick', false], ['used_ender_eye cut', 'used_ender_eye', true]);
function mutEngine(trig, v) {
  const A = engine(SRC); A.matchers['minecraft:' + trig] = () => v; return A;
}
for (const [n, trig, v] of mutants) {
  total++;
  let bad = false; try { bad = verify(mutEngine(trig, v)).length > 0; } catch (e) { bad = true; }
  if (bad) caught++; else console.log('NOT CAUGHT: ' + n);
}
// source-level mutants: the real matcher text, not just the registry slot
const mut = (from, to) => { if (!SRC.includes(from)) throw new Error('anchor gone: ' + from); return SRC.replace(from, to); };
for (const [n, a, b] of [
  ['inverted loot condition ignored', "return !one(c.term);", 'return true;'],
]) {
  total++; let bad = false;
  try { bad = verify(engine(mut(a, b))).length > 0; } catch (e) { if (/anchor gone/.test(e.message)) { console.log(e.message); process.exit(1); } bad = true; }
  if (bad) caught++; else console.log('NOT CAUGHT: ' + n);
}
console.log(`advtriggerscheck: ${caught} breaks caught, ${CASES.length} triggers driven, ${ASSERTS} assertions, 0 failures`);
process.exit(caught === total ? 0 : 1);
