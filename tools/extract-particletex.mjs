#!/usr/bin/env node
// extract-particletex.mjs — PLAN G20 (loop/particledraw): the particle SPRITE ATLAS,
// `Px.OWED`'s own first line ("no particle atlas is extracted, so there is nothing to bind a
// camera-facing billboard quad to"). Reads the three sprites this engine's own particle
// substrate (`07zx_particle.js`) actually needs — HEART, HAPPY_VILLAGER, SMOKE — straight off
// the 1.18.2 jar's `assets/minecraft/particles/*.json` sprite lists (the SAME indirection
// `ParticleManager.registerFactories` reads: a particle TYPE names a `textures:` list of
// sprite ids, not a texture path directly) and packs them into ONE small texture-array blob,
// the same "one 2D texture array, one tile per layer" shape `tools/build-atlas.mjs` already
// ships for blocks — just ten 8x8 layers instead of hundreds of 16x16 ones.
//
//   node tools/extract-particletex.mjs   -> assets/particle-tex.bin, assets/particle-tex.meta.json
//
// ── WHY THESE THREE, AND NOT VANILLA'S WHOLE PARTICLE ROSTER ────────────────────────────────
// `07zx_particle.js`'s own header says its substrate simulates exactly three types
// (`Px.spawn`'s own `if` chain: 'heart' | 'happy_villager' | 'smoke') for three cadences this
// unit owns (love-mode, growth puff, tame success/fail). Packing the other ~90 particle
// textures here would be dead weight with no simulation to bind them to — the same "owed, not
// guessed around" discipline `extract-mob-textures.mjs`'s own header argues for its POST_1_13_2
// list. Adding a fourth simulated type later is `07zx_particle.js`'s own edit, and this
// extractor's `TYPES` table is where its sprite list would be added too.
//
// ── EVERY TEXTURE NAME IS READ OFF THE JAR'S OWN JSON, NOT GUESSED ─────────────────────────
//   assets/minecraft/particles/heart.json           -> ["minecraft:heart"]
//   assets/minecraft/particles/happy_villager.json   -> ["minecraft:glint"]          (SuspendParticle
//     tints it white via HappyVillagerFactory, .decomp/net/minecraft/client/particle/
//     SuspendParticle.java:87-92 — the SAME "glint" sprite the enchant table's own
//     ENCHANT particle borrows, this is not a placeholder, it is vanilla's real choice)
//   assets/minecraft/particles/smoke.json           -> 8 frames, "generic_7".."generic_0"
//     (also `large_smoke.json`'s own identical list — `FireSmokeParticle`/`AscendingParticle`,
//     .decomp/net/minecraft/client/particle/AscendingParticle.java:45,62 calls
//     `setSpriteForAge` every tick, walking this list as age climbs toward maxAge)
// This tool reads those four `.json` files itself (never types the resulting names by hand)
// and resolves each `minecraft:<name>` to `assets/minecraft/textures/particle/<name>.png`,
// re-verifying every path exists in the jar before packing anything — the same
// resolve-then-verify shape `extract-mob-textures.mjs`'s own `ALIAS`/`ok()` pair uses.
//
// ── PACKING: A TEN-LAYER TEXTURE ARRAY, EVERY SPRITE 8x8 (verified, not assumed) ────────────
// `heart.png`/`glint.png`/`generic_0..7.png` are every one of them 8x8 in the 1.18.2 jar (the
// SAME size vanilla's own particle atlas stitches them at) — this tool asserts that before
// packing rather than silently cropping or stretching a sprite that turned out a different
// size in some other jar. Layer order is this file's own packing choice (not a vanilla
// constant): 0 = heart, 1 = happy_villager (glint), 2..9 = smoke, in JSON list order
// (generic_7 first, generic_0 last — the SAME order `AscendingParticle`'s own frame walk
// expects). `particle-tex.meta.json`'s `layers` field is the one place that order is written
// down; `07zx_particle.js` reads it back rather than re-deriving it, so the two can never
// drift out of step with each other (only both together can drift from the jar, and the
// anti-vacuity below catches that).
//
// ── ANTI-VACUITY ─────────────────────────────────────────────────────────────────────────────
// Corrupt one sprite name in the TYPES table (point 'heart' at a texture this jar does not
// have) and this tool must fail, naming that exact type — proven below by corrupting a copy of
// the table for one entry and asserting the failure names it, then re-running the real table
// clean.

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
const JAR = opt('jar', jarPath('1.18.2'));
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
// s118: the array is 16x16 now. The particle sheet's own sprites are 8x8 and are copied in at
// 2x NEAREST (both backends sample this array with NEAREST and one mip level, so a 2x nearest
// copy draws pixel-for-pixel what the 8x8 original did); the ITEM crumbs (`CrackParticle`)
// sample a window of the item's own 16x16 icon and need the full 16 texels.
// D-658: 32x32 now — the SWEEP frames (sweep_0..7) are 32x32 in the jar. Every smaller sprite
// is copied in at an integer NEAREST upscale (8x8 at 4x, the 16x16 item icons at 2x), which
// both backends' NEAREST/one-mip sampling draws pixel-for-pixel as the original; the crumbs'
// 4/16 UV window is a FRACTION of the icon, so it is unchanged by the upscale.
const TILE = 32;

