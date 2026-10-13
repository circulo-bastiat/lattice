// 07h_entities.js — PLAN G17a: the ENTITY TYPE TABLE.
// Runs on: MAIN THREAD ONLY. No DOM.
//
// One hundred and thirteen entity types and what each one IS, before anything moves: its id,
// the box it occupies, whether fire hurts it, and the two networking numbers vanilla registers
// beside them.
//
// ⚠⚠ **THERE IS NO JSON FOR ANY OF THIS, IN ANY VERSION OF THE GAME.** A zombie's 0.6 x 1.95
// exists in exactly one place — `EntityType.<clinit>`, as
// `register("zombie", Builder.of(Zombie::new, MobCategory.MONSTER).sized(0.6F, 1.95F)...)` —
// and nowhere else: not in a data pack, not in a tag, not in `minecraft-data` except as somebody
// else's transcription of the wiki. So the table is read out of the 1.18.2 BYTECODE by
// `tools/extract-entities.mjs`, which is the tenth application of the referee's rules (D-263,
// D-306), and packed into `NS.DATA.entities` by `tools/pack-entities.mjs`.
//
// ⚠ THIS MODULE HOLDS NO BEHAVIOUR, AND THAT IS THE RULING (PLAN G17's three-way split). What a
// falling block does when it lands, how an item entity merges, what an arrow hits — those are
// G17b's and G17c's, and writing a stub for them here is how a half-built stage gets mistaken
// for a finished one (D-294). What is here is the DATA every one of them will read.
//
// ⚠ AND NOTHING HERE INVENTS A DEFAULT. An entity type this table does not carry is not "a
// 0.6 x 1.8 entity"; it is an error, and `Ent.dimensions` says so by returning null. A silent
// default is how a typo becomes a mob that is the wrong size for ever (D-298's `|| 'NORMAL'`
// swallowed 584 rows exactly that way).

