#!/usr/bin/env node
// effecthudcheck.mjs — #297 (G23e). The status-effect HUD against InGameHud.renderStatusEffectOverlay and
// AbstractInventoryScreen.drawStatusEffects: icon positions and order, frames, blink alpha, the inventory
// layout (wide / narrow / step), name + numeral, and StatusEffectUtil.durationToString.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

function load(mut) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['07q_effects.js', '07z_potion.js', '15_hud.js']) {
    let t = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (mut && f === '15_hud.js') t = mut(t);
    new Function('MCL', t)(NS);
  }
  NS.Text = { ready: true, translate: k => ({ 'effect.minecraft.speed': 'Speed', 'enchantment.level.2': 'II', 'enchantment.level.5': 'V' }[k] || k) };
  return NS;
}
const I = (effect, duration, amplifier = 0, ambient = false, showIcon = true) => ({ effect, duration, amplifier, ambient, showIcon });
function run(NS) {
  const H = NS.Hud;
  // 1. duration strings
  ok(H.effectDuration(I('speed', 1800)) === '1:30', '1800 ticks -> 1:30');
  ok(H.effectDuration(I('speed', 20 * 9)) === '0:09', '180 ticks -> 0:09');
  ok(H.effectDuration(I('speed', 20 * 60 * 10)) === '10:00', '12000 ticks -> 10:00');
  ok(H.effectDuration(I('speed', 32768)) === '**:**', '> 32767 -> **:**');
  ok(H.effectDuration(I('speed', 32767)) === '27:18', '32767 is still a time');
  // 2. names
  ok(H.effectName(I('speed', 100, 0)) === 'Speed', 'amplifier 0 has no numeral');
  ok(H.effectName(I('speed', 100, 1)) === 'Speed II', 'amplifier 1 -> II');
  ok(H.effectName(I('speed', 100, 4)) === 'Speed V', 'amplifier 4 -> V');
  ok(H.effectName(I('speed', 100, 10)) === 'Speed', 'amplifier 10 has no numeral');
  // 3. overlay rows: beneficial row y=1, harmful y=27, 25 px pitch from the right edge
  const list = [I('speed', 3000), I('regeneration', 2000), I('poison', 500), I('weakness', 900, 0, true), I('hunger', 100, 0, false, false)];
  const lay = H.effectOverlayLayout(H.effectList({ effects: Object.fromEntries(list.map(i => [i.effect, i])) }, true), 400, false);
  const by = n => lay.find(l => l.inst.effect === n);
  ok(!by('hunger'), 'showIcon false draws nothing');
  ok(lay.length === 4, 'four icons');
  ok(by('speed').y === 1 && by('regeneration').y === 1, 'beneficial row at y=1');
  ok(by('poison').y === 27 && by('weakness').y === 27, 'harmful row at y=27');
  ok(by('speed').x === 375 && by('regeneration').x === 350, 'reverse natural order: longest first from the right (375, 350)');
  ok(by('weakness').x === 375 && by('poison').x === 350, 'ambient sorts last, so it is rightmost in the reversed row');
  ok(by('weakness').frame[0] === 165 && by('poison').frame[0] === 141 && by('poison').frame[1] === 166, 'ambient frame u=165, normal u=141, v=166');
  ok(H.effectOverlayLayout([I('speed', 5)], 400, true)[0].y === 16, 'demo adds 15');
  // 4. blink alpha
  ok(H.effectAlpha(I('speed', 201)) === 1 && H.effectAlpha(I('speed', 100, 0, true)) === 1, 'no blink above 200 or when ambient');
  const a0 = H.effectAlpha(I('speed', 200)), want = Math.min(0.5, 200 / 10 / 5 * 0.5) + Math.cos(200 * Math.PI / 5) * Math.min(0.25, 0);
  ok(Math.abs(a0 - want) < 1e-9, 'alpha at 200 ticks');
  const a1 = H.effectAlpha(I('speed', 15));
  ok(Math.abs(a1 - (0.15 + Math.cos(15 * Math.PI / 5) * 0.25)) < 1e-9, 'alpha at 15 ticks = 0.15 + cos(3pi)*0.25');
  // 5. inventory layout
  const mk = n => Array.from({ length: n }, (_, i) => I('speed', 100 + i));
  let L = H.effectInventoryLayout(mk(2), 420, 112, 176, 67);
  ok(L && L.wide && L.x === 290 && L.rows[1].y === 100 && L.rows[0].spriteX === 296 && L.rows[0].frame[3] === 32 && L.rows[0].frame[1] === 166, 'wide: x=panel+178, step 33, sprite +6/+7');
  ok(L.rows[0].textX === 318 && L.rows[0].nameY === 73 && L.rows[0].timeY === 83, 'text at +28, +6 / +16');
  L = H.effectInventoryLayout(mk(2), 112 + 176 + 2 + 60, 112, 176, 67);
  ok(L && !L.wide && L.rows[0].frame[1] === 198 && L.rows[0].spriteX === 297, 'narrow: 32x32 frame at v=198, sprite +7');
  ok(H.effectInventoryLayout(mk(2), 112 + 176 + 2 + 32, 112, 176, 67) !== null, 'exactly 32 px of room: narrow column');
  ok(H.effectInventoryLayout(mk(2), 112 + 176 + 2 + 31, 112, 176, 67) === null, 'under 32 px of room: nothing');
  ok(H.effectInventoryLayout(mk(6), 400, 112, 176, 67).step === 26, 'six effects: step 132/5 = 26');
  ok(H.effectInventoryLayout(mk(5), 400, 112, 176, 67).step === 33, 'five effects: step 33');
  ok(H.effectInventoryLayout([], 400, 112, 176, 67) === null, 'no effects: nothing');
  return 1;
}
run(load(null));
const clean = fails.length; if (clean) { console.log(fails.map(f => '  FAIL ' + f).join('\n')); }
// anti-vacuity: each break must make the check go red
const breaksList = [
  ['wrong beneficial row y', t => t.replace("y = demo ? 16 : 1;", "y = demo ? 16 : 2;")],
  ['wrong harmful offset', t => t.replace("y += 26; }", "y += 25; }")],
  ['wrong pitch', t => t.replace("x -= 25 * good", "x -= 24 * good")],
  ['permanent threshold', t => t.replace("inst.duration > 32767", "inst.duration > 32768")],
  ['narrow frame v', t => t.replace("[0, 198, 32, 32]", "[0, 199, 32, 32]")],
  ['room threshold', t => t.replace("room < 32", "room < 33")],
  ['step formula', t => t.replace("132 / (list.length - 1)", "132 / list.length")],
  ['no sort reverse', t => t.replace("return reverse ? out.reverse() : out;", "return out;")],
  ['seconds pad', t => t.replace("t < 10 ? m + ':0'", "t < 9 ? m + ':0'")],
  ['ambient frame', t => t.replace("[165, 166] : [141, 166]", "[141, 166] : [165, 166]")],
];
for (const [name, mut] of breaksList) {
  const before = fails.length;
  try { run(load(mut)); } catch (e) { fails.push('threw ' + e.message); }
  const caught = fails.length > before;
  fails.length = before;
  okAv(caught, 'break "' + name + '" is caught');
}
console.log('\n================= effecthudcheck ==================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
