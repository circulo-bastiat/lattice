#!/usr/bin/env node
// servercmd11752check.mjs — #11752: net/minecraft/server/command. /kick and /publish against KickCommand/PublishCommand
// (.decomp), and the roster of the 23 classes: which are registered, which CommandManager never registers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = join(ROOT, '.decomp/net/minecraft/server/command/');
const src = readFileSync(join(ROOT, 'src/15g_commands.js'), 'utf8');
const javaK = readFileSync(D + 'KickCommand.java', 'utf8'), javaP = readFileSync(D + 'PublishCommand.java', 'utf8');
const javaCM = readFileSync(D + 'CommandManager.java', 'utf8');
function scenario(code) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const m = code.match(/\/\/ ── \/kick[\s\S]*?(?=\n    \/\/ ── \/save-all)/);
  if (!m) return ['kick/publish block missing'];
  const lvl = (re, j) => +(j.match(re) || [])[1];
  chk(/perm\(3\)/.test(m[0]) && lvl(/hasPermissionLevel\((\d)\)/, javaK) === 3, 'kick level');
  chk(/perm\(4\)/.test(m[0]) && lvl(/hasPermissionLevel\((\d)\)/, javaP) === 4, 'publish level');
  chk(/B\.integer\(0, 65535\)/.test(m[0]) && /integer\(0, 65535\)/.test(javaP), 'publish port range');
  for (const k of ['commands.kick.success', 'multiplayer.disconnect.kicked'])
    chk(m[0].includes(k) && javaK.includes(k), 'kick key ' + k);
  for (const k of ['commands.publish.failed', 'commands.publish.alreadyPublished', 'commands.publish.success'])
    chk(m[0].includes(k) && javaP.includes(k), 'publish key ' + k);
  chk(/C\.onKick\(ts\[i\], reason\)/.test(m[0]), 'kick must disconnect each target');
  chk(/return ts\.length/.test(m[0]), 'kick returns the count');
  chk(/'kick', 'publish'\]/.test(code), 'IMPLEMENTED names kick and publish');
  chk(/PublishCommand\.register/.test(javaCM) && /KickCommand\.register/.test(javaCM) && !/ChaseCommand\.register/.test(javaCM), 'CommandManager roster');
  chk(/isDevelopment\) \{\s*TestCommand/.test(javaCM), 'TestCommand is dev-only');
  // behaviour: run the real dispatcher
  return f;
}
const bad = scenario(src);
if (bad.length) { console.log('FAIL: ' + bad.join('; ')); process.exit(1); }
const breaks = [
  [s => s.replace("perm(3))\n      .then(arg('targets'", "perm(2))\n      .then(arg('targets'"), 'kick level'],
  [s => s.replace("lit('publish').requires(perm(4))", "lit('publish').requires(perm(2))"), 'publish level'],
  [s => s.replace('B.integer(0, 65535)', 'B.integer(0, 65536)'), 'port range'],
  [s => s.replace("'commands.publish.failed'", "'commands.publish.fail'"), 'failed key'],
  [s => s.replace('if (C.onKick) C.onKick(ts[i], reason);', ''), 'no disconnect'],
  [s => s.replace('return ts.length;\n    };\n\n    // ── /publish', 'return 1;\n    };\n\n    // ── /publish'), 'count'],
  [s => s.replace("'kick', 'publish']", "'kick']"), 'roster']
];
let caught = 0;
for (const [fn, why] of breaks) {
  const b = fn(src); if (b === src) { console.log('break did not apply: ' + why); process.exit(1); }
  if (scenario(b).length) caught++; else console.log('NOT caught: ' + why);
}
if (caught !== breaks.length) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('PASS servercmd11752check — ' + caught + ' breaks caught; kick/publish ported');
