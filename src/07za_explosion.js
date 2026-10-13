// 07za_explosion.js — loop/creeper-s95, QUEUE 0.2 G18c: the EXPLOSION substrate. Runs on: MAIN
// THREAD ONLY. No DOM. Nothing in this engine produced an explosion of any kind before this
// unit; a creeper (07zb_creeper.js) was the first live caller and TNT (07zc_tnt.js,
// loop/tnt-s96) is the second — this file's own `affectWorld` also special-cases a TNT block
// caught in either blast (`TntBlock.onDestroyedByExplosion`, see `Ex.init`'s own header).
//
// ⚠⚠ EVERY NUMBER HERE IS `net.minecraft.world.explosion.{Explosion,ExplosionBehavior,
// EntityExplosionBehavior}` (1.18.2, .decomp, READ WHOLE), not approximated:
//   - `collectBlocksAndDamageEntities()`'s own 16x16x16 SURFACE-cell ray grid (only a cell on
//     the cube's own face fires a ray — `$2==0||$2==15||$3==0||$3==15||$4==0||$4==15` — which
//     is 16*16*6 = 1536 rays, never the full 4096). Each ray is normalized, given power
//     `this.power * (0.7 + random()*0.6)`, and stepped `0.3` blocks at a time. Vanilla's own
//     per-step loss has TWO parts and both are real, not a decompiler artifact (checked against
//     a fresh javap of the class): the `for` statement's own trailing `$$9 -= 0.22500001F`
//     fires EVERY iteration regardless of what is underfoot — it is the ONLY reason a blast
//     ever stops in open air, since `ExplosionBehavior.getBlastResistance` returns
//     `Optional.empty()` for air-with-no-fluid and costs the ray nothing on its own — and a
//     SECOND, conditional `$$9 -= (resistance + 0.3) * 0.3` fires only when the current cell
//     answered `getBlastResistance` at all (i.e. is not empty air). A cell is added to the
//     destroy set the instant the remaining power is still positive right after both possible
//     subtractions.
//   - entity damage/knockback over a `power*2`-diameter cube, exactly: `getExposure()`'s own
//     box-grid raycast (`1/((max-min)*2+1)` samples per axis, `Ex.getExposure` below), then
//     `s = (1 - dist/diameter) * exposure`, damage `floor((s*s+s)/2*7*diameter + 1)`, and a
//     velocity IMPULSE (added, never set) of magnitude `s` along the unit vector from the blast
//     centre to the entity (its EYE, not its feet, for the direction only — `Explosion`'s own
//     `TntEntity` special case does not apply to anything this engine spawns).
//   - `affectWorld()`'s own `DestructionType` gate: `NONE` (creeper's own `!mobGriefing`
//     branch, `CreeperEntity.explode`) drops NOTHING and never even collects the loot pool;
//     `DESTROY` (the only OTHER type a creeper ever picks — it never uses `KEEP`) sets the
//     `LootContextParameters.EXPLOSION_RADIUS` parameter to `power`, which `07e_loot.js`'s own
//     `explosion_decay`/`survives_explosion` functions already read as `ctx.explosionRadius`
//     (built for this exact call, unreachable before this unit).
//   - block drops from an explosion are NOT gated on harvest level/correct tool at all —
//     `Block.getDroppedStacks(builder)` is called directly in `affectWorld`, never through
//     `PlayerInteractionManager`'s own `canHarvest` gate — so this file calls `NS.Loot.drops`
//     directly, deliberately bypassing `NS.Loot.breakDrops`'s own tool check (that check is a
//     PLAYER-mining rule, not the loot table's own).
//
// ⚠ NAMED SIMPLIFICATIONS (`Ex.OWED`, not silently dropped — see the array at the file's end):
//   - `getExposure`'s raycast asks `NS.Ray.cast` (14c_raycast.js) with a "this block has ANY
//     collision shape" predicate; the DDA then runs the EXACT per-shape slab test
//     (`hitShape`) for anything that is not a full cube, so this is the real geometry, not a
//     coarser stand-in — except for a FLUID SOURCE block, which vanilla's own
//     `FluidHandling.SOURCE_ONLY` treats as opaque to this ray and this predicate does not
//     (matching this engine's OWN mining-raycast predicate, `NS.Ray.targetable`, which already
//     excludes fluids as targets — the same standing exclusion, not a new one).
//   - `EntityExplosionBehavior.getBlastResistance`/`canDestroyBlock` both call back into
//     `Entity`'s own UNOVERRIDDEN defaults (identity resistance, `canDestroyBlock` always
//     `true`) for every type this engine can spawn today (no wither, no ender dragon — vanilla's
//     only real overrides) — so neither hook is reified as its own per-type table.
//   - `Entity.isImmuneToExplosion()` is `false` for every type; the ONLY override in 1.18.2
//     (grep of .decomp, #5913) is ArmorStandEntity's `isInvisible()` (#4895, skipped in
//     `damageEntities`'s collect loop). Boats, wither skulls and the dragon do NOT override it.
//   - the boom sound and the explosion/huge_explosion PARTICLE (`affectWorld`'s own client
//     half) are UI, not simulation, and this project's own checks run headless — named, not
//     silently skipped.
//   - `Collections.shuffle(affectedBlocks, world.random)` IS reproduced (`Ex.shuffleKeys`):
//     for i=size; i>1; i-- swap(i-1, nextInt(i)); `rnd.nextInt` when given, else floor(rnd()*i).

