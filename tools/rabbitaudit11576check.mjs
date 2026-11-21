#!/usr/bin/env node
// rabbitaudit11576check.mjs — #11576: 07zh_rabbit.js's CarrotsBlock (mature gate + age decrement/break via EatCarrotCropGoal)
// and RabbitEntityRenderer (Rb.skinKey, called from 07j_entityrender.js's mob draw). Each source break must fail its row.
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rdj = (f) => JSON.parse(readFileSync(MCLITE_ROOT + 'assets/' + f, 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js',
  '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zh_rabbit.js', '07zzp_mobvoice.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const W = M.World, S = M.States, Bh = M.Behave, Rb = M.Rabbit, o = {};
  M.Items.init({ items: Buffer.from(readFileSync(MCLITE_ROOT + 'assets/items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Entities.init(); W.init(1); Bh.init(W); M.EntityList.init(); M.Ai.init();
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  W.rawBrightness = () => 15;
  for (let x = -2; x <= 5; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, 63, z, S.stateOf('stone') | 0);
  const age = (a) => Bh.setProp(S.stateOf('carrots') | 0, 'age', a);
  const plant = (x, a) => { W.setBlock(x, 63, 0, S.stateOf('farmland') | 0); W.setBlock(x, 64, 0, age(a)); };
  const getAge = (x) => { const st = W.getBlock(x, 64, 0); return st === 0 ? -1 : +M.Reg.valueNames[S.propValue(st, M.Reg.PROP.age)]; };
  M.Sound = { blockBreak() {} };
  const mk = () => new Rb.EatCarrotCropGoal({ x: 3.5, y: 64, z: 0.5, type: 'rabbit' }, { mobGriefing: () => true });
  // CarrotsBlock: only MATURE (age 7) is a target
  plant(3, 7); o.matureTarget = mk().canUse() === true;
  const hold = mk(); plant(3, 7); hold.canUse();
  plant(3, 6); o.immatureRefused = mk().canUse() === false;
  // eat: 7 -> 6, 3 -> 2, 0 -> broken
  plant(3, 7); const g = mk(); g.canUse(); g.eatCarrot(); o.eat7 = getAge(3) === 6;
  plant(3, 3); g.eatCarrot(); o.eat3 = getAge(3) === 2;
  plant(3, 0); g.eatCarrot(); o.eat0 = getAge(3) === -1;
  // RabbitEntityRenderer.getTexture
  const sk = (e) => Rb.skinKey(e);
  o.skinTypes = [0, 1, 2, 3, 4, 5].every((t) => sk({ type: 'rabbit', rabbitType: t }) === (t ? 'rabbit#' + t : 'rabbit'));
  o.skinKiller = sk({ type: 'rabbit', rabbitType: 99 }) === 'rabbit#7';
  o.skinToast = sk({ type: 'rabbit', rabbitType: 2, customName: 'Toast' }) === 'rabbit#6' && sk({ type: 'rabbit', rabbitType: 2, customName: { text: 'Toast' } }) === 'rabbit#6';
  o.skinNotRabbit = sk({ type: 'cow' }) === null;
  return o;
}
const LBL = ['matureTarget', 'immatureRefused', 'eat7', 'eat3', 'eat0', 'skinTypes', 'skinKiller', 'skinToast', 'skinNotRabbit'];
const base = trial();
for (const k of LBL) ok(base[k] === true, 'baseline row ' + k);
const V = 'src/07zh_rabbit.js';
const BR = [
  ['immatureRefused', /return ageOf\(st\) >= maxAge;/, 'return true;'],
  ['matureTarget', /return ageOf\(st\) >= maxAge;/, 'return false;'],
  ['eat7', /Bh\.setProp\(st, 'age', age - 1\)/, "Bh.setProp(st, 'age', age)"],
  ['eat0', /if \(age <= 0\) \{/, 'if (false) {'],
  ['skinTypes', /return k \|\| Rb\.SKIN\[0\];/, 'return Rb.SKIN[0];'],
  ['skinKiller', /if \(e\.rabbitType === Rb\.TYPE\.KILLER_BUNNY\) return Rb\.SKIN_KILLER;/, ''],
  ['skinToast', /if \(nameOf\(e\) === 'Toast'\) return Rb\.SKIN_TOAST;/, ''],
  ['skinNotRabbit', /if \(!e \|\| e\.type !== 'rabbit'\) return null;/, ''],
];
const SRC = fs.readFileSync(MCLITE_ROOT + V, 'utf8');
for (const [key, re, rep] of BR) {
  if (!re.test(SRC)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, B;
  try { B = trial((f, src) => { const n = f === '07zh_rabbit.js' ? src.replace(re, rep) : src; if (n !== src) hit = true; return n; }); } catch (e) { B = {}; }
  ok(hit, 'break matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
// entry point: the renderer's mob draw reaches Rb.skinKey
ok(/NS\.Rabbit\.skinKey\(e\)/.test(fs.readFileSync(MCLITE_ROOT + 'src/07j_entityrender.js', 'utf8')), 'renderer must call NS.Rabbit.skinKey'); breaks++;
ok(!/NS\.Rabbit\.skinKey\(e\)/.test(fs.readFileSync(MCLITE_ROOT + 'src/07j_entityrender.js', 'utf8').replace('NS.Rabbit.skinKey(e)', '')), 'renderer-call break');
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
