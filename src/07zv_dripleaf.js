// 07zv_dripleaf.js — #8684: BigDripleafBlock's tilt machinery (1.18.2), its own module (07b_behaviour.js is hot-file capped).
// .decomp/net/minecraft/block/BigDripleafBlock.java: NEXT_TILT_DELAYS UNSTABLE 10, PARTIAL 10, FULL 100 (NONE none);
// onProjectileHit -> changeTilt(FULL, tilt_down); onEntityCollision (server, NONE, onGround, y > pos.y + 0.6875f,
// not powered) -> changeTilt(UNSTABLE, no sound); scheduledTick (powered -> reset; UNSTABLE->PARTIAL, PARTIAL->FULL,
// both tilt_down; FULL->reset); neighborUpdate (powered -> reset); reset plays tilt_up only if the tilt was not NONE.
(function (NS) {
  'use strict';

  var Dl = NS.Dripleaf = { ready: false };
  var NAMES = ['none', 'unstable', 'partial', 'full'];
  Dl.DELAY = { none: -1, unstable: 10, partial: 10, full: 100 };
  Dl.TILT_DOWN = 'block.big_dripleaf.tilt_down';
  Dl.TILT_UP = 'block.big_dripleaf.tilt_up';
  Dl.ABOVE = Math.fround(0.6875);

  function stateAt(x, y, z) {
    var W = NS.World, S = NS.States;
    if (!W || !S) return 0;
    var st = W.getBlock(x, y, z);
    return st && S.name(st) === 'big_dripleaf' ? st : 0;
  }
  Dl.tilt = function (x, y, z) {
    var st = stateAt(x, y, z);
    return st ? NS.Reg.valueNames[NS.States.propValue(st, NS.Reg.PROP.tilt)] : null;
  };
  Dl.powered = function (x, y, z) {
    var Rs = NS.Redstone;
    return !!(Rs && Rs.receivedPower && Rs.receivedPower(x, y, z) > 0);
  };
  function sound(x, y, z, name) {
    var Snd = NS.Sound;
    if (Snd && Snd.play) Snd.play(name, { x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: 1, pitch: 0.8 + Math.random() * 0.4 });
  }
  function setTilt(st, x, y, z, tilt) {
    var R = NS.Reg;
    NS.World.setBlock(x, y, z, NS.States.withProp(st, R.PROP.tilt, R.PVAL[tilt]));
  }
  /** changeTilt(state, world, pos, tilt, sound): set, optional sound, schedule the next step. Returns true if a leaf was there. */
  Dl.changeTilt = function (x, y, z, tilt, snd) {
    var st = stateAt(x, y, z);
    if (!st) return false;
    setTilt(st, x, y, z, tilt);
    if (snd) sound(x, y, z, snd);
    var d = Dl.DELAY[tilt];
    if (d !== -1 && NS.Behave && NS.Behave.schedule) NS.Behave.schedule(x, y, z, d);
    return true;
  };
  Dl.resetTilt = function (x, y, z) {
    var st = stateAt(x, y, z);
    if (!st) return false;
    var was = Dl.tilt(x, y, z);
    setTilt(st, x, y, z, 'none');
    if (was !== 'none') sound(x, y, z, Dl.TILT_UP);
    return true;
  };
  /** onProjectileHit: straight to FULL with the tilt sound (Cb.PROJ_BLOCK_HIT.big_dripleaf, #8667). */
  Dl.onProjectileHit = function (x, y, z) { return Dl.changeTilt(x, y, z, 'full', Dl.TILT_DOWN); };
  Dl.onEntityCollision = function (x, y, z, e) {
    if (Dl.tilt(x, y, z) !== 'none') return false;
    if (!(e && e.onGround && e.y > Math.fround(y + Dl.ABOVE)) || Dl.powered(x, y, z)) return false;
    return Dl.changeTilt(x, y, z, 'unstable', null);
  };
  Dl.neighborUpdate = function (x, y, z) {
    if (!stateAt(x, y, z) || !Dl.powered(x, y, z)) return false;
    return Dl.resetTilt(x, y, z);
  };
  /** Claims the tick only on a big_dripleaf. */
  Dl.scheduledTick = function (x, y, z) {
    if (!stateAt(x, y, z)) return false;
    if (Dl.powered(x, y, z)) return Dl.resetTilt(x, y, z);
    var t = Dl.tilt(x, y, z);
    if (t === 'unstable') Dl.changeTilt(x, y, z, 'partial', Dl.TILT_DOWN);
    else if (t === 'partial') Dl.changeTilt(x, y, z, 'full', Dl.TILT_DOWN);
    else if (t === 'full') Dl.resetTilt(x, y, z);
    return true;
  };
  Dl.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
