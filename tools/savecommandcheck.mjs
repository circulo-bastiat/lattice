// #8144: /save-all [flush], /save-off, /save-on. Node only; breaks its own plumbing to prove it can fail.
import { loadEngine } from './loadsrc.mjs';

const EXTRA = ['02i_text.js', '07_world.js', '14h_brigadier.js', '16b_save.js', '15g_commands.js'];

function probe(M) {
  const bad = [];
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  M.Hud = M.Hud || { say() {}, pushStatus() {} };
  M.Player = M.Player || { toJSON: () => ({}) };
  M.World.init(7);
  const S = M.Save, C = M.Commands;
  S.backend = 'localStorage'; S.seed64 = 7n; S.seed = 7;
  const run = (l, level) => C.run(l, M.Player, { level: level === undefined ? 4 : level });
  const err = (r) => (r.ok ? '' : r.lines.join('|'));
  if (!run('/save-off').ok) bad.push('save-off failed first time');
  if (!/alreadyOff|already/i.test(err(run('/save-off')))) bad.push('second save-off did not error alreadyOff');
  // autosave while off
  S.dirty = true; S.lastSave = -1e9; delete store[S.KEY];
  const k0 = S.autosaveSkipped;
  S.tick();
  if (store[S.KEY]) bad.push('autosave wrote while off');
  if (S.autosaveSkipped !== k0 + 1) bad.push('skip counter did not advance');
  if (!run('/save-on').ok) bad.push('save-on failed');
  if (!/alreadyOn|already/i.test(err(run('/save-on')))) bad.push('second save-on did not error alreadyOn');
  S.tick();
  if (!store[S.KEY]) bad.push('autosave did not write after save-on');
  // save-all
  delete store[S.KEY];
  for (const l of ['/save-all', '/save-all flush']) {
    const r = run(l);
    if (!r.ok || r.lines.length !== 2) bad.push(l + ' did not give saving+success');
  }
  if (!store[S.KEY]) bad.push('save-all wrote nothing');
  else { S.seed64 = 0n; S.seed = 0; if (!S.load() || S.seed64 !== 7n) bad.push('save-all blob did not round-trip'); }
  if (run('/save-all', 3).ok) bad.push('save-all allowed below op 4');
  return bad;
}

const fails = []; let breaks = 0;
fails.push(...probe(loadEngine({ extra: EXTRA })));
const muts = [
  ['autosave ignores flag', '16b_save.js', 'if (S.autosaveOff) {', 'if (false) {'],
  ['save-on never errors', '15g_commands.js', "if (!NS.Save.autosaveOff) throw", "if (false) throw"],
  ['save-all op 2', '15g_commands.js', "lit('save-all').requires(perm(4))", "lit('save-all').requires(perm(2))"],
];
for (const [name, file, a, b] of muts) {
  let applied = false;
  const M2 = loadEngine({ extra: EXTRA, patch: (f, s) => { if (f === file && s.includes(a)) { applied = true; return s.replace(a, b); } return s; } });
  if (!applied) { fails.push(`mutation "${name}" did not apply`); continue; }
  if (probe(M2).length) { breaks++; 0; } else fails.push(`mutation "${name}" was NOT caught`);
}
console.log('================ savecommandcheck ================');
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
