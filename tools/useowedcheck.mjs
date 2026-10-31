#!/usr/bin/env node
// useowedcheck.mjs - #10753: Use.OWED names no written book/spyglass row, and both are reachable via Use.rightClick.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/14l_use.js', 'utf8');
let bad = 0, n = 0; const t = (ok, m) => { n++; if (!ok) { bad++; console.log('FAIL ' + m); } };
const owedRows = (text) => {
  const a = text.indexOf('Use.OWED = ['), b = text.indexOf('\n  ];', a);
  return text.slice(a, b).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    .split(/',\n\s*'/).filter((r) => /^\s*'?(written book|spyglass)/i.test(r.replace(/^[\s\S]*?Use\.OWED = \[\s*/, '')));
};
const stale = (text) => /'\s*(written book|spyglass)[^']*— G19e/i.test(text.slice(text.indexOf('Use.OWED = ['), text.indexOf('\n  ];', text.indexOf('Use.OWED = ['))));
const rc = (text) => {
  const f = text.slice(text.indexOf('Use.rightClick = '));
  return /Use\.bookUse\(P, stack\)\) return/.test(f) && /Use\.spyglassStart\(P, stack, hand\)\) return/.test(f) &&
    /Use\.bookStart\(P, stack\)\) return/.test(f);
};
const igStale = (text) => /'igniters and lead — G19e/.test(text);
const check = (text) => { t(!igStale(text), 'no igniters-and-lead OWED row'); t(!stale(text), 'no written book/spyglass OWED row'); t(rc(text), 'rightClick reaches bookUse/spyglassStart/bookStart'); };
check(src);
const M = loadEngine ? await loadEngine() : null;
const U = (M && (M.Use || M.NS?.Use)) || null;
if (U) { t(typeof U.bookUse === 'function' && typeof U.spyglassStart === 'function' && typeof U.bookStart === 'function', 'functions exist'); t(!U.OWED.some((r) => /^(written book|spyglass)/i.test(r)), 'live OWED clean'); }
let caught = 0;
for (const b of [
  src.replace('Use.OWED = [', "Use.OWED = [\n    'written book, spyglass — G19e',"),
  src.replace('Use.OWED = [', "Use.OWED = [\n    'igniters and lead — G19e',"),
  src.replace('Use.bookUse(P, stack)) return', 'false) return'),
  src.replace('Use.spyglassStart(P, stack, hand)) return', 'false) return'),
  src.replace('Use.bookStart(P, stack)) return', 'false) return'),
]) { const before = bad; check(b); if (bad > before) caught++; bad = before; }
t(caught === 5, `breaks caught ${caught}/5`);
console.log(bad ? 'FAILED' : `${n} assertions, 0 failures, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
