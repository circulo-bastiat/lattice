#!/usr/bin/env node
// lockstep-snowtrail -- #8642 (G18b-L33): snow golem walking on a grass field, 600 ticks, 20 salts, in snowy_plains, desert (1 fire damage/tick, Biome.isHot
// = temperature > 1.0) and rain (hurtByWater 1 DROWN/tick), with a zombie 10 blocks away (ProjectileAttackGoal(1.25, 20, 20.0) shots).
// Per tick: health, snow layers placed (SnowGolemEntity.tickMovement: air cell + SnowBlock.canPlaceAt, gated on mobGriefing), snowballs shot.
import { readFileSync } from 'node:fs';
import { harness, buildLane } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';

const { M, w, cells } = harness();
if (!M.Biomes.ready) M.Biomes.init();
M.DATA = Object.assign({}, M.DATA, { monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(new URL('../src/19_data.gen.js', import.meta.url), 'utf8'))[1]) });   // loadEngine's DATA lacks it (SG.isMonster)
const EL = M.EntityList, P = M.Player;
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const stream = (s) => { let a = (s + 1) * 2654435761 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const TICKS = 600, F = ['health', 'snow', 'shots', 'dead'];
const BIOME = { snowy: 'snowy_plains', desert: 'desert', rain: 'plains' };

function run(salt, kind, { grief = true, zombie = true } = {}) {
  const r = stream(salt); EL.random = r; Math.random = r;
  buildLane({ w, cells, M });
  const grass = M.States.stateOf('grass_block');
  for (let x = -3; x <= 25; x++) for (let z = -1; z <= 1; z++) w.set(x, -1, z, grass);
  M.World.biomeAt = () => M.Biomes.index(BIOME[kind]);
  M.Sky = Object.assign(M.Sky || {}, { isEntityRainedOn: () => kind === 'rain' });
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  P.x = 24.5; P.y = 0; P.z = 0.5; P.dead = false;
  const g = EL.spawn('snow_golem', 2.5, 0, 0.5); g.persistent = true; if (kind === 'snowy') g.maxHealth = g.health = 400;
  let z = null;
  if (zombie) { z = EL.spawn('zombie', 12.5, 0, 0.5); z.persistent = true; z.aiDisabled = true; z.maxHealth = z.health = 1000; }
  const seen = new Set(); let shots = 0; const rows = [];
  for (let t = 0; t < TICKS; t++) {
    let snow = 0; for (const [k, s] of cells) if (M.States.block[s] === M.Reg.id.snow) snow++;
    rows.push({ tick: t, health: +g.health.toFixed(4), snow, shots, dead: !!g.dead });
    if (z) { z.x = 12.5; z.z = 0.5; z.vx = z.vz = 0; z.health = 1000; }
    P.health = 20; P.dead = false; P.x = 24.5; P.z = 0.5;
    EL.tick();
    for (const e of EL.list) if (e.type === 'snowball' && !seen.has(e)) { seen.add(e); shots++; }
    if (g.dead || g.removed) { rows.push({ tick: t + 1, health: g.health, snow, shots, dead: true }); break; }
  }
  return { rows, g };
}
const res = {};
for (const kind of ['snowy', 'desert', 'rain']) {
  res[kind] = [];
  for (let s = 0; s < 20; s++) {
    const a = run(s, kind), b = run(s, kind);
    ok(compareTraces(a.rows, b.rows, { fields: F }) === null, `${kind} salt ${s}: repeatable`);
    const last = a.rows[a.rows.length - 1];
    if (kind === 'snowy') {
      ok(!last.dead && last.health === 400, `snowy salt ${s}: no damage (${last.health})`);
      ok(last.snow > 0, `snowy salt ${s}: snow trail laid (${last.snow})`);
      ok(last.shots >= 5, `snowy salt ${s}: golem shot the zombie (${last.shots})`);
      const sh = a.rows.map((r) => r.shots), gaps = []; let lastT = -1;
      sh.forEach((v, i) => { if (i && v > sh[i - 1]) { if (lastT >= 0) gaps.push(i - lastT); lastT = i; } });
      ok(gaps.length > 0 && gaps.every((d) => d >= 20), `snowy salt ${s}: shots at least 20 ticks apart (${gaps.slice(0, 4)})`);
    } else if (kind === 'desert') {
      ok(a.rows[1].health === 3 && a.rows[11].health === 2, `desert salt ${s}: 1 damage per 10-tick invulnerability window (${a.rows[1].health},${a.rows[11].health})`);
      ok(last.dead && a.rows.length <= 45, `desert salt ${s}: dead from burn by row ${a.rows.length}`);
    } else {
      ok(a.rows[1].health === 3 && a.rows[11].health === 2, `rain salt ${s}: 1 damage per 10-tick invulnerability window (${a.rows[1].health},${a.rows[11].health})`);
      ok(last.dead && a.rows.length <= 45, `rain salt ${s}: dead from water by row ${a.rows.length}`);
    }
    res[kind].push(a);
  }
}
const base = res.snowy[0].rows;
const mut = (f, fn) => base.map((r, t) => (t === 300 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(base, mut('health', (v) => v - 1), { fields: F })?.field === 'health', 'health -1');
caught(compareTraces(base, mut('snow', (v) => v + 1), { fields: F })?.field === 'snow', 'snow +1');
caught(compareTraces(base, mut('shots', (v) => v + 1), { fields: F })?.field === 'shots', 'shots +1');
caught(compareTraces(base, base.slice(1), { fields: F }) !== null, 'row shift');
// melt threshold 1.0 -> 0.8: plains-warm 0.8 biome would burn; emulate by raising snowy_plains' temperature past 1.0
const cur = M.Biomes.temperatureAt; M.Biomes.temperatureAt = (...a) => cur(...a) + 1.3;
const hot = run(0, 'snowy'); M.Biomes.temperatureAt = cur;
caught(compareTraces(base, hot.rows, { fields: F }) !== null, 'melt threshold shifted (snowy golem burns)');
console.log(`${3 * 20 + 20 * 5 + 1} assertions, ${bad} failures, ${breaks} breaks caught (3 lanes x 20 salts x ${TICKS} ticks; snowy end snow ${base[TICKS - 1].snow}, shots ${base[TICKS - 1].shots})`);
process.exit(bad ? 1 : 0);
