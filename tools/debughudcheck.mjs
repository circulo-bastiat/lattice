#!/usr/bin/env node
// debughudcheck.mjs - #8336. reducedDebugInfo: F3 omits xyz/block/chunk/facing/biome/light/climate and the targeted block.
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
const SRC = readFileSync(new URL('../src/15_hud.js', import.meta.url), 'utf8');
const run = (mutate) => {
  const M = loadEngine({ extra: ['16_settings.js', '15_hud.js'], dom: false });
  const H = M.Hud, bad = [];
  let val = 'false';
  M.Commands = { ruleGet: (n) => (n === 'reducedDebugInfo' ? val : null) };
  if (mutate) mutate(H);
  const base = ['head', H.DEBUG_POS, 'tail'], pos = ['xyz', 'block', 'facing', 'biome', 'climate'];
  const full = H.debugAssemble(base, pos, 'looking at').join(',');
  if (full !== 'head,xyz,block,facing,biome,climate,tail,looking at') bad.push('full set wrong: ' + full);
  val = 'true';
  const red = H.debugAssemble(base, pos, 'looking at').join(',');
  if (red !== 'head,tail') bad.push('reduced set wrong: ' + red);
  val = 'false';
  if (H.debugAssemble(base, pos, null).join(',') !== 'head,xyz,block,facing,biome,climate,tail') bad.push('flip back not seen next call');
  return bad;
};
const real = run(); let caught = 0;
const BREAKS = [['rule never read', (H) => { H.reducedDebugInfo = () => false; }], ['rule always on', (H) => { H.reducedDebugInfo = () => true; }]];
for (const [n, m] of BREAKS) { if (run(m).length) { caught++; console.log('   ✓ caught: ' + n); } else console.log(' NOT CAUGHT:', n); }
if (!/H\.debugAssemble\(lines, posLines, target\)/.test(SRC)) { real.push('drawDebug does not use debugAssemble'); }
for (const x of real) console.log(' FAIL:', x);
console.log(' assertions passed .. ' + (3 - real.length));
console.log(' failures ........... ' + real.length);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
