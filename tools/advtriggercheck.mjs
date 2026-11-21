#!/usr/bin/env node
// advtriggercheck.mjs — G26d. Adv.Tracker / Adv.trigger on the real advancement data; breaks its own module.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets/advancements.meta.json'), 'utf8'));
const data = readFileSync(join(ROOT, 'assets/advancements.bin')).toString('base64');
function engine(src) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '01b_inflate']) new Function('MCL', readFileSync(join(ROOT, `src/${f}.js`), 'utf8'))(NS);
  new Function('MCL', src)(NS);
  return NS.Adv.init({ advancements: data, advancementsBytes: meta.rawBytes });
}
let asserted = 0;
function verify(A) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const log = [], xp = [];
  const player = {}; player.advancements = new A.Tracker({ addExperience: (n) => xp.push(n), onGrant: (a) => log.push(a.id) });
  const id = 'minecraft:story/cure_zombie_villager';
  const adv = A.manager.get(id);
  no(adv && adv.criteria.cured_zombie.trigger === 'minecraft:cured_zombie_villager', 'cure advancement/criterion missing');
  no(A.trigger(player, 'minecraft:nothing_listens', {}) === 0 && !log.length, 'unknown trigger granted something');
  no(A.trigger(player, 'minecraft:cured_zombie_villager', {}) >= 1, 'trigger granted nothing');
  no(log.includes(id) && player.advancements.getProgress(adv).isDone(), 'advancement not completed');
  let rich; A.manager.advancements.forEach((a) => { if (!rich && a.rewards.experience > 0) rich = a; });
  player.advancements.grantCriterion(rich, Object.keys(rich.criteria)[0]);
  no(xp.length === 1 && xp[0] === rich.rewards.experience, 'rewards not applied');
  const n = log.length;
  no(A.trigger(player, 'minecraft:cured_zombie_villager', {}) === 0 && log.length === n, 'granted twice');
  const other = { advancements: new A.Tracker({}) };
  no(!other.advancements.getProgress(adv).isDone(), 'progress leaked between players');
  no(player.advancements.revokeCriterion(adv, 'cured_zombie') && !player.advancements.getProgress(adv).isDone(), 'revoke');
  A.matchers['minecraft:cured_zombie_villager'] = () => false;
  no(A.trigger(player, 'minecraft:cured_zombie_villager', {}) === 0, 'matcher veto ignored');
  delete A.matchers['minecraft:cured_zombie_villager'];
  return f;
}

const fails = verify(engine(SRC));
const mut = (a, b) => { if (!SRC.includes(a)) throw new Error('anchor gone: ' + a); return SRC.replace(a, b); };
const mutants = [
  ['no reward on completion', mut('Adv.applyRewards(a.rewards, this.host);', '')],
  ['no done check', mut('if (!was && p.isDone()) {', 'if (false) {')],
  ['trigger id ignored', mut('c.trigger !== triggerId ||', '')],
  ['matcher ignored', mut('m ? m(c.conditions, ctx) : plain(c.conditions)', 'plain(c.conditions)')],
  ['shared progress', mut('this.progress = new Map(); };', 'this.progress = Adv.Tracker.shared || (Adv.Tracker.shared = new Map()); };')],
];
let caught = 0;
for (const [name, src] of mutants) {
  let bad; try { bad = verify(engine(src)); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtriggercheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtriggercheck: OK — ${caught} breaks caught`);
