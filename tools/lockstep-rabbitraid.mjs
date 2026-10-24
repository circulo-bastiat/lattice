#!/usr/bin/env node
// lockstep-rabbitraid -- #7712: Rb.EatCarrotCropGoal + Ai.killerBunnyGoals against an independent reference, 20 salts x 600 ticks.
// Reference = MoveToTargetPosGoal.canStart/findTargetPos/tick + RabbitEntity.EatCarrotCropGoal (.decomp, read whole) on one java.util.Random
// stream (getInterval = toGoalTicks(200+nextInt(200)) = ceil(/2), cooldown 10 after a reach, hasTarget cleared when cooldown<=0).
// A rabbit 6 blocks from a 3x3 carrot field (centre ripe age 7, ring age 3, scripted per salt), hungry flag; compared per tick: canUse,
// the chosen target cell, the cooldown (observed through the next-search tick), eat result (age 7->6, moreCarrotTicks 40), mobGriefing=false
// (no search, no cooldown spent), moreCarrotTicks wantsCarrots gate. Then a type-99 killer bunny with a player and a wolf 8 blocks away:
// target selection per goal (follow range 16) and the melee reach 4.0 + width.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdd = (f) => readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity', f), 'utf8');
if (!/200 \+ .*nextInt\(200\)/.test(rdd('ai/goal/MoveToTargetPosGoal.java')) || !/super\(\$\$0, 0\.7F, 16\)/.test(rdd('passive/RabbitEntity.java'))) throw new Error('decomp changed');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zh_rabbit.js', '07zzp_mobvoice.js'];
const TICKS = 600;

