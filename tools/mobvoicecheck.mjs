#!/usr/bin/env node
// mobvoicecheck.mjs — #742: every mob's voice (ambient/hurt/death/step, horse angry/eat/gallop) is table-driven and plays.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07r_mount.js', '07zl_panda.js', '07zzp_mobvoice.js'], dom: false });
const TSV = fileURLToPath(new URL('./golden/mob-sounds-1.18.2.tsv', import.meta.url));
const table = {};
for (const l of readFileSync(TSV, 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); table[c[0]] = c.slice(2); }
MCL.DATA = Object.assign({}, MCL.DATA, { mobSounds: table });
const MV = MCL.MobVoice;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const played = [];
MCL.Sound = MCL.Sound || {};
MCL.Sound.play = (id, o) => { played.push([id, o]); return true; };
MCL.Sound.blockVP = () => [1, 1];
let woodFloor = false;
MCL.Sound.blockEvent = () => (woodFloor ? 'block.wood.step' : 'block.stone.step');
MCL.Sound.blockStep = (st, x, y, z, l, src) => { played.push(['block.step', { source: src }]); return true; };
MCL.Physics = MCL.Physics || {}; MCL.Physics.blockAt = () => 1;

const types = Object.keys(table).filter((t) => !MV.SKIP[t] && (table[t][1] || table[t][2] || table[t][0]));
// every state that can change a pick
const STATES = [];
for (const inWater of [false, true]) for (const baby of [false, true]) for (const sc of [false, true]) for (const size of [1, 2])
  for (const ang of [0, 100]) for (const tamed of [false, true]) for (const target of [null, {}]) for (const sleeping of [false, true])
    for (const inLove of [0, 10]) for (const customer of [null, {}])
      STATES.push({ inWater, isBaby: baby, screaming: sc, size, angerTime: ang, tamed, target, sleeping, inLove, customer, onGround: true, health: 5 });
const GENES = [0, 1, 2, 3, 4, 5, 6].map((g) => ({ mainGene: g, hiddenGene: g, onGround: true }));
function reached(t, role) {
  const got = new Set();
  const saved = Math.random;
  for (const seed of [0, 0.1, 0.3, 0.5, 0.9]) {
    Math.random = () => seed;
    for (const s of (t === 'panda' ? GENES : STATES)) { const ev = MV.pick(Object.assign({ type: t }, s), role); if (ev) got.add(ev); }
  }
  Math.random = saved;
  return got;
}
function coverage() {
  const bad = [];
  for (const t of types) for (const [role, col] of [['ambient', 0], ['hurt', 1], ['death', 2]]) {
    const want = table[t][col] ? table[t][col].split(',') : [];
    const got = reached(t, role);
    for (const w of want) if (!got.has(w) && !(t === 'fox' && w === 'entity.fox.screech')) bad.push(t + ' ' + role + ' ' + w);
    for (const g of got) if (!want.includes(g) && !(t === 'parrot' && g.startsWith('entity.parrot.imitate.'))) bad.push(t + ' ' + role + ' stray ' + g);
  }
  return bad;
}
const bad = coverage();
ok(bad.length === 0, 'every table event reachable, none invented: ' + bad.slice(0, 8).join('; '));
ok(types.length > 60, types.length + ' voiced types');

