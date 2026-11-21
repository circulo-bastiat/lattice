// 07zzu_structurescreen.js — #11725: the model behind StructureBlockScreen (.decomp/.../ingame/StructureBlockScreen.java). Pure state; Hud draws it.
// Mode/mirror/rotation/entities/air/bounding-box edits go live to the block entity; Cancel restores the values taken at init; Done/Save/Load/Detect commit the text fields.

(function (NS) {
  'use strict';

  var SS = NS.StructureScreen = {};
  SS.MODES = ['save', 'load', 'corner', 'data'];
  SS.MODES_EXCEPT_DATA = ['save', 'load', 'corner'];       // MODES_EXCEPT_DATA: the first click on the mode button never lands on data
  SS.MIRRORS = ['none', 'left_right', 'front_back'];
  SS.ROTATIONS = ['none', 'clockwise_90', '180', 'counterclockwise_90'];
  SS.ROT_LABEL = { none: '0', clockwise_90: '90', '180': '180', counterclockwise_90: '270' };
  SS.FIELDS = ['name', 'posX', 'posY', 'posZ', 'sizeX', 'sizeY', 'sizeZ', 'integrity', 'seed', 'metadata'];
  SS.MAX = { name: 64, posX: 15, posY: 15, posZ: 15, sizeX: 15, sizeY: 15, sizeZ: 15, integrity: 15, seed: 31, metadata: 128 };
  SS.VISIBLE = {
    save: ['name', 'posX', 'posY', 'posZ', 'sizeX', 'sizeY', 'sizeZ'],
    load: ['name', 'posX', 'posY', 'posZ', 'integrity', 'seed'],
    corner: ['name'],
    data: ['metadata']
  };
  SS.TEXT = { name: 'Structure Name', position: 'Relative Position', size: 'Structure Size', integrity: 'Structure Integrity and Seed',
    custom_data: 'Custom Data Name', include_entities: 'Include entities:', detect_size: 'Detect size and position:', show_air: 'Show invisible blocks:',
    show_boundingbox: 'Show bounding box:' };
  SS.MODE_LABEL = { save: 'Save', load: 'Load', corner: 'Corner', data: 'Data' };
  SS.MODE_TEXT = { save: 'Save mode', load: 'Load mode', corner: 'Corner mode', data: 'Data mode' };   // StructureBlockMode.asText

  /** Screen.isValidCharacterForName; the caret is at the end of the field (cursor = length). */
  SS.validNameChar = function (text, ch, cursor) {
    var colon = text.indexOf(':'), slash = text.indexOf('/');
    if (ch === ':') return (slash === -1 || cursor <= slash) && colon === -1;
    if (ch === '/') return cursor > colon;
    return ch === '_' || ch === '-' || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '.';
  };
  SS.parseInt = function (t) { return /^[+-]?\d+$/.test(t) && Math.abs(+t) <= 2147483648 && +t >= -2147483648 && +t <= 2147483647 ? parseInt(t, 10) : 0; };
  SS.parseFloat = function (t) { var v = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?\s*$/.test(t) ? parseFloat(t) : NaN; return isNaN(v) ? 1 : Math.fround(v); };
  SS.parseLong = function (t) { return /^[+-]?\d+$/.test(t) && Math.abs(+t) < 9.3e18 ? t.replace(/^\+/, '') : '0'; };
  /** DecimalFormat("0.0###"): at least one, at most four fraction digits. */
  SS.formatIntegrity = function (v) {
    var s = (Math.round(v * 10000) / 10000).toString();
    return s.indexOf('.') < 0 ? s + '.0' : s;
  };

  SS.open = function (be) {
    if (!be || be.type !== 'structure_block') return null;
    var s = { be: be, mode: be.mode || 'data', mirror: be.mirror || 'none', rotation: be.rotation || 'none',
      ignoreEntities: !!be.ignoreEntities, showAir: !!be.showAir, showBoundingBox: !!be.showBoundingBox, focus: 'name', action: null };
    s.orig = { mode: s.mode, mirror: s.mirror, rotation: s.rotation, ignoreEntities: s.ignoreEntities, showAir: s.showAir, showBoundingBox: s.showBoundingBox };
    s.name = be.name || ''; s.metadata = be.metadata || '';
    s.posX = String(be.posX | 0); s.posY = String(be.posY | 0); s.posZ = String(be.posZ | 0);
    s.sizeX = String(be.sizeX | 0); s.sizeY = String(be.sizeY | 0); s.sizeZ = String(be.sizeZ | 0);
    s.integrity = SS.formatIntegrity(be.integrity === undefined ? 1 : be.integrity);
    s.seed = String(be.seed === undefined ? 0 : be.seed);
    s.focus = SS.visible(s)[0];
    return s;
  };
  SS.canOpen = function (player) { return !!(player && player.instabuild && (player.permLevel === undefined || player.permLevel >= 2)); };
  SS.visible = function (s) { return SS.VISIBLE[s.mode]; };
  SS.type = function (s, ch) {
    var f = s.focus;
    if (SS.visible(s).indexOf(f) < 0 || !ch || ch.length !== 1 || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || s[f].length >= SS.MAX[f]) return false;
    if (f === 'name' && !SS.validNameChar(s.name, ch, s.name.length)) return false;
    s[f] += ch; return true;
  };
  SS.backspace = function (s) { s[s.focus] = s[s.focus].slice(0, -1); return true; };
  SS.tab = function (s, back) {
    var v = SS.visible(s), i = v.indexOf(s.focus); if (i < 0) i = 0;
    s.focus = v[(i + (back ? v.length - 1 : 1)) % v.length]; return true;
  };
  /** The mode button walks MODES_EXCEPT_DATA (save, load, corner); data is reachable only if the block already is in it. */
  SS.cycleMode = function (s, back) {
    var L = SS.MODES_EXCEPT_DATA, i = L.indexOf(s.mode);
    s.mode = L[(i < 0 ? 0 : i + (back ? L.length - 1 : 1)) % L.length]; s.be.mode = s.mode;
    if (SS.visible(s).indexOf(s.focus) < 0) s.focus = SS.visible(s)[0];
    return true;
  };
  SS.cycleMirror = function (s) { s.mirror = SS.MIRRORS[(SS.MIRRORS.indexOf(s.mirror) + 1) % 3]; s.be.mirror = s.mirror; return true; };
  SS.setRotation = function (s, r) { s.rotation = r; s.be.rotation = r; return true; };
  SS.toggle = function (s, which) {                 // 'ignoreEntities' button shows !ignoreEntities
    s[which] = !s[which]; s.be[which] = s[which]; return true;
  };
  /** Which buttons are visible per mode (updateWidgets). */
  SS.buttons = function (mode) {
    return { save: mode === 'save', load: mode === 'load', detect: mode === 'save', entities: mode === 'save' || mode === 'load', mirror: mode === 'load',
      rotate: mode === 'load', showAir: mode === 'save', showBoundingBox: mode === 'load' };
  };
  /** updateStructureBlock: parse and write every field back (UpdateStructureBlockC2SPacket); `action` is update/save/load/detect. */
  SS.commit = function (s, action) {
    var be = s.be;
    be.name = s.name; be.metadata = s.metadata;
    be.posX = SS.parseInt(s.posX); be.posY = SS.parseInt(s.posY); be.posZ = SS.parseInt(s.posZ);
    be.sizeX = SS.parseInt(s.sizeX); be.sizeY = SS.parseInt(s.sizeY); be.sizeZ = SS.parseInt(s.sizeZ);
    be.integrity = SS.parseFloat(s.integrity); be.seed = SS.parseLong(s.seed);
    be.mode = s.mode; be.mirror = s.mirror; be.rotation = s.rotation;
    be.ignoreEntities = s.ignoreEntities; be.showAir = s.showAir; be.showBoundingBox = s.showBoundingBox;
    be.lastAction = action || 'update';
    return true;
  };
  /** Save / Load / Detect only act in their own mode. */
  SS.action = function (s, action) {
    var need = { save: 'save', load: 'load', detect: 'save' }[action];
    if (s.mode !== need) return false;
    return SS.commit(s, action);
  };
  /** cancel(): the live edits are put back. */
  SS.cancel = function (s) {
    var o = s.orig, be = s.be;
    be.mirror = o.mirror; be.rotation = o.rotation; be.mode = o.mode; be.ignoreEntities = o.ignoreEntities; be.showAir = o.showAir; be.showBoundingBox = o.showBoundingBox;
    return true;
  };
})(typeof MCL !== 'undefined' ? MCL : (typeof globalThis !== 'undefined' ? globalThis : this));
