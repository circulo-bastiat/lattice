// tools/trimcheck.mjs - #4992 (Dan, 10 Oct usage research). Worker and tester runs launch with the trim (tools Bash,Read,Edit,Write; no slash
// commands, auto memory, MCP or ponytail), the tester is capped at 60 turns and told to batch its reads. Anti-vacuity below.
import { readFileSync } from 'node:fs';
import { trimLaunch } from './brain/route.mjs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { roles: rd('./brain/roles.json'), launch: rd('./brain/launch.mjs') };
const verdict = (S) => {
  const bad = []; let C; try { C = JSON.parse(S.roles); } catch { return ['roles.json is not valid JSON']; }
  for (const role of ['worker', 'tester']) {
    const t = trimLaunch((C.roles[role] || {})), a = t.args.join(' ');
    if (!/--tools Bash,Read,Edit,Write/.test(a)) bad.push(`${role}: tools are not trimmed to Bash,Read,Edit,Write`);
    if (!/--disable-slash-commands/.test(a)) bad.push(`${role}: slash commands/skills are loaded`);
    if (!/--strict-mcp-config/.test(a)) bad.push(`${role}: MCP servers are loaded`);
    if (!/"ponytail@ponytail":false/.test(a)) bad.push(`${role}: ponytail is not disabled for the session`);
    if (t.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY !== '1') bad.push(`${role}: auto memory is on`);
  }
  if (!((C.roles.tester || {}).maxTurns <= 60)) bad.push('tester maxTurns is above 60');
  if (!/BATCH YOUR READS/.test((C.roles.tester || {}).prompt || '')) bad.push('the tester prompt does not tell it to batch its reads');
  if (((C.plugins || {}).ponytail || {}).mode !== 'off') bad.push('roles.json plugins.ponytail.mode is not off');
  if (trimLaunch((C.roles.commander || {})).args.length) bad.push('commander/fixer must keep their full tool set (trim is worker + tester only)');
  const L = S.launch;
  if (!/trimLaunch\(R\)/.test(L) || !/args\.push\(\.\.\.TRIM\.args\)/.test(L)) bad.push('launch.mjs does not add the trim args');
  if (!/Object\.assign\(env, TRIM\.env\)/.test(L)) bad.push('launch.mjs does not set the trim env');
  if (!/TRIM\.plugins\.length \? \[\] : ensurePlugins\(\)/.test(L)) bad.push('launch.mjs still installs plugins for a trimmed run');
  return bad;
};
const mut = (fn) => (S) => { const C = JSON.parse(S.roles); fn(C); return { ...S, roles: JSON.stringify(C) }; };
const BREAKS = [
  ['worker tools untrimmed', mut((C) => { delete C.roles.worker.trim.tools; })],
  ['tester slash commands', mut((C) => { C.roles.tester.trim.disableSlashCommands = false; })],
  ['tester MCP', mut((C) => { C.roles.tester.trim.strictMcp = false; })],
  ['worker ponytail on', mut((C) => { C.roles.worker.trim.disablePlugins = []; })],
  ['worker auto memory', mut((C) => { C.roles.worker.trim.disableAutoMemory = false; })],
  ['trim removed (tester)', mut((C) => { C.roles.tester.trim = false; })],
  ['tester 80 turns', mut((C) => { C.roles.tester.maxTurns = 80; })],
  ['no batching sentence', mut((C) => { C.roles.tester.prompt = C.roles.tester.prompt.replace('BATCH YOUR READS', 'x'); })],
  ['ponytail mode lite', mut((C) => { C.plugins.ponytail.mode = 'lite'; })],
  ['commander trimmed too', mut((C) => { C.roles.commander.trim = { tools: 'Bash' }; })],
  ['launch ignores trim', (S) => ({ ...S, launch: S.launch.replace('args.push(...TRIM.args)', 'void 0') })],
  ['launch ignores trim env', (S) => ({ ...S, launch: S.launch.replace('Object.assign(env, TRIM.env)', 'void 0') })],
  ['launch still installs plugins', (S) => ({ ...S, launch: S.launch.replace('TRIM.plugins.length ? [] : ensurePlugins()', 'ensurePlugins()') })],
];
const real = verdict(SRC);
// the pure function itself
if (trimLaunch(null).args.length || trimLaunch({ trim: false }).args.length) real.push('trimLaunch(absent/false) must add nothing');
const j = trimLaunch({ trim: { disablePlugins: ['a@b'] } }).args.join(' '); if (!j.includes('"a@b":false')) real.push('trimLaunch does not build the plugin override');
let caught = 0;
for (const [n, mk] of BREAKS) { const m = mk(SRC); if (verdict(m).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const b of real) console.log(' FAIL:', b);
console.log(`trimcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
