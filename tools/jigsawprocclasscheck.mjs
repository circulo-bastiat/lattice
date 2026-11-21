#!/usr/bin/env node
// #11758: net/minecraft/structure/processor: nop, block_ignore, block_age, lava_submerged, gravity, jigsaw_replacement
// compile through 04t_jigsaw.js's compileProcessor and run through applyProcessors (via JG.runProcs).
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const JG = M.Jigsaw, S = M.States, st = (n) => S.stateOf(n);
const orig = JG.compileProcessor;
function suite() {
  const bad = []; const chk = (c, m) => { if (!c) bad.push(m); };
  const run = (spec, s, x = 1, y = 2, z = 3) => JG.runProcs([JG.compileProcessor(spec, 't')], s, x, y, z);
  chk(run({ processor_type: 'minecraft:nop' }, st('stone')) === st('stone'), 'nop passes');
  chk(run({ processor_type: 'minecraft:gravity', heightmap: 'WORLD_SURFACE_WG', offset: -1 }, st('stone')) === st('stone'), 'gravity passes (drape)');
  chk(run({ processor_type: 'minecraft:jigsaw_replacement' }, st('stone')) === st('stone'), 'jigsaw_replacement passes');
  const ig = { processor_type: 'minecraft:block_ignore', blocks: [{ Name: 'minecraft:structure_void' }, { Name: 'minecraft:dirt' }] };
  chk(run(ig, st('dirt')) === -1, 'ignore drops listed');
  chk(run(ig, st('stone')) === st('stone'), 'ignore keeps others');
  const age = (m) => ({ processor_type: 'minecraft:block_age', mossiness: m });
  let moss = 0, crack = 0, same = 0; const N = 3000;
  for (let i = 0; i < N; i++) { const r = run(age(1), st('stone_bricks'), i, 5, 9); if (r === st('mossy_stone_bricks')) moss++; else if (r === st('cracked_stone_bricks')) crack++; else same++; }
  chk(moss > N * 0.4 && moss < N * 0.6 && crack === 0 && Math.abs(same / N - 0.5) < 0.06, 'age m=1: half mossy, rest same ' + moss + '/' + same);
  let ob = 0; for (let i = 0; i < N; i++) if (run(age(0.5), st('obsidian'), i, 5, 9) === st('crying_obsidian')) ob++;
  chk(Math.abs(ob / N - 0.15) < 0.03, 'obsidian crying ~0.15');
  chk(run(age(1), st('cobblestone_wall'), 4, 4, 4) === st('mossy_cobblestone_wall'), 'wall m=1 mossy');
  chk(run({ processor_type: 'minecraft:lava_submerged_block' }, st('stone')) === st('stone'), 'lavasub keeps opaque');
  let threw = false; try { JG.compileProcessor({ processor_type: 'minecraft:bogus' }, 't'); } catch (e) { threw = true; }
  chk(threw, 'unknown throws');
  // real entry: processor lists in data compile
  chk(JG.processorsOf('zombie_plains') !== undefined, 'real list compiles');
  return bad;
}
const base = suite();
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = {
  'ignore keeps all': () => { JG.compileProcessor = (p, w) => p.processor_type.endsWith('block_ignore') ? { kind: 'nop' } : orig(p, w); },
  'age never': () => { JG.compileProcessor = (p, w) => p.processor_type.endsWith('block_age') ? { kind: 'nop' } : orig(p, w); },
  'age ignores mossiness': () => { JG.compileProcessor = (p, w) => { const r = orig(p, w); if (r.kind === 'age') r.mossiness = 0; return r; }; },
  'nop drops': () => { JG.compileProcessor = (p, w) => p.processor_type.endsWith('nop') ? { kind: 'ignore', names: { stone: 1 } } : orig(p, w); },
  'unknown ignored': () => { JG.compileProcessor = (p, w) => { try { return orig(p, w); } catch (e) { return { kind: 'nop' }; } }; },
};
let caught = 0;
for (const [n, f] of Object.entries(muts)) {
  JG.compileProcessor = orig; f(); let r; try { r = suite(); } catch (e) { r = ['threw']; } JG.compileProcessor = orig;
  if (r.length) caught++; else console.log('x break not caught: ' + n);
}
console.log(caught + ' breaks caught');
process.exit(caught === Object.keys(muts).length ? 0 : 1);
