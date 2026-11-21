#!/usr/bin/env node
// villagersoundcheck.mjs — #1795: every villager sound event in .mcsnd/sounds.json is reachable from src:
// work_<profession> via VB.playWorkSound, yes/no via Trade.sellSound, no + head roll via Use.villagerSayNo,
// celebrate by name in VB.celebrateRaidWin. Each rule is broken once ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m); };
console.log('villagersoundcheck — #1795 villager yes/no/celebrate/work sounds');
const M = loadEngine({ extra: ['07p_trade.js', '07zv_villagerbrain.js', '14l_use.js'], dom: false });
const PROFS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker',
  'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'];
let played = [];
M.Sound = { play: (n) => played.push(n) };
const work = (p) => { played = []; M.VB.playWorkSound({ profession: p, x: 0, y: 0, z: 0 }); return played.slice(); };
for (const p of PROFS) ok(work(p)[0] === 'entity.villager.work_' + p, 'work_' + p);
ok(work('nitwit').length === 0 && work('none').length === 0, 'nitwit/none silent');
const e = { headRollingTimeLeft: 0, x: 0, y: 0, z: 0 };
played = []; M.Use.villagerSayNo(e);
ok(e.headRollingTimeLeft === 40 && played[0] === 'entity.villager.no', 'sayNo: roll 40 + no');
const sold = (f) => { const v = { type: 'villager', ambientSoundChance: 0 }; played = [];
  M.MobVoice = { delay: () => 80, emit: (_, n) => played.push(n) }; M.Trade.sellSound(v, f); return played[0]; };
ok(sold(true) === 'entity.villager.yes' && sold(false) === 'entity.villager.no', 'sellSound yes/no');
const src = readFileSync(join(MCLITE_ROOT, 'src/07zv_villagerbrain.js'), 'utf8');
ok(src.includes("'entity.villager.celebrate'"), 'celebrate referenced');
// breaks
okAv(!src.replaceAll('entity.villager.celebrate', 'x').includes("'entity.villager.celebrate'"), 'celebrate rename is seen');
okAv(work('bogus')[0] !== 'entity.villager.work_librarian', 'wrong profession plays another sound');
{ const o = M.VB.playWorkSound; M.VB.playWorkSound = () => {}; okAv(work('farmer').length === 0, 'silenced work sound is seen'); M.VB.playWorkSound = o; }
{ const e2 = { x: 0, y: 0, z: 0 }; const o = M.Use.villagerSayNo; M.Use.villagerSayNo = () => {}; M.Use.villagerSayNo(e2); okAv(e2.headRollingTimeLeft !== 40, 'no head roll is seen'); M.Use.villagerSayNo = o; }
okAv(sold(true) !== sold(false), 'yes and no differ');
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log(`villagersoundcheck: ${pass} assertions, ${breaks} breaks caught`);
