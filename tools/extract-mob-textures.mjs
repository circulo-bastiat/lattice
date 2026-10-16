#!/usr/bin/env node
// extract-mob-textures.mjs — PASS 15 JOB 4.2 (G18a): the mob sheets, from the 1.13.2 jar (D-5's
// pre-1.14 ruling, same jar build-gui.mjs already uses for the GUI and the player skin).
//
//   node tools/extract-mob-textures.mjs   -> assets/mob-tex.bin, assets/mob-tex.meta.json
//
// ── WHY THIS EXISTS SEPARATELY FROM build-gui.mjs ───────────────────────────────────────────
// build-gui.mjs's SHEETS/ENTITY_TEX lists are hand-typed because they name a FIXED small set of
// UI sheets and the block-entity items. Mob sheets are different: git 2a8efe1:docs/passes/PASS-15-HISTORY.md §4.2 explicitly
// forbids hand-listing them — "derive the list from the layer roster: a layer needs a sheet, and
// a layer with no sheet is a failing check, not a blank mob." So this tool starts from
// `tools/golden/models-1.18.2.tsv` (the layer roster `extract-models.mjs` already built and
// verified) and, for every layer name in it, resolves a texture path.
//
// ── THE ALIAS TABLE IS NOT A GUESS ──────────────────────────────────────────────────────────
// A handful of layer names match `entity/<name>.png` or `entity/<name>/<name>.png` directly (the
// AUTO rules below) — most do not, because vanilla's own texture folders don't match its own
// ModelLayers field names (`elder_guardian` -> `guardian_elder.png`, `leash_knot` -> the file is
// `lead_knot.png`, `magma_cube` -> folder `slime/`, file `magmacube.png` with no underscore, and
// so on). Every alias below was found by listing this session's actual 1.13.2 jar contents
// (`tools/_derive_tex.mjs`, run once to see what auto-resolved and what did not) and reading the
// real path off that listing — never typed from memory of what a Minecraft texture path "should"
// be (D-263: trust no name). `ok()` below re-verifies every one of these paths exists IN THIS
// JAR before the tool will write anything, so a wrong alias fails the run, it does not ship.
//
// ── WHAT IS HONESTLY "OWED" ──────────────────────────────────────────────────────────────────
// Two different reasons a layer has no sheet here, and the report tells them apart:
//   (a) THE MOB DID NOT EXIST YET. `extract-models.mjs` reads the 1.18.2 jar, which has layers
//       for every mob through 1.18.2; the 1.13.2 jar predates axolotls, bees, cats (as their own
//       mob — old tamed ocelots reused a `cat/` skin folder that IS still here, hence `ocelot`
//       resolves and `cat` does not), foxes, glow squids, goats, hoglins, pandas, piglins,
//       pillagers, ravagers, striders, wandering traders and zoglins. No amount of clever path
//       guessing produces a texture for a mob whose jar entry does not exist — D-5 chose the
//       1.13.2 look on purpose, and this is its actual, visible cost.
//   (b) NOT SAFE TO NAME WITHOUT READING THE RENDERER'S BYTECODE. `armor#null` is a worn-armor
//       overlay textured from `textures/models/armor/**`, a different tree this tool does not
//       search. `bell`, `cage#null` and `spin_attack` have no texture whose
//       name obviously corresponds and no anchor to check it against (unlike the 8 G18a target
//       layers, which D-263's referee rules were actually applied to in `extract-models.mjs`) —
//       guessing one and shipping it wrong would be worse than reporting it owed.
// Both kinds are named, not silently dropped — this is the same "owed" idiom
// `pack-blockentity.mjs` already uses for `dragon_head`/`conduit`.
//
// ── FAMILIES: ONE LAYER, SEVERAL SHEETS ─────────────────────────────────────────────────────
// Some layers are drawn from a small closed set of textures chosen at runtime (a dye colour, a
// random variant, which of two body shapes) rather than one fixed sheet — `bed_head`/`bed_foot`
// (16 dye colours, same set `build-gui.mjs`'s DYES loop already ships as `be_*_bed`), `decor#null`
// (llama's 16 dye-coloured carpets), `pattern#null` (banner AND shield pattern overlays share
// this layer — ~34 pattern textures across both folders), `horse`/`llama`/`rabbit`/`parrot` (a
// handful of named colour/breed variants each). These are packed as every member of the family,
// named `<layer>#<n>`, rather than picking one arbitrarily.
//
// ── ANTI-VACUITY ─────────────────────────────────────────────────────────────────────────────
// Delete one path from the alias table (pointing it at a file this jar does not have) and this
// tool must fail, naming that exact layer — proven below by corrupting a copy of the table for
// one entry and asserting the failure names it, then restoring the real table and asserting it
// passes clean.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const jarPath = (v) => {
  const flat = JARS + '/' + v + '.jar';
  const nested = JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : nested;
};
const JAR = opt('jar', jarPath('1.13.2'));
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));

let failures = 0;
const say = (s) => console.log(s);
const ok = (cond, msg) => { if (!cond) { failures++; say('   x ' + msg); } };

const jar = new Jar(JAR);
const ENTITY13 = new Set(jar.names().filter((n) => n.startsWith('assets/minecraft/textures/entity/')
  && n.endsWith('.png')));

