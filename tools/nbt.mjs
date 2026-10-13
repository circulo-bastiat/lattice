// nbt.mjs — a gzip'd NBT reader and writer, zero dependencies. PLAN W15's first bullet.
//
//   import { readNBT, writeNBT } from './nbt.mjs';
//   const root = readNBT(buffer);            // gzip, zlib or raw NBT, sniffed
//
// ⚠ WHY THIS EXISTS AT ALL. A jigsaw structure — a village house, an outpost tower — is not in
// the worldgen JSON. `template_pool/village/plains/houses.json` names
// `minecraft:village/plains/houses/plains_small_house_1`, and THAT is a file in the jar at
// `data/minecraft/structures/<id>.nbt`: gzip'd, big-endian, Mojang's own tag format. 866 of them,
// 2.4 MB. Nothing in this project could read one, so W15 starts here.
//
// ── THE FORMAT, WHICH IS SMALL ENOUGH TO STATE IN FULL ──────────────────────────────────────
//
// Every value is a TYPE BYTE followed by a payload. Inside a compound each value is also
// preceded by a UTF-8 name (u16 length, then bytes). A list is a type byte, an i32 count, then
// that many payloads with NO names and NO type bytes. Everything is BIG-ENDIAN.
//
//   0 End        (compound terminator, no payload)      7  ByteArray  i32 len + len i8
//   1 Byte       i8                                     8  String     u16 len + UTF-8
//   2 Short      i16                                    9  List       type + i32 len + payloads
//   3 Int        i32                                    10 Compound   (name,type,value)* then 0
//   4 Long       i64                                    11 IntArray   i32 len + len i32
//   5 Float      f32                                    12 LongArray  i32 len + len i64
//   6 Double     f64
//
// ⚠ LONGS ARE READ AS BigInt AND KEPT AS BigInt. A structure template's only longs are in
// `DataVersion`-adjacent metadata and in entity UUIDs, neither of which this project reads — but
// silently narrowing an i64 to a double is the kind of lossy round trip that makes a writer
// disagree with its reader on exactly the values nobody looks at. `writeNBT` accepts a BigInt or
// a number for a long and writes both exactly.
//
// ── WHAT THE TYPE INFORMATION IS FOR ────────────────────────────────────────────────────────
//
// JSON has no i8/i16/i32 distinction and NBT does, so a plain object cannot round-trip: writing
// `{state: 3}` back out has to know whether 3 was a Byte or an Int. Values therefore come back
// as PLAIN JavaScript where the type is recoverable (compound -> object, string -> string,
// list -> array) and as a one-key wrapper where it is not: `{__t: 3, v: 7}` for a tagged scalar
// or array. `readNBT(buf, {plain: true})` drops the wrappers for a caller that only wants to
// read — which is every caller in this project except the round-trip test in `nbtcheck.mjs`,
// whose entire job is to prove the wrappers are enough to write the file back byte for byte.

import { gunzipSync, inflateSync, gzipSync } from 'node:zlib';

export const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};
export const TAG_NAME = ['End', 'Byte', 'Short', 'Int', 'Long', 'Float', 'Double',
  'ByteArray', 'String', 'List', 'Compound', 'IntArray', 'LongArray'];

