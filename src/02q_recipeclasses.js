// 02q is net/minecraft/recipe (#11748), the CLASS layer over the packed recipe data of 02h_recipes.js. Main only.
// Cited classes (Yarn): CraftingRecipe AbstractCookingRecipe CuttingRecipe SmeltingRecipe BlastingRecipe SmokingRecipe
//  CampfireCookingRecipe StonecuttingRecipe SmithingRecipe ShapedRecipe ShapelessRecipe ArmorDyeRecipe BannerDuplicateRecipe
//  BookCloningRecipe MapCloningRecipe FireworkRocketRecipe FireworkStarRecipe FireworkStarFadeRecipe RepairItemRecipe
//  ShieldDecorationRecipe ShulkerBoxColoringRecipe SuspiciousStewRecipe TippedArrowRecipe (the thirteen specials delegate to
//  Recipes.specials), RecipeSerializer CookingRecipeSerializer SpecialRecipeSerializer RecipeManager RecipeInputProvider,
//  book/RecipeBookCategory book/RecipeBookOptions.
// The data is not JSON here: a serializer's read() takes the packed record (`R.all[i]`), the form this engine stores.
// Reached from Recipes.cookingFor / stonecuttingFor / smithingFor (furnaces, stonecutter, smithing table).
(function (NS) {
  'use strict';
  var C = NS.RecipeClasses = {};
  var R = function () { return NS.Recipes; };
  var I = function () { return NS.Inventory; };

  // ── book/RecipeBookCategory + RecipeBookOptions ───────────────────────────────────────────
  var CATS = ['CRAFTING', 'FURNACE', 'BLAST_FURNACE', 'SMOKER'];
  var RecipeBookCategory = C.RecipeBookCategory = {};
  C.RecipeBookCategory.values = [];
  CATS.forEach(function (n, i) { var c = { name: n, ordinal: i }; RecipeBookCategory[n] = c; RecipeBookCategory.values.push(c); });
  var OPT_NAMES = [['isGuiOpen', 'isFilteringCraftable'], ['isFurnaceGuiOpen', 'isFurnaceFilteringCraftable'],
    ['isBlastingFurnaceGuiOpen', 'isBlastingFurnaceFilteringCraftable'], ['isSmokerGuiOpen', 'isSmokerFilteringCraftable']];

  function RecipeBookOptions() { this.o = RecipeBookCategory.values.map(function () { return { guiOpen: false, filteringCraftable: false }; }); }
  var OP = RecipeBookOptions.prototype;
  OP.isGuiOpen = function (c) { return this.o[c.ordinal].guiOpen; };
  OP.setGuiOpen = function (c, v) { this.o[c.ordinal].guiOpen = !!v; };
  OP.isFilteringCraftable = function (c) { return this.o[c.ordinal].filteringCraftable; };
  OP.setFilteringCraftable = function (c, v) { this.o[c.ordinal].filteringCraftable = !!v; };
  OP.copy = function () { var r = new RecipeBookOptions(); r.copyFrom(this); return r; };
  OP.copyFrom = function (s) { this.o = s.o.map(function (x) { return { guiOpen: x.guiOpen, filteringCraftable: x.filteringCraftable }; }); };
  OP.equals = function (s) { return s === this || (s instanceof RecipeBookOptions && this.o.every(function (x, i) { return x.guiOpen === s.o[i].guiOpen && x.filteringCraftable === s.o[i].filteringCraftable; })); };
  OP.toPacket = function (buf) { this.o.forEach(function (x) { buf.writeBoolean(x.guiOpen); buf.writeBoolean(x.filteringCraftable); }); };
  RecipeBookOptions.fromPacket = function (buf) {
    var r = new RecipeBookOptions();
    r.o.forEach(function (x) { x.guiOpen = buf.readBoolean(); x.filteringCraftable = buf.readBoolean(); });
    return r;
  };
  OP.writeNbt = function (tag) {
    var N = NS.Nbt; this.o.forEach(function (x, i) { N.put(tag, OPT_NAMES[i][0], x.guiOpen ? N.ONE : N.ZERO); N.put(tag, OPT_NAMES[i][1], x.filteringCraftable ? N.ONE : N.ZERO); });
  };
  RecipeBookOptions.fromNbt = function (tag) {
    var N = NS.Nbt, r = new RecipeBookOptions();
    var b = function (k) { var t = N.get(tag, k); return !!t && N.isNumber(t) && N.byteValue(t) !== 0; };
    r.o.forEach(function (x, i) { x.guiOpen = b(OPT_NAMES[i][0]); x.filteringCraftable = b(OPT_NAMES[i][1]); });
    return r;
  };
  C.RecipeBookOptions = RecipeBookOptions;

  // ── RecipeType ────────────────────────────────────────────────────────────────────────────
  function RecipeType(id) { this.id = id; }
  RecipeType.prototype.toString = function () { return this.id; };
  RecipeType.prototype.match = function (recipe, inv, world) { return recipe.matches(inv, world) ? recipe : null; };
  C.RecipeType = RecipeType;
  var TY = C.types = {};
  ['crafting', 'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting', 'smithing'].forEach(function (n) { TY[n] = new RecipeType(n); });

  // ── Ingredient view + inventories ─────────────────────────────────────────────────────────
  function Ingredient(idx) { this.idx = idx; }
  Ingredient.prototype.test = function (stack) { return R().ingredientMatches(this.idx, stack); };
  // an inventory is an array of stacks, or {grid, w, h} for crafting
  function stackAt(inv, i) { return Array.isArray(inv) ? inv[i] : inv.grid[i]; }

  // ── Recipe base (Recipe<C> defaults) ──────────────────────────────────────────────────────
  function Recipe(rec, type, serializer) { this.rec = rec; this.type = type; this.serializer = serializer; }
  var RP = Recipe.prototype;
  RP.getId = function () { var i = this.rec.id; return i.indexOf(':') < 0 ? 'minecraft:' + i : i; };
  RP.getGroup = function () { return this.rec.g || ''; };
  RP.getType = function () { return this.type; };
  RP.getSerializer = function () { return this.serializer; };
  RP.getOutput = function () { var r = this.rec.r; return r ? I().stack(r.i, r.n) : I().EMPTY; };
  RP.craft = function () { return this.getOutput(); };
  RP.getIngredients = function () { return (this.rec.in || []).map(function (x) { return new Ingredient(x); }); };
  RP.fits = function () { return true; };
  RP.isIgnoredInRecipeBook = function () { return false; };
  RP.provideRecipeInputs = function (matcher) { this.getIngredients().forEach(function (g) { matcher.addInput ? matcher.addInput(g) : matcher.push(g); }); };
  C.Recipe = Recipe;
  C.RecipeInputProvider = { provideRecipeInputs: function (p, m) { return p.provideRecipeInputs(m); } };

  // CraftingRecipe: type crafting
  function CraftingRecipe(rec, ser) { Recipe.call(this, rec, TY.crafting, ser); }
  CraftingRecipe.prototype = Object.create(RP);
  C.CraftingRecipe = CraftingRecipe;

  function ShapedRecipe(rec, ser) { CraftingRecipe.call(this, rec, ser); }
  ShapedRecipe.prototype = Object.create(CraftingRecipe.prototype);
  ShapedRecipe.prototype.matches = function (inv) { return R().shapedMatches(this.rec, inv.grid, inv.w, inv.h); };
  ShapedRecipe.prototype.fits = function (w, h) { return w >= this.rec.w && h >= this.rec.h; };
  ShapedRecipe.prototype.getIngredients = function () { return this.rec.k.map(function (x) { return new Ingredient(x); }); };
  C.ShapedRecipe = ShapedRecipe;

  function ShapelessRecipe(rec, ser) { CraftingRecipe.call(this, rec, ser); }
  ShapelessRecipe.prototype = Object.create(CraftingRecipe.prototype);
  ShapelessRecipe.prototype.matches = function (inv) { return R().shapelessMatches(this.rec, inv.grid, inv.w, inv.h); };
  ShapelessRecipe.prototype.fits = function (w, h) { return w * h >= this.rec.in.length; };
  C.ShapelessRecipe = ShapelessRecipe;

  // SpecialCraftingRecipe subclasses: one class per special, each delegating to Recipes.specials[key]
  var SPECIALS = [['ArmorDyeRecipe', 'armordye'], ['BannerDuplicateRecipe', 'bannerduplicate'], ['BookCloningRecipe', 'bookcloning'],
    ['MapCloningRecipe', 'mapcloning'], ['MapExtendingRecipe', 'mapextending'], ['FireworkRocketRecipe', 'firework_rocket'],
    ['FireworkStarFadeRecipe', 'firework_star_fade'], ['FireworkStarRecipe', 'firework_star'], ['RepairItemRecipe', 'repairitem'],
    ['ShieldDecorationRecipe', 'shielddecoration'], ['ShulkerBoxColoringRecipe', 'shulkerboxcoloring'],
    ['SuspiciousStewRecipe', 'suspiciousstew'], ['TippedArrowRecipe', 'tippedarrow']];
  function SpecialCraftingRecipe(rec, ser) { CraftingRecipe.call(this, rec, ser); this.key = rec.s; }
  SpecialCraftingRecipe.prototype = Object.create(CraftingRecipe.prototype);
  SpecialCraftingRecipe.prototype.matches = function (inv) { var f = R().specials[this.key]; return !!f && f.matches(inv.grid, inv.w, inv.h); };
  SpecialCraftingRecipe.prototype.craft = function (inv) { return R().specials[this.key].assemble(inv.grid, inv.w, inv.h); };
  SpecialCraftingRecipe.prototype.fits = function (w, h) { return w * h >= 2; };
  SpecialCraftingRecipe.prototype.isIgnoredInRecipeBook = function () { return true; };
  SpecialCraftingRecipe.prototype.getOutput = function () { return I().EMPTY; };
  C.SpecialCraftingRecipe = SpecialCraftingRecipe;
  var SPECIAL_CLASS = {};
  SPECIALS.forEach(function (p) {
    var K = function (rec, ser) { SpecialCraftingRecipe.call(this, rec, ser); };
    K.prototype = Object.create(SpecialCraftingRecipe.prototype); K.key = p[1];
    C[p[0]] = K; SPECIAL_CLASS[p[1]] = K;
  });

  // AbstractCookingRecipe + Smelting/Blasting/Smoking/CampfireCooking
  function AbstractCookingRecipe(rec, type, ser) { Recipe.call(this, rec, type, ser); }
  AbstractCookingRecipe.prototype = Object.create(RP);
  AbstractCookingRecipe.prototype.matches = function (inv) { return R().ingredientMatches(this.rec.in[0], stackAt(inv, 0)); };
  AbstractCookingRecipe.prototype.getExperience = function () { return this.rec.x; };
  AbstractCookingRecipe.prototype.getCookTime = function () { return this.rec.c; };
  C.AbstractCookingRecipe = AbstractCookingRecipe;
  var COOK = [['SmeltingRecipe', 'smelting', 'SMELTING'], ['BlastingRecipe', 'blasting', 'BLASTING'], ['SmokingRecipe', 'smoking', 'SMOKING'],
    ['CampfireCookingRecipe', 'campfire_cooking', 'CAMPFIRE']];
  COOK.forEach(function (p) {
    var K = function (rec, ser) { AbstractCookingRecipe.call(this, rec, TY[p[1]], ser); };
    K.prototype = Object.create(AbstractCookingRecipe.prototype); C[p[0]] = K;
  });

  // CuttingRecipe + StonecuttingRecipe
  function CuttingRecipe(rec, type, ser) { Recipe.call(this, rec, type, ser); }
  CuttingRecipe.prototype = Object.create(RP);
  CuttingRecipe.prototype.matches = function (inv) { return R().ingredientMatches(this.rec.in[0], stackAt(inv, 0)); };
  C.CuttingRecipe = CuttingRecipe;
  function StonecuttingRecipe(rec, ser) { CuttingRecipe.call(this, rec, TY.stonecutting, ser); }
  StonecuttingRecipe.prototype = Object.create(CuttingRecipe.prototype);
  C.StonecuttingRecipe = StonecuttingRecipe;

  // SmithingRecipe: base + addition; the result keeps the base's tag and damage
  function SmithingRecipe(rec, ser) { Recipe.call(this, rec, TY.smithing, ser); }
  SmithingRecipe.prototype = Object.create(RP);
  SmithingRecipe.prototype.matches = function (inv) {
    return R().ingredientMatches(this.rec.in[0], stackAt(inv, 0)) && R().ingredientMatches(this.rec.in[1], stackAt(inv, 1));
  };
  SmithingRecipe.prototype.craft = function (inv) {
    var Iv = I(), base = stackAt(inv, 0), out = Iv.stack(this.rec.r.i, this.rec.r.n, base.d), tag = Iv.tagOf(base);
    return tag ? Iv.withTag(out, tag) : out;
  };
  SmithingRecipe.prototype.fits = function (w, h) { return w * h >= 2; };
  C.SmithingRecipe = SmithingRecipe;

  // ── RecipeSerializer registry ─────────────────────────────────────────────────────────────
  function Serializer(id, make) { this.id = id; this.make = make; }
  Serializer.prototype.read = function (rec) { return this.make(rec, this); };
  function CookingRecipeSerializer(id, cls, defaultTime) { Serializer.call(this, id, function (rec, s) { return new cls(rec, s); }); this.defaultCookTime = defaultTime; }
  CookingRecipeSerializer.prototype = Object.create(Serializer.prototype);
  function SpecialRecipeSerializer(id, cls) { Serializer.call(this, id, function (rec, s) { return new cls(rec, s); }); }
  SpecialRecipeSerializer.prototype = Object.create(Serializer.prototype);
  C.CookingRecipeSerializer = CookingRecipeSerializer; C.SpecialRecipeSerializer = SpecialRecipeSerializer; C.RecipeSerializer = Serializer;
  var SER = C.serializers = {};
  var reg = function (s) { SER[s.id] = s; return s; };
  reg(new Serializer('crafting_shaped', function (r, s) { return new ShapedRecipe(r, s); }));
  reg(new Serializer('crafting_shapeless', function (r, s) { return new ShapelessRecipe(r, s); }));
  SPECIALS.forEach(function (p) { reg(new SpecialRecipeSerializer('crafting_special_' + p[1], C[p[0]])); });
  reg(new CookingRecipeSerializer('smelting', C.SmeltingRecipe, 200));
  reg(new CookingRecipeSerializer('blasting', C.BlastingRecipe, 100));
  reg(new CookingRecipeSerializer('smoking', C.SmokingRecipe, 100));
  reg(new CookingRecipeSerializer('campfire_cooking', C.CampfireCookingRecipe, 100));
  reg(new Serializer('stonecutting', function (r, s) { return new StonecuttingRecipe(r, s); }));
  reg(new Serializer('smithing', function (r, s) { return new SmithingRecipe(r, s); }));
  var SER_OF_T = ['crafting_shaped', 'crafting_shapeless', 'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutting', 'smithing'];

  // ── RecipeManager ─────────────────────────────────────────────────────────────────────────
  function RecipeManager() { this.byType = new Map(); this.byId = new Map(); this.errored = false; }
  var MP = RecipeManager.prototype;
  /** deserialize(id, packedRecord): the serializer named by the record's type reads it. */
  RecipeManager.deserialize = function (rec) {
    var sid = rec.t === R().SPECIAL ? 'crafting_special_' + rec.s : SER_OF_T[rec.t], s = SER[sid];
    if (!s) throw new Error("Invalid or unsupported recipe type '" + sid + "'");
    return s.read(rec);
  };
  MP.setRecipes = function (list) {
    var byType = new Map(), byId = new Map();
    list.forEach(function (r) {
      var m = byType.get(r.getType()); if (!m) byType.set(r.getType(), m = new Map());
      if (m.has(r.getId())) throw new Error('Duplicate recipe ignored with ID ' + r.getId());
      m.set(r.getId(), r); byId.set(r.getId(), r);
    });
    this.byType = byType; this.byId = byId; this.errored = false;
  };
  MP.load = function () {
    var self = this, out = [];
    R().all.forEach(function (rec) { try { out.push(RecipeManager.deserialize(rec)); } catch (e) { self.errored = true; } });
    this.setRecipes(out); return this;
  };
  MP.isErrored = function () { return this.errored; };
  MP.listAllOfType = function (type) { var m = this.byType.get(type); return m ? Array.from(m.values()) : []; };
  MP.getFirstMatch = function (type, inv, world) {
    var l = this.listAllOfType(type);
    for (var i = 0; i < l.length; i++) if (type.match(l[i], inv, world)) return l[i];
    return null;
  };
  MP.getAllMatches = function (type, inv, world) {
    var key = function (r) { var o = r.getOutput(); return I().isEmpty(o) ? '' : NS.Items.nameOf(o.i); };
    return this.listAllOfType(type).filter(function (r) { return type.match(r, inv, world); }).sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });
  };
  MP.get = function (id) { return this.byId.get(id.indexOf(':') < 0 ? 'minecraft:' + id : id) || null; };
  MP.values = function () { return Array.from(this.byId.values()); };
  MP.keys = function () { return Array.from(this.byId.keys()); };
  C.RecipeManager = RecipeManager;
  var inst = null;
  /** The loaded manager for the current data (rebuilt when Recipes.init has replaced R.all). */
  C.manager = function () {
    if (!inst || inst.src !== R().all) { inst = new RecipeManager().load(); inst.src = R().all; }
    return inst;
  };
})(typeof MCL !== 'undefined' ? MCL : globalThis.MCL);