// D-458 — a SECOND jar, for the mobs `POST_1_13_2` names as structurally unreachable through the
// 1.13.2 jar alone (cat did not exist as its own model before 1.14). Read-only fallback: a path
// found in the 1.13.2 jar is read from there unchanged (every existing row's provenance is
// untouched); a path found ONLY in 1.18.2 is read from there. `jar18` is optional — if the
// 1.18.2 jar is not present this file behaves exactly as before (D-458 does not regress a
// machine that only has the 1.13.2 jar cached).
let jar18 = null;
try { jar18 = new Jar(jarPath('1.18.2')); } catch { jar18 = null; }
// #1548/#2124: sheet index = material (ER.ARMOUR_MATERIALS order); 7 is the leather overlay (dye-free). Turtle has no layer_2: layer_1.
const ARMOR_MATS = ['iron', 'leather', 'chainmail', 'gold', 'diamond', 'netherite', 'turtle', 'leather'];
const ARMOR_SHEETS = (n) => ARMOR_MATS.map((m, i) => 'assets/minecraft/textures/models/armor/' + m + '_layer_' + (m === 'turtle' ? 1 : n) + (i === 7 ? '_overlay' : '') + '.png');
const ARMOR_PATHS = new Set([...ARMOR_SHEETS(1), ...ARMOR_SHEETS(2)]);
const SHADOW_PNG = 'assets/minecraft/textures/misc/shadow.png';   // #7065: EntityRenderDispatcher.SHADOW_TEXTURE
const ENTITY18 = jar18 ? new Set(jar18.names().filter((n) => (n.startsWith('assets/minecraft/textures/entity/')
  && n.endsWith('.png')) || ARMOR_PATHS.has(n) || n === SHADOW_PNG)) : new Set();
const ENTITY = new Set([...ENTITY13, ...ENTITY18]);
const readEntity = (p) => (ENTITY18.has(p) ? jar18.read(p) : jar.read(p));   // #1509: 1.18.2 pixels wherever 1.18.2 has the sheet (the models/UVs are 1.18.2)

// ── the layer roster — the source of truth this tool must not hand-list around ─────────────
// D-469 — plus a SMALL, NAMED exception: a texture that draws through an EXISTING mob's own
// box list (no geometry of its own, so no row in `models-1.18.2.tsv` at all) never reaches
// this roster on its own, and used to sit dead in `ALIAS` below for exactly that reason —
// `wolf_tame` resolved to a real jar path but `run()` never visited it. Named here, not
// hand-listed around the roster's own rule: `Tm.skinKey` (07n_tame.js, D-458) is the one place
// that already says this alias is reachable from a live entity; `wolf_angry` is NOT added —
// this engine has no anger state to reach it with (`Tm.OWED`), so it would be dead weight.
// QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- `horse_marking`/`horse_armor`: the SAME shape
// as `wolf_tame` above, a texture family with no box list of its own -- `HorseMarkingFeature
// Renderer`/`HorseArmorFeatureRenderer` (.decomp, both read in full) draw a SECOND pass of the
// horse's own body model (getContextModel()), retextured, never a shape of their own.
// `Mnt.horseMarking(e)`/`e.armorItem` (07r_mount.js) are the one place that says either is
// reachable from a live entity -- `07j_entityrender.js`'s own overlay push reads them.
const EXTRA_LAYERS = ['boat', 'stray_outer', 'slime_outer', 'wolf_tame', 'wolf_collar', 'cat_collar', 'horse_marking', 'horse_armor', 'mooshroom_brown',
  // QUEUE 0.2 (G18 mobs) -- bee's own three extra sheets (`BeeEntityRenderer`, .decomp, four
  // literal `Identifier`s total -- `bee` itself already auto-resolves off the jar's own
  // `entity/bee/bee.png`, the SAME shape `mooshroom` (auto) + `mooshroom_brown` (this list)
  // already establish). `Bee.skinKey` (07zo_bee.js) is what reaches these from a live entity.
  'bee_angry', 'bee_nectar', 'bee_angry_nectar',
  // #932 -- StriderEntityRenderer.getTexture: isCold() ? strider_cold.png : strider.png
  'strider_cold',
  // #760 -- `VexEntityRenderer.getTexture` while `isCharging()`; `Vex.skinKey` (07j_entityrender.js) reaches it
  'vex_charging',
  // #1577 -- `WitherEntityRenderer.getTexture` while the spawn timer runs; `ER.witherSkinKey` reaches it
  'wither_invulnerable',
  // #1576 -- WitherArmorFeatureRenderer: wither_armor.png on the 0.5-dilated wither model (own rows in models-1.18.2.tsv)
  'wither_armor',
  // CreeperChargeFeatureRenderer: creeper_armor.png on the 2.0-dilated creeper model
  'creeper_armor', 'elytra', 'shadow',   // #6736 ElytraFeatureRenderer: textures/entity/elytra.png
  // #1539 -- PhantomEyesFeatureRenderer: phantom_eyes.png over the phantom's own box list (pack-mobtex GEOM_BASE_OVERRIDE)
  'phantom_eyes', 'enderman_eyes', 'spider_eyes',   // #5853: own keys, not the conduit `eye` family
  // #1566 -- EnderDragonEntityRenderer DRAGON_EYES: dragon_eyes.png over the dragon's own box list
  'dragon_eyes',
  // #591 -- `DragonHeadEntityModel` (the dragon head BLOCK's own layer, jaw pitch 0.2), not `dragon_skull`
  'dragon_head',
  // #5499 -- ConduitBlockEntityRenderer's four layers (pack-models.mjs builds them; 'conduit' is the base shell)
  'conduit', 'conduit_cage', 'conduit_wind', 'conduit_eye',
  'sign',   // #6373: SignBlockEntityRenderer's model (pack-models.mjs builds it), one sheet per SignType
  'fox_sleep', 'snow_fox', 'snow_fox_sleep',   // #1327: FoxEntityRenderer.getTexture, reached by Fx.skinKey
  'ghast_shooting',   // #641: GhastEntityRenderer ANGRY_TEXTURE, reached by Gh.skinKey (07zzi_ghast.js)
  // #732 -- IronGolemCrackFeatureRenderer: a second pass of the golem's own model, retextured
  'iron_golem_crack_low', 'iron_golem_crack_medium', 'iron_golem_crack_high'];   // s101: + brown mooshroom (MooshroomEntityRenderer TEXTURES)
