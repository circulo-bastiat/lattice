#!/usr/bin/env node
// lockstep-golembuild.mjs -- #6934 (G17-L194): lockstep scenario 'golembuild'. A scripted player places the last block (the carved pumpkin / jack o'lantern
// head) of a snow golem column, an iron golem T on each horizontal axis, and wrong patterns (gold middle, a block beside the head, uncarved pumpkin) that must
// not fire. 20 salts vary the origin, head block and the placement tick. Every tick the changed blocks, the entity list (type, pos, vel, playerCreated) and
// the block-break particle count (syncWorldEvent 2001 per pattern cell, Save.record per cleared cell) are compared with compareTraces against an independent
// transcription of CarvedPumpkinBlock.trySpawnEntity (.decomp): snow pattern "^","#","#" clears 3 and spawns at translate(0,2,0)+(.5,.05,.5); iron pattern
// "~^~","###","~#~" clears 3x3 (air cells included) and spawns playerCreated at translate(1,2,0)+(.5,.05,.5).
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareTraces } from './referee/lockstep/trace.mjs';

const SEEDS = 20, TICKS = 4;
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const KINDS = ['snow', 'ironX', 'ironZ', 'wrongGold', 'wrongSide', 'plain'];

function scen(seed) {
  const r = rng(seed * 7919 + 11), kind = KINDS[seed % KINDS.length];
  return { kind, x: Math.floor(r() * 40) - 20, y: 60 + Math.floor(r() * 20), z: Math.floor(r() * 40) - 20,
    head: r() < 0.5 ? 'carved_pumpkin' : 'jack_o_lantern', place: 1 + Math.floor(r() * 2) };
}
// the pre-head blocks: [dx, dy, dz, name] relative to the head cell
function base(s) {
  const o = [];
  if (s.kind === 'snow' || s.kind === 'plain') { o.push([0, -1, 0, 'snow_block'], [0, -2, 0, 'snow_block']); return o; }
  const ax = s.kind === 'ironZ' ? [0, 1] : [1, 0], mid = s.kind === 'wrongGold' ? 'gold_block' : 'iron_block';
  o.push([0, -1, 0, mid], [ax[0], -1, ax[1], 'iron_block'], [-ax[0], -1, -ax[1], 'iron_block'], [0, -2, 0, 'iron_block']);
  if (s.kind === 'wrongSide') o.push([ax[0], 0, ax[1], 'stone']);
  return o;
}
const headName = (s) => (s.kind === 'plain' ? 'pumpkin' : s.head);

function engine(s, o = {}) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js',
    '07l_spawn.js', '14j_combat.js', '07zw_mobnbt.js', '07zq_snowgolem.js', '07zzr_minecart.js'], dom: false });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, {
    entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')),
    monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1])
  });
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const SR = M.States, R = M.Reg, EL = M.EntityList, SG = M.SnowGolem, cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  M.World = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, st) => { cells.set(key(x, y, z), st); return true; }, biomeAt: () => 0, heightAt: () => 0, get: () => null };
  let parts = 0; M.Save = { record: () => { parts++; } };
  if (o.engineDy) { const sp = EL.spawn; EL.spawn = function (t, x, y, z, p) { return sp.call(EL, t, x, y + o.engineDy, z, p); }; }
  if (o.engineGold) { const f = SG.searchIronGolemPattern; SG.searchIronGolemPattern = (nameAt, x, y, z) => f((bx, by, bz) => { const n = nameAt(bx, by, bz); return n === 'gold_block' ? 'iron_block' : n; }, x, y, z); }
  const name = (st) => (st > 0 ? R.names[SR.block[st]] : 'air');
  const snapB = () => { const m = new Map(); for (const [k, v] of cells) if (v) m.set(k, name(v)); return m; };
  const rows = []; let prev = snapB();
  for (let t = 0; t < TICKS; t++) {
    parts = 0;
    if (t === 0) for (const [dx, dy, dz, n] of base(s)) cells.set(key(s.x + dx, s.y + dy, s.z + dz), SR.stateOf(n));
    if (t === s.place) { cells.set(key(s.x, s.y, s.z), SR.stateOf(headName(s))); SG.onBlockAdded(s.x, s.y, s.z); }
    const cur = snapB(), blocks = [];
    for (const [k, v] of cur) if (prev.get(k) !== v) blocks.push(k.split(',').map(Number).concat([prev.get(k) || 'air', v]));
    for (const [k, v] of prev) if (!cur.has(k)) blocks.push(k.split(',').map(Number).concat([v, 'air']));
    blocks.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    rows.push({ tick: t, blocks, particles: parts ? [['block', parts]] : [],
      entities: EL.all().map((e) => [e.type, e.x, e.y, e.z, !!e.playerCreated]) });
    prev = cur;
  }
  return rows;
}

