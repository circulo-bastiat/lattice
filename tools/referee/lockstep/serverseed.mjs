// lockstep/serverseed.mjs -- #6964: the seed SeedAgent hands java.util.Random() for the nth entity of a concrete class summoned on the
// server (SeedAgent.next: x = ((src+key).hashCode() << 32) ^ n ^ SALT, then splitmix64's two xor-multiply rounds; nanoTime is pinned to 0).
// Key for a /summon'ed entity is 'ent|summon|<obfuscated concrete class>' (blaze = bln, .decomp/names.tsv). Returns a BigInt (signed 64).
const M64 = (1n << 64n) - 1n;
export function javaHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }
export function serverEntitySeed(salt, cls, n = 1, src = 'Random') {
  let x = ((BigInt(javaHash(src + 'ent|summon|' + cls)) << 32n) ^ BigInt(n) ^ BigInt(salt)) & M64;
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M64;
  return BigInt.asIntN(64, x ^ (x >> 31n));
}
