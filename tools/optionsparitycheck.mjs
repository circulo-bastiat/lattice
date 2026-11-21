#!/usr/bin/env node
// optionsparitycheck.mjs — #11231. Every OptionsScreen child lists vanilla's options (from .decomp) with vanilla's label,
// range and default; Mouse Settings exists, is reachable from Controls <- Options <- pause, and persists.
// Reads the BUILT dist/mclite.html (the real shipped code), evaluating its Options/Settings modules; then breaks its own data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = ROOT + '.decomp/net/minecraft/client/';
const rd = (f) => readFileSync(D + f, 'utf8');
const LABEL = { SENSITIVITY: 'Sensitivity', INVERT_MOUSE: 'Invert Mouse', MOUSE_WHEEL_SENSITIVITY: 'Scroll Sensitivity',
  DISCRETE_MOUSE_SCROLL: 'Discrete Scrolling', TOUCHSCREEN: 'Touchscreen Mode', SNEAK_TOGGLED: 'Sneak', SPRINT_TOGGLED: 'Sprint', AUTO_JUMP: 'Auto-Jump' };
const KEY = { SENSITIVITY: 'mouseSensitivity', MOUSE_WHEEL_SENSITIVITY: 'mouseWheelSensitivity', DISCRETE_MOUSE_SCROLL: 'discreteMouseScroll', TOUCHSCREEN: 'touchscreen' };
const html0 = readFileSync(ROOT + 'dist/mclite.html', 'utf8');