const layers = [...new Set([
  ...readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'models-1.18.2.tsv'), 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t')[0]),
  ...EXTRA_LAYERS,
])].sort();
say(`extract-mob-textures: ${layers.length} layers in the roster (${EXTRA_LAYERS.length} added, not in models-1.18.2.tsv)`);

const base = (n) => n.split('#')[0];
const P = (p) => 'assets/minecraft/textures/entity/' + p;

// ── single-sheet aliases, one real jar path each (see the header comment for how these were
// found — every one is re-verified against ENTITY below, never trusted on its own) ───────────
const ALIAS = {
  armor_stand: P('armorstand/wood.png'),           // armor_stand / #b / #c share the one skin
  banner: P('banner_base.png'),
  bell: P('bell/bell_body.png'),   // #6392: BellBlockEntityRenderer.BELL_BODY_TEXTURE (entity/bell/bell_body)
  book: P('enchanting_table_book.png'),
  conduit: P('conduit/base.png'),
  conduit_cage: P('conduit/cage.png'),
  cave_spider: P('spider/cave_spider.png'),
  chest_minecart: P('minecart.png'),
  cod: P('fish/cod.png'),
  command_block_minecart: P('minecart.png'),
  creeper_head: P('creeper/creeper.png'),
  donkey: P('horse/donkey.png'),
  dragon_fireball: P('enderdragon/dragon_fireball.png'),
  dragon_eyes: P('enderdragon/dragon_eyes.png'),
  dragon_head: P('enderdragon/dragon.png'),
  dragon_skull: P('enderdragon/dragon.png'),
  drowned: P('zombie/drowned.png'),
  elder_guardian: P('guardian_elder.png'),
  ender_dragon: P('enderdragon/dragon.png'),
  evoker: P('illager/evoker.png'),
  evoker_fangs: P('illager/evoker_fangs.png'),
  furnace_minecart: P('minecart.png'),
  fur: P('sheep/sheep_fur.png'),                   // "fur#null" — sheep's wool layer
  giant: P('zombie/zombie.png'),                   // Giant is a scaled-up zombie skin
  hopper_minecart: P('minecart.png'),
  husk: P('zombie/husk.png'),
  illusioner: P('illager/illusioner.png'),
  leash_knot: P('lead_knot.png'),
  llama_spit: P('llama/spit.png'),
  shulker_bullet: P('shulker/spark.png'),   // #3032: ShulkerBulletEntityRenderer.TEXTURE (.decomp:17)
  magma_cube: P('slime/magmacube.png'),
  slime_outer: P('slime/slime.png'),   // #1869: SlimeOverlayFeatureRenderer's sheet (same slime.png as the inner pass)
  mooshroom: P('cow/red_mooshroom.png'),
  mooshroom_brown: P('cow/brown_mooshroom.png'),
  strider_cold: P('strider/strider_cold.png'),
  ghast_shooting: P('ghast/ghast_shooting.png'),
  fox_sleep: P('fox/fox_sleep.png'),
  snow_fox: P('fox/snow_fox.png'),
  snow_fox_sleep: P('fox/snow_fox_sleep.png'),
  bee_angry: P('bee/bee_angry.png'),
  bee_nectar: P('bee/bee_nectar.png'),
  bee_angry_nectar: P('bee/bee_angry_nectar.png'),
  mule: P('horse/mule.png'),
  ocelot: P('cat/ocelot.png'),                     // pre-1.14 tamed-ocelot skins live in cat/
  cat_collar: P('cat/cat_collar.png'),
  // D-458 — wolf's three body skins: neutral, tamed (post-taming, any collar colour), angry
  // (raised hackles, red eyes — `Wolf.isAngry()`). `wolf.png` alone already auto-resolves
  // (the generic `b + '/' + b + '.png'` pass), so only the other two need naming.
  wolf_tame: P('wolf/wolf_tame.png'),
  wolf_angry: P('wolf/wolf_angry.png'),
  wolf_collar: P('wolf/wolf_collar.png'),
  player: P('steve.png'),
  player_head: P('steve.png'),
  player_slim: P('alex.png'),
  polar_bear: P('bear/polarbear.png'),
  pufferfish_big: P('fish/pufferfish.png'),
  pufferfish_medium: P('fish/pufferfish.png'),
  pufferfish_small: P('fish/pufferfish.png'),
  iron_golem: P('iron_golem/iron_golem.png'),   // #1859: 1.13.2's entity/iron_golem.png is not the 1.18.2 sheet
  iron_golem_crack_low: P('iron_golem/iron_golem_crackiness_low.png'),
  iron_golem_crack_medium: P('iron_golem/iron_golem_crackiness_medium.png'),
  iron_golem_crack_high: P('iron_golem/iron_golem_crackiness_high.png'),
  saddle: P('pig/pig_saddle.png'),                 // "saddle#null" — the pig's own saddle
  strider_saddle: P('strider/strider_saddle.png'),   // StriderEntityRenderer's SaddleFeatureRenderer sheet; boxes = the strider body's own
  salmon: P('fish/salmon.png'),
  collar: P('wolf/wolf_collar.png'),               // "collar#null" — the wolf collar layer (#5956; cat_collar is its own key)
  eye: P('conduit/open_eye.png'),                  // "eye#null" — ConduitBlockEntityRenderer's EYE (#5956)
  shell: P('conduit/base.png'),                    // "shell#null" — ConduitBlockEntityRenderer's SHELL; the turtle sheet is the turtle body's own skin (#5854)
  shield: P('shield_base_nopattern.png'),
  skeleton_horse: P('horse/horse_skeleton.png'),
  skeleton_skull: P('skeleton/skeleton.png'),
  spawner_minecart: P('minecart.png'),
  stray: P('skeleton/stray.png'),
  stray_outer: P('skeleton/stray_overlay.png'),   // #1128: StrayOverlayFeatureRenderer.SKIN (.decomp), the hood/clothes pass
  tnt_minecart: P('minecart.png'),
  turtle: P('turtle/big_sea_turtle.png'),
  // D-527 — post-1.13.2 mobs whose ONLY texture lives in the 1.18.2 jar (D-458's fallback), each path
  // read off the renderer's own TEXTURE constant in .decomp (PillagerEntityRenderer, RavagerEntityRenderer,
  // GlowSquidEntityRenderer, ZoglinEntityRenderer, PiglinEntityRenderer.TEXTURES) — never guessed.
  pillager: P('illager/pillager.png'),
  ravager: P('illager/ravager.png'),
  glow_squid: P('squid/glow_squid.png'),
  squid: P('squid/squid.png'),   // #1627: 1.13.2's entity/squid.png differs from the 1.18.2 jar's by 623 px
  zoglin: P('hoglin/zoglin.png'),
  piglin_brute: P('piglin/piglin_brute.png'),     // piglin_brute / #b / #c share the one skin (piglin's own rule)
  vex: P('illager/vex.png'),
  vex_charging: P('illager/vex_charging.png'),
  phantom_eyes: P('phantom_eyes.png'),
  enderman_eyes: P('enderman/enderman_eyes.png'),
  spider_eyes: P('spider_eyes.png'),
  vindicator: P('illager/vindicator.png'),
  wither_skeleton: P('skeleton/wither_skeleton.png'),
  wither_skeleton_skull: P('skeleton/wither_skeleton.png'),
  wither_skull: P('wither/wither.png'),
  wither_invulnerable: P('wither/wither_invulnerable.png'),
  wither_armor: P('wither/wither_armor.png'),
  elytra: P('elytra.png'),
  shadow: SHADOW_PNG,
  creeper_armor: P('creeper/creeper_armor.png'),
  zombie_head: P('zombie/zombie.png'),
  zombie_horse: P('horse/horse_zombie.png'),
  zombified_piglin: P('piglin/zombified_piglin.png'), // #1217: PiglinEntityModel (snout/ears) needs the 1.16+ sheet (ZombifiedPiglinEntityRenderer.TEXTURE); D-527
  // ⚠ tropical fish: "large"/"small" pick a BODY SHAPE (vanilla's tropical_a / tropical_b),
  // not a size in the English sense — both paths exist and are real, but which of the two
  // shapes is "large" vs "small" is a fact about `TropicalFish$Variant`/the renderer's own
  // switch, not something a texture filename can confirm. Assigned per common documentation
  // (a is the smaller "clownfish" silhouette, b the larger one); flagged so a future session
  // applying D-263's referee rules to the renderer can confirm or correct it in one place.
  tropical_fish_small: P('fish/tropical_a.png'),
  tropical_fish_large: P('fish/tropical_b.png'),
};

