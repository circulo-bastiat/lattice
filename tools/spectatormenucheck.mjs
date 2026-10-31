// tools/spectatormenucheck.mjs - G17-S2: SpectatorMenu paging/labels/teleport vs the vanilla decomp. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/15k_spectatormenu.js', import.meta.url), 'utf8');
const load = (src) => { const NS = {}; new Function('MCL', src)(NS); return NS.SpectatorMenu; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: String(100 + i).padStart(3, '0'), name: 'p' + i, mode: 0, x: i, y: 64, z: -i }));
const verdict = (src) => {
  const bad = [], S = load(src);
  const open = (n, tp) => { const m = S.make(players(n), null, tp); m.use(0); m.use(0); return m; };
  const m0 = S.make(players(0)); m0.use(0); m0.use(0);
  if (m0.group !== 'root' || m0.command(0).enabled) bad.push('0 players: teleport entry must be disabled');
  if (m0.command(0).name !== 'spectatorMenu.teleport' || m0.command(8).name !== 'spectatorMenu.close') bad.push('labels');
  const spec = S.make([{ id: 'a', name: 'a', mode: 3 }]); if (spec.list.length) bad.push('spectators must be excluded');
  for (const [n, nextOn, p2first] of [[6, false, null], [7, false, null], [13, true, 'p6']]) {
    const m = open(n);
    if (m.group !== 'teleport') { bad.push(n + ': menu did not enter teleport list'); continue; }
    if (m.command(0).name !== 'p0' || m.command(5).name !== 'p5') bad.push(n + ': page 1 slots 0..5');
    if (m.command(7).enabled !== nextOn) bad.push(n + ': next-page enabled should be ' + nextOn);
    if (p2first) { m.use(7); m.use(7); if (m.page !== 1 || m.command(0).id !== 'prev') bad.push(n + ': page 2 slot 0 is previous'); else if (m.command(1).name !== 'p' + (n >= 13 ? 7 : 7) && n === 7) bad.push('7: page 2'); }
  }
  const m13 = open(13); m13.use(7); m13.use(7);
  if (m13.page !== 1 || m13.command(7).enabled) bad.push('13: page 2 must be last (vanilla 7+6p<size) (page=' + m13.page + ')');
  let got = null; const mt = open(3, (p) => { got = p; }); mt.use(1); mt.use(1);
  if (!got || got.name !== 'p2' && got.name !== 'p1') bad.push('teleport target not delivered');
  if (got && (got.x !== 1 || got.z !== -1)) bad.push('teleport lands at wrong position');
  let closed = 0; const mc = S.make(players(2), () => closed++); mc.use(8); mc.use(8);
  if (closed !== 1) bad.push('close callback');
  return bad;
};
const BREAKS = [['page size 5', (s) => s.replace('const PAGE = 6', 'const PAGE = 5')], ['close label', (s) => s.replace("'spectatorMenu.close'", "'x'")],
  ['spectators kept', (s) => s.replace('p.mode !== 3', 'true')], ['next always on', (s) => s.replace('enabled: k < cmds().length', 'enabled: true')]];
const real = verdict(SRC); let caught = 0;
for (const [n, f] of BREAKS) { if (f(SRC) === SRC) { console.log(" NO-OP BREAK (pattern not found):", n); continue; } if (verdict(f(SRC)).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`spectatormenucheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
