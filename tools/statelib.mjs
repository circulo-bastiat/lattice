// statelib.mjs — name-plus-properties to LOCAL STATE INDEX, in one place. PLAN W6, W15.
//
// ⚠ WHY IT MOVED HERE. This resolver was written for `pack-worldgen.mjs` (PLAN W6): the worldgen
// data names block STATES — a surface rule places `{Name: "minecraft:deepslate", Properties:
// {axis: "y"}}` — and the runtime registry deliberately does not carry property NAMES, so the
// mapping is resolved at build time and shipped beside the tree. W15's structure templates need
// exactly the same answer for 1,047 states of their own, and D-164's lesson is the reason this
// is a shared module rather than a second copy: *"a rule with three implementations is a rule
// with three answers."* `lightcheck` failed to catch D-156 because it tested an adapter it had
// built itself. One resolver, two callers, and `wgcheck` still proves the blob it produces is
// byte-for-byte what it was.
//
// ── VANILLA'S STATE ORDERING, WHICH THIS ARITHMETIC HAS TO MATCH EXACTLY ────────────────────
// Properties in DECLARATION order with the LAST varying fastest, and each property's values in
// the order the block declares them — which for a boolean is [true, false], not alphabetical.
// That ordering comes from `block-constants.json`'s `props`, which is minecraft-data's and is
// vanilla's. ⚠ It is NOT `block-registry.json`'s `properties`, which are the BLOCKSTATES file's
// and are alphabetically sorted — using those would resolve `powered=false` to index 0 instead
// of 1 and place a subtly wrong state everywhere a property appears.

const short = (s) => (String(s).startsWith('minecraft:') ? String(s).slice(10) : String(s));

/** The canonical key a packed table is keyed by: `name` or `name|k=v,k=v` with k sorted. */
export function stateKey(node) {
  const props = node.Properties;
  if (!props) return node.Name;
  const ks = Object.keys(props).sort();
  if (!ks.length) return node.Name;
  return node.Name + '|' + ks.map((k) => k + '=' + props[k]).join(',');
}

/**
 * `minecraft:oak_stairs[facing=east,half=bottom]` -> `{Name, Properties}`.
 * ⚠ W15 needs this and W6 did not: a jigsaw block's `final_state` is a STRING in that syntax,
 * not a compound, and it is the state the block is replaced by when nothing connects to it.
 */
