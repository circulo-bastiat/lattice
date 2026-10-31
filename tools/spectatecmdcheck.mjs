#!/usr/bin/env node
// spectatecmdcheck.mjs -- #8024: /spectate (SpectateCommand.java): the three failure keys and the success path, headless.
// Anti-vacuity: engines with each rule edited out of 15g_commands.js must fail.
import { loadEngine } from './loadsrc.mjs';

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['02i_text.js', '14e_gamemode.js', '14_player.js', '14h_brigadier.js', '15g_commands.js'], dom: true, patch });
  const P = M.Player, Gm = M.Gamemode, C = M.Commands;
  const run = (l) => C.run(l, P, { name: 'Dan' });
  const has = (r, k) => r.lines.some((x) => String(x).indexOf(k) >= 0);
  ok(C.IMPLEMENTED.indexOf('spectate') >= 0, 'spectate is implemented');
  P.mode = Gm.SURVIVAL; P.cameraEntity = null;
  let r = run('/spectate @s');
  ok(!r.ok && has(r, 'commands.spectate.self'), 'self refused: ' + JSON.stringify(r.lines));
  r = run('/spectate');
  ok(!r.ok && has(r, 'commands.spectate.not_spectator'), 'survival executor refused: ' + JSON.stringify(r.lines));
  P.mode = Gm.SPECTATOR;
  const cow = { type: 'cow', x: 1, y: 64, z: 1, height: 1.4, removed: false, dead: false };
  if (M.Entities && M.Entities.list) M.Entities.list.push(cow);
  P.spectate(cow); ok(P.cameraEntity === cow, 'camera set (substrate)');
  r = run('/spectate');
  ok(r.ok && !P.cameraEntity && has(r, 'commands.spectate.success.stopped'), 'no target releases camera: ' + JSON.stringify(r.lines));
  return { fails, n };
}
const base = scenarios(null);
if (base.fails.length) { for (const f of base.fails.slice(0, 8)) console.log('  FAIL ' + f); process.exit(1); }
const breaks = [
  ['release', (s) => s.replace('else P.releaseCamera();', ';')],
  ['spectatorgate', (s) => s.replace("throw new B.Err('commands.spectate.not_spectator'", "(0) && new B.Err('x'")],
  ['removed', (s) => s.replace("'attribute', 'spectate'", "'attribute'")],
];
let caught = 0;
for (const [name, fn] of breaks) {
  const r = scenarios((f, s) => f === '15g_commands.js' ? fn(s) : s);
  if (r.fails.length) caught++; else console.log('  NOT CAUGHT ' + name);
}
console.log(base.n + ' assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
