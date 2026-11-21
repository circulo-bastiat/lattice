// spawnloc-decomp.mjs — `SpawnRestriction`'s per-type LOCATION, read out of `.decomp/` (never typed).
//
//   node tools/spawnloc-decomp.mjs        -> prints the table as `Spawn.LOCATION` wants it
//
// Three files, every name resolved from the text itself:
//   SpawnRestriction.java  `register(EntityType.<field>, SpawnRestriction.Location.<loc>, …)`
//   EntityType.java        `<field> = register("<id>", …)` — the entity id each field names
//   SpawnHelper.java       `canSpawn(Location, …)`: which enum constant `return true`s outright
//                          (no_restrictions), which `case` tests FluidTags water / lava
//                          (in_water / in_lava) — FluidTags.java resolves those two tag fields —
//                          and the remaining constant is the `default` (on_ground).
// An entity type SpawnRestriction never registers is NO_RESTRICTIONS (`getLocation`'s own null
// branch) and is left out of the table, the same way the runtime defaults it.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MC = join(ROOT, '.decomp', 'net', 'minecraft');

export function decompPresent() { return existsSync(join(MC, 'entity', 'SpawnRestriction.java')); }

/** Pure over the four source texts. Returns { table: {id: loc}, enumMap: {field: loc} }. */
export function parseSpawnLocations({ restriction, entityType, helper, fluidTags }) {
  const fluid = {};
  for (const m of fluidTags.matchAll(/(field_\d+)\s*=\s*register\("(\w+)"\)/g)) fluid[m[1]] = m[2];
  const enumBody = /enum Location\s*\{([^}]*)\}/.exec(restriction);
  if (!enumBody) throw new Error('SpawnRestriction.Location enum not found');
  const consts = [...enumBody[1].matchAll(/field_\d+/g)].map((m) => m[0]);
  const fn = /public static boolean canSpawn\(SpawnRestriction\.Location[\s\S]*?\n    \}/.exec(helper);
  if (!fn) throw new Error('SpawnHelper.canSpawn(Location, …) not found');
  const body = fn[0];
  const enumMap = {};
  const none = /if \(\$\$0 == SpawnRestriction\.Location\.(field_\d+)\)\s*\{\s*return true;/.exec(body);
  if (none) enumMap[none[1]] = 'none';
  for (const m of body.matchAll(/case (field_\d+):\s*return ([^;]*);/g)) {
    const t = /FluidTags\.(field_\d+)/.exec(m[2]);
    if (t && fluid[t[1]] === 'water') enumMap[m[1]] = 'in_water';
    else if (t && fluid[t[1]] === 'lava') enumMap[m[1]] = 'in_lava';
  }
  const def = /case (field_\d+):\s*default:/.exec(body);
  if (def) enumMap[def[1]] = 'on_ground';
  for (const c of consts) if (!enumMap[c]) throw new Error(`Location.${c}: SpawnHelper.canSpawn gives it no meaning`);
  const ids = {};
  for (const m of entityType.matchAll(/(field_\d+)\s*=\s*register\(\s*"(\w+)"/g)) ids[m[1]] = m[2];
  const table = {};
  for (const m of restriction.matchAll(/register\(EntityType\.(field_\d+),\s*SpawnRestriction\.Location\.(field_\d+)/g)) {
    if (!ids[m[1]]) throw new Error(`EntityType.${m[1]} has no id`);
    table[ids[m[1]]] = enumMap[m[2]];
  }
  return { table, enumMap };
}

export function readDecomp() {
  const r = (p) => readFileSync(join(MC, ...p.split('/')), 'utf8');
  return {
    restriction: r('entity/SpawnRestriction.java'), entityType: r('entity/EntityType.java'),
    helper: r('world/SpawnHelper.java'), fluidTags: r('tag/FluidTags.java'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { table } = parseSpawnLocations(readDecomp());
  const byLoc = {};
  for (const [id, loc] of Object.entries(table)) if (loc !== 'on_ground') (byLoc[loc] = byLoc[loc] || []).push(id);
  const on = Object.keys(table).filter((k) => table[k] === 'on_ground').sort();
  console.log(JSON.stringify({ on_ground: on, ...Object.fromEntries(Object.entries(byLoc).map(([k, v]) => [k, v.sort()])) }, null, 1));
}
