#!/usr/bin/env node
// fangsrefcheck.mjs — #6080: EvokerFangsEntity lifecycle, the engine against the REAL 1.18.2 server.
//   node tools/referee/runfangs.mjs && node tools/referee/fangsrefcheck.mjs
// A fang with Warmup 0/5/10 on a pig and on a witch: the victim's health (x100) per tick, the victim's alive bit and the
// fang's alive bit must match the server EXACTLY. Anti-vacuity: warmup off by one, damage 5, hit twice each fail.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, T, SCALE } from './fangsscen.mjs';

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'entity-fangs.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'entity-fangs.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('fangsrefcheck: SKIP (golden not generated -- run node tools/referee/runfangs.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07v_spell.js'];
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function runEngine(sc, hook) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init(); M.EntityList.init();
  if (M.Combat && M.Combat.init) M.Combat.init();
  const EL = M.EntityList, W = M.World, CH = M.CH, S = M.States;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const STONE = S.stateOf('stone') | 0;
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, -1, z, STONE);
  if (hook) hook(M);
  const v = EL.spawn(sc.victim, 0.5, 0, 0.5, {});
  v.noAI = true; v.noAi = true;
  const out = { hp: [], fang: [], alive: [] };
  let f = null;
  for (let k = 1; k <= T; k++) {
    if (k === 1) f = EL.spawn('evoker_fangs', 0.5, 0, 0.5, { warmup: sc.warmup });
    if (k === 1 && f.warmup !== sc.warmup) f.warmup = sc.warmup;
    const va = !v.removed && !v.dead && EL.list.includes(v);
    out.hp.push(va ? Math.floor(v.health * SCALE + 1e-6) : 0);
    out.alive.push(va ? 1 : 0);
    out.fang.push(!f.removed && EL.list.includes(f) ? 1 : 0);
    EL.tick();
  }
  return out;
}
function compare(id, g, e) {
  const bad = [];
  for (const key of ['hp', 'fang', 'alive']) {
    const a = g[key], b = e[key];
    const i = a.findIndex((x, k) => x !== b[k]);
    if (i >= 0) bad.push(`${id}.${key}: first differs at tick ${i}: server ${a.slice(Math.max(0, i - 2), i + 4).join(' ')} | engine ${b.slice(Math.max(0, i - 2), i + 4).join(' ')}`);
  }
  return bad;
}
console.log(`fangsrefcheck — evoker fangs vs the real 1.18.2 server (${Object.keys(golden.cases).length} scenarios, ${golden.generatedAt})`);
ok(golden.T === T, `golden T ${golden.T} = ${T} (regenerate: node tools/referee/runfangs.mjs)`);
const G = {};
for (const sc of SCENARIOS) {
  if (!ok(!!golden.cases[sc.id], `${sc.id}: in the golden`)) continue;
  const p = golden.cases[sc.id].probes;
  const g = G[sc.id] = { hp: p.hp, fang: p.fang, alive: p.alive };
  ok(g.hp.some((x) => x !== g.hp[0]) || g.alive.some((x) => x === 0), `${sc.id}: the server's victim was hurt`);
  try { for (const b of compare(sc.id, g, runEngine(sc))) ok(false, b); } catch (err) { ok(false, `${sc.id}: engine threw ${err.message}`); }
}
const caught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const sc0 = SCENARIOS.find((s) => s.id === 'pig_w5');
if (G[sc0.id]) {
  caught('warmup off by one is a mismatch', compare(sc0.id, G[sc0.id], runEngine({ ...sc0, warmup: sc0.warmup + 1 })).length > 0);
  caught('damage 5 is a mismatch', compare(sc0.id, G[sc0.id], runEngine(sc0, (M) => { M.Spell.FANG_DAMAGE = 5; })).length > 0);
  caught('hit twice is a mismatch', compare(sc0.id, G[sc0.id], runEngine(sc0, (M) => { const r = M.Spell.fangsDamage; M.Spell.fangsDamage = (e, c) => { const h = c.hurt; c.hurt = (t, a, o) => { h(t, a, o); t.invulnerableTime = 0; return h(t, a, o); }; r(e, c); c.hurt = h; }; })).length > 0);
}
console.log(`fangsrefcheck: ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ fangsrefcheck (#6080) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