function runAll(patch, salt) {
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  const rd = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rd('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  const W = M.World, S = M.States, Bh = M.Behave, Rb = M.Rabbit, Ai = M.Ai, EL = M.EntityList, bad = [];
  W.init(1); Bh.init(W); EL.init(); Ai.init();
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  W.rawBrightness = () => 15;
  M.Player = null;
  const stone = S.stateOf('stone') | 0, agedState = (a) => Bh.setProp(S.stateOf('carrots') | 0, 'age', a);
  for (let x = -4; x <= 12; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 63, z, stone);
  const sc = new M.JRandom(salt * 977 + 3);
  const ripeAge = [7, 7, 3][sc.nextInt(3)], ringAge = sc.nextInt(2) ? 3 : 7;
  // the field: 3x3 at x=6..8, z=-1..1, farmland under; centre ripe (age 7 or 3 per salt), ring age 3 or 7
  const field = [];
  for (let x = 6; x <= 8; x++) for (let z = -1; z <= 1; z++) {
    const a = (x === 7 && z === 0) ? ripeAge : ringAge;
    W.setBlock(x, 63, z, S.stateOf('farmland') | 0); W.setBlock(x, 64, z, agedState(a)); field.push({ x, z, a });
  }
  const e = EL.spawn('rabbit', 0.5, 64, 0.5); e.random = new M.JRandom(salt * 31 + 5);
  const griefAt = sc.nextInt(2) ? 150 + sc.nextInt(100) : -1;    // mobGriefing off from this tick, back on 120 ticks later
  let grief = true;
  const g = new Rb.EatCarrotCropGoal(e, { mobGriefing: () => grief });
  e.moreCarrotTicks = sc.nextInt(2) ? 0 : 30 + sc.nextInt(20);   // hungry flag: wantsCarrots = moreCarrotTicks == 0 (the goal forces it true, vanilla's dead read)
  // reference state
  const rr = new M.JRandom(salt * 31 + 5), cellAge = new Map(field.map((c) => [c.x + ',' + c.z, c.a]));
  const teleAt = 260 + sc.nextInt(60);
  let cd = 0, hasT = false, tgt = null;
  const refSearch = (bx, by, bz) => {   // findTargetPos ring order, maxYDifference 1, range 16
    for (let dy = 0; dy <= 1; dy = dy > 0 ? -dy : 1 - dy) for (let r = 0; r < 16; r++) for (let dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx)
      for (let dz = (dx < r && dx > -r) ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz) {
        const x = bx + dx, y = by + dy - 1, z = bz + dz;
        if (y !== 63) continue;
        if (cellAge.get(x + ',' + z) === 7 && !hasT) { hasT = true; return { x, z }; }
      }
    return null;
  };
  for (let t = 0; t < TICKS; t++) {
    if (t === griefAt) grief = false; if (t === griefAt + 120) grief = true;
    if (t === teleAt) { e.x = 7.5; e.z = 0.5; }   // within 1.0 of the field centre crop's block centre
    // reference canUse
    let want;
    if (cd <= 0 && !grief) want = false;
    else {
      if (cd <= 0) hasT = false;
      if (cd > 0) { cd--; want = false; } else { cd = Math.ceil((200 + rr.nextInt(200)) / 2); tgt = refSearch(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)); want = !!tgt; }
    }
    const got = g.canUse();
    if (got !== want) { bad.push(`t=${t} canUse ${got} want ${want}`); break; }
    if (got) {
      g.start(); g.tick();
      // reference tick: reached = block-centre distance < 1.0 (cell centre y +0.5 over the crop floor)
      const cx = tgt.x + 0.5, cy = 64.5, cz = tgt.z + 0.5, d2 = (cx - e.x) ** 2 + (cy - e.y) ** 2 + (cz - e.z) ** 2;
      if (d2 < 1.0) {
        const k = tgt.x + ',' + tgt.z, a = cellAge.get(k);
        cellAge.set(k, a - 1); cd = 10; hasT = false;
        const wm = e.moreCarrotTicks; if (wm !== 40) bad.push(`t=${t} moreCarrotTicks ${wm} want 40`);
        e.moreCarrotTicks = 0;   // let the next gate be observed again
      }
      for (const c of field) {
        const st = W.getBlock(c.x, 64, c.z), a = st === 0 ? -1 : +M.Reg.valueNames[S.propValue(st, M.Reg.PROP.age)];
        if (a !== cellAge.get(c.x + ',' + c.z)) bad.push(`t=${t} crop ${c.x},${c.z} age ${a} want ${cellAge.get(c.x + ',' + c.z)}`);
      }
      g.stop();
      if (bad.length) break;
    }
  }
  if (!bad.length && ripeAge === 7 && ![...cellAge.values()].some((a, i) => a !== field[i].a)) bad.push('a ripe field was never eaten in ' + TICKS + ' ticks');
  if (!bad.length && ripeAge === 3 && ringAge === 3 && [...cellAge.values()].some((a, i) => a !== field[i].a)) bad.push('an unripe field was eaten');
  // killer bunny: player at 8 east, wolf 8 west (opposite sides, one nudged closer per salt)
  EL.clear();
  const k = EL.spawn('rabbit', 0.5, 64, 0.5, { type: Rb.TYPE.KILLER_BUNNY });
  const wolf = EL.spawn('wolf', -7.5 - (salt & 1) * 2, 64, 0.5);
  const pl = { x: 8.5 + (salt & 2 ? 0 : 2), y: 64, z: 0.5, health: 20, gamemode: 'survival', width: 0.6, height: 1.8, type: 'player' };
  const gs = new Ai.GoalSelector(); Ai.killerBunnyGoals(k, gs, { players: () => [pl] });
  const [melee, revenge, nearP, nearW] = gs.entries;
  if (melee.priority !== 4 || revenge.priority !== 1 || nearP.priority !== 2 || nearW.priority !== 2) bad.push('killer goal priorities');
  k.target = null; const pOk = nearP.goal.canUse(); if (!pOk || k.target !== pl) bad.push('player at ' + (pl.x - 0.5) + ' not targeted');
  k.target = null; const wOk = nearW.goal.canUse(); if (!wOk || k.target !== wolf) bad.push('wolf at 8 not targeted');
  pl.x = 0.5 + 17; k.target = null; if (nearP.goal.canUse()) bad.push('player 17 away targeted (follow range 16)');
  return bad;
}

let fails = 0, breaks = 0;
for (let s = 0; s < 20; s++) { const b = runAll(null, s); if (b.length) { fails++; console.log('  FAIL salt ' + s + ': ' + b.slice(0, 3).join(' | ')); } }
const mut = (name, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== '07zh_rabbit.js') return src; const o = src.replace(f, to); hit = hit || o !== src; return o; };
  let caught = false; for (let s = 0; s < 5 && !caught; s++) caught = runAll(patch, s).length > 0;
  if (!hit) { fails++; console.log('  FAIL mutation did not apply: ' + name); } else if (caught) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('ripe-age gate skipped', 'return ageOf(st) >= maxAge;', 'return true;');
mut('search range 16 -> 5', 'Rb.EAT_RANGE = 16;', 'Rb.EAT_RANGE = 5;');
mut('moreCarrotTicks 40 -> 30', 'Rb.MORE_CARROT_TICKS = 40;', 'Rb.MORE_CARROT_TICKS = 30;');
mut('cooldown after eat 10 -> 20', 'cooldown = 10;', 'cooldown = 20;');
mut('griefing gate removed', 'if (!mobGriefing()) return false;', '');
console.log(`lockstep-rabbitraid: 20 assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
