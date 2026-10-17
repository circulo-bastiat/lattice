#!/usr/bin/env node
// randomdisplaytickcheck.mjs — G17-X10: ClientWorld.doRandomBlockDisplayTicks (1334 tries) and
// LightningRodBlock.randomDisplayTick (.decomp LightningRodBlock:98-104). Breaks its own gates.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js', '07zx_particle.js', '07zzc_lightning.js'], dom: false
});
const W = M.World, SR = M.States, Lgt = M.Lightning, Px = M.Particle;
W.init(1); M.Behave.init(W); Px.init();
const rod = (f) => M.Behave.setProp(SR.stateOf('lightning_rod'), 'facing', f);
// rand() === 0 collapses every offset to 0, so all 1334 tries land on the centre block.
const base = { thundering: true, time: 0, topY: () => 65, rand: () => 0 };
const sparks = (st, y, env) => {
  Px.clear();
  const n = Lgt.doRandomBlockDisplayTicks(10, y, 10, env);
  return Px.list.length && n > 0 ? Px.list.length : 0;
};
const place = (st, y) => { W.getBlock = (x, yy, z) => (x === 10 && yy === y && z === 10 ? st : 0); };

place(rod('up'), 64);
ok(sparks(0, 64, base) > 0, 'rod in thunder at column top spawns electric_spark');
ok(sparks(0, 64, Object.assign({}, base, { thundering: false })) === 0, 'clear weather spawns none');
ok(sparks(0, 64, Object.assign({}, base, { topY: () => 70 })) === 0, 'no sky exposure spawns none');
ok(sparks(0, 64, Object.assign({}, base, { time: 199, rand: (() => { let i = 0; return () => (i++ % 2 ? 0 : 0); })() })) > 0, 'time%200 gate passes at 0 roll');
place(SR.stateOf('stone'), 64);
ok(sparks(0, 64, base) === 0, 'non-rod spawns none');

// anti-vacuity: break each gate and the matching assertion must flip
place(rod('up'), 64);
const orig = Lgt.rodDisplayTick;
Lgt.rodDisplayTick = (st, x, y, z, env) => orig(st, x, y, z, Object.assign({}, env, { thundering: true, topY: () => y + 1 }));
okAv(sparks(0, 64, Object.assign({}, base, { thundering: false })) > 0, 'forcing thunder makes clear weather spark (gate is live)');
Lgt.rodDisplayTick = (st, x, y, z, env) => orig(st, x, y, z, Object.assign({}, env, { thundering: false }));
okAv(sparks(0, 64, base) === 0, 'forcing clear weather silences thunder (gate is live)');
Lgt.rodDisplayTick = (st, x, y, z, env) => orig(st, x, y, z, Object.assign({}, env, { topY: () => y + 1 }));
okAv(sparks(0, 64, Object.assign({}, base, { topY: () => 99 })) > 0, 'forcing exposure makes covered rod spark (gate is live)');
Lgt.rodDisplayTick = orig;
let calls = 0; W.getBlock = () => { calls++; return 0; };
Lgt.doRandomBlockDisplayTicks(0, 64, 0, base);
okAv(calls === 1334, '1334 bounded tries per pass');

if (fails.length) { console.log('randomdisplaytickcheck: FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`randomdisplaytickcheck: OK — ${pass} passed, ${breaks} breaks caught`);