let failures = 0;
const say = (s) => console.log(s);
const ok = (cond, msg) => { if (!cond) { failures++; say('   x ' + msg); } };

const jar = new Jar(JAR);
const PARTICLE_JSON = (n) => 'assets/minecraft/particles/' + n + '.json';
const TEXTURE_PNG = (n) => 'assets/minecraft/textures/particle/' + n + '.png';

/** `minecraft:<name>` (or a bare `<name>`) -> the bare texture name `TEXTURE_PNG` wants. */
function bareName(id) { return id.indexOf(':') >= 0 ? id.split(':')[1] : id; }

/** Read one `particles/<file>.json`'s own `textures` list off the jar. Never hand-typed. */
function readTextureList(file) {
  const raw = JSON.parse(jar.readText(PARTICLE_JSON(file)));
  if (!raw || !Array.isArray(raw.textures) || !raw.textures.length) {
    throw new Error('extract-particletex: ' + file + '.json has no textures list');
  }
  return raw.textures.map(bareName);
}

// ── the three `Px.spawn` types this unit simulates, each naming the jar json it reads its own
// sprite list from — see the header for why these three and not vanilla's whole roster ──────
const TYPES = {
  heart: { json: 'heart' },
  happy_villager: { json: 'happy_villager' },
  smoke: { json: 'smoke' },
  flame: { json: 'flame' },       // #168: FlameParticle (spawner cage), one sprite
  // s118: `PortalParticle` (ender pearl trail) — portal.json lists generic_0..7, the SAME eight
  // pngs smoke.json lists (in the other order); they are packed once and indexed twice.
  portal: { json: 'portal' },
  falling_nectar: { json: 'falling_nectar' },   // BeeEntity.tick nectar drip
  rain: { json: 'rain' },          // D-656: RainSplashParticle, splash_0..3
  // D-658: Player.attack's hit particles — crit.json (critical_hit), enchanted_hit.json,
  // damage_indicator.json (damage), sweep_attack.json (sweep_0..7, 32x32).
  crit: { json: 'crit' },
  enchanted_hit: { json: 'enchanted_hit' },
  damage_indicator: { json: 'damage_indicator' },
  sweep_attack: { json: 'sweep_attack' },
  // D-664: `GlowParticle`'s four world-event factories (WorldRenderer.processWorldEvent 3002-3005)
  // — electric_spark.json, wax_on.json, wax_off.json and scrape.json each list the ONE sprite
  // minecraft:glow; packed once, indexed as `layers.glow`.
  electric_spark: { json: 'electric_spark' },
  wax_on: { json: 'wax_on' },
  wax_off: { json: 'wax_off' },
  scrape: { json: 'scrape' },
  // loop/potion-splash-impact -- WorldRenderer.processWorldEvent case 2002/2007 (SpellParticle,
  // .decomp client/render/WorldRenderer.java:2964-2999, read whole): effect.json (2002) lists
  // effect_7..effect_0, instant_effect.json (2007) lists spell_7..spell_0 -- TWO DIFFERENT
  // sprite sheets, not the same eight frames reused (unlike portal/smoke above), verified
  // against the jar's own json rather than assumed from the similar names.
  effect: { json: 'effect' },
  instant_effect: { json: 'instant_effect' },
  // #3761: SquidInkParticle (squid_ink / glow_squid_ink, frame walk) and WaterBubbleParticle (bubble)
  squid_ink: { json: 'squid_ink' },
  glow_squid_ink: { json: 'glow_squid_ink' },
  bubble: { json: 'bubble' },
  // #6059: EmotionParticle (angry_villager), ComposterFillParticle, BubbleColumnUpParticle
  angry_villager: { json: 'angry_villager' },
  composter: { json: 'composter' },
  bubble_column_up: { json: 'bubble_column_up' },
  // #6058: WaterSplashParticle (splash.json), SuspendParticle mycelium/dolphin (generic_0), SpellParticle witch (spell_7..0)
  splash: { json: 'splash' },
  mycelium: { json: 'mycelium' },
  dolphin: { json: 'dolphin' },
  witch: { json: 'witch' },
  vibration: { json: 'vibration' },   // #6060: VibrationParticle (sculk sensor signal), SimpleSpriteProvider walk
  explosion: { json: 'explosion' },   // #6056: ExplosionLargeParticle, explosion_0..15
};
// s118: `CrackParticle`'s sprite is the ITEM's own model particle sprite (CrackParticle.java:
// 20-21, `getModel(stack).getParticleSprite()`), for the egg `item/egg` (its model's layer0).
// Only items something in this engine actually bursts are packed: the egg (EggEntity.
// handleStatus(3), 07zzd_throw.js) and, s119, the snowball (SnowballEntity.handleStatus(3), whose
// `getParticleParameters()` is ItemStackParticleEffect(ITEM, getItem()) — its own item/snowball icon).
// loop/potion-splash-impact: PotionEntity.onCollision's own break burst -- CrackParticle(...,
// new ItemStack(Items.field_8436)) (.decomp client/render/WorldRenderer.java:2969-2977), the
// glass bottle's own model particle sprite, same "only items something in this engine actually
// bursts are packed" discipline as egg/snowball above.
const ITEMS = { egg: 'item/egg', snowball: 'item/snowball', glass_bottle: 'item/glass_bottle' };
// #6039: block dust for the blocks whose model `#particle` is NOT in the block atlas names the dust
// path looks up: TexturedRenderLayers puts the shulker box / bell / conduit entity textures in the
// block atlas, so BlockDustParticle draws a 4x4 window of the WHOLE entity texture. Packed as extra
// layers, resampled NEAREST to TILE x TILE (shulker 64x64 -> every 2nd texel; conduit base 32x16 is
// stretched 2x in v, which is what a UV window over the whole sprite does too).
const DUST_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const DUST_ENTITY = { shulker_box: 'entity/shulker/shulker', bell: 'entity/bell/bell_body', conduit: 'entity/conduit/base' };
// barrier / structure_void / light_00..15: the block model's `particle` is the ITEM sprite (models/block/*.json).
DUST_ENTITY.barrier = 'item/barrier'; DUST_ENTITY.structure_void = 'item/structure_void';
for (let l = 0; l < 16; l++) { const n = 'light_' + (l < 10 ? '0' : '') + l; DUST_ENTITY[n] = 'item/' + n; }
for (const c of DUST_COLORS) DUST_ENTITY[c + '_shulker_box'] = 'entity/shulker/shulker_' + c;
const ITEM_PNG = (n) => 'assets/minecraft/textures/' + n + '.png';

