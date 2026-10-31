// pcretirescriptcheck (#10421): the generated PC switch-off script retires exactly the 'retire' pieces and never a 'keep' one. Each rule is then broken to prove the check fails.
import { script as real, ACTIONS } from './infra/pcretire-script.mjs';
import { PIECES } from './infra/pcretire.mjs';
const names = Object.keys(PIECES);
const mk = (keep = []) => names.map((piece) => ({ piece, verdict: keep.includes(piece) ? 'keep' : 'retire', why: 'w' }));
function verdict(impl) {
  const bad = [];
  let s = impl(mk());
  for (const p of names) if (!s.includes('# RETIRE ' + p)) bad.push('retire piece has no block: ' + p);
  if (!/Stop-VM -Name claude-sandbox/.test(s) || !/autoStartVmOnJob/.test(s)) bad.push('VM block lacks stop / autoStartVmOnJob');
  if (!/Get-Process vmmem,Runner\.Worker,node/.test(s)) bad.push('no verification line');
  s = impl(mk(['Hyper-V brain VM', 'usaged service']));
  if (/Stop-VM|usaged\*/.test(s)) bad.push('a keep piece got stop commands');
  if (!s.includes('# KEEP Hyper-V brain VM: w')) bad.push('keep piece not listed with its reason');
  if (!/actions\.runner\.\*-land/.test(s)) bad.push('lander block lost when only others are kept');
  if (/ghp_|github_pat_|token/i.test(impl(mk()))) bad.push('script mentions a token');
  for (const p of names) if (!(ACTIONS[p] || []).length) bad.push('no action for ' + p);
  return bad;
}
const breaks = [
  (v) => real(v).replace(/# RETIRE /g, '# retire '),
  (v) => real(v.map((x) => ({ ...x, verdict: 'retire' }))),                    // keep ignored
  (v) => real(v).replace(/Stop-VM -Name claude-sandbox[^\n]*\n/, ''),
  (v) => real(v).replace(/autoStartVmOnJob/g, 'x'),
  (v) => real(v).replace(/# KEEP [^\n]*\n/g, ''),
  (v) => real(v).replace(/Get-Process vmmem[^\n]*\n/, ''),
  (v) => real(v) + '# github_pat_x\n',
  (v) => real(v).replace(/Get-Service "actions\.runner\.\*-land\*"[^\n]*\n/, ''),
];
const bad = verdict(real); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach((b, i) => { if (verdict(b).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`pcretirescriptcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
process.exit(bad.length || caught < breaks.length ? 1 : 0);
