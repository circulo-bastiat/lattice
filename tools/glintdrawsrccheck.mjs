#!/usr/bin/env node
// glintdrawsrccheck.mjs - #9239: the pure half of glintdrawcheck (a browser stage, skipped by --fast). The glint foil branch must exist in
// BOTH entity passes (WebGL2 + WebGPU) and the emit side must still tag quads; breaking the source text must be seen.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const SRC = { gl: rd('12_gfx_webgl2.js'), gpu: rd('11_gfx_webgpu.js'), er: rd('07j_entityrender.js') };
const RULES = [
  ['gl', /f\(30 \/ 31\) \+ '\) < 0\.01\) \{ fragColor = vec4\(t\.rgb \* t\.rgb/, 'WebGL2 glint fragment branch'],
  ['gpu', /t\.rgb \* t\.rgb \* \(1\.0 - fg\), 1\.0\)/, 'WebGPU glint fragment branch'],
  ['gl', /enchantment glint \(RenderPhase\.setupGlintTexturing/, 'WebGL2 glint UV scroll'],
  ['gpu', /alpha field 30 in the additive bucket/, 'WebGPU glint vertex path'],
  ['er', /glint: ?'armor'/, 'armour glint tag'],
  ['er', /glint: ER\.stackHasGlint\(st\) \? 'item'/, 'held-item glint tag'],
];
const run = (S) => RULES.filter(([k, re]) => !re.test(S[k])).map((r) => r[2]);
let fails = run(SRC).map((m) => 'missing: ' + m);
let breaks = 0;
for (const [k, re, m] of RULES) {
  const S = { ...SRC, [k]: SRC[k].replace(new RegExp(re.source, 'g'), 'X') };
  if (run(S).includes(m)) breaks++; else fails.push('break not caught: ' + m);
}
console.log(`glintdrawsrccheck: ${RULES.length - fails.length} ok, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