function run(types, { quiet } = {}) {
  const owed = [];
  const names = new Map();   // type -> array of bare texture names, in json order
  for (const type of Object.keys(types)) {
    let list;
    try { list = readTextureList(types[type].json); }
    catch (err) { owed.push([type, err.message]); continue; }
    const missing = list.filter((n) => !jar.names().includes(TEXTURE_PNG(n)));
    if (missing.length) { owed.push([type, 'texture not in this jar: ' + TEXTURE_PNG(missing[0])]); continue; }
    names.set(type, list);
  }
  if (!quiet) {
    say(` resolved ............ ${names.size} of ${Object.keys(types).length} types`);
    for (const [t, why] of owed) say('   - ' + t + '  (' + why + ')');
  }
  return { names, owed };
}

// ── anti-vacuity FIRST: corrupt one real json name, prove the failure names that exact type ──
{
  const broken = { ...TYPES, heart: { json: 'this_particle_json_does_not_exist' } };
  const { owed } = run(broken, { quiet: true });
  ok(owed.some(([t]) => t === 'heart'), 'corrupting "heart"\'s own json name did not make "heart" owed — the check is not looking');
  ok(!owed.some(([t]) => t === 'smoke'), 'corrupting one type broke an unrelated type ("smoke") — the check is not isolated');
}

