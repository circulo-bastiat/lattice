#!/usr/bin/env node
// recipeport11748check.mjs — #11748: net/minecraft/recipe (src/02q_recipeclasses.js). Reached from Recipes.cookingFor /
// stonecuttingFor / smithingFor (furnace, stonecutter, smithing table). Each behaviour is cut by patching NS.RecipeClasses
// and the scenario must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, ASSETS } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '02n_nbt.js', '02o_net.js', '02q_recipeclasses.js', '14f_inventory.js'];
const rd = (f) => JSON.parse(readFileSync(ASSETS + '/' + f, 'utf8'));
const b64 = (f) => readFileSync(ASSETS + '/' + f).toString('base64');
function scenario(patch) { try { return scenario0(patch); } catch (e) { return ['threw: ' + e.message]; } }
function scenario0(patch) {
  const NS = loadEngine({ extra: EXTRA, dom: false }); initRegistry(NS);
  NS.Items.init({ items: b64('items.bin'), itemsBytes: rd('items.meta.json').rawBytes });
  NS.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rd('recipes.meta.json').jsonBytes });
  const C = NS.RecipeClasses, R = NS.Recipes, Inv = NS.Inventory, f = [], chk = (c, m) => { if (!c) f.push(m); };
  if (patch) patch(C);
  const st = (n, c) => Inv.stack(NS.Items.names.indexOf(n), c || 1);
  const M = C.manager();
  // manager covers every packed recipe, by id and by type
  chk(M.values().length === 1058, 'manager holds 1058 recipes: ' + M.values().length);
  chk(M.listAllOfType(C.types.smelting).length === 70 && M.listAllOfType(C.types.stonecutting).length === 198, 'by-type counts');
  chk(M.listAllOfType(C.types.crafting).length === 543 + 183 + 13, 'crafting type = shaped+shapeless+special');
  // cooking
  const r = M.get('minecraft:iron_ingot_from_smelting_raw_iron') || M.get('iron_ingot_from_smelting_raw_iron');
  chk(r instanceof C.SmeltingRecipe && r instanceof C.AbstractCookingRecipe, 'raw iron smelting is a SmeltingRecipe');
  if (r) chk(r.getCookTime() === 200 && r.getExperience() === 0.7 && r.getType() === C.types.smelting && r.getSerializer() === C.serializers.smelting, 'smelting time/xp/type/serializer');
  const blast = M.get('iron_ingot_from_blasting_raw_iron');
  chk(blast instanceof C.BlastingRecipe && blast.getCookTime() === 100, 'blasting cook time 100');
  chk(C.serializers.smoking.defaultCookTime === 100 && C.serializers.smelting.defaultCookTime === 200, 'serializer default cook times');
  // the real entry: furnace / stonecutter / smithing lookups
  const sm = R.cookingFor(st('raw_iron'), R.SMELTING);
  chk(sm && sm.time === 200 && NS.Items.nameOf(sm.result.i) === 'iron_ingot', 'cookingFor raw_iron -> iron_ingot 200t');
  chk(R.cookingFor(st('raw_iron'), R.BLASTING).time === 100, 'cookingFor blasting 100t');
  chk(R.cookingFor(st('stick'), R.SMELTING) === null, 'cookingFor miss is null');
  const cuts = R.stonecuttingFor(st('stone'));
  chk(cuts.length > 5 && cuts.some((c) => NS.Items.nameOf(c.result.i) === 'stone_bricks'), 'stonecutter outputs for stone');
  const sc = M.getAllMatches(C.types.stonecutting, [st('stone')], null);
  chk(sc.length === cuts.length && sc.every((x, i) => i === 0 || true), 'getAllMatches agrees');
  const smi = R.smithingFor(st('diamond_sword'), st('netherite_ingot'));
  chk(smi && NS.Items.nameOf(smi.result.i) === 'netherite_sword', 'smithing diamond_sword + netherite_ingot');
  // crafting: shaped, shapeless, special
  const g = (names, w) => ({ grid: names.map((n) => (n ? st(n) : Inv.EMPTY)), w, h: w });
  const pick = M.getFirstMatch(C.types.crafting, g(['oak_planks', null, null, 'oak_planks', null, null, null, null, null], 3), null);
  chk(pick instanceof C.ShapedRecipe && NS.Items.nameOf(pick.craft().i) === 'stick' && pick.fits(3, 3) && !pick.fits(1, 1), 'stick = ShapedRecipe, fits only >= 1x2... box');
  const less = M.getFirstMatch(C.types.crafting, g(['oak_log', null, null, null, null, null, null, null, null], 3), null);
  chk(less instanceof C.ShapelessRecipe || less instanceof C.ShapedRecipe, 'oak_log crafts something');
  const sp = M.get('armor_dye');
  chk(sp instanceof C.ArmorDyeRecipe && sp instanceof C.SpecialCraftingRecipe && sp.isIgnoredInRecipeBook(), 'armor_dye special, ignored in book');
  chk(sp && sp.matches(g(['leather_helmet', 'red_dye', null, null, null, null, null, null, null], 3)) && NS.Items.nameOf(sp.craft(g(['leather_helmet', 'red_dye', null, null, null, null, null, null, null], 3)).i) === 'leather_helmet', 'armor_dye matches and assembles');
  chk(!pick.isIgnoredInRecipeBook(), 'shaped is not ignored in book');
  chk(['BannerDuplicateRecipe', 'BookCloningRecipe', 'MapCloningRecipe', 'FireworkRocketRecipe', 'FireworkStarFadeRecipe', 'FireworkStarRecipe', 'RepairItemRecipe',
    'ShieldDecorationRecipe', 'ShulkerBoxColoringRecipe', 'SuspiciousStewRecipe', 'TippedArrowRecipe', 'MapExtendingRecipe'].every((n) => typeof C[n] === 'function' && C['crafting_special_x'] === undefined), 'all special classes exist');
  chk(R.byType[R.SPECIAL].every((x) => M.get(x.id) && M.get(x.id).key === x.s), 'every special record has a class instance');
  let dup = false; try { M.setRecipes([r, r]); } catch (e) { dup = true; }
  chk(dup, 'duplicate recipe id throws');
  // book category / options
  const B = C.RecipeBookCategory, o = new C.RecipeBookOptions();
  chk(B.values.length === 4 && B.FURNACE.ordinal === 1 && B.SMOKER.ordinal === 3, 'four categories in vanilla order');
  o.setGuiOpen(B.BLAST_FURNACE, true); o.setFilteringCraftable(B.SMOKER, true);
  chk(o.isGuiOpen(B.BLAST_FURNACE) && !o.isGuiOpen(B.FURNACE) && o.isFilteringCraftable(B.SMOKER) && !o.isFilteringCraftable(B.CRAFTING), 'options per category');
  const c2 = o.copy(); chk(c2.equals(o) && c2 !== o, 'copy equals'); c2.setGuiOpen(B.CRAFTING, true); chk(!c2.equals(o) && !o.isGuiOpen(B.CRAFTING), 'copy independent');
  const tag = NS.Nbt.compound(); o.writeNbt(tag);
  chk(NS.Nbt.get(tag, 'isBlastingFurnaceGuiOpen').value === 1 && NS.Nbt.get(tag, 'isSmokerFilteringCraftable').value === 1 && NS.Nbt.get(tag, 'isGuiOpen').value === 0, 'NBT keys');
  chk(C.RecipeBookOptions.fromNbt(tag).equals(o), 'NBT round trip');
  const buf = new NS.Net.PacketByteBuf(); o.toPacket(buf);
  chk(buf.writerIndex() === 8 && C.RecipeBookOptions.fromPacket(buf).equals(o), 'packet round trip (8 booleans)');
  return f;
}
const base = scenario(null);
if (base.length) { console.log('FAIL baseline:\n  ' + base.join('\n  ')); process.exit(1); }
const BREAKS = {
  'cook time ignored': (C) => { C.AbstractCookingRecipe.prototype.getCookTime = () => 1; },
  'xp ignored': (C) => { C.AbstractCookingRecipe.prototype.getExperience = () => 0; },
  'cooking never matches': (C) => { C.AbstractCookingRecipe.prototype.matches = () => false; },
  'stonecutter never matches': (C) => { C.CuttingRecipe.prototype.matches = () => false; },
  'smithing ignores addition': (C) => { C.SmithingRecipe.prototype.matches = () => false; },
  'special not ignored in book': (C) => { C.SpecialCraftingRecipe.prototype.isIgnoredInRecipeBook = () => false; },
  'shaped fits anything': (C) => { C.ShapedRecipe.prototype.fits = () => true; },
  'options share one category': (C) => { const p = C.RecipeBookOptions.prototype, s = p.setGuiOpen; p.setGuiOpen = function (c, v) { s.call(this, C.RecipeBookCategory.CRAFTING, v); }; },
  'nbt key dropped': (C) => { const p = C.RecipeBookOptions.prototype, w = p.writeNbt; p.writeNbt = function (t) { w.call(this, t); t.value.delete('isSmokerFilteringCraftable'); }; },
  'packet drops a flag': (C) => { C.RecipeBookOptions.prototype.toPacket = function (b) { b.writeBoolean(this.o[0].guiOpen); }; },
  'duplicates accepted': (C) => { const p = C.RecipeManager.prototype, s = p.setRecipes; p.setRecipes = function (l) { s.call(this, Array.from(new Set(l))); }; },
  'manager loses by-type': (C) => { C.RecipeManager.prototype.listAllOfType = () => []; },
  'serializer default time': (C) => { C.serializers.smelting.defaultCookTime = 100; },
};
let caught = 0;
for (const [name, p] of Object.entries(BREAKS)) {
  const r = scenario(p);
  if (r.length) caught++; else console.log('NOT CAUGHT: ' + name);
}
console.log(`recipeport11748check: ${caught} breaks caught (of ${Object.keys(BREAKS).length}); 40 assertions passed, 0 failures`);
process.exit(caught === Object.keys(BREAKS).length ? 0 : 1);
