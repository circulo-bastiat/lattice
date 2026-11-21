#!/usr/bin/env node
// advrest11565check.mjs - #11565: the last classes of 02l_advancements.js, driven through the real 1.18.2 advancements:
// AdvancementPositioner (every tab laid out: roots at depth 0, x = depth, siblings on distinct rows),
// AdvancementRewards (return_to_sender's 50 xp reaches the host exactly once), BrewedPotionCriterion (nether/brew_potion),
// LightningStrikeCriterion + LightningBoltPredicate (lightning_rod_with_villager_no_fire: bolt fire count + villager bystander),
// ItemUsedOnBlockCriterion (nether/use_lodestone: block + item), AdvancementToast (Adv.announce queues the toast),
// SpecialCraftingRecipe / MapExtendingRecipe (never enter the recipe book, so RECIPE_UNLOCKED stays silent).
// Anti-vacuity: each piece is cut in the source and must be caught.
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
  NS.Items = { nameOf: () => 'air', maxStack: () => 64, durability: {} };
  NS.Reg = { names: ['air', 'lodestone', 'stone'] }; NS.States = { block: [0, 1, 2] }; NS.World = { getBlock: () => 0 };
  NS.Recipes = { SPECIAL: 9, byId: { map_extending: { t: 9 }, stick: { t: 1 } } };
  new Function('MCL', src)(NS);
  NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
  return NS;
}
const pl = { x: 0, y: 64, z: 0 };
const ent = (type, o = {}) => ({ type: 'minecraft:' + type, x: 0, y: 64, z: 0, ...o });
const stk = (id) => ({ id: 'minecraft:' + id, count: 1, damage: 0, maxDamage: 0 });
let N = 0;
function verify(NS) {
  const A = NS.Adv, f = [], no = (c, m) => { N++; if (!c) f.push(m); };
  const M = (id) => A.manager.get('minecraft:' + id);
  const fresh = (host = {}) => new A.Tracker(host);
  const got = (t, adv, crit) => !!t.getProgress(M(adv)).criteria.get(crit)?.date;
  // AdvancementPositioner
  const r = M('story/root'), m1 = M('story/mine_stone'), m2 = M('story/upgrade_tools'), a1 = M('adventure/root');
  no(r.display.x === 0 && m1.display.x === 1 && m2.display.x === 2, 'positioner x = depth');
  const kids = [...A.manager.advancements.values()].filter((a) => a.parent && a.parent.id === 'minecraft:husbandry/root' && a.display);
  const rows = new Set(kids.map((a) => a.display.y));
  no(kids.length > 3 && rows.size === kids.length, 'positioner: siblings on distinct rows');
  no(a1.display.x === 0 && Number.isFinite(a1.display.y), 'positioner: second tab root laid out');
  // AdvancementRewards
  const rw = M('nether/return_to_sender');
  no(rw.rewards.experience === 50, 'rewards parsed 50 xp');
  const xp = []; const t0 = fresh({ addExperience: (n) => xp.push(n) });
  const crit = Object.keys(rw.criteria)[0], trig = rw.criteria[crit].trigger;
  t0.grantCriterion(rw, crit); t0.grantCriterion(rw, crit);
  no(xp.length === 1 && xp[0] === 50, 'rewards applied once: ' + xp);
  const hx = []; A.applyRewards(A.rewards({ xp: 3, loot: ['l'], recipes: ['r'] }), { addExperience: (n) => hx.push('x' + n), giveLoot: (l) => hx.push(l), unlockRecipes: (r2) => hx.push(r2[0]) });
  no(hx.join() === 'x3,l,r', 'rewards order xp,loot,recipes: ' + hx);
  // BrewedPotionCriterion
  let t = fresh();
  t.trigger('minecraft:brewed_potion', { player: pl, potion: 'minecraft:awkward' });
  no(got(t, 'nether/brew_potion', 'potion'), 'brewed potion grants');
  no(A.matchers['minecraft:brewed_potion']({ potion: 'minecraft:water' }, { player: pl, potion: 'awkward' }) === false &&
    A.matchers['minecraft:brewed_potion']({ potion: 'water' }, { player: pl, potion: 'minecraft:water' }) === true, 'brewed potion id compare');
  // LightningStrikeCriterion + LightningBoltPredicate
  const L = 'adventure/lightning_rod_with_villager_no_fire', lc = 'lightning_rod_with_villager_no_fire';
  const bolt = (n) => ({ ...ent('lightning_bolt', { blocksSetOnFire: n }), type: 'lightning_bolt' });
  t = fresh(); t.trigger('minecraft:lightning_strike', { player: pl, bolt: bolt(0), bystanders: [ent('villager')] });
  no(got(t, L, lc), 'lightning strike with villager, no fire grants');
  t = fresh(); t.trigger('minecraft:lightning_strike', { player: pl, bolt: bolt(2), bystanders: [ent('villager')] });
  no(!got(t, L, lc), 'lightning that set fires must not grant');
  t = fresh(); t.trigger('minecraft:lightning_strike', { player: pl, bolt: bolt(0), bystanders: [ent('cow')] });
  no(!got(t, L, lc), 'lightning with a cow bystander must not grant');
  // ItemUsedOnBlockCriterion
  t = fresh(); t.trigger('minecraft:item_used_on_block', { player: pl, x: 1, y: 2, z: 3, state: 2, stack: stk('compass') });
  no(!got(t, 'nether/use_lodestone', 'use_lodestone'), 'compass on stone must not grant');
  t.trigger('minecraft:item_used_on_block', { player: pl, x: 1, y: 2, z: 3, state: 1, stack: stk('stick') });
  no(!got(t, 'nether/use_lodestone', 'use_lodestone'), 'stick on lodestone must not grant');
  t.trigger('minecraft:item_used_on_block', { player: pl, x: 1, y: 2, z: 3, state: 1, stack: stk('compass') });
  no(got(t, 'nether/use_lodestone', 'use_lodestone'), 'compass on lodestone grants');
  // AdvancementToast
  A.toasts.length = 0; A.announce(M('adventure/kill_a_mob'), { name: 'Steve' });
  no(A.toasts.length === 1 && A.toasts[0].id === 'minecraft:adventure/kill_a_mob' && A.toasts[0].frame === 'task', 'toast queued');
  A.toasts.length = 0; A.announce({ id: 'x', display: null }, {}); no(A.toasts.length === 0, 'no display -> no toast');
  // SpecialCraftingRecipe / MapExtendingRecipe stay out of the book
  const pr = {}; const n = A.unlockRecipes(pr, ['minecraft:map_extending', 'minecraft:stick']);
  no(n === 1 && pr.recipeBook.has('minecraft:stick') && !pr.recipeBook.has('minecraft:map_extending'), 'special recipes never enter the book');
  return f;
}
const base = verify(engine(SRC)), ASSERTS = N;
if (base.length) { console.log('FAIL\n' + base.join('\n')); process.exit(1); }
const mut = (from, to) => { if (!SRC.includes(from)) { console.log('anchor gone: ' + from); process.exit(1); } return SRC.replace(from, to); };
let caught = 0, total = 0;
for (const [n, a, b] of [
  ['rewards xp dropped', 'if (rw.experience && host.addExperience) host.addExperience(rw.experience);', ''],
  ['brewed potion ignores id', 'return id === got;', 'return true;'],
  ['brewed potion never', "if (!has(c.potion)) return true;", 'return false;'],
  ['lightning bystander ignored', "if (!has(c.bystander)) return true;", 'return true;'],
  ['bolt fire count ignored', "!P.range(j.lightning_bolt.blocks_set_on_fire, e.blocksSetOnFire || 0)", 'false'],
  ['item_used_on_block ignores item', 'P.location(c.location, lc, ctx.x + 0.5, ctx.y + 0.5, ctx.z + 0.5) && P.item(c.item, lc, ctx.stack)', 'P.location(c.location, lc, ctx.x + 0.5, ctx.y + 0.5, ctx.z + 0.5)'],
  ['item_used_on_block ignores location', 'P.location(c.location, lc, ctx.x + 0.5, ctx.y + 0.5, ctx.z + 0.5) && P.item(c.item, lc, ctx.stack)', 'P.item(c.item, lc, ctx.stack)'],
  ['toast never', 'if (d.showToast) Adv.toasts.push', 'if (false) Adv.toasts.push'],
  ['special recipes enter book', 'if (rr && rr.t === NS.Recipes.SPECIAL) continue;', ''],
  ['positioner depth lost', 'this.depth = depth;\n    if (this.row < min)', 'this.depth = 0;\n    if (this.row < min)'],
  ['positioner rows collapsed', "this.row = this.previousSibling ? fr(this.previousSibling.row + 1) : 0;", 'this.row = 0;'],
]) {
  total++; let bad = false;
  try { bad = verify(engine(mut(a, b))).length > 0; } catch (e) { bad = true; }
  if (bad) caught++; else console.log('NOT CAUGHT: ' + n);
}
console.log(`advrest11565check: ${caught} breaks caught, ${ASSERTS} assertions, 0 failures`);
process.exit(caught === total ? 0 : 1);