// D-471 — the collar's TINT. Read `wolf`/`cat`'s own bytecode this session (`fac`/`eyq`
// extend `RenderLayer`, `javap`-confirmed): the collar is not a new box at all — it is the
// SAME wolf/cat box list, drawn a SECOND time with `wolf_collar.png`/`cat_collar.png` (a
// white-on-transparent "colour by DyeColor" mask, `coloredCutoutModelCopyLayerRender`) tinted
// by `wolf.getCollarColor()`/`cat.getCollarColor()`. Collar DYE-CHANGING BY THE PLAYER is not
// built (`Tame.OWED`, `07n_tame.js`'s own `Tm.collarRGB` comment) — `e.collarColor` is never
// anything but the jar's own default, so every tamed wolf/cat draws the SAME tint today, and
// baking that ONE tint into the sheet here (the same per-channel multiply
// `pack-blockentity.mjs`'s own banner tint already uses) is the whole cost of drawing it
// correctly, not a shortcut around a runtime tint this engine does not have.
const COLLAR_TINT_HEX = (() => {
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv');
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c[0] === 'red') return parseInt(c[3].replace('#', ''), 16);
  }
  throw new Error('extract-mob-textures: no "red" row in dye-colours-1.18.2.tsv');
})();
const COLLAR_TINT_PATHS = new Set([ALIAS.wolf_collar, ALIAS.cat_collar]);
function tintCollarInPlace(img) {
  const r = (COLLAR_TINT_HEX >> 16) & 255, g = (COLLAR_TINT_HEX >> 8) & 255, b = COLLAR_TINT_HEX & 255;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(d[i] * (r / 255));
    d[i + 1] = Math.round(d[i + 1] * (g / 255));
    d[i + 2] = Math.round(d[i + 2] * (b / 255));
    // alpha untouched — the mask's own shape is what makes this a "colour by DyeColor" layer
  }
}


