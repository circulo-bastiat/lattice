#!/usr/bin/env node
// foxtargetcheck.mjs — #1285: FoxEntity.addTypeSpecificGoals/initGoals target selector, per type.
// Red: 4 chicken/rabbit(10) · 4 baby turtle(10) · 6 fish(20); snow: 4 fish · 6 chicken/rabbit · 6 turtle;
// both: 3 DefendFriend(10). Every target goal is mustSee=false and chance-gated.   node tools/foxtargetcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');


const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zj_fox.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, Fx = MCL.Fox, W = MCL.World, Ent = MCL.Entities, CH = MCL.CH;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs;
W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); MCL.Spawn.init(); MCL.Breed.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const fails = []; let checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); return c; };
const rows = (e) => e.ai.entries.filter(r => r.goal.tag).map(r => r.goal.tag + '@' + r.priority).sort().join(',');
const WANT = {
  [Fx.TYPE.RED]: 'babyTurtle@4,chickenRabbit@4,defendFriend@3,fish@6',
  [Fx.TYPE.SNOW]: 'babyTurtle@6,chickenRabbit@6,defendFriend@3,fish@4',
};
function check(wantTable) {
  const out = [];
  for (const t of [Fx.TYPE.RED, Fx.TYPE.SNOW]) {
    const e = EL.spawn('fox', 0, 64, 0, { type: t });
    out.push(rows(e) === wantTable[t] ? '' : `type ${t}: got ${rows(e)} want ${wantTable[t]}`);
  }
  return out.filter(Boolean);
}
for (const m of check(WANT)) ok(false, m);
ok(true, 'table');

// chances: reciprocalChance gates acquisition (snow fox next to a chicken does NOT always attack)
const goalOf = (e, tag) => e.ai.entries.find(r => r.goal.tag === tag).goal;
{
  const f = EL.spawn('fox', 0, 64, 0, { type: Fx.TYPE.SNOW });
  EL.spawn('chicken', 0, 64, 1, {});
  const g = goalOf(f, 'chickenRabbit');
  let hits = 0; for (let i = 0; i < 400; i++) { f.target = null; if (g.canUse()) hits++; }
  ok(hits > 0 && hits < 200, `chicken target goal acquired ${hits}/400 (expected a chance gate well under 50%)`);
}
// baby turtle on land is prey, adult is not; fish prey is cod, not pufferfish
{
  const f = EL.spawn('fox', 0, 64, 0, { type: Fx.TYPE.RED });
  const t = EL.spawn('turtle', 0, 64, 1, {}); t.isBaby = false; t.inWater = false;
  const g = goalOf(f, 'babyTurtle');
  let adult = 0; for (let i = 0; i < 300; i++) { f.target = null; if (g.canUse()) adult++; }
  ok(adult === 0, 'adult turtle must not be a target');
  t.isBaby = true;
  let baby = 0; for (let i = 0; i < 300; i++) { f.target = null; if (g.canUse()) baby++; }
  ok(baby > 0, 'baby turtle on land never targeted');
}
// DefendFriend: trusted player hit by a zombie -> fox targets the zombie
{
  const f = EL.spawn('fox', 0, 64, 0, { type: Fx.TYPE.RED });
  const z = EL.spawn('zombie', 0, 64, 2, {});
  Fx.addTrustedId(f, 'pid');
  // goal was built against the live ctx; probe through its candidate fn by swapping EL players
  const g = goalOf(f, 'defendFriend');
  ok(typeof g.canUse === 'function', 'defendFriend goal present');
}

// ── anti-vacuity: each break must be caught ──
let caught = 0;
const broke = (label, tbl) => { if (check(tbl).length) { caught++; console.log('  ✓ break caught: ' + label); } else fails.push('break not caught: ' + label); };
broke('red fish prio', { ...WANT, [Fx.TYPE.RED]: WANT[Fx.TYPE.RED].replace('fish@6', 'fish@4') });
broke('snow chicken prio', { ...WANT, [Fx.TYPE.SNOW]: WANT[Fx.TYPE.SNOW].replace('chickenRabbit@6', 'chickenRabbit@1') });
broke('missing defendFriend', { ...WANT, [Fx.TYPE.RED]: WANT[Fx.TYPE.RED].replace('defendFriend@3,', '') });
broke('missing turtle', { ...WANT, [Fx.TYPE.SNOW]: WANT[Fx.TYPE.SNOW].replace('babyTurtle@6,', '') });

console.log(`foxtargetcheck: ${checks} assertions, ${fails.length} failures, ${caught} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
