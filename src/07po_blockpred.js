// 07po_blockpred.js — #11737 (AUDIT-MAP net/minecraft/item/BlockPredicatesChecker). Ports BlockPredicatesChecker.check:
// an item's `CanPlaceOn` / `CanDestroy` NBT list of strings, each a BlockPredicateArgumentType value
// (`ns:block[prop=value,..]{nbt}` or `#ns:tag[..]{..}`); the stack passes if ANY entry matches the block. An entry that
// does not parse is skipped (the CommandSyntaxException catch). Used by adventure mode: placeBlock (CanPlaceOn) and
// breakBlock (CanDestroy) in 14_player.js. An entry with `{nbt}` needs a block entity to match and so fails on plain blocks.
(function (NS) {
  'use strict';
  var BP = NS.BlockPred = {};

  /** Parse one predicate string -> {tag, id, props:{k:v}, hasNbt} or null (syntax error). */
  BP.parse = function (s) {
    s = String(s);
    var m = /^(#?)(?:([a-z0-9_.-]+):)?([a-z0-9_.\/-]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(s);
    if (!m) return null;
    var props = {}, body = m[4];
    if (body !== undefined && body.trim() !== '') {
      var parts = body.split(',');
      for (var i = 0; i < parts.length; i++) {
        var kv = /^\s*([a-z0-9_]+)\s*=\s*([a-z0-9_]+)\s*$/.exec(parts[i]);
        if (!kv || props[kv[1]] !== undefined) return null;
        props[kv[1]] = kv[2];
      }
    }
    if (m[2] !== undefined && m[2] !== 'minecraft') return null;   // only the vanilla namespace exists here
    return { tag: m[1] === '#', id: m[3], props: props, hasNbt: m[5] !== undefined };
  };

  /** Does the parsed predicate match registry `state`? A tag that does not exist, or a block that does not, never matches. */
  BP.matches = function (pred, state, hasBlockEntity) {
    var S = NS.States, R = NS.Reg;
    if (!pred || !S || !R || !R.ready || state <= 0) return false;
    var blk = S.block[state];
    if (pred.tag) { if (!NS.Tags || !NS.Tags.blockIn(pred.id, blk)) return false; }
    else if (R.id[pred.id] === undefined || R.id[pred.id] !== blk) return false;
    for (var k in pred.props) {
      var pid = R.PROP[k], vid = R.PVAL[pred.props[k]];
      if (pid === undefined) return false;
      if (vid === undefined || S.propValue(state, pid) !== vid) return false;   // missing property or other value
    }
    if (pred.hasNbt && !hasBlockEntity) return false;
    return true;
  };

  /** BlockPredicatesChecker.check(stack, key, state): stack.t[key] is a list of strings. */
  BP.check = function (stack, key, state, hasBlockEntity) {
    var t = stack && stack.t, list = t && t[key];
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) if (typeof list[i] === 'string' && BP.matches(BP.parse(list[i]), state, hasBlockEntity)) return true;
    return false;
  };
  BP.canPlaceOn = function (stack, state, be) { return BP.check(stack, 'CanPlaceOn', state, be); };
  BP.canDestroy = function (stack, state, be) { return BP.check(stack, 'CanDestroy', state, be); };
})(MCL);
