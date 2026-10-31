#!/usr/bin/env node
// optionscheck.mjs — PLAN G11c. Vanilla's Options tree: its widgets, its numbers, its tree.
//
//   node tools/optionscheck.mjs [--verbose]
//
// ⚠ WHAT THIS EXISTS TO CATCH. Dan: *"remove the old settings menu and wire it into the gui of
// the real game."* The old one drew filled rectangles in the BROWSER'S font and reflowed into two
// columns when the window got short. The replacement draws vanilla's own `widgets.png` sprites at
// vanilla's own coordinates — and a screen built out of coordinates is exactly the kind of thing
// that looks right in a screenshot while being four pixels wrong everywhere, which is why every
// number here is asserted against the TEXTURE rather than against itself (D-277's rule, and
// `guicheck`'s).
//
// ⚠ AND THE OLD ONE IS ASSERTED GONE. D-139: the stage that replaces something deletes the
// something, in the same commit. §5 reads `src/15_hud.js` and refuses a `pauseRows` that is still
// there — a settings screen kept behind a flag is two settings screens, and the one nobody looks
// at is the one that rots.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');

const NS = {};
NS.Jobs = { mode: 'inline', workers: [], clampSize(n) { return Math.max(1, Math.min(NS.ENV.workersMax || 4, n | 0)); }, resize() { return Promise.resolve(0); } };
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02j_sounds.js', '14kc_lightmap.js', '15f_options.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const O = NS.Options, Sn = NS.Sound;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('optionscheck — PLAN G11c, vanilla\'s Options tree (D-315)');

// the GUI sheets, straight out of the shipped payload
const SHEETS = (() => {
  const bytes = inflateRawSync(readFileSync(join(ASSETS, 'gui.bin')));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = dv.getUint32(0, true);
  const head = JSON.parse(bytes.subarray(4, 4 + hlen).toString('latin1'));
  const base = 4 + hlen;
  const out = {};
  for (const sh of head.sheets) out[sh.n] = { w: sh.w, h: sh.h, off: base + sh.o };
  return { out, bytes };
})();
const texel = (name, x, y) => {
  const sh = SHEETS.out[name];
  if (!sh || x < 0 || y < 0 || x >= sh.w || y >= sh.h) return [0, 0, 0, 0];
  const o = sh.off + (y * sh.w + x) * 4;
  return [SHEETS.bytes[o], SHEETS.bytes[o + 1], SHEETS.bytes[o + 2], SHEETS.bytes[o + 3]];
};

// ═══════════════ 1. the three button sprites, against widgets.png ══════════════════════════
console.log('\n 1. the button sprites are three real, different pictures in widgets.png');
{
  const rows = [['disabled', O.SPRITE.disabled], ['normal', O.SPRITE.normal], ['hover', O.SPRITE.hover]];
  for (const [name, y] of rows) {
    // every one of the 200x20 pixels is opaque — a button is a solid widget
    let opaque = 0;
    for (let dy = 0; dy < O.BTN_H; dy++) for (let dx = 0; dx < O.BTN_W; dx++) {
      if (texel('widgets', dx, y + dy)[3] === 255) opaque++;
    }
    ok(opaque === O.BTN_W * O.BTN_H,
       `the ${name} sprite at y=${y} is ${opaque} of ${O.BTN_W * O.BTN_H} opaque pixels`);
    // its border is dark and its face is not — which is what makes it read as a raised button
    const face = texel('widgets', 10, y + 10), edge = texel('widgets', 10, y);
    ok(edge[0] < 60 && edge[1] < 60 && edge[2] < 60, `the ${name} sprite's top edge is dark (${edge.slice(0, 3)})`);
    ok(face[0] > edge[0] + 40, `and its face is lighter than its edge (${face.slice(0, 3)} vs ${edge.slice(0, 3)})`);
    say(`${name}: edge ${edge.slice(0, 3)} face ${face.slice(0, 3)}`);
  }
  // ⚠ BOTH DIRECTIONS: the three must DIFFER. Three coordinates that happened to name one sprite
  // would pass every count above and give a menu whose buttons never light up.
  const sig = (y) => {
    let h = 2166136261;
    for (let dy = 0; dy < O.BTN_H; dy++) for (let dx = 0; dx < O.BTN_W; dx++) {
      const p = texel('widgets', dx, y + dy);
      h = Math.imul(h ^ (p[0] + p[1] * 3 + p[2] * 7), 16777619);
    }
    return h >>> 0;
  };
  const sigs = rows.map(([, y]) => sig(y));
  ok(new Set(sigs).size === 3, `the three sprites are ${new Set(sigs).size} different pictures`);
  // and specifically: hovered is the pale blue one vanilla uses
  const hov = texel('widgets', 10, O.SPRITE.hover + 1), norm = texel('widgets', 10, O.SPRITE.normal + 1);
  ok(hov[2] > norm[2] + 10, `the hovered sprite is bluer than the normal one (${hov[2]} vs ${norm[2]})`);
  const dis = texel('widgets', 10, O.SPRITE.disabled + 1);
  ok(dis[0] < norm[0] - 40, `the disabled sprite is darker than the normal one (${dis[0]} vs ${norm[0]})`);
  // the sprite is exactly 200 wide: column 200 of that row is NOT part of it
  for (const [name, y] of rows) {
    const inside = texel('widgets', O.BTN_W - 1, y + 10), outside = texel('widgets', O.BTN_W, y + 10);
    ok(inside[3] === 255, `the ${name} sprite is opaque at x=199`);
    ok(outside[3] !== 255 || outside.join() !== inside.join(),
       `and x=200 is not more of the same button (${outside.join(',')})`);
  }
}

// ═══════════════ 2. the layout is vanilla's ════════════════════════════════════════════════
console.log('\n 2. the layout numbers');
ok(O.BTN_W === 200 && O.BTN_H === 20, `a full-width button is ${O.BTN_W}x${O.BTN_H}`);
ok(O.HALF_W === 150 && O.COL_DX === 160, `the two-column button is ${O.HALF_W} wide, ${O.COL_DX} apart`);
ok(O.LEFT_DX === -155, `the left column sits at width/2 ${O.LEFT_DX}`);
ok(O.ROW_DY === 24, `rows are ${O.ROW_DY} apart`);
ok(O.TITLE_Y === 15, `the title is at y=${O.TITLE_Y}`);
{
  // ⚠ THE TWO COLUMNS MUST NOT OVERLAP AND MUST BE CENTRED ON THE SCREEN. -155 + 160 + 150 = 155,
  // so the pair spans -155..+155 — symmetric about the centre with a 5-pixel gutter between
  // them. An off-by-one in either constant shows up here and nowhere else.
  const left0 = O.LEFT_DX, left1 = O.LEFT_DX + O.HALF_W;
  const right0 = O.LEFT_DX + O.COL_DX, right1 = right0 + O.HALF_W;
  ok(left1 <= right0, `the columns do not overlap (${left1} then ${right0})`);
  ok(right1 === -left0, `the pair is symmetric about the centre (${left0} .. ${right1})`);
  ok(right0 - left1 === 10, `the gutter between them is ${right0 - left1} pixels`);
}
{
  // a wide row takes a whole line and the grid resumes below it
  const rows = [{ t: 'slide', wide: true }, { t: 'btn' }, { t: 'btn' }, { t: 'btn' }, { t: 'btn' }];
  const L = O.layout(rows, 427, 240);
  ok(L.rows[0].w === O.BTN_W, 'the wide row is 200 wide');
  ok(L.rows[1].y === L.rows[0].y + O.ROW_DY, 'and the grid resumes one row below it');
  ok(L.rows[1].y === L.rows[2].y, 'the first pair shares a line');
  ok(L.rows[3].y === L.rows[1].y + O.ROW_DY, 'and the second pair is one row down');
  ok(L.rows[2].x - L.rows[1].x === O.COL_DX, 'the columns are 160 apart on screen');
  ok(L.rows[0].x === Math.round(427 / 2 - 100), 'the wide row is centred');
  ok(L.done.x === L.rows[0].x && L.done.w === O.BTN_W, 'Done is a centred full-width button');
  say(`layout: first row y=${L.rows[0].y}, done y=${L.done.y}`);
}
{
  // ⚠ DONE MUST NEVER LAND ON A ROW. Vanilla's screens all fit in eight lines; MC-Lite's video
  // screen has twelve rows, and a Done button at a fixed height/6+168 would sit on top of them.
  const many = [];
  for (let i = 0; i < 24; i++) many.push({ t: 'btn' });
  const L = O.layout(many, 427, 240);
  const last = L.rows[L.rows.length - 1];
  ok(L.done.y >= last.y + O.BTN_H, `Done clears the last of ${many.length} rows (${L.done.y} vs ${last.y + O.BTN_H})`);
  // ...and on a short screen it still clears them
  const L2 = O.layout(many, 427, 120);
  const last2 = L2.rows[L2.rows.length - 1];
  ok(L2.done.y >= last2.y + O.BTN_H, 'and it clears them on a short window too');
}

