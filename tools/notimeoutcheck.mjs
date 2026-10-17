// tools/notimeoutcheck.mjs - #2084: .claude/settings.json DENIES Bash(timeout *), sleep, nohup, watch (the no-polling rule), but brain
// workers kept running `timeout 800 node tools/suite.mjs --only <id>` and were denied (34 denials in 60 runs on 3 Oct), so they
// handed off unverified = burned runs. The worker, tester, fixer and commander prompts must say so (fixer/commander added 11 Oct, #5033). Pure: reads roles.json and settings.json.
import { readFileSync } from 'node:fs';
const roles = readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8');
const RULE = /NEVER prefix a command with timeout, sleep, nohup or watch/;
function verdicts(rolesText, settingsText) {
  const bad = [];
  let r; try { r = JSON.parse(rolesText); } catch { return ['roles.json does not parse']; }
  for (const role of ['worker', 'tester', 'fixer', 'commander']) {
    const p = ((r.roles || {})[role] || {}).prompt || '';
    if (!RULE.test(p)) bad.push(`the ${role} prompt does not forbid timeout/sleep/nohup/watch prefixes`);
    if (!/foreground/.test(p)) bad.push(`the ${role} prompt does not say to run checks in the foreground`);
  }
  // the rule only makes sense while settings.json still denies them; if the deny goes, this check says to revisit the prompts
  if (!/"Bash\(timeout \*\)"/.test(settingsText)) bad.push('settings.json no longer denies Bash(timeout *): delete this rule from the prompts and this check');
  return bad;
}
const real = verdicts(roles, settings);
const BREAKS = [
  ['worker prompt loses the rule', () => [roles.replace(RULE, 'x').replace(RULE, 'x'), settings]],
  ['only the worker keeps it', () => { const i = roles.lastIndexOf('NEVER prefix a command with timeout'); return [roles.slice(0, i) + 'nothing here' + roles.slice(i + 'NEVER prefix a command with timeout'.length), settings]; }],
  ['fixer prompt loses the rule', () => { const r = JSON.parse(roles); r.roles.fixer.prompt = r.roles.fixer.prompt.replace(RULE, 'x'); return [JSON.stringify(r), settings]; }],
  ['commander prompt loses the rule', () => { const r = JSON.parse(roles); r.roles.commander.prompt = r.roles.commander.prompt.replace(RULE, 'x'); return [JSON.stringify(r), settings]; }],
  ['foreground word removed', () => [roles.replace(/foreground/g, 'frontground'), settings]],
  ['settings stops denying timeout', () => [roles, settings.replace('"Bash(timeout *)"', '"Bash(x *)"')]],
];
let caught = 0;
for (const [name, mk] of BREAKS) { const [a, b] = mk(); if ((a !== roles || b !== settings) && verdicts(a, b).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const b of real) console.log(`  ✗ ${b}`);
console.log(`notimeoutcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${5 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