// ── families — every member packed, named "<layer>#<n>" ────────────────────────────────────
const DYES = (() => {
  const f = join(MCLITE_ROOT, 'tools', 'golden', 'dye-colours-1.18.2.tsv');
  const out = [];
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c[0]) out.push(c[0]);
  }
  return out;
})();
const FAMILY = {
  // G18a-1 (#209) -- the boat's six woods, BoatEntity.Type declaration order (oak, spruce, birch, jungle,
  // acacia, dark_oak), path = BoatEntityRenderer's "textures/entity/boat/" + getName() + ".png". One layer
  // (`boat`, tools/golden/boat-model-1.18.2.tsv), six sheets: "boat", "boat#1" .. "boat#5".
  boat: ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'].map((w) => P('boat/' + w + '.png')),
  // D-527 — axolotl's five variants, AxolotlEntity.Variant ordinal/id order (lucy, wild, gold, cyan, blue),
  // path = AxolotlEntityRenderer's String.format("textures/entity/axolotl/axolotl_%s.png", getName()).
  // #918 -- panda's seven gene sheets, Gene ordinal order (normal, lazy, worried, playful, brown, weak,
  // aggressive); PandaEntityRenderer.getTexture. Index 0 is panda/panda.png.
  panda: ['panda', 'lazy_panda', 'worried_panda', 'playful_panda', 'brown_panda', 'weak_panda', 'aggressive_panda'].map((v) => P('panda/' + v + '.png')),
  axolotl: ['lucy', 'wild', 'gold', 'cyan', 'blue'].map((v) => P('axolotl/axolotl_' + v + '.png')),
  // D-458 — cat's own eleven variants (`CatVariant`, ordinal order), read as separate full
  // skins the same way parrot's five colours already are (each a whole texture, not a tint).
  // Belongs in FAMILY (an array of paths), not ALIAS (one path each) — `resolve()` wraps
  // an ALIAS hit in an array, which would have nested cat's own array inside another one.
  cat: ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll',
    'white', 'jellie', 'all_black'].map((v) => P('cat/' + v + '.png')),
  // D-651 — THE CHEST MATERIALS (D-421's owed family). `ChestBlockEntityRenderer` picks the sheet
  // at runtime off the block entity's type (TexturedRenderLayers.getChestTexture, .decomp):
  // index 0 normal, 1 trapped, 2 ender, 3 christmas -> "chest", "chest#1", "chest#2", "chest#3".
  // A double chest has no ender member (an ender chest never pairs): 0 normal, 1 trapped,
  // 2 christmas. Paths are this 1.13.2 jar's own (D-5's look).
  chest: [P('chest/normal.png'), P('chest/trapped.png'), P('chest/ender.png'), P('chest/christmas.png')],
  double_chest_left: [P('chest/normal_double.png'), P('chest/trapped_double.png'), P('chest/christmas_double.png')],
  double_chest_right: [P('chest/normal_double.png'), P('chest/trapped_double.png'), P('chest/christmas_double.png')],
  // #6373 -- TexturedRenderLayers.getSignTextureId: textures/entity/signs/<type>, SignType registration order
  // -> "sign", "sign#1" .. "sign#7" (1.18.2 jar only; the 1.13.2 jar has one sign.png)
  sign: ['oak', 'spruce', 'birch', 'acacia', 'jungle', 'dark_oak', 'crimson', 'warped'].map((w) => P('signs/' + w + '.png')),
  bed_head: DYES.map((d) => P('bed/' + d + '.png')),
  bed_foot: DYES.map((d) => P('bed/' + d + '.png')),
  // loop/renderres-s104: index 16, appended after the 16 dyes -- `LlamaDecorFeature
  // Renderer.method_4191` (.decomp, read in full): `getCarpetColor() == null && isTrader()`
  // (TraderLlamaEntity's own override, .decomp) draws THIS single texture instead of any
  // dye, off the SAME decor geometry/model -- `pack-mobtex.mjs`'s own vi-loop (`for (vi=1;
  // vi<sheetIdxs.length; vi++) bakeVariant(gname+'#'+vi, ...)`) bakes it under
  // "decor#null#16" for free, no packer edit owed.
  decor: DYES.map((d) => P('llama/decor/' + d + '.png'))
    .concat([P('llama/decor/trader_llama.png')]),   // "decor#null" .. "decor#null#16"
  horse: ['black', 'brown', 'chestnut', 'creamy', 'darkbrown', 'gray', 'white']
    .map((c) => P('horse/horse_' + c + '.png')),
  // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- `HorseMarkingFeatureRenderer`'s own
  // `TEXTURES` map (.decomp, read in full): field_23808 (NONE) -> null, then the four real
  // overlays in HorseMarking ordinal order 1..4 -- `Mnt.horseMarking(e)` already returns that
  // same 0..4 index (07r_mount.js, D-520-era), 0 meaning "no overlay", never packed here.
  horse_marking: ['white', 'whitefield', 'whitedots', 'blackdots']
    .map((c) => P('horse/horse_markings_' + c + '.png')),
  // QUEUE 0.2 (G18e remainder, Mnt.OWED close) -- the four `HorseArmorItem` bonuses
  // (`Mnt.ARMOR_BONUS`, 07r_mount.js) each own one overlay sheet, jar path read by hand
  // (`assets/minecraft/textures/entity/horse/armor/horse_armor_<name>.png`) -- note the ITEM
  // is "golden_horse_armor" but the TEXTURE file is "horse_armor_gold.png", not "golden".
  horse_armor: ['leather', 'iron', 'gold', 'diamond']
    .map((c) => P('horse/armor/horse_armor_' + c + '.png')),
  llama: ['creamy', 'white', 'brown', 'gray'].map((c) => P('llama/' + c + '.png')),
  trader_llama: ['creamy', 'white', 'brown', 'gray'].map((c) => P('llama/' + c + '.png')),
  parrot: ['red_blue', 'blue', 'green', 'yellow_blue', 'grey'].map((c) => P('parrot/parrot_' + c + '.png')),
  // #657 -- ShulkerEntityRenderer: the undyed sheet is "shulker" (sheet 0), then COLORED_TEXTURES in DyeColor
  // order -> "shulker#1".."shulker#16" (`Sh.skinKey`, 07zzk_shulker.js, picks by getColor()+1).
  shulker: [P('shulker/shulker.png')].concat(DYES.map((d) => P('shulker/shulker_' + d + '.png'))),
  rabbit: ['brown', 'white', 'black', 'white_splotched', 'gold', 'salt', 'toast', 'caerbannog']
    .map((c) => P('rabbit/' + c + '.png')),
  // outer#null and pattern#null are genuinely per-CALLER (a different texture
  // depending which entity is drawing this layer, not a closed enumerable set the way a dye
  // colour is) — named as families of the callers this tool can actually find in the jar.
  drowned_outer: [P('zombie/drowned_outer_layer.png')],
  outer: [P('slime/slime.png')],   // the slime cube's outer layer (SlimeOverlayFeatureRenderer, same sheet); drowned has its own key
  // #5499: conduit_wind = wind, wind_vertical; conduit_eye = open_eye, closed_eye (`isEyeOpen` picks)
  conduit_wind: [P('conduit/wind.png'), P('conduit/wind_vertical.png')],
  conduit_eye: [P('conduit/open_eye.png'), P('conduit/closed_eye.png')],
  wind: [P('conduit/wind.png'), P('conduit/wind_vertical.png')],
};
// "pattern#null" — banner AND shield overlays share this one layer. Not hand-listed: every
// texture actually under entity/banner/ or entity/shield/ in THIS jar, found dynamically so a
// renamed or added pattern in a different jar build cannot silently go stale here.
// #1760 -- TropicalFishColorFeatureRenderer's pattern sheets, indexed by pattern 0..5 (`getVarietyId`).
FAMILY.tropical_fish_small_pattern = [1, 2, 3, 4, 5, 6].map((n) => P('fish/tropical_a_pattern_' + n + '.png'));
FAMILY.tropical_fish_large_pattern = [1, 2, 3, 4, 5, 6].map((n) => P('fish/tropical_b_pattern_' + n + '.png'));
FAMILY.pattern = [...ENTITY].filter((p) => /\/(banner|shield)\/[\w]+\.png$/.test(p)).sort();

