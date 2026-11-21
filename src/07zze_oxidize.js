// src/07zze_oxidize.js — s128 (G20, the lightning rod's copper ring): `Oxidizable` + `Degradable`,
// the copper-weathering substrate this engine did not have (no copper block ever aged).
//
// Off .decomp, read whole: net/minecraft/block/Oxidizable.java (the OXIDATION_LEVEL_INCREASES
// BiMap, getDecreased/getUnaffected/getDegradationResult, the 0.75 chance multiplier at the
// UNAFFECTED level), Degradable.java (tickDegradation's 0.05688889 roll and tryDegrade's
// Manhattan-4 neighbour census), OxidizableBlock/OxidizableSlabBlock/OxidizableStairsBlock
// (randomTick -> tickDegradation; hasRandomTicks only while an increase exists, so the OXIDIZED
// tier never ticks), and LightningEntity.cleanOxidation/cleanOxidationAround (:191-237) — the
// strike that scrubs copper back to bare. Blocks.java:3203-3275 pins each field_* to its name
// and OxidationLevel (UNAFFECTED/EXPOSED/WEATHERED/OXIDIZED = ordinal 0..3). WAXED copper is a
// plain Block/Slab/Stairs in Blocks.java — not Oxidizable, so it never appears here.
(function (NS) {
  'use strict';
  var Ox = NS.Oxidize = { ready: false };

  // Oxidizable.OXIDATION_LEVEL_INCREASES, in its own put() order (field names resolved through
  // Blocks.java's register(...) lines).
  Ox.INCREASES = [
    ['copper_block', 'exposed_copper'], ['exposed_copper', 'weathered_copper'], ['weathered_copper', 'oxidized_copper'],
    ['cut_copper', 'exposed_cut_copper'], ['exposed_cut_copper', 'weathered_cut_copper'], ['weathered_cut_copper', 'oxidized_cut_copper'],
    ['cut_copper_slab', 'exposed_cut_copper_slab'], ['exposed_cut_copper_slab', 'weathered_cut_copper_slab'],
    ['weathered_cut_copper_slab', 'oxidized_cut_copper_slab'],
    ['cut_copper_stairs', 'exposed_cut_copper_stairs'], ['exposed_cut_copper_stairs', 'weathered_cut_copper_stairs'],
    ['weathered_cut_copper_stairs', 'oxidized_cut_copper_stairs']
  ];
  Ox.TICK_CHANCE = 0.05688889;   // Degradable.tickDegradation
  Ox.RANGE = 4;                  // Degradable.field_31056 / tryDegrade's iterateOutwards(4,4,4) + `> 4` break
  Ox.UNAFFECTED_MULT = 0.75;     // Oxidizable.getDegradationChanceMultiplier at UNAFFECTED

  var up = null, down = null, level = null;   // block id -> block id / ordinal

  Ox.init = function () {
    var R = NS.Reg;
    if (!R || !R.ready) return Ox;
    up = Object.create(null); down = Object.create(null); level = Object.create(null);
    for (var i = 0; i < Ox.INCREASES.length; i++) {
      var a = R.id[Ox.INCREASES[i][0]], b = R.id[Ox.INCREASES[i][1]];
      if (a === undefined || b === undefined) continue;
      up[a] = b; down[b] = a;
    }
    // the ordinal: 0 for a block with nothing below it, +1 per step up the chain
    for (var k in up) {
      if (down[k] !== undefined) continue;
      var n = 0, c = +k;
      while (c !== undefined) { level[c] = n++; c = up[c]; }
    }
    Ox.ready = true;
    return Ox;
  };
  function ensure() { if (!Ox.ready) Ox.init(); return Ox.ready; }

  function blockOf(st) { return NS.States.block[st]; }
  /** Is this state's block Oxidizable (any of the four tiers, unwaxed)? */
  Ox.isOxidizable = function (st) { return !!st && ensure() && level[blockOf(st)] !== undefined; };
  /** The OxidationLevel ordinal, or -1. */
  Ox.levelOf = function (st) { if (!st || !ensure()) return -1; var l = level[blockOf(st)]; return l === undefined ? -1 : l; };

  /** `Block.getStateWithProperties(from)`: every property the two share copied across. Each
   *  family's four tiers are the SAME class with the same properties in the same declaration
   *  order, so the local state index carries over unchanged. */
  Ox.withBlock = function (st, toBlock) {
    var R = NS.Reg, from = blockOf(st);
    var local = st - R.realFirst[from];
    var n = R.realFirst[toBlock + 1] - R.realFirst[toBlock];
    return local < n ? R.realFirst[toBlock] + local : R.realFirst[toBlock] + R.defaultState[toBlock];
  };
  Ox.increased = function (st) { if (!ensure()) return null; var b = up[blockOf(st)]; return b === undefined ? null : Ox.withBlock(st, b); };
  Ox.decreased = function (st) { if (!ensure()) return null; var b = down[blockOf(st)]; return b === undefined ? null : Ox.withBlock(st, b); };
  /** `Oxidizable.getUnaffectedOxidationState`: all the way down the chain. */
  Ox.unaffected = function (st) {
    if (!ensure()) return st;
    var b = blockOf(st), c = b;
    while (down[c] !== undefined) c = down[c];
    return c === b ? st : Ox.withBlock(st, c);
  };

  function setAndNotify(x, y, z, st) {
    var W = NS.World, B = NS.Behave;
    W.setBlock(x, y, z, st);
    if (B && B.changed) B.changed(x, y, z);
  }

  /** `Degradable.tryDegrade`: any Oxidizable within Manhattan 4 at a LOWER level vetoes; else
   *  chance = ((higher+1)/(higher+same+1))^2 * multiplier, and the block steps up one tier. */
  Ox.tryDegrade = function (x, y, z, st, rnd) {
    var W = NS.World, me = Ox.levelOf(st), same = 0, higher = 0, R4 = Ox.RANGE;
    for (var dx = -R4; dx <= R4; dx++) {
      var ax = Math.abs(dx);
      for (var dy = -(R4 - ax); dy <= R4 - ax; dy++) {
        var rz = R4 - ax - Math.abs(dy);
        for (var dz = -rz; dz <= rz; dz++) {
          if (!dx && !dy && !dz) continue;
          var l = Ox.levelOf(W.getBlock(x + dx, y + dy, z + dz));
          if (l < 0) continue;
          if (l < me) return false;
          if (l > me) higher++; else same++;
        }
      }
    }
    var f = (higher + 1) / (higher + same + 1);
    var chance = f * f * (me === 0 ? Ox.UNAFFECTED_MULT : 1);
    if (rnd() < chance) {
      var nx = Ox.increased(st);
      if (nx !== null) { setAndNotify(x, y, z, nx); return true; }
    }
    return false;
  };

  /** `OxidizableBlock.randomTick` -> `tickDegradation`. `hasRandomTicks` is false at OXIDIZED
   *  (no increase), so that tier is never asked. Registered through `Behave`'s rule table. */
  Ox.randomTick = function (x, y, z, st, rnd) {
    if (Ox.increased(st) === null) return false;
    if (rnd() < Ox.TICK_CHANCE) return Ox.tryDegrade(x, y, z, st, rnd);
    return false;
  };
  /** Every block that randomly ticks (the three lower tiers of each family). */
  Ox.tickingBlocks = function () {
    if (!ensure()) return [];
    return Object.keys(up).map(Number);
  };

  /** `LightningEntity.cleanOxidation(world, pos)`: at the struck block — or, when it is a rod,
   *  the block the rod is fixed to — an Oxidizable is set straight back to UNAFFECTED, then
   *  3..5 random walks of 1..8 steps each scrub one tier off whatever they land on. */
  Ox.cleanOxidation = function (x, y, z, rnd) {
    if (!ensure()) return 0;
    var W = NS.World, Lgt = NS.Lightning;
    var st = W.getBlock(x, y, z), tx = x, ty = y, tz = z, tst = st;
    if (Lgt && Lgt.isRod && Lgt.isRod(st)) {
      var o = Lgt.rodBack(st);
      tx = x + o[0]; ty = y + o[1]; tz = z + o[2];
      tst = W.getBlock(tx, ty, tz);
    }
    if (!Ox.isOxidizable(tst)) return 0;
    setAndNotify(tx, ty, tz, Ox.unaffected(W.getBlock(tx, ty, tz)));
    var cleaned = 1;
    var walks = Math.floor(rnd() * 3) + 3;
    for (var i = 0; i < walks; i++) {
      var steps = Math.floor(rnd() * 8) + 1;
      // cleanOxidationAround(world, pos, mutable, steps): the mutable restarts at the TARGET
      // (`$$2.set($$1)` where $$1 is the de-rodded position) each walk.
      var cx = tx, cy = ty, cz = tz;
      for (var s = 0; s < steps; s++) {
        var next = aroundOnce(cx, cy, cz, rnd);
        if (!next) break;
        cleaned++;
        cx = next.x; cy = next.y; cz = next.z;
      }
    }
    return cleaned;
  };
  /** The inner `cleanOxidationAround(world, pos)`: `BlockPos.iterateRandomly(random, 10, pos, 1)`
   *  — ten uniform draws in the 3x3x3 cube (the centre included) — and the FIRST Oxidizable found
   *  is scrubbed one tier (`getDecreasedOxidationState`, a no-op at UNAFFECTED) and becomes the
   *  walk's next position. */
  function aroundOnce(x, y, z, rnd) {
    var W = NS.World;
    for (var i = 0; i < 10; i++) {
      var px = x - 1 + Math.floor(rnd() * 3), py = y - 1 + Math.floor(rnd() * 3), pz = z - 1 + Math.floor(rnd() * 3);
      var st = W.getBlock(px, py, pz);
      if (!Ox.isOxidizable(st)) continue;
      var d = Ox.decreased(st);
      if (d !== null) setAndNotify(px, py, pz, d);
      // syncWorldEvent(3002, pos, -1) — fired even when the block was already UNAFFECTED (D-664)
      if (NS.Particle && NS.Particle.worldEvent) NS.Particle.worldEvent(3002, px, py, pz, -1);
      return { x: px, y: py, z: pz };
    }
    return null;
  }
  Ox.aroundOnce = aroundOnce;

  // ── HoneycombItem.UNWAXED_TO_WAXED_BLOCKS (s128) ──────────────────────────────────────────
  // Its 16 put() pairs are every Oxidizable block to `waxed_<name>` (Blocks.java: field_27133
  // waxed_copper_block ... field_33410 waxed_oxidized_cut_copper_slab) -- resolved through the
  // registry by that name; rodcheck asserts all sixteen exist, so a missing one fails there.
  var waxOn = null, waxOff = null;
  function buildWax() {
    var R = NS.Reg;
    waxOn = Object.create(null); waxOff = Object.create(null);
    var names = Object.create(null);
    for (var i = 0; i < Ox.INCREASES.length; i++) { names[Ox.INCREASES[i][0]] = 1; names[Ox.INCREASES[i][1]] = 1; }
    for (var n in names) {
      var a = R.id[n], b = R.id['waxed_' + n];
      if (a === undefined || b === undefined) continue;
      waxOn[a] = b; waxOff[b] = a;
    }
  }
  Ox.waxPairs = function () { if (!waxOn) buildWax(); return Object.keys(waxOn).length; };
  /** `HoneycombItem.getWaxedState`, or null. */
  Ox.waxed = function (st) { if (!st || !ensure()) return null; if (!waxOn) buildWax(); var b = waxOn[blockOf(st)]; return b === undefined ? null : Ox.withBlock(st, b); };
  /** `WAXED_TO_UNWAXED_BLOCKS` (AxeItem's third branch), or null. */
  Ox.unwaxed = function (st) { if (!st || !ensure()) return null; if (!waxOn) buildWax(); var b = waxOff[blockOf(st)]; return b === undefined ? null : Ox.withBlock(st, b); };

  Ox.OWED = [
    // s128 struck 'AxeItem scraping / wax-off, HoneycombItem waxing': Use.useOn (14l_use.js).
    // D-664 struck the 3003/3004/3005 wax/scrape particles (Use.useOn -> Px.worldEvent) and the
    // 3002 sparks cleanOxidationAround shows on each block it lands on (aroundOnce, above).
  ];
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