/** A scalar or array whose NBT type cannot be recovered from the JavaScript value. */
const tagged = (t, v) => ({ __t: t, v: v });
export const isTagged = (x) => x !== null && typeof x === 'object' && x.__t !== undefined;

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  u1() { return this.b[this.p++]; }
  i1() { const v = this.b.readInt8(this.p); this.p += 1; return v; }
  i2() { const v = this.b.readInt16BE(this.p); this.p += 2; return v; }
  i4() { const v = this.b.readInt32BE(this.p); this.p += 4; return v; }
  i8() { const v = this.b.readBigInt64BE(this.p); this.p += 8; return v; }
  f4() { const v = this.b.readFloatBE(this.p); this.p += 4; return v; }
  f8() { const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }
  str() {
    const n = this.b.readUInt16BE(this.p); this.p += 2;
    const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s;
  }
  payload(t) {
    switch (t) {
      case TAG.BYTE: return tagged(t, this.i1());
      case TAG.SHORT: return tagged(t, this.i2());
      case TAG.INT: return tagged(t, this.i4());
      case TAG.LONG: return tagged(t, this.i8());
      case TAG.FLOAT: return tagged(t, this.f4());
      case TAG.DOUBLE: return tagged(t, this.f8());
      case TAG.STRING: return this.str();
      case TAG.BYTE_ARRAY: { const n = this.i4(); const a = new Int8Array(n); for (let i = 0; i < n; i++) a[i] = this.i1(); return tagged(t, a); }
      case TAG.INT_ARRAY: { const n = this.i4(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = this.i4(); return tagged(t, a); }
      case TAG.LONG_ARRAY: { const n = this.i4(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = this.i8(); return tagged(t, a); }
      case TAG.LIST: {
        const et = this.u1(), n = this.i4();
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.payload(et);
        // ⚠ the element type has to survive an EMPTY list: `{blocks: []}` written back with
        // element type 0 instead of 10 is a different file, and Mojang writes 0 for empty lists
        // in some places and the real type in others. Carried explicitly.
        out.__et = et;
        return out;
      }
      case TAG.COMPOUND: {
        const out = {};
        const order = [];
        for (;;) {
          const ct = this.u1();
          if (ct === TAG.END) break;
          const name = this.str();
          out[name] = this.payload(ct);
          order.push(name);
        }
        // ⚠ KEY ORDER IS PART OF THE BYTES. A compound written back in a different order is a
        // different file, and `nbtcheck`'s round trip compares bytes. JavaScript preserves
        // insertion order for string keys, so this is belt and braces for a caller that rebuilds
        // an object — but it is what makes "byte-identical" a claim that can be made at all.
        Object.defineProperty(out, '__order', { value: order, enumerable: false });
        return out;
      }
      default: throw new Error('nbt: unknown tag type ' + t + ' at byte ' + (this.p - 1));
    }
  }
}

/** Strip the `{__t, v}` wrappers, so a reader that only wants values gets plain data. */
export function plain(node) {
  if (node === null || typeof node !== 'object') return node;
  if (isTagged(node)) return (node.v instanceof Int8Array || node.v instanceof Int32Array) ? Array.from(node.v) : node.v;
  if (Array.isArray(node)) return node.map(plain);
  const out = {};
  for (const k of Object.keys(node)) out[k] = plain(node[k]);
  return out;
}

/**
 * readNBT(buffer, opts) -> { name, value } — or the plain value with `{plain: true}`.
 * gzip, zlib and raw NBT are all accepted, sniffed by magic, because the jar's templates are
 * gzip and a hand-made fixture is easier to write raw.
 */
export function readNBT(buf, opts) {
  let b = Buffer.from(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  else if (b[0] === 0x78) b = inflateSync(b);
  const r = new Reader(b);
  const t = r.u1();
  if (t !== TAG.COMPOUND) throw new Error('nbt: root is tag ' + t + ', not a compound');
  const name = r.str();
  const value = r.payload(TAG.COMPOUND);
  if (r.p !== b.length) throw new Error(`nbt: ${b.length - r.p} trailing bytes after the root compound`);
  return { name: name, value: (opts && opts.plain) ? plain(value) : value, raw: b };
}

class Writer {
  constructor() { this.parts = []; this.len = 0; }
  push(b) { this.parts.push(b); this.len += b.length; }
  u1(v) { const b = Buffer.alloc(1); b.writeUInt8(v & 0xff, 0); this.push(b); }
  i1(v) { const b = Buffer.alloc(1); b.writeInt8(v, 0); this.push(b); }
  i2(v) { const b = Buffer.alloc(2); b.writeInt16BE(v, 0); this.push(b); }
  i4(v) { const b = Buffer.alloc(4); b.writeInt32BE(v, 0); this.push(b); }
  i8(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(typeof v === 'bigint' ? v : BigInt(v), 0); this.push(b); }
  f4(v) { const b = Buffer.alloc(4); b.writeFloatBE(v, 0); this.push(b); }
  f8(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v, 0); this.push(b); }
  str(s) { const u = Buffer.from(s, 'utf8'); const b = Buffer.alloc(2); b.writeUInt16BE(u.length, 0); this.push(b); this.push(u); }
  payload(t, v) {
    switch (t) {
      case TAG.BYTE: return this.i1(v.v);
      case TAG.SHORT: return this.i2(v.v);
      case TAG.INT: return this.i4(v.v);
      case TAG.LONG: return this.i8(v.v);
      case TAG.FLOAT: return this.f4(v.v);
      case TAG.DOUBLE: return this.f8(v.v);
      case TAG.STRING: return this.str(v);
      case TAG.BYTE_ARRAY: { this.i4(v.v.length); for (const x of v.v) this.i1(x); return; }
      case TAG.INT_ARRAY: { this.i4(v.v.length); for (const x of v.v) this.i4(x); return; }
      case TAG.LONG_ARRAY: { this.i4(v.v.length); for (const x of v.v) this.i8(x); return; }
      case TAG.LIST: {
        const et = v.__et !== undefined ? v.__et : typeOf(v[0]);
        this.u1(et); this.i4(v.length);
        for (const x of v) this.payload(et, x);
        return;
      }
      case TAG.COMPOUND: {
        for (const k of (v.__order || Object.keys(v))) { const ct = typeOf(v[k]); this.u1(ct); this.str(k); this.payload(ct, v[k]); }
        this.u1(TAG.END);
        return;
      }
      default: throw new Error('nbt: cannot write tag type ' + t);
    }
  }
  buffer() { return Buffer.concat(this.parts, this.len); }
}

function typeOf(v) {
  if (v === undefined) return TAG.END;
  if (typeof v === 'string') return TAG.STRING;
  if (isTagged(v)) return v.__t;
  if (Array.isArray(v)) return TAG.LIST;
  if (v !== null && typeof v === 'object') return TAG.COMPOUND;
  throw new Error('nbt: no tag type for ' + typeof v);
}

/** writeNBT(name, value, {gzip}) -> Buffer. The inverse of `readNBT` without `plain`. */
export function writeNBT(name, value, opts) {
  const w = new Writer();
  w.u1(TAG.COMPOUND); w.str(name); w.payload(TAG.COMPOUND, value);
  const b = w.buffer();
  return (opts && opts.gzip) ? gzipSync(b) : b;
}

/**
 * A structure template, in the shape the rest of the build wants:
 *   { size:[x,y,z], palettes:[[{Name,Properties}]], blocks:[{pos,state,nbt}] }
 *
 * ⚠ `palette` AND `palettes` BOTH EXIST AND MEAN DIFFERENT THINGS. Most templates carry one
 * `palette`; the ones Mojang wanted variety from — village houses with different wood, ruined
 * portals — carry `palettes`, a LIST of alternative palettes over the same block positions, and
 * the game picks one per placement. PLAN W15 names this explicitly. Normalising to a list of
 * lists here means nothing downstream has to know which form the file used.
 */
export function readTemplate(buf) {
  const { value } = readNBT(buf);
  const p = plain(value);
  const palettes = p.palettes ? p.palettes : [p.palette];
  return {
    size: p.size,
    palettes: palettes,
    blocks: p.blocks || [],
    entities: p.entities || [],
    dataVersion: p.DataVersion,
  };
}
