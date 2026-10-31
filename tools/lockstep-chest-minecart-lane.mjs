// #6190: the chest_minecart lockstep lane stays registered in tools/referee/lanes.d (pilot --lanes chest_minecart --seeds 20 -> done, 0 divergences).
import { loadLanes } from './referee/chasescen.mjs';
const has = (ls) => ls.some((l) => l.id === 'chest_minecart' && l.mob === 'chest_minecart');
let ok = has(loadLanes());
const broken = [loadLanes().filter((l) => l.id !== 'chest_minecart'), loadLanes().map((l) => (l.id === 'chest_minecart' ? { ...l, mob: 'minecart' } : l))];
const caught = broken.filter((b) => !has(b)).length;
if (!ok || caught !== broken.length) { console.log('FAIL lane missing or breaks not caught'); process.exit(1); }
console.log(`chest_minecart lane registered; ${caught} breaks caught`);
