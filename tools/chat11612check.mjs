#!/usr/bin/env node
// chat11612check.mjs — #11612 (AUDIT-MAP). ChatScreen (13_input.js): keyPressed PageUp/PageDown scroll by
// visibleLines-1, mouseScrolled clamps delta to ±1 and multiplies by 7 unless Shift. Each cut must be noticed.
import { loadEngine } from './loadsrc.mjs';
let N = 0;
function run(patch) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  try {
    const E = loadEngine({ extra: ['15c_chat.js', '13_input.js'], dom: true,
      ...(patch ? { patch: (fn, t) => (fn === '13_input.js' ? patch(t) : t) } : {}) });
    const I = E.Input, C = E.Chat;
    const calls = [];
    C.scrollBy = (d) => calls.push(d);
    C.LINES_OPEN = 20;
    ok(I.chatPage('PageUp') === true && calls[0] === 19, 'PageUp scrolls +(lines-1) older');
    ok(I.chatPage('PageDown') === true && calls[1] === -19, 'PageDown scrolls -(lines-1)');
    ok(I.chatPage('KeyA') === false && calls.length === 2, 'other keys are not consumed');
    calls.length = 0;
    I.chatWheel(-120, false); I.chatWheel(500, false); I.chatWheel(-1, true); I.chatWheel(9, true); I.chatWheel(0, false);
    ok(calls[0] === 7 && calls[1] === -7, 'wheel clamps to ±1 then ×7');
    ok(calls[2] === 1 && calls[3] === -1, 'Shift wheel scrolls one line');
    ok(calls[4] === 0, 'zero delta does nothing');
  } catch (e) { f.push('threw: ' + e.message); }
  return f;
}
const base = run(null);
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = [
  ['page size', (t) => t.replace('(NS.Chat.LINES_OPEN - 1)', '(NS.Chat.LINES_OPEN)')],
  ['page direction', (t) => t.replace("(code === 'PageUp' ? 1 : -1)", "(code === 'PageUp' ? -1 : 1)")],
  ['page consumed', (t) => t.replace("if (code !== 'PageUp' && code !== 'PageDown') return false;", '')],
  ['wheel x7', (t) => t.replace('shift ? d : d * 7', 'shift ? d : d')],
  ['wheel shift', (t) => t.replace('shift ? d : d * 7', 'd * 7')],
  ['wheel direction', (t) => t.replace('deltaY < 0 ? 1 : (deltaY > 0 ? -1 : 0)', 'deltaY < 0 ? -1 : (deltaY > 0 ? 1 : 0)')],
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
