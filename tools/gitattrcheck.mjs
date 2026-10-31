#!/usr/bin/env node
// gitattrcheck.mjs - #3706: .gitattributes forces LF in every checkout (a CRLF checkout on a Windows runner failed every text-matching
// check on 6 Oct). Anti-vacuity: each way of losing the rule is fed to the same test and must be caught.
import { readFileSync } from 'node:fs';
const rule = (txt) => txt.split('\n').some((l) => /^\*\s+(?=.*\btext=auto\b)(?=.*\beol=lf\b)/.test(l.trim()));
const real = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
ok(rule(real), '.gitattributes has "* text=auto eol=lf"');
for (const [name, broken] of [['rule removed', real.replace(/^\*\s.*$/m, '')], ['eol=lf dropped', real.replace('eol=lf', '')], ['text=auto dropped', real.replace('text=auto', '')], ['commented out', real.replace(/^\*\s/m, '# * ')]]) {
  asserts++; if (rule(broken)) { fails++; console.log('  FAIL break not caught: ' + name); } else { breaks++; console.log('  ✓ break caught: ' + name); }
}
console.log(`gitattrcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
