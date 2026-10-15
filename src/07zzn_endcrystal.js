// src/07zzn_endcrystal.js — loop/endcrystal-entity: the real `end_crystal` entity this engine
// never had (named on ED.OWED, src/07zzl_enderdragon.js, until this file) -- registration is
// this file's own EL.DEFAULTS.end_crystal + EL.motionFor (07i_entitylist.js), its damage rule
// is `EC.damage` below, and the wiring into the already-real ED.EnderDragonFight.prototype.
// crystalDestroyed()/ED.EnderDragonEntity.prototype.crystalDestroyed()/phase.crystalDestroyed()
// chain is `EC.crystalDestroyed` calling `ED.getActiveFight()` (07zzl_enderdragon.js, added by
// this same pass).
//
// .decomp read whole: net/minecraft/entity/decoration/EndCrystalEntity.java. Yarn names, off
// `.decomp/names.tsv` (class bkc / class_1511):
//   method_6835 crystalDestroyed(DamageSource)  -- private, this file's own EC.crystalDestroyed
//   method_6837 setBeamTarget(BlockPos)          -- OWED (no beam-target tracking, see below)
//   method_6839 setShowBottom(boolean)           -- e.showBottom, EL.DEFAULTS.end_crystal
//   method_6838 getBeamTarget() / method_6836 shouldShowBottom() -- trivial field reads, OWED
//     (nothing renders a beam yet -- there is no beam primitive in this engine's render
//     substrate at all, named not guessed, see the header of docs this pass leaves for the
//     orchestrator).
// Registration facts (.decomp/net/minecraft/entity/EntityType.java): `end_crystal` is
// `EntityType.Builder.create(EndCrystalEntity::new, SpawnGroup.field_17715).setDimensions(2.0F,
// 2.0F).maxTrackingRange(16).trackingTickInterval(Integer.MAX_VALUE)` -- no `makeFireImmune()`,
// unlike `ender_dragon` two rows below it in the same file. This engine's own generated dims
// row (`src/19_data.gen.js`, "end_crystal":[2,2,0,16,2147483647]) already carries exactly that
// width/height/trackingRange/trackingTickInterval quadruple -- `EL.spawn` reads it generically
// for ANY type once `EL.motionFor` says the type exists (07i_entitylist.js), so this file adds
// no dims table of its own.
//
// -- WHY THIS IS NOT A LivingEntity -----------------------------------------------------------
// `EndCrystalEntity extends Entity` directly (no health, no armor, no invulnerability window).
// `EL.spawn` already only gives a spawned entity `maxHealth`/`health` when `Entities.attrsOf`
// resolves a row for it (D-336) -- end_crystal has none, so a spawned crystal is born with NO
// health fields at all, matching the jar exactly with zero code of this file's own. Its
// `damage()` override (below) is therefore NOT `Cb.hurt` (14j_combat.js's own LivingEntity-
// shaped hit pipeline, invulnerability windows/armor/knockback-resistance — none of which
// exist for a plain `Entity`) -- it is its own one-hit "was this call allowed at all, then
// remove" gate, the SAME shape `ED.EnderDragonPart.damage -> owner.damagePart` already uses
// for a non-LivingEntity hitbox elsewhere in this engine.
(function (NS) {
  'use strict';
  var EC = NS.EndCrystal = { ready: false };

  /** `EndCrystalEntity.EXPLOSION_POWER`-equivalent literal — the jar hardcodes `6.0F` at the
   * one `world.createExplosion` call site inside `damage()` (.decomp, read verbatim), not a
   * named constant there either. */
  EC.EXPLOSION_POWER = 6.0;

  /** `EndCrystalEntity.damage(DamageSource, float)` (.decomp, read verbatim):
   *   isInvulnerableTo($$0)              -> false, no-op
   *   $$0.getAttacker() instanceof EnderDragonEntity -> false, no-op (the dragon that owns a
   *                                          fight cannot destroy its own crystals this way)
   *   else: remove(KILLED); if (!$$0.isExplosive()) world.createExplosion(null, x,y,z, 6.0F,
   *         DESTROY); crystalDestroyed($$0); return true
   *
   * `source` here is this engine's lightweight damage-source bag, the SAME `{attacker,
   * explosive}` shape `ED.EnderDragonEntity.prototype.crystalDestroyed` (07zzl_enderdragon.js)
   * already reads (`source.attacker`) — not `14d_survival.js`'s player-facing `Sv.DAMAGE`
   * string-keyed table, since a plain `Entity` (not the player, not a LivingEntity mob) has no
   * armor/enchantment pipeline to key into.
   *
   * `isInvulnerableTo` (.decomp Entity.java:2248, read verbatim) is `this.invulnerable &&
   * source !== OUT_OF_WORLD && !source.isSourceCreativePlayer()` — `this.invulnerable` is a
   * generic per-entity flag (`e.invulnerable`) nothing in this engine's own summon/NBT path
   * ever sets true for a plain crystal (Entity-level "Invulnerable" NBT, not modelled by any
   * caller of `EL.spawn('end_crystal', ...)` yet) — carried here so a future caller that DOES
   * set it is honoured rather than ignored, not because any current caller exercises it.
   */
  EC.damage = function (e, source) {
    source = source || {};
    if (!e || e.removed) return false;
    if (e.invulnerable && source.source !== 'outOfWorld' && !source.sourceCreativePlayer) {
      return false;
    }
    if (source.attacker && source.attacker.type === 'ender_dragon') return false;
    var EL = NS.EntityList;
    if (EL && EL.remove) EL.remove(e); else e.removed = true;
    if (!source.explosive && NS.Explosion && NS.Explosion.ready) {
      // `world.createExplosion(null, ...)` — the jar passes a NULL causing entity for the
      // crystal's own chain-reaction blast (not the crystal itself, which is already removed,
      // and not whatever damaged it); `Ex.explode`'s own `source` arg is only read to exclude
      // it from `Ex.damageEntities`' own target list (`e === source`), so `null` here is exact,
      // not a shortcut.
      NS.Explosion.explode(null, e.x, e.y, e.z, EC.EXPLOSION_POWER, true, undefined, true);
    }
    EC.crystalDestroyed(e, source);
    return true;
  };

  /** `EndCrystalEntity.tick()` (.decomp): age++; with a live EnderDragonFight and AIR in the crystal's own
   * block cell, `setBlockState(pos, AbstractFireBlock.getState(world, pos))` (soul fire over a soul base). */
  EC.tick = function (e) {
    e.endCrystalAge = (e.endCrystalAge | 0) + 1;
    var ED = NS.EnderDragon, W = NS.World, B = NS.Behave;
    if (!(ED && ED.getActiveFight && ED.getActiveFight()) || !W || !B || !B.fireStateAt) return;
    var x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
    if (W.getBlock(x, y, z) !== 0) return;
    W.setBlock(x, y, z, B.fireStateAt(x, y, z, 0));
    if (B.changed) B.changed(x, y, z);
  };

  /** `EndCrystalEntity.crystalDestroyed(DamageSource)` (private, .decomp read verbatim):
   * `if (world instanceof ServerWorld) { fight = ((ServerWorld) world).getEnderDragonFight();
   * if (fight != null) fight.crystalDestroyed(this, source); }` — `ED.getActiveFight()`
   * (07zzl_enderdragon.js) is this engine's own stand-in for `ServerWorld.
   * getEnderDragonFight()` (no multi-dimension World here at all, named on ED.OWED already);
   * a bare crystal with no fight in progress is a real, honest no-op, matching the jar's own
   * null-fight guard exactly rather than inventing one.
   */
  EC.crystalDestroyed = function (e, source) {
    var ED = NS.EnderDragon;
    var fight = ED && ED.getActiveFight && ED.getActiveFight();
    if (fight && fight.crystalDestroyed) fight.crystalDestroyed(e, source || {});
  };

  /** `EndCrystalItem.useOnBlock` (.decomp, read whole): obsidian or bedrock only, the cell above must be
   * air, no entity may intersect the 1x2 box over it; spawns at (x+.5, y+1, z+.5) with ShowBottom false,
   * then probes the fight's respawnDragon() (a null fight is a no-op). Returns true when placed; the
   * caller spends the item. */
  EC.useOnBlock = function (x, y, z) {
    var W = NS.World, S = NS.States, EL = NS.EntityList;
    if (!W || !S || !EL) return false;
    var nm = S.nameOf ? S.nameOf(W.getBlock(x, y, z)) : null;
    if (nm === null && S.block && NS.Reg) { var bid = S.block[W.getBlock(x, y, z)]; nm = bid === NS.Reg.id.obsidian ? 'obsidian' : bid === NS.Reg.id.bedrock ? 'bedrock' : ''; }
    if (nm !== 'obsidian' && nm !== 'bedrock') return false;
    if (W.getBlock(x, y + 1, z) !== 0) return false;
    var cx = x + 0.5, cz = z + 0.5, list = EL.list || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || o.removed) continue;
      var hw = (o.width || 0) / 2, h = o.height || 0;
      if (o.x + hw > x && o.x - hw < x + 1 && o.z + hw > z && o.z - hw < z + 1 && o.y + h > y + 1 && o.y < y + 3) return false;
    }
    var c = EL.spawn('end_crystal', cx, y + 1, cz, {});
    if (!c) return false;
    c.showBottom = false;
    var f = NS.EnderDragon && NS.EnderDragon.getActiveFight && NS.EnderDragon.getActiveFight();
    if (f && f.respawnDragon) f.respawnDragon();
    return true;
  };

  /** `EndCrystalEntity.kill()` (.decomp, read verbatim): `crystalDestroyed(DamageSource.
   * GENERIC); super.kill();` — the `/kill`-style forced removal, which (unlike `damage()`)
   * never rolls a chain-reaction explosion at all (`super.kill()` is a bare removal, no
   * `world.createExplosion` call on this path in the jar). Not yet wired to this engine's own
   * `/kill` command (15g_commands.js is not one of this unit's files) — exposed so that wiring
   * is a one-line call once it lands, not invented here.
   */
  EC.kill = function (e) {
    EC.crystalDestroyed(e, {});
    var EL = NS.EntityList;
    if (EL && EL.remove) EL.remove(e); else e.removed = true;
  };

  EC.OWED = [
    'setBeamTarget/getBeamTarget/shouldShowBottom (e.beamTarget/e.showBottom, ' +
      'EL.DEFAULTS.end_crystal) are real DATA fields with no reader yet — this engine\'s ' +
      'render substrate (src/07j_entityrender.js) has no beam-primitive at all (no per-frame ' +
      'quad strip aimed at a moving target the way vanilla\'s BeamRenderer draws), so the ' +
      'crystal model itself AND its optional beam-to-target visual are both unbuilt — named, ' +
      'not silently skipped: EndCrystalEntityRenderer\'s crystal-model half needs the same ' +
      'kind of per-type render-kind dispatch ender_dragon already has (07j_entityrender.js\'s ' +
      '`kind` detection), and its beam half needs a render primitive this engine does not yet ' +
      'have a slot for.',
    'CLOSED (D-835) -- a player melee hit (Cb.attack) and an arrow impact (Cb.tickArrow) ' +
      'both now reach EC.damage: 14j_combat.js\'s own Cb.hurt intercepts e.type===\'end_crystal\' ' +
      'before its LivingEntity canAttack/health pipeline and calls EC.damage(e, {attacker, ' +
      'source, explosive}) directly, Cb.canAttack treats a live crystal as a valid melee/pick/ ' +
      'sweep target (it has no health to gate on, D-336), and Cb.arrowStrikeEntity\'s own ' +
      'target gather no longer skips it on the bare maxHealth-undefined test -- endcrystalcheck ' +
      '(tools/endcrystalcheck.mjs) section 7 drives both paths end to end through a real ' +
      'EnderDragonFight phase switch.',
    'EnderDragonFight.respawnDragon()\'s own opts.crystalsNear gather (the 4 real crystals ' +
      'placed near the exit portal that trigger a respawn) and the true natural first spawn ' +
      'stay unbuilt -- ED.OWED, unchanged by this pass, deliberately not attempted here.',
    'the ring\'s own per-slot `alive` bookkeeping (ED.buildCrystalRing\'s 10 ' +
      '{x,z,radius,height,guarded,alive} rows, ED.EnderDragonFight.prototype.' +
      'getAliveEndCrystals) is NOT reconciled with real live end_crystal entities -- a real ' +
      'crystal spawned at one of those 10 positions is a SEPARATE object from its ring row, ' +
      'so destroying it does not flip that row\'s own `alive` flag (`this.crystals.indexOf` ' +
      'in ED.EnderDragonFight.prototype.crystalDestroyed finds nothing for a real entity, a ' +
      'no-op it already tolerates); getAliveEndCrystals() keeps answering off the ring\'s own ' +
      'synthetic bookkeeping, not a real entity count. Reconciling the two is a separate, ' +
      'larger item, not invented here.'
  ];

  EC.init = function () {
    EC.ready = !!(NS.EntityList && NS.EnderDragon);
  };
  EC.init();
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
