#!/usr/bin/env node
// inboxserve.mjs — one text box, so Dan can write to the inbox from his phone. (D-366)
//
//   node tools/inboxserve.mjs [--port 8777] [--host 0.0.0.0]
//
// ⚠ WHAT THIS IS FOR. The file and the desktop shortcut only work at the PC. Dan asked for the
// couch and the phone as well. This serves one page on the LAN: a box, a Send button, and the
// current heartbeat underneath so he can see the session is alive without opening the app.
//
// ⚠⚠ THERE IS NO PASSWORD ON IT, AND THAT IS STATED RATHER THAN HIDDEN. Anything that can reach
// the port can append to INBOX.md. That is fine on a home LAN and it is NOT fine on the open
// internet. **For off-LAN access use Tailscale** — `guest/agent/install-tailscale.sh` in the VM
// folder, and the VM folder’s own `03-cluster-plan` note, §2, has the reasoning — which
// gives a private address that works from anywhere without forwarding a port or exposing
// anything. Do not port-forward this.
//
// ▶ It only ever APPENDS. It cannot edit or delete a message, and it never touches ANSWERS.md.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INBOX = join(ROOT, 'for-dan/INBOX.md');
const HEARTBEAT = join(ROOT, 'for-dan/HEARTBEAT.md');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt('--port', '8777'));
const HOST = opt('--host', '0.0.0.0');

const nextId = () => {
  const txt = existsSync(INBOX) ? readFileSync(INBOX, 'utf8') : '';
  const ns = [...txt.matchAll(/^##\s+m-(\d+)/gm)].map((m) => Number(m[1]));
  return 'm-' + String((ns.length ? Math.max(...ns) : 0) + 1).padStart(3, '0');
};

const page = () => {
  const beat = existsSync(HEARTBEAT) ? readFileSync(HEARTBEAT, 'utf8') : '(no heartbeat yet)';
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Message Claude</title>
<style>
 :root{color-scheme:dark light}
 body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:38rem;margin-inline:auto}
 textarea{width:100%;box-sizing:border-box;min-height:9rem;font:inherit;padding:.6rem;border-radius:.5rem}
 button{font:inherit;padding:.7rem 1.4rem;border-radius:.5rem;margin-top:.6rem}
 pre{white-space:pre-wrap;font:13px/1.45 ui-monospace,monospace;opacity:.85;border-top:1px solid #8884;padding-top:1rem}
 h1{font-size:1.15rem}
</style>
<h1>Message Claude — <code>${nextId()}</code></h1>
<form method=POST action=/send>
 <textarea name=msg autofocus placeholder="stop tuning the flood. restate the claim with the fogged band named."></textarea>
 <button>Send</button>
</form>
<p style="opacity:.7;font-size:.9rem">It lands in <code>for-dan/INBOX.md</code>. The suite stays red until a session answers it.</p>
<pre>${esc(beat)}</pre>`;
};

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 64_000) req.destroy(); });
    req.on('end', () => {
      const msg = decodeURIComponent((body.split('msg=')[1] || '').replace(/\+/g, ' ')).trim();
      if (msg) {
        const id = nextId();
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        appendFileSync(INBOX, `\n## ${id}  ${stamp}\n${msg}\n`);
        console.log(`[inbox] ${id}: ${msg.slice(0, 70)}`);
      }
      res.writeHead(303, { Location: '/' }); res.end();
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(PORT, HOST, () => {
  console.log(`inbox box on http://${HOST}:${PORT}  (LAN only — use Tailscale for off-LAN, never a port forward)`);
});