// loop/villager-tex (G18 mobs, "villager type/profession TEXTURES" gap) -- villager/
// zombie_villager's own 26 overlay sheets, read off `jars/1.18.2/1.18.2.jar` (the 1.13.2 jar
// pre-dates VillagerType/VillagerProfession entirely -- no amount of alias-guessing finds a
// texture that jar never shipped). Order is NOT arbitrary -- `src/07j_entityrender.js`'s
// `ER.villagerClothingLayers` indexes this exact array by texKey "<base>#<n>" (the SAME
// bare/family-variant `#n` numbering `pack-mobtex.mjs`'s own vi-loop already mints for every
// OTHER multi-sheet family here, e.g. `cat`) and cites this same ordering in its own header:
//   [0]        the base skin (villager.png / zombie_villager.png, unchanged from the old
//              single-path alias this replaces)
//   [1..7]     TYPE, `VillagerType.java`'s own declaration order (desert, jungle, plains,
//              savanna, snow, swamp, taiga -- alphabetical, .decomp lines 14-20)
//   [8..21]    PROFESSION, `Prof.ALL`'s order minus "none" (07o_profession.js, itself the
//              jar's own `bnz` field declaration order, D-479) -- armorer, butcher,
//              cartographer, cleric, farmer, fisherman, fletcher, leatherworker, librarian,
//              mason, nitwit, shepherd, toolsmith, weaponsmith
//   [22..26]   PROFESSION_LEVEL badge, `VillagerClothingFeatureRenderer.LEVEL_TO_ID`'s own
//              map-literal order (.decomp lines 28-32) -- stone, iron, gold, emerald, diamond
var VILLAGER_TYPE_NAMES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];
var VILLAGER_PROF_NAMES = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman',
  'fletcher', 'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith'];