// ── the real run ─────────────────────────────────────────────────────────────────────────────
say('');
const { names, owed } = run(TYPES);
ok(owed.length === 0, `${owed.length} of this unit's own particle types have no sprite — that is this tool's whole job`);
if (failures) {
  console.error(`\nextract-particletex: ${failures} failures — nothing written`);
  process.exit(1);
}

// ── decode every sprite, verify it is TILE x TILE (never crop/stretch a surprise size) ───────
// #6060: vibration.png is an ANIMATED strip (18x126 = 7 frames of 18x18, frametime 1 tick, .mcmeta); each
// frame is padded top-left into a TILE cell (draw window 18/32, Px.buildQuads) and listed as vibration_0..6.
const images = new Map();
if (names.has('vibration')) {
  const vimg = decodePng(jar.read(TEXTURE_PNG('vibration')));
  if (!vimg || vimg.width !== 18 || vimg.height !== 126) { console.error('extract-particletex: vibration.png is not 18x126'); process.exit(1); }
  const vn = [];
  for (let f = 0; f < 7; f++) {
    const out = Buffer.alloc(TILE * TILE * 4);
    for (let y = 0; y < 18; y++) vimg.data.copy(out, y * TILE * 4, (f * 18 + y) * 18 * 4, (f * 18 + y + 1) * 18 * 4);
    images.set('vibration_' + f, { width: TILE, height: TILE, data: out });
    vn.push('vibration_' + f);
  }
  names.set('vibration', vn);
}
const allNames = [...new Set([...names.values()].flat())].filter((n) => !/^vibration_\d$/.test(n));
const upN = (img) => {   // w x w -> TILE x TILE, integer nearest (see TILE's own note)
  const w = img.width, k = TILE / w;
  if (img.height !== w || !Number.isInteger(k) || k < 1) return img;   // the size test below refuses it
  if (k === 1) return img;
  const out = Buffer.alloc(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const si = (Math.floor(y / k) * w + Math.floor(x / k)) * 4, di = (y * TILE + x) * 4;
    for (let c = 0; c < 4; c++) out[di + c] = img.data[si + c];
  }
  return { width: TILE, height: TILE, data: out };
};
for (const [id, tex] of Object.entries(ITEMS)) {
  const img0 = decodePng(jar.read(ITEM_PNG(tex)));
  const img = img0 && img0.data ? upN(img0) : img0;
  if (!img || img.width !== TILE || img.height !== TILE) {
    console.error('extract-particletex: ' + tex + '.png is not a ' + TILE + 'x' + TILE + ' item icon'); process.exit(1);
  }
  images.set('item:' + id, img);
}
const resampleN = (img) => {
  const out = Buffer.alloc(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const si = (Math.floor(y * img.height / TILE) * img.width + Math.floor(x * img.width / TILE)) * 4, di = (y * TILE + x) * 4;
    for (let c = 0; c < 4; c++) out[di + c] = img.data[si + c];
  }
  return { width: TILE, height: TILE, data: out };
};
for (const [id, tex] of Object.entries(DUST_ENTITY)) {
  const img = decodePng(jar.read(ITEM_PNG(tex)));
  if (!img || !img.data) { console.error('extract-particletex: ' + tex + '.png did not decode'); process.exit(1); }
  images.set('dust:' + id, resampleN(img));
}
for (const n of allNames) {
  const img0 = decodePng(jar.read(TEXTURE_PNG(n)));
  const img = img0 && img0.data ? upN(img0) : img0;
  if (!img || !img.data) { console.error('extract-particletex: ' + n + '.png did not decode'); process.exit(1); }
  if (img.width !== TILE || img.height !== TILE) {
    console.error(`extract-particletex: ${n}.png is ${img.width}x${img.height}, not ${TILE}x${TILE} — ` +
      'this packer only handles a uniform tile size and will not silently resample one that is not');
    process.exit(1);
  }
  images.set(n, img);
}