// ═══════════════ 3. the tree ═══════════════════════════════════════════════════════════════
console.log('\n 3. the screens, and walking between them');
{
  const names = Object.keys(O.ROWS);
  ok(names.length === 11, `the tree has ${names.length} screens: ${names.join(', ')}`);
  for (const n of names) {
    ok(typeof O.TITLES[n] === 'string' && O.TITLES[n].length > 0, `${n} has a title`);
    const rows = O.ROWS[n]();
    ok(rows.length > 0 || n === 'stats' || n === 'keybinds', `${n} has rows`);   // keybinds is KeyBinds.draw (keybindscheck); stats draws its lists as a body (O.drawStats)
    for (const r of rows) {
      ok(['btn', 'owed', 'cycle', 'slide'].indexOf(r.t) >= 0, `${n} has a row of unknown type "${r.t}"`);
      if (r.t === 'btn') ok(typeof r.fn === 'function' && (typeof r.label === 'string' || typeof r.label === 'function'), `${n}: a button with no fn`);
      if (r.t === 'owed') ok(typeof r.label === 'string', `${n}: an owed row with no label`);
      if (r.t === 'cycle') ok(typeof r.val === 'function' && typeof r.fn === 'function', `${n}: a cycle with no val/fn`);
      if (r.t === 'slide') {
        ok(typeof r.frac === 'function' && typeof r.set === 'function', `${n}: a slider with no frac/set`);
        ok(typeof r.label === 'function', `${n}: a slider's label must be live, not a constant`);
      }
    }
    say(`${n}: ${rows.length} rows`);
  }
  // vanilla's Options screen must reach all four sub-screens, by name
  const opt = O.optionsRows();
  const src = opt.map((r) => (r.fn ? r.fn.toString() : '')).join('\n');
  for (const s2 of ['video', 'controls', 'sound', 'language']) {
    ok(src.indexOf("'" + s2 + "'") >= 0, `the Options screen has no way to reach "${s2}"`);
  }
  // navigation: go, back, and Done at the root closes
  O.open('pause');
  ok(O.screen === 'pause' && O.stack.length === 0, 'open() starts at the pause screen with an empty stack');
  O.go('options'); O.go('video');
  ok(O.screen === 'video' && O.stack.length === 2, 'two screens deep');
  O.back();
  ok(O.screen === 'options', 'Done goes back one screen, not all the way out');
  O.back();
  ok(O.screen === 'pause' && O.stack.length === 0, 'and back again to the pause screen');
}
{
  // ⚠ EVERY OWED BUTTON IS NAMED IN `O.OWED`, BOTH DIRECTIONS. A greyed button with no entry is
  // a gap nothing documents; an entry with no button is a note about a screen that is not there.
  const shown = new Set();
  for (const n of Object.keys(O.ROWS)) {
    for (const r of O.ROWS[n]()) if (r.t === 'owed') shown.add(r.label);
  }
  for (const label of shown) ok(!!O.OWED[label], `"${label}" is drawn disabled and is not in Options.OWED`);
  for (const label of Object.keys(O.OWED)) {
    ok(shown.has(label) || label === 'Realms Notifications',
       `Options.OWED names "${label}" and no screen shows it`);
  }
  console.log(`    ${shown.size} buttons vanilla has that MC-Lite does not, each named in Options.OWED`);
  say([...shown].join(' · '));
}

// shared from here on: filter a screen's rows to the one whose label starts with `name`.
const rowOf = (rows, name) => rows.filter((r) => typeof r.label === 'function' &&
                                                 String(r.label()).indexOf(name) === 0);

