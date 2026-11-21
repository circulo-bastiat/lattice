// #6192: the hopper_minecart lockstep lane stays registered in tools/referee/lanes.d (pilot --lanes hopper_minecart --seeds 20 -> done, 0 divergences).
import { loadLanes } from './referee/chasescen.mjs';
const has = (ls) => ls.some((l) => l.id === 'hopper_minecart' && l.mob === 'hopper_minecart');
let ok = has(loadLanes());
const broken = [loadLanes().filter((l) => l.id !== 'hopper_minecart'), loadLanes().map((l) => (l.id === 'hopper_minecart' ? { ...l, mob: 'minecart' } : l))];
const caught = broken.filter((b) => !has(b)).length;
if (!ok || caught !== broken.length) { console.log('FAIL lane missing or breaks not caught'); process.exit(1); }
console.log(`hopper_minecart lane registered; ${caught} breaks caught`);
