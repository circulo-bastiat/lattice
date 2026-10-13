#!/usr/bin/env node
// minerefcheck.mjs — infra I6 (s147, 25 Sept 2026): a player's LEFT-click on a block vs the real 1.18.2 server (golden: runmine.mjs,
// mine.json; scenarios + vanilla sources: minescen.mjs). Engine side, the join a real held left button takes: the player
// (14_player.js) at (0.5, F, 0.5) looking straight down, `P.retarget()` (the crosshair ray), then `P.act(0.05)` once per tick with
// the button held (a stub NS.Input) until the cell is air — never Mining.progress / Loot.breakDrops called with a hand-built
// context, which would skip the question this pack exists for: does the HELD stack's enchantments and the player's EFFECTS reach
// the break (P.miningContext). The tool is a real stack in hotbar slot 0 ({i, n, t: {Enchantments}}); effects go through
// Effects.addStatusEffect exactly as /effect does. Judged per scene:
//   k      server ticks from START to the break (see minescen.mjs), engine k = 0 if the first tick broke it or its first-tick
//          progress >= 0.7 (the server's STOP rule), else ticks - 1; agree when |median(server) - engine| <= 1 (the RCON read
//          of the start tick lands one window either side), or both never break;
//   held   the main hand after (id x count @ damage) — exact, every rep (not judged for a bare hand: see compare);
//   gets   each item id dropped per break (engine: P.lastDrops, the break's own output) — exact mean.
// Anti-vacuity (D-30/D-305): a golden k shifted by 3, the engine's P.act no-op'd for one scene, a golden drop zeroed, a golden
// main-hand damage swapped.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, parseState } from './minescen.mjs';
const ME = 'minerefcheck';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mine.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mine.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log(`${ME}: golden not generated -- run node tools/referee/runmine.mjs (skipped)`); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js',
  '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js', '14_player.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: true, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
{ // Hand.attrs (isSword: creative sword refuses to mine) — same golden gen-data.mjs inlines into DATA.itemAttrs
  const table = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (!line || line[0] === '#' || c[0] === 'item' || c.length < 9) continue;
    table[c[0]] = [+c[6], +c[7], +c[8]];
  }
  M.Hand.bindAttrs(table);
}
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Mining && M.Mining.init && !M.Mining.ready) M.Mining.init();
if (M.Loot && M.Loot.init && !M.Loot.ready) M.Loot.init();
M.Diff = { get: () => 'normal' };
M.Use.init(w);
const { EntityList: EL, Items: IT, States: S, Behave: B, Gamemode: GM, Effects: ES } = M;
const P = M.Player;
P.init();
const INPUT = { uiOpen: false, locked: true, mouse: [false, false, false], mousePressed: [false, false, false], down: {}, sprintLatch: false };
M.Input = INPUT;
const F = 64;
const nameOf = (st) => (st && st.i !== undefined && (st.n | 0) > 0 ? IT.nameOf(st.i) || '' : '');
function stateFrom(str) {
  const { name, props } = parseState(str);
  let st = S.stateOf(name);
  if (!st) throw new Error('no engine block ' + name);
  for (const [k, v] of Object.entries(props)) { const n = B.setProp(st, k, v); if (n === undefined || n === null || n < 0) throw new Error(`no engine prop ${k}=${v} on ${name}`); st = n; }
  return st;
}
function engineRun(s, act) {
  const out = { attempts: 0, k: {}, held: {}, gets: {} };
  for (let r = 0; r < golden.REPS; r++) {
    cells.clear(); EL.list.length = 0;
    const stone = S.stateOf('stone');
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = F - 3; y <= F - 1; y++) w.set(x, y, z, stone);
    try { w.set(0, F - 1, 0, stateFrom(s.block)); } catch (e) { return { err: e.message }; }
    if (GM && GM.set) GM.set(P, s.mode === 'creative' ? GM.CREATIVE : GM.SURVIVAL);
    P.x = P.px = 0.5; P.y = P.py = F; P.z = P.pz = 0.5; P.ex = 0.5; P.ey = F; P.ez = 0.5;
    P.yaw = 0; P.pitch = -Math.PI / 2; P.crouching = false; P.targetEntity = null; P.onGround = true; P.eyeInWater = false;
    P.breakProgress = 0; P.breakTarget = -1; P.breakCooldown = 0; P.placeCooldown = 0; P.missTime = 0; P.attackTicks = 0; P.lastDrops = [];
    P.usingItem = false;
    if (P.effects) P.effects = null;
    if (ES && ES.initEntity) ES.initEntity(P);
    if (s.effect) ES.addStatusEffect(P, s.effect[0], 12000, s.effect[1], false, false);
    P.inventory.slots.fill(null);
    if (s.item !== 'air') {
      const it = IT.of(s.item);
      if (!(it >= 0)) return { err: `no engine item ${s.item}` };
      const st = { i: it, n: 1 };
      if (s.ench) st.t = { Enchantments: s.ench.map(([id, l]) => ({ id: 'minecraft:' + id, lvl: l })) };
      P.inventory.slots[0] = st;
    }
    P.slot = 0; if (P.inventory.selected !== undefined) P.inventory.selected = 0;
    if (P.syncHotbar) P.syncHotbar();
    P.retarget();
    const maxTicks = Math.round((s.wait || 6) * 20);
    let ticks = 0, per1 = null;
    INPUT.mouse[0] = true; INPUT.mousePressed[0] = true;
    while (ticks < maxTicks && w.get(0, F - 1, 0)) {
      (act || P.act)(0.05);
      ticks++;
      INPUT.mousePressed[0] = false;
      if (ticks === 1) per1 = P.breakProgress;
    }
    INPUT.mouse[0] = false;
    const broke = !w.get(0, F - 1, 0);
    const kE = !broke ? 'never' : (ticks <= 1 || per1 >= 0.7 ? 0 : ticks - 1);
    out.k[kE] = (out.k[kE] || 0) + 1;
    out.attempts++;
    const h = P.inventory.slots[0];
    const hn = nameOf(h);
    const hk = `${hn}x${hn ? h.n : 0}${hn && h.d ? '@' + h.d : ''}`;
    out.held[hk] = (out.held[hk] || 0) + 1;
    for (const g of s.gets || []) { out.gets[g] = out.gets[g] || 0; for (const d of (broke ? P.lastDrops : []) || []) if (String(d.item).replace('minecraft:', '') === g) out.gets[g] += d.count || 1; }
  }
  return out;
}
const median = (m) => { const a = []; for (const [k, n] of Object.entries(m)) for (let i = 0; i < n; i++) a.push(k === 'never' ? Infinity : +k); a.sort((x, y) => x - y); return a[a.length >> 1]; };
const fmt = (m, n) => Object.entries(m).map(([k, v]) => `${k === 'x0' ? 'empty' : k} ${(100 * v / n).toFixed(0)}%`).join(', ') || '-';
function compare(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  const out = [];
  const what = `${s.mode === 'creative' ? 'CREATIVE ' : ''}mine ${s.block} with ${s.item === 'air' ? 'a bare hand' : s.item}${s.ench ? ' ' + s.ench.map((q) => q.join(' ')).join(',') : ''}${s.effect ? ` under ${s.effect[0]} ${s.effect[1] + 1}` : ''}`;
  const gm = median(g.k), em = median(e.k);
  if (!(gm === Infinity && em === Infinity) && !(Math.abs(gm - em) <= 1))
    out.push(`${s.id}: ${what}: ticks to break — server ${gm === Infinity ? 'never' : gm + 1} · engine ${em === Infinity ? 'never' : em + 1}`);
  // A bare hand has nothing to wear, and the server bot's empty main hand picks its own drop up 0.8 s later (dirt_hand: `dirtx1`)
  // — the drop is judged by `gets`, so a bare-hand scene skips the main-hand rule.
  const keys = new Set(s.item === 'air' ? [] : [...Object.keys(g.held), ...Object.keys(e.held)]);
  for (const k of keys) if ((g.held[k] || 0) / g.attempts !== (e.held[k] || 0) / e.attempts) {
    out.push(`${s.id}: ${what}: main hand after — server ${fmt(g.held, g.attempts)} · engine ${fmt(e.held, e.attempts)}`); break;
  }
  for (const k of s.gets || []) if ((g.gets[k] || 0) / g.attempts !== (e.gets[k] || 0) / e.attempts)
    out.push(`${s.id}: ${what}: ${k} dropped per break — server ${((g.gets[k] || 0) / g.attempts).toFixed(2)} · engine ${((e.gets[k] || 0) / e.attempts).toFixed(2)}`);
  return out;
}
const reds = [];
let pass = 0;
console.log(`${ME} — left-click mining (break time, drops, tool wear, creative) vs the real 1.18.2 server (${SCEN.length} scenarios, golden ${golden.generatedAt})`);
const engine = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g || !g.attempts) { reds.push(`${s.id}: no golden case`); continue; }
  const e = engine[s.id] = engineRun(s);
  const bad = compare(s, g, e);
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(32)} k server ${JSON.stringify(g.k)} engine ${e.err || JSON.stringify(e.k)} | held ${fmt(g.held, g.attempts)} / ${e.err ? '' : fmt(e.held, e.attempts)} | gets ${JSON.stringify(g.gets)} / ${JSON.stringify(e.gets)}`);
}
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
const sc = (id) => SCEN.find((q) => q.id === id);
{ const s = sc('dirt_hand'), g0 = golden.cases[s.id]; const k = {}; for (const [kk, n] of Object.entries(g0.k)) k[+kk + 3] = n;
  brk('golden dirt_hand k shifted by 3', compare(s, Object.assign({}, g0, { k }), g0).length > 0); }
{ const s = sc('stone_iron_pickaxe'); brk('engine P.act no-op (stone_iron_pickaxe)', compare(s, golden.cases[s.id], engineRun(s, () => {})).length > 0); }
{ const s = sc('iron_ore_stone_pickaxe'), g0 = golden.cases[s.id];
  brk('golden iron_ore_stone_pickaxe raw_iron zeroed', compare(s, Object.assign({}, g0, { gets: Object.assign({}, g0.gets, { raw_iron: 0 }) }), g0).length > 0); }
{ const s = sc('stone_wooden_pickaxe'), g0 = golden.cases[s.id];
  brk('golden stone_wooden_pickaxe main hand swapped to undamaged', compare(s, Object.assign({}, g0, { held: { wooden_pickaxex1: g0.attempts } }), g0).length > 0); }
for (const r of reds) console.log('  ✗ ' + r);
console.log(`${ME}: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