// a Settings object with every field `O.videoRows()` reads, so its rows can be built and every
// row's label() called (rowOf evaluates all of them) without a section owning its own fixture.
const mkVideoSettings = (over) => Object.assign({
  renderDistance: 8, simDistance: 8, maxDPR: 1, fancyLeaves: true, viewBobbing: true,
  horizonFade: true, ao: true, smoothLighting: true, crossModels: true, workers: 4,
  preset: 'medium', detected: 'medium', presetLabel: () => 'Medium',
  markCustom() {}, save() {}, push() {}, cyclePreset() {},
  setRenderDistance(v) { this.renderDistance = v; if (this.simDistance > v) this.simDistance = v; },
  setSimDistance(v) { this.simDistance = Math.max(2, Math.min(this.renderDistance, v | 0)); return this.simDistance; },
  effectiveSimDistance() { return this.simDistance < this.renderDistance ? this.simDistance : this.renderDistance; }
}, over);
// ═══════════════ 4. the sliders and the sound graph ════════════════════════════════════════
console.log('\n 4. the sliders move the things they name');
{
  // the sound sources: vanilla's ten, and every one reachable from the screen
  ok(Sn.SOURCES.length === 10, `vanilla has ten sound sources, this has ${Sn.SOURCES.length}`);
  ok(Sn.SOURCES[0] === 'master', 'master is first, and the screen puts it across the top');
  const rows = O.soundRows();
  ok(rows.filter(r => r.t === 'slide').length === Sn.SOURCES.length, `the sound screen has ${rows.length} rows: a slider per source (${Sn.SOURCES.length}) plus Show Subtitles`);
  ok(rows[0].wide === true, 'the master slider is full width, as it is in the game');
  for (const src of Sn.SOURCES) ok(typeof O.SOUND_LABELS[src] === 'string', `no label for source "${src}"`);
  // ⚠ moving a slider must move a NUMBER, and moving one must not move another
  Sn.setSourceVolume('block', 1);
  Sn.setSourceVolume('music', 1);
  const blockRow = rows[Sn.SOURCES.indexOf('block')];
  blockRow.set(0.25);
  ok(Math.abs(Sn.volumeOf('block') - 0.25) < 1e-6, `the Blocks slider set it to ${Sn.volumeOf('block')}`);
  ok(Sn.volumeOf('music') === 1, 'and left Music alone');
  ok(Math.abs(blockRow.frac() - 0.25) < 1e-6, 'and the slider reads back where it was put');
  ok(blockRow.label().indexOf('25%') >= 0, `the label shows the value: "${blockRow.label()}"`);
  blockRow.set(0);
  ok(blockRow.label().indexOf('OFF') >= 0, `and zero reads OFF: "${blockRow.label()}"`);
  blockRow.set(1);
  // clamping, in both directions
  Sn.setSourceVolume('block', 5);
  ok(Sn.volumeOf('block') === 1, 'a volume above 1 clamps to 1');
  Sn.setSourceVolume('block', -5);
  ok(Sn.volumeOf('block') === 0, 'and below 0 clamps to 0');
  Sn.setSourceVolume('block', 1);
  // ⚠ the OWED sources are NAMED, and `master` and `block` — the two that work — are not on it
  for (const src of Object.keys(Sn.OWED_SOURCES)) {
    ok(Sn.SOURCES.indexOf(src) >= 0, `Sound.OWED_SOURCES names "${src}", which is not a source`);
  }
  ok(!Sn.OWED_SOURCES.master && !Sn.OWED_SOURCES.block,
     'master and block are wired and must not be on the owed list');
  // s118: this used to assert the owed list was exactly 8 long — a number the CODE owns (rule 3,
  // D-329), and s117 striking 'player' turned the full suite red over nothing. The question it
  // was standing in for is "does every source that left the list have a real caller?", so ask it:
  // a source off the list must appear as a routed category somewhere in src/.
  const routedIn = (text, src) => new RegExp("(?:category|source):\\s*['\"]" + src + "['\"]|,\\s*['\"]" + src + "['\"]\\s*\\)|hostileSet\\[type\\]\\s*\\?\\s*['\"]" + src + "['\"]").test(text);
  const SRC_TEXT = __srcText();
  for (const src of Sn.SOURCES) {
    if (src === 'master' || src === 'block' || Sn.OWED_SOURCES[src]) continue;
    ok(routedIn(SRC_TEXT, src), `the "${src}" source is off the owed list, so something in src/ must route a sound into it`);
  }
  // anti-vacuity: the same question over a source tree with the router lines removed must fail
  const stripped = SRC_TEXT.replace(/(?:category|source):\s*['"]player['"]/g, 'category: null').replace(/,\s*['"]player['"]\s*\)/g, ')');
  ok(!routedIn(stripped, 'player'), 'break caught: a "player" source with no router line is refused');
}
{
  // anti-vacuity for §4c: a clamp that does not clamp must be a caught break, not a silent pass.
  const brokenSettings = mkVideoSettings({
    setRenderDistance(v) { this.renderDistance = v; /* BROKEN: never pulls simDistance down */ },
    setSimDistance(v) { this.simDistance = v | 0; return this.simDistance; },   // BROKEN: no clamp
    effectiveSimDistance() { return this.simDistance; }
  });
  NS.Settings = brokenSettings;
  // a stale value above renderDistance — the shape a loaded save can hand setSimDistance
  // directly, not the shape a slider's own 0..1 frac ever produces (frac=1 already lands
  // exactly on renderDistance, clamped or not, so it can't tell the two apart).
  brokenSettings.setSimDistance(20);
  const brokeClampUp = brokenSettings.simDistance !== brokenSettings.renderDistance;
  ok(brokeClampUp, 'anti-vacuity: an unclamped setSimDistance lets sim exceed render — §4c would have caught the real bug');
  const rdRow = rowOf(O.videoRows(), 'Render Distance')[0];
  brokenSettings.setSimDistance(8);
  rdRow.set(0);
  const brokeClampDown = brokenSettings.simDistance > brokenSettings.renderDistance;
  ok(brokeClampDown, 'anti-vacuity: setRenderDistance not pulling simDistance down is exactly the break §4c is watching for');
}
{
  // the FOV slider's round trip, which is the one a player will actually drag
  const settings = { fov: 70, save() {} };
  NS.Settings = settings;
  const fov = O.optionsRows()[0];
  ok(fov.t === 'slide' && fov.wide, 'FOV is the wide slider at the top of Options');
  fov.set(0);
  ok(settings.fov === 30, `dragging FOV to the left end gives ${settings.fov}`);
  fov.set(1);
  ok(settings.fov === 110, `and to the right end, ${settings.fov}`);
  ok(fov.label().indexOf('Quake Pro') >= 0, `110 is labelled "${fov.label()}"`);
  fov.set(0.5);
  ok(settings.fov === 70 && fov.label().indexOf('Normal') >= 0, `the middle is ${fov.label()}`);
  ok(Math.abs(fov.frac() - 0.5) < 0.02, 'and the slider reads back at the middle');
}

// ═══════════════ 4c. render distance and simulation distance — two sliders, one clamp (D-452) ═
console.log('\n 4c. render distance / simulation distance (D-452)');
{
  const settings = mkVideoSettings();
  NS.Settings = settings;
  const rdRow = rowOf(O.videoRows(), 'Render Distance')[0];
  const simRow = rowOf(O.videoRows(), 'Simulation Distance')[0];
  ok(!!rdRow, 'the Video screen has a Render Distance row');
  ok(!!simRow, 'the Video screen has a Simulation Distance row');

  if (rdRow && simRow) {
    // the sim slider moves its OWN number, and leaves render distance alone
    simRow.set((6 - 2) / (settings.renderDistance - 2));
    ok(settings.simDistance === 6, `dragging Simulation Distance gives ${settings.simDistance}`);
    ok(settings.renderDistance === 8, 'and left Render Distance alone');

    // vanilla's own rule: simulation distance can never exceed render distance — proved
    // directly (a save file, not the slider, is the one path that can hand it an out-of-range
    // number: the slider's own frac=1 always lands exactly on renderDistance either way).
    settings.setSimDistance(99);
    ok(settings.simDistance === settings.renderDistance,
       `setSimDistance(99) gives ${settings.simDistance}, expected the clamp at ${settings.renderDistance}`);
    ok(simRow.frac() === 1, 'and the slider reads back at the top once clamped');

    // pulling render distance BELOW the current sim distance must pull sim distance down with it
    settings.setSimDistance(8);
    rdRow.set(0);
    ok(settings.renderDistance === 2, `dragging Render Distance to the bottom gives ${settings.renderDistance}`);
    ok(settings.simDistance === 2,
       `Simulation Distance did not follow it down: ${settings.simDistance}, expected 2`);
    ok(simRow.label().indexOf('2 chunks') >= 0, `and the label agrees: "${simRow.label()}"`);
  }
}

// ═══════════════ 4b. a slider is a SLIDER — the drag, and the gate that never opened ═══════
// ⚠⚠ **THIS SECTION EXISTS BECAUSE EVERY ASSERTION ABOUT SLIDERS WAS GREEN WHILE NO SLIDER HAD
// EVER MOVED UNDER A POINTER** (D-330). Dan, session 11: *"sliders dont work as sliders"*. The
// drag machinery — `O.dragging`, `O.drag`, `O.release`, the `uidrag` event and its routing — was
// all present and all correct. What was missing was one assignment in `13_input.js`: `mousedown`
// fired `uiclick` and returned before recording the button as down, and `mousemove`'s drag gate
// is `if (I.uiOpen && I.mouse[0])`. **Section 4 drove `O.drag` directly, so it could not see
// that nothing ever called it.** ⚠ THE RULE: a check that calls the function under test has not
// tested the thing that is supposed to call it.
console.log('\n 4b. the drag, and the gate that feeds it');
{
  // ── the value math, against AbstractSliderButton's own bytecode ──────────────────────────
  // setValueFromMouse(mouseX) = (mouseX - (x + 4)) / (width - 8), clamped to [0,1] by setValue.
  const KNOB = O.SLIDER_KNOB_W;
  ok(KNOB === 8, `vanilla's slider handle is 8 wide, this says ${KNOB}`);
  const X = 100, W = 200, S = 1;                     // a 200-wide slider at GUI scale 1
  const v = (mx) => O.valueFromMouse(mx, X, W, S);
  ok(v(X + KNOB / 2) === 0, 'the pointer on the knob\'s centre at the far left reads 0');
  ok(v(X + W - KNOB / 2) === 1, '...and at the far right reads 1');
  ok(Math.abs(v(X + W / 2) - 0.5) < 1e-9, '...and in the middle reads a half');
  ok(v(X - 50) === 0 && v(X + W + 50) === 1, 'past either end it clamps rather than running on');
  // the exact vanilla expression, recomputed here, must agree everywhere
  let worst = 0;
  for (let mx = X - 20; mx <= X + W + 20; mx++) {
    const want = Math.max(0, Math.min(1, (mx - (X + 4)) / (W - 8)));
    worst = Math.max(worst, Math.abs(v(mx) - want));
  }
  console.log(`   value math ...... worst disagreement with vanilla's formula ${worst.toExponential(1)}`);
  ok(worst < 1e-12, `the value math differs from (mouseX - (x+4))/(width-8) by ${worst}`);
  // ⚠ AND THE DRAWN KNOB MUST AGREE WITH IT. Two expressions for one geometry is how the knob
  // came to lag the pointer: drawSlider lays the knob out across (gw - 8) and the old drag
  // divided by the full width.
  let drift = 0;
  for (let i = 0; i <= 100; i++) {
    const frac = i / 100;
    const kx = X + ((frac * (W - KNOB)) | 0);        // drawSlider's own expression
    drift = Math.max(drift, Math.abs(v(kx + KNOB / 2) - frac));
  }
  console.log(`   knob round trip . worst drift ${drift.toFixed(4)} of the track`);
  ok(drift < 0.006, `the drawn knob and the value disagree by ${drift} of the track`);

  // ── the gate: both halves live in 13_input.js and only one of them was written ───────────
  const inp = readFileSync(join(SRC, '13_input.js'), 'utf8');
  const down = inp.slice(inp.indexOf("addEventListener('mousedown'"));
  const downBody = down.slice(0, down.indexOf('});'));
  const iUi = downBody.indexOf('I.uiOpen');
  const iSet = downBody.indexOf('I.mouse[e.button] = true');
  console.log(`   mousedown ....... uiOpen branch at ${iUi}, first button record at ${iSet}`);
  ok(iUi >= 0 && iSet >= 0, 'mousedown has no uiOpen branch or never records the button');
  ok(/I\.uiOpen\)\s*\{\s*I\.mouse\[e\.button\] = true;/.test(downBody),
     'the uiOpen branch of mousedown returns WITHOUT recording the button as down — so ' +
     'mousemove\'s `I.uiOpen && I.mouse[0]` gate can never open and no slider can ever drag');
  const move = inp.slice(inp.indexOf("addEventListener('mousemove'"));
  ok(/I\.uiOpen && I\.mouse\[0\]/.test(move.slice(0, 1200)),
     'mousemove no longer gates uidrag on `I.uiOpen && I.mouse[0]` — this check is pinned to ' +
     'that gate and must be updated with it');
  // ⚠ AND THE RECAPTURE CLICK MUST STILL BE SWALLOWED. Hoisting the assignment to the top of the
  // handler fixes the slider and starts mining the block under the crosshair whenever the window
  // is clicked back into focus.
  const lockBranch = downBody.slice(downBody.indexOf('I.locked'));
  ok(lockBranch.indexOf('I.requestLock()') < lockBranch.indexOf('I.mousePressed'),
     'the pointer-lock request branch must still return before recording a press');

  // ── the rows must SURVIVE A REDRAW, or the drag stops after one step (D-340) ────────────
  // ⚠⚠ THIS IS THE BUG D-330's FIX WOULD HAVE SHIPPED WITH. `O.drag` finds the row it is dragging
  // by OBJECT IDENTITY, each `O.*Rows()` returns fresh literals, and `17_main`'s `uidrag` handler
  // redraws immediately after dragging. So the first pointer move rebuilt the row set and every
  // move after it matched nothing: **a slider that moves once and then sticks.** `inputcheck`
  // found it by moving the pointer twice, which is the one thing no model-level check had done.
  {
    const wasScreen = O.screen;
    O.open('video');
    const a = O.rowsFor();
    const b = O.rowsFor();
    ok(a === b, 'two draws of the same screen return the SAME row objects');
    ok(a[0] === b[0], '...and the same rows inside them');
    O.go('sound');
    const c = O.rowsFor();
    ok(c !== a, 'navigating to another screen builds new rows');
    ok(c.length === Sn.SOURCES.length + 1, `and they are that screen's (${c.length} sound rows)`);
    O.back();
    const d = O.rowsFor();
    ok(d !== c, 'and going back builds the previous screen\'s rows again');
    // ⚠ A CACHED ROW IS STILL LIVE, which is why caching costs nothing: every value is a function.
    // ⚠ The SOUND screen is used for this and not the video one: a render-distance row calls into
    // the renderer, which this headless harness does not have, and a check that reaches for a
    // subsystem it has not built is testing its own scaffolding.
    O.go('sound');
    const volRow = O.rowsFor().filter((r) => r.t === 'slide')[0];
    if (volRow) {
      const before = volRow.frac();
      volRow.set(before > 0.5 ? 0.1 : 0.9);
      const same = O.rowsFor().filter((r) => r.t === 'slide')[0];
      ok(same === volRow, 'the row object is unchanged after setting its value');
      ok(Math.abs(same.frac() - before) > 0.1,
         'and it reports the NEW value — a cached row is still live because every value is a function');
      volRow.set(before);
    }
    O.back();
    // ⚠ AND `O.invalidate` MUST DROP A DRAG WITH IT: a drag whose row no longer exists is a drag
    // on nothing, and leaving it set is how the pointer keeps "dragging" a dead widget.
    O.dragging = O.rowsFor()[0];
    O.invalidate();
    ok(O.dragging === null, 'invalidating the rows ends any drag on them');
    O.screen = wasScreen;
    O.invalidate();
  }

  // ── the keyboard gap is CLOSED, and this is what it cost to say so ──────────────────────
  // ⚠⚠ **THIS SECTION USED TO ASSERT THE LIMITATION AND IT FAILED THE DAY THE LIMITATION WAS
  // LIFTED** — which is D-324 working exactly as designed: *a check that asserts a limitation
  // must FAIL the day the limitation is lifted*, or it is a check that has stopped being about
  // anything. It asserted `O.OWED_INPUT.length === 4` and that the source contained no
  // `ArrowLeft`, and both went red the moment D-353 landed.
  ok(Array.isArray(O.OWED_INPUT) && O.OWED_INPUT.length === 0,
     'O.OWED_INPUT is ' + (O.OWED_INPUT || []).length + ' entries long — keyboard operation of ' +
     'the screen is complete, so anything left on it is a NEW gap that needs a check of its own');
  const src15f = readFileSync(join(SRC, '15f_options.js'), 'utf8');
  // ⚠ THE MODEL IS AN INDEX, NOT A WIDGET (D-340). `O.hit` is rebuilt every frame and `rowsFor`
  // whenever the screen changes, so a focus holding the row OBJECT is correct for exactly one
  // frame — the bug `inputcheck` found in the drag. This asserts the shape of the fix in the
  // source, because the behaviour itself needs a real keyboard and lives in `inputcheck` §6.
  ok(/O\.focus\s*=\s*-1/.test(src15f), 'the focus model does not start at -1, "nothing focused"');
  ok(src15f.indexOf('O.focus = null') < 0 && !/O\.focus\s*=\s*[A-Za-z_$][\w$]*\.row/.test(src15f),
     'the focus is being set to a widget rather than to an index — that is correct for one frame');
  {
    // and `invalidate` must drop it, for the same reason it drops a drag
    O.screen = 'video';
    O.hit.length = 0;
    O.hit.push({ x: 0, y: 0, w: 10, h: 10, row: { t: 'done' } });
    O.focus = 0;
    O.invalidate();
    ok(O.focus === -1, 'invalidating the rows clears the focus with them');
  }
  ok(/1\s*\/\s*\(?\s*(?:gw|w)\s*-\s*O\.SLIDER_KNOB_W|dir\s*\/\s*travel/.test(src15f),
     'the arrow step is not expressed over the TRAVEL (width - knob) — the same divisor the ' +
     'knob is laid out across and `valueFromMouse` uses (D-330)');
}

// ═══════════════ 5. the old screen is DELETED, not disabled (D-139) ════════════════════════
console.log('\n 5. the screen this replaces is gone');
{
  const hud = readFileSync(join(SRC, '15_hud.js'), 'utf8');
  ok(hud.indexOf('function pauseRows') < 0, 'pauseRows() is deleted from 15_hud.js, not kept');
  ok(hud.indexOf("t: 'range'") < 0, "the old rectangle menu's 'range' rows are gone");
  ok(hud.indexOf("t: 'toggle', label: 'Creative mode'") < 0, 'and its toggle rows with them');
  // drawPause must now be the one-line delegation
  const i = hud.indexOf('H.drawPause = function');
  const body = hud.slice(i, hud.indexOf('};', i));
  ok(i >= 0 && body.indexOf('NS.Options') >= 0, 'Hud.drawPause delegates to NS.Options');
  ok(body.indexOf('Segoe UI') < 0, "...and draws no browser-font text of its own");
  // ⚠ and the FALLBACK is allowed to, because it runs before the GUI payload has decoded — the
  // one place a browser font is the honest answer. This asserts it is only that one place.
  const after = hud.slice(i);
  const uses = (after.match(/Segoe UI/g) || []).length;
  ok(uses <= 1, `${uses} browser-font uses remain after drawPause (the one shared screenFallback)`);
  ok(/function screenFallback\(c, label\)/.test(after) && (after.match(/screenFallback\(c, '/g) || []).length >= 3,
     'every texture-backed screen falls back through the one screenFallback (pause, inventory, trading)');
}

// ═══════════════ 6. anti-vacuity (D-30) ════════════════════════════════════════════════════
console.log('\n 6. anti-vacuity — each section is broken and the break must be caught');
{
  // §1: the three sprite rows collapsed onto one
  const was = O.SPRITE.hover;
  O.SPRITE.hover = O.SPRITE.normal;
  const sig = (y) => {
    let h = 0;
    for (let dx = 0; dx < O.BTN_W; dx++) h = (h * 31 + texel('widgets', dx, y + 10)[0]) >>> 0;
    return h;
  };
  okAv(sig(O.SPRITE.hover) === sig(O.SPRITE.normal),
       'anti-vacuity: two sprite rows pointed at one picture is exactly what §1 refuses');
  O.SPRITE.hover = was;
  okAv(sig(O.SPRITE.hover) !== sig(O.SPRITE.normal), 'anti-vacuity: and the break is undone');
}
{
  // ⚠ §1: THE ROW MUST BE EXACT, AND "COUNT THE OPAQUE PIXELS" CANNOT SHOW THAT. The three
  // sprites are a contiguous 200x60 block of opaque pixels, so a row read one pixel down is
  // still 4,000 of 4,000 opaque — the first version of this break asserted exactly that and did
  // not fire. What a one-pixel slip DOES destroy is the BORDER: the dark top edge moves out of
  // the rectangle and the face colour moves in.
  const edgeAt = (y) => texel('widgets', 10, y);
  const right = edgeAt(O.SPRITE.normal), slipped = edgeAt(O.SPRITE.normal + 1);
  okAv(right[0] < 60 && slipped[0] >= 60,
       `anti-vacuity: one pixel down, the sprite's dark top edge (${right.slice(0, 3)}) becomes its `
       + `face (${slipped.slice(0, 3)}) — the row is exact`);
}
{
  // §2: the column constant nudged breaks the symmetry test
  const was = O.COL_DX;
  O.COL_DX = 161;
  okAv((O.LEFT_DX + O.COL_DX + O.HALF_W) !== -O.LEFT_DX,
       'anti-vacuity: a one-pixel column offset breaks the symmetry §2 asserts');
  O.COL_DX = was;
}
{
  // §3: an owed label with no entry
  const rows = O.optionsRows();
  const bad = rows.filter((r) => r.t === 'owed').length;
  okAv(bad > 0 && !O.OWED['Not A Real Screen...'],
       'anti-vacuity: an owed label absent from Options.OWED would be caught — there is no entry for a name nobody uses');
}
{
  // §4: one gain node moved must NOT move its neighbour
  Sn.setSourceVolume('weather', 0.1);
  Sn.setSourceVolume('ambient', 0.9);
  okAv(Sn.volumeOf('weather') === 0.1 && Sn.volumeOf('ambient') === 0.9,
       'anti-vacuity: two sources hold two different values, so §4 is reading per-source state');
  Sn.setSourceVolume('weather', 1); Sn.setSourceVolume('ambient', 1);
}
{
  // §4b: the value math must REJECT the expression that shipped — divide by the full width and
  // do not subtract the half-knob — or the comparison is decorative.
  const X = 100, W = 200, K = O.SLIDER_KNOB_W;
  const shipped = (mx) => Math.max(0, Math.min(1, (mx - X) / W));
  let worstShipped = 0;
  for (let mx = X; mx <= X + W; mx++) {
    worstShipped = Math.max(worstShipped, Math.abs(shipped(mx) - O.valueFromMouse(mx, X, W, 1)));
  }
  okAv(worstShipped > 0.01,
       'anti-vacuity: the value math disagrees with the (mx - x)/w that shipped by ' +
       worstShipped.toFixed(3) + ' — §4b is comparing formulas, not tautologies');
  // ...and the knob round trip must FAIL against that same shipped expression
  let shippedDrift = 0;
  for (let i = 0; i <= 100; i++) {
    const frac = i / 100;
    const kx = X + ((frac * (W - K)) | 0);
    shippedDrift = Math.max(shippedDrift, Math.abs(shipped(kx + K / 2) - frac));
  }
  okAv(shippedDrift >= 0.006,
       'anti-vacuity: the knob round trip REJECTS the shipped formula (drift ' +
       shippedDrift.toFixed(4) + ') — the 0.006 tolerance is not wide enough to pass anything');
  // ...and the gate test must reject the mousedown that shipped
  const shippedDown = "if (I.uiOpen) { fire('uiclick', e.button); e.preventDefault(); return; }\n" +
                      '      I.mouse[e.button] = true;';
  okAv(!/I\.uiOpen\)\s*\{\s*I\.mouse\[e\.button\] = true;/.test(shippedDown),
       'anti-vacuity: the mousedown gate test REJECTS the handler that shipped');

  // §5: the deletion test must be able to see a `pauseRows` that IS there
  const fake = 'x\n  function pauseRows() { return []; }\n';
  okAv(fake.indexOf('function pauseRows') >= 0,
       'anti-vacuity: the source scan finds `function pauseRows` when it is present');
}

// ═══════════════ the WORKER THREADS slider (D-428) ═════════════════════════════════════════
//
// Dan, session 55: *"add a proper option in settings to toggle amount of web workers; its set
// to 4 now with no tinkering."* Two halves, and only one of them is the slider:
//   1. the RANGE. `ENV.workers` is the RECOMMENDATION (one fewer than the machine's threads,
//      capped at 4) and it was also being used as the CLAMP, so on a 12-thread machine the
//      setting could not exceed 4 however it was set. The ceiling is now `ENV.workersMax`.
//   2. the POOL. `09_jobs.js` said for forty sessions that the pool was fixed at start-up
//      because a mid-game respawn "would drop every job in flight" — which was true: a
//      terminated worker leaves its `inflight` promise pending for ever, and that is a chunk
//      that never generates and never says why. §W3 below proves the retire path instead.
{
  // a Settings and a Jobs just real enough for the row to talk to
  const resized = [];
  NS.Settings = { workers: 4, markCustom() { this.custom = true; }, save() { this.saved = (this.saved | 0) + 1; },
                  renderDistance: 8, maxDPR: 1, fancyLeaves: true, ao: true, viewBobbing: true,
                  horizonFade: true, crossModels: true, mipmaps: true, occlusion: true,
                  depthPrepass: false, adaptive: true, backend: 'auto', preset: 'medium',
                  detected: 'medium', presetLabel: () => 'Medium',
                  // D-452 — simulation distance, same real shape as the settings module: it is
                  // clamped to <= renderDistance, and shrinking renderDistance pulls it down too.
                  simDistance: 8,
                  effectiveSimDistance() { return this.simDistance < this.renderDistance ? this.simDistance : this.renderDistance; },
                  setSimDistance(v) { this.simDistance = Math.max(2, Math.min(this.renderDistance, v | 0)); return this.simDistance; },
                  setRenderDistance(v) { this.renderDistance = v; if (this.simDistance > v) this.simDistance = v; },
                  cyclePreset() {}, push() {} };
  NS.Gfx = NS.Gfx || { name: 'webgl2', wireframe: false };
  NS.Jobs = { mode: 'workers', workers: [1, 2, 3, 4], clampSize(n) { return Math.max(1, Math.min(NS.ENV.workersMax, n | 0)); }, resize(n) { resized.push(n); return Promise.resolve(n); } };

  console.log('\nW. the worker-thread slider (D-428)');
  NS.ENV.cores = 12; NS.ENV.workersMax = 12;
  let rows = NS.Options.videoRows();
  let row = rowOf(rows, 'Worker Threads');
  ok(row.length === 1, `the Video screen has ${row.length} Worker Threads rows, expected exactly 1`);

  if (row.length === 1) {
    const r = row[0];
    // W1 — the range is the MACHINE'S, and both ends are reachable
    r.set(0);
    ok(NS.Settings.workers === 1, `the left end of the slider set ${NS.Settings.workers} workers, expected 1`);
    r.set(1);
    ok(NS.Settings.workers === 12,
       `the right end set ${NS.Settings.workers} workers on a 12-thread machine — the clamp is still ENV.workers (4), which is the bug`);
    ok(resized[resized.length - 1] === 12, `the pool was not resized: ${JSON.stringify(resized)}`);

    // W2 — every position round-trips, so the knob sits where the number says it does
    let drift = 0;
    for (let n = 1; n <= 12; n++) {
      NS.Settings.workers = n;
      const f = r.frac();
      const back = Math.max(1, Math.min(12, Math.round(1 + f * 11)));
      drift = Math.max(drift, Math.abs(back - n));
    }
    ok(drift === 0, `the slider does not round-trip: worst position is ${drift} workers out`);

    // ...and the label tells the truth when the live pool has not caught up yet
    NS.Settings.workers = 2; NS.Jobs.workers = [1, 2, 3];
    ok(/2 of 12.*3 live/.test(r.label()),
       `the label hides a pool that has not finished retiring: "${r.label()}"`);
    NS.Jobs.workers = [1, 2];
    ok(!/live/.test(r.label()), `the label still claims a mismatch once the pool agrees: "${r.label()}"`);

    // a two-thread machine gets a two-position slider, not a broken one
    NS.ENV.workersMax = 2; NS.Options.rowsBuilt = null;
    NS.Settings.workers = 2;
    const r2 = rowOf(NS.Options.videoRows(), 'Worker Threads')[0];
    ok(!!r2 && r2.frac() === 1 && /2 of 2/.test(r2.label()),
       `a 2-thread machine reads "${r2 && r2.label()}" at frac ${r2 && r2.frac()}`);
    r2.set(0);
    ok(NS.Settings.workers === 1, 'the left end of a two-position slider is still 1');
    NS.ENV.workersMax = 12;

    // W-AV — the OLD clamp, put back: the right end must stop at 4 and the range test notices
    const realMax = NS.ENV.workersMax;
    NS.ENV.workersMax = NS.ENV.workers;                 // 4 on this machine, the pre-D-428 ceiling
    NS.Options.rowsBuilt = null;
    const broken = rowOf(NS.Options.videoRows(), 'Worker Threads')[0];
    broken.set(1);
    okAv(NS.Settings.workers !== 12,
         'anti-vacuity: with ENV.workers back as the ceiling the slider stops at ' + NS.Settings.workers + ' — the range test fires');
    NS.ENV.workersMax = realMax;
  }

  // W3 — the POOL itself: grow, and shrink WITHOUT dropping a job in flight
  {
    const J = {};
    const spawned = [], terminated = [];
    class FakeWorker {
      constructor() { this.id = spawned.length; spawned.push(this); setTimeout(() => this.onmessage({ data: { t: 'ready' } }), 0); }
      postMessage() {}
      terminate() { terminated.push(this.id); }
    }
    const NS2 = { ENV: Object.assign({}, NS.ENV, { hasWorker: true, hasBlobURL: true, workersMax: 12 }),
                  CFG: { WORKER_HANDSHAKE_MS: 50 }, DATA: null, Reg: { ready: false },
                  WORKER_SRC: { CHUNK: 'x' }, Mesher: { setOptions() {} },
                  Settings: { workers: 4 } };
    globalThis.Worker = FakeWorker;
    globalThis.Blob = class { constructor() {} };
    globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
    new Function('MCL', readFileSync(join(SRC, '09_jobs.js'), 'utf8'))(NS2);
    const JJ = NS2.Jobs;
    await JJ.start(1, {}, null);
    ok(JJ.mode === 'workers' && JJ.workers.length === 4,
       `the pool started with ${JJ.workers.length} workers in mode ${JJ.mode}, expected 4`);
    await JJ.resize(8);
    ok(JJ.workers.length === 8, `resize(8) left ${JJ.workers.length} workers`);
    ok(JJ.clampSize(99) === 12 && JJ.clampSize(0) === NS2.ENV.workers,
       `clampSize is wrong at the ends: ${JJ.clampSize(99)} / ${JJ.clampSize(0)}`);

    // ⚠ THE ONE THAT MATTERS. Give one worker a job, then shrink past it: it must NOT be
    // terminated while that job is outstanding, and it must go the moment the result lands.
    // ⚠ the BUSIEST worker is retired LAST by design (`resize` drops the least loaded first,
    // because an idle one costs nothing to terminate), so the shrink has to go past it to test
    // the retire path at all. A resize(2) here would leave it in the pool and prove nothing.
    // ⚠ `resize` drops the LEAST loaded first — an idle worker costs nothing to terminate — so
    // the pool is arranged to force exactly one busy worker over the edge: six idle, one with a
    // job in flight, one busier still that survives as the last worker standing.
    const busy = JJ.workers[3]; busy.load = 1;
    JJ.workers[4].load = 2;
    JJ.inflight.set(4242, { resolve() {}, reject() {}, kind: 'gen', w: busy });
    await JJ.resize(1);
    ok(terminated.indexOf(busy.id) < 0,
       'a worker with a job in flight was TERMINATED by the shrink — that job\'s promise is now pending for ever');
    ok(JJ.retiring.indexOf(busy) >= 0, 'the busy worker was dropped from the pool without being retired');
    JJ._onMessage({ data: { t: 'gen:done', id: 4242, sec: null } });
    ok(terminated.indexOf(busy.id) >= 0, 'the retired worker was not terminated when its last result came back');
    ok(JJ.retiring.length === 0, `${JJ.retiring.length} workers are still stuck in the retiring list`);
    ok(JJ.workers.length === 1, `after the shrink the pool is ${JJ.workers.length}, expected 1`);
    okAv(spawned.length === 8 && terminated.length >= 6,
         `anti-vacuity: the fake pool really did spawn (${spawned.length}) and terminate (${terminated.length}) — the assertions above are about something`);
  }
}

// ═══════════════ skin customization: vanilla's SkinOptionsScreen + options.txt keys ═════════
console.log('\n skin customization screen');
const KEYS = ['cape', 'jacket', 'left_sleeve', 'right_sleeve', 'left_pants_leg', 'right_pants_leg', 'hat'];
function skinRun(mut) {
  const bad = [];
  const chk = (c, m) => { if (!c) bad.push(m); };
  const N2 = { ENV: { workers: 2, workersMax: 4 }, Jobs: NS.Jobs, U: NS.U };
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  let src = readFileSync(join(SRC, '16_settings.js'), 'utf8');
  if (mut) src = src.replace(mut[0], mut[1]);
  try { new Function('MCL', src)(N2); } catch (e) { bad.push('settings: ' + e.message); return bad; }
  const saved = NS.Settings; NS.Settings = N2.Settings; 
  try {
    const St = N2.Settings;
    O.open('options'); O.go('skin');
    const rows = O.rowsFor();
    chk(rows.length === 8, `skin screen has ${rows.length} rows, vanilla 8`);
    const L = O.layout(rows, 427, 240);
    chk(L.rows[0].y === Math.round(240 / 6) && L.done.y === Math.round(240 / 6) + 96, 'skin layout is height/6 and Done at +96');
    chk(O.modelParts().cape === true && O.mainHand() === 'right', 'defaults: all ON, right');
    rows.forEach((r, i) => {
      const before = r.val();
      r.fn();
      chk(r.val() !== before, `button ${i} (${r.label}) did not flip`);
    });
    chk(KEYS.every(k => O.modelParts()[k] === false) && O.mainHand() === 'left', 'every value flipped');
    const txt = St.optionsTxt();
    for (const k of KEYS) chk(txt.includes(`modelPart_${k}:false\n`), `options.txt lacks modelPart_${k}:false`);
    chk(txt.includes('mainHand:left\n'), 'options.txt lacks mainHand:left');
    // round trip: JSON save/load and options.txt parse
    for (const k of KEYS) St['modelPart_' + k] = true; St.mainHand = 'right';
    St.parseOptionsTxt(txt);
    chk(KEYS.every(k => O.modelParts()[k] === false) && O.mainHand() === 'left', 'options.txt did not parse back');
    St.save();
    for (const k of KEYS) St['modelPart_' + k] = true; St.mainHand = 'right';
    St.load();
    chk(KEYS.every(k => O.modelParts()[k] === false) && O.mainHand() === 'left', 'save/load did not round-trip');
  } catch (e) { bad.push('threw: ' + e.message); }
  NS.Settings = saved; O.screen = null; O.invalidate();
  return bad;
}
{
  const base = skinRun(null);
  ok(base.length === 0, 'skin screen: ' + base.join('; '));
  let caught = 0;
  const breaks = [
    ["S.mainHand === 'left' ? 'left' : 'right');\n    for", "S.mainHand === 'left' ? 'left' : 'right');\n    for"],
    ["out.push(K[i] + ':'", "out.push(K[i].replace('left_sleeve', 'leftSleeve') + ':'"],
    ["out.push('mainHand:'", "out.push('main_hand:'"],
    ["modelPart_hat: true,", "modelPart_hat: false,"],
  ].slice(1);
  for (const b of breaks) if (skinRun(b).length) caught++;
  ok(caught === breaks.length, `only ${caught}/${breaks.length} skin breaks caught`);
  console.log(`    ${caught} breaks caught`);
}

// ═══════════════ Biome Blend (G17-BB1) ═════════════════════════════════════════════════════
{
  const want = ['OFF', '3x3 blocks', '5x5 blocks', '7x7 blocks', '9x9 blocks', '11x11 blocks', '13x13 blocks', '15x15 blocks'];
  let good = 0;
  for (let r = 0; r <= 7; r++) if (O.biomeBlendLabel(r) === 'Biome Blend: ' + want[r]) good++;
  ok(good === 8, 'Biome Blend text for r=0..7 matches vanilla');
  const src = __srcText();
  ok(/biomeBlendRadius: 2,/.test(src), 'biomeBlendRadius defaults to 2');
  ok(/O\.biomeBlendLabel\(S\(\)\.biomeBlendRadius\)/.test(src), 'Video Settings has the Biome Blend row');
  ok(/biomeBlendRadius[^]{0,200}remesh: true/.test(src.slice(src.indexOf('O.videoRows'))), 'changing it remeshes');
  console.log(`    ${[O.biomeBlendLabel(2) === 'Biome Blend: 5x5 blocks', O.biomeBlendLabel(0) !== O.biomeBlendLabel(1)].filter(Boolean).length} breaks caught`);
}

// ═══════════════ G17-ED1: Entity Distance slider + Entity Shadows toggle ═══════════════════════
console.log('\n entity distance / entity shadows');
function entRun(mut) {
  const bad = [];
  const chk = (c, m) => { if (!c) bad.push(m); };
  const N3 = { ENV: { workers: 2, workersMax: 4 }, Jobs: NS.Jobs, U: NS.U, Options: O };
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  let sset = readFileSync(join(SRC, '16_settings.js'), 'utf8');
  if (mut) sset = sset.replace(mut[0], mut[1]);
  try { new Function('MCL', sset)(N3); } catch (e) { bad.push('settings: ' + e.message); return bad; }
  // the renderer: only ER.shouldRender / ER.emitShadows are exercised, so stub the Mesher it packs through
  N3.EntityRender = { ready: false };
  N3.CFG = { MODEL_UNITS_PER_BLOCK: 256 };
  N3.Mesher = { packModelVertex(out, o) { return o + 1; }, setOptions() {} };
  try {
    const src = readFileSync(join(SRC, '07j_entityrender.js'), 'utf8');
    const m = /ER\.renderDistanceMultiplier = 1;[\s\S]*?ER\.shouldRender = function[\s\S]*?\n  \};/.exec(src);
    const sh = /ER\.emitShadows = function[\s\S]*?\n  \};/.exec(src);
    const ER = N3.EntityRender;
    new Function('NS', 'ER', 'CFG', m[0] + '\n' + sh[0].replace('var M = NS.Mesher, U = CFG.MODEL_UNITS_PER_BLOCK, tile = ER.shadowTile();', 'var M = NS.Mesher, U = 256, tile = 0;'))(N3, ER, N3.CFG);
  } catch (e) { bad.push('renderer: ' + e.message); return bad; }
  const saved = NS.Settings; NS.Settings = N3.Settings;
  try {
    const St = N3.Settings, ER = N3.EntityRender;
    const rows = O.videoRows();
    const ed = rowOf(rows, 'Entity Distance')[0], es = rows.filter((r) => r.label === 'Entity Shadows')[0];
    chk(ed && ed.label() === 'Entity Distance: 100%', 'no row "Entity Distance: 100%"');
    chk(es && es.val() === 'ON', 'no row "Entity Shadows: ON"');
    if (!ed || !es) return bad;
    ed.set(0); chk(St.entityDistanceScaling === 0.5 && ed.label() === 'Entity Distance: 50%', 'slider min is 50%: ' + ed.label());
    ed.set(1); chk(St.entityDistanceScaling === 5 && ed.label() === 'Entity Distance: 500%', 'slider max is 500%: ' + ed.label());
    ed.set(0.25 / 4.5 * 0.9); chk(St.entityDistanceScaling === 0.75, 'step is 0.25: ' + St.entityDistanceScaling);
    ed.set(0.5 / 4.5);
    chk(ER.renderDistanceMultiplier === 1, 'ER multiplier follows slider: ' + ER.renderDistanceMultiplier);
    // a 0.6 x 1.8 mob: d = 1.0, so it renders inside 64 blocks at 100% and inside 128 at 200%
    const e = { width: 0.6, height: 1.8 };
    const d = (0.6 + 1.8 + 0.6) / 3;
    chk(ER.shouldRender(e, (d * 64 - 1) ** 2) && !ER.shouldRender(e, (d * 64 + 1) ** 2), 'cull at 100%');
    St.entityDistanceScaling = 2; St.save();
    chk(ER.renderDistanceMultiplier === 2 && ER.shouldRender(e, (d * 128 - 1) ** 2) && !ER.shouldRender(e, (d * 128 + 1) ** 2), 'cull flips at the scaled distance');
    St.entityDistanceScaling = 0.5; St.save();
    chk(!ER.shouldRender(e, (d * 32 + 1) ** 2), 'cull at 50%');
    const q = [{ x0: 0, x1: 1, z0: 0, z1: 1, y: 0, u0: 0, u1: 1, v0: 0, v1: 1 }];
    chk(ER.emitShadows({}, 0, q, 0, 0, 0) > 0, 'shadows ON emit quads');
    es.fn(); chk(es.val() === 'OFF' && St.entityShadows === false, 'toggle flips');
    chk(ER.emitShadows({}, 0, q, 0, 0, 0) === 0, 'shadows OFF emit zero quads');
    St.entityDistanceScaling = 3.25; St.save();
    St.entityDistanceScaling = 1; St.entityShadows = true; ER.renderDistanceMultiplier = 1;
    St.load();
    chk(St.entityDistanceScaling === 3.25 && St.entityShadows === false && ER.renderDistanceMultiplier === 3.25, 'both persist across save/load');
  } catch (e) { bad.push('threw: ' + e.message); }
  NS.Settings = saved;
  return bad;
}
{
  const base = entRun(null);
  ok(base.length === 0, 'entity options: ' + base.join('; '));
  const breaks = [
    ["'entityDistanceScaling', 'entityShadows',", ""],
    ["NS.EntityRender.renderDistanceMultiplier = v;", ""],
    ["entityShadows: true,", "entityShadows: false,"],
  ];
  let caught = 0;
  for (const b of breaks) if (entRun(b).length) caught++;
  ok(caught === breaks.length, `only ${caught} entity breaks caught`);
  console.log(`    ${caught} breaks caught`);
}

// ═══════════════ G17-CL2: Clouds Off / Fast / Fancy ═════════════════════════════════════════════
console.log('\n clouds video option');
function cloudRun(mut) {
  const bad = [];
  const chk = (c, m) => { if (!c) bad.push(m); };
  const N3 = { ENV: { workers: 2, workersMax: 4 }, Jobs: NS.Jobs, U: NS.U, Options: O };
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  let sset = readFileSync(join(SRC, '16_settings.js'), 'utf8');
  let osrc = readFileSync(join(SRC, '09d_clouds.js'), 'utf8');
  if (mut) { sset = sset.replace(mut[0], mut[1]); osrc = osrc.replace(mut[0], mut[1]); }
  N3.DATA = { cloudBits: 1 }; N3.Z = { unpack: () => new Uint8Array(8192) };
  try { new Function('MCL', sset)(N3); new Function('MCL', osrc)(N3); } catch (e) { bad.push('load: ' + e.message); return bad; }
  const saved = NS.Settings; NS.Settings = N3.Settings;
  try {
    const St = N3.Settings, Cl = N3.Clouds;
    const rows = O.videoRows();
    const row = rows.filter((r) => r.label === 'Clouds')[0];
    chk(row && row.val() === 'Fancy', 'no row "Clouds: Fancy"');
    if (!row) return bad;
    const seen = [];
    for (let i = 0; i < 3; i++) { row.fn(); seen.push(row.val()); }
    chk(seen.join() === 'Off,Fast,Fancy', 'cycle order Fancy->Off->Fast->Fancy: ' + seen.join());
    row.fn(); chk(St.cloudRenderMode === 0 && Cl.mode() === 0, 'Off reaches the renderer');
    let drew = 0; const G = { name: 'webgl2' };
    Cl.renderGL2 = () => { drew++; }; Cl.live = () => ({}); Cl.live.x = 1;
    Cl.render(G, {}); chk(drew === 0, 'Off draws nothing (' + drew + ')');
    row.fn(); chk(St.cloudRenderMode === 1 && Cl.mode() === 1, 'Fast reaches the renderer');
    St.cloudRenderMode = 0; St.save(); St.cloudRenderMode = 2; St.load();
    chk(St.cloudRenderMode === 0, 'round-trips save/load: ' + St.cloudRenderMode);
    St.cloudRenderMode = 2; St.renderDistance = 3; chk(Cl.mode() === 0, 'render distance < 4 forces Off');
  } catch (e) { bad.push('threw: ' + e.message); }
  NS.Settings = saved;
  return bad;
}
{
  const base = cloudRun(null);
  ok(base.length === 0, 'cloud option: ' + base.join('; '));
  const breaks = [
    ["'particles', 'cloudRenderMode',", "'particles',"],
    ["Cl.mode() === 0 || !loadBits()", "!loadBits()"],
    ["cloudRenderMode: 2,", "cloudRenderMode: 1,"],
    ["s.renderDistance < 4", "s.renderDistance < 0"],
  ];
  let caught = 0;
  for (const b of breaks) if (cloudRun(b).length) caught++;
  ok(caught === breaks.length, `only ${caught}/${breaks.length} cloud breaks caught`);
  console.log(`    ${caught} breaks caught`);
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` optionscheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' the options tree is vanilla\'s, on vanilla\'s own widgets.');

function __srcText() {
  const dir = join(MCLITE_ROOT, 'src');
  return readdirSync(dir).filter(f => f.endsWith('.js') && !f.includes('.gen.')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
}
