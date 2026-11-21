#!/usr/bin/env node
// witherhurtchargecheck.mjs — #1754: WitherEntity.damage() chargedSkullCooldowns[i] += 3.
//   node tools/witherhurtchargecheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; if (c) console.log('  ✓ break caught: ' + m); ok(c, 'anti-vacuity: ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('witherhurtchargecheck -- #1754: wither hurt adds 3 to each chargedSkullCooldowns slot');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zzh_blaze.js', '07zzi_ghast.js',
  '07zzm_wither.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat;
const Ex = MCL.Explosion, ES = MCL.Effects, Wi = MCL.Wither;

B.init(W);
Ent.init();
EL.init();
Ai.init();
Cb.init();
Ex.init();

ok(Wi.ready === true, 'Wi.ready is true once loaded');

function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  EL.init();
}
function put(x, y, z, name) { W.setBlock(x, y, z, S.stateOf(name) | 0); }
function spawn(type, x, y, z, opts) { return EL.spawn(type, x, y, z, opts); }


function mk() { freshWorld(); const w = EL.spawn('wither', 1100, 70, 1100, {}); w.health = 300; w.maxHealth = 300; Wi.setInvulTimer(w, 0); return w; }
{
  const w = mk(); w.chargedSkullCooldowns = [4, 9];
  const r = Cb.hurt(w, 1, true);
  ok(r !== false, 'plain hit accepted');
  ok(w.chargedSkullCooldowns[0] === 7 && w.chargedSkullCooldowns[1] === 12, `hit adds 3 per slot (got ${w.chargedSkullCooldowns})`);
  const w2 = mk(); w2.chargedSkullCooldowns = [4, 9];
  Wi.setInvulTimer(w2, 100);
  Cb.hurt(w2, 1, true);
  okAv(w2.chargedSkullCooldowns[0] === 4 && w2.chargedSkullCooldowns[1] === 9, 'invul-rejected hit leaves slots untouched');
  const w3 = mk(); w3.chargedSkullCooldowns = [4, 9];
  Cb.hurt(w3, 1, false, false, { source: 'drown' });
  okAv(w3.chargedSkullCooldowns[0] === 4 && w3.chargedSkullCooldowns[1] === 9, 'drown-rejected hit leaves slots untouched');
  const w4 = mk(); w4.chargedSkullCooldowns = [4, 9];
  Cb.hurt(w4, 1, false, false, { source: 'fall' });
  okAv(w4.chargedSkullCooldowns[0] === 4, 'fall-rejected hit leaves slots untouched');
}
console.log(`\npassed: ${pass}, ${breaks} breaks caught, failed: ${fails.length}`);
if (fails.length) { fails.forEach((m) => console.log('  FAIL: ' + m)); process.exit(1); }
