#!/usr/bin/env node
// cmdscreencheck.mjs — #4772: the command block screen model (src/07zzu_cmdscreen.js) against
// AbstractCommandBlockScreen / CommandBlockScreen. Anti-vacuity: mutants of the module must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const SRC = readFileSync(join(MCLITE_ROOT, 'src', '07zzu_cmdscreen.js'), 'utf8');
let count = 0;

function run(code) {
  const MCL = loadEngine({ extra: ['14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'], dom: false });
  new Function('MCL', 'globalThis', code.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(MCL, globalThis);
  const C = MCL.CmdScreen, fails = [];
  const ok = (c, m) => { count++; if (!c) fails.push(m); };
  const mk = () => { const be = { command: 'say hi', trackOutput: true, lastOutput: '{"text":"hi"}' }; return be; };
  // cart: command + track edited and committed; untracked output is cleared (commitAndClose)
  const cart = mk(), s = C.open({ cart });
  ok(s && s.cmd === 'say hi' && s.cart, 'open cart');
  ok(C.previousOutput(s) === 'hi', 'previous output text');
  C.type(s, '!'); C.backspace(s); C.backspace(s); C.type(s, 'o');
  ok(s.cmd === 'say ho', 'typing/backspace: ' + s.cmd);
  s.track = false;
  ok(C.previousOutput(s) === '-', 'untracked shows "-"');
  C.commit(s);
  ok(cart.command === 'say ho' && cart.trackOutput === false && cart.lastOutput === null, 'commit writes back and clears output');
  const big = C.open({ cart: mk() });
  big.cmd = 'x'.repeat(C.MAX_LEN); C.type(big, 'y');
  ok(big.cmd.length === C.MAX_LEN, 'max length 32500');
  const s2 = C.open({ cart: mk() }); s2.mode = 2; C.cycleMode(s2); ok(s2.mode === 0, 'mode wraps');
  ok(C.canOpen({ instabuild: true }) && !C.canOpen({ instabuild: false }), 'creative op only');
  // suggestor
  const q = C.open({ cart: mk() }); q.cmd = '';
  for (const ch of 'gam') C.type(q, ch);
  ok(q.sug && q.sug.matches.includes('gamemode') && q.sug.matches.includes('gamerule') && q.sug.matches.every(m => m.startsWith('gam')), 'gam -> gamemode,gamerule: ' + JSON.stringify(q.sug));
  ok(C.ghost(q) === q.sug.matches[0].slice(3), 'ghost text');
  C.suggestAccept(q);
  ok(q.cmd === 'gamemode', 'accept replaces the word: ' + q.cmd);
  C.type(q, ' ');
  ok(q.sug && q.sug.start === 9 && !q.sug.matches.includes('gamemode'), 'after space: arguments only');
  const w = C.open({ cart: mk() }); w.cmd = '';
  C.type(w, 'x'); w.cmd = 'say'; C.type(w, ' '); C.type(w, 'a'); 
  ok(!w.sug || w.sug.start === 4, 'say argument cursor');
  const e = C.open({ cart: mk() }); e.cmd = ''; C.type(e, 's'); // many s-commands
  const n = e.sug.matches.length; ok(n > 3, 'several s commands');
  C.suggestMove(e, -1); ok(e.sug.sel === n - 1, 'Up from first wraps to last');
  C.suggestMove(e, 1); ok(e.sug.sel === 0 && e.sug.scroll === 0, 'Down wraps to first');
  e.cmd = ''; C.refresh(e); // empty line lists every command
  ok(e.sug && e.sug.matches.length > C.ROWS && C.suggestRows(e).length === C.ROWS, 'window is 10 rows');
  for (let i = 0; i < C.ROWS; i++) C.suggestMove(e, 1);
  ok(e.sug.sel === 10 && e.sug.scroll === 1, 'window scrolls with selection');
  const z = C.open({ cart: mk() }); z.cmd = 'say'; C.type(z, ' ');
  ok(C.suggestRows(z).length === 0 || z.sug.start === 4, 'no stale list after space');
  return fails;
}

console.log('cmdscreencheck — #4772 command block screen (07zzu_cmdscreen.js)');
const base = run(SRC);
base.forEach(f => console.log('  FAIL ' + f));
if (base.length) process.exit(1);
let caught = 0;
for (const [a, b] of [
  ["if (!s.track) return '-';", "if (false) return '-';"],
  ["if (!s.track) h.lastOutput = null;", ""],
  ["% 3", "% 2"],
  ["s.cmd.length < CS.MAX_LEN", "true"],
  ["h.command = s.cmd;", ""],
  ["suggest(s.cmd, NS.Player", "suggest(s.cmd.slice(0, -1), NS.Player"],
  ["(g.sel + d + n) % n", "Math.min(n - 1, Math.max(0, g.sel + d))"],
]) {
  if (!SRC.includes(a)) { console.log('  mutant target missing: ' + a); process.exit(1); }
  if (run(SRC.replace(a, b)).length) { caught++; console.log('  ✓ mutant caught: ' + a); } else console.log('  SURVIVED: ' + a);
}
console.log(`cmdscreencheck: ${count} assertions, 0 failures, ${caught} breaks caught`);
process.exit(caught === 7 ? 0 : 1);
