#!/usr/bin/env node
// miningmutcheck.mjs - #11509: assertions for the 3 surviving mutants of src/07d_mining.js (unknownBlocks cap 40,
// trailing-bytes message, itemSpeed before init). Narrow on purpose (loads only 07d_mining.js) so tools/mutate.mjs picks it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
let N = 0;
function run(patch) {
  const fails = [];
  const ok = (c, m) => { N++; if (!c) fails.push(m); };
  const mn = JSON.parse(readFileSync(join(ASSETS, 'mining.meta.json'), 'utf8'));
  const raw = readFileSync(join(ASSETS, 'mining.bin'));
  const data = (buf) => ({ mining: buf.toString('base64'), miningBytes: mn.rawBytes });
  // itemSpeed with Mining not initialised: a named item still answers 1 (no toolIdx yet)
  {
    const M0 = loadEngine({ extra: ['07d_mining.js'], dom: false, patch, initReg: false }).Mining;
    let v; try { v = M0.itemSpeed('iron_pickaxe', 1); } catch (x) { v = 'threw'; }
    ok(M0.ready !== true && v === 1, 'itemSpeed before init is 1 (' + v + ')');
  }
  const E = loadEngine({ extra: ['07d_mining.js'], dom: false, patch });
  const M = E.Mining, R = E.Reg;
  ok(M.ready && M.unknownBlocks.length === 0, 'baseline init clean');
  ok(M.itemSpeed('', 1) === 1 && M.itemSpeed(null, 1) === 1, 'bare hand is 1');
  // the unknown list is capped at 40
  {
    const saved = R.id; const hidden = Object.assign({}, saved);
    let k = 0; for (const n of Object.keys(hidden)) { if (k++ < 60) delete hidden[n]; }
    R.id = hidden;
    try { M.init(data(raw)); } finally { R.id = saved; }
    ok(M.unknownBlocks.length === 40, 'unknownBlocks capped at 40 (' + M.unknownBlocks.length + ')');
  }
  // trailing bytes: the message carries the count
  {
    const plain = inflateRawSync(raw), more = Buffer.concat([plain, Buffer.from([1, 2, 3])]);
    let msg = ''; try { M.init({ mining: deflateRawSync(more).toString('base64'), miningBytes: more.length }); } catch (x) { msg = x.message; }
    ok(msg === 'mining.bin: 3 trailing bytes', 'trailing bytes message (' + msg + ')');
  }
  return fails;
}

const base = run(), NB = N;
let breaks = 0, bad = false;
if (base.length) { console.log('FAIL'); for (const f of base) console.log('  - ' + f); bad = true; }
const MUT = [
  ['07d_mining.js', 'M.unknownBlocks.length < 40', 'M.unknownBlocks.length < 41'],
  ['07d_mining.js', "'mining.bin: ' + (b.length - p)", "'mining.bin: ' - (b.length - p)"],
  ['07d_mining.js', 'if (!M.ready || !item) return 1;', 'if (!M.ready && !item) return 1;'],
];
for (const [f, from, to] of MUT) {
  let sawText = false;
  const patch = (name, s) => { if (name !== f) return s; if (s.includes(from)) sawText = true; return s.replace(from, to); };
  let fl; try { fl = run(patch); } catch (x) { fl = ['threw']; }
  if (!sawText) { console.log('FAIL mutant text not found: ' + from); bad = true; continue; }
  if (fl.length) { breaks++; console.log('   ✓ mutant caught: ' + from.slice(0, 60)); } else { console.log('FAIL not caught: ' + from); bad = true; }
}
console.log(`miningmutcheck: ${NB} assertions, ${bad ? 1 : 0} failed, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
