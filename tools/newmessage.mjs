#!/usr/bin/env node
// newmessage.mjs — append the next numbered heading to for-dan/INBOX.md. (D-366)
//
//   node tools/newmessage.mjs        (what NEW-MESSAGE.cmd runs, then it opens Notepad)
//
// ⚠ It exists because the same three lines written in batch need single quotes inside a
// `for /f '...'` block, which cmd ends the command on. The first version of NEW-MESSAGE.cmd
// did exactly that and would have written a broken heading. Batch calls node; node does the work.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const INBOX = join(fileURLToPath(new URL('..', import.meta.url)), 'for-dan/INBOX.md');
const txt = existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : '';
const ns = [...txt.matchAll(/^##\s+m-(\d+)/gm)].map((m) => Number(m[1]));
const id = 'm-' + String((ns.length ? Math.max(...ns) : 0) + 1).padStart(3, '0');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
appendFileSync(INBOX, `\n## ${id}  ${stamp}\n`);
console.log(id);
