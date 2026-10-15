#!/usr/bin/env node
// mailhookcheck.mjs - #4979: the PreToolUse mail hook (tools/infra/mailhook.mjs) really stops EVERY kind of tool call while mail waits, by type,
// and lets through only a lone mail command. Runs the real hook as Claude Code does (JSON on stdin, exit code 2 + stderr = blocked) against a stub go.mjs.
// Dan, 10 Oct: messages must "pervade all ... no matter what they're doing or commands, not just go.mjs". ANTI-VACUITY: "<n> breaks caught".
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const T = fileURLToPath(new URL('.', import.meta.url));
const HOOK = readFileSync(join(T, 'infra/mailhook.mjs'), 'utf8');
const msg = (id, type, body = 'please look at this') => ({ id, body: `to: commander\nfrom: dan\n${type ? `type: ${type}\n` : ''}\n${body}` });
let N = 0;
function root(S, { pending = [], news = [], broken = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'mh-'));
  mkdirSync(join(d, '.git')); mkdirSync(join(d, 'tools', 'infra'), { recursive: true });
  writeFileSync(join(d, 'tools', 'infra', 'mailhook.mjs'), S.hook); copyFileSync(join(T, 'infra/bus.mjs'), join(d, 'tools', 'infra', 'bus.mjs'));
  writeFileSync(join(d, 'tools', 'go.mjs'), broken ? 'process.exit(1);' : `const c = process.argv[2]; console.log(JSON.stringify(c === 'pending' ? ${JSON.stringify(pending)} : ${JSON.stringify(news)}));`);
  return d;
}
const fire = (d, tool, input) => { const r = spawnSync(process.execPath, [join(d, 'tools', 'infra', 'mailhook.mjs')], { input: JSON.stringify({ tool_name: tool, tool_input: input }), env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8', timeout: 30e3 }); return { code: r.status, err: r.stderr || '' }; };
function run(S) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); }, made = [], mk = (o) => { const d = root(S, o); made.push(d); return d; };
  try {
    let d = mk();
    ok(fire(d, 'Bash', { command: 'ls' }).code === 0, 'no mail: every call goes through');
    d = mk({ pending: [msg(5, 'reply')] });
    const tools = [['Bash', { command: 'ls -la' }], ['PowerShell', { command: 'Get-ChildItem' }], ['Read', { file_path: '/x/a.js' }], ['Edit', { file_path: 'a.js', old_string: 'a', new_string: 'b' }], ['Write', { file_path: 'a.js', content: 'x' }], ['Grep', { pattern: 'x' }], ['Agent', { prompt: 'do it' }]];
    const res = tools.map(([t, i]) => fire(d, t, i));
    ok(res.every((r) => r.code === 2 && /MESSAGE FOR YOU/.test(r.err) && /please look at this/.test(r.err) && /go\.mjs reply 5/.test(r.err)), 'mail waiting: Bash, PowerShell, Read, Edit, Write, Grep and Agent calls are ALL stopped, with the message and how to answer');
    d = mk({ pending: [msg(6, 'urgent', 'stop the build')] });
    const u = fire(d, 'Bash', { command: 'node build.mjs' });
    ok(u.code === 2 && /URGENT/.test(u.err) && /drop|STOP/i.test(u.err) && /stop the build/.test(u.err), 'type urgent: stopped with an URGENT banner telling the session to drop what it is doing');
    d = mk({ pending: [msg(7, 'reply'), msg(8, 'urgent', 'the urgent one')] });
    ok(/URGENT/.test(fire(d, 'Bash', { command: 'ls' }).err) && /the urgent one/.test(fire(d, 'Bash', { command: 'ls' }).err), 'an urgent message waiting behind a reply-type one is shown first');
    d = mk({ news: [msg(9, 'announce', 'the lander is moving to hosted runners')] });
    const a1 = fire(d, 'Bash', { command: 'ls' }), a2 = fire(d, 'Bash', { command: 'ls' }), a3 = fire(d, 'Read', { file_path: 'x' });
    ok(a1.code === 2 && /ANNOUNCEMENT/.test(a1.err) && /moving to hosted/.test(a1.err) && /no answer needed/.test(a1.err), 'type announce: the next call is stopped once with the text and "no answer needed"');
    ok(a2.code === 0 && a3.code === 0, 'an announcement is shown once: the repeated call (and the next tool) goes through');
    d = mk({ pending: [msg(10, 'reply')], news: [msg(11, 'announce', 'fyi text')] });
    const b1 = fire(d, 'Bash', { command: 'ls' });
    ok(b1.code === 2 && /MESSAGE FOR YOU/.test(b1.err) && !/ANNOUNCEMENT/.test(b1.err), 'a waiting reply comes before an announcement');
    // what is let through: a lone mail command only
    d = mk({ pending: [msg(12, 'reply')] });
    const pass = [['Bash', { command: 'node tools/go.mjs reply 12 "done; fixed & tested"' }], ['Bash', { command: 'MCLITE_WHO=commander node tools/go.mjs say --to dan "hi"' }], ['Bash', { command: 'node tools/go.mjs inbox' }], ['PowerShell', { command: 'node tools\\go.mjs pending' }], ['Bash', { command: 'node tools/go.mjs news' }]];
    ok(pass.every(([t, i]) => fire(d, t, i).code === 0), 'a lone `go.mjs reply|say|inbox|pending|news` command is let through, also with ; and & inside its quoted text');
    ok(['node tools/go.mjs reply 12 "ok #4986 -> PR up, 3 turns <none> blocked"', "node tools/go.mjs reply 12 'a > b'"].every((c) => fire(d, 'Bash', { command: c }).code === 0), 'a reply with < or > inside its quoted text is let through (the 01:01Z worker could never answer)');
    const hold = [['Bash', { command: 'node tools/go.mjs reply 12 "x" && rm -rf y' }], ['Bash', { command: 'echo go.mjs say' }], ['Bash', { command: 'node tools/go.mjs say hi; node build.mjs' }], ['Bash', { command: 'node tools/go.mjs inbox | tee f' }],
      ['Bash', { command: 'node tools/go.mjs say $(cat secret)' }], ['Bash', { command: 'node tools/go.mjs say `id`' }], ['Bash', { command: 'node tools/go.mjs inbox > out.txt' }], ['Bash', { command: 'cat tools/go.mjs reply' }],
      ['Read', { file_path: 'tools/go.mjs reply' }], ['mcp__x__run', { command: 'node tools/go.mjs reply 12 "x"' }], ['Write', { file_path: 'a', content: 'node tools/go.mjs reply 1 "x"' }], ['Bash', { command: 'node build.mjs\nnode tools/go.mjs reply 12 "x"' }]];
    const held = hold.map(([t, i]) => fire(mk({ pending: [msg(12, 'reply')] }), t, i).code);   // a fresh root per call: the deadlock breaker counts blocks per message
    ok(held.every((c) => c === 2), `a command that merely mentions or is chained with a mail command is stopped like any other (codes ${held.join(',')})`);
    d = mk({ pending: [msg(13, 'reply')] });
    const seq = []; for (let i = 0; i < 12; i++) seq.push(fire(d, 'Bash', { command: 'ls' }).code);
    ok(seq.slice(0, 8).every((c) => c === 2) && seq.slice(8).every((c) => c === 0), `deadlock breaker: the same unanswered mail stops 8 calls, then work continues (codes ${seq.join(',')})`);
    ok(/ONE line/.test(fire(mk({ pending: [msg(14, 'reply')] }), 'Bash', { command: 'ls' }).err), 'the block text states the reply rules');
    d = root(S, { broken: true }); made.push(d);
    ok(fire(d, 'Bash', { command: 'ls' }).code === 0, 'a broken go.mjs lets work continue (the hook fails open)');
  } finally { for (const d of made) rmSync(d, { recursive: true, force: true }); }
  return f;
}
const SRC = { hook: HOOK };
const fails = run(SRC), total = N;
const rep = (a, b) => (S) => { if (!S.hook.includes(a)) throw new Error(`no such text in the hook: ${a}`); return { hook: S.hook.split(a).join(b) }; };
const BREAKS = [
  ['any command mentioning go.mjs skips the gate again', rep('export function isMailCommand(tool, input) {', 'export function isMailCommand(tool, input) { if (/go\\.mjs/.test(JSON.stringify(input))) return true;')],
  ['chained commands are let through', rep("if (/[;&|<>]/.test(bare)) return false;", '')],
  ['angle brackets in a quoted reply block it again', rep("[`\\n\\r]|\\$\\(/.test(raw)", "[`\\n\\r<>]|\\$\\(/.test(raw)")],
  ['no deadlock breaker', rep('b[id] > MAX_BLOCKS', 'false')],
  ['reply rules missing from the block text', rep('ONE line', 'line')],
  ['command substitution is let through', rep('|\\$\\(/.test(raw)) return false;', '/.test(raw)) return false;')],
  ['only Bash is checked, other tools mention-exempt', rep("/^(Bash|PowerShell)$/.test(String(tool || ''))", "true")],
  ['an announcement is shown on every call', rep('writeFileSync(seenF,', '0 && writeFileSync(seenF,')],
  ['announcements are never read', rep("news: go('news')", 'news: []')],
  ['urgent looks like any other message', rep('URGENT MESSAGE FROM DAN', 'MESSAGE')],
  ['an urgent message is not put first', rep("c.pending.find((x) => typeOf(x.body) === 'urgent') || m", 'm')],
  ['an announcement outranks a waiting reply', rep('  if (c.pending.length) {', '  if (false) {')],
  ['the hook fails closed', rep('catch { code = 0; }', 'catch { code = 2; }')],
  ['the announcement text drops "no answer needed"', rep('no answer needed', 'answer it')],
];
let caught = 0;
for (const [name, mut] of BREAKS) {
  let r; try { r = run(mut(SRC)); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
}
console.log(`mailhookcheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
