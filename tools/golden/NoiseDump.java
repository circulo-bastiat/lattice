// NoiseDump.java — reflect on the real 1.18.2 server classes and print a golden noise vector.
// Names come from names.properties, which ng_dump.js derives from Mojang's OFFICIAL mappings.
// Nothing here reimplements anything: every number below is produced by Mojang's own bytecode.
// ⚠ IN A NAMED PACKAGE ON PURPOSE. The 1.18.2 server's obfuscated classes live in the DEFAULT
// package and carry signer information; a class of ours in that same package makes the JVM
// refuse to load them with "signer information does not match".
package ngdump;

import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

public class NoiseDump {
  static Properties props = new Properties();
  static StringBuilder J = new StringBuilder();
  static List<String> notes = new ArrayList<>();
  static int caseCount = 0, valueCount = 0;

  // ── reflection plumbing ──────────────────────────────────────────────────────────────
  static Class<?> ty(String s) throws Exception {
    int dims = 0;
    while (s.endsWith("[]")) { dims++; s = s.substring(0, s.length() - 2); }
    Class<?> base;
    switch (s) {
      case "int": base = int.class; break;      case "long": base = long.class; break;
      case "double": base = double.class; break; case "float": base = float.class; break;
      case "boolean": base = boolean.class; break; case "byte": base = byte.class; break;
      case "short": base = short.class; break;  case "char": base = char.class; break;
      case "void": base = void.class; break;
      default: base = Class.forName(s);
    }
    for (int i = 0; i < dims; i++) base = Array.newInstance(base, 0).getClass();
    return base;
  }
  static Class<?>[] tys(String csv) throws Exception {
    if (csv == null || csv.isEmpty()) return new Class<?>[0];
    String[] parts = csv.split(",");
    Class<?>[] out = new Class<?>[parts.length];
    for (int i = 0; i < parts.length; i++) out[i] = ty(parts[i].trim());
    return out;
  }
  static String need(String k) {
    String v = props.getProperty(k);
    if (v == null) throw new RuntimeException("names.properties has no " + k);
    return v;
  }
  static boolean has(String k) { return props.getProperty(k) != null; }
  static Class<?> C(String key) throws Exception { return Class.forName(need("class." + key)); }
  static Method M(String key) throws Exception {
    String[] p = need("m." + key).split("\\|", -1);
    Class<?> owner = C(key.substring(0, key.indexOf('.')));
    Class<?>[] args = tys(p.length > 1 ? p[1] : "");
    // ⚠ the draw may be a DEFAULT method on a super-interface, so walk rather than assume.
    Method m = null;
    try { m = owner.getDeclaredMethod(p[0], args); } catch (NoSuchMethodException e) { }
    if (m == null) try { m = owner.getMethod(p[0], args); } catch (NoSuchMethodException e) { }
    if (m == null) for (Method c : owner.getMethods())
      if (c.getName().equals(p[0]) && Arrays.equals(c.getParameterTypes(), args)) { m = c; break; }
    if (m == null) throw new NoSuchMethodException(owner.getName() + "." + p[0] + Arrays.toString(args));
    m.setAccessible(true); return m;
  }
  static Field F(String key) throws Exception {
    Class<?> owner = C(key.substring(0, key.indexOf('.')));
    Field f = owner.getDeclaredField(need("f." + key));
    f.setAccessible(true); return f;
  }
  static Constructor<?> K(String key) throws Exception {
    Class<?> owner = C(key.substring(0, key.indexOf('.')));
    Constructor<?> c = owner.getDeclaredConstructor(tys(need("k." + key)));
    c.setAccessible(true); return c;
  }

