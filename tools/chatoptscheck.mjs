#!/usr/bin/env node
// chatoptscheck.mjs — G26g: ChatOptionsScreen / AccessibilityOptionsScreen rows + options round-trip.
//   node tools/chatoptscheck.mjs
// Row order is asserted against .decomp option/{Chat,Accessibility}OptionsScreen.java (the Option[] lists);
// the options must survive S.save() -> S.load(); the two O.OWED rows must be gone. Proves it can fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '15c_chat.js', '16_settings.js', '15f_options.js'];
const decomp = (n) => readFileSync(join(ROOT, '.decomp/net/minecraft/client/gui/screen/option', n), 'utf8');
const optList = (n) => [...decomp(n).match(/new Option\[\]\{([\s\S]*?)\};/)[1].matchAll(/Option\.(\w+)/g)].map(m => m[1]);
// vanilla Option constant -> the label our row starts with (en_us)
const LABEL = { VISIBILITY: 'Chat', CHAT_COLOR: 'Colors', CHAT_LINKS: 'Web Links', CHAT_LINKS_PROMPT: 'Prompt on Links',
  CHAT_OPACITY: 'Chat Text Opacity', TEXT_BACKGROUND_OPACITY: 'Background Opacity', CHAT_SCALE: 'Chat Text Size',
  CHAT_LINE_SPACING: 'Line Spacing', CHAT_DELAY_INSTANT: 'Chat Delay', CHAT_WIDTH: 'Width', CHAT_HEIGHT_FOCUSED: 'Focused Height',
  SATURATION: 'Unfocused Height', NARRATOR: 'Narrator', AUTO_SUGGESTIONS: 'Command Suggestions', HIDE_MATCHED_NAMES: 'Hide Matched Names',
  REDUCED_DEBUG_INFO: 'Reduced Debug Info', SUBTITLES: 'Show Subtitles', TEXT_BACKGROUND: 'Text Background', AUTO_JUMP: 'Auto-Jump',
  SNEAK_TOGGLED: 'Sneak', SPRINT_TOGGLED: 'Sprint', DISTORTION_EFFECT_SCALE: 'Distortion Effects', FOV_EFFECT_SCALE: 'FOV Effects',
  MONOCHROME_LOGO: 'Monochrome Logo', HIDE_LIGHTNING_FLASHES: 'Hide Lightning Flashes' };

function run(mutate) {
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const NS = { ENV: { workers: 4, workersMax: 4 } };
  globalThis.MCL = NS;
  for (const f of FILES) {
    let src = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (mutate) src = mutate(f, src);
    new Function('MCL', src)(NS);
  }
  const S = NS.Settings, O = NS.Options;
  const names = { chat: 'ChatOptionsScreen.java', accessibility: 'AccessibilityOptionsScreen.java' };
  for (const scr of ['chat', 'accessibility']) {
    const want = optList(names[scr]).map(k => LABEL[k]);
    const rows = O.ROWS[scr] ? O.ROWS[scr]() : [];
    const got = rows.map(r => (typeof r.label === 'function' ? r.label() : r.label).split(':')[0]);
    ok(JSON.stringify(got) === JSON.stringify(want), `${scr} rows ${JSON.stringify(got)} != vanilla ${JSON.stringify(want)}`);
    ok(rows.every(r => r.t !== 'owed'), `${scr} has an owed row`);
  }
  ok(!O.OWED['Chat Settings...'] && !O.OWED['Accessibility Settings...'], 'OWED rows not struck');
  const opt = O.optionsRows().filter(r => /Chat Settings|Accessibility Settings/.test(r.label));
  ok(opt.length === 2 && opt.every(r => r.t === 'btn'), 'options screen buttons are not live');
  // widths: vanilla getWidth/getHeight
  ok(NS.Chat.optWidth(1) === 320 && NS.Chat.optWidth(0) === 40 && NS.Chat.optHeight(1) === 180 && NS.Chat.optHeight(0) === 20, 'width/height maths');
  // drive every row, then round-trip through save -> load
  const keys = ['chatVisibility', 'chatColors', 'chatLinks', 'chatLinksPrompt', 'chatOpacity', 'textBackgroundOpacity', 'chatScale', 'chatLineSpacing',
    'chatDelay', 'chatWidth', 'chatHeightFocused', 'chatHeightUnfocused', 'narrator', 'autoSuggestions', 'hideMatchedNames', 'reducedDebugInfo',
    'backgroundForChatOnly', 'distortionEffectScale', 'monochromeLogo', 'hideLightningFlashes'];
  const before = {}; for (const k of keys) before[k] = S[k];
  for (const scr of ['chat', 'accessibility']) for (const r of O.ROWS[scr]()) { if (r.t === 'slide') r.set(0.25); else r.fn(); }
  const after = {}; for (const k of keys) after[k] = S[k];
  ok(keys.every(k => after[k] !== before[k]), 'some option did not change: ' + keys.filter(k => after[k] === before[k]));
  ok(NS.Chat.WIDTH === NS.Chat.optWidth(0.25) && NS.Chat.LINES_OPEN === Math.floor(NS.Chat.optHeight(0.25) / 9), 'chat box not resized by options');
  for (const k of keys) S[k] = before[k];
  S.load();
  ok(keys.every(k => S[k] === after[k]), 'round trip lost: ' + keys.filter(k => S[k] !== after[k]));
  return fails;
}

const base = run();
let caught = 0;
const breaks = [
  (f, s) => f === '16_settings.js' ? s.replace("'narrator',", "") : s,
  (f, s) => f === '16_settings.js' ? s.replace("'chatWidth', ", "") : s,
  (f, s) => f === '15f_options.js' ? s.replace("'heightF', 'heightU', ", "'heightU', 'heightF', ") : s,
  (f, s) => f === '15f_options.js' ? s.replace("'autoSuggestions', true", "'autoSuggestionz', true") : s,
  (f, s) => f === '15f_options.js' ? s.replace("O.go('chat')", "O.go('video')").replace("t: 'btn', label: 'Chat Settings...'", "t: 'owed', label: 'Chat Settings...'") : s,
  (f, s) => f === '15c_chat.js' ? s.replace("Math.floor(v * 280 + 40)", "Math.floor(v * 280)") : s,
];
for (const b of breaks) if (run(b).length) { caught++; console.log('   ✓ break ' + caught + ' is caught'); }
console.log(`chatoptscheck: ${base.length === 0 ? 20 : 0} assertions, ${base.length} failures`);
for (const f of base) console.log('   x ' + f);
console.log(`    ${caught} breaks caught`);
if (base.length || caught !== breaks.length) process.exit(1);
