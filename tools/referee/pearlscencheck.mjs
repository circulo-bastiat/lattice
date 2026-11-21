// pearlscencheck.mjs -- #6312 (G17-L61): the pearl lane's script is valid, throws 3 pearls at distinct angles inside T ticks, and
// every bad variant is rejected / detected.
import { pearlScript, scriptErrors, T, THROWS, STEP, SALTS } from './pearlscen.mjs';
import { validateScript, serverCommands, usePackets } from './lockstep/playerlane.mjs';
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const s = pearlScript();
ok(scriptErrors().length === 0, 'script validates');
ok(usePackets(s).length === 3 && THROWS.length === 3 && SALTS === 20, 'three throws, 20 salts');
ok(new Set(THROWS.map((t) => t.yaw + ',' + t.pitch)).size === 3, 'three distinct angles');
ok(STEP >= 20 && usePackets(s).every((t) => t < T), 'throws clear the 20-tick pearl cooldown and fit in T');
ok(serverCommands(s, 'bot0')[0][0] === 'give bot0 minecraft:ender_pearl 3', 'server gives 3 pearls up front');
brk(validateScript(s.concat([{ tick: T, op: 'use' }]), T).length === 1, 'a throw past T rejected');
brk(validateScript(s.map((x) => x.op === 'look' ? { ...x, pitch: undefined } : x), T).length === 3, 'look without pitch rejected');
brk(usePackets(s.filter((x) => x.op !== 'use')).length === 0, 'script without use throws nothing');
console.log(`pearlscencheck: ${breaks + 5} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
