// #8300 (G17-CB1) -- CommandBlock (impulse) : neighborUpdate / scheduledTick / execute + CommandBlockExecutor.
// .decomp net/minecraft/block/CommandBlock.java, block/entity/CommandBlockBlockEntity.java. Repeating (#8301) done; chain owed.
(function (NS) {
  'use strict';
  var Cb = NS.CmdBlock = NS.CmdBlock || {};
  var FACING = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
  var YAW = { south: 0, west: 90, north: 180, east: 270, up: 0, down: 0 };
  Cb.runs = 0;
  function nm(st) { return NS.Reg.names[NS.States.block[st]]; }
  function isImpulse(st) { if (st <= 0) return false; var n = nm(st); return n === 'command_block' || n === 'repeating_command_block'; }
  function be(x, y, z) { var Be = NS.BlockEntities; return (Be && Be.ready) ? Be.get(x, y, z) : null; }
  function prop(st, p) { return NS.Behave.propName(st, p); }
  function conditional(st) { return prop(st, 'conditional') === 'true'; }
  /** CommandBlockBlockEntity.updateConditionMet */
  function updateConditionMet(x, y, z, st, e) {
    e.conditionMet = true;
    if (!conditional(st)) return true;
    var d = FACING[prop(st, 'facing')] || FACING.north;
    var px = x - d[0], py = y - d[1], pz = z - d[2], w = NS.World, ps = w.getBlock(px, py, pz);
    var n = ps > 0 ? nm(ps) : '';
    if (n === 'command_block' || n === 'chain_command_block' || n === 'repeating_command_block') {
      var pe = be(px, py, pz);
      e.conditionMet = !!pe && (pe.successCount | 0) > 0;
    } else e.conditionMet = false;
    return e.conditionMet;
  }
  /** CommandBlockExecutor.execute: source = level 2 at the block centre, facing rotation, name '@'. */
  Cb.executeCommand = function (e, x, y, z, st) {
    var C = NS.Commands, now = (NS.Main && NS.Main.ticks) | 0;
    e.successCount = 0;
    if (!e.command || !C) return false;
    e.lastOutput = null;
    var r = C.run(e.command, null, { level: 2, name: e.cmdName || '@', displayName: e.customName || '@',
      x: x + 0.5, y: y + 0.5, z: z + 0.5, yaw: YAW[prop(st, 'facing')] || 0, pitch: 0, entity: null });
    Cb.runs++;
    if (r.ok && (r.result === undefined || r.result > 0)) e.successCount = 1;
    if (e.trackOutput && r.lines && r.lines.length && C.ruleGet('sendCommandFeedback') !== 'false')
      e.lastOutput = JSON.stringify({ text: '[' + new Date().toTimeString().slice(0, 8) + '] ' + r.lines[r.lines.length - 1] });
    // CommandBlockBlockEntity's executor: shouldBroadcastConsoleToOps = GameRules commandBlockOutput -> feedback also reaches the ops' chat
    if (r.lines && r.lines.length && C.ruleGet('commandBlockOutput') !== 'false' && NS.Chat && NS.Chat.add)
      for (var i = 0; i < r.lines.length; i++) NS.Chat.add('[' + (e.cmdName || '@') + ': ' + r.lines[i] + ']');
    e.lastExecution = now;
    return true;
  };
  /** CommandBlock.neighborUpdate: re-polled around whatever changed (Rs.settle), like Rs.updateTnt. */
  Cb.update = function (x, y, z) {
    var Rs = NS.Redstone, w = NS.World;
    if (!Rs || !Rs.ready || !w) return 0;
    var n = 0;
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) {
      var cx = x + dx, cy = y + dy, cz = z + dz, st = w.getBlock(cx, cy, cz);
      var chain = st > 0 && nm(st) === 'chain_command_block';
      if (!isImpulse(st) && !chain) continue;
      var e = be(cx, cy, cz);
      if (!e) continue;
      var on = Rs.receivedPower(cx, cy, cz) > 0, was = !!e.powered;
      e.powered = on;
      if (chain) continue;
      if (!was && !e.auto && on) { updateConditionMet(cx, cy, cz, st, e); NS.Behave.schedule(cx, cy, cz, 1); n++; }
    }
    return n;
  };
  /** CommandBlock.scheduledTick, impulse branch. Returns true when this was a command block's tick. */
  Cb.tick = function (x, y, z) {
    var st = NS.World.getBlock(x, y, z);
    if (!isImpulse(st)) return false;
    var e = be(x, y, z);
    if (!e) return true;
    if (e.auto) updateConditionMet(x, y, z, st, e);   // isConditionMet re-evaluated for auto blocks
    if (e.conditionMet) { Cb.executeCommand(e, x, y, z, st); Cb.executeChain(x, y, z, prop(st, 'facing')); }
    else if (conditional(st)) e.successCount = 0;
    // REPEATING reschedules itself every tick while powered or auto (chain type is not an isImpulse block)
    if (nm(st) === 'repeating_command_block' && (e.powered || e.auto)) NS.Behave.schedule(x, y, z, 1);
    return true;
  };
  Cb.chainLimit = function () {
    var C = NS.Commands, v = C && C.ruleGet ? parseInt(C.ruleGet('maxCommandChainLength'), 10) : NaN;
    return v === v ? v : 65536;
  };
  /** CommandBlock.executeCommandChain: walk the facing line through chain command blocks. */
  Cb.executeChain = function (x, y, z, facing) {
    var w = NS.World, left = Cb.chainLimit(), cx = x, cy = y, cz = z;
    while (left-- > 0) {
      var d = FACING[facing] || FACING.north;
      cx += d[0]; cy += d[1]; cz += d[2];
      var st = w.getBlock(cx, cy, cz);
      if (!(st > 0 && nm(st) === 'chain_command_block')) break;
      var e = be(cx, cy, cz);
      if (!e) break;
      if (e.powered || e.auto) {
        if (updateConditionMet(cx, cy, cz, st, e)) { if (!Cb.executeCommand(e, cx, cy, cz, st)) break; }
        else if (conditional(st)) e.successCount = 0;
      }
      facing = prop(st, 'facing');
    }
    if (left <= 0 && typeof console !== 'undefined') console.warn('Command Block chain tried to execute more than ' + Math.max(Cb.chainLimit(), 0) + ' steps!');
  };
  /** CommandBlock.getComparatorOutput: the executor's successCount, 0 with no block entity. */
  Cb.comparator = function (x, y, z) { var e = be(x, y, z); return e ? (e.successCount | 0) : 0; };
  Cb.ready = true;
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