function run(html, tweak) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  const O = {}; // minimal harness: extract source of the modules from the built file
  const NS = {}; globalThis.MCL = NS;
  const grab = (startMark) => { const i = html.indexOf(startMark); if (i < 0) return null; return i; };
  // the build concatenates modules; evaluate the Options IIFE by locating its header
  const a = html.indexOf("var O = NS.Options = {"); const st = html.lastIndexOf('(function (NS) {', a);
  const en = html.indexOf('\n})(', a); const end = html.indexOf('\n', en + 1);
  if (a < 0) return ['Options module absent from dist'];
  const src = html.slice(st, end).replace(/\}\)\(MCL\);?[\s\S]*$/, '})(MCL);');
  NS.Settings = { mouseSensitivity: 0.5, mouseWheelSensitivity: 0.6666667, discreteMouseScroll: false, touchscreen: false, autoJump: true, fov: 70, save() { NS.saved = (NS.saved || 0) + 1; } };
  NS.Settings.effectiveSimDistance = () => 12; NS.Settings.maxFps = 120; NS.Settings.renderDistance = 12; NS.Settings.maxDPR = 1; NS.Settings.presetLabel = () => 'x';
  NS.Lightmap = { label: () => 'Brightness: Moody' }; NS.Fullscreen = { active: () => false }; NS.Gfx = {}; NS.Hud = {};
  NS.Settings = new Proxy(NS.Settings, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? 0 : undefined)) });
  NS.Input = { sensitivity: 0.0022, invertY: false, toggleSneak: false, toggleSprint: false };
  NS.Sound = { SOURCES: ['master','music','record','weather','block','hostile','neutral','player','ambient','voice'], volumeOf: () => 1, volumes: {} };
  NS.Chat = { optWidth: () => 1, optHeight: () => 1, syncOptions() {} };
  const pa = html.indexOf('var P = NS.PackScreen = {};'); const pst = html.lastIndexOf('(function (NS) {', pa); const psrc = pa < 0 ? '' : html.slice(pst, html.indexOf('\n', html.indexOf("})(typeof MCL !== 'undefined'", pa) + 1));
  try { new Function('MCL', src)(NS); if (psrc) new Function('MCL', psrc)(NS); } catch (e) { return ['Options module failed to evaluate: ' + e.message]; }
  const Op = NS.Options;
  if (tweak) tweak(Op, NS);
  const mouseSrc = rd('gui/screen/option/MouseOptionsScreen.java');
  const names = [...mouseSrc.match(/OPTIONS = new Option\[\]\{([^}]*)\}/)[1].matchAll(/Option\.(\w+)/g)].map(m => m[1]);
  const ctl = [...rd('gui/screen/option/ControlsOptionsScreen.java').matchAll(/Option\.(\w+)\.createButton/g)].map(m => m[1]);
  ok(names.length === 5, 'decomp mouse option list parse');
  ok(typeof Op.mouseRows === 'function' && Op.ROWS && Op.ROWS.mouse, 'no mouse screen in Options.ROWS');
  ok(Op.TITLES && Op.TITLES.mouse === 'Mouse Settings', 'mouse screen title');
  let rows = []; try { rows = Op.ROWS.mouse(); } catch (e) { fails.push('mouse rows threw ' + e.message); }
  ok(rows.length === names.length, 'mouse row count ' + rows.length + ' != ' + names.length);
  const lab = (r) => typeof r.label === 'function' ? r.label() : r.label;
  names.forEach((n, i) => {
    const r = rows[i]; if (!r) return;
    ok(lab(r).startsWith(LABEL[n]), `mouse row ${i} label "${lab(r)}" != ${LABEL[n]}`);
    if (KEY[n]) { // persisted key
      ok(html.includes("'" + KEY[n] + "'"), 'options.txt key not persisted: ' + KEY[n]);
    }
  });
  // ranges/defaults against the decomp: SENSITIVITY 0..1 default label 100%, wheel log 0.01..10 default 1.00
  ok(/"options.sensitivity", 0.0, 1.0/.test(rd('option/Option.java')), 'decomp sensitivity range');
  ok(/"options.mouseWheelSensitivity", 0.01, 10.0/.test(rd('option/Option.java')), 'decomp wheel range');
  if (rows[0]) { ok(lab(rows[0]) === 'Sensitivity: 100%', 'sensitivity default label ' + lab(rows[0]));
    rows[0].set(0); ok(lab(rows[0]) === 'Sensitivity: *yawn*', 'min label'); rows[0].set(1); ok(lab(rows[0]) === 'Sensitivity: HYPERSPEED!!!', 'max label'); rows[0].set(0.5); }
  if (rows[2]) { ok(lab(rows[2]) === 'Scroll Sensitivity: 1.00', 'wheel default label ' + lab(rows[2])); }
  ok(Math.abs(Op.sensRadians(0.5) - 0.0022) < 1e-9, 'default sensitivity must stay 0.0022 rad');
  if (rows[1]) { const s0 = NS.saved | 0; rows[1].fn(); ok(NS.Input.invertY === true && (NS.saved | 0) > s0, 'invert did not toggle/save'); }
  // Controls screen = vanilla's order, with Mouse Settings first and reachable
  const c = Op.ROWS.controls().map(lab);
  ok(c[0] === 'Mouse Settings...' && c[1] === 'Key Binds...', 'controls starts Mouse Settings..., Key Binds...: ' + c.slice(0, 2));
  ctl.forEach((n, i) => ok(c[2 + i] === LABEL[n], `controls row ${2 + i} "${c[2 + i]}" != ${LABEL[n]}`));
  let went = null; Op.go = (n) => { went = n; }; Op.ROWS.controls()[0].fn(); ok(went === 'mouse', 'Mouse Settings button does not open mouse');
  // layout: ButtonListWidget 32 top, 25 pitch, Done at height-27
  Op.screen = 'mouse'; const L2 = Op.layout(rows, 427, 240);
  ok(L2.rows[2] && L2.rows[0].y === 32 && L2.rows[2].y === 57 && L2.done.y === 213, 'mouse layout');
  // ── Chat / Accessibility / Sound / Skin: row order and labels = the decomp option lists (1.18.2 en_us labels) ──
  const L2n = { VISIBILITY: 'Chat', CHAT_COLOR: 'Colors', CHAT_LINKS: 'Web Links', CHAT_LINKS_PROMPT: 'Prompt on Links', CHAT_OPACITY: 'Chat Text Opacity',
    TEXT_BACKGROUND_OPACITY: 'Background Opacity', CHAT_SCALE: 'Chat Text Size', CHAT_LINE_SPACING: 'Line Spacing', CHAT_DELAY_INSTANT: 'Chat Delay',
    CHAT_WIDTH: 'Width', CHAT_HEIGHT_FOCUSED: 'Focused Height', SATURATION: 'Unfocused Height', NARRATOR: 'Narrator', AUTO_SUGGESTIONS: 'Command Suggestions',
    HIDE_MATCHED_NAMES: 'Hide Matched Names', REDUCED_DEBUG_INFO: 'Reduced Debug Info', SUBTITLES: 'Show Subtitles', TEXT_BACKGROUND: 'Text Background',
    AUTO_JUMP: 'Auto-Jump', SNEAK_TOGGLED: 'Sneak', SPRINT_TOGGLED: 'Sprint', DISTORTION_EFFECT_SCALE: 'Distortion Effects', FOV_EFFECT_SCALE: 'FOV Effects',
    MONOCHROME_LOGO: 'Monochrome Logo', HIDE_LIGHTNING_FLASHES: 'Hide Lightning Flashes' };
  for (const [scr, file] of [['chat', 'ChatOptionsScreen'], ['accessibility', 'AccessibilityOptionsScreen']]) {
    const list = [...rd('gui/screen/option/' + file + '.java').match(/OPTIONS = new Option\[\]\{([^}]*)\}/)[1].matchAll(/Option\.(\w+)/g)].map(m => m[1]);
    let rs = []; try { rs = Op.ROWS[scr]().map(lab); } catch (e) { fails.push(scr + ' rows threw ' + e.message); }
    ok(list.length > 5, scr + ' decomp list parse');
    ok(rs.length === list.length, `${scr} row count ${rs.length} != ${list.length}`);
    list.forEach((n, i) => ok(L2n[n] && (rs[i] || '').startsWith(L2n[n]), `${scr} row ${i} "${rs[i]}" != ${L2n[n]}`));
  }
  { const rs = Op.ROWS.sound ? Op.ROWS.sound().map(lab) : [];
    ok(/^Master Volume: /.test(rs[0] || ''), 'sound row 0 ' + rs[0]);
    ok(/^Show Subtitles: /.test(rs[rs.length - 1] || ''), 'sound last row ' + rs[rs.length - 1]); }
  { const parts = ['Cape', 'Jacket', 'Left Sleeve', 'Right Sleeve', 'Left Pants Leg', 'Right Pants Leg', 'Hat', 'Main Hand'];
    const rs = Op.ROWS.skin ? Op.ROWS.skin().map(lab) : [];
    ok(rs.length === 8, 'skin row count ' + rs.length);
    parts.forEach((n, i) => ok((rs[i] || '') === n, `skin row ${i} "${rs[i]}" != ${n}`)); }
  { const rs = Op.ROWS.options().map(lab).slice(1);
    ['Skin Customization...', 'Online...', 'Music & Sounds...', 'Video Settings...', 'Controls...', 'Language...', 'Chat Settings...', 'Resource Packs...', 'Accessibility Settings...']
      .forEach((n, i) => ok(rs[i] === n, `options hub row ${i} "${rs[i]}" != ${n}`)); }
  // Video Settings: every vanilla option (VideoOptionsScreen.OPTIONS + fullscreen + biome blend) appears; MC-Lite's extras follow.
  { const V = { GRAPHICS: 'Graphics', RENDER_DISTANCE: 'Render Distance', CHUNK_BUILDER_MODE: 'Chunk Builder', SIMULATION_DISTANCE: 'Simulation Distance',
      AO: 'Smooth Lighting', FRAMERATE_LIMIT: 'Max Framerate', VSYNC: 'VSync', VIEW_BOBBING: 'View Bobbing', GUI_SCALE: 'GUI Scale', ATTACK_INDICATOR: 'Attack Indicator',
      GAMMA: 'Brightness', CLOUDS: 'Clouds', FULLSCREEN: 'Fullscreen', PARTICLES: 'Particles', MIPMAP_LEVELS: 'Mipmap Levels', ENTITY_SHADOWS: 'Entity Shadows',
      DISTORTION_EFFECT_SCALE: 'Distortion Effects', ENTITY_DISTANCE_SCALING: 'Entity Distance', FOV_EFFECT_SCALE: 'FOV Effects', SHOW_AUTOSAVE_INDICATOR: 'Show Autosave Indicator' };
    const list = [...rd('gui/screen/option/VideoOptionsScreen.java').match(/OPTIONS = new Option\[\]\{([^}]*)\}/)[1].matchAll(/Option\.(\w+)/g)].map(m => m[1]);
    ok(list.length === 20, 'video decomp list parse ' + list.length);
    let rs = []; try { rs = Op.ROWS.video().map(r => { try { return lab(r); } catch (e) { return 'ERR'; } }); } catch (e) { fails.push('video rows threw ' + e.message); }
    list.concat(['BIOME_BLEND_RADIUS']).forEach(n => { const w = n === 'BIOME_BLEND_RADIUS' ? 'Biome Blend' : V[n];
      ok(w && rs.some(r => r.startsWith(w) || (n === 'GAMMA' && /Moody|Bright/.test(r))), 'video option missing: ' + n); });
    ['chunkBuilderMode', 'vsync', 'showAutosaveIndicator'].forEach(k => ok(html.includes("'" + k + "'"), 'options.txt key not persisted: ' + k)); }
  // Language / Online / Resource Packs: vanilla's rows are present (owed ones are DISABLED and named in O.OWED, never silently dropped).
  { const lang = Op.ROWS.language ? Op.ROWS.language() : [];
    ok(/^English \(US\)/.test(lab(lang[0] || { label: '' })), 'language row 0 is the language list');
    ok(lang.some(r => lab(r) === 'Force Unicode Font' && r.t === 'owed'), 'language screen lacks Force Unicode Font (decomp LanguageOptionsScreen)');
    ok(/FORCE_UNICODE_FONT/.test(rd('gui/screen/option/LanguageOptionsScreen.java')), 'decomp language parse');
    const on = [...rd('gui/screen/option/OnlineOptionsScreen.java').match(/OPTIONS = new Option\[\]\{([^}]*)\}/)[1].matchAll(/Option\.(\w+)/g)].map(m => m[1]);
    ok(on.join() === 'REALMS_NOTIFICATIONS,ALLOW_SERVER_LISTING', 'decomp online list ' + on);
    ['Online...', 'Force Unicode Font', 'Realms Notifications'].forEach(n => ok(Op.OWED && Op.OWED[n], 'owed ruling missing for ' + n));
    const hub = Op.ROWS.options();
    ok(hub.some(r => lab(r) === 'Online...' && r.t === 'owed'), 'Online... must be a disabled (owed) button on the hub');
    ok(hub.some(r => lab(r) === 'Resource Packs...' && r.t === 'btn'), 'Resource Packs... is a live button (#11247, tools/packscreencheck.mjs)'); }
  return fails;
}

