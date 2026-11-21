// #8997: the .pilot-args writer puts the pack in field 5: unset -> 2 (default), 1 -> 1, 2 -> 2. Breaks its own expectations to prove it can fail.
import { pilotPack, pilotArgsLine } from './infra/mirror.mjs';
const field5 = (v, f = pilotPack) => pilotArgsLine('cow', 0, 20, [0, 1, 2], f(v)).trim().split(' ')[4];
const cases = [[undefined, '2'], ['1', '1'], ['2', '2'], ['', '2'], ['9', '4']];
let bad = 0;
for (const [v, want] of cases) if (field5(v) !== want) { bad++; console.error(`pack ${v}: field 5 ${field5(v)} want ${want}`); }
let caught = 0;
for (const [v, want] of cases) if (field5(v, () => 1) !== want) caught++;   // a writer stuck at 1 must disagree somewhere
if (!caught) { console.error('anti-vacuity: broken writer not caught'); bad++; }
console.log(`pilotpackcheck: ${cases.length} cases, ${bad} bad, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
