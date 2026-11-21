#!/usr/bin/env node
// callcountercheck.mjs - #11323 (Dan, 9 Nov): every tool call prints "[call N/max]". Runs the real hook as Claude Code does (JSON on stdin) in a
// temp workspace, and checks the settings.json registration and the MCLITE_MAX_TURNS env in launch.mjs. ANTI-VACUITY: "<n> breaks caught".
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const T = fileURLToPath(new URL('.', import.meta.url)), R = join(T, '..');
const HOOK = readFileSync(join(T, 'infra/callcounter.mjs'), 'utf8'), SET = readFileSync(join(R, '.claude/settings.json'), 'utf8'), LAUNCH = readFileSync(join(T, 'brain/launch.mjs'), 'utf8');
let N = 0;
function run(S) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); }, made = [];
  const fire = (d, sid, max) => { const r = spawnSync(process.execPath, [join(d, 'tools/infra/callcounter.mjs')], { input: JSON.stringify({ session_id: sid, tool_name: 'Bash', tool_input: { command: 'ls' } }), env: { ...process.env, CLAUDE_PROJECT_DIR: d, ...(max ? { MCLITE_MAX_TURNS: max } : { MCLITE_MAX_TURNS: '' }) }, encoding: 'utf8' }); let o = null; try { o = JSON.parse(r.stdout).hookSpecificOutput; } catch {} return { code: r.status, out: o }; };
  try {
    const d = mkdtempSync(join(tmpdir(), 'cc-')); made.push(d); mkdirSync(join(d, '.git')); mkdirSync(join(d, 'tools/infra'), { recursive: true });
    writeFileSync(join(d, 'tools/infra/callcounter.mjs'), S.hook);
    const a = [fire(d, 's1', '50'), fire(d, 's1', '50'), fire(d, 's1', '50')];
    ok(a.every((x) => x.code === 0 && x.out && x.out.hookEventName === 'PostToolUse'), 'the hook answers every call as a PostToolUse additionalContext, exit 0');
    ok(a.map((x) => x.out && x.out.additionalContext).join(' ') === '[call 1/50] [call 2/50] [call 3/50]', 'three calls of one session print call 1/50, 2/50, 3/50: ' + a.map((x) => x.out && x.out.additionalContext).join(' '));
    ok((fire(d, 's2', '46').out || {}).additionalContext === '[call 1/46]', 'another session counts on its own from 1');
    ok((fire(d, 's3', '').out || {}).additionalContext === '[call 1]', 'no MCLITE_MAX_TURNS prints just the number');
    ok(spawnSync(process.execPath, [join(d, 'tools/infra/callcounter.mjs')], { input: 'not json', encoding: 'utf8' }).status === 0, 'a broken payload never stops the call');
    let s = {}; try { s = JSON.parse(S.settings); } catch {}
    const post = ((s.hooks || {}).PostToolUse || []).find((h) => h.matcher === '.*' && (h.hooks || []).some((x) => /tools\/infra\/callcounter\.mjs/.test(x.command || '')));
    ok(!!post, 'settings.json registers callcounter.mjs as a PostToolUse hook on every tool (matcher .*)');
    ok(/MCLITE_MAX_TURNS:\s*String\(R\.maxTurns\)/.test(S.launch), 'launch.mjs sets MCLITE_MAX_TURNS from roles.json maxTurns');
  } catch (e) { f.push('check crashed: ' + e.message); } finally { for (const d of made) try { rmSync(d, { recursive: true, force: true }); } catch {} }
  return f;
}
const base = { hook: HOOK, settings: SET, launch: LAUNCH };
const fails = run(base); N = 0; run(base);
for (const m of fails) console.log('FAIL  ' + m);
const brk = [
  ['counter never advances', { ...base, hook: HOOK.replace('const n = (c[sid] || 0) + 1;', 'const n = 1;') }],
  ['max dropped', { ...base, hook: HOOK.replace("process.env.MCLITE_MAX_TURNS", "''") }],
  ['one counter for all sessions', { ...base, hook: HOOK.replace("String(ev.session_id || 'nosession')", "'x'") }],
  ['hook emits no context', { ...base, hook: HOOK.replace('additionalContext: line(n, process.env.MCLITE_MAX_TURNS)', 'x: 1') }],
  ['crash blocks the call', { ...base, hook: HOOK.replace('catch { process.exit(0); }', 'catch { process.exit(2); }') }],
  ['not registered in settings', { ...base, settings: SET.replace(/tools\/infra\/callcounter\.mjs/g, 'tools/infra/other.mjs') }],
  ['launch forgets the max', { ...base, launch: LAUNCH.replace(/MCLITE_MAX_TURNS:\s*String\(R\.maxTurns\)/, 'MCLITE_X: 1') }],
];
let caught = 0; for (const [n, S] of brk) { if (run(S).length) caught++; else console.log('NOT CAUGHT  ' + n); }
console.log(`callcountercheck: ${fails.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${brk.length})`);
process.exit(fails.length || caught < brk.length ? 1 : 0);