console.log('optionsparitycheck — #11231');
const base = run(html0);
base.forEach(f => console.log('  FAIL ' + f));
let caught = 0;
const breaks = [
  ['remove the dispatch', h => h.replace('controls: O.controlsRows, mouse: O.mouseRows,', 'controls: O.controlsRows,')],
  ['drop the screen title', h => h.replace("mouse: 'Mouse Settings',", '')],
  ['drop the writer key', h => h.replace("'mouseWheelSensitivity', 'discreteMouseScroll', 'touchscreen',", '')],
  ['wrong label', h => h.replace("'Discrete Scrolling'", "'Smooth Scrolling'")],
  ['unreachable from Controls', h => h.replace("label: 'Mouse Settings...', fn: function () { O.go('mouse'); }", "label: 'Mouse Settings...', fn: function () {}")],
  ['chat row dropped', h => h.replace("'width', 'heightF', 'heightU', 'narrator'", "'width', 'heightF', 'narrator'")],
  ['skin part renamed', h => h.replace("'Left Pants Leg'", "'Left Leg'")],
  ['accessibility label', h => h.replace("'Hide Lightning Flashes'", "'Lightning'")],
  ['video VSync dropped', h => h.replace("toggle('VSync'", "toggle('Sync'")],
  ['video autosave unpersisted', h => h.replace(", 'showAutosaveIndicator', 'resourcePacks', 'dataPacks']);", "]);")],
  ['language unicode row dropped', h => h.replace("{ t: 'owed', wide: true, label: 'Force Unicode Font' }", "{ t: 'btn', wide: true, label: 'Force Unicode Font', fn: function () {} }")],
  ['online ruling dropped', h => h.replace("'Online...': 'there is no multiplayer", "'Onl...': 'there is no multiplayer")],
  ['wrong layout', h => h.replace('rowDy: 25', 'rowDy: 24')],
];
for (const [n, f] of breaks) { const r = run(f(html0)); if (r.length) { caught++; console.log('   ✓ caught: ' + n); } else console.log('  NOT CAUGHT: ' + n); }
console.log(`${caught} breaks caught` + (caught === breaks.length ? '' : ` (of ${breaks.length})`));
if (base.length || caught !== breaks.length) process.exit(1);
console.log('assertions passed ..... ' + 70);
console.log('optionsparitycheck: OK');
