// 07zzu_cmdscreen.js — #4772: the model behind CommandBlockScreen / MinecartCommandBlockScreen
// (.decomp/net/minecraft/client/gui/screen/ingame/{Abstract,}CommandBlockScreen.java). Pure state, no drawing: Hud draws it.
// A target is a command block cell {x,y,z} or a command_block_minecart entity; both keep command / trackOutput / lastOutput.
// The strings are 1.18.2 en_us (advMode.*); the lang file is not in the repo, so they are typed.
// The suggestor (CommandSuggestor: up to 10 rows, selected row, Tab/Up/Down/Enter, grey ghost text) is the s.sug state below.

(function (NS) {
  'use strict';

  var CS = NS.CmdScreen = {};

  /** CommandBlockBlockEntity.Type order (values()): SEQUENCE, AUTO, REDSTONE -> chain, repeating, impulse. */
  CS.MODES = ['chain_command_block', 'repeating_command_block', 'command_block'];
  CS.MODE_TEXT = ['Chain', 'Repeat', 'Impulse'];
  CS.MAX_LEN = 32500;

  /** CommandBlockBlock.onUse / CommandBlockMinecartEntity.interact: only a creative-mode op may open it. */
  CS.canOpen = function (player) { return !!(player && player.instabuild && (player.permLevel === undefined || player.permLevel >= 2)); };

  function blockName(t) {
    var S = NS.States, W = NS.World, st = W.getBlock(t.x, t.y, t.z);
    return st > 0 ? S.name(st) : '';
  }

  /** The thing whose command fields we edit: the block entity, or the cart itself. */
  function holder(t) { return t.cart || NS.BlockEntities.get(t.x, t.y, t.z); }

  /** Open over `t` ({x,y,z} or {cart: entity}); null when the target is gone. Mirrors updateCommandBlock / init. */
  CS.open = function (t) {
    var h = t && holder(t);
    if (!h) return null;
    var s = { t: t, cart: !!t.cart, cmd: h.command || '', track: h.trackOutput !== false, lastOutput: h.lastOutput || null,
      mode: 2, cond: false, auto: !!h.auto, error: false };
    if (!s.cart) {
      var nm = blockName(t);
      if (CS.MODES.indexOf(nm) < 0) return null;
      s.mode = CS.MODES.indexOf(nm);
      s.cond = NS.Behave.propName(NS.World.getBlock(t.x, t.y, t.z), 'conditional') === 'true';
    }
    return s;
  };

  /** setPreviousOutputText: the output text while tracking, else "-". */
  CS.previousOutput = function (s) {
    if (!s.track) return '-';
    if (!s.lastOutput) return '';
    try { var j = JSON.parse(s.lastOutput); return typeof j === 'string' ? j : (j.text || ''); } catch (e) { return String(s.lastOutput); }
  };

  CS.type = function (s, ch) { if (ch && s.cmd.length < CS.MAX_LEN) { s.cmd += ch; CS.refresh(s); } };
  CS.backspace = function (s) { s.cmd = s.cmd.slice(0, -1); CS.refresh(s); };

  /** CommandSuggestor.MAX_SUGGESTION_ROWS (SuggestionWindow shows 10). */
  CS.ROWS = 10;

  /**
   * CommandSuggestor.refresh: completions for the word at the end of the field (the caret is always the end here).
   * s.sug = { start, matches, sel, scroll } or null. Command blocks take no leading slash; a stray one is tolerated.
   */
  CS.refresh = function (s) {
    s.sug = null;
    if (!NS.Commands || !NS.Commands.suggest) return;
    var r = NS.Commands.suggest(s.cmd, NS.Player, {});
    if (!r || !r.matches.length || r.start !== wordStart(s.cmd)) return;
    s.sug = { start: r.start, matches: r.matches, sel: 0, scroll: 0 };
  };
  function wordStart(str) { var i = str.length; while (i > 0 && str.charAt(i - 1) !== ' ') i--; return i; }

  /** Up (-1) / Down (+1): wraps over the whole list; the 10-row window follows the selection (SuggestionWindow.scroll). */
  CS.suggestMove = function (s, d) {
    var g = s.sug;
    if (!g) return false;
    var n = g.matches.length;
    g.sel = (g.sel + d + n) % n;
    if (g.sel < g.scroll) g.scroll = g.sel;
    else if (g.sel >= g.scroll + CS.ROWS) g.scroll = g.sel - CS.ROWS + 1;
    return true;
  };

  /** The rows in view. */
  CS.suggestRows = function (s) { return s.sug ? s.sug.matches.slice(s.sug.scroll, s.sug.scroll + CS.ROWS) : []; };

  /** Grey ghost text after the field: the rest of the selected match past what is typed. */
  CS.ghost = function (s) {
    var g = s.sug;
    return g ? g.matches[g.sel].substring(s.cmd.length - g.start) : '';
  };

  /** Tab / Enter: replace the word with the selected match. */
  CS.suggestAccept = function (s) {
    var g = s.sug;
    if (!g) return false;
    s.cmd = s.cmd.substring(0, g.start) + g.matches[g.sel];
    CS.refresh(s);
    return true;
  };
  CS.cycleMode = function (s) { s.mode = (s.mode + 1) % 3; };

  /** commitAndClose -> UpdateCommandBlock(Minecart)C2SPacket applied: command, trackOutput, (block) mode/conditional/auto. */
  CS.commit = function (s) {
    var t = s.t, h = holder(t);
    if (!h) return false;
    h.command = s.cmd;
    h.successCount = 0;                                  // CommandBlockExecutor.setCommand
    h.trackOutput = s.track;
    if (!s.track) h.lastOutput = null;
    if (!s.cart) {
      var W = NS.World, B = NS.Behave, R = NS.Reg, S = NS.States;
      var cur = W.getBlock(t.x, t.y, t.z), nm = S.name(cur), to = CS.MODES[s.mode];
      if (nm !== to) cur = R.real(R.names.indexOf(to), cur - R.realFirst[S.block[cur]]);   // all three share one state layout
      W.setBlock(t.x, t.y, t.z, B.setProp(cur, 'conditional', s.cond));
      h.auto = s.auto;
    }
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
