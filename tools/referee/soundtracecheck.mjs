// soundtracecheck.mjs -- #6218 (G17-L13): server-side trace rows carry 'sounds' ([id, volume, pitch] per tick); a swapped id is reported.
import { readFileSync } from 'node:fs';
import { loadEngine } from '../loadsrc.mjs';
import { drainSounds } from './lockstep/run.mjs';
import { serverRow, engineRow, compareTraces, parseSoundLog } from './lockstep/trace.mjs';
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const brk = (c, m) => { n++; if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const log = 'noise\nSND 3 minecraft:entity.zombie.ambient 1.0 1.25\nSND 3 minecraft:entity.zombie.step 0.15 1.0\nSND 6 entity.zombie.hurt 1.0 0.9\n';
const P = parseSoundLog(log);
ok(P[3].length === 2 && P[3][0][0] === 'entity.zombie.ambient' && P[3][0][2] === 1.25 && P[6][0][0] === 'entity.zombie.hurt', 'log parsed per tick, namespace stripped');
const mk = (f) => Array.from({ length: 8 }, (_, t) => serverRow(t, {}, { sounds: P[t] }));
const eng = (f) => Array.from({ length: 8 }, (_, t) => engineRow(t, {}, { sounds: f(t, P[t]) }));
ok(mk()[3].sounds && mk()[4].sounds === null, 'serverRow fills sounds only on ticks with sounds');
ok(compareTraces(mk(), eng((t, s) => s)) === null, 'identical sounds compare equal');
let d = compareTraces(mk(), eng((t, s) => (t === 6 ? [['entity.zombie.death', 1, 0.9]] : s)));
brk(d && d.tick === 6 && d.field === 'sounds', 'swapped sound id reported at tick 6, field sounds');
d = compareTraces(mk(), eng((t, s) => (t === 3 ? [s[0], [s[1][0], s[1][1], s[1][2] + 1e-9]] : s)));
brk(d && d.tick === 3 && d.field === 'sounds', 'pitch drift reported at tick 3');
// #6257: live cow hurt (tick 2) + death (tick 5) through the engine; pitch = (r1 - r2) * 0.2 + 1 in vanilla's roll order.
const R = [0.75, 0.25, 0.5, 0.125]; // r1,r2 per roll; values exact in binary
const liveRun = (flip) => {
  const M = loadEngine({ extra: ['02j_sounds.js', '07zzp_mobvoice.js'] });
  let i = 0; const real = Math.random; Math.random = () => R[i++ % R.length];
  try {
    const table = {};
    for (const l of readFileSync(new URL('../golden/mob-sounds-1.18.2.tsv', import.meta.url), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
    M.DATA = Object.assign({}, M.DATA, { mobSounds: table });
    const Sd = M.Sounds || M.Sound; Sd.trace(true);
    if (!M.MobVoice) return null;
    const cow = { type: 'cow', x: 0, y: 64, z: 0 };
    if (flip) M.MobVoice.pitch = (e) => (Math.random() - Math.random()) * -0.2 + 1;   // swapped roll order
    const rows = [];
    for (let t = 0; t < 8; t++) {
      Sd.traceTick = t;
      if (t === 2) M.MobVoice.onDamage(cow, false);
      if (t === 5) M.MobVoice.onDamage(cow, true);
      rows.push(engineRow(t, {}, { sounds: drainSounds(Sd, t) }));
    }
    return rows;
  } finally { Math.random = real; }
};
const FIX = 'noise\nSND 2 minecraft:entity.cow.hurt 0.4 1.1\nSND 5 minecraft:entity.cow.death 0.4 1.075\n';
const FP = parseSoundLog(FIX);
const srv = Array.from({ length: 8 }, (_, t) => serverRow(t, {}, { sounds: FP[t] }));
const live = liveRun(false);
ok(live && live[2].sounds && live[2].sounds[0][0] === 'entity.cow.hurt' && live[5].sounds[0][0] === 'entity.cow.death', 'live cow hurt + death traced');
ok(live && compareTraces(srv, live) === null, 'live cow sounds equal the recorded SND fixture');
const lf = liveRun(true), df = lf && compareTraces(srv, lf);
brk(df && df.tick === 2 && df.field === 'sounds', 'swapped pitch roll order fails on the first sounds row (tick 2)');
console.log(`soundtracecheck: ${n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