// hurt / death playback + ambient timer + step, on a zombie_horse (HorseBase family) and a zombie
function scenario() {
  played.length = 0;
  const z = { type: 'zombie', x: 0, y: 0, z: 0, health: 10, onGround: true };
  MV.onDamage(z, false); MV.onDamage(z, true);
  const zh = { type: 'zombie_horse', x: 0, y: 0, z: 0, health: 10, onGround: true };
  for (let i = 0; i < 6000; i++) MV.tickAmbient(zh);
  const ambient = played.filter((p) => p[0] === 'entity.zombie_horse.ambient').length;
  const first = played.slice(0, 2).map((p) => p[0]);
  const srcs = played.slice(0, 2).map((p) => p[1].source);
  played.length = 0;
  const h = { type: 'horse', x: 0, y: 0, z: 0, health: 10, onGround: true, rider: {} };
  h.soundTicks = 0;
  for (let i = 0; i < 120; i++) { h.x += 0.5; MV.tickStep(h); }
  const gallop = played.filter((p) => p[0] === 'entity.horse.gallop').length;
  played.length = 0;
  for (const t of ['donkey', 'mule']) { const d = { type: t, x: 0, y: 0, z: 0, health: 10, onGround: true, rider: {} }; for (let i = 0; i < 40; i++) { d.x += 0.5; MV.tickStep(d); } }
  const donkeyGallop = played.filter((p) => p[0] === 'entity.horse.gallop').length;
  played.length = 0;
  woodFloor = true;
  const hw = { type: 'horse', x: 0, y: 0, z: 0, health: 10, onGround: true };
  for (let i = 0; i < 40; i++) { hw.x += 0.5; MV.tickStep(hw); }
  const woodSteps = played.filter((p) => p[0] === 'entity.horse.step_wood').length, plainOnWood = played.filter((p) => p[0] === 'entity.horse.step').length;
  woodFloor = false;
  played.length = 0;
  const pg = { type: 'pig', x: 0, y: 0, z: 0, health: 10, onGround: true };
  for (let i = 0; i < 40; i++) { pg.x += 0.5; MV.tickStep(pg); }
  const pigStep = played.filter((p) => p[0] === 'entity.pig.step' && p[1].volume === 0.15).length;
  played.length = 0;
  MV.playAngry({ type: 'horse', x: 0, y: 0, z: 0 }); MV.playEat({ type: 'donkey', x: 0, y: 0, z: 0 });
  const ang = played.map((p) => p[0]).join();
  return first[0] === 'entity.zombie.hurt' && first[1] === 'entity.zombie.death' && srcs.every((s) => s === 'hostile') &&
    ambient > 5 && gallop > 3 && donkeyGallop === 0 && woodSteps > 3 && plainOnWood === 0 && pigStep > 3 && ang === 'entity.horse.angry,entity.donkey.eat';
}
ok(scenario(), 'hurt/death (hostile), ambient timer, horse gallop, pig step 0.15, horse angry, donkey eat');

// #1182: silverfish plays hurt/death (hostile) and its ambient timer fires
function silverfish() {
  played.length = 0;
  const sf = { type: 'silverfish', x: 0, y: 0, z: 0, health: 4, onGround: true };
  MV.onDamage(sf, false); MV.onDamage(sf, true);
  const ids = played.map((p) => p[0]).join();
  played.length = 0;
  const s2 = { type: 'silverfish', x: 0, y: 0, z: 0, health: 4, onGround: true };
  for (let i = 0; i < 6000; i++) MV.tickAmbient(s2);
  return ids === 'entity.silverfish.hurt,entity.silverfish.death' && played.filter((p) => p[0] === 'entity.silverfish.ambient').length > 5;
}
ok(silverfish(), 'silverfish hurt/death/ambient play');

// #3504: bee / fish playStepSound is empty -> no step sound on the ground; a cow still steps
function walk(t) {
  played.length = 0;
  const m = { type: t, x: 0, y: 0, z: 0, health: 4, onGround: true };
  MV.tickStep(m); m.x = 1.9; MV.tickStep(m);
  return played.length;
}
ok(walk('bee') === 0 && walk('cod') === 0 && walk('cow') > 0, 'bee/fish silent on the ground, cow steps');

// #1038: piglin / piglin_brute grunt ambient only while idle (no target, not angry)
function piglinGate() {
  return MV.pick({ type: 'piglin_brute' }, 'ambient') === 'entity.piglin_brute.ambient' &&
    ['piglin', 'piglin_brute'].every((t) => MV.pick({ type: t, target: {} }, 'ambient') === null && MV.pick({ type: t, angryAtEnt: {} }, 'ambient') === null);
}
ok(piglinGate(), 'piglin/piglin_brute ambient silent with a target or angryAt, plays when idle');

// #1289: fox voice -- aggro screech only while aggressive (5%/tick), hurt, death, eat
function foxVoice() {
  played.length = 0;
  const f = { type: 'fox', x: 0, y: 0, z: 0, health: 10, onGround: true };
  MV.onDamage(f, false); MV.onDamage(f, true); MV.playEat(f);
  const ids = played.map((p) => p[0]).join();
  played.length = 0;
  for (let i = 0; i < 2000; i++) MV.tickFox(f);
  const calm = played.length;
  f.aggressive = true;
  for (let i = 0; i < 2000; i++) MV.tickFox(f);
  const aggro = played.filter((p) => p[0] === 'entity.fox.aggro').length;
  return ids === 'entity.fox.hurt,entity.fox.death,entity.fox.eat' && calm === 0 && aggro > 50 && aggro < 160;
}
ok(foxVoice(), 'fox hurt/death/eat play; aggro screech ~5%/tick only while aggressive');

