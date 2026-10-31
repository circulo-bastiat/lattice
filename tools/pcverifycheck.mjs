// pcverifycheck (#10421): the post-switch-off process listing verifier flags vmmem, Runner.Worker and project node, and passes a clean PC. Each rule is broken to prove the check fails.
import { leftovers as real } from './infra/pcverify.mjs';
const clean = 'System 4\r\nchrome.exe C:\\Program Files\\Google\\chrome.exe\r\nnode.exe C:\\Users\\dan\\other-app\\server.js\r\nExplorer.EXE\r\n';
function verdict(impl) {
  const bad = [];
  if (impl(clean).length) bad.push('clean PC flagged');
  if (impl('').length) bad.push('empty listing flagged');
  const kinds = (t) => impl(t).map((x) => x.kind).join();
  if (kinds('vmmem 1234 8GB') !== 'vmmem') bad.push('vmmem missed');
  if (kinds('vmmemWSL 99') !== 'vmmem') bad.push('vmmemWSL missed');
  if (kinds('Runner.Worker.exe 55 D:\\actions-runner-land\\bin') !== 'runner') bad.push('Runner.Worker missed');
  if (kinds('node.exe "C:\\mclite\\tools\\usaged.mjs"') !== 'node') bad.push('project node missed');
  if (kinds(clean + 'node.exe C:\\mclite\\tools\\go.mjs\r\n') !== 'node') bad.push('project node among others missed');
  return bad;
}
const breaks = [
  (t) => real(t.replace(/vmmem/g, 'x')),
  (t) => real(t.replace(/Runner\./g, 'X.')),
  (t) => real(t.replace(/mclite|actions-runner|usaged/g, 'zzz')),
  (t) => real('').length ? real(t) : real(t).filter((x) => x.kind !== 'vmmem'),
  (t) => real(t).concat([{ kind: 'node', line: 'fake' }]),
  () => [],
];
const bad = verdict(real); bad.forEach((b) => console.log('FAIL', b));
let caught = 0;
breaks.forEach((b, i) => { if (verdict((t) => b(t)).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`pcverifycheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
process.exit(bad.length || caught < breaks.length ? 1 : 0);
