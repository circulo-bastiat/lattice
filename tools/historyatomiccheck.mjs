// historyatomiccheck - #6549: a writer hammering saveHistory while a reader loops history() must never make the reader see the empty default.
// Proves it can fail: the same module with a truncating write (no temp+rename) is run too and must be caught.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const dir = join(dirname(fileURLToPath(import.meta.url)), 'brain');
const src = readFileSync(join(dir, 'home.mjs'), 'utf8');
async function run(file) {
  const home = mkdtempSync(join(tmpdir(), 'hist-'));
  const mod = 'file://' + file;
  const code = `const m=await import(${JSON.stringify(mod)});const big=()=>({starts:Array.from({length:3000},(_,i)=>({at:Date.now(),i})),alerts:[],told:[]});
    m.saveHistory(big());if(process.argv[1]==='w'){const e=Date.now()+1500;while(Date.now()<e)m.saveHistory(big());}
    else{process.send?.(1);let bad=0,n=0;const e=Date.now()+1500;while(Date.now()<e){n++;if(!m.history().starts.length)bad++;}console.log(bad);}`;
  const env = { ...process.env, BRAIN_HOME: home };
  const w = spawn(process.execPath, ['--input-type=module', '-e', code, 'w'], { env, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  const r = spawn(process.execPath, ['--input-type=module', '-e', code, 'r'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; r.stdout.on('data', (d) => out += d);
  await new Promise((res) => r.on('close', res)); w.kill();
  rmSync(home, { recursive: true, force: true });
  return +out.trim() || 0;
}
let fail = 0, caught = 0;
const good = await run(join(dir, 'home.mjs'));
if (good) { console.log(`FAIL real implementation read the empty default ${good} times`); fail++; }
const brokenSrc = src.replace(/const tmp = [^\n]*\n\s*writeFileSync\(tmp,/, "const tmp = P('history.json');\n  writeFileSync(tmp,").replace(/renameSync\(tmp, P\('history.json'\)\);/, '').replace(/for \(let i = 0; i < 20; i\+\+\)/, 'for (let i = 0; i < 1; i++)');
if (brokenSrc === src) { console.log('FAIL could not build broken variant'); process.exit(1); }
const bf = join(dir, `.home-broken-${process.pid}.mjs`);
writeFileSync(bf, brokenSrc);
try { const bad = await run(bf); if (bad) { caught++; console.log('✓ non-atomic variant caught (' + bad + ' empty reads)'); } else { console.log('FAIL broken (non-atomic) variant not caught'); fail++; } } finally { rmSync(bf, { force: true }); }
console.log(fail ? 'historyatomiccheck FAILED' : `historyatomiccheck: 2 assertions, 0 failures, ${caught} breaks caught`);
process.exit(fail ? 1 : 0);
