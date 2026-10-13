// #546: a 64-bit seed survives W.init, Gen.init and the Save envelope (JSON) with its high half.
// Node only; breaks its own plumbing to prove it can fail.
import { loadEngine } from './loadsrc.mjs';

const SEED = BigInt.asIntN(64, 0x123456789ABCDEFn);
const EXTRA = ['07_world.js', '16b_save.js'];

function probe(M) {
  const bad = [];
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  M.Hud = M.Hud || { say: (m) => bad.push('Hud: ' + m), pushStatus() {} };
  M.Player = M.Player || { toJSON: () => ({}) };
  M.World.init(SEED);
  if (M.World.seed64 !== SEED) bad.push('World.seed64 lost its high half: ' + M.World.seed64);
  if (M.World.seed !== Number(BigInt.asIntN(32, SEED))) bad.push('World.seed is not the low int32');
  M.World.init(-5);
  if (M.World.seed64 !== -5n || M.World.seed !== -5) bad.push('int seed -5 did not widen to -5n');
  M.Gen.init(SEED, M.Gen.defaults());
  if (M.Gen.seed64 !== SEED) bad.push('Gen.seed64 lost its high half');
  const S = M.Save;
  S.backend = 'localStorage';
  S.seed64 = SEED; S.seed = Number(BigInt.asIntN(32, SEED));
  if (!S.save(false) || !store[S.KEY]) { bad.push('Save.save wrote nothing'); return bad; }
  S.seed = 0; S.seed64 = 0n;
  if (!S.load()) bad.push('Save.load refused the envelope');
  else if (S.seed64 !== SEED) bad.push('Save.seed64 round trip lost the high half: ' + S.seed64);
  const o = JSON.parse(store[S.KEY]); delete o.seed64; store[S.KEY] = JSON.stringify(o);
  S.seed64 = 0n; S.load();
  if (S.seed64 !== BigInt(S.seed)) bad.push('old save without seed64 did not fall back to the int32');
  return bad;
}

const fails = []; let breaks = 0;
fails.push(...probe(loadEngine({ extra: EXTRA })));

const muts = [
  ['World.init truncates', '07_world.js', 'W.seed64 = BigInt.asIntN(64,', 'W.seed64 = BigInt.asIntN(32,'],
  ['Gen.init truncates', '04_worldgen.js', 'G.seed64 = BigInt.asIntN(64,', 'G.seed64 = BigInt.asIntN(32,'],
  ['Save drops seed64', '16b_save.js', 'if (Number(BigInt.asIntN(32, s64)) === S.seed) S.seed64 = s64;', ''],
];
for (const [name, file, a, b] of muts) {
  let applied = false;
  const M2 = loadEngine({ extra: EXTRA, patch: (f, s) => { if (f === file && s.includes(a)) { applied = true; return s.replace(a, b); } return s; } });
  if (!applied) { fails.push(`mutation "${name}" did not apply`); continue; }
  if (probe(M2).length) { breaks++; console.log(`   ✓ break caught: ${name}`); } else fails.push(`mutation "${name}" was NOT caught`);
}

console.log('================ seed64check ================');
for (const f of fails) console.log('   ✗ ' + f);
console.log(` assertions passed .. ${12 - Math.min(12, fails.length)}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