// ── layer order: heart, happy_villager, then smoke's own frames, in json order (D- none — this
// tool's own packing choice, written down once in the meta so nothing re-derives it) ─────────
const layerNames = ['heart', 'happy_villager'].flatMap((t) => names.get(t))
  .concat(names.get('smoke'));
const layers = { heart: 0, happy_villager: 1, smoke: names.get('smoke').map((_, i) => i + 2) };
// portal: its own json order, each name resolved to the layer smoke already packed (or appended)
layers.portal = names.get('portal').map((n) => {
  let i = layerNames.indexOf(n);
  if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
  return i;
});
layers.item = {};
for (const id of Object.keys(ITEMS)) { layerNames.push('item:' + id); layers.item[id] = layerNames.length - 1; }
// D-656: rain.json's frames APPENDED after the items, so no earlier layer index moves.
layers.rain = names.get('rain').map((n) => {
  let i = layerNames.indexOf(n);
  if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
  return i;
});
// D-658: the hit particles, APPENDED after rain so no earlier layer index moves.
for (const t of ['crit', 'enchanted_hit', 'damage_indicator']) {
  const n = names.get(t)[0];
  let i = layerNames.indexOf(n);
  if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
  layers[t] = i;
}
layers.sweep_attack = names.get('sweep_attack').map((n) => {
  let i = layerNames.indexOf(n);
  if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
  return i;
});
// loop/potion-splash-impact: the potion splash/lingering colour-tint particles (WorldRenderer
// 2002/2007), APPENDED after sweep so no earlier layer index moves. Each is its own 8-frame
// walk (SpellParticle.tick's own `setSpriteForAge` every tick, .decomp SpellParticle.java:38 --
// unlike smoke/rain above it re-walks every tick, not just at spawn, but `Px.frameLayer` reads
// `p.age`/`p.maxAge` fresh each call regardless, so the SAME lookup already serves this).
for (const t of ['effect', 'instant_effect']) {
  layers[t] = names.get(t).map((n) => {
    let i = layerNames.indexOf(n);
    if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
    return i;
  });
}
// D-664: the glow sprite, APPENDED after sweep so no earlier layer index moves. All four jsons
// must name the same single texture, or `layers.glow` would be a guess for three of them.
{
  const g = ['electric_spark', 'wax_on', 'wax_off', 'scrape'].map((t) => names.get(t));
  ok(g.every((l) => l && l.length === 1 && l[0] === g[0][0]),
    'electric_spark/wax_on/wax_off/scrape do not all list one and the same sprite: ' + JSON.stringify(g));
  const n = g[0][0];
  let i = layerNames.indexOf(n);
  if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
  layers.glow = i;
}
{ // #168: flame.json's one sprite, APPENDED so no earlier layer index moves
  const fl = names.get('flame');
  ok(fl && fl.length === 1 && fl[0] === 'flame', 'flame.json does not list the single sprite "flame"');
  let i = layerNames.indexOf(fl[0]);
  if (i < 0) { layerNames.push(fl[0]); i = layerNames.length - 1; }
  layers.flame = i;
}
for (const t of ['squid_ink', 'glow_squid_ink', 'bubble', 'explosion', 'vibration', 'splash', 'mycelium', 'dolphin', 'witch']) {   // #3761, #6056, #6060, #6058, APPENDED so no earlier index moves
  layers[t] = names.get(t).map((n) => {
    let i = layerNames.indexOf(n);
    if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
    return i;
  });
}
for (const t of ['angry_villager', 'composter', 'bubble_column_up']) {   // #6059, APPENDED
  layers[t] = names.get(t).map((n) => {
    let i = layerNames.indexOf(n);
    if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
    return i;
  });
}
layers.falling_nectar = names.get('falling_nectar').map((n) => {   // APPENDED so no earlier index moves
  let i = layerNames.indexOf(n);
  if (i < 0) { layerNames.push(n); i = layerNames.length - 1; }
  return i;
});
ok(layers.squid_ink.length === 1 || layers.squid_ink.length === 8, 'squid_ink.json frame count unexpected');
ok(layers.bubble.length === 1, 'bubble.json does not list one sprite');
ok(layerNames[layers.glow] === 'glow', 'the GlowParticle sprite did not resolve to glow');
ok(layerNames[layers.crit] === 'critical_hit' && layerNames[layers.enchanted_hit] === 'enchanted_hit' &&
  layerNames[layers.damage_indicator] === 'damage', 'crit/enchanted_hit/damage_indicator did not resolve to critical_hit/enchanted_hit/damage');
