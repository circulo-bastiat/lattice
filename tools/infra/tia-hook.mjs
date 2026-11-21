// tools/infra/tia-hook.mjs - #7765. `node --import` hook for `suite.mjs --map`: appends every path a stage (and any node child it spawns,
// NODE_OPTIONS is inherited) reads through fs to $MCLITE_TIA_OUT. The stage -> source-files map is DERIVED from these reads, never from names.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const out = process.env.MCLITE_TIA_OUT, app = fs.appendFileSync;
if (out) {
  const rec = (p) => { try { if (p instanceof URL) p = fileURLToPath(p); if (typeof p === 'string') app(out, resolve(p) + '\n'); } catch { /* unrecordable */ } };
  for (const n of ['readFileSync', 'readFile', 'readdirSync', 'readdir', 'statSync', 'existsSync', 'openSync', 'createReadStream']) {
    const o = fs[n]; if (typeof o !== 'function') continue;
    fs[n] = function (p, ...a) { rec(p); return o.call(this, p, ...a); };
  }
  for (const n of ['readFile', 'readdir']) { const o = fs.promises[n]; fs.promises[n] = function (p, ...a) { rec(p); return o.call(this, p, ...a); }; }
  syncBuiltinESMExports();
}
