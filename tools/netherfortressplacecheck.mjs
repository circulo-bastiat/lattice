#!/usr/bin/env node
// netherfortressplacecheck.mjs — #1328: fortress maker + nether_complexes placement, seen by spawnOverride.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures;

function scan() {
  const f = [];
  for (let cz = -120; cz <= 120; cz += 8) for (let cx = -120; cx <= 120; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'fortress' && !f.some((o) => o.cx === s.cx && o.cz === s.cz)) f.push(s);
  return f;
}
const probe = (s) => {
  const p = s.pieces[0], x = (p.x0 + p.x1) >> 1, y = (p.y0 + p.y1) >> 1, z = (p.z0 + p.z1) >> 1;
  const l = ST.spawnOverride(x, y, z, 'monster');
  const outside = ST.spawnOverride(s.x1 + 1, y, z, 'monster');
  return { l, outside, n: ST.startsNear(s.cx, s.cz).length };
};
function run(tag, fn) {
  M.Dim.cur = 'overworld';
  ok(scan().length === 0, tag + 'overworld must have no fortress start');
  M.Dim.cur = 'the_nether';
  const f = fn();
  ok(f.length >= 3, tag + 'nether fortress starts found: ' + f.length);
  for (const s of f) {
  ok(s.y0 >= 48 && s.y0 <= 70 && s.pieces.length > 5, tag + 'shiftInto/pieces off at ' + s.cx + ',' + s.cz + ' y' + s.y0 + '..' + s.y1 + ' n' + s.pieces.length);
    const { l, outside } = probe(s);
    const w = l && l.find((e) => e.type === 'wither_skeleton');
    ok(w && w.weight === 8 && w.minCount === 5 && w.maxCount === 5, tag + 'wither_skeleton 8 5-5 missing inside fortress');
    ok(l && l.length === 5, tag + 'monster list is not the 5 fortress entries');
    ok(outside === null, tag + 'full-box outside +1 x must fall back');
  }
  M.Dim.cur = 'overworld';
  return f.length;
}
const real = run('', scan);
console.log('fortress starts:', real);
// determinism: re-init same seed gives the same starts
M.Dim.cur = 'the_nether'; const a = scan().map((s) => s.cx + ',' + s.cz).join(';');
ST.dropCache(); const b = scan().map((s) => s.cx + ',' + s.cz).join(';'); M.Dim.cur = 'overworld';
ok(a === b && a.length > 0, 'placement not deterministic');

// breaks: each must make the same assertions fail
const saved = { sets: ST.sets.map((s) => s.dim), gram: {} };
let caught = 0;
function breakIt(name, mut, restore) {
  const before = fails.length; mut();
  try { run('[' + name + '] ', scan); } catch (e) { fails.push('x'); }
  restore();
  if (fails.length > before) { caught++; fails.length = before; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
}
const defF = ST.defs.fortress, so = defF.spawnOverrides;
breakIt('no dimension gate', () => { ST.sets.forEach((s) => { s.dim = 'overworld'; }); }, () => ST.sets.forEach((s, i) => { s.dim = saved.sets[i]; }));
breakIt('wither weight corrupted', () => { defF.spawnOverrides = JSON.parse(JSON.stringify(so)); defF.spawnOverrides.monster.spawns[2].weight = 9; }, () => { defF.spawnOverrides = so; });
breakIt('maker declined', () => { defF.grammar = null; ST.sets.forEach((s) => { s.live = s.members.some((m) => m.def.grammar); }); ST.dropCache(); }, () => { ST.init(ST.G); ST.dropCache(); });
console.log(`${caught} breaks caught`);
if (caught !== 3) fails.push('not every break caught');
for (const f of fails) console.log('   ✗ ' + f);
console.log('netherfortressplacecheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
