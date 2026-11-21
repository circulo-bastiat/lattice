// tools/gpurunatcheck.mjs - 7 Nov (Dan: "we already have conditionals in the project"): GPU_RUN_AT=<ISO UTC time> starts RUN-GPU-CHECKS on the PC through the brain tick.
// gpuRunDue is true from that time on and never for garbage; the tick deletes the variable BEFORE it dispatches gpu-run.yml and puts it back if the dispatch fails; fillLocked runs it every tick;
// go.mjs gpurun sets it; the workflow runs only on a `gpurun` runner. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { gpuRunDue } from './brain/route.mjs';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const BRAIN = rd('./brain/brain.mjs'), GO = rd('./go.mjs'), WF = rd('../.github/workflows/gpu-run.yml');
const NOW = Date.parse('2026-11-07T20:00:00Z');
const verdict = (fn, brain, go, wf) => {
  const bad = [];
  if (fn('2026-11-07T20:10:00Z', NOW) !== false) bad.push('before the time it must not be due');
  if (fn('2026-11-07T20:00:00Z', NOW) !== true) bad.push('at the time it must be due');
  if (fn('2026-11-07T19:00:00Z', NOW) !== true) bad.push('after the time it must stay due until the tick clears it');
  if (fn('', NOW) !== false || fn(undefined, NOW) !== false || fn('soon', NOW) !== false || fn('2026-11-07 15:10', NOW) !== false) bad.push('garbage / empty / no-Z must never fire');
  const del = brain.indexOf("await gh('DELETE', V"), dis = brain.indexOf('gpu-run.yml/dispatches');
  if (!(del > 0 && dis > del)) bad.push('the tick must delete GPU_RUN_AT BEFORE it dispatches (a second tick must find nothing)');
  if (!/put back/.test(brain) || !/name: 'GPU_RUN_AT', value: v/.test(brain)) bad.push('a failed dispatch must put GPU_RUN_AT back');
  if (!/await gpuRun\(\)\.catch[\s\S]{0,120}await fill\(\)/.test(brain)) bad.push('fillLocked must run gpuRun() every tick before fill()');
  if (!/^async function gpurun\(\)/m.test(go) || !/^  gpurun,$/m.test(go)) bad.push('go.mjs has no `gpurun` command');
  if (!/runs-on: \[self-hosted, gpurun\]/.test(wf) || /mclite/.test(wf.split('\n').filter((l) => /runs-on/.test(l)).join(''))) bad.push('the workflow must run only on a runner labelled gpurun (no mclite/express/gpu label)');
  if (/^\s*schedule:/m.test(wf)) bad.push('no cron in gpu-run.yml: the brain tick is the clock');
  return bad;
};
const BREAKS = [
  ['always due', () => () => true, BRAIN, GO, WF],
  ['never due', () => () => false, BRAIN, GO, WF],
  ['dispatch before delete', () => gpuRunDue, BRAIN.replace("await gh('DELETE', V, null, { ok404: true });", '/*d*/'), GO, WF],
  ['not put back', () => gpuRunDue, BRAIN.replace('put back', 'dropped'), GO, WF],
  ['not called every tick', () => gpuRunDue, BRAIN.replace('await gpuRun().catch', 'await Promise.resolve().catch'), GO, WF],
  ['no go.mjs command', () => gpuRunDue, BRAIN, GO.replace('  gpurun,\n', ''), WF],
  ['runs on any mclite runner', () => gpuRunDue, BRAIN, GO, WF.replace('[self-hosted, gpurun]', '[self-hosted, mclite]')],
];
const real = verdict(gpuRunDue, BRAIN, GO, WF); let caught = 0;
for (const [name, mk, b, g, w] of BREAKS) { if (verdict(mk(), b, g, w).length) caught++; else real.push('break not caught: ' + name); }
console.log(real.length ? 'FAIL\n' + real.join('\n') : `gpurunatcheck: ok, ${caught} breaks caught`);
process.exit(real.length ? 1 : 0);
