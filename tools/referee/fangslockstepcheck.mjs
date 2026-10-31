// fangslockstepcheck.mjs -- #6617 (G17-L91): lockstep scenario 'fangs': an evoker 8 blocks from a standing dummy (line lane) and 2 blocks (circle lane); 20 seeds.
// Reference = .decomp EvokerEntity.ConjureFangsGoal.castSpell/conjureFangs (16 fangs 1.25*(i+1) apart with warmup i; close: 5 at 1.5 warmup 0 + 8 at 2.5 warmup 3;
// ground search on a solid top) + EvokerFangsEntity.tick (--warmup < 0: warmup == -8 bites once, startedAttack, --ticksLeft < 0 discards; ticksLeft 22) + damage (6.0 magic).
// Per tick: every evoker_fangs [x, y, z, warmup, attacked], and the bites (tick, damage) on the dummy. Fangs read no Random, so the seed moves the dummy and the facing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const EXTRA = ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07v_spell.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); if (M.Combat && M.Combat.init) M.Combat.init();
const EL = M.EntityList, SP = M.Spell, W = M.World;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 50, GY = 80;
const params = (salt, lane) => { const r = stream(salt); const D = lane === 'line' ? 8 : 2; return { D, dx: r() * 1.2 - 0.6, dz: lane === 'line' ? r() * 0.4 - 0.2 : 0 }; };
const EV = { x: 0.5, z: 0.5 }, DW = 0.6, DH = 1.8;
const cl = (x) => Math.round(x * 1e9) / 1e9;
function plan(p) {   // [x, z, angle, warmup] in conjureFangs order
  const tx = EV.x + p.dx, tz = EV.z + p.D + p.dz, a0 = Math.atan2(tz - EV.z, tx - EV.x), dx = tx - EV.x, dz = tz - EV.z, out = [];
  if (dx * dx + dz * dz < 9) {
    for (let i = 0; i < 5; i++) { const a = a0 + i * Math.PI * 0.4; out.push([EV.x + Math.cos(a) * 1.5, EV.z + Math.sin(a) * 1.5, a, 0]); }
    for (let i = 0; i < 8; i++) { const a = a0 + i * Math.PI * 2 / 8 + Math.PI * 2 / 5; out.push([EV.x + Math.cos(a) * 2.5, EV.z + Math.sin(a) * 2.5, a, 3]); }
  } else for (let i = 0; i < 16; i++) { const d = 1.25 * (i + 1); out.push([EV.x + Math.cos(a0) * d, EV.z + Math.sin(a0) * d, a0, i]); }
  return { fangs: out, tx, tz };
}
function reference(p) {
  const { fangs, tx, tz } = plan(p), rows = [], bites = [];
  for (let t = 1; t <= TICKS; t++) {
    const row = [];
    fangs.forEach(([x, z, , w0], i) => {
      if (t >= w0 + 23) return;   // discarded on its 23rd tick after warmup runs out
      if (t === w0 + 8 && Math.abs(tx - x) <= 0.25 + 0.2 + DW / 2 && Math.abs(tz - z) <= 0.25 + 0.2 + DW / 2) bites.push([t, 6]);
      row.push([cl(x), GY, cl(z), w0 - t, t >= w0 + 1 ? 1 : 0]);
    });
    rows.push({ t, fangs: row, bites: bites.slice() });
  }
  return rows;
}
function engine(p) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const STONE = M.States.stateOf('stone') | 0;
  for (let x = -10; x <= 10; x++) for (let z = -4; z <= 30; z++) W.setBlock(x, GY - 1, z, STONE);
  EL.init(); M.Player = null;
  const ev = EL.spawn('evoker', EV.x, GY, EV.z, {}); ev.silent = true; ev.noAI = ev.noAi = true;
  const d = EL.spawn('iron_golem', EV.x + p.dx, GY, EV.z + p.D + p.dz, {}); d.silent = true; d.noAI = d.noAi = true; d.maxHealth = d.health = 1000;
  d.width = DW; d.height = DH;
  ev.target = d;
  const bites = [], fd = SP.fangsDamage; let now = 0;
  SP.fangsDamage = (e, ctx) => fd(e, Object.assign({}, ctx, { hurt: (tg, amt, o) => { if (tg === d) bites.push([now, amt]); return ctx.hurt(tg, amt, o); } }));
  try {
    SP.castFangs(ev, EL.aiCtx(ev)); ev.target = null;
    const rows = [];
    for (let t = 1; t <= TICKS; t++) {
      now = t; EL.tick();
      rows.push({ t, fangs: EL.list.filter((q) => q.type === 'evoker_fangs' && !q.removed).map((f) => [cl(f.x), f.y, cl(f.z), f.warmup, f.startedAttack ? 1 : 0]), bites: bites.slice() });
    }
    return rows;
  } finally { SP.fangsDamage = fd; }
}
const srt = (a, b) => a[2] - b[2] || a[0] - b[0];
const diff = (R, E) => {
  for (let i = 0; i < R.length; i++) {
    const a = JSON.stringify(R[i].fangs.slice().sort(srt)), b = JSON.stringify(E[i].fangs.slice().sort(srt));
    if (a !== b) { const j = [...a].findIndex((c, k) => c !== b[k]); return `tick ${R[i].t} fangs @${j} ${a.slice(j - 30, j + 40)} vs ${b.slice(j - 30, j + 40)}`; };
    if (JSON.stringify(R[i].bites) !== JSON.stringify(E[i].bites)) return `tick ${R[i].t} bites ${JSON.stringify(R[i].bites)} vs ${JSON.stringify(E[i].bites)}`;
  }
  return null;
};
const lane = (name, s) => { const p = params(s, name), R = reference(p); return { R, d: diff(R, engine(p)) }; };
for (const name of ['line', 'circle']) {
  const res = salts.map((s) => ({ s, ...lane(name, s) }));
  ok(res.every((r) => !r.d), name + ': ' + res.filter((r) => r.d).slice(0, 3).map((r) => `seed ${r.s} ${r.d}`));
  const n = name === 'line' ? 16 : 13;
  ok(res.every((r) => r.R[0].fangs.length === n), name + ' summons ' + n + ' fangs');
  ok(res.every((r) => r.R[TICKS - 1].fangs.length === 0 || name === 'line'), name + ' fangs gone by tick ' + TICKS);
  ok(res.every((r) => r.R[TICKS - 1].bites.length >= 1), name + ' bites the dummy');
}
const L = lane('line', 0).R, C = lane('circle', 0).R;
ok(L[0].fangs.map((f) => f[3]).join() === Array.from({ length: 16 }, (_, i) => i - 1).join(), 'line warmup spacing 1 (0..15 minus the first tick)');
ok(C[TICKS - 1].bites.every((b) => b[1] === 6), 'every bite is 6.0');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const cf = SP.conjureFangs;
SP.conjureFangs = (o, c, x, z, a, b, an, w) => cf(o, c, x, z, a, b, an, w > 0 && w < 16 && w !== 3 ? w * 2 : w);
brk(salts.some((s) => lane('line', s).d), 'warmup spacing 1 -> 2 is reported'); SP.conjureFangs = cf;
const fdmg = SP.FANG_DAMAGE; SP.FANG_DAMAGE = 5;
brk(salts.some((s) => lane('line', s).d), 'damage 6 -> 5 is reported'); SP.FANG_DAMAGE = fdmg;
console.log(`fangslockstepcheck: ${breaks + 2 * 3 + 2} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
