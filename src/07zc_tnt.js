// 07zc_tnt.js -- loop/tnt-s96 (QUEUE 0.2 G18c remainder): the PRIMED TNT entity's own
// fuse-tick/explode trigger. Runs on: MAIN THREAD ONLY. No DOM.
//
// Everything ELSE about a live TNT already exists before this unit: `EL.DEFAULTS.tnt`
// (07i_entitylist.js) gives it `TntEntity`'s own spawn velocity/default fuse, `EL.motionFor`
// already carries its jar-measured gravity/drag (the generic non-mob physics path already
// moves/bounces it -- see that file's own header on why TNT takes the SAME path as an item or
// a falling block), and `14l_use.js`'s `Use.primeTnt` already removes a clicked TNT block and
// spawns the entity. What was missing end to end was the fuse actually counting down to a
// real explosion -- this file, plus the two ignition paths named in the unit's own task
// (flint-and-steel-on-a-creeper, and redstone/onBlockAdded priming a TNT BLOCK, both added as
// minimal branches in this session's other owned files rather than here).
//
// .decomp/net/minecraft/entity/TntEntity.java, `tick()`/`explode()`, read whole:
//   tick():
//     if (!hasNoGravity()) velocity.y -= 0.04;             // NOT the generic per-type table --
//                                                           // read live below, see D-note
//     move(velocity); velocity *= 0.98; if (onGround) velocity *= (0.7, -0.5, 0.7);
//     fuse--; if (fuse <= 0) { discard(); if (!client) explode(); }
//   explode(): world.createExplosion(this, x, getBodyY(0.0625), z, 4.0F, DestructionType.BREAK);
//              -- `field_18686`, the MIDDLE of the 3-value enum, not `field_18687` (DESTROY,
//              the default every other exploding entity here passes). `Explosion.affectWorld`
//              (`.decomp/Explosion.java` line ~282) only sets the loot context's
//              `EXPLOSION_RADIUS` param for `DestructionType.DESTROY` — a `BREAK` explosion
//              never sets it, so `survives_explosion`/`explosion_decay` both read it missing
//              and every stack survives whole (cloud unit referee-tnt): a lit TNT drops EVERY
//              block it destroys, at full count, never the `1/power` decay creepers/ghasts get.
//
// ⚠ THE MOTION HALF (gravity/drag/ground-bounce) IS ALREADY LIVE, NOT THIS FILE'S TO ADD.
// `EL.motionFor('tnt')`/`EL.groundFor('tnt')` (07i_entitylist.js, not this unit's file to
// re-edit) already read a jar-measured `[gravity, drag]` pair and ground-bounce law for `tnt`
// out of `19_data.gen.js` -- the SAME generic "no will" physics path an item or falling block
// already takes (that file's own header: "the generic motion below stays exactly as it was for
// everything with no will -- items, falling blocks, TNT, arrows"). Only the FUSE COUNTDOWN and
// the EXPLODE call were ever missing, which is this file's whole job -- the same split
// `07zb_creeper.js` made for the creeper's own fuse (that file owns `Cr.tick`, `EL.tickMob`
// calls it; this file owns `Tnt.tick`, `EL.tick`'s own generic dispatch calls it, one line,
// the same slot `potion`/`evoker_fangs` already occupy -- see that file's own header for why
// TNT is not a mob and does not take the `tickMob` path at all).
//
// ⚠ `getBodyY(0.0625)` is `Entity.getBodyY(f)` = `y + height * f` (.decomp/Entity.java) -- the
// SAME `e.y + e.height * k` shape `07u_leash.js`/`07n_tame.js`/`14j_combat.js` already use for
// their own eye/anchor heights, not a new idiom.
//
// ⚠ TNT's OWN EXPLOSION IS **NOT** GATED ON `mobGriefing`. `CreeperEntity.explode()` reads the
// game rule and picks `NONE` vs `DESTROY` explicitly (07zb_creeper.js's own `Cr.explode`);
// `TntEntity.explode()` has NO game-rule read at all and hardcodes `DestructionType.field_18686`
// (`BREAK`, NOT `DESTROY` -- that mislabel was this file's own referee-tnt bug, see the file-top
// note) unconditionally -- a placed and lit TNT always breaks blocks in vanilla regardless
// of `mobGriefing`, only a MOB's own explosion checks that rule. `Tnt.explode` below therefore
// always passes `griefing = true` to `Ex.explode`, never reading `Commands.ruleGet` at all.

(function (NS) {
  'use strict';

  var Tnt = NS.Tnt = { ready: false };

  Tnt.init = function () {
    Tnt.ready = !!(NS.EntityList && NS.Explosion && NS.Explosion.ready);
    return Tnt;
  };

  Tnt.POWER = 4.0;          // `TntEntity.explode()`'s own literal `float $$0 = 4.0F`
  Tnt.BODY_Y_FRAC = 0.0625; // `getBodyY(0.0625)` -- the explosion's own Y, not the entity's feet

  /** One tick of a live primed TNT's own fuse -- called from `EL.tick`'s generic dispatch
   *  (07i_entitylist.js, one additive line, the same slot `potion`/`evoker_fangs` occupy). */
  Tnt.tick = function (e) {
    if (!Tnt.ready || !e || e.type !== 'tnt' || e.removed) return;
    e.fuse = (e.fuse === undefined ? 80 : e.fuse) - 1;
    if (e.fuse <= 0) {
      e.removed = true;   // `discard()`, BEFORE `explode()` in the jar -- position is unchanged
                           // by that call, so reading e.x/e.y/e.z after it is still correct.
      Tnt.explode(e);
    } else if (NS.Particle && NS.Particle.spawn) {
      NS.Particle.spawn('smoke', e.x, e.y + 0.5, e.z, 0, 0, 0);   // TntEntity.tick client half
    }
  };

  /** `TntEntity.explode()` -- always `DESTROY`, never gated on `mobGriefing` (see file header).
   *  `e.igniter` (TntEntity.causingEntity, set from spawn opts) is the explosion's causing entity (`Ex.causing`); (was
   *  `TntBlock.onDestroyedByExplosion`'s own `Explosion.getCausingEntity()` argument) is not
   *  carried at all -- no live caller of `EL.spawn('tnt', ...)` in this engine passes a shooter
   *  for TNT the way `14l_use.js`'s own arrow `opts.shooter` does, so `Ex.explode`'s own
   *  `source` argument is the TNT ENTITY ITSELF here, matching every other call in this engine
   *  (`Cr.explode` passes the creeper, not a causing player, for the same reason) -- named as
   *  `Tnt.OWED` below, not silently dropped. */
  Tnt.explode = function (e) {
    if (!NS.Explosion || !NS.Explosion.ready) return;
    var y = e.y + (e.height || 0) * Tnt.BODY_Y_FRAC;
    NS.Explosion.explode(e, e.x, y, e.z, Tnt.POWER, true, undefined, false);   // decay=false: BREAK, not DESTROY (see file header)
  };

  Tnt.OWED = [];   // igniter is saved by UUID (#5626)
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
