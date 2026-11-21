// lockstepleakcheck.mjs -- #6224: SeedAgent carries the three named lockstep leak fixes (java-free source check). Each mutated copy must fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const src = readFileSync(join(HERE, 'lockstep', 'SeedAgent.java'), 'utf8');
const ok = (t) => /replaceAll\("\[0-9\]\+\$", "#"\)/.test(t) && /c\.startsWith\("java\."\)/.test(t) && /getClassName\(\)\.equals\("acd"\)/.test(t) && /LEAKFIX/.test(t);
const chase = readFileSync(join(HERE, 'runchase.mjs'), 'utf8');
const phaseOk = (t) => /time query gametime/.test(t) && /%= #20 mc/.test(t) && /if score #g mc matches 0 run function mclitechase:spawn/.test(t);
let fails = 0, breaks = 0;
if (phaseOk(chase)) console.log('   ok: runchase arms the summon on gametime % 20 == 0'); else { fails++; console.log('  ✗ summon phase arm missing'); }
for (const [name, from] of [['gametime query', 'time query gametime'], ['phase modulo', '%= #20 mc'], ['arm on phase 0', 'if score #g mc matches 0 run function mclitechase:spawn']]) {
  if (!phaseOk(chase.replaceAll(from, 'zz'))) { breaks++; console.log(`   ✓ break caught: ${name}`); } else { fails++; console.log(`  ✗ break NOT caught: ${name}`); }
}
if (ok(src)) console.log('   ok: thread-name normalisation, java.* frame skip and summon counter present'); else { fails++; console.log('  ✗ leak fix missing'); }
for (const [name, from] of [['thread names', 'replaceAll("[0-9]+$", "#")'], ['java frames', 'c.startsWith("java.")'], ['summon counter', 'x.getClassName().equals("acd")'], ['switch', 'LEAKFIX']]) {
  if (!ok(src.replaceAll(from, 'zz'))) { breaks++; console.log(`   ✓ break caught: ${name}`); } else { fails++; console.log(`  ✗ break NOT caught: ${name}`); }
}
console.log(`lockstepleakcheck: 9 assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
