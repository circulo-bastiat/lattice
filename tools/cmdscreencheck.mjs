#!/usr/bin/env node
// cmdscreencheck.mjs — #4772: the command block screen model (src/07zzu_cmdscreen.js) against
// AbstractCommandBlockScreen / CommandBlockScreen. Anti-vacuity: mutants of the module must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const SRC = readFileSync(join(MCLITE_ROOT, 'src', '07zzu_cmdscreen.js'), 'utf8');
let count = 0;

function run(code) {
  const MCL = loadEngine({ extra: [], dom: false });
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
]) {
  if (!SRC.includes(a)) { console.log('  mutant target missing: ' + a); process.exit(1); }
  if (run(SRC.replace(a, b)).length) { caught++; console.log('  ✓ mutant caught: ' + a); } else console.log('  SURVIVED: ' + a);
}
console.log(`cmdscreencheck: ${count} assertions, 0 failures, ${caught} breaks caught`);
process.exit(caught === 5 ? 0 : 1);
