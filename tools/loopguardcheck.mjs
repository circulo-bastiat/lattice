// loopguardcheck — #7650: one throwing tick/draw must never end Main.loop. Proves it can fail.
import { loadEngine } from './loadsrc.mjs';
function run(patch) {
  const MCL = loadEngine({ extra: ['17_main.js'], dom: true, patch });
  const M = MCL.Main, N = MCL;
  let raf = 0; globalThis.requestAnimationFrame = () => { raf++; };
  const pushed = [];
  N.Diag = { ready: false, push: (k, m) => pushed.push(m) };
  const out = { M, raf: () => raf, pushed };
  return out;
}
function drive(o, n) {
  const M = o.M; let thrown = 0;
  M.running = true;
  M.frameBody = () => { throw new Error('boom'); };   // the offending step
  const c = console.error; console.error = () => {};
  try { for (let i = 0; i < n; i++) { try { M.loop(); } catch (e) { thrown++; } } } finally { console.error = c; }
  return thrown;
}
function ok(patch) {
  try {
    const o = run(patch); const before = o.raf();
    const thrown = drive(o, 50);
    const rec = o.M.tickErrors['frame: boom'];
    return thrown === 0 && o.raf() - before === 50 && rec && rec.count === 50 && o.pushed.length === 1 && /boom/.test(o.M.tickErrorBanner) && /at /.test(rec.stack);
  } catch (e) { return false; }
}
function guard(patch) {
  try {
    const o = run(patch); let calls = 0;
    const c = console.error; console.error = () => {};
    for (let i = 0; i < 20; i++) o.M.guardStep('s', () => { calls++; throw new Error('x'); });
    console.error = c;
    return calls === 5;
  } catch (e) { return false; }
}
let fail = 0, breaks = 0;
if (!ok()) { console.log('FAIL loop does not survive/report a throw'); fail++; }
if (!guard()) { console.log('FAIL guardStep does not stop after 5'); fail++; }
const b1 = (f, s) => f === '17_main.js' ? s.replace('requestAnimationFrame(Main.loop);   // ALWAYS', '/*x*/ // ALWAYS') : s;
const b2 = (f, s) => f === '17_main.js' ? s.replace('>= 5) return;', '>= 5000) return;') : s;
const b3 = (f, s) => f === '17_main.js' ? s.replace("try { Main.frameBody(); } catch (e) { Main.reportTickError('frame', e); }", 'Main.frameBody();') : s;
if (!ok(b1)) breaks++; if (!guard(b2)) breaks++; if (!ok(b3)) breaks++;
console.log(`loopguardcheck: ${fail ? 'FAIL' : 'ok'}, ${breaks} breaks caught`);
process.exit(fail || breaks < 3 ? 1 : 0);
