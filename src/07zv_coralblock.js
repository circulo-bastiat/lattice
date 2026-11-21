// 07zv_coralblock.js — net/minecraft/block/CoralBlock (+ CoralParentBlock.checkLivingConditions / isInWater):
// a live coral plant out of water dies. Read from .decomp/net/minecraft/block/CoralBlock.java and CoralParentBlock.java.
//   onBlockAdded / getStateForNeighborUpdate -> checkLivingConditions: not in water => scheduleTick(60 + rand(40))
//   scheduledTick: still not in water => the dead plant, WATERLOGGED=false (flag 2)
//   isInWater: waterlogged, or any of the 6 neighbours holds a water fluid state
// Hooked from Behave.changedInner (every placement/break/neighbour change) and Behave.scheduledTick.
// (CoralFan / CoralWallFan / CoralBlockBlock are separate vanilla classes, not handled here.)
(function (NS) {
  'use strict';
  var C = NS.CoralBlock = { ready: false };
  var FAMS = ['tube', 'brain', 'bubble', 'fire', 'horn'];
  var DX = [0, 0, -1, 1, 0, 0], DY = [0, 0, 0, 0, 1, -1], DZ = [-1, 1, 0, 0, 0, 0];
  var live = null, dead = null, fluidBlk = null;

  function init() {
    var R = NS.Reg, S = NS.States;
    live = Object.create(null); dead = Object.create(null); fluidBlk = Object.create(null);
    for (var j = 0; j < FAMS.length; j++) {
      var lb = R.id[FAMS[j] + '_coral'], db = R.id['dead_' + FAMS[j] + '_coral'];
      if (lb === undefined || db === undefined) continue;
      // dead plant, not waterlogged: local state 1 of 2 (waterlogged is [true, false])
      live[lb] = R.realFirst[db + 1] - R.realFirst[db] === 2 ? S.withLocal('dead_' + FAMS[j] + '_coral', 1) : S.stateOf('dead_' + FAMS[j] + '_coral');
    }
    var wn = ['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'];
    for (var n = 0; n < wn.length; n++) if (R.id[wn[n]] !== undefined) fluidBlk[R.id[wn[n]]] = 1;
    C.ready = true;
  }
  function deadOf(st) { if (!live) init(); return live[NS.States.block[st]]; }
  C.isCoral = function (st) { return st !== 0 && deadOf(st) !== undefined; };

  function wet(st) {
    if (st === 0) return false;
    if (fluidBlk[NS.States.block[st]] === 1) return true;
    return NS.Behave.propName(st, 'waterlogged') === 'true';
  }
  /** CoralParentBlock.isInWater */
  C.isInWater = function (x, y, z, st) {
    if (!live) init();
    if (NS.Behave.propName(st, 'waterlogged') === 'true') return true;
    for (var d = 0; d < 6; d++) if (wet(NS.World.getBlock(x + DX[d], y + DY[d], z + DZ[d]))) return true;
    return false;
  };
  function check(x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    if (st === 0 || !C.isCoral(st)) return;
    if (!C.isInWater(x, y, z, st)) NS.Behave.schedule(x, y, z, 60 + Math.floor((NS.Behave.rng ? NS.Behave.rng() : Math.random()) * 40));
  }
  /** a cell changed: onBlockAdded for itself, getStateForNeighborUpdate for its six neighbours */
  C.changed = function (x, y, z) {
    if (!NS.Behave || !NS.World) return;
    check(x, y, z);
    for (var d = 0; d < 6; d++) check(x + DX[d], y + DY[d], z + DZ[d]);
  };
  /** CoralBlock.scheduledTick; true when the cell was a coral plant (tick consumed) */
  C.scheduledTick = function (x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    if (st === 0 || !C.isCoral(st)) return false;
    if (!C.isInWater(x, y, z, st)) NS.World.setBlock(x, y, z, deadOf(st));
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
