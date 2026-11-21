// 07zzu_jigsawscreen.js — #11725: the model behind JigsawBlockScreen (.decomp/.../ingame/JigsawBlockScreen.java). Pure state; Hud draws it.
// Fields: pool(128) name(128) target(128) final_state(256) + joint (rollable|aligned, only for a vertical jigsaw) + levels 0..7 + keep_jigsaws.
// Done is active only while name/target/pool are all valid Identifiers (Identifier.isValid); Enter = Done when active.

(function (NS) {
  'use strict';

  var JS = NS.JigsawScreen = {};
  JS.FIELDS = ['pool', 'name', 'target', 'finalState'];
  JS.MAX = { pool: 128, name: 128, target: 128, finalState: 256 };
  JS.LABEL = { pool: 'Target Pool:', name: 'Name:', target: 'Target Name:', finalState: 'Turns into:' };
  JS.JOINTS = ['rollable', 'aligned'];
  JS.JOINT_TEXT = { rollable: 'Rollable', aligned: 'Aligned' };

  /** Identifier.isValid: `ns:path`, empty namespace = minecraft; namespace [a-z0-9_.-], path [a-z0-9_.-/]. A second ':' makes split()[1] hold only the middle part. */
  JS.validId = function (t) {
    var i = t.indexOf(':'), ns = i < 0 ? 'minecraft' : t.slice(0, i), p = i < 0 ? t : t.slice(i + 1);
    if (i >= 0) { var j = p.indexOf(':'); if (j >= 0) p = p.slice(0, j); }
    if (ns === '') ns = 'minecraft';
    return /^[a-z0-9_.-]*$/.test(ns) && /^[a-z0-9_.\/-]*$/.test(p);
  };

  JS.vertical = function (stateName) { return /^(up|down)_/.test(stateName || ''); };

  /** `init`: fields from the block entity (defaults minecraft:empty / minecraft:air), joint from it or by facing axis. */
  JS.open = function (be, orientation) {
    if (!be || be.type !== 'jigsaw') return null;
    var vert = JS.vertical(orientation);
    var j = JS.JOINTS.indexOf(be.joint) >= 0 ? be.joint : (vert ? 'rollable' : 'aligned');
    return { be: be, pool: be.pool || 'minecraft:empty', name: be.name || 'minecraft:empty', target: be.target || 'minecraft:empty',
      finalState: be.finalState || 'minecraft:air', joint: j, vertical: vert, levels: 0, keep: true, focus: 0 };
  };
  JS.canOpen = function (player) { return !!(player && player.instabuild && (player.permLevel === undefined || player.permLevel >= 2)); };
  JS.doneActive = function (s) { return JS.validId(s.name) && JS.validId(s.target) && JS.validId(s.pool); };
  JS.type = function (s, ch) {
    var f = JS.FIELDS[s.focus];
    if (!ch || ch.length !== 1 || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || s[f].length >= JS.MAX[f]) return false;
    s[f] += ch; return true;
  };
  JS.backspace = function (s) { var f = JS.FIELDS[s.focus]; s[f] = s[f].slice(0, -1); return true; };
  JS.tab = function (s, back) { s.focus = (s.focus + (back ? 3 : 1)) & 3; return true; };
  JS.cycleJoint = function (s) { if (!s.vertical) return false; s.joint = JS.JOINTS[(JS.JOINTS.indexOf(s.joint) + 1) % 2]; return true; };
  JS.setLevels = function (s, frac) { s.levels = Math.floor(Math.max(0, Math.min(1, frac)) * 7); return s.levels; };   // floor(clampedLerp(0, 7, v))
  /** onDone / updateServer: the fields go back to the block entity (UpdateJigsawC2SPacket). Refused while an id is invalid. */
  JS.commit = function (s) {
    if (!JS.doneActive(s)) return false;
    var be = s.be;
    be.name = s.name; be.target = s.target; be.pool = s.pool; be.finalState = s.finalState; be.joint = s.joint;
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
