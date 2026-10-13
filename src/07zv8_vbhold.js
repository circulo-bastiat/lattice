// 07zv8_vbhold.js — G18f-N2: `FindInteractionTargetTask(PLAYER, 4)` + `HoldTradeOffersTask(400, 1600)`
// (.decomp FindInteractionTargetTask.java, HoldTradeOffersTask.java, VillagerTaskListProvider.java:174-175,
// the idle tier's priority-3 entries). Called from `VB.tick` while 'idle', next to NS.VBGather/NS.VBGifts.
//
// Simplifications, named: the VISIBLE_MOBS cache (line of sight) is a plain distance test, and the player's
// hand is the one singleplayer character's `P.heldItem()`. INTERACTION_TARGET is `e.vbInteractionTarget`
// (an entity, absent = unset); LOOK_TARGET reuses `e.vbLookTarget` like NS.VBGifts. The held stack is
// `e.vbMainHand = {i, n}` (absent/null = empty hand).

(function (NS) {
  'use strict';
  var VB = NS.VB;
  if (!VB) return;
  var H = NS.VBHold = NS.VBHold || {};

  H.FIND_RANGE = 4;            // FindInteractionTargetTask(PLAYER, 4): squared 16
  H.HOLD_RANGE_SQ = 17.0;      // HoldTradeOffersTask.shouldRun: squaredDistanceTo <= 17
  H.OFFER_SHOWING_INTERVAL = 40;
  H.RUN_MIN = 400; H.RUN_MAX = 1600;   // Task(minRunTime, maxRunTime)
  H.FIRST_TICKS_LEFT = 40;
  H.MATCH_TICKS_LEFT = 900;            // RUN_INTERVAL

  function dist2(e, p) { var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z; return dx * dx + dy * dy + dz * dz; }
  function alive(o) { return o && !o.dead && !o.removed; }
  function heldOf(player) {
    var st = player && player.heldStack !== undefined ? player.heldStack : (NS.Player && NS.Player.heldItem ? NS.Player.heldItem() : null);
    return st && st.n > 0 ? st : null;
  }
  function holdNothing(e) { e.vbMainHand = null; }
  function holdOffer(e, id, n) { e.vbMainHand = { i: id, n: n }; }

  /** `loadPossibleOffers`: sell stacks of enabled offers whose adjusted first / second buy item is the held item. */
  function loadOffers(e, held) {
    var T = NS.Trade, out = [];
    if (!T || !T.ensure || !T.needGive) return out;
    var offers = T.ensure(e) || [];
    for (var i = 0; i < offers.length; i++) {
      if (T.disabled(e, i)) continue;
      var ng = T.needGive(e, i);
      if (!ng || !ng.give[0]) continue;
      if ((ng.need[0] && ng.need[0].id === held.i) || (ng.need[1] && ng.need[1].id === held.i)) {
        out.push({ id: ng.give[0].id, n: ng.give[0].n });
      }
    }
    return out;
  }

  function stopHold(e) {
    e.vbInteractionTarget = null;
    e.vbLookTarget = null;
    e.vbHoldRun = null;
    holdNothing(e);
  }

  H.tick = function (e, now, tnow, player) {
    if (!VB.ready || e.isBaby) { if (e.vbHoldRun || e.vbInteractionTarget) stopHold(e); return; }
    var run = e.vbHoldRun;
    if (!run) {
      // FindInteractionTargetTask: no INTERACTION_TARGET yet, a player within 4 blocks -> remember it + look at it.
      if (!e.vbInteractionTarget) {
        if (alive(player) && dist2(e, player) <= H.FIND_RANGE * H.FIND_RANGE) e.vbInteractionTarget = player;
        else return;
      }
      var t = e.vbInteractionTarget;
      // HoldTradeOffersTask.shouldRun
      if (!(alive(t) && alive(e) && dist2(e, t) <= H.HOLD_RANGE_SQ)) { e.vbInteractionTarget = null; return; }
      run = e.vbHoldRun = {
        cust: undefined, offers: [], shown: 0, idx: 0, ticksLeft: H.FIRST_TICKS_LEFT, held: null,
        endTick: tnow + H.RUN_MIN + Math.floor(Math.random() * (H.RUN_MAX - H.RUN_MIN + 1))
      };
    }
    // shouldKeepRunning
    var cust = e.vbInteractionTarget;
    if (!(cust && alive(cust) && alive(e) && dist2(e, cust) <= H.HOLD_RANGE_SQ && run.ticksLeft > 0 && tnow < run.endTick)) {
      stopHold(e);
      return;
    }
    // tick: findPotentialCustomer, setupOffers, refreshShownOffer
    e.vbLookTarget = { x: cust.x, y: cust.y, z: cust.z };
    var held = heldOf(cust), same = run.cust !== undefined && ((run.held && held && run.held.i === held.i) || (!run.held && !held));
    if (!same) {
      run.cust = true; run.held = held; run.offers = [];
      if (held) {
        run.offers = loadOffers(e, held);
        if (run.offers.length) { run.ticksLeft = H.MATCH_TICKS_LEFT; run.idx = 0; holdOffer(e, run.offers[0].id, run.offers[0].n); }
      }
    }
    if (run.offers.length) {
      if (run.offers.length >= 2 && ++run.shown >= H.OFFER_SHOWING_INTERVAL) {
        run.shown = 0;
        run.idx = (run.idx + 1) % run.offers.length;
        holdOffer(e, run.offers[run.idx].id, run.offers[run.idx].n);
      }
    } else {
      holdNothing(e);
      run.ticksLeft = Math.min(run.ticksLeft, H.FIRST_TICKS_LEFT);
    }
    run.ticksLeft--;
  };

  H.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
