// #11259: the shared cdp.mjs startWorld() helper reaches a meshed world on the built page through the real title flow
// (Singleplayer -> Create New World -> Create). Anti-vacuity: the Play (final Create) click is removed and must be caught.
import { open, sleep, startWorld } from './cdp.mjs';
const FILE = process.argv[2] || 'dist/mclite.html';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const page = await open(FILE, { port: 9462, width: 640, height: 360 });
if (!page) { console.log('SKIP no chrome'); process.exit(0); }
await sleep(1500);
ok(await startWorld(page) === true, 'startWorld never reached Main.ready');
const meshed = await page.waitFor(() => MCL.World && MCL.World.stats2 && MCL.World.stats2.meshed > 0, 90000);
ok(!!meshed, 'the world never meshed a section');
await page.close();
// break: drop the Play dispatch
let caught = 0;
const p2 = await open(FILE, { port: 9463, width: 640, height: 360 });
await sleep(1500);
const r = await startWorld(p2, { skip: true });
if (r !== true) caught++; else fails.push('break "no Play" went unnoticed');
await p2.close();
console.log(`${caught} breaks caught`);
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `startcheck: ${pass} passed`);
process.exit(fails.length || caught < 1 ? 1 : 0);
