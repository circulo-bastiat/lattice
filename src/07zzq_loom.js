// 07zzq_loom.js — G19e-loom: LoomScreenHandler (.decomp/net/minecraft/screen/LoomScreenHandler.java)
// as NS.Loom: the 41 BannerPattern ids in ENUM ORDER (the ordinal IS the button id and the
// selectedPattern value), the slot filters, `result` (updateOutputSlot) and the 6-layer limit.
// Stacks are `{i, n, d, t}`; a banner's layers live at `t.BlockEntityTag.Patterns`.
(function (NS) {
  'use strict';

  var Loom = NS.Loom = {};
  // BannerPattern.values(), in declaration order: [name, id]
  Loom.PATTERNS = [
    ['base', 'b'], ['square_bottom_left', 'bl'], ['square_bottom_right', 'br'], ['square_top_left', 'tl'],
    ['square_top_right', 'tr'], ['stripe_bottom', 'bs'], ['stripe_top', 'ts'], ['stripe_left', 'ls'],
    ['stripe_right', 'rs'], ['stripe_center', 'cs'], ['stripe_middle', 'ms'], ['stripe_downright', 'drs'],
    ['stripe_downleft', 'dls'], ['small_stripes', 'ss'], ['cross', 'cr'], ['straight_cross', 'sc'],
    ['triangle_bottom', 'bt'], ['triangle_top', 'tt'], ['triangles_bottom', 'bts'], ['triangles_top', 'tts'],
    ['diagonal_left', 'ld'], ['diagonal_up_right', 'rd'], ['diagonal_up_left', 'lud'], ['diagonal_right', 'rud'],
    ['circle', 'mc'], ['rhombus', 'mr'], ['half_vertical', 'vh'], ['half_horizontal', 'hh'],
    ['half_vertical_right', 'vhr'], ['half_horizontal_bottom', 'hhb'], ['border', 'bo'], ['curly_border', 'cbo'],
    ['gradient', 'gra'], ['gradient_up', 'gru'], ['bricks', 'bri'],
    ['globe', 'glb'], ['creeper', 'cre'], ['skull', 'sku'], ['flower', 'flo'], ['mojang', 'moj'], ['piglin', 'pig']
  ];
  Loom.COUNT = Loom.PATTERNS.length;                                  // 41
  Loom.HAS_PATTERN_ITEM_COUNT = 6;                                    // globe..piglin
  Loom.LOOM_APPLICABLE_COUNT = Loom.COUNT - Loom.HAS_PATTERN_ITEM_COUNT - 1;   // 34 buttons: ordinals 1..34
  Loom.MAX_LAYERS = 6;
  // Items.java: <name>_banner_pattern -> BannerPattern
  Loom.PATTERN_ITEMS = { globe_banner_pattern: 'glb', creeper_banner_pattern: 'cre', skull_banner_pattern: 'sku',
    flower_banner_pattern: 'flo', mojang_banner_pattern: 'moj', piglin_banner_pattern: 'pig' };
  // DyeColor ids
  Loom.DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
    'purple', 'blue', 'brown', 'green', 'red', 'black'];

  function nameOf(s) { return NS.Items.names[s.i]; }
  function empty(s) { return !s || !(s.n > 0); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  Loom.isBanner = function (s) { return !empty(s) && /_banner$/.test(nameOf(s)); };
  Loom.dyeId = function (s) {
    if (empty(s)) return -1;
    var n = nameOf(s);
    return /_dye$/.test(n) ? Loom.DYES.indexOf(n.slice(0, -4)) : -1;
  };
  Loom.isDye = function (s) { return Loom.dyeId(s) >= 0; };
  /** BannerPatternItem.getPattern -> ordinal, or -1. */
  Loom.patternOrdinal = function (s) {
    if (empty(s)) return -1;
    var id = Loom.PATTERN_ITEMS[nameOf(s)];
    if (!id) return -1;
    for (var i = 0; i < Loom.COUNT; i++) if (Loom.PATTERNS[i][1] === id) return i;
    return -1;
  };
  Loom.isPatternItem = function (s) { return Loom.patternOrdinal(s) >= 0; };
  Loom.layers = function (banner) {
    var b = banner && banner.t && banner.t.BlockEntityTag;
    return b && b.Patterns ? b.Patterns.length : 0;
  };

  /**
   * `onContentChanged`'s selection rule: with a pattern item in the slot the selection becomes that
   * item's pattern, or 0 when the banner already has 6 layers. Returns the new selection.
   */
  Loom.reselect = function (banner, pattern, selected) {
    if (!empty(pattern) && Loom.isPatternItem(pattern)) {
      return Loom.layers(banner) >= Loom.MAX_LAYERS ? 0 : Loom.patternOrdinal(pattern);
    }
    return selected;
  };

  /** `updateOutputSlot`: one banner copy with the selected layer appended, else null. */
  Loom.result = function (banner, dye, selected) {
    if (!(selected > 0) || empty(banner) || empty(dye) || !Loom.isDye(dye)) return null;
    var r = { i: banner.i, n: 1, d: banner.d || 0, t: banner.t ? clone(banner.t) : {} };
    r.t.BlockEntityTag = r.t.BlockEntityTag || {};
    var be = r.t.BlockEntityTag;
    if (!be.Patterns) be.Patterns = [];
    be.Patterns.push({ Pattern: Loom.PATTERNS[selected][1], Color: Loom.dyeId(dye) });
    return r;
  };

  /** `onButtonClick`: is `button` a valid selection (1..LOOM_APPLICABLE_COUNT)? */
  Loom.validButton = function (b) { return b > 0 && b <= Loom.LOOM_APPLICABLE_COUNT; };
  /**
   * `LoomScreen.canApplyDyePattern`: the 34 dye-pattern buttons are offered only with an EMPTY
   * pattern slot and fewer than 6 layers.
   */
  Loom.selectable = function (banner, pattern) {
    var out = [], i;
    if (empty(banner) || !empty(pattern) || Loom.layers(banner) >= Loom.MAX_LAYERS) return out;
    for (i = 1; i <= Loom.LOOM_APPLICABLE_COUNT; i++) out.push(i);
    return out;
  };
})(MCL);