  // ── JSON plumbing ────────────────────────────────────────────────────────────────────
  static String q(String s) { return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
  static String num(double d) {
    if (Double.isNaN(d) || Double.isInfinite(d)) return q(Double.toString(d));
    return Double.toString(d);
  }
  static String arrD(double[] v) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(num(v[i])); }
    return b.append(']').toString();
  }
  static String arrL(long[] v) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(q(Long.toString(v[i]))); }
    return b.append(']').toString();
  }
  static String arrI(int[] v) { return Arrays.toString(v).replace(" ", ""); }
  static String pts3(double[][] p) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < p.length; i++) { if (i > 0) b.append(','); b.append(arrD(p[i])); }
    return b.append(']').toString();
  }
  static void emit(String body, int values) {
    if (caseCount > 0) J.append(",\n");
    J.append("  {").append(body).append("}");
    caseCount++; valueCount += values;
  }

  // ── the sample points, chosen once and shared with tools/noisecheck.mjs via this file ──
  static final double[][] P3 = {
    {0,0,0},{0.5,0.5,0.5},{1,1,1},{-1,-1,-1},{0.1,0.2,0.3},{-0.1,-0.2,-0.3},
    {12.5,0,-7.25},{100.25,-40.5,33.75},{255.5,255.5,255.5},{256.5,256.5,256.5},
    {-255.5,-255.5,-255.5},{1000,64,-1000},{-33333.5,0,22222.25},{1000000.5,1000000.25,1000000.125},
    {33554431.0,1.5,-33554431.0},{33554433.5,0,0},{-33554433.5,0,0},{0.9999999,0,0},
    {7,320,-7},{-2049.5,-63.5,2049.5},{16,-64,16},{1.0E-7,2.0E-7,3.0E-7}
  };
  // ⚠ D-235: the last three are FAR — a million blocks out, and either side of 2^24 — because a
  // noise stack that is right at the origin and wrong at distance is exactly what D-148 keeps
  // costing this project. `wrap()` folds at 3.3554432e7 and these straddle it in both signs.
  static final double[][] PN = {
    {0,0,0},{1,0,1},{16,0,16},{-16,0,-16},{100.5,0,-250.25},{1000,64,-1000},
    {-4096,32,4096},{123.456,-59,-789.012},{33554430,0,33554430},{-33554430,0,-33554430},
    {7,320,-7},{0.25,-64,0.75},
    {1000000,64,-1000000},{-16777216.5,320,16777216.5},{29999984,-64,-29999984}
  };
  static final double[][] P2 = {
    {0,0},{0.5,-0.5},{16,16},{-16,-16},{100.25,-250.75},{1000,-1000},{4096.5,4096.5},
    {-4096.5,-4096.5},{0.0625,0.0625},{123.456,789.012},{-33333.25,22222.5},{7,-7}
  };
  static final long[] SEEDS = { 0L, 1L, 1337L, -1L, 123456789012345L, -4172144997902289642L };
  static final int[] BOUNDS = { 2, 3, 7, 16, 17, 100, 256, 1000 };
  static final long[] LEGACY_SEEDS = { 1234L, 2345L, 3456L, 42L, 0L, -1L };
  /**
   * The twelve sampled in DEPTH: the raw `PerlinNoise` stack and its per-octave origins as well
   * as the `NormalNoise` on top. Every OTHER noise in the registry gets the NormalNoise column —
   * parameters, valueFactor, maxValue and fifteen values — which is what D-229 left owing
   * ("48 of the 60 noises have no golden values, only parameters and bounds").
   */
  static final Set<String> DEEP = new LinkedHashSet<>(Arrays.asList(
    "temperature","vegetation","continentalness","erosion","offset","ridge","jagged",
    "surface","surface_swamp","cave_cheese","ore_veininess","spaghetti_2d"
  ));
  /**
   * ⚠ ENUMERATED FROM `BuiltinRegistries.NOISE`, not typed out here. A hand-written list is a
   * second place for the set of noises to be wrong, and D-219 is what that costs. If the registry
   * cannot be walked the dumper falls back to DEEP and says so in a note, so a shrunken run is
   * visible rather than silent.
   */
  static List<String> allNoiseNames() throws Exception {
    ensureBootstrapped();
    if (has("m.Registry.keySet0")) {
      try {
        Object registry = F("BuiltinRegistries.NOISE").get(null);
        Object keys = M("Registry.keySet0").invoke(registry);
        List<String> out = new ArrayList<>();
        for (Object k : (Iterable<?>) keys) {
          String id = k.toString();
          out.add(id.startsWith("minecraft:") ? id.substring(10) : id);
        }
        Collections.sort(out);
        notes.add("BuiltinRegistries.NOISE was walked: " + out.size() + " noise parameter sets, "
          + DEEP.size() + " of them sampled in depth (Perlin stack and octave origins as well as NormalNoise).");
        return out;
      } catch (Throwable t) { notes.add("Registry.keySet() failed (" + t + ") — fell back to the twelve deep noises"); }
    } else notes.add("Registry.keySet() is not in the mapping — fell back to the twelve deep noises");
    return new ArrayList<>(DEEP);
  }

  // ── handles, filled in main ──────────────────────────────────────────────────────────
  static Constructor<?> kXoro, kLegacy, kImproved, kPerlinSimplex, kWorldgen, kNoiseParams;
  static Method mNextInt0, mNextInt1, mNextLong, mNextDouble, mNextFloat, mFork, mFromHash, mAt;
  static Method mImprovedNoise, mPerlinGet, mNormalGet, mPsGet, mGetSeed;
  static Field fW0, fW1, fXoroDelegate, fLegacySeed;
  static boolean wordsAreLoHi = true;
  static Field fIxo, fIyo, fIzo, fSxo, fSyo, fSzo;
  static Field fPLevels, fPIn, fPVal, fNVal, fNFirst, fNSecond, fPsLevels, fPsIn, fPsVal;

  static Object xoro(long seed) throws Exception { return kXoro.newInstance(seed); }
  static Object legacy(long seed) throws Exception { return kLegacy.newInstance(seed); }
  /**
   * The two 64-bit words, returned as [lo, hi] — the order Mojang's `next()` reads them in.
   * ⚠ Which declared field is which is settled by EXPERIMENT, not by assumption: Xoroshiro128++
   * returns `rotl(lo + hi, 17) + lo`, and the `+ lo` breaks the symmetry, so one construction
   * plus one draw identifies the pair unambiguously.
   */
  static long[] seedWords(Object src) throws Exception {
    Object g = fXoroDelegate.get(src);          // XoroshiroRandomSource delegates to Xoroshiro128PlusPlus
    long a = fW0.getLong(g), b = fW1.getLong(g);
    return wordsAreLoHi ? new long[]{ a, b } : new long[]{ b, a };
  }
  static void settleWordOrder() throws Exception {
    long probe = 0x5DEECE66DL;
    Object s = xoro(probe);
    Object g = fXoroDelegate.get(s);
    long a = fW0.getLong(g), b = fW1.getLong(g);
    long draw = (Long) mNextLong.invoke(s);
    long sum = Long.rotateLeft(a + b, 17);
    boolean loFirst = (sum + a) == draw, hiFirst = (sum + b) == draw;
    if (loFirst == hiFirst) throw new RuntimeException("cannot settle the Xoroshiro word order: draw=" + draw);
    wordsAreLoHi = loFirst;
    notes.add("XoroshiroRandomSource's two long fields (" + need("meta.xoroWordNames")
      + ") were identified by experiment; declaration order is " + (loFirst ? "[lo, hi]" : "[hi, lo]")
      + " and every seedWords column below is normalised to [lo, hi].");
  }

  public static void main(String[] argv) throws Exception {
    try (java.io.InputStream in = Files.newInputStream(Paths.get(argv[0]))) { props.load(in); }
    Path out = Paths.get(argv[1]);

    kXoro = K("XoroshiroRandomSource.long");
    kLegacy = K("LegacyRandomSource.long");
    kImproved = K("ImprovedNoise.src");
    kPerlinSimplex = K("PerlinSimplexNoise.srcList");
    if (has("k.WorldgenRandom.src")) kWorldgen = K("WorldgenRandom.src");
    // ⚠ NOT resolved eagerly: NoiseParameters' static initialiser builds a Codec that touches the
    // registries, which throws "Not bootstrapped". It is only needed if the double[] factory is
    // missing, and in 1.18.2 it is not.
    if (!has("m.NormalNoise.createArr") && has("k.NoiseParameters.intList")) kNoiseParams = K("NoiseParameters.intList");
    mNextInt0 = M("RandomSource.nextInt0");  mNextInt1 = M("RandomSource.nextInt1");
    mNextLong = M("RandomSource.nextLong0"); mNextDouble = M("RandomSource.nextDouble0");
    mNextFloat = M("RandomSource.nextFloat0"); mFork = M("RandomSource.forkPositional0");
    mFromHash = M("PositionalRandomFactory.fromHashOf1"); mAt = M("PositionalRandomFactory.at3");
    mImprovedNoise = M("ImprovedNoise.noise3"); mPerlinGet = M("PerlinNoise.getValue3");
    mNormalGet = M("NormalNoise.getValue3");   mPsGet = M("PerlinSimplexNoise.getValue3");
    mGetSeed = M("Mth.getSeed3");
    fW0 = F("Xoroshiro128PlusPlus.w0"); fW1 = F("Xoroshiro128PlusPlus.w1");
    fXoroDelegate = F("XoroshiroRandomSource.delegate"); fLegacySeed = F("LegacyRandomSource.seed");
    settleWordOrder();
    fIxo = F("ImprovedNoise.xo"); fIyo = F("ImprovedNoise.yo"); fIzo = F("ImprovedNoise.zo");
    fSxo = F("SimplexNoise.xo"); fSyo = F("SimplexNoise.yo"); fSzo = F("SimplexNoise.zo");
    fPLevels = F("PerlinNoise.noiseLevels"); fPIn = F("PerlinNoise.lowestFreqInputFactor");
    fPVal = F("PerlinNoise.lowestFreqValueFactor");
    fNVal = F("NormalNoise.valueFactor"); fNFirst = F("NormalNoise.first"); fNSecond = F("NormalNoise.second");
    fPsLevels = F("PerlinSimplexNoise.noiseLevels"); fPsIn = F("PerlinSimplexNoise.highestFreqInputFactor");
    fPsVal = F("PerlinSimplexNoise.highestFreqValueFactor");

    dumpXoroshiro();
    dumpFork();
    dumpLegacy();
    dumpBoundedRejection();
    dumpImproved();
    dumpPerlinAndNormal();
    dumpPerlinSimplex();

    StringBuilder full = new StringBuilder();
    full.append("{\n").append(" ").append(q("schema")).append(":").append(q("mclite-noise-golden/1")).append(",\n");
    full.append(" ").append(q("provenance")).append(":{\n");
    full.append("  ").append(q("what")).append(":").append(q(
      "Golden values taken from Mojang's own 1.18.2 server bytecode by reflection. "
      + "Obfuscated names resolved from the OFFICIAL Mojang server mappings. Nothing here is a "
      + "reimplementation: every value is what the real game computes.")).append(",\n");
    full.append("  ").append(q("minecraftVersion")).append(":").append(q("1.18.2")).append(",\n");
    full.append("  ").append(q("serverJarSha1")).append(":").append(q(need("meta.jarSha1"))).append(",\n");
    full.append("  ").append(q("bundledServerJarSha1")).append(":").append(q(need("meta.innerJarSha1"))).append(",\n");
    full.append("  ").append(q("mappingsUrl")).append(":").append(q(need("meta.mappingsUrl"))).append(",\n");
    full.append("  ").append(q("mappingsSha1")).append(":").append(q(need("meta.mappingsSha1"))).append(",\n");
    full.append("  ").append(q("java")).append(":").append(q(need("meta.java"))).append(",\n");
    full.append("  ").append(q("generator")).append(":").append(q("_scratch/mclite/ng_dump.js + NoiseDump.java, MineHTML jobs lane")).append(",\n");
    full.append("  ").append(q("generatedAt")).append(":").append(q(java.time.Instant.now().toString())).append(",\n");
    full.append("  ").append(q("obfuscatedNames")).append(":{");
    boolean first = true;
    for (String k : new TreeSet<>(props.stringPropertyNames())) {
      if (!k.startsWith("class.")) continue;
      if (!first) full.append(",");
      full.append(q(k.substring(6))).append(":").append(q(props.getProperty(k)));
      first = false;
    }
    full.append("},\n");
    full.append("  ").append(q("notes")).append(":[");
    for (int i = 0; i < notes.size(); i++) { if (i > 0) full.append(","); full.append(q(notes.get(i))); }
    full.append("]\n },\n");
    full.append(" ").append(q("cases")).append(":[\n").append(J).append("\n ]\n}\n");
    Files.write(out, full.toString().getBytes(StandardCharsets.UTF_8));
    System.out.println("[NoiseDump] " + caseCount + " cases, " + valueCount + " values -> " + out);
    for (String n : notes) System.out.println("[NoiseDump] note: " + n);
  }

  // ── 1. the raw Xoroshiro stream ──────────────────────────────────────────────────────
  static void dumpXoroshiro() throws Exception {
    for (long seed : SEEDS) {
      long[] w = seedWords(xoro(seed));
      emit(q("id") + ":" + q("xoro.seedWords." + seed) + "," + q("kind") + ":" + q("xoro.seedWords")
         + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("from") + ":" + q("new XoroshiroRandomSource(seed) -> its two private 64-bit words")
         + "," + q("values") + ":" + arrL(w), 2);

      long[] ln = new long[8]; Object s = xoro(seed);
      for (int i = 0; i < 8; i++) ln[i] = (Long) mNextLong.invoke(s);
      emit(q("id") + ":" + q("xoro.nextLong." + seed) + "," + q("kind") + ":" + q("xoro.stream")
         + "," + q("op") + ":" + q("nextLong") + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("values") + ":" + arrL(ln), 8);

      int[] iv = new int[8]; s = xoro(seed);
      for (int i = 0; i < 8; i++) iv[i] = (Integer) mNextInt0.invoke(s);
      emit(q("id") + ":" + q("xoro.nextInt." + seed) + "," + q("kind") + ":" + q("xoro.streamInt")
         + "," + q("op") + ":" + q("nextInt") + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("values") + ":" + arrI(iv), 8);

      int[] bv = new int[BOUNDS.length]; s = xoro(seed);
      for (int i = 0; i < BOUNDS.length; i++) bv[i] = (Integer) mNextInt1.invoke(s, BOUNDS[i]);
      emit(q("id") + ":" + q("xoro.nextIntBounded." + seed) + "," + q("kind") + ":" + q("xoro.nextIntBounded")
         + "," + q("seed") + ":" + q(Long.toString(seed)) + "," + q("bounds") + ":" + arrI(BOUNDS)
         + "," + q("note") + ":" + q("one draw per bound, in order, from ONE source: the rejection loop's state cost is part of the answer")
         + "," + q("values") + ":" + arrI(bv), BOUNDS.length);

      double[] dv = new double[8]; s = xoro(seed);
      for (int i = 0; i < 8; i++) dv[i] = (Double) mNextDouble.invoke(s);
      emit(q("id") + ":" + q("xoro.nextDouble." + seed) + "," + q("kind") + ":" + q("xoro.stream")
         + "," + q("op") + ":" + q("nextDouble") + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("values") + ":" + arrD(dv), 8);

      double[] fv = new double[4]; s = xoro(seed);
      for (int i = 0; i < 4; i++) fv[i] = ((Float) mNextFloat.invoke(s)).doubleValue();
      emit(q("id") + ":" + q("xoro.nextFloat." + seed) + "," + q("kind") + ":" + q("xoro.stream")
         + "," + q("op") + ":" + q("nextFloat") + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("note") + ":" + q("Java float widened to double; the value is exact in both")
         + "," + q("values") + ":" + arrD(fv), 4);
    }
  }

  // ── 2. forkPositional: MD5 seeding and Mth.getSeed ───────────────────────────────────
  static final String[] HASH_NAMES = {
    "minecraft:temperature","minecraft:vegetation","minecraft:surface_swamp",
    "octave_-10","octave_0","octave_3","","a"
  };
  /**
   * ⚠ D-235 — THE WIDTH LADDER. D-229 found `Mth.getSeed` disagreeing from x = ±687 outwards and
   * nowhere before it, with a check suite whose positions were (0,0,0), (1,2,3) and (16,255,16).
   * These are chosen so that no arithmetic width can hide: either side of ±687 (the last product
   * `x * 3129871` that fits in an int), either side of ±2^20 and ±2^24, the million-block
   * distances `soakcheck` flies to, the world border at ±29,999,984, and the int extremes where
   * a 32-bit wrap and a 64-bit one are furthest apart. y sweeps −64..320 and both extremes too.
   */
  static final int[][] POSITIONS = {
    {0,0,0},{1,2,3},{-1,-1,-1},{16,255,16},{0,-64,0},{0,320,0},
    {686,0,686},{687,0,687},{-686,0,-686},{-687,0,-687},{688,-64,-688},{-688,320,688},
    {1000,64,-1000},{-77777,-64,88888},{4096,0,-4096},
    {1048575,64,-1048577},{1048576,0,1048576},{-1048576,0,-1048576},
    {16777215,320,16777217},{16777216,-64,-16777216},{-16777217,0,16777215},
    {1000000,64,1000000},{-1000000,64,-1000000},{1234567,0,-7654321},
    {29999984,0,29999984},{-29999984,0,-29999984},{29999983,-64,-29999983},
    {2147483647,0,-2147483648},{-2147483648,0,2147483647},
    {2147483647,2147483647,2147483647},{-2147483648,-2147483648,-2147483648},
    {715827883,0,715827883},{-715827883,0,-715827883},{3129871,0,116129781}
  };
  static void dumpFork() throws Exception {
    for (long seed : new long[]{ 1337L, -4172144997902289642L }) {
      Object f = mFork.invoke(xoro(seed));
      for (String name : HASH_NAMES) {
        Object s = mFromHash.invoke(f, name);
        long[] w = seedWords(s);
        long[] v = new long[]{ w[0], w[1], (Long) mNextLong.invoke(s), (Long) mNextLong.invoke(s) };
        emit(q("id") + ":" + q("fork.fromHashOf." + seed + "." + (name.isEmpty() ? "<empty>" : name))
           + "," + q("kind") + ":" + q("fork.fromHashOf")
           + "," + q("seed") + ":" + q(Long.toString(seed)) + "," + q("name") + ":" + q(name)
           + "," + q("layout") + ":" + q("[seedLo, seedHi, nextLong, nextLong]")
           + "," + q("values") + ":" + arrL(v), 4);
      }
      for (int[] p : POSITIONS) {
        Object s = mAt.invoke(f, p[0], p[1], p[2]);
        long[] w = seedWords(s);
        long[] v = new long[]{ w[0], w[1], (Long) mNextLong.invoke(s), (Long) mNextLong.invoke(s) };
        emit(q("id") + ":" + q("fork.at." + seed + "." + p[0] + "_" + p[1] + "_" + p[2])
           + "," + q("kind") + ":" + q("fork.at")
           + "," + q("seed") + ":" + q(Long.toString(seed)) + "," + q("pos") + ":" + arrI(p)
           + "," + q("layout") + ":" + q("[seedLo, seedHi, nextLong, nextLong]")
           + "," + q("values") + ":" + arrL(v), 4);
      }
    }
    long[] gs = new long[POSITIONS.length];
    StringBuilder ps = new StringBuilder("[");
    for (int i = 0; i < POSITIONS.length; i++) {
      gs[i] = (Long) mGetSeed.invoke(null, POSITIONS[i][0], POSITIONS[i][1], POSITIONS[i][2]);
      if (i > 0) ps.append(",");
      ps.append(arrI(POSITIONS[i]));
    }
    ps.append("]");
    emit(q("id") + ":" + q("mth.getSeed") + "," + q("kind") + ":" + q("mth.getSeed")
       + "," + q("points") + ":" + ps + "," + q("values") + ":" + arrL(gs), gs.length);
  }

  // ── 3. LegacyRandomSource (java.util.Random) ─────────────────────────────────────────
  static final int[] LEGACY_BOUNDS = { 2, 4, 7, 16, 100, 256, 262, 1000 };
  static void dumpLegacy() throws Exception {
    for (long seed : LEGACY_SEEDS) {
      Object fresh = legacy(seed);
      long scrambled = ((java.util.concurrent.atomic.AtomicLong) fLegacySeed.get(fresh)).get();
      emit(q("id") + ":" + q("legacy.scrambledSeed." + seed) + "," + q("kind") + ":" + q("legacy.scrambledSeed")
         + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("from") + ":" + q("new LegacyRandomSource(seed) -> its 48-bit internal seed, (seed ^ 0x5DEECE66D) & ((1<<48)-1)")
         + "," + q("values") + ":" + arrL(new long[]{ scrambled }), 1);
      int[] iv = new int[6]; Object s = legacy(seed);
      for (int i = 0; i < 6; i++) iv[i] = (Integer) mNextInt0.invoke(s);
      emit(q("id") + ":" + q("legacy.nextInt." + seed) + "," + q("kind") + ":" + q("legacy.streamInt")
         + "," + q("op") + ":" + q("nextInt") + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("values") + ":" + arrI(iv), 6);

      int[] bv = new int[LEGACY_BOUNDS.length]; s = legacy(seed);
      for (int i = 0; i < LEGACY_BOUNDS.length; i++) bv[i] = (Integer) mNextInt1.invoke(s, LEGACY_BOUNDS[i]);
      emit(q("id") + ":" + q("legacy.nextIntBounded." + seed) + "," + q("kind") + ":" + q("legacy.nextIntBounded")
         + "," + q("seed") + ":" + q(Long.toString(seed)) + "," + q("bounds") + ":" + arrI(LEGACY_BOUNDS)
         + "," + q("note") + ":" + q("power-of-two bounds take java.util.Random's OTHER branch and must not agree by accident")
         + "," + q("values") + ":" + arrI(bv), LEGACY_BOUNDS.length);

      double[] dv = new double[6]; s = legacy(seed);
      for (int i = 0; i < 6; i++) dv[i] = (Double) mNextDouble.invoke(s);
      emit(q("id") + ":" + q("legacy.nextDouble." + seed) + "," + q("kind") + ":" + q("legacy.stream")
         + "," + q("op") + ":" + q("nextDouble") + "," + q("seed") + ":" + q(Long.toString(seed))
         + "," + q("values") + ":" + arrD(dv), 6);
    }
  }

  // ── 3b. THE BOUNDED DRAW'S REJECTION LOOP, FORCED (D-235) ────────────────────────────
  //
  // ⚠ Every bounded-draw case above draws from an ordinary seed, and BOTH bounded draws in this
  // stack reject with probability of order bound / 2^31 — about one in ten million for the
  // bounds the game actually uses. So "the rejection loop agrees", which D-229 recorded as
  // proved, was a claim about a branch no golden value had ever entered. These cases are
  // CONSTRUCTED to enter it.
  //
  // ⚠ The number of draws the real game consumed is MEASURED, with Mojang's own API and nothing
  // else: run the bounded call on one source, then run k plain draws on a fresh source from the
  // same seed and compare the internal state. Neither generator is reimplemented here, and the
  // count travels in the dump so the check can PROVE the branch was taken rather than assume it.

  static final long JR_MUL = 0x5DEECE66DL, JR_ADD = 0xBL, JR_MASK = (1L << 48) - 1;
  static final int[] LEGACY_REJECT_BOUNDS = { 3, 5, 7, 12, 100, 253, 262, 1000 };
  // ⚠ Xoroshiro's bounded draw rejects with probability (2^32 mod bound) / 2^32, which for a
  // small bound is one in billions and cannot be reached by search: for bound 3 the ONLY 32-bit
  // draw that rejects is zero. These four bounds put the branch within reach (p from 0.17 to
  // 0.33) — the branch is what is being fenced, not the bound.
  static final int[] XORO_REJECT_BOUNDS = { 1431655766, 1073741825, 858993460, 715827883 };

  static long legacyState(Object src) throws Exception {
    return ((java.util.concurrent.atomic.AtomicLong) fLegacySeed.get(src)).get();
  }
  /** How many draws nextInt(bound) consumed; fills out[] with {value, stateAfter}. */
  static int legacyDraws(long seed, int bound, long[] out) throws Exception {
    Object a = legacy(seed);
    int value = (Integer) mNextInt1.invoke(a, bound);
    long after = legacyState(a);
    out[0] = value; out[1] = after;
    for (int k = 1; k <= 8; k++) {
      Object b = legacy(seed);
      for (int i = 0; i < k; i++) mNextInt0.invoke(b);
      if (legacyState(b) == after) return k;
    }
    return -1;
  }
  /** The 48-bit LCG multiplier inverted mod 2^48, so a desired first draw can be run backwards. */
  static long invMul48() {
    long x = 1;
    for (int i = 0; i < 6; i++) x = x * (2 - JR_MUL * x);
    return x & JR_MASK;
  }
  /**
   * A constructor seed whose FIRST next(31) lands in java.util.Random's rejection window —
   * found by inverting the LCG, then CONFIRMED by measuring the draw count.
   */
  static Long legacyRejectSeed(int bound) throws Exception {
    long r = (1L << 31) % bound;
    if (r == 0) return null;                       // a power-of-two bound takes the other branch
    long inv = invMul48();
    long[] out = new long[2];
    for (long bits = (1L << 31) - r; bits < (1L << 31); bits++) {
      for (long low = 0; low < 8; low++) {
        long s1 = ((bits << 17) | low) & JR_MASK;
        long seed = (((s1 - JR_ADD) * inv) & JR_MASK) ^ JR_MUL;
        if (legacyDraws(seed, bound, out) >= 2) return seed;
      }
    }
    return null;
  }
  /** The same measurement for Xoroshiro; fills out[] with {value, wordLoAfter, wordHiAfter}. */
  static int xoroDraws(long seed, int bound, long[] out) throws Exception {
    Object a = xoro(seed);
    int value = (Integer) mNextInt1.invoke(a, bound);
    long[] after = seedWords(a);
    out[0] = value; out[1] = after[0]; out[2] = after[1];
    for (int k = 1; k <= 8; k++) {
      Object b = xoro(seed);
      for (int i = 0; i < k; i++) mNextLong.invoke(b);
      long[] w = seedWords(b);
      if (w[0] == after[0] && w[1] == after[1]) return k;
    }
    return -1;
  }
  static Long xoroRejectSeed(int bound) throws Exception {
    long[] out = new long[3];
    for (long seed = 1; seed <= 4000000L; seed++) if (xoroDraws(seed, bound, out) >= 2) return seed;
    return null;
  }
  static void dumpBoundedRejection() throws Exception {
    for (int bound : LEGACY_REJECT_BOUNDS) {
      Long seed = legacyRejectSeed(bound);
      if (seed == null) { notes.add("no LegacyRandomSource seed forces the rejection loop for bound " + bound); continue; }
      long[] out = new long[2];
      int draws = legacyDraws(seed, bound, out);
      emit(q("id") + ":" + q("legacy.nextIntReject." + bound) + "," + q("kind") + ":" + q("legacy.nextIntReject")
         + "," + q("seed") + ":" + q(Long.toString(seed)) + "," + q("bound") + ":" + bound
         + "," + q("drawsConsumed") + ":" + draws
         + "," + q("layout") + ":" + q("[nextInt(bound), the 48-bit internal seed afterwards]")
         + "," + q("note") + ":" + q("constructed so java.util.Random's bits - val + (bound-1) < 0 overflow test fires; "
             + "an implementation that evaluates that test in doubles never rejects and answers the FIRST candidate")
         + "," + q("values") + ":" + arrL(out), 2);
    }
    for (int bound : XORO_REJECT_BOUNDS) {
      Long seed = xoroRejectSeed(bound);
      if (seed == null) { notes.add("no XoroshiroRandomSource seed under 4e6 forces the rejection loop for bound " + bound); continue; }
      long[] out = new long[3];
      int draws = xoroDraws(seed, bound, out);
      emit(q("id") + ":" + q("xoro.nextIntReject." + bound) + "," + q("kind") + ":" + q("xoro.nextIntReject")
         + "," + q("seed") + ":" + q(Long.toString(seed)) + "," + q("bound") + ":" + bound
         + "," + q("drawsConsumed") + ":" + draws
         + "," + q("layout") + ":" + q("[nextInt(bound), seedLo afterwards, seedHi afterwards]")
         + "," + q("note") + ":" + q("Lemire's multiply-shift rejects when the low 32 bits of the product fall under "
             + "2^32 mod bound; these bounds put that inside reach of a search, small ones do not")
         + "," + q("values") + ":" + arrL(out), 3);
    }
  }

  // ── 4. ImprovedNoise ─────────────────────────────────────────────────────────────────
  static void dumpImproved() throws Exception {
    Object[][] sources = {
      { "xoro:1337/forkPositional/fromHashOf(octave_-3)",
        mFromHash.invoke(mFork.invoke(xoro(1337L)), "octave_-3") },
      { "legacy:1234", legacy(1234L) },
      { "xoro:-4172144997902289642/forkPositional/fromHashOf(minecraft:temperature)",
        mFromHash.invoke(mFork.invoke(xoro(-4172144997902289642L)), "minecraft:temperature") },
    };
    for (Object[] src : sources) {
      Object noise = kImproved.newInstance(src[1]);
      double[] origins = { fIxo.getDouble(noise), fIyo.getDouble(noise), fIzo.getDouble(noise) };
      emit(q("id") + ":" + q("improved.origins." + src[0]) + "," + q("kind") + ":" + q("improved.origins")
         + "," + q("source") + ":" + q((String) src[0])
         + "," + q("layout") + ":" + q("[xo, yo, zo] — three nextDouble()*256 in that order")
         + "," + q("values") + ":" + arrD(origins), 3);
      double[] v = new double[P3.length];
      for (int i = 0; i < P3.length; i++) v[i] = (Double) mImprovedNoise.invoke(noise, P3[i][0], P3[i][1], P3[i][2]);
      emit(q("id") + ":" + q("improved.noise." + src[0]) + "," + q("kind") + ":" + q("improved.noise")
         + "," + q("source") + ":" + q((String) src[0])
         + "," + q("points") + ":" + pts3(P3) + "," + q("values") + ":" + arrD(v), v.length);
    }
  }

  // ── 5. PerlinNoise and NormalNoise, on the real worldgen/noise parameters ────────────
  static boolean bootstrapped = false;
  static void ensureBootstrapped() throws Exception {
    if (bootstrapped) return;
    if (has("m.SharedConstants.tryDetectVersion0")) M("SharedConstants.tryDetectVersion0").invoke(null);
    if (has("m.Bootstrap.bootStrap0")) M("Bootstrap.bootStrap0").invoke(null);
    bootstrapped = true;
  }
  /**
   * The sixty noise parameter sets, read out of `BuiltinRegistries.NOISE`.
   * ⚠ 1.18.2's server jar ships no `data/minecraft/worldgen/noise/*.json`: those files are an
   * EXPORT of this registry, not its source. Reading the registry is the only route, and the
   * amplitudes recorded beside each golden value therefore come from the game itself — which
   * makes them worth checking against MC-Lite's own packed copy as well as the values.
   */
  static double[] readParams(String name, int[] firstOctaveOut) throws Exception {
    ensureBootstrapped();
    Object registry = F("BuiltinRegistries.NOISE").get(null);
    Object loc = K("ResourceLocation.string").newInstance("minecraft:" + name);
    Object params = M("Registry.getByLocation").invoke(registry, loc);
    if (params == null) return null;
    firstOctaveOut[0] = F("NoiseParameters.firstOctave").getInt(params);
    Object list = F("NoiseParameters.amplitudes").get(params);
    return (double[]) list.getClass().getMethod("toDoubleArray").invoke(list);
  }
  static Object makePerlin(Object rnd, int firstOctave, double[] amps) throws Exception {
    if (has("m.PerlinNoise.createArr")) return M("PerlinNoise.createArr").invoke(null, rnd, firstOctave, amps);
    Object list = Class.forName("it.unimi.dsi.fastutil.doubles.DoubleArrayList")
      .getMethod("wrap", double[].class).invoke(null, (Object) amps);
    return M("PerlinNoise.createList").invoke(null, rnd, firstOctave, list);
  }
  static Object makeNormal(Object rnd, int firstOctave, double[] amps) throws Exception {
    if (has("m.NormalNoise.createArr")) return M("NormalNoise.createArr").invoke(null, rnd, firstOctave, amps);
    Object list = Class.forName("it.unimi.dsi.fastutil.doubles.DoubleArrayList")
      .getMethod("wrap", double[].class).invoke(null, (Object) amps);
    return M("NormalNoise.createParams").invoke(null, rnd, kNoiseParams.newInstance(firstOctave, list));
  }
  static String octaveOrigins(Object stack) throws Exception {
    Object levels = fPLevels.get(stack);
    int n = Array.getLength(levels);
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) b.append(",");
      Object lv = Array.get(levels, i);
      if (lv == null) b.append("null");
      else b.append(arrD(new double[]{ fIxo.getDouble(lv), fIyo.getDouble(lv), fIzo.getDouble(lv) }));
    }
    return b.append("]").toString();
  }
  static void dumpPerlinAndNormal() throws Exception {
    long[] worldSeeds = { 1337L, -4172144997902289642L };
    Set<String> secondSeedNoises = new HashSet<>(Arrays.asList("temperature", "continentalness", "surface_swamp", "jagged"));
    List<String> names = allNoiseNames();
    for (long ws : worldSeeds) {
      for (String name : names) {
        if (ws != 1337L && !secondSeedNoises.contains(name)) continue;
        int[] fo = new int[1];
        double[] amps = readParams(name, fo);
        if (amps == null) { notes.add("worldgen/noise/" + name + ".json not found in the jar — skipped"); continue; }
        String id = "minecraft:" + name;
        if (ws == 1337L && DEEP.contains(name)) {
          Object rnd = mFromHash.invoke(mFork.invoke(xoro(ws)), id);
          Object stack = makePerlin(rnd, fo[0], amps);
          double[] v = new double[PN.length];
          for (int i = 0; i < PN.length; i++) v[i] = (Double) mPerlinGet.invoke(stack, PN[i][0], PN[i][1], PN[i][2]);
          emit(q("id") + ":" + q("perlin." + name + "." + ws) + "," + q("kind") + ":" + q("perlin.stack")
             + "," + q("worldSeed") + ":" + q(Long.toString(ws)) + "," + q("noiseId") + ":" + q(id)
             + "," + q("firstOctave") + ":" + fo[0] + "," + q("amplitudes") + ":" + arrD(amps)
             + "," + q("inputFactor") + ":" + num(fPIn.getDouble(stack))
             + "," + q("valueFactor") + ":" + num(fPVal.getDouble(stack))
             + "," + q("octaveOrigins") + ":" + octaveOrigins(stack)
             + "," + q("points") + ":" + pts3(PN) + "," + q("values") + ":" + arrD(v),
             v.length + 2 + Array.getLength(fPLevels.get(stack)) * 3);
        }
        Object rnd2 = mFromHash.invoke(mFork.invoke(xoro(ws)), id);
        Object nn = makeNormal(rnd2, fo[0], amps);
        double[] v = new double[PN.length];
        for (int i = 0; i < PN.length; i++) v[i] = (Double) mNormalGet.invoke(nn, PN[i][0], PN[i][1], PN[i][2]);
        String maxv = has("m.NormalNoise.maxValue0") ? num((Double) M("NormalNoise.maxValue0").invoke(nn)) : "null";
        emit(q("id") + ":" + q("normal." + name + "." + ws) + "," + q("kind") + ":" + q("normal.noise")
           + "," + q("worldSeed") + ":" + q(Long.toString(ws)) + "," + q("noiseId") + ":" + q(id)
           + "," + q("firstOctave") + ":" + fo[0] + "," + q("amplitudes") + ":" + arrD(amps)
           + "," + q("valueFactor") + ":" + num(fNVal.getDouble(nn))
           + "," + q("maxValue") + ":" + maxv
           + "," + q("firstStackOrigins") + ":" + (ws == 1337L && DEEP.contains(name) ? octaveOrigins(fNFirst.get(nn)) : "null")
           + "," + q("secondStackOrigins") + ":" + (ws == 1337L && DEEP.contains(name) ? octaveOrigins(fNSecond.get(nn)) : "null")
           + "," + q("points") + ":" + pts3(PN) + "," + q("values") + ":" + arrD(v), v.length + 2);
      }
    }
  }

  // ── 6. PerlinSimplexNoise — Biome's three fixed-seed statics, read off the real fields ─
  static String levelOrigins(Object ps) throws Exception {
    Object levels = fPsLevels.get(ps);
    int n = Array.getLength(levels);
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < n; i++) {
      if (i > 0) b.append(",");
      Object lv = Array.get(levels, i);
      if (lv == null) b.append("null");
      else b.append(arrD(new double[]{ fSxo.getDouble(lv), fSyo.getDouble(lv), fSzo.getDouble(lv) }));
    }
    return b.append("]").toString();
  }
  static void emitPs(String id, String source, long seed, int[] octaves, Object ps) throws Exception {
    double[] v = new double[P2.length * 2];
    StringBuilder pts = new StringBuilder("[");
    int k = 0;
    for (int off = 0; off < 2; off++) {
      boolean useOffsets = off == 1;
      for (double[] p : P2) {
        v[k] = (Double) mPsGet.invoke(ps, p[0], p[1], useOffsets);
        if (k > 0) pts.append(",");
        pts.append("[").append(num(p[0])).append(",").append(num(p[1])).append(",").append(useOffsets).append("]");
        k++;
      }
    }
    pts.append("]");
    emit(q("id") + ":" + q(id) + "," + q("kind") + ":" + q("perlinSimplex")
       + "," + q("source") + ":" + q(source)
       + "," + q("legacySeed") + ":" + q(Long.toString(seed))
       + "," + q("octaves") + ":" + (octaves == null ? "null" : arrI(octaves))
       + "," + q("levelCount") + ":" + Array.getLength(fPsLevels.get(ps))
       + "," + q("inputFactor") + ":" + num(fPsIn.getDouble(ps))
       + "," + q("valueFactor") + ":" + num(fPsVal.getDouble(ps))
       + "," + q("levelOrigins") + ":" + levelOrigins(ps)
       + "," + q("points") + ":" + pts + "," + q("note") + ":" + q("points are [x, y, useOffsets]")
       + "," + q("values") + ":" + arrD(v), v.length + 2);
  }
  static Object mkPs(long seed, int[] octaves) throws Exception {
    List<Integer> list = new ArrayList<>();
    for (int o : octaves) list.add(o);
    Object src = legacy(seed);
    if (kWorldgen != null) { try { src = kWorldgen.newInstance(src); } catch (Throwable t) { notes.add("WorldgenRandom wrapper unusable: " + t); } }
    else notes.add("WorldgenRandom not resolved — the reconstructions use LegacyRandomSource bare");
    return kPerlinSimplex.newInstance(src, list);
  }
  static void dumpPerlinSimplex() throws Exception {
    // (a) the reconstructions — the construction MC-Lite claims vanilla performs
    emitPs("perlinSimplex.rebuilt.BIOME_INFO_NOISE", "new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(2345)), [0])", 2345L, new int[]{0}, mkPs(2345L, new int[]{0}));
    emitPs("perlinSimplex.rebuilt.TEMPERATURE_NOISE", "new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(1234)), [0])", 1234L, new int[]{0}, mkPs(1234L, new int[]{0}));
    emitPs("perlinSimplex.rebuilt.FROZEN_TEMPERATURE_NOISE", "new PerlinSimplexNoise(new WorldgenRandom(new LegacyRandomSource(3456)), [-2,-1,0])", 3456L, new int[]{-2,-1,0}, mkPs(3456L, new int[]{-2,-1,0}));
    // and the octave list MC-Lite got WRONG for five sessions (D-219), kept as a negative control
    emitPs("perlinSimplex.wrongOctaves.FROZEN_TEMPERATURE_NOISE", "the pre-D-219 list, kept so the check can prove it is NOT what vanilla has", 3456L, new int[]{-3,-2,-1}, mkPs(3456L, new int[]{-3,-2,-1}));

    // (b) the REAL statics off Biome itself. This is the column that settles the octave lists.
    try {
      // Biome's own static initialiser builds registry-backed Codecs, so the game has to be
      // bootstrapped before the three noise statics can be read.
      ensureBootstrapped();
      Class<?> biome = C("Biome");
      Object bi = F("Biome.BIOME_INFO_NOISE").get(null);
      Object te = F("Biome.TEMPERATURE_NOISE").get(null);
      Object fr = F("Biome.FROZEN_TEMPERATURE_NOISE").get(null);
      emitPs("perlinSimplex.biomeStatic.BIOME_INFO_NOISE", "Biome.BIOME_INFO_NOISE (the real static field)", 2345L, null, bi);
      emitPs("perlinSimplex.biomeStatic.TEMPERATURE_NOISE", "Biome.TEMPERATURE_NOISE (the real static field)", 1234L, null, te);
      emitPs("perlinSimplex.biomeStatic.FROZEN_TEMPERATURE_NOISE", "Biome.FROZEN_TEMPERATURE_NOISE (the real static field)", 3456L, null, fr);
      notes.add("Biome's static PerlinSimplexNoise fields were read directly from the class; octave lists are proved by value, not by memory.");
    } catch (Throwable t) {
      notes.add("Biome statics unavailable (" + t + ") — only the reconstructions are present.");
    }
  }
}
