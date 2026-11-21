// totemlockstepcheck.mjs -- #6615 (G17-L89): lockstep scenario 'totem': totem of undying on a player (main hand / off hand / both / none) taking a lethal
// zombie hit, fall, lava or void damage, 20 seeds. Reference = .decomp LivingEntity.tryUseTotem (skipped for OUT_OF_WORLD = bypassesInvul; MAIN_HAND then OFF_HAND,
// first totem shrunk by 1, health 1, clearStatusEffects, Regeneration amp 1 900, Absorption amp 1 100, Fire Resistance amp 0 800, status 35) written out independently.
// Per tick: health, effects [[id,amp,duration]], totem counts per hand, dead, event-35 tick, compared with lockstep/trace.mjs compareTraces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07y_equip.js', '07_world.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '14d_survival.js', '14j_combat.js'], dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const { Survival: Sv, Effects: ES, Inventory: Iv } = M;
const ids = ES.IDS;
let fails = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const TICKS = 30, HIT = 5, salts = Array.from({ length: 20 }, (_, i) => i);
const HANDS = { main: [1, 0], off: [0, 1], both: [1, 1], none: [0, 0] };
const SRC = { zombie: ['mob', 20], fall: ['fall', 20], lava: ['lava', 20], void: ['outOfWorld', 100] };
let event35 = -1, clock = 0;
M.Particle = Object.assign(M.Particle || {}, { totemActivated() { event35 = clock; } });
// reference: vanilla effect timers after the hit (every duration decrements once per tick, after the hit tick's own pass)
function reference(hands, srcKey, hp0, extra) {
  const rows = []; let [m, o] = HANDS[hands], hp = hp0, dead = false, fx = [], ev = -1;
  if (extra) fx = [[ids.speed, 0, 500]];
  for (let t = 0; t < TICKS; t++) {
    if (t === HIT) {
      hp -= SRC[srcKey][1];
      if (hp <= 0) {
        const exempt = srcKey === 'void';
        if (!exempt && m) { m--; } else if (!exempt && o) { o--; } else { dead = true; hp = 0; }
        if (!dead) { hp = 1; fx = [[ids.regeneration, 1, 900], [ids.absorption, 1, 100], [ids.fire_resistance, 0, 800]]; ev = t; }
      }
    } else {
      // LivingEntity.tickStatusEffects: canApplyUpdateEffect (regeneration: duration % (50 >> amp) == 0) heals 1, THEN the duration drops
      for (const x of fx) if (!dead && x[0] === ids.regeneration && x[2] % (50 >> x[1]) === 0 && hp < 20) hp++;
      fx = fx.map((x) => [x[0], x[1], x[2] - 1]).filter((x) => x[2] > 0);
    }
    rows.push({ hp, fx: fx.map((x) => x.slice()), m, o, dead, ev });
  }
  return rows;
}
function engine(hands, srcKey, hp0, extra) {
  const inv = Iv.create(), [m, o] = HANDS[hands];
  const e = { type: 'player', x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.8, effects: {}, equip: {}, inventory: inv, noAi: true, onGround: true, vx: 0, vy: 0, vz: 0 };
  Sv.init(e); e.health = hp0; e.maxHealth = 20;
  if (m) Iv.setItem(inv, inv.selected, Iv.stack('totem_of_undying', 1));
  if (o) Iv.setItem(inv, Iv.OFFHAND, Iv.stack('totem_of_undying', 1));
  M.World = { getLight: () => 0, getBlock: () => 0 };
  if (extra) ES.addStatusEffect(e, 'speed', 500, 0, false, false);
  const rows = []; event35 = -1;
  for (let t = 0; t < TICKS; t++) {
    clock = t;
    if (t === HIT) Sv.hurt(e, SRC[srcKey][0], SRC[srcKey][1], srcKey === 'zombie' ? { type: 'zombie', x: 2, y: 64, z: 0.5 } : undefined);
    else { if (e.invulnerable > 0) e.invulnerable--; ES.tick(e); }
    const cnt = (s) => { const st = Iv.getItem(inv, s); return st && st.n > 0 ? st.n : 0; };
    rows.push({ hp: e.health, fx: JSON.parse(JSON.stringify(e.effects)), m: cnt(inv.selected), o: cnt(Iv.OFFHAND), dead: !!e.dead, ev: event35 });
  }
  return rows;
}
const norm = (fx) => fx.slice().sort((a, b) => a[0] - b[0]);
const run = (hands, srcKey, salt) => {
  const hp0 = 5 + (salt * 3) % 15, extra = salt % 2 === 1;
  const R = reference(hands, srcKey, hp0, extra), E = engine(hands, srcKey, hp0, extra);
  const ex = (r) => ({ totems: r.m * 10 + r.o, dead: r.dead ? 1 : 0, event35: r.ev });
  const S = R.map((r, t) => Object.assign(serverRow(t, { Health: r.hp, ActiveEffects: norm(r.fx).map((x) => ({ Id: x[0], Amplifier: x[1], Duration: x[2] })) }), ex(r)));
  const G = E.map((r, t) => Object.assign(engineRow(t, { health: r.hp, effects: r.fx }, { effectIds: ids }), ex(r)));
  return { d: compareTraces(S, G, { fields: ['health', 'effects', 'totems', 'dead', 'event35'] }), R, E };
};
for (const hands of Object.keys(HANDS)) for (const s of Object.keys(SRC)) {
  const rs = salts.map((salt) => ({ salt, r: run(hands, s, salt) }));
  const bad = rs.filter((x) => x.r.d);
  ok(!bad.length, `${hands}/${s}: ${bad.slice(0, 2).map((x) => `salt ${x.salt} ${JSON.stringify(x.r.d)}`)}`);
  // outcome pins (reference is independent, these keep the scenario from being vacuous)
  const last = rs[0].r.R[TICKS - 1], saved = hands !== 'none' && s !== 'void';
  ok(last.dead === !saved, `${hands}/${s}: ${saved ? 'survives' : 'dies'}`);
}
{ const R = run('both', 'zombie', 0).R; ok(R[HIT].m === 0 && R[HIT].o === 1, 'both: main hand totem consumed first'); }
{ const E = run('both', 'zombie', 0).E; ok(E[HIT].m === 0 && E[HIT].o === 1 && E[HIT].ev === HIT, 'engine: main first, event at hit tick'); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const dirty = (h, s) => salts.some((x) => run(h, s, x).d);
{ const o = ES.addStatusEffect; ES.addStatusEffect = function (e, id, dur, ...r) { return o.call(this, e, id, id === 'regeneration' ? 800 : dur, ...r); };
  brk(dirty('main', 'zombie'), 'regeneration duration 900 -> 800 caught'); ES.addStatusEffect = o; }
{ const o = Iv.OFFHAND; const og = Iv.getItem; let flip = true;
  Sv.tryUseTotem = ((f) => function (e, src) { const sel = e.inventory.selected; e.inventory.selected = Iv.OFFHAND; const r = f.call(this, e, src); e.inventory.selected = sel; return r; })(Sv.tryUseTotem);
  brk(dirty('both', 'zombie'), 'offhand priority swapped caught'); }
console.log(`totemlockstepcheck: ${n + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
