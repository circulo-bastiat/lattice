#!/usr/bin/env node
// bossbarcheck.mjs — #1584. `H.drawBossBars` against BossBarHud.render: bar at (W/2-91, 12), name
// 9 above, purple row (ordinal 5 -> v 50, fill +5), fill (int)(pct*183), 160-block tracking range,
// custom name overrides the name, 19px step.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

function run(mut) {
  const NS = {}; globalThis.MCL = NS;
  let t = readFileSync(join(ROOT, 'src/15_hud.js'), 'utf8');
  if (mut) t = mut(t);
  new Function('MCL', t)(NS);
  const H = NS.Hud, blits = [], texts = [];
  H.w = 400; H.h = 300; H.scale = 1;
  NS.Player = { x: 0, y: 64, z: 0 };
  NS.Gui = { ready: true, blit: (c, sh, r, x, y) => blits.push({ sh, r, x, y }),
    blitPart: (c, sh, r, x, y, s, f) => blits.push({ sh, r, x, y, f }),
    textWidth: s => s.length * 6, text: (c, s, x, y) => texts.push({ s, x, y }) };
  const w = (o, bb) => Object.assign({ type: 'wither', x: 10, y: 64, z: 0, bossBar: Object.assign({ name: 'Wither', percent: 0.5, color: 'purple', darkenSky: true }, bb) }, o);
  NS.EntityList = { list: [w({}), w({ x: 500 }), w({ customName: 'Boss' })] };
  H.drawBossBars({});
  return { blits, texts, H };
}
let r = run();
ok(r.blits.length === 4 && r.texts.length === 2, 'two in-range withers draw two bars (far one skipped)');
ok(r.blits[0].x === 109 && r.blits[0].y === 12 && r.blits[0].r[1] === 50, 'bar at W/2-91, y 12, purple row v=50');
ok(r.blits[1].r[1] === 55 && r.blits[1].f === 0.5, 'fill row v=55 at percent 0.5');
ok(r.texts[0].s === 'Wither' && r.texts[0].y === 3, 'name above the bar at y-9');
ok(r.texts[1].s === 'Boss' && r.blits[2].y === 31, 'custom name shown; next bar 19 lower');
// breakage probes: each mutation must flip the main assertions
const probes = [
  ['y start', t => t.replace('y = 12;', 'y = 10;'), x => x.blits[0].y !== 12],
  ['range', t => t.replace('H.BOSS_TRACK_RANGE = 160', 'H.BOSS_TRACK_RANGE = 1000'), x => x.blits.length !== 4],
  ['colour row', t => t.replace("pink: 0", "pink: 0, purple: 4").replace(/purple: 5,/, ''), x => x.blits[0].r[1] !== 50],
  ['custom name', t => t.replace('e.customName || e.bossBar.name', 'e.bossBar.name'), x => x.texts[1].s !== 'Boss'],
];
for (const [n, m, bad] of probes) okAv(bad(run(m)), 'breaking ' + n + ' is caught');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
