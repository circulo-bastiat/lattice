// tools/infra/jsonmerge.mjs - #1612: a 3-way merge of two JSON documents BY KEY, for the shared ratchet lists
// (tools/*-known.json, tools/mobl3-mobs.json, tools/golden/*-known.json) that every mob-gate PR edits at once.
// merge3(baseText, oursText, theirsText) -> { ok: true, text } | { ok: false, why }.
//  - objects: per key; a key only one side changed/added/removed is taken from that side; both sides changed it:
//    equal -> fine, both objects -> recurse, both arrays -> list merge, anything else -> REAL conflict (ok:false).
//  - arrays: ours, minus what theirs removed, plus what theirs added (by deep equality).
// It never invents a value: every value in the result is verbatim from one side. Output keeps ours' indentation, and
// ours' key order (sorted order is kept sorted); a layout it does not know is normalised to the same indent.
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
class Conflict extends Error {}

function mergeArr(b, o, t) {
  const has = (arr, x) => arr.some((y) => eq(x, y));
  const out = o.filter((x) => !(has(b, x) && !has(t, x)));            // theirs removed it, ours kept it unchanged
  for (const x of t) if (!has(b, x) && !has(out, x)) out.push(x);     // theirs added it
  return out;
}
function mergeVal(b, o, t, path) {
  if (eq(o, t)) return o;
  if (eq(b, o)) return t;
  if (eq(b, t)) return o;
  if (isObj(o) && isObj(t)) return mergeObj(isObj(b) ? b : {}, o, t, path);
  if (Array.isArray(o) && Array.isArray(t)) return mergeArr(Array.isArray(b) ? b : [], o, t);
  throw new Conflict(`both sides changed ${path || '(root)'} to different values`);
}
function mergeObj(b, o, t, path) {
  const keys = [...Object.keys(o)]; for (const k of Object.keys(t)) if (!keys.includes(k)) keys.push(k);
  const res = {};
  for (const k of keys) {
    const inB = k in b, inO = k in o, inT = k in t, p = `${path}/${k}`;
    if (inO && inT) res[k] = mergeVal(inB ? b[k] : undefined, o[k], t[k], p);
    else if (inO) { if (inB && !eq(b[k], o[k])) throw new Conflict(`${p}: theirs removed it, ours changed it`); if (!inB) res[k] = o[k]; }
    else { if (inB && !eq(b[k], t[k])) throw new Conflict(`${p}: ours removed it, theirs changed it`); if (!inB) res[k] = t[k]; }
  }
  const sorted = (x) => { const ks = Object.keys(x); return eq(ks, [...ks].sort()); };
  if (sorted(o) && Object.keys(o).length > 1) return Object.fromEntries(Object.keys(res).sort().map((k) => [k, res[k]]));
  return res;
}
// serialisers: JSON.stringify at an indent, or the "compact leaf" style the audit tables use (objects indented one
// level per depth, arrays of scalars on one line as ["a","b"])
const ser = (v, lay) => {
  if (lay.ind !== 'compact') return JSON.stringify(v, null, lay.ind);
  const go = (x, d) => {
    if (Array.isArray(x) && x.every((e) => e === null || typeof e !== 'object')) return '[' + x.map((e) => JSON.stringify(e)).join(lay.sep) + ']';
    const pad = ' '.repeat(d + 1), end = ' '.repeat(d);
    if (Array.isArray(x)) return x.length ? '[\n' + x.map((e) => pad + go(e, d + 1)).join(',\n') + '\n' + end + ']' : '[]';
    if (isObj(x)) { const ks = Object.keys(x); return ks.length ? '{\n' + ks.map((k) => pad + JSON.stringify(k) + ': ' + go(x[k], d + 1)).join(',\n') + '\n' + end + '}' : '{}'; }
    return JSON.stringify(x);
  };
  return go(v, 0);
};
// the layout of a document, or null if it is not exactly what one of our serialisers writes
function layout(text, v) {
  const nl = text.endsWith('\n') ? '\n' : '';
  for (const lay of [{ ind: 2 }, { ind: '\t' }, { ind: 1 }, { ind: 4 }, { ind: 0 }, { ind: 'compact', sep: ',' }, { ind: 'compact', sep: ', ' }])
    if (ser(v, lay) + nl === text) return { lay, nl };
  // a hand-tuned layout (some arrays inline, some not): keep the indent, normalise the rest - the checks read the
  // JSON, never the text, and the result is deterministic so later merges are unaffected
  const m = text.match(/^[{\[]\n?([ \t]+)/);
  return { lay: { ind: m ? (m[1][0] === '\t' ? '\t' : m[1].length) : 2 }, nl, reformatted: true };
}
export function merge3(baseText, oursText, theirsText) {
  try {
    const o = JSON.parse(oursText), t = JSON.parse(theirsText), b = baseText == null || baseText === '' ? (isObj(o) ? {} : []) : JSON.parse(baseText);
    const lay = layout(oursText, o);
    return { ok: true, text: ser(mergeVal(b, o, t, ''), lay.lay) + lay.nl };
  } catch (e) { return { ok: false, why: e instanceof Conflict ? e.message : 'not valid JSON: ' + e.message }; }
}
export const MERGEABLE = /^tools\/(?:golden\/)?[^/]*-known\.json$|^tools\/(?:mobl3-mobs|mobshapecheck|quarantine|core)\.json$/;   // #1638: the "may only shrink" ratchet, the quarantine and core sets too
