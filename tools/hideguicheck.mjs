#!/usr/bin/env node
// hideguicheck.mjs -- #11441: F1 (vanilla options.hudHidden) is bound, toggles Settings.hideGui, and Hud.draw skips HUD + chat.
import { readFileSync } from 'node:fs';
const rd = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
function run(inp, hud, main) {
  const f = [];
  const ok = (c, m) => { if (!c) f.push(m); };
  ok(/F1:\s*'hideGui'/.test(inp), 'F1 not mapped to hideGui');
  ok(/SWALLOW = \{ F1: 1/.test(inp), 'F1 not swallowed (browser help key)');
  ok(/case 'hideGui':\s*NS\.Settings\.hideGui = !NS\.Settings\.hideGui/.test(main), 'hideGui action does not toggle Settings.hideGui');
  const d = hud.slice(hud.indexOf('H.draw = function'));
  const body = d.slice(0, d.indexOf('\n  };'));
  ok(/hudOff = !!\(NS\.Settings && NS\.Settings\.hideGui\)/.test(body), 'Hud.draw does not read hideGui');
  for (const fn of ['drawHotbar', 'drawSurvival', 'drawCrosshair', 'drawChat', 'drawTitles', 'drawBossBars', 'drawSubtitles']) {
    const i = body.indexOf('H.' + fn + '(c)');
    const pre = body.slice(Math.max(0, body.lastIndexOf('\n', i) - 300), i);
    ok(i > 0 && (/if \(!hudOff\)\s*H\.\w+\(c\)\s*;?[^\n]*$/.test(body.slice(body.lastIndexOf('\n', i), body.indexOf('\n', i))) || /if \(!hudOff\) \{(?:(?!\n    \}\n)[\s\S])*$/.test(pre + 'H.' + fn)), fn + ' not gated by hideGui');
  }
  return f;
}
const I = rd('13_input.js'), H = rd('15_hud.js'), M = rd('17_main.js');
const base = run(I, H, M);
let bad = base.length ? base : [];
if (bad.length) { console.log('FAIL: ' + bad.join('; ')); process.exit(1); }
const breaks = [
  [I.replace("F1:       'hideGui',", ''), H, M],
  [I.replace('SWALLOW = { F1: 1,', 'SWALLOW = {'), H, M],
  [I, H, M.replace('NS.Settings.hideGui = !NS.Settings.hideGui', 'void 0')],
  [I, H.replace('var hudOff = !!(NS.Settings && NS.Settings.hideGui)', 'var hudOff = false'), M],
  [I, H.replace('if (!hudOff) H.drawChat(c);', 'H.drawChat(c);'), M],
  [I, H.replace('if (!hudOff) H.drawTitles(c);', 'H.drawTitles(c);'), M],
  [I, H.replace('    if (!hudOff) {\n    if (!H.screen)', '    {\n    if (!H.screen)'), M],
];
let caught = 0;
for (const [a, b, c] of breaks) if (run(a, b, c).length) caught++;
console.log('hideguicheck: ' + breaks.length + ' assertions; ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
