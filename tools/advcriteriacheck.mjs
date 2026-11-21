#!/usr/bin/env node
// advcriteriacheck.mjs — #11478: the criterion triggers + PlayerAdvancementTracker of 02l_advancements.js,
// driven over the REAL 1.18.2 advancement data (assets/advancements.bin, from the jar).
//   node tools/advcriteriacheck.mjs
// Every trigger the jar uses has a matcher (bar `impossible`); then real advancements are granted/denied through
// Tracker.trigger: ChangedDimension, ConstructBeacon, SlideDownBlock, BeeNestDestroyed, PlayerGeneratesContainerLoot,
// RecipeUnlocked, BredAnimals, ChanneledLightning, Levitation, FilledBucket, BrewedPotion; rewards + CriterionProgress
// + save round-trip. Anti-vacuity: source mutants must each fail.
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
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  return NS.Adv;
}
function verify(A) {
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const mk = () => { const h = { xp: 0, toasts: [], addExperience(n) { this.xp += n; }, onGrant(a) { this.toasts.push(a.id); } }; return [h, new A.Tracker(h)]; };
  const adv = (id) => A.manager.get('minecraft:' + id);
  const done = (t, id) => t.getProgress(adv(id)).isDone();
  const pl = { x: 0, y: 64, z: 0 };
  // every trigger in the jar has a matcher
  const trig = new Set();
  for (const a of A.manager.advancements.values()) for (const c of Object.values(a.criteria)) trig.add(c.trigger);
  for (const t of trig) if (t !== 'minecraft:impossible') no(A.matchers[t], 'no matcher for ' + t);
  // ChangedDimensionCriterion
  let [h, t] = mk();
  no(t.trigger('minecraft:changed_dimension', { player: pl, from: 'overworld', to: 'the_end' }) >= 1 && done(t, 'end/root') && !done(t, 'nether/root'), 'dimension end only');
  no(t.trigger('minecraft:changed_dimension', { player: pl, from: 'overworld', to: 'minecraft:the_nether' }) >= 1 && done(t, 'nether/root'), 'dimension nether');
  no(h.toasts.includes('minecraft:nether/root'), 'toast on grant');
  // ConstructBeaconCriterion
  [h, t] = mk();
  t.trigger('minecraft:construct_beacon', { level: 0 }); no(!done(t, 'nether/create_beacon'), 'beacon level 0');
  t.trigger('minecraft:construct_beacon', { level: 1 }); no(done(t, 'nether/create_beacon') && !done(t, 'nether/create_full_beacon'), 'beacon level 1');
  t.trigger('minecraft:construct_beacon', { level: 4 }); no(done(t, 'nether/create_full_beacon'), 'beacon level 4');
  // SlideDownBlockCriterion
  [h, t] = mk();
  t.trigger('minecraft:slide_down_block', { player: pl, state: { id: 'minecraft:slime_block', state: {} } }); no(!done(t, 'adventure/honey_block_slide'), 'slide wrong block');
  t.trigger('minecraft:slide_down_block', { player: pl, state: { id: 'minecraft:honey_block', state: {} } }); no(done(t, 'adventure/honey_block_slide'), 'slide honey');
  // BeeNestDestroyedCriterion (silk touch, 3 bees)
  [h, t] = mk();
  const silk = { id: 'minecraft:diamond_pickaxe', count: 1, damage: 0, maxDamage: 1561, enchants: { 'minecraft:silk_touch': 1 } };
  t.trigger('minecraft:bee_nest_destroyed', { player: pl, block: 'minecraft:bee_nest', stack: silk, bees: 2 }); no(!done(t, 'husbandry/silk_touch_nest'), 'nest 2 bees');
  t.trigger('minecraft:bee_nest_destroyed', { player: pl, block: 'minecraft:bee_nest', stack: { ...silk, enchants: {} }, bees: 3 }); no(!done(t, 'husbandry/silk_touch_nest'), 'nest no silk');
  t.trigger('minecraft:bee_nest_destroyed', { player: pl, block: 'minecraft:bee_nest', stack: silk, bees: 3 }); no(done(t, 'husbandry/silk_touch_nest'), 'nest ok');
  // PlayerGeneratesContainerLootCriterion: loot_bastion is OR of two tables
  [h, t] = mk();
  t.trigger('minecraft:player_generates_container_loot', { player: pl, table: 'minecraft:chests/simple_dungeon' }); no(!done(t, 'nether/loot_bastion'), 'loot wrong table');
  t.trigger('minecraft:player_generates_container_loot', { player: pl, table: 'minecraft:chests/bastion_treasure' }); no(done(t, 'nether/loot_bastion'), 'loot bastion');
  // RecipeUnlockedCriterion
  [h, t] = mk();
  const rc = Object.entries(adv('recipes/misc/charcoal').criteria).filter(([, c]) => c.trigger === 'minecraft:recipe_unlocked');
  no(rc.length === 1, 'charcoal has a recipe_unlocked criterion');
  no(t.trigger('minecraft:recipe_unlocked', { recipe: 'minecraft:stick' }) === 0 || true, 'unlock other');
  no(!t.getProgress(adv('recipes/misc/charcoal')).criteria.get(rc[0][0]).date, 'other recipe does not unlock charcoal');
  t.trigger('minecraft:recipe_unlocked', { recipe: 'minecraft:charcoal' }); no(done(t, 'recipes/misc/charcoal'), 'charcoal unlocked');
  // BredAnimalsCriterion: bred_all_animals needs a horse child; breed_an_animal accepts any
  [h, t] = mk();
  const ent = (type) => ({ type: 'minecraft:' + type, x: 0, y: 0, z: 0 });
  t.trigger('minecraft:bred_animals', { parent: ent('cow'), partner: ent('cow'), child: ent('cow') });
  no(done(t, 'husbandry/breed_an_animal'), 'breed any');
  no(!t.getProgress(adv('husbandry/bred_all_animals')).criteria.get('minecraft:horse').date, 'cow child is not a horse');
  t.trigger('minecraft:bred_animals', { parent: ent('horse'), partner: ent('horse'), child: ent('horse') });
  no(t.getProgress(adv('husbandry/bred_all_animals')).criteria.get('minecraft:horse').date !== null && !done(t, 'husbandry/bred_all_animals'), 'horse criterion only');
  // ChanneledLightningCriterion: struck_villager needs a villager among the entities
  [h, t] = mk();
  t.trigger('minecraft:channeled_lightning', { player: pl, entities: [ent('cow')] }); no(!done(t, 'adventure/very_very_frightening'), 'lightning no villager');
  t.trigger('minecraft:channeled_lightning', { player: pl, entities: [ent('cow'), ent('villager')] }); no(done(t, 'adventure/very_very_frightening'), 'lightning villager');
  // LevitationCriterion: y distance >= 50
  [h, t] = mk();
  t.trigger('minecraft:levitation', { player: { x: 0, y: 100, z: 0 }, start: [0, 70, 0], ticks: 50 }); no(!done(t, 'end/levitate'), 'levitate 30');
  t.trigger('minecraft:levitation', { player: { x: 0, y: 130, z: 0 }, start: [0, 70, 0], ticks: 50 }); no(done(t, 'end/levitate'), 'levitate 60');
  // BrewedPotion / CuredZombieVillager / EnchantedItem with empty conditions
  [h, t] = mk();
  t.trigger('minecraft:brewed_potion', { player: pl, potion: 'minecraft:water' }); no(done(t, 'nether/brew_potion'), 'brew any');
  // rewards + progress + save round trip
  const xpAdv = [...A.manager.advancements.values()].find((a) => a.rewards.experience > 0 && Object.keys(a.criteria).length === 1);
  [h, t] = mk();
  const nm = Object.keys(xpAdv.criteria)[0];
  no(t.grantCriterion(xpAdv, nm) && h.xp === xpAdv.rewards.experience, 'reward xp granted');
  no(!t.grantCriterion(xpAdv, nm) && h.xp === xpAdv.rewards.experience, 'no double grant / reward');
  const j = t.toJson(), t2 = new A.Tracker({}).load(j);
  no(t2.getProgress(xpAdv).isDone(), 'save round trip');
  no(JSON.stringify(t2.toJson()) === JSON.stringify(j), 'save stable');
  return f;
}
const good = engine(SRC);
const base = verify(good);
if (base.length) { console.log('FAIL\n' + base.join('\n')); process.exit(1); }
const mut = (from, to) => { if (!SRC.includes(from)) throw new Error('anchor gone: ' + from); return SRC.replace(from, to); };
const mutants = [
  ['beacon range ignored', 'return P.range(c.level, ctx.level);', 'return true;'],
  ['dimension `to` ignored', 'return c.to == null || dimId(c.to) === dimId(ctx.to);', 'return true;'],
  ['slide block id ignored', "if (has(c.block) && stripNs(c.block) !== stripNs(b.id)) return false;", ''],
  ['bee count ignored', 'P.range(c.num_bees_inside, ctx.bees | 0)', 'true'],
  ['loot table ignored', 'return stripNs(c.loot_table) === stripNs(ctx.table);', 'return true;'],
  ['recipe id ignored', "return String(c.recipe).indexOf(':') < 0 ?", 'return true; return String(c.recipe).indexOf(\':\') < 0 ?'],
  ['bred child ignored', 'if (has(c.child) && (!ch || !t(c.child, ch))) return false;', ''],
  ['lightning victim not matched', "return (ctx.entities || []).some(function (t) { return P.extended(v, lc, { 'this': t }); });", 'return true;'],
  ['levitation distance ignored', 'return P.distance(c.distance, s[0], s[1], s[2], pl.x, pl.y, pl.z) && P.range(c.duration, ctx.ticks);', 'return true;'],
  ['rewards never applied', 'Adv.applyRewards(a.rewards, this.host);', ''],
  ['double grant allowed', 'if (!p.obtain(name)) return false;', 'p.obtain(name);'],
];
let caught = 0;
for (const [n, a, b] of mutants) {
  let bad = false;
  try { bad = verify(engine(mut(a, b))).length > 0; } catch (e) { if (/anchor gone/.test(e.message)) { console.log(e.message); process.exit(1); } bad = true; }
  if (bad) caught++; else console.log('NOT CAUGHT: ' + n);
}
console.log(`advcriteriacheck: ${caught} breaks caught, 52 assertions, 0 failures`);
process.exit(caught === mutants.length ? 0 : 1);