// #1321: fox night screech -- ~10% at night with no player within 16, never by day, never with a player near, sleep wins
function foxScreech() {
  const f = { type: 'fox', x: 0, y: 0, z: 0, health: 10, onGround: true };
  const count = (night, near, sleeping) => {
    MCL.Sky = { isDay: () => !night }; MCL.EntityList = { pushPlayer: () => (near ? { x: 5, y: 0, z: 5 } : { x: 40, y: 0, z: 0 }) };
    f.sleeping = sleeping; let n = 0;
    for (let i = 0; i < 4000; i++) if (MV.pick(f, 'ambient') === 'entity.fox.screech') n++;
    return n;
  };
  const a = count(true, false, false), b = count(true, true, false), c = count(false, false, false), d = count(true, false, true);
  return a > 300 && a < 500 && b === 0 && c === 0 && d === 0;
}
ok(foxScreech(), 'fox night screech ~10% with no player within 16, never by day / with a player / asleep');

// #2652: skeleton_horse in water -- step_water (riderless, grounded, vol 0.3), gallop_water pattern when ridden, swim at min(0.1, v*25) afloat
function skeletonSwim() {
  const run = (o, n, dx) => { played.length = 0; const h = Object.assign({ type: 'skeleton_horse', x: 0, y: 0, z: 0, health: 10, inWater: true }, o); for (let i = 0; i < n; i++) { h.x += dx; MV.tickStep(h); } return played.filter((p) => p[0].startsWith('entity.skeleton_horse.')); };
  const a = run({ onGround: true }, 6, 0.5), b = run({ onGround: false, vx: 0.1 }, 6, 0.5), c = run({ onGround: true, rider: {} }, 60, 0.5);
  return a.length > 0 && a.every((p) => p[0] === 'entity.skeleton_horse.step_water' && p[1].volume === 0.3)
    && b.length > 0 && b.every((p) => p[0] === 'entity.skeleton_horse.swim' && p[1].volume <= 0.1)
    && c.some((p) => p[0] === 'entity.skeleton_horse.gallop_water') && c.some((p) => p[0] === 'entity.skeleton_horse.step_water');
}
ok(skeletonSwim(), 'skeleton_horse swim/step water sounds: step_water 0.3 / swim <=0.1 / gallop_water when ridden');

// #4229: skeleton_horse startJumping in water -> jump_water, dry / other horses -> horse.jump
function skeletonJump() {
  const j = (o) => { played.length = 0; MCL.Mount.startJumping(Object.assign({ x: 0, y: 0, z: 0 }, o)); return played.map((p) => p[0]); };
  return j({ type: 'skeleton_horse', inWater: true })[0] === 'entity.skeleton_horse.jump_water'
    && j({ type: 'skeleton_horse', inWater: false })[0] === 'entity.horse.jump' && j({ type: 'horse', inWater: true })[0] === 'entity.horse.jump';
}
ok(skeletonJump(), 'skeleton_horse jump in water plays jump_water (0.4, 1.0)');

// #2394: killer bunny (rabbitType 99) is HOSTILE, other rabbits NEUTRAL (RabbitEntity.getSoundCategory)
function rabbitSource() { return MV.source({ type: 'rabbit', rabbitType: 99 }) === 'hostile' && MV.source({ type: 'rabbit', rabbitType: 1 }) === 'neutral'; }
ok(rabbitSource(), 'rabbit type 99 sounds are hostile, others neutral');

// #3574: horse-family hurt rears ~1/3, ambient ~1/10 (not while immobile); llamas never via pick
function horseAnger() {
  let h = 0, a = 0, im = 0, ll = 0;
  for (let i = 0; i < 600; i++) {
    const e = { type: 'zombie_horse' }; MV.pick(e, 'hurt'); if (e.angry) h++;
    const f = { type: 'zombie_horse' }; MV.pick(f, 'ambient'); if (f.angry) a++;
    const g = { type: 'horse', eatingGrass: true }; MV.pick(g, 'ambient'); if (g.angry) im++;
    const l = { type: 'llama' }; MV.pick(l, 'hurt'); if (l.angry) ll++;
  }
  return h > 130 && h < 270 && a > 25 && a < 100 && im === 0 && ll === 0;
}
ok(horseAnger(), 'horse-family hurt/ambient voice calls updateAnger (1/3, 1/10, not immobile)');

