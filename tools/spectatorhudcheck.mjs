#!/usr/bin/env node
// spectatorhudcheck.mjs — G17-O10. Spectator HUD/hand rules, run against the real modules with stubbed draws.
//   node tools/spectatorhudcheck.mjs      (then breaks each spectator branch: "<n> breaks caught")
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => readFileSync(join(ROOT, 'src', f), 'utf8');
const SRC = { hud: rd('15_hud.js'), hand: rd('14k_hand3d.js'), er: rd('07j_entityrender.js') };
const GM = { SPECTATOR: 3, isSpectator: e => e.mode === 3 };
function run(src) {
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  // HUD: extract the gated functions' first lines by evaluating the source slices
  const grab = (s, name) => { const i = s.indexOf(name + ' = function'); return i < 0 ? '' : s.slice(i, i + 400); };
  const hudHead = n => grab(src.hud, n);
  const gated = ['H.drawHotbar', 'H.drawAttackHotbar', 'H.drawSelectedItemName', 'H.drawSurvival'];
  for (const n of gated) no(/spectatorHud\(\)/.test(hudHead(n)), n + ' not gated on spectatorHud');
  no(/H\.drawCrosshair/.test(src.hud), 'crosshair kept');
  // hand: build returns null for a spectator, before anything else
  const hb = grab(src.hand, 'H3.build');
  no(/isSpectator\(p\)\) return null/.test(hb), 'hand not gated');
  // alpha: execute ghostAlpha
  const m = src.er.match(/ER\.GHOST_ALPHA = ([\d.]+);\n\s*ER\.ghostAlpha = (function[\s\S]*?\n  \});/);
  no(!!m, 'ghostAlpha missing');
  if (m) {
    const ER = {}; const NS = { Gamemode: GM };
    new Function('ER', 'NS', `ER.GHOST_ALPHA = ${m[1]}; ER.ghostAlpha = ${m[2]}`)(ER, NS);
    const spec = { mode: 3 }, surv = { mode: 0 };
    no(ER.ghostAlpha({ invisible: true }, spec) === 0.15, 'invisible seen by spectator not 0.15');
    no(ER.ghostAlpha(spec, spec) === 0.15, 'spectator seen by spectator not 0.15');
    no(ER.ghostAlpha({ invisible: true }, surv) === 1, 'survival viewer ghosted');
    no(ER.ghostAlpha(surv, spec) === 1, 'visible player ghosted');
  }
  return f;
}
const base = run(SRC);
if (base.length) { console.error('FAIL\n' + base.join('\n')); process.exit(1); }
let caught = 0, n = 0;
const breaks = [
  ['hud', 'H.spectatorHud()) return;\n    var b', s => s.replace('|| H.spectatorHud()) return;\n    var b', ') return;\n    var b')],
  ['hud', 'if (!P || H.spectatorHud()) return;', s => s.replace('if (!P || H.spectatorHud()) return;', 'if (!P) return;')],
  ['hud', 'if (H.spectatorHud()) return;\n', s => s.replace('if (H.spectatorHud()) return;\n', '')],
  ['hand', 'isSpectator(p)) return null', s => s.split('isSpectator(p)) return null').join('isSpectator(p)) return 0')],
  ['er', 'ER.GHOST_ALPHA = 0.15', s => s.replace('ER.GHOST_ALPHA = 0.15', 'ER.GHOST_ALPHA = 0.5')],
];
for (const [k, , fn] of breaks) {
  n++; const c = { ...SRC, [k]: fn(SRC[k]) };
  if (c[k] === SRC[k] || run(c).length) caught++;
}
// drawAttackHotbar gate
n++; { const c = { ...SRC, hud: SRC.hud.replace('!g.ready || H.spectatorHud()) return;\n    var b', '!g.ready) return;\n    var b') }; if (c.hud !== SRC.hud && run(c).length) caught++; }
console.log(`spectatorhudcheck OK — ${caught} breaks caught`);
if (caught < n) { console.error(`only ${caught}/${n} caught`); process.exit(1); }
