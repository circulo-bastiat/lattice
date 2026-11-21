// gmswitchercheck.mjs - G17-K1 (#7929): F3+F4 game mode switcher cycle/apply/permission and F3+N round trip.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
const SRCF = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
function run(patch) {
  const bad = [];
  const M = loadEngine({ extra: ['14e_gamemode.js', '15b_gui.js'], dom: true, patch });
  const Gm = M.Gamemode, GS = M.Gui.GmSwitcher, calls = [];
  M.Commands = { run: (l, p) => { calls.push(l); Gm.set(p, Gm.byName(l.split(' ')[1])); return { ok: true, lines: ['x'] }; } };
  const P = { mode: Gm.SURVIVAL, opLevel: 4 };
  GS.press(P); const seq = [GS.ICONS[GS.sel]];
  for (let i = 0; i < 4; i++) { GS.press(P); seq.push(GS.ICONS[GS.sel]); }
  if (seq.join() !== 'survival,adventure,spectator,creative,survival') bad.push('cycle order ' + seq);
  GS.press(P); GS.release(P);
  if (calls[0] !== '/gamemode adventure' || P.mode !== Gm.ADVENTURE) bad.push('apply after release: ' + calls);
  const Q = { mode: Gm.SURVIVAL, opLevel: 0 }; calls.length = 0;
  if (GS.press(Q) || GS.release(Q) || calls.length || Q.mode !== Gm.SURVIVAL) bad.push('changed without permission');
  const R = { mode: Gm.SURVIVAL, opLevel: 2 }; Gm.set(R, Gm.CREATIVE);
  GS.toggle(R); const a = R.mode; GS.toggle(R);
  if (a !== Gm.SPECTATOR || R.mode !== Gm.CREATIVE) bad.push('F3+N round trip ' + a + ',' + R.mode);
  return bad;
}
const base = run();
if (base.length) { console.log('FAIL ' + base.join('; ')); process.exit(1); }
const mut = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('not found: ' + a); return s.replace(a, b); };
const breaks = [['swap two icons', mut('15b_gui.js', "'survival', 'adventure'", "'adventure', 'survival'")],
  ['no permission gate', mut('15b_gui.js', 'P.opLevel >= 2', 'true')]];
let caught = 0;
for (const [n, fn] of breaks) { if (run(fn).length) caught++; else console.log('NOT CAUGHT ' + n); }
console.log('gmswitchercheck ok, ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