// anti-vacuity: break the data / the picker and the verdicts must fail
const keep = JSON.parse(JSON.stringify(table));
const restore = () => { for (const k of Object.keys(table)) table[k] = keep[k].slice(); };
table.zombie[1] = ''; if (!scenario()) breaks++; else console.log('break1 missed'); restore();
table.zombie_horse[0] = 'entity.zombie_horse.wrong'; if (!scenario()) breaks++; else console.log('break2 missed'); restore();
const pick = MV.pick; MV.pick = (e, r) => (r === 'death' ? null : pick(e, r)); if (!scenario()) breaks++; else console.log('break3 missed'); MV.pick = pick;
table.horse[10] = ''; if (!scenario()) breaks++; else console.log('break4 missed'); restore();
table.wolf[0] = table.wolf[0] + ',entity.wolf.ghost'; if (coverage().length) breaks++; else console.log('break5 missed'); restore();
const pick2 = MV.pick; MV.pick = (e, r) => (e.type === 'piglin_brute' && r === 'ambient' ? 'entity.piglin_brute.ambient' : pick2(e, r)); if (!piglinGate()) breaks++; else console.log('break6 missed');
table.silverfish[0] = ''; if (!silverfish()) breaks++; else console.log('break7 missed'); restore();
table.fox[9] = ''; if (!foxVoice()) breaks++; else console.log('break8 missed'); restore();
const tf = MV.tickFox; MV.tickFox = () => false; if (!foxVoice()) breaks++; else console.log('break9 missed'); MV.tickFox = tf;
const pw = MV.playerWithin16; MV.playerWithin16 = () => false; if (!foxScreech()) breaks++; else console.log('break10 missed'); MV.playerWithin16 = pw;
const pk = MV.pick; MV.pick = (e, r) => (e.type === 'fox' ? 'entity.fox.ambient' : pk(e, r)); if (!foxScreech()) breaks++; else console.log('break11 missed'); MV.pick = pk;
const sw = MV.skeletonHorseSwim; MV.skeletonHorseSwim = (e) => MV.emit(e, 'entity.generic.swim', 1, 1); if (!skeletonSwim()) breaks++; else console.log('break13 missed'); MV.skeletonHorseSwim = sw;
const src0 = MV.source; MV.source = (e) => (e.type === 'rabbit' ? 'neutral' : src0(e)); if (!rabbitSource()) breaks++; else console.log('break12 missed'); MV.source = src0;
const ns = MV.NO_STEP; MV.NO_STEP = {}; if (walk('bee') !== 0) breaks++; else console.log('break14 missed'); MV.NO_STEP = ns;
const ua = MCL.Mount.updateAnger; MCL.Mount.updateAnger = () => {}; if (!horseAnger()) breaks++; else console.log('break15 missed'); MCL.Mount.updateAnger = ua;
const sj = MCL.Mount.startJumping; MCL.Mount.startJumping = (e) => { e.jumping = true; MV.emit(e, 'entity.horse.jump', 0.4, 1.0); }; if (!skeletonJump()) breaks++; else console.log('break16 missed'); MCL.Mount.startJumping = sj;

// #4304: a snow layer above the landing block replaces its sound group (HorseBaseEntity.playStepSound) -> step, not step_wood
{
  const sBlock = MCL.States && MCL.States.block, names = MCL.Reg && MCL.Reg.names, bAt = MCL.Physics.blockAt, bVP = MCL.Sound.blockVP, bEv = MCL.Sound.blockEvent;
  const run = (snow, nm) => {
    MCL.States = MCL.States || {}; MCL.Reg = MCL.Reg || {};
    MCL.States.block = { 5: 0, 7: 1 }; MCL.Reg.names = nm || ['snow', 'oak_planks'];
    MCL.Physics.blockAt = (x, y) => (y > 0.5 ? (snow ? 7 - 2 : 0) : 7);   // above y+0.8 -> snow(5) or air; landing -> planks(7)
    MCL.Sound.blockVP = (st) => (st === 5 ? [0.5, 2] : [1, 1]);
    MCL.Sound.blockEvent = (st) => (st === 5 ? 'block.snow.step' : 'block.wood.step');
    played.length = 0;
    const h = { type: 'horse', x: 0, y: 0, z: 0, health: 10, onGround: true };
    for (let i = 0; i < 20; i++) { h.x += 0.5; MV.tickStep(h); }
    return played.filter((p) => p[0].startsWith('entity.horse.step'));
  };
  const a = run(true), b = run(false), c = run(true, ['stone', 'oak_planks']);   // c: snow not recognised = the bug
  MCL.Physics.blockAt = bAt; MCL.Sound.blockVP = bVP; MCL.Sound.blockEvent = bEv; MCL.States.block = sBlock; MCL.Reg.names = names;
  ok(a.length > 0 && a.every((p) => p[0] === 'entity.horse.step' && Math.abs(p[1].volume - 0.075) < 1e-6 && p[1].pitch === 2)
    && b.length > 0 && b.every((p) => p[0] === 'entity.horse.step_wood'), 'horse on snow-over-planks: step at snow volume/pitch; bare planks: step_wood');
  if (c.some((p) => p[0] === 'entity.horse.step_wood')) breaks++; else console.log('break17 missed');
}
ok(breaks === 17, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
