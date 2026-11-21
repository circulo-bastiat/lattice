// #10490: a failing command's error carries the output tail (go.mjs prepDir's asset build).
import { runTail, tailLines } from './infra/tailrun.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
const code = 'for(let i=1;i<=100;i++)console.log("line"+i);console.error("boom-stderr");process.exit(3)';
let msg = '';
try { runTail('node', ['-e', code]); } catch (e) { msg = e.message; }
ok(msg.includes('exit 3'), 'exit status named');
ok(msg.includes('boom-stderr') && msg.includes('line100'), 'tail has the last output');
ok(!msg.includes('line50\n') && msg.split('\n').length < 50, 'tail is bounded');
ok(tailLines('a\nb\nc\n', 2) === 'b\nc', 'tailLines');
try { runTail('node', ['-e', 'console.log(1)']); } catch { ok(false, 'success must not throw'); }
// anti-vacuity: break the data (a command that succeeds) and prove the check notices no throw
let threw = true; try { runTail('node', ['-e', '0']); } catch { threw = false; }
if (threw) breaks++;
try { runTail('node', ['-e', code]); breaks--; } catch { breaks++; }
console.log(`tailruncheck: ${bad ? bad + " failed" : "ok"}; 5 assertions; ${breaks} breaks caught`);
process.exit(bad || breaks < 2 ? 1 : 0);