(function (NS) {
  'use strict';

  var Ent = NS.Entities = {
    ready: false,
    count: 0,
    /** name -> [width, height, fireImmune, clientTrackingRange, updateInterval] */
    types: null,
    names: null
  };

  /** Integer.MAX_VALUE — vanilla's "never send an update", carried as the number it is. */
  Ent.NEVER = 2147483647;

  Ent.init = function () {
    var D = NS.DATA;
    var src = D && D.entities;
    if (!src || !src.types) { Ent.ready = false; return Ent; }
    Ent.types = src.types;
    Ent.attrs = src.attrs || null;               // D-336, the mob attribute table
    // QUEUE 0.2 (this unit) -- `generic.armor` (`EntityAttributes.field_23724`, default 0.0,
    // .decomp `entity/attribute/EntityAttributes.java:29-31`) is a REAL per-mob base attribute
    // vanilla's `LivingEntity.createLivingAttributes()` registers for every living entity, same
    // as max_health/movement_speed/etc above -- but `tools/extract-entityattrs.mjs` (D-336) never
    // read it, so this table (and `Ent.attrsOf`) had NO armor column at all: Combat's damage path
    // (`Eq.armorOf`, 07y_equip.js) could only ever see WORN armour, never a mob's own innate
    // base armor attribute (`Wi.OWED`'s own words: "a gap wider than this one mob"). `Ent.ARMOR`
    // is that column, added by hand rather than re-running the bytecode extractor for all 113
    // types in one pass: every entry here is a value CONFIRMED against `.decomp`, and every type
    // this table does not name gets the registry's own default of 0 -- never a guess (D-298's own
    // ruling, this module's header). Confirmed so far:
    //   wither: 4.0 -- `WitherEntity.createWitherAttributes()` (.decomp WitherEntity.java:502-509)
    //     `.add(EntityAttributes.field_23724, 4.0)`, field_23724 confirmed as `generic.armor` in
    //     `EntityAttributes.java:29-31`.
    // Magma cube's size*3 armor is per-instance (`e.armorBase`, Sl.setSize, #1003), not a type constant.
    Ent.ARMOR = { wither: 4 };
    if (Ent.attrs) {
      for (var _an in Ent.attrs) {
        if (Ent.attrs[_an].armor === undefined) Ent.attrs[_an].armor = Ent.ARMOR[_an] || 0;
      }
    }
    // G18e — the breeding table and the eight constants `Animal`/`AgeableMob` own. Both are
    // `tools/extract-breeding.mjs`'s, out of the same jar as everything else here.
    Ent.breeding = src.breeding || null;
    Ent.BREED = src.breedConst || null;
    // G18e unit 2 — how a BABY of this type is drawn, per model class. See `Ent.babyModel`.
    Ent.babyModels = src.baby || null;
    Ent.names = Object.keys(src.types).sort();
    Ent.count = Ent.names.length;
    Ent.ready = Ent.count > 0;
    return Ent;
  };

  /**
   * The mob attributes for a type — `{ hp, speed, dmg, follow, kbRes, atkKb, armor }` — or null (D-336).
   *
   * ⚠⚠ **"HAS A MAX HEALTH" IS VANILLA'S OWN DEFINITION OF A LIVING ENTITY, and it is the one
   * this engine uses to decide what can be attacked.** 74 of the 113 types resolve one through
   * their class chain and 38 do not: items, arrows, boats, minecarts, primed TNT. That split is
   * a fact about the jar rather than a list somebody kept up to date, which is the difference
   * between a roster and a rule.
   * ⚠ `Ent.isLiving` IS NOT `e.living` ON A SPAWNED ENTITY. That flag is the PHYSICS one — it
   * says whether `Physics.move` runs `LivingEntity.checkFallDamage`'s landing path — and the two
   * questions only look the same. Keeping them apart is why D-308 was fixable at all.
   */
  Ent.attrsOf = function (name) {
    var a = Ent.attrs && Ent.attrs[Ent.bare(name)];
    return a || null;
  };
  Ent.isLiving = function (name) { return !!Ent.attrsOf(name); };
  Ent.maxHealth = function (name) { var a = Ent.attrsOf(name); return a ? a.hp : 0; };
  /** Every type with a max health, sorted — the closed set the combat layer may touch. */
  Ent.living = function () {
    if (!Ent.attrs) return [];
    return Object.keys(Ent.attrs).sort();
  };

  /**
   * What this species eats to breed — `{ k, i, t }` — or null for a type that is not an animal.
   *
   * ⚠⚠ **`k` HAS FOUR VALUES AND THEY ARE FOUR DIFFERENT FACTS.** `items` is an explicit list,
   * `tag` an item tag, `none` means VANILLA FORBIDS BREEDING (parrot, polar bear) and
   * `predicate` means the rule is not a list at all — a wolf takes any edible item whose
   * FoodProperties say meat. Collapsing the last two into "no items" would turn "the game says
   * no" into "we have not built it yet", and only one of those is a hole.
   */
  Ent.breedFood = function (name) {
    var b = Ent.breeding && Ent.breeding[Ent.bare(name)];
    return b || null;
  };
  /**
   * `AgeableListModel`'s six numbers for a type — `{ sh, hy, hz, hs, bs, by, head }` — or null
   * when this engine has not read that model's constructor (the table names which and why).
   *
   * ⚠⚠ **A BABY IS NOT THE ADULT DRAWN SMALLER.** Vanilla transforms the HEAD parts and the
   * BODY parts separately, and `sh` (scaleHead) is 0 for four of the ten models read — a baby
   * cow's head is drawn at FULL SIZE on a halved body, which is the whole look. A renderer that
   * scaled the mob uniformly would be wrong for every one of them and obviously so.
   */
  Ent.babyModel = function (name) {
    var b = Ent.babyModels && Ent.babyModels[Ent.bare(name)];
    return b || null;
  };

  /** Every animal the jar gives a breeding rule, sorted — the closed set G18e may touch. */
  Ent.animals = function () { return Ent.breeding ? Object.keys(Ent.breeding).sort() : []; };

  /** True if this id is an entity type in 1.18.2. Accepts a bare id or minecraft:id. */
  Ent.has = function (name) { return !!(Ent.types && Ent.types[Ent.bare(name)]); };

  Ent.bare = function (name) {
    if (typeof name !== 'string') return '';
    var i = name.indexOf(':');
    return i < 0 ? name : name.slice(i + 1);
  };

  /**
   * The type's box, as vanilla's `EntityDimensions`: width is the FULL side of a square
   * footprint, height the FULL height. Returns null for an unknown id — see the header.
   */
  Ent.dimensions = function (name) {
    var r = Ent.types && Ent.types[Ent.bare(name)];
    return r ? { width: r[0], height: r[1] } : null;
  };

  Ent.width = function (name) { var d = Ent.dimensions(name); return d ? d.width : null; };
  Ent.height = function (name) { var d = Ent.dimensions(name); return d ? d.height : null; };

  /**
   * The axis-aligned box an entity of this type standing at (x, y, z) occupies.
   *
   * ⚠ THE POSITION IS THE FEET, AND IT IS THE CENTRE OF THE FOOTPRINT — vanilla's
   * `EntityDimensions.makeBoundingBox(pos)` is `[x - w/2, y, z - w/2] .. [x + w/2, y + h, z + w/2]`.
   * Centring the box on the position vertically, which is the other obvious reading, puts every
   * mob half-buried in the floor.
   */
  Ent.boxAt = function (name, x, y, z) {
    var d = Ent.dimensions(name);
    if (!d) return null;
    var h = d.width * 0.5;
    return [x - h, y, z - h, x + h, y + d.height, z + h];
  };

  Ent.fireImmune = function (name) {
    var r = Ent.types && Ent.types[Ent.bare(name)];
    return r ? r[2] === 1 : null;
  };
  /** -1 when the registration sets none; vanilla's own default applies then. */
  Ent.trackingRange = function (name) {
    var r = Ent.types && Ent.types[Ent.bare(name)];
    return r ? r[3] : null;
  };
  Ent.updateInterval = function (name) {
    var r = Ent.types && Ent.types[Ent.bare(name)];
    return r ? r[4] : null;
  };

  /** Every id, sorted. A copy, because the table is not the caller's to reorder. */
  Ent.all = function () { return Ent.names ? Ent.names.slice() : []; };

})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
