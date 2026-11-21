// tools/gobarecheck.mjs - #2065: a bare `node tools/go.mjs` (no command) must never claim an issue. 3 Oct: the commander
// (claimed #2) and a #1898 worker (claimed #2041) each ran it to read the usage, and it ran `start`. The default command
// is `help`; `start` has to be typed. Pure: reads tools/go.mjs's source.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
function verdicts(src) {
  const bad = [];
  const m = /cmd = argv\[0\] \|\| '([a-z]+)'/.exec(src);
  if (!m) bad.push('the default command line (cmd = argv[0] || ...) is gone');
  else if (m[1] !== 'help') bad.push(`a bare call runs "${m[1]}" instead of help`);
  if (!/\n  help: async \(\) => console\.log\(/.test(src)) bad.push('there is no async `help` command for a bare call to run');
  const gate = (src.match(/if \(!\[([^\]]*)\]\.includes\(cmd\) && token\(\)\) await mailGate/) || ['', ''])[1];
  if (!/'help'/.test(gate)) bad.push('help is not exempt from the mail gate (a bare call would be blocked by unanswered mail)');
  if (!/const CMDS = \{[^\n]*\bstart,/.test(src)) bad.push('the `start` command is gone');
  return bad;
}
const real = verdicts(SRC);
const BREAKS = [
  ['the old default: bare = start', (s) => s.replace("cmd = argv[0] || 'help'", "cmd = argv[0] || 'start'")],
  ['bare = done', (s) => s.replace("cmd = argv[0] || 'help'", "cmd = argv[0] || 'done'")],
  ['help removed', (s) => s.replace('\n  help: async () => console.log(', '\n  helpx: async () => console.log(')],
  ['help gated by mail', (s) => s.replace("['help', 'say',", "['say',")],
];
let caught = 0;
for (const [name, br] of BREAKS) { const mm = br(SRC); if (mm !== SRC && verdicts(mm).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const b of real) console.log(`  ✗ ${b}`);
console.log(`gobarecheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${4 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
