// tools/requestcontractcheck.mjs - #7686: what the helpers produce is exactly what the app's parser reads (one shared module).
import * as R from './infra/requests.mjs';
const dash = '<!doctype html><html><body><script>1</script></body></html>';
const verdict = (R) => {
  const bad = [], t = 'x'.repeat(100) + '\nsecond line', u = { id: 'u1', what: 'w', undo: 'revert PR #5' };
  if (R.titleOf(t) !== 'x'.repeat(80)) bad.push('title = first line, max 80');
  const b = R.bodyOf(t + '\n\n'); if (!b.startsWith(t) || b.split('\n').pop() !== '<!-- request -->') bad.push('body = words verbatim + marker last line');
  if (!R.parseIssue(['request', 'req:waiting'], b).isRequest) bad.push('issue not recognised');
  if (R.parseIssue(['request', 'req:waiting', 'req:done'], b).isRequest) bad.push('two status labels must not be a request');
  if (R.parseIssue(['request', 'req:done'], 'no marker').isRequest) bad.push('marker required');
  if (R.mailOf(7) !== 'to: requests\nfrom: dan\ntype: info\n\n#7') bad.push('wake mail format');
  const c = R.commentOf('requests', 'hi ' + R.undoBlock(u.id, u.what, u.undo) + '\n' + R.resultBlock('ok') + '\n' + R.block('dashboard', dash));
  const p = R.parseComment(c); if (!p || p.from !== 'requests') bad.push('comment from line');
  const bl = p ? R.parseBlocks(p.md) : [];
  if (!bl.some((x) => x.kind === 'undo' && x.id === 'u1' && x.undo === u.undo)) bad.push('undo block not parsed');
  if (!bl.some((x) => x.kind === 'result' && x.text === 'ok')) bad.push('result block not parsed');
  if (!bl.some((x) => x.kind === 'dashboard' && x.html === dash)) bad.push('dashboard not parsed');
  if (R.parseBlocks(R.block('dashboard', dash + 'x'.repeat(60000))).length) bad.push('oversize dashboard accepted');
  if (R.parseBlocks(R.block('dashboard', '<html><script src="https://e.com/a.js"></script></html>')).length) bad.push('external URL dashboard accepted');
  if (R.parseBlocks(R.block('undo', '{nope')).length) bad.push('broken undo json accepted');
  if (R.parseComment('no from line')) bad.push('comment without from accepted');
  if (R.undoIdOf('undo u1') !== 'u1' || R.undoIdOf('please undo u1')) bad.push('undo comment parse');
  const f = R.findUndo([{ body: c }, { body: R.commentOf('dan', 'undo u1') }], 'u1'); if (!f || f.undo !== u.undo) bad.push('findUndo');
  if (R.findUndo([{ body: R.commentOf('dan', R.undoBlock('u1', 'w', 'rm -rf /')) }], 'u1')) bad.push('dan-authored undo block must not be runnable');
  return bad;
};
const BREAKS = [
  ['title not cut', { titleOf: (t) => t.split('\n')[0] }], ['marker dropped', { bodyOf: (t) => t }],
  ['mail type wrong', { mailOf: (n) => `to: requests\nfrom: dan\n\n#${n}` }], ['no blank line after from', { commentOf: (w, m) => `from: ${w}\n${m}` }],
  ['undo kind unparsed', { parseBlocks: (m) => R.parseBlocks(m).filter((b) => b.kind !== 'undo') }],
  ['oversize allowed', { parseBlocks: (m) => (/```dashboard/.test(m) ? [{ kind: 'dashboard', html: m }] : R.parseBlocks(m)) }],
  ['findUndo trusts dan', { findUndo: (cs, id) => { for (const c of cs) for (const b of R.parseBlocks(R.parseComment(c.body)?.md || '')) if (b.id === id) return b; return null; } }],
  ['two statuses ok', { parseIssue: (l, b) => ({ isRequest: true, status: 'x' }) }],
];
const real = verdict(R); let caught = 0;
for (const [n, o] of BREAKS) { if (verdict({ ...R, ...o }).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`requestcontractcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
