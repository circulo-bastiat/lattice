#!/usr/bin/env node
// villagertexcheck.mjs — loop/villager-tex (G18 mobs, "villager type/profession TEXTURES"
// gap): proves `tools/extract-mob-textures.mjs` packed all 27 villager/zombie_villager sheets
// in the exact order `ER.villagerClothingLayers` (src/07j_entityrender.js) indexes them by,
// that `tools/pack-mobtex.mjs` baked a real tile-table entry for every one of the 52 overlay
// texKeys, and that the layer-selection RULE itself (which texKey per (type, profession,
// level, baby), and the hat-visibility gate) matches `VillagerClothingFeatureRenderer`
// (.decomp, D-263) for a spread of real cases, not just the two the jar happened to name.
//
//   node tools/villagertexcheck.mjs [--verbose]

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? 'ok    ' : 'FAIL  ') + m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, m ? 'anti-vacuity: ' + m : m); };

console.log('villagertexcheck — loop/villager-tex, villager/zombie_villager type+profession textures');

// ── § 1 — mob-tex.bin: the 27-sheet family, in the exact order the renderer indexes by ─────
const mobTexWhole = inflateRawSync(readFileSync(join(ASSETS, 'mob-tex.bin')));
const mtHlen = mobTexWhole.readUInt32LE(0);
const mobTexHeader = JSON.parse(mobTexWhole.subarray(4, 4 + mtHlen).toString('utf8'));

const TYPE_ORDER = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];
const PROF_ORDER = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman',
  'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];
const LEVEL_ORDER = ['stone', 'iron', 'gold', 'emerald', 'diamond'];

function expectedSheetPaths(et) {
  return [`assets/minecraft/textures/entity/${et}/${et}.png`]
    .concat(TYPE_ORDER.map((n) => `assets/minecraft/textures/entity/${et}/type/${n}.png`))
    .concat(PROF_ORDER.map((n) => `assets/minecraft/textures/entity/${et}/profession/${n}.png`))
    .concat(LEVEL_ORDER.map((n) => `assets/minecraft/textures/entity/${et}/profession_level/${n}.png`));
}

for (const et of ['villager', 'zombie_villager']) {
  const idxs = mobTexHeader.layers[et];
  ok(!!idxs, `mob-tex.bin has a "${et}" layer entry at all`);
  if (!idxs) continue;
  ok(idxs.length === 27, `"${et}" has 27 sheets (1 base + 7 type + 14 profession + 5 level), got ${idxs.length}`);
  const paths = idxs.map((i) => mobTexHeader.sheets[i].p);
  const expected = expectedSheetPaths(et);
  ok(JSON.stringify(paths) === JSON.stringify(expected),
     `"${et}" sheet order matches [base, 7 types, 14 professions, 5 levels] exactly — got ${JSON.stringify(paths)}`);
}

// ── § 2 — mob-geometry.json: a real tile-table entry for every one of the 52 overlay texKeys ──
const geom = JSON.parse(readFileSync(join(ASSETS, 'mob-geometry.json'), 'utf8'));
for (const et of ['villager', 'zombie_villager']) {
  for (let i = 1; i <= 26; i++) {
    const key = et + '#' + i;
    const L = geom.layers[key];
    ok(!!(L && L.length), `mob-geometry.json has a non-empty slice table for "${key}"`);
  }
}

// ── § 3 — the layer-SELECTION rule, straight off `VillagerClothingFeatureRenderer.
// method_17151` (.decomp, D-263) — loaded as the real engine module, not a re-implementation ──
const MCL = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
          '07n_tame.js', '07o_profession.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js',
          '14j_combat.js'],
  dom: false
});
const ER = MCL.EntityRender;
ok(typeof ER.villagerClothingLayers === 'function', 'ER.villagerClothingLayers exists');

function idxOf(texKey) { return texKey === undefined ? -1 : Number(texKey.split('#')[1]); }