var VILLAGER_LEVEL_NAMES = ['stone', 'iron', 'gold', 'emerald', 'diamond'];
function villagerFamily(entityType) {
  return [P(entityType + '/' + entityType + '.png')]
    .concat(VILLAGER_TYPE_NAMES.map((n) => P(entityType + '/type/' + n + '.png')))
    .concat(VILLAGER_PROF_NAMES.map((n) => P(entityType + '/profession/' + n + '.png')))
    .concat(VILLAGER_LEVEL_NAMES.map((n) => P(entityType + '/profession_level/' + n + '.png')));
}
FAMILY.villager = villagerFamily('villager');
FAMILY.zombie_villager = villagerFamily('zombie_villager');
// `resolve()` below checks FAMILY ahead of the AUTO rule for exactly these two bases -- AUTO
// would otherwise find `villager/villager.png` first and return a 1-element array, same as it
// did before this session (the single-sheet look this FAMILY entry replaces).
var VILLAGER_FAMILY_BASES = new Set(['villager', 'zombie_villager', 'panda', 'shulker', 'sign']);   // #1753: shulker too - AUTO's shulker/shulker.png otherwise hid the 16 dyed sheets

// ── THE HAT METADATA -- read off each PNG's own `.mcmeta` in the SAME 1.18.2 jar, never
// guessed (`VillagerResourceMetadataReader.java:9`, key "hat", default "none" when the mcmeta
// itself is absent -- `VillagerResourceMetadata.HatType.from`'s own `BY_NAME.getOrDefault`).
// Only the files that actually carry one are read; every other (type|profession) name is
// "none" by the same default the jar's own reader falls back to on a missing resource.
function readVillagerHatTypes() {
  var out = { villager: { type: {}, profession: {} }, zombie_villager: { type: {}, profession: {} } };
  if (!jar18) return out;   // no 1.18.2 jar this run -- OWED, named below, never guessed
  var names = jar18.names();
  var mcmetaSet = new Set(names.filter((n) => n.endsWith('.png.mcmeta')));
  for (var et of ['villager', 'zombie_villager']) {
    for (var kind of ['type', 'profession']) {
      var list = kind === 'type' ? VILLAGER_TYPE_NAMES : VILLAGER_PROF_NAMES;
      for (var n of list) {
        var mp = P(et + '/' + kind + '/' + n + '.png.mcmeta');
        if (!mcmetaSet.has(mp)) continue;   // absent -- stays "none" by omission
        try {
          var j = JSON.parse(jar18.read(mp).toString('utf8'));
          var hat = (j && j.villager && j.villager.hat) || 'none';
          out[et][kind][n] = hat;
        } catch (err) { /* an unparsable mcmeta reports nothing rather than a guessed value */ }
      }
    }
  }
  return out;
}

// ── mobs that simply did not exist in the 1.13.2 jar — named, not guessed around ───────────
const POST_1_13_2 = new Set([
  'axolotl', 'bee', 'cat', 'fox', 'glow_squid', 'goat', 'hoglin', 'panda',
  'piglin', 'piglin_brute', 'pillager', 'ravager', 'strider', 'wandering_trader', 'zoglin',
]);
// needs the renderer's own bytecode read (D-263) before a texture can be named at all —
// listed here so the report says WHY, not just "missing"
const NEEDS_REFEREE = new Set(['armor', 'cage', 'spin_attack']);

// #1548: `<mob>#b` / `<mob>#c` are the mob's inner / outer ARMOUR model layers (64x32, BipedEntityModel.getModelData(dilation));
// vanilla draws them with textures/models/armor/<material>_layer_2 (legs = inner) / _layer_1 (outer), a 64x32 sheet - NOT the
// mob's own skin (64x64 for zombie/player/piglin/drowned/armor_stand, whose uv rows the 64x32 boxes then misread).
const ARMOR_MOBS = new Set(['armor_stand', 'drowned', 'giant', 'husk', 'piglin', 'piglin_brute', 'player', 'player_slim', 'skeleton',
  'stray', 'wither_skeleton', 'zombie', 'zombie_villager', 'zombified_piglin']);