export function parseStateString(s) {
  // ⚠ THE PROPERTY LIST MAY NOT CONTAIN A BRACKET, and that strictness is load-bearing rather
  // than tidy. With a greedy `(.*)` this happily "parsed" vanilla's own
  // `...west=false]]` — a real doubled bracket in `savanna_lamp_post_01.nbt` — into a property
  // whose VALUE was `false]`, which then failed one layer down with a message about acacia
  // fences. A malformed state has to fail HERE, where the caller can do what Java does with it.
  const m = /^([^[\]]+)(?:\[([^[\]]*)\])?$/.exec(String(s).trim());
  if (!m) throw new Error('statelib: cannot parse block state "' + s + '"');
  const out = { Name: m[1] };
  if (m[2] && m[2].length) {
    out.Properties = {};
    for (const kv of m[2].split(',')) {
      const i = kv.indexOf('=');
      if (i < 0) throw new Error('statelib: bad property "' + kv + '" in "' + s + '"');
      out.Properties[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
  }
  return out;
}

/**
 * makeResolver(blockProps) -> { resolveLocal, fails, strideChecked, verify }
 * `blockProps` is `block-constants.json`'s `blocks` map.
 */
export function makeResolver(blockProps) {
  const fails = [];

  function resolveLocal(node) {
    const name = short(node.Name);
    const b = blockProps && blockProps[name];
    if (!b) { fails.push(`no block ${node.Name}`); return -1; }
    const declared = b.props || [];
    if (!node.Properties) return b.defaultState | 0;
    let local = 0, stride = 1;
    const wanted = Object.assign({}, node.Properties);
    // ⚠ ONE NARROW EXCEPTION, named rather than swept up. `configured_feature/spring_*` writes a
    // FLUID state where every other file writes a BLOCK state: `{Name: "minecraft:lava",
    // Properties: {falling: "true"}}`. `falling` is a property of `FlowingFluid`, not of the lava
    // BLOCK, which has only `level` — so there is nothing for it to resolve to and dropping it is
    // correct rather than lossy: a spring places a SOURCE fluid, which is level 0, which is the
    // block's default. Any other unknown property is still a failure.
    if ((name === 'water' || name === 'lava') && wanted.falling !== undefined) delete wanted.falling;
    for (let i = declared.length - 1; i >= 0; i--) {
      const d = declared[i];
      const v = wanted[d.name];
      if (v !== undefined) {
        const k = d.values.indexOf(String(v));
        if (k < 0) { fails.push(`${node.Name}: ${d.name} has no value ${v} (has ${d.values.join('/')})`); return -1; }
        local += k * stride;
        delete wanted[d.name];
      } else {
        // a property the data did not name keeps the DEFAULT's value for that property, which is
        // what vanilla does when it writes a partial state
        const dv = Math.floor((b.defaultState | 0) / stride) % d.values.length;
        local += dv * stride;
      }
      stride *= d.values.length;
    }
    const left = Object.keys(wanted);
    if (left.length) { fails.push(`${node.Name}: no such property ${left.join(',')}`); return -1; }
    if (local < 0 || local >= (b.stateCount | 0)) { fails.push(`${node.Name}: local ${local} outside 0..${b.stateCount - 1}`); return -1; }
    return local;
  }

  /**
   * The proof that the strides are right, run over ALL blocks rather than over the states the
   * data happens to name: every block's full property space must equal its own `stateCount`,
   * which is only true if the strides are right.
   */
  function verify() {
    let checked = 0;
    if (!blockProps) return 0;
    for (const [name, b] of Object.entries(blockProps)) {
      let n = 1;
      for (const d of b.props || []) n *= d.values.length;
      if (n !== (b.stateCount | 0)) fails.push(`${name}: property space is ${n} but stateCount is ${b.stateCount}`);
      else checked++;
      if ((b.defaultState | 0) >= (b.stateCount | 0)) fails.push(`${name}: defaultState ${b.defaultState} outside its ${b.stateCount} states`);
    }
    return checked;
  }

  return { resolveLocal, fails, verify, stateKey, short };
}

// ── ROTATION, AT BUILD TIME AND NOWHERE ELSE (PLAN W15, D-187) ─────────────────────────────
//
// ⚠ THIS CANNOT LIVE IN THE ENGINE, AND THE REASON IS A FACT ABOUT THE RUNTIME REGISTRY. The
// packed placement table carries SIX property names — `facing`, `axis`, `half`, `type`, `face`,
// `waterlogged` — because those are the six the block-placement path needs (D-157), and 900
// blocks of property names is 40 KB nobody else wanted. A structure template rotates by six
// properties too, and only two of them are on that list: `rotation` (signs), `orientation`
// (jigsaw blocks), rail `shape` and the four side flags of every fence, wall and pane are not
// reachable from the engine at all. A first attempt rotated states at runtime and silently did
// nothing to any of them: every fence in every village kept the connections it had before the
// house was turned.
//
// So the ROTATED PALETTE INDEX is computed here, where `block-constants.json` knows every
// property of every block, and shipped as one table. The runtime rotation is then an array
// read, which is also faster than the six property edits it replaces.
//
// Vanilla's own rotation is a method per block class; this is per PROPERTY NAME, which is the
// same thing for every block a structure template contains. One quarter-turn CLOCKWISE seen
// from above, so a direction (dx, dz) becomes (-dz, dx) and therefore north -> east.

const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const RAIL_ROT = {
  north_south: 'east_west', east_west: 'north_south',
  ascending_east: 'ascending_south', ascending_south: 'ascending_west',
  ascending_west: 'ascending_north', ascending_north: 'ascending_east',
  south_east: 'south_west', south_west: 'north_west',
  north_west: 'north_east', north_east: 'south_east',
};
const SIDES = ['north', 'east', 'south', 'west'];

/**
 * rotateProps(props) -> the same property map after ONE clockwise quarter-turn.
 * Returns a new object; `undefined` in means `undefined` out (a block with no properties).
 */
export function rotateProps(props) {
  if (!props) return props;
  const out = Object.assign({}, props);
  if (out.facing !== undefined && CW[out.facing] !== undefined) out.facing = CW[out.facing];
  if (out.axis === 'x') out.axis = 'z'; else if (out.axis === 'z') out.axis = 'x';
  if (out.rotation !== undefined) {
    const n = parseInt(out.rotation, 10);
    if (n === n) out.rotation = String((n + 4) & 15);
  }
  if (out.orientation !== undefined) {
    const u = out.orientation.indexOf('_');
    const f = out.orientation.slice(0, u), t = out.orientation.slice(u + 1);
    out.orientation = (CW[f] || f) + '_' + (CW[t] || t);
  }
  // ⚠ `shape` BY VALUE, NOT BY NAME. A rail's shape turns; a STAIR's `straight`/`inner_left`/
  // `outer_right` is RELATIVE to its own `facing` and must not, or the stair turns twice.
  if (out.shape !== undefined && RAIL_ROT[out.shape] !== undefined) out.shape = RAIL_ROT[out.shape];
  // the four sides move as a group: what was north is now east
  if (SIDES.every((s) => out[s] !== undefined)) {
    const was = SIDES.map((s) => props[s]);
    for (let i = 0; i < 4; i++) out[SIDES[(i + 1) & 3]] = was[i];
  }
  return out;
}

/** The direction names, in the order the engine indexes them: north east south west up down. */
export const DIRS = ['north', 'east', 'south', 'west', 'up', 'down'];
