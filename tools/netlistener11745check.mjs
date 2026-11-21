#!/usr/bin/env node
// netlistener11745check.mjs — #11745: src/02o_netlistener.js against the decompiled listener interfaces in .decomp.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, '.decomp/net/minecraft/network/listener');
const src = readFileSync(join(ROOT, 'src/02o_netlistener.js'), 'utf8');
function load(code) { const NS = {}; new Function('MCL', code)(NS); return NS.NetListener; }
function scenario(L, truth) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  for (const [n, t] of Object.entries(truth)) {
    const d = L.interfaces[n];
    chk(d, 'missing interface ' + n); if (!d) continue;
    chk(d.parent === t.parent, n + ' parent ' + d.parent + ' != ' + t.parent);
    const got = Object.entries(d.methods).map(([k, v]) => k + ':' + v).sort().join();
    chk(got === t.methods.slice().sort().join(), n + ' method table differs from decomp');
  }
  chk(L.shouldCrashOnException('ClientPlayPacketListener') === true, 'client crashes on exception');
  chk(L.shouldCrashOnException('ServerPlayPacketListener') === false, 'server does not crash on exception');
  chk(L.isServerSide('ServerLoginPacketListener') && !L.isServerSide('ClientLoginPacketListener'), 'side');
  const base = { onDisconnected() {}, getConnection() {} };
  let threw = false; try { L.implement('ServerQueryPacketListener', Object.assign({ onPing() {} }, base)); } catch (e) { threw = true; }
  chk(threw, 'incomplete listener must be refused');
  const got = [];
  const l = L.implement('ServerQueryPacketListener', Object.assign({ onPing(p) { got.push(p); return 'pong'; }, onRequest() {}, onKey() {} }, base));
  chk(l.shouldCrashOnException() === false, 'implement default shouldCrash');
  chk(L.loopback(l).send('onPing', 7) === 'pong' && got[0] === 7, 'loopback dispatch');
  let bad = false; try { L.dispatch(l, 'onKey', {}); } catch (e) { bad = true; }
  chk(bad, 'handler of another interface refused');
  return f;
}
if (!existsSync(DIR)) { console.log('SKIP no .decomp'); process.exit(0); }
const truth = {};
for (const n of ['PacketListener', 'ServerPacketListener', 'ClientLoginPacketListener', 'ClientPlayPacketListener', 'ClientQueryPacketListener', 'ServerHandshakePacketListener', 'ServerLoginPacketListener', 'ServerPlayPacketListener', 'ServerQueryPacketListener']) {
  const s = readFileSync(join(DIR, n + '.java'), 'utf8');
  const m = /extends (\w+)/.exec(s);
  truth[n] = { parent: m ? m[1] : null, methods: [...s.matchAll(/void (\w+)\((\w+) var1\)/g)].filter((x) => n !== 'PacketListener').map((x) => x[1] + ':' + x[2]) };
}
let bad = 0;
const base = scenario(load(src), truth);
if (base.length) { console.log('FAIL baseline:\n ' + base.join('\n ')); process.exit(1); }
const cuts = [
  (s) => s.replace("'onPing:QueryPingC2SPacket',", ''),
  (s) => s.replace("shouldCrashOnException: false", 'shouldCrashOnException: true'),
  (s) => s.replace("if (m.length) throw", 'if (false) throw'),
  (s) => s.replace("if (!ok) throw", 'if (false) throw'),
  (s) => s.replace("'ServerPacketListener', [", "'PacketListener', ["),
  (s) => s.replace("I.PacketListener = {", "I.PacketListener = { zz:1,").replace("shouldCrashOnException: true };", "shouldCrashOnException: false };"),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply'); process.exit(1); } let r; try { r = scenario(load(s2), truth).length; } catch (e) { r = 1; } if (r) caught++; else console.log("uncaught cut", c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length + ' cuts caught'); process.exit(1); }
console.log('PASS netlistener11745check — ' + caught + ' breaks caught; 9 interfaces match decomp');