function resolve(name, aliasTable, entitySet) {
  const b = base(name);
  if (ARMOR_MOBS.has(b) && /#[bc]$/.test(name)) return ARMOR_SHEETS(name.endsWith('#b') ? 2 : 1);
  // loop/villager-tex -- FAMILY wins ahead of AUTO for `villager`/`zombie_villager` only: AUTO
  // would otherwise match `<b>/<b>.png` (villager.png/zombie_villager.png, both real jar
  // paths) and return a 1-element array before FAMILY is ever consulted, the exact single-
  // sheet behaviour this session replaces. No other FAMILY base collides with AUTO today
  // (every one of cat/horse/llama/parrot/rabbit/bed_head/bed_foot/decor/horse_marking/
  // horse_armor/axolotl/eye/outer/wind/pattern has no `<b>.png`/`<b>/<b>.png` of its own in
  // this jar), so this is a narrow, named exception, not a reordering of the whole function.
  if (VILLAGER_FAMILY_BASES.has(b) && FAMILY[b]) return FAMILY[b];
  if ((b === 'squid' || b === 'iron_golem') && aliasTable[b]) return [aliasTable[b]];   // #1627: the 1.13.2 entity/squid.png is not the 1.18.2 sheet
  const auto = [P(b + '.png'), P(b + '/' + b + '.png')].find((p) => entitySet.has(p));
  if (auto) return [auto];
  if (aliasTable[b]) return [aliasTable[b]];
  if (FAMILY[b]) return FAMILY[b];
  return null;
}

function run(aliasTable, { quiet } = {}) {
  const results = new Map();
  const owed = [];
  for (const name of layers) {
    const b = base(name);
    const paths = resolve(name, aliasTable, ENTITY);
    if (paths && paths.every((p) => ENTITY.has(p))) { results.set(name, paths); continue; }
    if (POST_1_13_2.has(b)) { owed.push([name, 'no such mob in the 1.13.2 jar']); continue; }
    if (NEEDS_REFEREE.has(b)) { owed.push([name, 'needs a bytecode-verified texture, not a guessed one']); continue; }
    owed.push([name, paths ? `alias path not in this jar: ${paths.find((p) => !ENTITY.has(p))}` : 'no rule resolves this layer']);
  }
  if (!quiet) {
    say(` resolved ............ ${results.size} of ${layers.length} layers`);
    say(` owed ................ ${owed.length}`);
    for (const [n, why] of owed) say('   - ' + n + '  (' + why + ')');
  }
  return { results, owed };
}

// ── anti-vacuity FIRST: corrupt one real alias, prove the failure names that exact layer ────
{
  const broken = { ...ALIAS, chest: P('chest/does_not_exist.png') };
  const { owed } = run(broken, { quiet: true });
  ok(owed.some(([n]) => n === 'chest'), 'corrupting the "chest" alias did not make "chest" owed — the check is not looking');
  ok(!owed.some(([n]) => n === 'donkey'), 'corrupting one alias broke an unrelated layer ("donkey") — the check is not isolated');
}

// ── the real run ─────────────────────────────────────────────────────────────────────────────
say('');
const { results, owed } = run(ALIAS);
ok(results.size + owed.length === layers.length, 'a layer was neither resolved nor reported owed');
ok(owed.length <= 5, `owed grew to ${owed.length} — a layer that used to resolve stopped resolving`);   // D-527: 13 -> 5
// the 8 G18a target layers MUST resolve — this is the one thing 4.2 exists for tonight
const resolvedBases = new Set([...results.keys()].map(base));
for (const must of ['creeper', 'pig', 'silverfish', 'endermite', 'wither', 'ender_dragon',
  'tropical_fish_large', 'tropical_fish_small', 'fur']) {
  ok(resolvedBases.has(must), `the G18a target layer "${must}" has no texture — 4.2 does not cover its own reason for existing`);
}

if (failures) {
  console.error(`\nextract-mob-textures: ${failures} failures — nothing written`);
  process.exit(1);
}

// ── pack: one blob, a JSON header naming every (layer, index) -> sheet, then the RGBA runs ──
const sheetPaths = [...new Set([...results.values()].flat())].sort();
const images = {};
let rawBytes = 0;
for (const p of sheetPaths) {
  const img = decodePng(readEntity(p));
  if (!img || !img.data) { console.error('extract-mob-textures: ' + p + ' did not decode'); process.exit(1); }
  // #1948: the collar sheet ships as the untinted white mask; the renderer tints per entity (Tm.collarRGB)
  images[p] = img;
  rawBytes += img.data.length;
}
let off = 0;
const sheets = [];
for (const p of sheetPaths) {
  sheets.push({ p, w: images[p].width, h: images[p].height, o: off, len: images[p].data.length });
  off += images[p].data.length;
}
const sheetIndex = new Map(sheets.map((s, i) => [s.p, i]));
const layerOut = {};
for (const [name, paths] of results) layerOut[name] = paths.map((p) => sheetIndex.get(p));

const header = { jar: JAR, sheets: sheets.map(({ p, w, h, o, len }) => ({ p, w, h, o, len })), layers: layerOut };
const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
const body = Buffer.alloc(off);
for (const s of sheets) Buffer.from(images[s.p].data).copy(body, s.o);
const whole = Buffer.concat([Buffer.from(new Uint32Array([headerJson.length]).buffer), headerJson, body]);
const deflated = deflateRawSync(whole, { level: 9 });
if (Buffer.compare(inflateRawSync(deflated), whole) !== 0) {
  console.error('extract-mob-textures: deflate round trip did not match');
  process.exit(1);
}
writeFileSync(join(OUT, 'mob-tex.bin'), deflated);
writeFileSync(join(OUT, 'mob-tex.meta.json'), JSON.stringify({
  jar: JAR, rawBytes: whole.length, deflated: deflated.length,
  sheetCount: sheets.length, layerCount: results.size, owed: owed.map(([n, why]) => ({ n, why })),
  // loop/villager-tex -- provenance for `ER.villagerClothingLayers`'s own hard-coded hat
  // table (`src/07j_entityrender.js`): the SAME jar-read values, so a check can assert the
  // two never drift apart without re-reading the jar itself.
  villagerHatTypes: readVillagerHatTypes(),
}, null, 2));

say('');
say('================ extract-mob-textures ================');
say(` sheets .............. ${sheets.length}`);
say(` layers covered ...... ${results.size} of ${layers.length}`);
say(` mob-tex.bin ......... ${(whole.length / 1024).toFixed(1)} KB raw -> ${(deflated.length / 1024).toFixed(1)} KB deflated`);
say('========================================================');
