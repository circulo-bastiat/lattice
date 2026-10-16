import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const EXTRA = ['02f_tags.js','02g_items.js','07_world.js','07b_behaviour.js','07c_blockentity.js','07d_mining.js','07e_loot.js','07h_entities.js','07y_equip.js','14b_physics.js','14c_raycast.js','07i_entitylist.js','07l_spawn.js','14d_survival.js','14f_inventory.js','14j_combat.js','14l_use.js','07za_explosion.js','07m_breed.js','07q_effects.js','07zu_poi.js','07o_profession.js','07k_goals.js','07zv_villagerbrain.js','07zv2_vbplay.js','07zv3_vbpanic.js','07zv4_vbidle.js','07zv5_vbbreed.js','07zv6_vbgather.js','07zv7_vbbell.js','07zv7_vbgifts.js','07zv8_vbhidehome.js','07zv8_vbhold.js','07zv9_vbdoors.js','07zm_axolotl.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const W=M.World, CH=M.CH, EL=M.EntityList, SR=M.States;
W.init(1); M.Behave.init(W); if (M.BlockEntities&&M.BlockEntities.init) M.BlockEntities.init(); EL.init(); M.Ai.init(); M.Profession.init();
for (let cx=-3;cx<=3;cx++) for(let cz=-3;cz<=3;cz++){const c=W.makeChunk(cx,cz);c.state=CH.GENERATED;W.chunks.set(W.key(cx,cz),c);}
const STONE=SR.stateOf('stone');
for (let x=-24;x<=24;x++) for(let z=-24;z<=24;z++) for(let y=56;y<=63;y++) W.setBlock(x,y,z,STONE);

// #7651 perf budget: villagers and a land-stranded axolotl. Operation counts (machine independent) + a generous CPU budget.
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const Ax = M.Axolotl, VBm = M.VB;
function measure(type, n, ticks) {
  EL.clear(); for (let i = 0; i < n; i++) EL.spawn(type, (i % 5) * 2 - 4, 64, Math.floor(i / 5) * 2);
  for (let i = 0; i < 50; i++) EL.tick();
  let calls = 0, nodes = 0; const g = Ax.amphibiousPath, nt = Ax.nodeType;
  Ax.amphibiousPath = function () { calls++; return g.apply(this, arguments); };
  Ax.nodeType = function () { nodes++; return nt.apply(this, arguments); };
  const t = process.hrtime.bigint(); for (let i = 0; i < ticks; i++) EL.tick();
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / ticks;
  Ax.amphibiousPath = g; Ax.nodeType = nt;
  return { ms, callsPerTick: calls / ticks, nodesPerTick: nodes / ticks };
}
const BUDGET = { axolotlMs: 5, axolotlCalls: 0.2, axolotlNodes: 1200, villagerMs: 1.5 };
function verdict(label, r, b) {
  ok(r.ms < b.ms, label + ' ms/tick ' + r.ms.toFixed(3) + ' over ' + b.ms);
  if (b.calls !== undefined) { ok(r.callsPerTick <= b.calls, label + ' A* calls/tick ' + r.callsPerTick + ' over ' + b.calls); ok(r.nodesPerTick <= b.nodes, label + ' nodeType/tick ' + r.nodesPerTick + ' over ' + b.nodes); }
}
const ax = measure('axolotl', 1, 1000);
verdict('axolotl on land', ax, { ms: BUDGET.axolotlMs, calls: BUDGET.axolotlCalls, nodes: BUDGET.axolotlNodes });
for (const n of [1, 5, 20]) verdict('villagers x' + n, measure('villager', n, 1000), { ms: BUDGET.villagerMs * n });
// anti-vacuity: re-plan every tick (the bug) must blow the budget
{ breaks++; const st = {}; const e = EL.spawn('axolotl', 0, 64, 0); let c = 0; const g = Ax.amphibiousPath;
  Ax.amphibiousPath = function () { c++; return g.apply(this, arguments); };
  for (let i = 0; i < 40; i++) { st.repath = 0; Ax.navStep(e, st, 20, 64, 20, 0.15); }
  Ax.amphibiousPath = g; ok(c / 40 > BUDGET.axolotlCalls, 'anti-vacuity: forced per-tick replans not seen as over budget'); }
{ breaks++; const r = { ms: 99, callsPerTick: 1, nodesPerTick: 9e9 }; const before = fails.length; verdict('fake', r, { ms: 5, calls: 0.2, nodes: 1200 }); ok(fails.length - before === 3, 'anti-vacuity: verdict missed a blown budget'); fails.length = before; }
if (fails.length) { console.log('FAIL axolotlperfcheck\n' + fails.join('\n')); process.exit(1); }
console.log('axolotlperfcheck: axolotl ' + ax.ms.toFixed(3) + ' ms/tick');
console.log(pass + ' checks passed, 0 failures');
for (let i = 0; i < breaks; i++) console.log('   ✓ anti-vacuity break ' + (i + 1) + ' caught');
console.log(breaks + ' breaks caught');
