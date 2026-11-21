// taglib.mjs — reading and FLATTENING vanilla's registry tag files, in one place.
//
// ⚠ THIS IS AN EXTRACTION, NOT A NEW IMPLEMENTATION (D-186's rule, applied again by D-197).
// The reader and the resolver below were `tools/pack-tags.mjs`'s, inline, and pack-tags is
// still their main caller. `tools/pack-worldgen.mjs` needs the same answer for a different
// reason — D-197's per-block PLACEMENT SETS are `#minecraft:dirt`, `#minecraft:sand`,
// `#minecraft:bamboo_plantable_on` and eight more, and those sets must ride `worldgen.bin`
// because the workers read that blob and never see `tags.bin` (src/02f_tags.js is main-thread
// only). A second flattener would be a second answer, which is what D-164 cost a session to
// learn. `tags.bin` is byte-for-byte what it was before the move; `tagcheck` proves it.
//
// The 42 `tags/worldgen/biome/**` files are NOT read here. They are three-segment paths, they
// resolve against the biome registry rather than the block registry, and `pack-worldgen.mjs`
// has carried its own order-preserving resolver for them since D-183. Left alone deliberately:
// a check compares its output order against the source files.

/**
 * readRawTags(jar, registries) -> { raw, allFiles, worldgenFiles, rawBytes }
 *
 * `raw` is "blocks/mineable/pickaxe" -> the parsed file, UNRESOLVED. `tags/worldgen/biome/x`
 * has a three-segment directory so the regex sees `worldgen` as the registry — counted, then
 * skipped, so a caller can assert the whole corpus is accounted for (D-200).
 */
export function readRawTags(jar, registries) {
  const raw = new Map();
  let rawBytes = 0, worldgenFiles = 0, allFiles = 0;
  for (const e of jar.names()) {
    const m = /^data\/minecraft\/tags\/([a-z_]+)\/(.+)\.json$/.exec(e);
    if (!m) continue;
    allFiles++;
    if (m[1] === 'worldgen' || e.indexOf('/worldgen/') >= 0) { worldgenFiles++; continue; }
    if (registries.indexOf(m[1]) < 0) continue;
    const text = jar.readText(e);
    rawBytes += text.length;
    raw.set(m[1] + '/' + m[2], JSON.parse(text));
  }
  return { raw, allFiles, worldgenFiles, rawBytes };
}

/**
 * makeTagResolver(raw) -> { resolve, resolved, stack, stats }
 *
 * `resolve('blocks/dirt')` returns the flattened, deduplicated, SORTED member list: a nested
 * `#minecraft:other_tag` is expanded recursively, exactly as vanilla's datapack loader does,
 * so no caller ever sees a `#`.
 *
 * ⚠ CYCLES THROW, they are not survived. A resolver that returned the partial set would hand
 * its caller a `#minecraft:logs` missing half its members and nothing downstream could tell.
 * `stack` is exposed so a caller can reset it after deliberately tripping the detector.
 */
export function makeTagResolver(raw) {
  const resolved = new Map();
  const stack = [];
  const stats = { nestedRefs: 0 };
  function resolve(key) {
    if (resolved.has(key)) return resolved.get(key);
    if (stack.indexOf(key) >= 0) {
      throw new Error('tag cycle: ' + stack.slice(stack.indexOf(key)).join(' -> ') + ' -> ' + key);
    }
    const node = raw.get(key);
    if (!node) throw new Error('taglib: tag ' + key + ' is referenced but is not in the jar');
    stack.push(key);
    const reg = key.slice(0, key.indexOf('/'));
    const out = [];
    for (const v of node.values || []) {
      // an optional entry is `{ "id": "...", "required": false }` — vanilla drops it when the id
      // is absent, and in a vanilla-only build every id it names is present, so it is an id.
      const s = typeof v === 'string' ? v : (v && v.id);
      if (typeof s !== 'string') continue;
      if (s[0] === '#') { stats.nestedRefs++; out.push(...resolve(reg + '/' + s.slice(1).replace(/^minecraft:/, ''))); }
      else out.push(s.replace(/^minecraft:/, ''));
    }
    stack.pop();
    const uniq = [...new Set(out)].sort();
    resolved.set(key, uniq);
    return uniq;
  }
  return { resolve, resolved, stack, stats };
}
