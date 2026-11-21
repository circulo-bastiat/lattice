#!/usr/bin/env node
// cmdscreen11613check.mjs — #11613 (AUDIT-MAP). 07zzu_cmdscreen.js: CommandSuggestor (refresh/move/ghost/accept),
// CommandBlockScreen (mode cycle, commit) and MinecartCommandBlockScreen (cart target). Each cut must be noticed.
import { readFileSync } from 'node:fs';
import { loadEngine, SRC } from './loadsrc.mjs';
let N = 0;
const hud = readFileSync(SRC + '/15_hud.js', 'utf8');
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const E = loadEngine({ extra: ['07zzu_cmdscreen.js'], ...(patch ? { patch: (fn, t) => (fn === '07zzu_cmdscreen.js' ? patch(t) : t) } : {}) });
    const C = E.CmdScreen;
    const words = []; for (let i = 0; i < 12; i++) words.push('w' + i);
    E.Commands = { suggest: (txt) => (txt.startsWith('say ') ? { start: 4, matches: words } : (txt === 'x' ? { start: 0, matches: ['xyz'] } : { start: 0, matches: [] })) };
    E.BlockEntities = { get: () => null };
    // minecart screen
    const cart = { command: 'hi', trackOutput: true, lastOutput: '{"text":"out"}' };
    const s = C.open({ cart });
    ok(s && s.cart && s.cmd === 'hi' && C.previousOutput(s) === 'out', 'cart open reads command/output');
    ok(C.open({ cart: null }) === null, 'gone target -> null');
    s.track = false; ok(C.previousOutput(s) === '-', 'untracked output is -');
    s.track = true;
    // suggestor
    C.type(s, '!'); ok(s.cmd === 'hi!' && s.sug === null, 'type appends, no match');
    s.cmd = 'say '; C.refresh(s);
    ok(s.sug && C.suggestRows(s).length === 10, 'window shows 10 rows');
    ok(C.suggestMove(s, -1) && s.sug.sel === 11 && s.sug.scroll === 2, 'Up wraps and window follows');
    C.suggestMove(s, 1); ok(s.sug.sel === 0 && s.sug.scroll === 0, 'Down wraps back');
    C.suggestMove(s, 1); ok(C.ghost(s) === 'w1', 'ghost is selected match remainder');
    s.cmd = 'say w'; C.refresh(s); ok(C.ghost(s) === '0', 'ghost trims typed prefix');
    C.suggestMove(s, 1); ok(C.suggestAccept(s) && s.cmd === 'say w1', 'accept replaces word');
    s.cmd = 'say '; C.refresh(s); s.cmd = 'say a b'; C.refresh(s); ok(s.sug === null, 'stale start gives no suggestions');
    s.sug = null; ok(C.suggestMove(s, 1) === false && C.suggestAccept(s) === false, 'no suggestions: not consumed');
    C.backspace(s); ok(s.cmd === 'say a ', 'backspace');
    s.cmd = 'a'.repeat(C.MAX_LEN); C.type(s, 'b'); ok(s.cmd.length === C.MAX_LEN, 'max length');
    // cart commit
    s.cmd = 'new'; s.track = false; ok(C.commit(s) && cart.command === 'new' && cart.trackOutput === false && cart.lastOutput === null && cart.successCount === 0, 'cart commit');
    // block screen
    C.cycleMode(s); ok(s.mode === 0, 'mode cycles 2->0'); C.cycleMode(s); C.cycleMode(s); ok(s.mode === 2, 'mode cycles 3');
    ok(C.canOpen({ instabuild: true, permLevel: 2 }) && !C.canOpen({ instabuild: true, permLevel: 1 }) && !C.canOpen({ instabuild: false }) && !C.canOpen(null), 'canOpen creative op only');
    ok(C.MODES.join() === 'chain_command_block,repeating_command_block,command_block', 'mode order');
    // block open/commit with stubs
    const be = { command: 'c', auto: false }; let setTo = null;
    E.BlockEntities = { get: () => be };
    E.World = { getBlock: () => 5, setBlock: (x, y, z, v) => { setTo = v; } };
    E.States = { name: () => 'repeating_command_block', block: [0, 0, 0, 0, 0, 0], };
    E.Behave = { propName: () => 'true', setProp: (st, p, v) => 'P' + p + v };
    const b = C.open({ x: 1, y: 2, z: 3 });
    ok(b && b.mode === 1 && b.cond === true && !b.cart, 'block open reads mode & conditional');
    E.States.name = () => 'stone'; ok(C.open({ x: 1, y: 2, z: 3 }) === null, 'non command block -> null');
    E.States.name = () => 'repeating_command_block';
    b.cmd = 'z'; b.auto = true; C.commit(b);
    ok(be.command === 'z' && be.auto === true && setTo === 'Pconditionaltrue', 'block commit writes');
    // entry point
    ok(/NS\.CmdScreen\.commit\(H\.cmdScreen\)/.test(hud) && /C\.suggestAccept\(s\)/.test(hud) && /C\.open\(t\)/.test(hud), 'Hud reaches the screen');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['row count', (t) => t.replace('CS.ROWS = 10', 'CS.ROWS = 8')],
  ['wrap', (t) => t.replace('(g.sel + d + n) % n', 'Math.max(0, Math.min(n - 1, g.sel + d))')],
  ['scroll follow', (t) => t.replace('g.scroll = g.sel - CS.ROWS + 1', 'g.scroll = g.sel')],
  ['ghost trim', (t) => t.replace('substring(s.cmd.length - g.start)', 'substring(0)')],
  ['accept', (t) => t.replace('g.matches[g.sel];\n    CS.refresh', 'g.matches[0];\n    CS.refresh')],
  ['stale start', (t) => t.replace('r.start !== wordStart(s.cmd)', 'false')],
  ['max len', (t) => t.replace('s.cmd.length < CS.MAX_LEN', 'true')],
  ['mode cycle', (t) => t.replace('(s.mode + 1) % 3', '(s.mode + 1) % 2')],
  ['can open', (t) => t.replace('player.instabuild &&', '')],
  ['untracked', (t) => t.replace("if (!s.track) return '-';", '')],
  ['cart commit', (t) => t.replace('h.trackOutput = s.track;', '')],
  ['block auto', (t) => t.replace('h.auto = s.auto;', '')],
  ['cond write', (t) => t.replace("'conditional', s.cond)", "'conditional', false)")],
];
let caught = 0; const missed = [];
for (const [name, fn] of muts) {
  const probe = (t) => { const o = fn(t); if (o === t) throw new Error('mutant did not change source: ' + name); return o; };
  let f; try { f = run(probe); } catch (e) { if (/did not change/.test(e.message)) { console.log('FAIL ' + e.message); process.exit(1); } f = ['threw']; }
  if (f.length) { caught++; console.log('   ✓ cutting ' + name + ' fails: ' + f[0].slice(0, 70)); } else { missed.push(name); console.log('  FAIL cutting ' + name + ' went unnoticed'); }
}
console.log(` assertions passed .. ${N / (muts.length + 1) | 0}`);
console.log(` failures ........... ${missed.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(missed.length ? 1 : 0);
