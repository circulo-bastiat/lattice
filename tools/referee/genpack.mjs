// genpack.mjs — writes packs/mob-defaults.json FROM THE ENGINE'S OWN REGISTRY (assets/entities.json),
// never hand-typed, so the roster can't silently drift from what the engine actually ships.
//
//   node tools/referee/genpack.mjs   ->  tools/referee/packs/mob-defaults.json
//
// Roster: every key of DATA.entities.attrs — that IS the engine's own definition of "living"
// (src/07h_entities.js: `Ent.isLiving = name => !!Ent.attrsOf(name)`). Six vanilla attributes are
// requested per mob, but only the ones the engine itself claims a non-null value for (a mob with
// no attack_damage in the engine table has none in vanilla either — Animal never adds it).
// Breedable mobs (present in DATA.entities.breeding) additionally get the Age NBT tag; every
// mob gets CanPickUpLoot and PersistenceRequired (universal Mob-class fields, D-18).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const data = JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'));

const ATTR_MAP = {
  hp: 'minecraft:generic.max_health',
  speed: 'minecraft:generic.movement_speed',
  dmg: 'minecraft:generic.attack_damage',
  follow: 'minecraft:generic.follow_range',
  kbRes: 'minecraft:generic.knockback_resistance',
  atkKb: 'minecraft:generic.attack_knockback',
};

const breedable = new Set(Object.keys(data.breeding || {}));
const mobs = Object.keys(data.attrs).sort().map((id) => {
  const row = data.attrs[id];
  const attrs = Object.entries(ATTR_MAP)
    .filter(([k]) => row[k] !== null && row[k] !== undefined)
    .map(([, vanillaId]) => vanillaId);
  const nbt = ['CanPickUpLoot', 'PersistenceRequired'];
  if (breedable.has(id)) nbt.push('Age');
  return { id, attrs, nbt };
});

const pack = {
  name: 'mob-defaults',
  description: 'G18: every living mob type the engine defines, its base attribute values, and a few default NBT fields, read from the real 1.18.2 server.',
  version: '1.18.2',
  mobs,
};

const out = join(ROOT, 'tools', 'referee', 'packs', 'mob-defaults.json');
writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
console.log(`genpack: wrote ${mobs.length} mobs -> ${out}`);