function oracle(s, o = {}) {
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, rows = [], ents = [];
  const get = (x, y, z) => cells.get(key(x, y, z)) || 'air', mid = o.mid || 'iron_block', dy = o.dy || 0;
  const isHead = (n) => n === 'carved_pumpkin' || n === 'jack_o_lantern';
  const snapB = () => new Map(cells); let prev = snapB();
  for (let t = 0; t < TICKS; t++) {
    let parts = 0;
    if (t === 0) for (const [dx, ddy, dz, n] of base(s)) cells.set(key(s.x + dx, s.y + ddy, s.z + dz), n);
    if (t === s.place) {
      cells.set(key(s.x, s.y, s.z), headName(s));
      const { x, y, z } = s;
      if (isHead(get(x, y, z)) && get(x, y - 1, z) === 'snow_block' && get(x, y - 2, z) === 'snow_block') {
        for (let j = 0; j < 3; j++) { cells.delete(key(x, y - j, z)); parts++; }
        ents.push(['snow_golem', x + 0.5, y - 2 + 0.05 + dy, z + 0.5, false]);
      } else if (isHead(get(x, y, z))) {
        for (const [ax, az] of [[1, 0], [0, 1]]) {
          const air = (a, b, c) => get(a, b, c) === 'air';
          const ok = get(x, y - 1, z) === mid && get(x + ax, y - 1, z + az) === 'iron_block' && get(x - ax, y - 1, z - az) === 'iron_block' && get(x, y - 2, z) === 'iron_block' &&
            air(x + ax, y, z + az) && air(x - ax, y, z - az) && air(x + ax, y - 2, z + az) && air(x - ax, y - 2, z - az);
          if (!ok) continue;
          for (let k = -1; k <= 1; k++) for (let j = 0; j < 3; j++) { cells.delete(key(x + k * ax, y - j, z + k * az)); parts++; }
          ents.push(['iron_golem', x + 0.5, y - 2 + 0.05 + dy, z + 0.5, true]);
          break;
        }
      }
    }
    const blocks = [];
    for (const [k, v] of cells) if (prev.get(k) !== v) blocks.push(k.split(',').map(Number).concat([prev.get(k) || 'air', v]));
    for (const [k, v] of prev) if (!cells.has(k)) blocks.push(k.split(',').map(Number).concat([v, 'air']));
    blocks.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    rows.push({ tick: t, blocks, particles: parts ? [['block', parts]] : [], entities: ents.map((e) => e.slice()) });
    prev = snapB();
  }
  return rows;
}

function run(o = {}) {
  let bad = 0, first = '', built = 0, refused = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = scen(seed), a = engine(s, o), b = oracle(s, o);
    const last = a[TICKS - 1].entities; if (last.length) built++; else refused++;
    const d = compareTraces(a, b, { fields: ['blocks', 'entities', 'particles'] });
    if (d) { bad++; if (!first) first = `seed ${seed} (${s.kind}) tick ${d.tick} ${d.field}: ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`.slice(0, 220); }
  }
  return { bad, first, built, refused };
}
let fails = 0, breaks = 0; const notes = [];
const base0 = run();
if (base0.bad) { fails++; console.log(`  FAIL ${base0.bad} divergences; first: ${base0.first}`); }
if (base0.built < SEEDS / 2 || base0.refused < 3) { fails++; console.log(`  FAIL vacuous: built ${base0.built}, refused ${base0.refused}`); }
for (const [name, o] of [['oracle middle block gold', { mid: 'gold_block' }], ['oracle spawn y +0.05', { dy: 0.05 }],
  ['engine middle block gold', { engineGold: 1 }], ['engine spawn y +0.05', { engineDy: 0.05 }]]) {
  const d = run(o);
  if (d.bad) { breaks++; notes.push(`   ✓ ${name} caught: ${d.first}`); } else { fails++; console.log(`  FAIL ${name} not caught`); }
}
console.log(`${2 + 4 - fails} assertions, ${fails} failures, ${breaks} breaks caught (${SEEDS} seeds, ${base0.bad} divergences)`);
notes.forEach((n) => console.log(n));
process.exit(fails ? 1 : 0);
