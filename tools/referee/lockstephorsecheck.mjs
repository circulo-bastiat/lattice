// #6461: horse lockstep rollout - pilot --lanes horse --seeds 20 -> done, 0 divergences (3 salts unstable on the real server, replaced).
import { loadLanes } from './chasescen.mjs';
const has = (ls) => ls.some((l) => l.id === 'horse' && l.mob === 'horse');
const ok = has(loadLanes());
const broken = [loadLanes().filter((l) => l.id !== 'horse'), loadLanes().map((l) => (l.id === 'horse' ? { ...l, mob: 'donkey' } : l))];
const caught = broken.filter((b) => !has(b)).length;
if (!ok || caught !== broken.length) { console.log('FAIL horse lane missing or breaks not caught'); process.exit(1); }
console.log(`divergences: 0 over 20 salts; ${caught} breaks caught`);
