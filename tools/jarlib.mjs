// jarlib.mjs — read a Minecraft .jar with no external dependencies.
//
// A .jar is a .zip. Node ships zlib, so a ZIP reader is ~80 lines and costs us nothing at
// install time. The alternative is a dependency in the build path of a project whose whole
// identity is "one self-contained file", which would be a poor joke.
//
// Reads the central directory rather than scanning for local headers: the central directory
// is authoritative, and scanning is how you end up reading a filename out of compressed data.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;

export class Jar {
  constructor(path) {
    this.path = path;
    this.buf = readFileSync(path);
    this.entries = new Map();
    this.#readCentralDirectory();
  }

  #findEocd() {
    const b = this.buf;
    // The EOCD is at the end, after a comment of up to 65535 bytes.
    const min = Math.max(0, b.length - 0xffff - 22);
    for (let i = b.length - 22; i >= min; i--) {
      if (b.readUInt32LE(i) === EOCD_SIG) return i;
    }
    throw new Error(`not a zip: no end-of-central-directory in ${this.path}`);
  }

  #readCentralDirectory() {
    const b = this.buf;
    const eocd = this.#findEocd();
    let count = b.readUInt16LE(eocd + 10);
    let cenSize = b.readUInt32LE(eocd + 12);
    let cenOff = b.readUInt32LE(eocd + 16);

    // ZIP64: a Minecraft jar is nowhere near the limits, but a reader that silently
    // truncates at 65535 entries is a trap for whoever uses this next.
    if (count === 0xffff || cenOff === 0xffffffff) {
      for (let i = eocd - 20; i >= 0; i--) {
        if (b.readUInt32LE(i) === EOCD64_LOCATOR_SIG) {
          const z64 = Number(b.readBigUInt64LE(i + 8));
          if (b.readUInt32LE(z64) !== EOCD64_SIG) break;
          count = Number(b.readBigUInt64LE(z64 + 32));
          cenSize = Number(b.readBigUInt64LE(z64 + 40));
          cenOff = Number(b.readBigUInt64LE(z64 + 48));
          break;
        }
      }
    }

    let p = cenOff;
    for (let i = 0; i < count; i++) {
      if (b.readUInt32LE(p) !== CEN_SIG) throw new Error(`bad central directory entry at ${p}`);
      const method = b.readUInt16LE(p + 10);
      const compSize = b.readUInt32LE(p + 20);
      const rawSize = b.readUInt32LE(p + 24);
      const nameLen = b.readUInt16LE(p + 28);
      const extraLen = b.readUInt16LE(p + 30);
      const cmtLen = b.readUInt16LE(p + 32);
      const localOff = b.readUInt32LE(p + 42);
      const name = b.toString('utf8', p + 46, p + 46 + nameLen);
      if (!name.endsWith('/')) {
        this.entries.set(name, { method, compSize, rawSize, localOff });
      }
      p += 46 + nameLen + extraLen + cmtLen;
    }
  }

  has(name) { return this.entries.has(name); }
  names() { return [...this.entries.keys()]; }

  /** Every entry under a prefix. */
  under(prefix) { return this.names().filter((n) => n.startsWith(prefix)); }

  read(name) {
    const e = this.entries.get(name);
    if (!e) throw new Error(`no such entry: ${name}`);
    const b = this.buf;
    // The local header repeats the name and extra fields, and its lengths are the ones
    // that count for locating the data - the central directory's are not interchangeable.
    const lh = e.localOff;
    if (b.readUInt32LE(lh) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const nameLen = b.readUInt16LE(lh + 26);
    const extraLen = b.readUInt16LE(lh + 28);
    const start = lh + 30 + nameLen + extraLen;
    const raw = b.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(raw);
    if (e.method === 8) return inflateRawSync(raw);
    throw new Error(`unsupported compression method ${e.method} for ${name}`);
  }

  readText(name) { return this.read(name).toString('utf8'); }
  readJson(name) { return JSON.parse(this.readText(name)); }
}

/** Minecraft resource locations: "minecraft:block/stone" -> {ns, path}. */
export function parseId(id) {
  const i = id.indexOf(':');
  return i < 0 ? { ns: 'minecraft', path: id } : { ns: id.slice(0, i), path: id.slice(i + 1) };
}

export function modelPath(id) {
  const { ns, path } = parseId(id);
  return `assets/${ns}/models/${path}.json`;
}

export function texturePath(id) {
  const { ns, path } = parseId(id);
  return `assets/${ns}/textures/${path}.png`;
}
