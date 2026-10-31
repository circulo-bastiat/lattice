// tools/textclickcheck.mjs - #8239: JSON text clickEvent on the open chat (Screen.handleTextClick). Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const load = (patchChat) => {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '02i_text.js']) new Function('MCL', SRC(f))(NS);
  new Function('MCL', patchChat(SRC('15c_chat.js')))(NS);
  // stand-in for the dispatcher: /seed needs permission level 2 (vanilla), records what ran
  NS.ran = [];
  NS.Commands = { run: (t, p, o) => { NS.ran.push([t, o.level]); return o.level >= 2 ? { ok: true, lines: ['Seed: 1'] } : { ok: false, lines: ['Unknown command'] }; } };
  return NS;
};
const verdict = (patchChat) => {
  const bad = [], NS = load(patchChat), T = NS.Text, C = NS.Chat, got = {};
  C.sinks = { suggest: (t) => got.suggest = t, copy: (t) => got.copy = t, confirmUrl: (u) => got.url = u, changePage: (n) => got.page = n };
  const span = (action, value) => ({ text: 'link', clickEvent: { action, value } });
  const H = 200, y = H + C.BOTTOM - C.LINE + 2, xIn = C.LEFT + 3, xPad = C.LEFT + 200;
  const click = (a, v, x = xIn) => { C.reset(); C.add(T.fromJson(span(a, v))); C.open = true; const r = C.handleClick(x, y, H, 'P'); return r; };
  if (T.JSON_OWED.includes('clickEvent')) bad.push('clickEvent still in JSON_OWED');
  click('suggest_command', '/hi'); if (got.suggest !== '/hi') bad.push('suggest_command not routed');
  click('copy_to_clipboard', 'abc'); if (got.copy !== 'abc') bad.push('copy_to_clipboard not routed');
  click('change_page', '3'); if (got.page !== 3) bad.push('change_page not routed');
  click('open_url', 'https://example.com'); if (got.url !== 'https://example.com') bad.push('open_url https not routed to confirm');
  got.url = null; click('open_url', 'file:///etc/passwd');
  if (got.url) bad.push('file:// URL reached the confirm screen');
  if (!C.lines.some((l) => l.runs.map((r) => r.text).join('') === 'Unsupported protocol: file')) bad.push('refused URL gave no Unsupported protocol message');
  NS.ran = []; click('run_command', '/seed');
  if (NS.ran.length !== 1 || NS.ran[0][0] !== '/seed') bad.push('run_command did not run /seed');
  else if (NS.ran[0][1] < 2) bad.push('run_command ran with permission level ' + NS.ran[0][1]);
  got.suggest = null; if (click('suggest_command', 'x', xPad) || got.suggest) bad.push('click on padding must not act');
  let threw = false; try { T.fromJson({ text: 'a', clickEvent: { action: 'nope', value: 'a' } }); } catch (e) { threw = !!e.json; }
  if (!threw) bad.push('unknown click action must be rejected');
  const kid = T.runs(T.fromJson({ text: 'A', clickEvent: { action: 'copy_to_clipboard', value: 'z' }, extra: [{ text: 'B' }] }));
  if (!kid[1].style || !kid[1].style.clickEvent) bad.push('child must inherit clickEvent');
  return bad;
};
const BREAKS = [
  ['file:// allowed', (c) => c.replace("sch !== 'http' && sch !== 'https'", 'false')],
  ['permission level 0', (c) => c.replace('C.CLICK_LEVEL = 4', 'C.CLICK_LEVEL = 0')],
  ['padding hit', (c) => c.replace('var st = C.styleAt(gx, gy, screenH), ev = st && st.clickEvent;', 'var st = C.styleAt(C.LEFT + 3, gy, screenH), ev = st && st.clickEvent;')],
  ['copy dropped', (c) => c.replace("else if (ev.action === 'copy_to_clipboard') C.sinks.copy(v);", '')],
];
const base = verdict((c) => c);
if (base.length) { console.log('FAIL', base.join('; ')); process.exit(1); }
let caught = 0;
for (const [n, f] of BREAKS) { const r = verdict(f); if (r.length) caught++; else console.log('NOT CAUGHT: ' + n); }
if (caught !== BREAKS.length) process.exit(1);
console.log('textclickcheck ok: ' + caught + ' breaks caught');