ok(layers.sweep_attack.length === 8 && layers.sweep_attack.every((i, k) => layerNames[i] === 'sweep_' + k),
  'sweep_attack.json\'s eight frames did not resolve to sweep_0..7 in order');
ok(layers.rain.length === 4 && layers.rain.every((i, k) => layerNames[i] === 'splash_' + k),
  'rain.json\'s four frames did not resolve to splash_0..3 in order');
ok(layers.portal.length === 8 && layers.portal.every((i) => layerNames[i] === 'generic_' + layers.portal.indexOf(i)),
  'portal.json\'s eight frames did not resolve to generic_0..7 in order');
ok(layers.effect.length === 8 && layers.effect.every((i, k) => layerNames[i] === 'effect_' + (7 - k)),
  'effect.json\'s eight frames did not resolve to effect_7..effect_0 in order (the jar lists them reversed)');
ok(layers.instant_effect.length === 8 && layers.instant_effect.every((i, k) => layerNames[i] === 'spell_' + (7 - k)),
  'instant_effect.json\'s eight frames did not resolve to spell_7..spell_0 in order');
ok(layerNames[layers.item.glass_bottle] === 'item:glass_bottle', 'the glass bottle crack sprite did not resolve');

layers.dust = {};   // #6039, APPENDED so no earlier index moves
for (const id of Object.keys(DUST_ENTITY)) { layerNames.push('dust:' + id); layers.dust[id] = layerNames.length - 1; }
ok(Object.keys(layers.dust).length === 37, 'dust sprites: expected 17 shulker + bell + conduit + barrier + structure_void + 16 light');

if (failures) { console.error(`\nextract-particletex: ${failures} failures — nothing written`); process.exit(1); }
const body = Buffer.alloc(layerNames.length * TILE * TILE * 4);
for (let i = 0; i < layerNames.length; i++) {
  images.get(layerNames[i]).data.copy(body, i * TILE * TILE * 4);
}
const packed = deflateRawSync(body, { level: 9 });
if (Buffer.compare(inflateRawSync(packed), body) !== 0) {
  console.error('extract-particletex: deflate round trip did not match');
  process.exit(1);
}
writeFileSync(join(OUT, 'particle-tex.bin'), packed);
writeFileSync(join(OUT, 'particle-tex.meta.json'), JSON.stringify({
  jar: JAR, tile: TILE, count: layerNames.length, layerNames,
  rawBytes: body.length, packedBytes: packed.length,
  layers,
  owed: owed.map(([t, why]) => ({ t, why })),
}, null, 2));

say('');
say('================ extract-particletex ================');
say(` layers ............ ${layerNames.length} (${layerNames.join(', ')})`);
say(` particle-tex.bin .. ${(body.length / 1024).toFixed(2)} KB raw -> ${(packed.length / 1024).toFixed(2)} KB deflated`);
say('=======================================================');
