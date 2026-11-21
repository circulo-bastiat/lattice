// #6193: the tnt_minecart lockstep lane stays registered in tools/referee/lanes.d (pilot --lanes tnt_minecart --seeds 20 -> done, 0 divergences).
import { loadLanes } from './referee/chasescen.mjs';
const has = (ls) => ls.some((l) => l.id === 'tnt_minecart' && l.mob === 'tnt_minecart');
let ok = has(loadLanes());
const broken = [loadLanes().filter((l) => l.id !== 'tnt_minecart'), loadLanes().map((l) => (l.id === 'tnt_minecart' ? { ...l, mob: 'minecart' } : l))];
const caught = broken.filter((b) => !has(b)).length;
if (!ok || caught !== broken.length) { console.log('FAIL lane missing or breaks not caught'); process.exit(1); }
console.log(`tnt_minecart lane registered; ${caught} breaks caught`);
