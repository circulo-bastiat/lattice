// 14e_gamemode.js — PLAN G6. Survival, creative, adventure and spectator.
//
// ⚠ THIS FILE REPLACES A BOOLEAN, AND THE BOOLEAN IS GONE (D-139). `Player.creative` used to
// mean three unrelated things at once — break instantly, may fly, take no damage — which is why
// spectator and adventure could not exist: there was nowhere to say "may fly but may not build".
// Vanilla keeps them apart in `Abilities`, and `GameType.updatePlayerAbilities` is the function
// that fills it. That function is ported here out of the 1.18.2 bytecode (D-253), field for
// field, and every `P.creative` in the engine now reads whichever ABILITY it actually meant.

(function (NS) {
  'use strict';

  var Gm = NS.Gamemode = {
    SURVIVAL: 0, CREATIVE: 1, ADVENTURE: 2, SPECTATOR: 3,
    NAMES: ['survival', 'creative', 'adventure', 'spectator'],

    // ⚠ HAND-SOURCED, and it is the one number in this file that is: block reach is decided
    // CLIENT-side (`MultiPlayerGameMode.getPickRange`), and this project reflects the SERVER jar.
    // 5.0 in creative and 4.5 otherwise; entity reach is 3.0 and belongs to G17.
    REACH_CREATIVE: 5.0,
    REACH_SURVIVAL: 4.5,

    /**
     * `GameType.updatePlayerAbilities(Abilities)`, exactly:
     *   CREATIVE   -> mayFly, instabuild, invulnerable
     *   SPECTATOR  -> mayFly, invulnerable, flying; instabuild false
     *   otherwise  -> all four false
     *   and then   mayBuild = !isBlockPlacingRestricted()  (restricted: adventure and spectator)
     */
    abilities: function (mode) {
      var a = { invulnerable: false, flying: false, mayFly: false, instabuild: false, mayBuild: true };
      if (mode === Gm.CREATIVE) {
        a.mayFly = true; a.instabuild = true; a.invulnerable = true;
      } else if (mode === Gm.SPECTATOR) {
        a.mayFly = true; a.instabuild = false; a.invulnerable = true; a.flying = true;
      }
      a.mayBuild = !Gm.blockPlacingRestricted(mode);
      return a;
    },

    /** `GameType.isBlockPlacingRestricted` — adventure and spectator. */
    blockPlacingRestricted: function (mode) { return mode === Gm.ADVENTURE || mode === Gm.SPECTATOR; },

    /**
     * May this mode ATTACK an entity? (D-338)
     *
     * ⚠ IT IS NOT `mayBuild`, AND THE DIFFERENCE IS ADVENTURE MODE. Vanilla restricts BLOCK
     * placing in adventure and spectator, but an adventure-mode player can still hit a mob —
     * `Player.attack` is gated on `isSpectator()` alone. Reusing `mayBuild` here would have been
     * one word shorter and would have made adventure maps unplayable.
     */
    mayAttack: function (mode) { return mode !== Gm.SPECTATOR; },

    isCreative: function (e) { return e.mode === Gm.CREATIVE; },
    isSpectator: function (e) { return e.mode === Gm.SPECTATOR; },
    isSurvival: function (e) { return e.mode === Gm.SURVIVAL; },
    name: function (mode) { return Gm.NAMES[mode] || 'survival'; },
    byName: function (n) { var i = Gm.NAMES.indexOf(String(n)); return i < 0 ? Gm.SURVIVAL : i; },

    reach: function (e) { return Gm.isCreative(e) ? Gm.REACH_CREATIVE : Gm.REACH_SURVIVAL; },

    /**
     * set(e, mode) — switch an entity's gamemode and apply the abilities.
     *
     * ⚠ LEAVING A MODE HAS TO UNDO IT. Vanilla's `Player.onUpdateAbilities` drops you out of
     * flight when `mayFly` goes false, and a spectator who becomes a survivor must stop passing
     * through the world in the same tick — otherwise the first thing the new survival player does
     * is fall through the floor they were standing inside.
     */
    set: function (e, mode) {
      var a = Gm.abilities(mode);
      e.mode = mode;
      e.mayFly = a.mayFly;
      e.mayBuild = a.mayBuild;
      e.mayAttack = Gm.mayAttack(mode);
      e.instabuild = a.instabuild;
      e.invulnerableGamemode = a.invulnerable;
      e.noclip = (mode === Gm.SPECTATOR);
      if (!a.mayFly) e.flying = false;
      else if (a.flying) e.flying = true;
      if (mode === Gm.SPECTATOR) {
        e.onGround = false; e.vy = 0;
        // `ServerPlayerEntity.changeGameMode`: SPECTATOR -> dropShoulderEntities() + stopRiding().
        if (NS.Fly && e.shoulderAge !== undefined) { e.shoulderAge = 21; NS.Fly.dropShoulderEntities(e); }
        if (e.vehicle && e.dismountVehicle) e.dismountVehicle();
      }
      // ⚠ and the survival state has to be REAL again when you come back to it: a player who
      // spent an hour in creative has an exhaustion counter frozen at whatever it was.
      if (!a.invulnerable && NS.Survival && e.health === undefined) NS.Survival.init(e);
      e.reach = Gm.reach(e);
      return e;
    },

    /** May this entity break the block it is looking at? */
    mayBreak: function (e) { return e.mayBuild !== false && !Gm.isSpectator(e); },

    /** Does breaking cost time? Creative breaks instantly; every other mode does not. */
    instantBreak: function (e) { return !!e.instabuild; },

    /** Do broken blocks drop anything for this player? Not in creative. */
    dropsFor: function (e) { return !e.instabuild; }
  };
})(MCL);
