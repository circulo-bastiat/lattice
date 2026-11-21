#!/usr/bin/env node
// silverfishmagiccheck.mjs — #854: SilverfishEntity.damage arms callForHelpGoal.onHurt() for
// DamageSource.MAGIC with no attacker (poison, instant damage); Cb.notifyHurt only sees attackers.
//   node tools/silverfishmagiccheck.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };

const M = loadEngine({
  extra: ['07_world.js', '02f_tags.js', '02g_items.js', '14f_inventory.js', '07d_mining.js', '07e_loot.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07zn_silverfish.js',
          '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Combat.init();
M.Commands = { rules: {}, ruleGet(n) { return this.rules[n]; } };
const EL = M.EntityList, Cb = M.Combat, W = M.World, CH = M.CH;
const INF = M.States.stateOf('infested_stone');

function scenario(src, attacker) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const bw = { get: (x, y, z) => W.getBlock(x, y, z), set: (x, y, z, st) => W.setBlock(x, y, z, st), getLight: () => 15 << 4 };
  bw.getBlock = bw.get; bw.setBlock = bw.set;
  M.Behave.init(bw);
  EL.clear();
  const e = EL.spawn('silverfish', 0.5, 64, 0.5);
  W.setBlock(1, 64, 0, INF);
  const hit = Cb.hurt(e, 1, undefined, false, src);
  return { e, hit, run() {
    const g = e.silverfishCallForHelp;
    for (let i = 0; i < 20; i++) if (g.canUse()) g.tick();
    return W.getBlock(1, 64, 0) !== INF;
  } };
}

const a = scenario({ bypassArmor: true, source: 'magic' });
ok(a.hit === true, 'magic damage lands');
ok(a.e.silverfishCallForHelp && a.e.silverfishCallForHelp.canUse(), 'attacker-less magic arms call-for-help');
ok(a.run(), 'after 20 ticks the adjacent infested block is broken');

const b = scenario({ bypassArmor: true, source: 'onFire' });
okAv(!b.e.silverfishCallForHelp.canUse() && !b.run(), 'non-magic attacker-less damage (fire) does not arm it');

{ // #4148: a player hit swallowed by the invulnerability window still arms the call
  const d = scenario({ source: 'player' }, null);
  for (let i = 0; i < 40; i++) if (d.e.silverfishCallForHelp.canUse()) d.e.silverfishCallForHelp.tick();
  ok(!d.e.silverfishCallForHelp.canUse(), 'goal expired');
  d.e.invulnerableTime = 20; d.e.lastHurt = 100;
  Cb.hurt(d.e, 1, undefined, false, { attacker: { x: 0, y: 64, z: 0 } });
  ok(d.e.silverfishCallForHelp.canUse(), 'player hit swallowed by the invulnerability window re-arms call-for-help');
  for (let i = 0; i < 40; i++) if (d.e.silverfishCallForHelp.canUse()) d.e.silverfishCallForHelp.tick();
  Cb.hurt(d.e, 1, undefined, false, { source: 'onFire', bypassArmor: true });
  okAv(!d.e.silverfishCallForHelp.canUse(), 'a swallowed attacker-less fire hit does not arm it');
}
const keep = Cb.hurt;
const c = (() => { W.init(1); return null; })();
{ // break the fix: strip the source tag so the gate cannot see magic
  const s = scenario({ bypassArmor: true });
  okAv(!s.e.silverfishCallForHelp.canUse(), 'a magic hit that loses its source tag is not armed');
}
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
for (const f of fails) console.log('  ✗ ' + f);
console.log('================ silverfishmagiccheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