(function (NS) {
  'use strict';

  var Ex = NS.Explosion = { ready: false };

  Ex.init = function () {
    Ex.ready = !!(NS.World && NS.Reg && NS.States);
    // loop/tnt-s96 -- `TntBlock.onDestroyedByExplosion`/`shouldDropItemsOnExplosion=false`
    // (.decomp/net/minecraft/block/TntBlock.java:62-69,118-121): a TNT block caught in ANY
    // explosion's blast never drops its own item and instead becomes a primed TntEntity, so
    // `Ex.affectWorld` below needs this block's own id, looked up once here the same way
    // `07f_redstone.js`'s own `Rs.init` resolves `R.id.<name>` once rather than per call.
    Ex._tntId = (Ex.ready && NS.Reg.id) ? NS.Reg.id.tnt : -1;
    if (Ex._tntId === undefined) Ex._tntId = -1;
    return Ex;
  };

  // `Explosion.collectBlocksAndDamageEntities`'s own literals, named so a future TNT wiring
  // (`Ex.OWED`) does not have to retype them and so `creepercheck.mjs` can read them back.
  Ex.GRID = 16;                  // the 16x16x16 surface-cell grid ($$1)
  Ex.RAY_STEP = 0.3;             // the per-step advance along each ray
  Ex.RESIST_FACTOR = 0.3;        // (resistance + RAY_STEP) * RESIST_FACTOR lost per step
  Ex.STEP_DECAY = 0.22500001;    // the for-loop's OWN unconditional per-step loss (see header)
  Ex.POWER_MIN = 0.7;            // power * (POWER_MIN + random() * POWER_SPAN)
  Ex.POWER_SPAN = 0.6;
  Ex.DAMAGE_FACTOR = 7;          // the "* 7.0" in the int-damage formula

  /** `Optional<Float> ExplosionBehavior.getBlastResistance` for a real block-space cell —
   *  `null` for empty air with no fluid, matching the ternary exactly (air costs a ray nothing
   *  beyond `Ex.STEP_DECAY`). A finite huge number stands in for an unbreakable block's own
   *  `Infinity` (bedrock, `R.resist`'s own D-307-style default) so the subtraction below stays
   *  finite arithmetic instead of producing a NaN the instant one ray happens to clip it. */
  Ex.HUGE_RESIST = 1e9;
  function resistanceAt(x, y, z, hook) {
    var W = NS.World, S = NS.States, R = NS.Reg;
    var st = W.getBlock(x, y, z);
    if (st === 0) return null;
    var block = S.block[st];
    var r = R.resist[block];
    if (hook) r = hook(st, r, x, y, z);   // EntityExplosionBehavior.getBlastResistance -> Entity.getEffectiveExplosionResistance
    return isFinite(r) ? r : Ex.HUGE_RESIST;
  }
  Ex.resistanceAt = resistanceAt;   // exposed for creepercheck's own direct-math assertions

  /** Does this block have ANY collision shape? `NS.Ray.cast`'s own DDA does the exact per-shape
   *  geometry test once this says "worth testing" — see the file header. */
  function collides(id) {
    if (id === 0) return false;
    var Ph = NS.Physics;
    var sh = Ph && Ph.shapeOf ? Ph.shapeOf(id) : null;
    return !!(sh && sh.length);
  }

  /**
   * `Explosion.collectBlocksAndDamageEntities`'s own block-collection half — the 1536-ray
   * surface grid, decaying by both `Ex.STEP_DECAY` (always) and the resistance term (only over
   * a real block). Returns a `{ "x,y,z": [x,y,z] }` map (`Explosion`'s own deduplicated `Set`).
   * ⚠ Runs even when `griefing` is false — `collectBlocksAndDamageEntities` is unconditional in
   * vanilla; `DestructionType.NONE` only gates the LATER `affectWorld` half (see that function).
   */
  Ex.collectBlocks = function (x, y, z, power, rnd, resistHook, destroyHook) {
    var random = rnd || NS.wrand;
    var affected = {};
    for (var cxg = 0; cxg < Ex.GRID; cxg++) {
      for (var cyg = 0; cyg < Ex.GRID; cyg++) {
        for (var czg = 0; czg < Ex.GRID; czg++) {
          if (cxg !== 0 && cxg !== Ex.GRID - 1 && cyg !== 0 && cyg !== Ex.GRID - 1 &&
              czg !== 0 && czg !== Ex.GRID - 1) continue;   // interior cell — not on the cube's face
          // Explosion.java:156-168 is float arithmetic: (float)a / 15.0F * 2.0F - 1.0F, power * (0.7F + nextFloat() * 0.6F), 0.3F steps, (res + 0.3F) * 0.3F (lockstep-explode)
          var fr = Math.fround;
          var dx = fr(fr(fr(cxg / (Ex.GRID - 1)) * 2) - 1);
          var dy = fr(fr(fr(cyg / (Ex.GRID - 1)) * 2) - 1);
          var dz = fr(fr(fr(czg / (Ex.GRID - 1)) * 2) - 1);
          var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (!(len > 0)) continue;   // never happens for a surface cell — defensive only
          dx /= len; dy /= len; dz /= len;
          var remaining = fr(power * fr(fr(Ex.POWER_MIN) + fr(fr(random()) * fr(Ex.POWER_SPAN))));
          var step = fr(Ex.RAY_STEP);
          var px = x, py = y, pz = z;
          while (remaining > 0) {
            var bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
            var res = resistanceAt(bx, by, bz, resistHook);
            if (res !== null) remaining = fr(remaining - fr(fr(fr(res) + step) * fr(Ex.RESIST_FACTOR)));
            if (remaining > 0 && (!destroyHook || destroyHook(W.getBlock(bx, by, bz), bx, by, bz))) affected[bx + ',' + by + ',' + bz] = [bx, by, bz];
            px += dx * step; py += dy * step; pz += dz * step;
            remaining = fr(remaining - fr(Ex.STEP_DECAY));
          }
        }
      }
    }
    return affected;
  };

  /** `Explosion.getExposure` — the fraction of a box-grid sample on `e`'s bounding box that has
   *  line of sight to `(cx,cy,cz)`, one `NS.Ray.cast` per sample. `e.x/e.y/e.z` is this
   *  engine's own FEET position (`EL.spawn`'s own convention); the player carries the same
   *  three fields. */
  Ex.getExposure = function (cx, cy, cz, e) {
    var hw = (e.width || 0.6) * 0.5;
    var x0 = e.x - hw, x1 = e.x + hw;
    var y0 = e.y, y1 = e.y + (e.height || 1.8);
    var z0 = e.z - hw, z1 = e.z + hw;
    var sx = 1 / ((x1 - x0) * 2 + 1);
    var sy = 1 / ((y1 - y0) * 2 + 1);
    var sz = 1 / ((z1 - z0) * 2 + 1);
    if (!(sx >= 0) || !(sy >= 0) || !(sz >= 0)) return 0;
    var ox = (1 - Math.floor(1 / sx) * sx) / 2;
    var oz = (1 - Math.floor(1 / sz) * sz) / 2;
    var Ray = NS.Ray, hits = 0, total = 0;
    for (var fx = 0; fx <= 1 + 1e-9; fx += sx) {
      for (var fy = 0; fy <= 1 + 1e-9; fy += sy) {
        for (var fz = 0; fz <= 1 + 1e-9; fz += sz) {
          var px = x0 + (x1 - x0) * fx + ox;
          var py = y0 + (y1 - y0) * fy;
          var pz = z0 + (z1 - z0) * fz + oz;
          var dx = px - cx, dy = py - cy, dz = pz - cz;
          var hit = (dx === 0 && dy === 0 && dz === 0) ? null
            : (Ray ? Ray.cast(cx, cy, cz, dx, dy, dz, 1.0, collides) : null);
          if (!hit) hits++;
          total++;
        }
      }
    }
    return total > 0 ? hits / total : 0;
  };

  /**
   * The damage/knockback half, over the player and every `EntityList` entry with a tracked
   * health (`e.maxHealth !== undefined`) other than `source` itself — `Explosion`'s own
   * `getOtherEntities(this.entity, box)`. Returns how many entities actually took a hit.
   */
  /** `Explosion.getCausingEntity()`: a primed TNT's igniter (null when redstone/fire lit it), else the source itself. */
  Ex.causing = function (source) { return source && source.type === 'tnt' ? (source.igniter || null) : (source || null); };
  /** #5067 -- non-living types `collectBlocksAndDamageEntities` damages/shoves (everything in the box in vanilla). */
  Ex.NONLIVING = { item: 1, experience_orb: 1, tnt: 1, falling_block: 1, arrow: 1, spectral_arrow: 1, trident: 1,
    snowball: 1, egg: 1, ender_pearl: 1, experience_bottle: 1, potion: 1, fireball: 1, small_fireball: 1 };
  Ex.damageEntities = function (source, x, y, z, power) {
    if (!Ex.ready) return 0;
    var diameter = power * 2;
    if (!(diameter > 0)) return 0;
    var EL = NS.EntityList, Cb = NS.Combat, Sv = NS.Survival;
    var targets = [];
    if (NS.Player) targets.push(NS.Player);
    if (EL && EL.list) {
      for (var i = 0; i < EL.list.length; i++) {
        var e = EL.list[i];
        if (e === source || e.removed) continue;
        // #4895 -- ArmorStandEntity.isImmuneToExplosion() is isInvisible(): skipped for damage AND knockback.
        if (e.type === 'armor_stand' && e.invisible) continue;
        // loop/endcrystal-entity -- `end_crystal` is the ONE non-living type this
        // engine now models taking real explosion damage (EndCrystalEntity extends
        // Entity, no health, but `Explosion.collectBlocksAndDamageEntities` damages
        // it exactly like any other entity in range -- `EC.damage`, NS.EndCrystal,
        // src/07zzn_endcrystal.js, own gate). Every other non-living type stays
        // untouched (Ex.OWED unchanged for them).
        if (e.maxHealth === undefined && e.type !== 'end_crystal' && !Ex.NONLIVING[e.type] && !(Cb && Cb.isCart && Cb.isCart(e))) continue;
        // #3824 -- getOtherEntities returns the EnderDragonParts, never the dragon (its own damage() is false):
        // each part is exposure-tested and hurt on its own through EnderDragonEntity.damagePart.
        if (e.type === 'ender_dragon' && e.dragon && e.dragon.parts) {
          for (var pi = 0; pi < e.dragon.parts.length; pi++) { var pt = e.dragon.parts[pi]; pt.dragonEntity = e; targets.push(pt); }
          continue;
        }
        targets.push(e);
      }
    }
    var hits = 0;
    for (var t = 0; t < targets.length; t++) {
      var ent = targets[t];
      var isPlayer = (ent === NS.Player);
      var dragonE = ent.dragonEntity;
      if (!isPlayer && !dragonE && ent.maxHealth === undefined && ent.type !== 'end_crystal' && !Ex.NONLIVING[ent.type] && !(Cb && Cb.isCart && Cb.isCart(ent))) continue;
      var dxp = ent.x - x, dyp = ent.y - y, dzp = ent.z - z;
      var dist = Math.sqrt(dxp * dxp + dyp * dyp + dzp * dzp);
      var frac = dist / diameter;
      if (!(frac <= 1)) continue;
      // Explosion.java: `$$28 instanceof TntEntity ? $$28.getY() : $$28.getEyeY()` (#6317)
      var eyeY = ent.type === 'tnt' ? ent.y : ent.y + (dragonE ? ent.height * 0.85 : Cb && Cb.eyeHeightOf ? Cb.eyeHeightOf(ent) : (ent.height || 1.62) * 0.85);
      var ix = ent.x - x, iy = eyeY - y, iz = ent.z - z;
      var ilen = Math.sqrt(ix * ix + iy * iy + iz * iz);
      if (!(ilen > 0)) continue;
      ix /= ilen; iy /= ilen; iz /= ilen;
      var exposure = Ex.getExposure(x, y, z, ent);
      var s = (1 - frac) * exposure;
      if (!(s > 0)) continue;
      var dmg = Math.floor((s * s + s) / 2 * Ex.DAMAGE_FACTOR * diameter + 1);
      var landed;
      if (isPlayer) {
        // ⚠ named OWED — no dedicated 'explosion' row in `Sv.DAMAGE` (14d_survival.js, not
        // one of this unit's own files); 'generic' shares its EXACT bypassArmor/bypassInvuln
        // shape (both false, same as vanilla's own DamageSource.explosion), only the death
        // message's lang key would differ.
        landed = Sv && Sv.hurt ? Sv.hurt(ent, Ex.damageTag || 'explosion', dmg) : false;
      } else if (ent.type === 'end_crystal') {
        // loop/endcrystal-entity -- `EndCrystalEntity.damage()` (.decomp, read whole): any
        // landed hit removes it outright regardless of `dmg`'s own magnitude (it has no
        // health to subtract from) -- `explosive: true` is why `EC.damage`'s own
        // `!source.isExplosive()` guard does NOT chain a second explosion here, matching the
        // jar exactly (an explosion killing a crystal never double-explodes).
        var EC = NS.EndCrystal;
        landed = EC && EC.ready ? EC.damage(ent, { attacker: Ex.causing(source) || undefined, explosive: true }) : false;
      } else if (Ex.NONLIVING[ent.type]) {
        // #5067 -- ItemEntity/ExperienceOrbEntity.damage: health 5 (int) minus the float damage,
        // discard at <= 0, true when hit; a nether star is immune to explosive damage. tnt,
        // falling_block and projectiles keep Entity.damage's default (false) but are still shoved.
        landed = false;
        if (ent.type === 'experience_orb' || ent.type === 'item') {
          var nStar = ent.type === 'item' && (ent.item === 'nether_star' || (ent.item && ent.item.name === 'nether_star'));
          if (!nStar) {
            if (ent.health === undefined) ent.health = 5;
            ent.health = Math.trunc(ent.health - dmg);
            if (ent.health <= 0) ent.removed = true;
            landed = true;
          }
          if (nStar) { /* damage() false; knockback below still applies */ }
        }
      } else if (dragonE) {
        dragonE.hitPart = ent;
        landed = Cb && Cb.hurt ? Cb.hurt(dragonE, dmg, undefined, false, { attacker: Ex.causing(source) || undefined, explosive: true }) : false;
        dragonE.hitPart = null;
        if (landed) hits++;
        continue;   // parts have no velocity of their own
      } else {
        landed = Cb && Cb.hurt ? Cb.hurt(ent, dmg, undefined, false, { attacker: Ex.causing(source) || undefined, explosive: true }) : false;
        if (landed && Cb.notifyHurt) Cb.notifyHurt(ent, Ex.causing(source) || source);
      }
      // armorStandDamage always answers false (the stand is killed inside it), but vanilla's
      // knockback is independent of damage() -- every non-immune entity is pushed.
      if (landed || ent.type === 'armor_stand' || Ex.NONLIVING[ent.type]) {
        if (landed) hits++;
        var ks = Ex.knockbackScale(ent, s);
        ent.vx = (ent.vx || 0) + ix * ks;
        ent.vy = (ent.vy || 0) + iy * ks;
        ent.vz = (ent.vz || 0) + iz * ks;
      }
    }
    return hits;
  };

  /**
   * `ProtectionEnchantment.transformExplosionKnockback` (LivingEntity only): the MAX blast_protection
   * level over the armour slots (`getEquipmentLevel`), then `s -= floor(s * (float)(lvl * 0.15F))`.
   */
  Ex.knockbackScale = function (ent, s) {
    var IT = NS.Items, Eq = NS.Equip, Cb = NS.Combat;
    if (!Eq || !Cb || !Cb.enchantLevel || !IT || !IT.ready || !ent || !ent.equip) return s;
    if (ent.maxHealth === undefined && ent !== NS.Player) return s;   // LivingEntity only
    var slots = [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD], lvl = 0;
    for (var i = 0; i < slots.length; i++) {
      var st = Eq.getEquipped(ent, slots[i]);
      if (st) lvl = Math.max(lvl, Cb.enchantLevel(st, 'blast_protection'));
    }
    if (lvl > 0) s -= Math.floor(s * Math.fround(lvl * Math.fround(0.15)));
    return s;
  };

  /**
   * `affectWorld(true)`'s own block-destruction half — skipped ENTIRELY when `griefing` is
   * false (`DestructionType.NONE`'s own early-out, not a per-block filter over the same set).
   * `affected` is `Ex.collectBlocks`'s own return shape. Returns how many blocks broke.
   */
  /** java.util.Collections.shuffle(list, rnd): for (i = size; i > 1; i--) swap(list, i - 1, rnd.nextInt(i)). */
  Ex.shuffleKeys = function (list, rnd) {
    for (var i = list.length; i > 1; i--) {
      var j = (rnd && typeof rnd.nextInt === 'function') ? rnd.nextInt(i) : Math.floor((rnd || NS.wrand)() * i);
      var t = list[i - 1]; list[i - 1] = list[j]; list[j] = t;
    }
    return list;
  };

  Ex.affectWorld = function (source, affected, griefing, power, rnd, decay) {
    if (!griefing) return 0;
    if (decay === undefined) decay = true;
    var W = NS.World, Loot = NS.Loot, EL = NS.EntityList, It = NS.Items, S = NS.States;
    var rf = rnd || NS.wrand;
    var broken = 0;
    var order = Ex.shuffleKeys(Object.keys(affected), rnd);
    for (var oi = 0; oi < order.length; oi++) {
      var c = affected[order[oi]];
      var bx = c[0], by = c[1], bz = c[2];
      var st = W.getBlock(bx, by, bz);
      if (st === 0) continue;
      // ⚠ `TntBlock.onDestroyedByExplosion` (see `Ex.init`'s own header) — a TNT block never
      // drops itself here; it becomes a primed TntEntity instead, fuse `random(fuse/4) +
      // fuse/8` off `TntEntity.DEFAULT_FUSE` (80): `random(20) + 10`, i.e. 10..29 inclusive,
      // the exact jar arithmetic (`.decomp/TntBlock.java:66`), not a rounded stand-in.
      if (Ex._tntId >= 0 && S && S.block[st] === Ex._tntId) {
        W.setBlock(bx, by, bz, 0);
        broken++;
        if (EL && EL.ready && EL.spawn) {
          // TntBlock.primeTnt: the TntEntity constructor draws the nextDouble() spawn angle FIRST, then setFuse draws nextInt (#6317)
          var nt = EL.spawn('tnt', bx + 0.5, by, bz + 0.5, { igniter: Ex.causing(source) });
          if (nt) nt.fuse = Math.floor(rf() * 20) + 10;
        }
        continue;
      }
      // ⚠ `NS.Loot.drops`, NOT `NS.Loot.breakDrops` — see the file header: an explosion is not
      // gated on harvest level or the correct tool at all. `explosionRadius` is only set for a
      // `DestructionType.DESTROY` explosion (`Explosion.affectWorld`, `.decomp/Explosion.java`
      // line ~282: `if (this.destructionType == field_18687) $$8.parameter(EXPLOSION_RADIUS,
      // this.power)`) — a `BREAK`-type explosion (TNT, `decay=false` below) never sets it, so
      // `survives_explosion`/`explosion_decay` both read it missing and keep every stack whole.
      var drops = (Loot && Loot.ready) ? Loot.drops({ state: st, explosionRadius: decay ? power : undefined, noEntity: !source }) : [];
      // loop/infested — `InfestedBlock.onDestroyedByExplosion` (.decomp/net/minecraft/block/
      // InfestedBlock.java:53-57): UNCONDITIONAL on `doTileDrops` (unlike the survival-break
      // hook, `NS.Silverfish.onBreak`, which checks it) — an infested block always releases its
      // silverfish when an explosion destroys it, gated only on this being a real world break
      // (already true: `affectWorld` returned above when `!griefing`, vanilla's own
      // `ServerWorld` guard collapsed to the same mobGriefing gate every other block-destroying
      // explosion path in this file already uses).
      if (NS.Silverfish && NS.Silverfish.isInfested(S.name(st))) NS.Silverfish.spawn(bx, by, bz);
      W.setBlock(bx, by, bz, 0);
      broken++;
      if (drops.length && EL && EL.ready && EL.popResource && It && It.of) {
        for (var k = 0; k < drops.length; k++) {
          var idx = It.of(drops[k].item);
          if (idx >= 0) EL.popResource(bx, by, bz, idx, drops[k].count || 1);
        }
      }
    }
    return broken;
  };

  /**
   * One call end to end — `new Explosion(...).collectBlocksAndDamageEntities()` then
   * `affectWorld(true)`, run back to back because nothing in this engine defers the two the
   * way a client/server split would (no particle to sequence around — see `Ex.OWED`).
   */
  /** `decay` is whether `DestructionType.DESTROY`'s own loot-context `explosionRadius`
   *  applies (the `survives_explosion`/`explosion_decay` chance) — true for every caller here
   *  except TNT (`Tnt.explode`, `07zc_tnt.js`), whose `DestructionType.BREAK` never sets it
   *  (`.decomp/TntEntity.java` vs `CreeperEntity.java`/`FireballEntity.java`/etc., all
   *  `field_18687`). Default true so every existing (creeper/ghast/blaze) caller is unchanged. */
  Ex.explode = function (source, x, y, z, power, griefing, rnd, decay, resistHook, createFire, destroyHook, damageTag) {
    if (!Ex.ready) return { blocks: 0, entities: 0 };
    if (griefing === undefined) griefing = true;
    var affected = Ex.collectBlocks(x, y, z, power, rnd, resistHook, destroyHook);
    // affectWorld's client half: ENTITY_GENERIC_EXPLODE, BLOCKS, 4.0, (1 + (f - f) * 0.2) * 0.7,
    // played whether or not blocks are destroyed. Own Math.random: the client's RNG, so the
    // seeded `rnd` sequence the callers/checks rely on is untouched.
    if (NS.Sound && NS.Sound.play) {
      NS.Sound.play('entity.generic.explode', { x: x, y: y, z: z, volume: 4.0,
        pitch: (1.0 + (NS.wrand() - NS.wrand()) * 0.2) * 0.7, source: 'block' });
    }
    // affectWorld(true)'s particle: EXPLOSION_EMITTER when power >= 2 and blocks are destroyed, else EXPLOSION.
    // (1.18.2 Explosion.java has no per-block poof/smoke; those were pre-1.17.)
    if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn((power < 2 || !griefing) ? 'explosion' : 'explosion_emitter', x, y, z, 1, 0, 0);
    // World.createExplosion -> emitGameEvent(entity, EXPLODE, Vec3d(x, y, z)) at the blast centre.
    if (NS.GameEvent) NS.GameEvent.emit('explode', x, y, z, source);
    Ex.damageTag = damageTag || null;     // player-damage source id for this blast only (e.g. 'badRespawnPoint')
    var hits = Ex.damageEntities(source, x, y, z, power);
    Ex.damageTag = null;
    var broken = Ex.affectWorld(source, affected, griefing, power, rnd, decay);
    // `Explosion.affectWorld`'s createFire tail (.decomp Explosion.java ~303): runs over every
    // affected cell regardless of DestructionType; 1/3 chance, air here, opaque full cube below.
    if (createFire) {
      var Wd = NS.World, St = NS.States, rf = rnd || NS.wrand;
      for (var key in affected) {
        var c = affected[key];
        if (Math.floor(rf() * 3) === 0 && Wd.getBlock(c[0], c[1], c[2]) === 0 &&
            St.solidRender(Wd.getBlock(c[0], c[1] - 1, c[2]))) {
          Wd.setBlock(c[0], c[1], c[2], NS.Behave.fireStateAt(c[0], c[1], c[2], 0));
        }
      }
    }
    return { blocks: broken, entities: hits };
  };

  Ex.OWED = [
    // loop/tnt-s96 -- STRUCK: TNT's own fuse-tick/explode trigger, TntBlock's redstone/
    // flint-and-steel ignition paths and its onDestroyedByExplosion re-prime are all wired
    // now (07zc_tnt.js, 14l_use.js's own primeTnt, 07f_redstone.js's own Rs.updateTnt, and
    // this file's own affectWorld TNT branch above). What is still owed is named on
    // `Tnt.OWED` (07zc_tnt.js) instead of duplicated here.
    'getExposure\'s raycast does not treat a fluid SOURCE block as opaque (vanilla\'s own ' +
      'FluidHandling.SOURCE_ONLY) — matches this engine\'s existing mining-raycast exclusion ' +
      'of fluids, not a new gap this file introduces',
    'canExplosionDestroyBlock is the unoverridden Entity default for every type this engine ' +
      'can spawn (isImmuneToExplosion has only the armor_stand override, #5913); getEffectiveExplosionResistance ' +
      'is wired only for the charged wither skull (Ex.explode\'s resistHook, Wi.chargedSkullResist)',
    'the explosion particle is simulated (Px) but has no atlas frames yet: Px.frameLayer draws nothing for it (#5253)'
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
