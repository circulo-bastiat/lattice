#!/usr/bin/env node
// lockstep-spawnpeaceful -- #8719 (G18c-L14): zombie, skeleton, creeper, slime, phantom, spider and a cow; difficulty HARD -> PEACEFUL at tick 40, and a PEACEFUL start; 20 salts x 1240 ticks. Oracle from .decomp (MobEntity.checkDespawn first branch, isDisallowedInPeaceful: HostileEntity, PhantomEntity, SlimeEntity getSize()>0; cow false): every disallowed mob is removed on the first tick peaceful holds, the cow never. Plus 1200 ticks of dark-cave spawn attempts (Spawn.RULES monster entries, Monster.checkMonsterSpawnRules difficulty != PEACEFUL gate) that must all refuse.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };

const EXTRA = ['14h_brigadier.js', '15g_commands.js', '02f_tags.js', '02g_items.js', '02i_text.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14j_combat.js', '07za_explosion.js', '03b_noise.js', '07zd_slime.js', '07q_effects.js', '14f_inventory.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes, langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const EL = M.EntityList, Spawn = M.Spawn, Sl = M.Slime, W = M.World;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; EL.init(); M.Ai.init(); Spawn.init(); Sl.init();
M.Diff.value = 'normal'; Spawn.CLEAR_CHECK = false;



const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
W.getLight = () => 0; W.loadedAt = () => true; W.tickingAt = () => true;
M.Sky = { dayTime: 0, moonPhase: () => 0, darknessNow: () => 0, isThundering: () => false };
M.Player = { x: 0, y: 64, z: 0 };
let rs = null;
EL.wr = () => rs();
EL.remove = (e) => { e.removed = true; };

const HOSTILE = { zombie: 1, skeleton: 1, creeper: 1, slime: 1, phantom: 1, spider: 1, cow: 0 };
const TYPES = Object.keys(HOSTILE);
const SWITCH = 40;
let PROBE = Spawn.PEACEFUL_DISALLOWED;

function run(salt, startPeaceful) {
  const out = { div: '', gone: 0, refused: 0 };
  rs = stream(salt);
  const init = stream(salt + 77);
  const mobs = TYPES.map((ty) => ({ ty, e: { type: ty, x: Math.floor(init() * 20), y: 64, z: Math.floor(init() * 20), despawnCounter: Math.floor(init() * 100), age: 5000, size: 2 }, goneAt: -1 }));
  M.Diff.value = startPeaceful ? 'peaceful' : 'hard';
  for (let t = 0; t < 1240 && !out.div; t++) {
    if (!startPeaceful && t === SWITCH) M.Diff.value = 'peaceful';
    const peaceful = M.Diff.value === 'peaceful';
    for (const m of mobs) {
      if (!m.e.removed) Spawn.despawnOne(m.e);
      const want = peaceful && HOSTILE[m.ty] === 1;
      if (want && !m.e.removed) { out.div = `salt ${salt} tick ${t} ${m.ty} kept in peaceful`; break; }
      if (m.e.removed && !want) { out.div = `salt ${salt} tick ${t} ${m.ty} removed (peaceful ${peaceful})`; break; }
      if (m.e.removed && m.goneAt < 0) { m.goneAt = t; if (t !== (startPeaceful ? 0 : SWITCH)) out.div = `salt ${salt} ${m.ty} removal tick ${t}`; }
    }
    if (t >= 40 || startPeaceful) {
      for (const ty of ['zombie', 'skeleton', 'creeper', 'spider', 'slime']) {
        const f = Spawn.RULES[ty];
        if (!f) continue;
        out.refused++;
        if (f.call(Spawn.RULES, 5, 20, 5, 'natural', rs)) out.div = out.div || `salt ${salt} tick ${t} ${ty} spawn rule accepted in peaceful`;
      }
    }
  }
  out.gone = mobs.filter((m) => m.e.removed).length;
  out.cow = !mobs.find((m) => m.ty === 'cow').e.removed;
  return out;
}

const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s, s % 2 === 1)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(runs.every((r) => r.gone === 6 && r.cow && r.refused > 1000), 'lane vacuous: ' + JSON.stringify(runs[0]));
ok(JSON.stringify(run(3, true)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
const oPD = Spawn.PEACEFUL_DISALLOWED, oZ = Spawn.RULES.zombie;
tryBreak('slime not disallowed', () => { Spawn.PEACEFUL_DISALLOWED = Object.assign({}, oPD, { slime: 0 }); }, () => { Spawn.PEACEFUL_DISALLOWED = oPD; });
tryBreak('phantom not disallowed', () => { Spawn.PEACEFUL_DISALLOWED = Object.assign({}, oPD, { phantom: 0 }); }, () => { Spawn.PEACEFUL_DISALLOWED = oPD; });
tryBreak('cow disallowed', () => { Spawn.PEACEFUL_DISALLOWED = Object.assign({}, oPD, { cow: 1 }); }, () => { Spawn.PEACEFUL_DISALLOWED = oPD; });
tryBreak('zombie rule ignores peaceful', () => { Spawn.RULES.zombie = () => true; }, () => { Spawn.RULES.zombie = oZ; });
console.log(`${n} assertions, spawnpeaceful: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