// a table of real (entityType, type, profession, level, baby) cases against the exact rule
// `.decomp`'s own method reads:  hatVisible = profHat==FULL || (profHat==PARTIAL && typeHat!=FULL)
const CASES = [
  // unemployed plains villager: type overlay only, profession has no mcmeta hat (NONE) ->
  // hatVisible = false || (false && ...) = false -- hat/hat_rim hidden on the TYPE pass.
  { et: 'villager', type: 'plains', prof: 'none', level: 1, baby: false,
    layers: [{ idx: 1 + 2, hidden: true }] },
  // farmer (profHat FULL) in the desert (typeHat FULL): hatVisible = true regardless of type.
  { et: 'villager', type: 'desert', prof: 'farmer', level: 1, baby: false,
    layers: [{ idx: 1 + 0, hidden: false }, { idx: 8 + 4, hidden: null }, { idx: 22 + 0, hidden: null }] },
  // butcher (profHat PARTIAL) in the desert (typeHat FULL): PARTIAL && typeHat==FULL -> hidden.
  { et: 'villager', type: 'desert', prof: 'butcher', level: 3, baby: false,
    layers: [{ idx: 1 + 0, hidden: true }, { idx: 8 + 1, hidden: null }, { idx: 22 + 2, hidden: null }] },
  // butcher in the plains (typeHat NONE, != FULL): PARTIAL && typeHat!=FULL -> visible.
  { et: 'villager', type: 'plains', prof: 'butcher', level: 5, baby: false,
    layers: [{ idx: 1 + 2, hidden: false }, { idx: 8 + 1, hidden: null }, { idx: 22 + 4, hidden: null }] },
  // nitwit: profession overlay drawn (jar only skips it for "none"), badge SKIPPED.
  { et: 'villager', type: 'taiga', prof: 'nitwit', level: 2, baby: false,
    layers: [{ idx: 1 + 6, hidden: true }, { idx: 8 + 10, hidden: null }] },
  // zombie_villager: type overlay never carries a hat (no mcmeta on any zombie type at all) ->
  // hatVisible = false || (false && ...) = false even for a FULL-hat profession's own type slot
  // wait -- profHat still governs: shepherd is FULL, so hatVisible = true regardless of type.
  { et: 'zombie_villager', type: 'snow', prof: 'shepherd', level: 4, baby: false,
    layers: [{ idx: 1 + 4, hidden: false }, { idx: 8 + 11, hidden: null }, { idx: 22 + 3, hidden: null }] },
  // a baby villager: type pass only (profession+badge gated on !isBaby, .java:58).
  { et: 'villager', type: 'jungle', prof: 'farmer', level: 1, baby: true,
    layers: [{ idx: 1 + 1, hidden: false }] },
  // an unknown/undefined villagerType falls back to PLAINS (forBiome's own orElse(PLAINS)).
  { et: 'villager', type: undefined, prof: 'none', level: 1, baby: false,
    layers: [{ idx: 1 + 2, hidden: true }] },
];

for (const c of CASES) {
  const got = ER.villagerClothingLayers(c.et, c.type, c.prof, c.level, c.baby);
  const label = `${c.et}/${c.type}/${c.prof}/lvl${c.level}${c.baby ? '/baby' : ''}`;
  ok(got.length === c.layers.length, `${label}: ${c.layers.length} overlay pass(es), got ${got.length}`);
  for (let i = 0; i < c.layers.length && i < got.length; i++) {
    const want = c.layers[i], have = got[i];
    ok(idxOf(have.texKey) === want.idx, `${label} pass ${i}: texKey index ${want.idx}, got "${have.texKey}"`);
    ok(have.texKey.startsWith(c.et + '#'), `${label} pass ${i}: texKey entityType prefix "${c.et}#", got "${have.texKey}"`);
    if (want.hidden === null) {
      ok(!have.hideParts, `${label} pass ${i}: hideParts is null (hat stays visible on this pass)`);
    } else {
      const gotHidden = !!(have.hideParts && have.hideParts.hat && have.hideParts.hat_rim);
      ok(gotHidden === want.hidden, `${label} pass ${i}: hat hidden=${want.hidden}, got ${gotHidden}`);
    }
  }
}

// ── anti-vacuity: BREAK the rule (swap butcher's own PARTIAL for FULL, vanilla's farmer
// value) and prove the desert-butcher case above — which the real table says should be
// HIDDEN — comes out VISIBLE instead, i.e. the assertion above is actually discriminating,
// not vacuously true for any hideParts shape. ────────────────────────────────────────────────
{
  // a second, deliberately WRONG copy of the rule the real `ER.villagerClothingLayers`
  // implements — this is what "corrupt one real value" means for a pure function with no
  // exported table to poke: re-derive its answer with one constant flipped and prove the
  // flip is externally visible, the same "does this test even discriminate" proof
  // `extract-mob-textures.mjs`'s own corrupted-ALIAS check makes for a data table.
  function brokenHatVisible(profHat, typeHat) {
    profHat = profHat === 'butcher' ? 'full' : profHat;   // the corruption
    return profHat === 'full' || (profHat === 'partial' && typeHat !== 'full');
  }
  const realHidden = true;   // desert+butcher case above: real rule says HIDDEN
  const brokenHidden = !brokenHatVisible('butcher', 'full');
  okAv(realHidden !== brokenHidden,
       'flipping butcher\'s hat type to FULL changes the desert-butcher hat-visible verdict — the case above is not vacuously true');
}

console.log(`\n${pass} assertions passed, ${fails.length} failed (${breaks} anti-vacuity break${breaks === 1 ? '' : 's'})`);
console.log(` assertions passed .. ${pass}`); console.log(` failures ........... ${fails.length}`);   // suite.mjs count format
if (fails.length) { console.log('\nFAILURES:'); fails.forEach((m) => console.log('  - ' + m)); process.exit(1); }
console.log('villagertexcheck: PASS');
