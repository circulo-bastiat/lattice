// soaktracecheck.mjs -- #6270: soak harness pieces. Anti-vacuity: shifting one mob's spawn by 1 tick diverges that mob.
import { SOAK_MOBS, SOAK_TICKS, summonCommands, neighbours, perMobReport, fmtTable, shiftSpawn } from './lockstep/soak.mjs';
let fails = 0, breaks = 0;
const ok = (c, m) => { if (c) console.log('   ok: ' + m); else { fails++; console.log('  ✗ ' + m); } };
const caught = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
ok(SOAK_MOBS.length === 12 && SOAK_TICKS === 3000, '12 mobs, 3000 ticks');
ok(summonCommands().length === 12 && summonCommands().every((c) => /^summon minecraft:\w+ /.test(c.cmd)), '12 summon commands');
ok(SOAK_MOBS.every((m) => neighbours(m.n).length > 0), 'every mob has an interaction partner');
const mk = (n) => Array.from({ length: 40 }, (_, k) => ({ tick: k, pos: [n + k * 0.1, 64, n] }));
const S = SOAK_MOBS.map((m) => mk(m.n));
ok(perMobReport(S, S).every((r) => !r.div), 'identical traces: no divergence');
const R = perMobReport(S, shiftSpawn(S, 3));
caught(R[3].div && R[3].div.tick === 1 && R.filter((r) => r.div).length === 1, 'spawn +1 tick diverges that mob (only it, in a non-interacting model)');
ok(/identical/.test(fmtTable(R)) && /pos/.test(fmtTable(R)), 'table prints per-mob rows');
console.log(`soaktracecheck: 7 assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
