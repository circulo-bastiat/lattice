// SeedAgent: -javaagent that pins java.util.Random's no-arg constructor. Random() is `this(seedUniquifier() ^ System.nanoTime())`;
// the agent rewrites the nanoTime call to the constant -Dmclite.lockstep.salt (default 0), so the seed is a pure function of
// construction ORDER (seedUniquifier is a CAS counter). Uses the JDK-internal ASM (needs --add-exports, see run.mjs).
import java.lang.instrument.*;
import java.security.ProtectionDomain;
import java.util.Random;
import jdk.internal.org.objectweb.asm.*;

public class SeedAgent {
  static final long SALT = Long.getLong("mclite.lockstep.salt", 0L);
  // per-THREAD construction counter: the seed is a function of (thread name, how many Randoms that thread built), so a
  // Random built on "Server thread" no longer depends on how the other threads interleaved.
  // seed = f(thread name, class that called `new Random()`, how many Randoms that (thread, class) pair built): a Random built
  // by Entity.<init> on "Server thread" no longer depends on how many Randoms OTHER classes/threads built before it.
  static final ThreadLocal<java.util.HashMap<String, long[]>> COUNT = ThreadLocal.withInitial(java.util.HashMap::new);
  // #6223: -Dmclite.lockstep.nohook=1 leaves ThreadLocalRandom / Math.random un-hooked (the check's "hook disabled must fail" break).
  // -Dmclite.lockstep.log=<file> appends one line per first (source, thread, class) seen, with ms since the agent started: the call
  // sites that fire between summon and tick 40, to be read next to the trace.
  static final String LOG = System.getProperty("mclite.lockstep.log");
  static final long T0 = System.nanoTime();
  static final java.util.HashSet<String> LOGSEEN = new java.util.HashSet<>();
  static final ThreadLocal<boolean[]> BUSY = ThreadLocal.withInitial(() -> new boolean[1]);
  static void note(String src, String key) {
    if (LOG == null) return;
    boolean[] b = BUSY.get(); if (b[0]) return; b[0] = true;
    try {
      synchronized (LOGSEEN) {
        if (!LOGSEEN.add(src + "|" + key)) return;
        try (java.io.FileWriter w = new java.io.FileWriter(LOG, true)) { w.write((System.nanoTime() - T0) / 1000000 + "ms " + src + " " + key + "\n"); } catch (java.io.IOException e) { }
      }
    } finally { b[0] = false; }
  }
  // #6224: -Dmclite.lockstep.logall=true also writes EVERY draw (source thread class #nth), to find which counter drifts between runs.
  static void logAll(String line) {
    boolean[] b = BUSY.get(); if (b[0]) return; b[0] = true;
    try { synchronized (LOGSEEN) { try (java.io.FileWriter w = new java.io.FileWriter(LOG, true)) { w.write(line + "\n"); } catch (java.io.IOException e) { } } }
    finally { b[0] = false; }
  }
  // #6225: -Dmclite.lockstep.reset=<file>: when the file's content changes (runchase writes the rep number before each rep) every
  // thread's counters restart, so rep N in one process reproduces rep 0. Absent property = old behaviour.
  static final String RESET = System.getProperty("mclite.lockstep.reset");
  static volatile String gen = "";
  static final ThreadLocal<String> SEEN = ThreadLocal.withInitial(() -> "");
  // #6259: 'RNG <tick> <seed>,..' -- the 48-bit seed of each given Random, read by reflection (java.util.Random.seed is an AtomicLong)
  public static String rngLine(long tick, Object... randoms) {
    StringBuilder sb = new StringBuilder("RNG " + tick + " ");
    try {
      java.lang.reflect.Field f = Random.class.getDeclaredField("seed"); f.setAccessible(true);
      for (int i = 0; i < randoms.length; i++) sb.append(i > 0 ? "," : "").append(((java.util.concurrent.atomic.AtomicLong) f.get(randoms[i])).get());
    } catch (Throwable t) { sb.append("0"); }
    return sb.toString();
  }
  // #6382: 'ENT <tick> <type> <x> <y> <z> <size>' -- one line per server entity walked by the capture (ServerWorld.iterateEntities); size = Slime.getSize, -1 for others
  public static String entLine(long tick, String type, double x, double y, double z, int size) {
    return "ENT " + tick + " " + type + " " + x + " " + y + " " + z + " " + size;
  }
  // #6293: 'BLK <tick> <x> <y> <z> <old> <new>' -- one line per block whose state differs in the arena snapshot diff; states are registry name[props] strings
  public static String blkLine(long tick, int x, int y, int z, String oldState, String newState) {
    return "BLK " + tick + " " + x + " " + y + " " + z + " " + oldState + " " + newState;
  }
  // #6358: 'ENTX <tick> <type> <id> <conv> <effects>' -- id = entity id, conv = conversion countdown (ZombieVillager.conversionTime, drowned/husk/piglin timers; -1 none),
  // effects = 'effId:amp:dur,..' sorted by effId or '-'. effects is int[3] triples {id, amplifier, duration}.
  public static String entxLine(long tick, String type, int id, int conv, int[][] effects) {
    StringBuilder e = new StringBuilder();
    java.util.Arrays.sort(effects, (p, q) -> Integer.compare(p[0], q[0]));
    for (int[] f : effects) e.append(e.length() > 0 ? "," : "").append(f[0]).append(':').append(f[1]).append(':').append(f[2]);
    return "ENTX " + tick + " " + type + " " + id + " " + conv + " " + (e.length() > 0 ? e : "-");
  }
  static void checkReset() {
    if (RESET == null) return;
    try { gen = new String(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(RESET))); } catch (java.io.IOException e) { return; }
    if (!gen.equals(SEEN.get())) { SEEN.set(gen); COUNT.get().clear(); }
  }
  // #6224: the miss-vs-hit diff of the per-(thread,class) log showed pool threads ("Worker-Main-6" in one run, "-10" in the next:
  // which worker runs a chunk-gen task is scheduler timing) and java.* helper frames (Collections.shuffle: one shared counter that
  // chunk work run inline shifts) as the seeds' leaking inputs. -Dmclite.lockstep.noleakfix=true restores both (the check's break).
  static final boolean LEAKFIX = !Boolean.getBoolean("mclite.lockstep.noleakfix");
  static String tname() { String n = Thread.currentThread().getName(); return LEAKFIX ? n.replaceAll("[0-9]+$", "#") : n; }
  static long next(String src) {
    checkReset();
    String cls = StackWalker.getInstance().walk(f -> f.map(StackWalker.StackFrame::getClassName)
        .filter(c -> !c.equals("SeedAgent") && !(LEAKFIX && c.startsWith("java.")) && !c.equals("java.util.Random") && !c.equals("java.lang.Math") && !c.equals("java.util.concurrent.ThreadLocalRandom")).findFirst().orElse("?"));
    // Entity (axk) / LivingEntity (axy) constructors draw for EVERY entity on the thread, incl. worldgen and chunk-load mobs, whose
    // number on the Server thread depends on whether chunk work ran inline or on a worker. A mob built by /summon (SummonCommand,
    // acd) gets its own counter: its seed is the nth SUMMONED entity, not the nth entity.
    if (LEAKFIX && (cls.equals("axk") || cls.equals("axy")) && StackWalker.getInstance().walk(f -> f.anyMatch(x -> x.getClassName().equals("acd")))) cls = "summon|" + cls;
    String key = tname() + "|" + cls;
    // #7440: the same draws are keyed by the CONCRETE entity class (outermost <init> of the constructor chain) and no thread
    if (LEAKFIX && (cls.equals("axk") || cls.equals("axy") || cls.equals("summon|axk") || cls.equals("summon|axy"))) {
      String conc = StackWalker.getInstance().walk(f -> { String last = null; boolean in = false;
        for (java.util.Iterator<StackWalker.StackFrame> it = f.iterator(); it.hasNext();) { StackWalker.StackFrame x = it.next();
          if (x.getClassName().equals("SeedAgent")) continue;
          if (x.getMethodName().equals("<init>")) { in = true; last = x.getClassName(); } else if (in) break; }
        return last; });
      if (conc != null) key = "ent|" + (cls.startsWith("summon|") ? "summon|" : (tname().startsWith("Server") ? "" : tname() + "|")) + conc;   // #7541: worldgen mobs (villagers) built on pool workers no longer share the server thread's per-class counter
    }
    note(src, key);
    long n = ++COUNT.get().computeIfAbsent(src + key, k -> new long[1])[0];
    if (LOG != null && Boolean.getBoolean("mclite.lockstep.logall")) logAll(src + " " + key + " #" + n);
    long x = ((long) (src + key).hashCode() << 32) ^ n ^ SALT;
    x = (x ^ (x >>> 30)) * 0xbf58476d1ce4e5b9L; x = (x ^ (x >>> 27)) * 0x94d049bb133111ebL;
    return x ^ (x >>> 31);
  }
  public static long seed() { return next("Random"); }
  // ThreadLocalRandom.nextSeed() body: the seed it hands out is a function of (thread, class, nth, salt), not of the thread's seed field
  public static long tlrSeed() { return next("TLR"); }
  public static double mathRandom() { return (next("Math.random") >>> 11) * 0x1.0p-53; }
  static byte[] swap(byte[] b, String mname, String desc, String sname, String sdesc, int ret, String flagsNone) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, ClassWriter.COMPUTE_MAXS);
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
        MethodVisitor out = super.visitMethod(acc, n, d, s, e);
        if (!n.equals(mname) || !d.equals(desc)) return out;
        return new MethodVisitor(Opcodes.ASM8, null) {
          public void visitCode() { out.visitCode(); out.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", sname, sdesc, false); out.visitInsn(ret); out.visitMaxs(0, 0); out.visitEnd(); }
        };
      }
    }, 0);
    return cw.toByteArray();
  }
  // UUID.randomUUID() (SecureRandom, unhookable by seed) -> a pure function of (thread, caller class, nth, salt).
  public static java.util.UUID uuid() {
    String cls = StackWalker.getInstance().walk(f -> f.map(StackWalker.StackFrame::getClassName)
        .filter(c -> !c.equals("java.util.UUID") && !c.equals("SeedAgent")).findFirst().orElse("?"));
    String key = "uuid|" + tname() + "|" + cls;
    long n = ++COUNT.get().computeIfAbsent(key, k -> new long[1])[0];
    long x = ((long) key.hashCode() << 32) ^ n ^ SALT;
    long hi = mix(x), lo = mix(hi ^ 0x9e3779b97f4a7c15L);
    hi = (hi & 0xffffffffffff0fffL) | 0x4000L;                 // version 4
    lo = (lo & 0x3fffffffffffffffL) | 0x8000000000000000L;     // IETF variant
    return new java.util.UUID(hi, lo);
  }
  static long mix(long x) { x = (x ^ (x >>> 30)) * 0xbf58476d1ce4e5b9L; x = (x ^ (x >>> 27)) * 0x94d049bb133111ebL; return x ^ (x >>> 31); }
  // #6952: -Dmclite.lockstep.pathlog=<file>: EntityNavigation.tick() (obf bgf.c) is rewritten to call nav(this) first. One line per call:
  // 'PATH <gen> <tick> <x,y,z;...|->' -- gen = the reset file's content (runchase's rep), tick = navigation.tickCount + 1 (= world ticks
  // elapsed once this tick finishes, runchase's Pos index), nodes = getCurrentPath().getNode(i) x,y,z from the node at index 0.
  static final String PATHLOG = System.getProperty("mclite.lockstep.pathlog");
  static java.lang.reflect.Method M_TGT; static java.lang.reflect.Field F_ENT, F_ID; static java.lang.reflect.Method M_PATH, M_LEN, M_NODE; static java.lang.reflect.Field F_TICK, F_X, F_Y, F_Z;
  public static void nav(Object nav) {
    if (PATHLOG == null) return;
    boolean[] b = BUSY.get(); if (b[0]) return; b[0] = true;
    try {
      if (M_PATH == null) {
        Class<?> c = nav.getClass(); while (!c.getName().equals("bgf")) c = c.getSuperclass();
        M_PATH = c.getDeclaredMethod("j"); M_PATH.setAccessible(true);
        F_TICK = c.getDeclaredField("e"); F_TICK.setAccessible(true);
        Class<?> pc = M_PATH.getReturnType();
        M_LEN = pc.getDeclaredMethod("e"); M_NODE = pc.getDeclaredMethod("a", int.class);
        Class<?> nc = M_NODE.getReturnType();
        F_X = nc.getDeclaredField("a"); F_Y = nc.getDeclaredField("b"); F_Z = nc.getDeclaredField("c");
      }
      checkReset();
      Object p = M_PATH.invoke(nav);
      StringBuilder sb = new StringBuilder("PATH " + gen + " " + (F_TICK.getInt(nav) + 1) + " ");
      if (p == null) sb.append('-');
      else for (int i = 0, n = (Integer) M_LEN.invoke(p); i < n; i++) { Object nd = M_NODE.invoke(p, i); sb.append(i > 0 ? ";" : "").append(F_X.getInt(nd)).append(',').append(F_Y.getInt(nd)).append(',').append(F_Z.getInt(nd)); }
      // LANE:blaze #9256: 'TGT <gen> <tick> <id|-1>' = MobEntity.getTarget() (aya.G) entity id (axk.at), same tick index as PATH
      if (M_TGT == null) { M_TGT = Class.forName("aya", false, nav.getClass().getClassLoader()).getDeclaredMethod("G"); M_TGT.setAccessible(true); F_ENT = nav.getClass().getSuperclass().getDeclaredField("a"); F_ENT.setAccessible(true); F_ID = Class.forName("axk", false, nav.getClass().getClassLoader()).getDeclaredField("at"); F_ID.setAccessible(true); }
      Object tg = M_TGT.invoke(F_ENT.get(nav));
      String tl = "TGT " + gen + " " + (F_TICK.getInt(nav) + 1) + " " + (tg == null ? -1 : F_ID.getInt(tg));
      // END LANE
      synchronized (LOGSEEN) { try (java.io.FileWriter w = new java.io.FileWriter(PATHLOG, true)) { w.write(sb + "\n" + tl + "\n"); } }
    } catch (Throwable t) { t.printStackTrace(); }
    finally { b[0] = false; }
  }
  static byte[] hookNav(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, 0);
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
        MethodVisitor mv = super.visitMethod(acc, n, d, s, e);
        if (!n.equals("c") || !d.equals("()V")) return mv;
        return new MethodVisitor(Opcodes.ASM8, mv) {
          public void visitCode() { super.visitCode(); super.visitVarInsn(Opcodes.ALOAD, 0); super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "nav", "(Ljava/lang/Object;)V", false); }
        };
      }
    }, 0);
    return cw.toByteArray();
  }
  // #9358: -Dmclite.lockstep.entxlog=<file>: Entity.tick() (obf axk.k) is rewritten to call entx(this) first. One 'ENTX' line per living entity per call
  // (tick = entity.age + 1; conv = ZombieVillager.conversionTimer bmx.cc / Zombie.ticksUntilWaterConversion bmw.cf / AbstractPiglin.timeInOverworld bne.d /
  // Hoglin.timeInOverworld bmz.ci when > 0 else -1; effects = LivingEntity.activeStatusEffects axy.bS as rawId:amplifier:duration).
  static final String ENTXLOG = System.getProperty("mclite.lockstep.entxlog");
  static Class<?> C_LIV, C_ZV, C_Z, C_PIG, C_HOG; static java.lang.reflect.Field F_AGE, F_EID, F_CV, F_CW, F_CP, F_CH, F_FX, F_ET, F_ED, F_EA;
  static java.lang.reflect.Method M_ETYPE, M_ENAME, M_RAW;
  static int fi(java.lang.reflect.Field f, Object o) throws Exception { return f.getInt(o); }
  // LANE:golemwander #9440: the idle bot player draws World.random twice per game tick (wall-clock many ticks before the arm), so the stream position at the golem's spawn
  // differed between two runs (264 vs 268 draws) and every later stroll differed. The golem's FIRST Entity.tick re-bases World.random to a salt-only seed.
  static final java.util.Set<Object> GOLEMSEEN = java.util.Collections.newSetFromMap(new java.util.WeakHashMap<>());
  static void golemSeed(Object e) {
    if (!e.getClass().getName().equals("bin")) return;
    synchronized (GOLEMSEEN) { if (!GOLEMSEEN.add(e)) return; }
    try {
      java.lang.reflect.Field fw = Class.forName("axk", false, e.getClass().getClassLoader()).getDeclaredField("s"); fw.setAccessible(true);
      long x = (SALT + 0x9E3779B97F4A7C15L) * 0xbf58476d1ce4e5b9L; x ^= x >>> 31;
      worldSeed(fw.get(e)).set((x ^ 0x5DEECE66DL) & ((1L << 48) - 1));
    } catch (Throwable t) { t.printStackTrace(); }
  }
  // END LANE
  // LANE:goat #10219: the idle bot draws World.random a wall-clock-dependent number of times before the arm, so the real server disagreed with itself on most salts.
  // The goat's FIRST Entity.tick re-bases World.random to a salt-only seed (same cure as golemSeed, #9440). -Dmclite.lockstep.rebasegoat=true.
  static final boolean GOATREB = Boolean.getBoolean("mclite.lockstep.rebasegoat");
  static final java.util.Set<Object> GOATSEEN = java.util.Collections.newSetFromMap(new java.util.WeakHashMap<>());
  static void goatSeed(Object e) {
    if (!e.getClass().getName().equals("bjk")) return;
    synchronized (GOATSEEN) { if (!GOATSEEN.add(e)) return; }
    try {
      java.lang.reflect.Field fw = Class.forName("axk", false, e.getClass().getClassLoader()).getDeclaredField("s"); fw.setAccessible(true);
      long x = (SALT + 0x9E3779B97F4A7C15L) * 0xbf58476d1ce4e5b9L; x ^= x >>> 31;
      worldSeed(fw.get(e)).set((x ^ 0x5DEECE66DL) & ((1L << 48) - 1));
    } catch (Throwable t) { t.printStackTrace(); }
  }
  // END LANE
  // LANE:villager #10219: the idle bot draws World.random a wall-clock-dependent number of times before the arm, so the real server disagreed with itself on most salts.
  // The villager's FIRST Entity.tick re-bases World.random to a salt-only seed (same cure as golemSeed, #9440). -Dmclite.lockstep.rebasevillager=true.
  static final boolean VILREB = Boolean.getBoolean("mclite.lockstep.rebasevillager");
  static final java.util.Set<Object> VILSEEN = java.util.Collections.newSetFromMap(new java.util.WeakHashMap<>());
  static void villagerSeed(Object e) {
    if (!e.getClass().getName().equals("bnw")) return;
    synchronized (VILSEEN) { if (!VILSEEN.add(e)) return; }
    try {
      java.lang.reflect.Field fw = Class.forName("axk", false, e.getClass().getClassLoader()).getDeclaredField("s"); fw.setAccessible(true);
      long x = (SALT + 0x9E3779B97F4A7C15L) * 0xbf58476d1ce4e5b9L; x ^= x >>> 31;
      worldSeed(fw.get(e)).set((x ^ 0x5DEECE66DL) & ((1L << 48) - 1));
    } catch (Throwable t) { t.printStackTrace(); }
  }
  // END LANE
  // LANE:soak #9446: the idle bot draws World.random a wall-clock-dependent number of times before the arm, so two real-server soak runs disagreed (mobs died at different ticks).
  // The FIRST Entity.tick of a freshly summoned entity (age 0) after the reset file reads "rep0arm" re-bases World.random to a salt-only seed. -Dmclite.lockstep.rebasesoak=true.
  static final boolean SOAKREB = Boolean.getBoolean("mclite.lockstep.rebasesoak");
  static volatile boolean SOAKDONE = false;
  static void soakSeed(Object e) {
    if (SOAKDONE || RESET == null) return;
    try {
      if (!new String(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(RESET))).equals("rep0arm")) return;
      java.lang.reflect.Field fa = Class.forName("axk", false, e.getClass().getClassLoader()).getDeclaredField("S"); fa.setAccessible(true);
      if (fa.getInt(e) > 2) return;
      synchronized (SeedAgent.class) { if (SOAKDONE) return; SOAKDONE = true; }
      java.lang.reflect.Field fw = Class.forName("axk", false, e.getClass().getClassLoader()).getDeclaredField("s"); fw.setAccessible(true);
      long x = (SALT + 0x9E3779B97F4A7C15L) * 0xbf58476d1ce4e5b9L; x ^= x >>> 31;
      worldSeed(fw.get(e)).set((x ^ 0x5DEECE66DL) & ((1L << 48) - 1));
    } catch (Throwable t) { t.printStackTrace(); }
  }
  // END LANE
  // LANE:wither #10615: a flying wither never runs EntityNavigation.tick (bgf.c), so nav() writes no TGT line for it. Entity.tick (axk.k) runs for every entity, so
  // for a "wither" it writes the same 'TGT <gen> <tick> <id|-1>' line (MobEntity.getTarget aya.G, tick = age + 1) to the pathlog.
  static Class<?> C_MOB; static java.lang.reflect.Method M_GT, M_FN, M_FNM;
  static void flyTgt(Object e) {
    boolean[] b = BUSY.get(); if (b[0]) return;
    try {
      ClassLoader cl = e.getClass().getClassLoader();
      if (C_MOB == null) {
        C_MOB = Class.forName("aya", false, cl); M_GT = C_MOB.getDeclaredMethod("G"); M_GT.setAccessible(true);
        Class<?> ek = Class.forName("axk", false, cl);
        F_AGE = ek.getDeclaredField("S"); F_AGE.setAccessible(true); F_EID = ek.getDeclaredField("at"); F_EID.setAccessible(true);
        M_ETYPE = ek.getDeclaredMethod("ad"); M_ETYPE.setAccessible(true); M_ENAME = M_ETYPE.getReturnType().getDeclaredMethod("g"); M_ENAME.setAccessible(true);
      }
      if (!C_MOB.isInstance(e)) return;
      if (!"entity.minecraft.wither".equals(M_ENAME.invoke(M_ETYPE.invoke(e)))) return;
      b[0] = true;
      checkReset();
      Object tg = M_GT.invoke(e);
      String tl = "TGT " + gen + " " + (fi(F_AGE, e) + 1) + " " + (tg == null ? -1 : fi(F_EID, tg));
      synchronized (LOGSEEN) { try (java.io.FileWriter w = new java.io.FileWriter(PATHLOG, true)) { w.write(tl + "\n"); } }
    } catch (Throwable t) { t.printStackTrace(); }
    finally { b[0] = false; }
  }
  // END LANE
  public static void entx(Object e) {
    // LANE:golemwander
    if (POIOCC) golemSeed(e);
    // END LANE
    // LANE:goat #10219
    if (GOATREB) goatSeed(e);
    // END LANE
    // LANE:villager #10219
    if (VILREB) villagerSeed(e);
    // END LANE
    // LANE:soak #9446
    if (SOAKREB) soakSeed(e);
    // END LANE
    // LANE:wither #10615
    if (PATHLOG != null) flyTgt(e);
    // END LANE
    if (ENTXLOG == null) return;
    boolean[] b = BUSY.get(); if (b[0]) return; b[0] = true;
    try {
      ClassLoader cl = e.getClass().getClassLoader();
      if (C_LIV == null) {
        C_LIV = Class.forName("axy", false, cl); C_ZV = Class.forName("bmx", false, cl); C_Z = Class.forName("bmw", false, cl); C_PIG = Class.forName("bne", false, cl); C_HOG = Class.forName("bmz", false, cl);
        Class<?> ek = Class.forName("axk", false, cl);
        F_AGE = ek.getDeclaredField("S"); F_EID = ek.getDeclaredField("at"); M_ETYPE = ek.getDeclaredMethod("ad"); M_ENAME = M_ETYPE.getReturnType().getDeclaredMethod("g");
        F_CV = C_ZV.getDeclaredField("cc"); F_CW = C_Z.getDeclaredField("cf"); F_CP = C_PIG.getDeclaredField("d"); F_CH = C_HOG.getDeclaredField("ci"); F_FX = C_LIV.getDeclaredField("bS");
        Class<?> ei = Class.forName("axe", false, cl), ec = Class.forName("axc", false, cl);
        F_ET = ei.getDeclaredField("b"); F_ED = ei.getDeclaredField("c"); F_EA = ei.getDeclaredField("d"); M_RAW = ec.getDeclaredMethod("a", ec);
        for (java.lang.reflect.AccessibleObject a : new java.lang.reflect.AccessibleObject[] { F_AGE, F_EID, M_ETYPE, M_ENAME, F_CV, F_CW, F_CP, F_CH, F_FX, F_ET, F_ED, F_EA, M_RAW }) a.setAccessible(true);
      }
      if (!C_LIV.isInstance(e)) return;
      checkReset();
      // LANE:goldenapple #9439: -Dmclite.lockstep.feed=<tick>: the first time a ZombieVillager (bmx) reaches entity tick <tick> (age + 1, the ENTX tick) a fake
      // ServerPlayerEntity (adx, never added to the world) holding one golden apple (buy.nM) calls the real MobEntity.interactMob (aya.b(boj, awg)) on it, BEFORE
      // this call's ENTX line, so that line shows the cure timer / effects the apple left. 'FEED <tick> <id> <ActionResult>' is logged first.
      if (FEED >= 0 && C_ZV.isInstance(e) && fi(F_AGE, e) + 1 == FEED && FED.add(gen + "|" + fi(F_EID, e))) feed(e);
      // END LANE
      int conv = -1;
      if (C_ZV.isInstance(e)) conv = fi(F_CV, e); else if (C_Z.isInstance(e)) conv = fi(F_CW, e); else if (C_PIG.isInstance(e)) conv = fi(F_CP, e); else if (C_HOG.isInstance(e)) conv = fi(F_CH, e);
      if (conv <= 0) conv = -1;
      java.util.Collection<?> fx = ((java.util.Map<?, ?>) F_FX.get(e)).values();
      int[][] ef = new int[fx.size()][]; int i = 0;
      for (Object x : fx) ef[i++] = new int[] { (Integer) M_RAW.invoke(null, F_ET.get(x)), fi(F_EA, x), fi(F_ED, x) };
      String nm = ((String) M_ENAME.invoke(M_ETYPE.invoke(e))).replace("entity.minecraft.", "");
      String ln = entxLine(fi(F_AGE, e) + 1, nm, fi(F_EID, e), conv, ef);
      synchronized (LOGSEEN) { try (java.io.FileWriter w = new java.io.FileWriter(ENTXLOG, true)) { w.write(ln + "\n"); } }
    } catch (Throwable t) { t.printStackTrace(); }
    finally { b[0] = false; }
  }
  // LANE:goldenapple #9439
  static final long FEED = Long.getLong("mclite.lockstep.feed", -1L);
  static final java.util.HashSet<String> FED = new java.util.HashSet<>();
  static Object FAKE;
  static Object gp(ClassLoader cl) throws Exception { return Class.forName("com.mojang.authlib.GameProfile", true, cl).getConstructor(java.util.UUID.class, String.class).newInstance(java.util.UUID.nameUUIDFromBytes("mclite-feeder".getBytes()), "feeder"); }
  static void feed(Object zv) throws Exception {
    ClassLoader cl = zv.getClass().getClassLoader();
    Class<?> ek = Class.forName("axk", false, cl), pe = Class.forName("adx", false, cl), is = Class.forName("buw", false, cl), ic = Class.forName("cau", false, cl), hand = Class.forName("awg", false, cl);
    Object world;
    java.lang.reflect.Method gs = ek.getDeclaredMethod("cB"); gs.setAccessible(true);
    if (FAKE == null) {
      java.lang.reflect.Field wf = ek.getDeclaredField("s"); wf.setAccessible(true); world = wf.get(zv);
      java.lang.reflect.Constructor<?> c = pe.getDeclaredConstructors()[0];
      for (java.lang.reflect.Constructor<?> k : pe.getDeclaredConstructors()) if (k.getParameterCount() == 3) c = k;
      c.setAccessible(true);
      FAKE = c.newInstance(gs.invoke(zv), world, gp(cl));
    }
    Object apple = Class.forName("buy", false, cl).getDeclaredField("nM").get(null);
    java.lang.reflect.Constructor<?> sc = is.getDeclaredConstructor(ic, int.class); sc.setAccessible(true);
    Object stack = sc.newInstance(apple, 1);
    Object main = hand.getEnumConstants()[0];
    java.lang.reflect.Method set = Class.forName("axy", false, cl).getDeclaredMethod("a", hand, is); set.setAccessible(true);
    set.invoke(FAKE, main, stack);
    java.lang.reflect.Method im = Class.forName("aya", false, cl).getDeclaredMethod("b", Class.forName("boj", false, cl), hand); im.setAccessible(true);
    Object r = im.invoke(zv, FAKE, main);
    String ln = "FEED " + (fi(F_AGE, zv) + 1) + " " + fi(F_EID, zv) + " " + r;
    synchronized (LOGSEEN) { try (java.io.FileWriter w = new java.io.FileWriter(ENTXLOG, true)) { w.write(ln + "\n"); } }
  }
  // END LANE
  static byte[] hookEntx(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, 0);
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
        MethodVisitor mv = super.visitMethod(acc, n, d, s, e);
        if (!n.equals("k") || !d.equals("()V")) return mv;
        return new MethodVisitor(Opcodes.ASM8, mv) {
          public void visitCode() { super.visitCode(); super.visitVarInsn(Opcodes.ALOAD, 0); super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "entx", "(Ljava/lang/Object;)V", false); }
        };
      }
    }, 0);
    return cw.toByteArray();
  }
  // LANE:golemwander #9260: -Dmclite.lockstep.poiocc=true: PointOfInterest.isOccupied() (obf bht.e) is rewritten to poiOcc(this): the engine arena holds a ticket on
  // every bed and job site (Poi.reserveTicket), so a one-ticket POI (bht.b = type bhv, bhv.F = ticketCount == 1) reads as occupied; the bell (32 tickets) stays free.
  static final boolean POIDBG = Boolean.getBoolean("mclite.lockstep.poidbg");   // #9440 debug
  // #9440 debug: -Dmclite.lockstep.rngdbg=true counts every Random.next on "Server thread" by (stack signature) and dumps the table at exit (and every 500 draws of the arena phase)
  static final boolean RNGDBG = Boolean.getBoolean("mclite.lockstep.rngdbg");
  static final java.util.TreeMap<String, long[]> RNGTAB = new java.util.TreeMap<>();
  static final ThreadLocal<boolean[]> RNGIN = ThreadLocal.withInitial(() -> new boolean[1]);
  static { if (RNGDBG && LOG != null) Runtime.getRuntime().addShutdownHook(new Thread(() -> { synchronized (RNGTAB) { for (java.util.Map.Entry<String, long[]> en : RNGTAB.entrySet()) logAll("RNGTAB " + en.getValue()[0] + " " + en.getKey()); } })); }
  public static void mvDbg(String w) {
    if (!Thread.currentThread().getName().startsWith("Server")) return;
    StringBuilder sb = new StringBuilder("MVTO " + w + " :");
    for (StackTraceElement q : new Throwable().getStackTrace()) if (!q.getClassName().startsWith("java.") && !q.getClassName().equals("SeedAgent")) sb.append(' ').append(q.getClassName()).append('.').append(q.getMethodName());
    logAll(sb.toString());
  }
  public static void onNext(Object r) {
    if (!Thread.currentThread().getName().startsWith("Server")) return;
    boolean[] in = RNGIN.get(); if (in[0]) return; in[0] = true;
    try {
      StringBuilder sb = new StringBuilder(); int[] n = {0};
      StackWalker.getInstance().walk(f -> { f.filter(q -> !q.getClassName().startsWith("java.") && !q.getClassName().equals("SeedAgent")).limit(5).forEach(q -> sb.append(q.getClassName()).append(Boolean.getBoolean("mclite.lockstep.rngmeth") ? "." + q.getMethodName() : "").append('<')); return null; });
      synchronized (RNGTAB) { RNGTAB.computeIfAbsent(sb.toString(), k -> new long[1])[0]++; }
      if (Boolean.getBoolean("mclite.lockstep.rngseq") && !sb.toString().startsWith("adu<")) { java.lang.reflect.Field f = Random.class.getDeclaredField("seed"); f.setAccessible(true); logAll("D " + sb + " " + ((java.util.concurrent.atomic.AtomicLong) f.get(r)).get()); }
    } catch (Throwable t) { logAll("DERR " + t); } finally { in[0] = false; }
  }
  static final boolean POIOCC = Boolean.getBoolean("mclite.lockstep.poiocc");
  static java.lang.reflect.Field F_POIFREE, F_POITYPE, F_POICNT;
  public static boolean poiOcc(Object poi) {
    try {
      if (F_POIFREE == null) {
        Class<?> pc = poi.getClass();
        F_POIFREE = pc.getDeclaredField("c"); F_POITYPE = pc.getDeclaredField("b"); F_POIFREE.setAccessible(true); F_POITYPE.setAccessible(true);
        F_POICNT = F_POITYPE.getType().getDeclaredField("F"); F_POICNT.setAccessible(true);
      }
      int cnt = F_POICNT.getInt(F_POITYPE.get(poi));
      boolean occ = F_POIFREE.getInt(poi) != cnt || cnt == 1;
      if (POIDBG && LOG != null) { java.lang.reflect.Field fp = poi.getClass().getDeclaredField("a"); fp.setAccessible(true); logAll("OCC " + Thread.currentThread().getName() + " " + fp.get(poi) + " cnt=" + cnt + " free=" + F_POIFREE.getInt(poi) + " -> " + occ); StringBuilder sb = new StringBuilder("STACK"); StackTraceElement[] st = new Throwable().getStackTrace(); for (int i = 1; i < Math.min(st.length, 60); i++) if (!st[i].getClassName().startsWith("java.")) sb.append(' ').append(st[i].getClassName()).append('.').append(st[i].getMethodName()); logAll(sb.toString()); }
      return occ;
    } catch (Throwable t) { t.printStackTrace(); return false; }
  }
  static byte[] hookPoi(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, ClassWriter.COMPUTE_MAXS);
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
        MethodVisitor out = super.visitMethod(acc, n, d, s, e);
        if (!n.equals("e") || !d.equals("()Z")) return out;
        return new MethodVisitor(Opcodes.ASM8, null) {
          public void visitCode() { out.visitCode(); out.visitVarInsn(Opcodes.ALOAD, 0); out.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "poiOcc", "(Ljava/lang/Object;)Z", false); out.visitInsn(Opcodes.IRETURN); out.visitMaxs(0, 0); out.visitEnd(); }
        };
      }
    }, 0);
    return cw.toByteArray();
  }
  // #9440: PointOfInterestType (bhv) has no hashCode, so the identity hash orders every HashMap/HashSet keyed by it (PoiSection.byType) differently in each JVM:
  // with 3 job-site types in the arena the golem's POI scan order, and so its stroll target, varied run to run. Hash by the id string (bhv.D) instead.
  static byte[] hookPoiType(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, ClassWriter.COMPUTE_MAXS);
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public void visitEnd() {
        MethodVisitor mv = super.visitMethod(Opcodes.ACC_PUBLIC, "hashCode", "()I", null, null);
        mv.visitCode(); mv.visitVarInsn(Opcodes.ALOAD, 0); mv.visitFieldInsn(Opcodes.GETFIELD, "bhv", "D", "Ljava/lang/String;");
        mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/String", "hashCode", "()I", false); mv.visitInsn(Opcodes.IRETURN); mv.visitMaxs(0, 0); mv.visitEnd();
        super.visitEnd();
      }
    }, 0);
    return cw.toByteArray();
  }
  // #9440: EntityNavigation (bgf).tick/checkTimeouts accumulates currentNodeMs from Util.getMeasuringTimeMs() (ad.b, WALL clock) and stops the path once a node has been held for 3x
  // dist/speed seconds of real time, so a GC/JIT stall of the server decides whether and when the golem's stroll is abandoned. At tick rate the timeout never fires: the clock reads 0.
  static byte[] hookNavClock(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, 0);
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
        return new MethodVisitor(Opcodes.ASM8, super.visitMethod(acc, n, d, s, e)) {
          public void visitMethodInsn(int op, String o, String mn, String md, boolean itf) {
            if (op == Opcodes.INVOKESTATIC && o.equals("ad") && mn.equals("b") && md.equals("()J")) { visitInsn(Opcodes.LCONST_0); return; }
            super.visitMethodInsn(op, o, mn, md, itf);
          }
        };
      }
    }, 0);
    return cw.toByteArray();
  }
  // #9440: ServerWorld.tickChunk (adw.a(Lcra;I)V) draws World.random (cav.v) once per ticked chunk (iceandsnow nextInt(16)), and WHICH chunks tick on a given game tick depends on how far the
  // asynchronous chunk loading got: under host load that shifts the shared stream the golem's stroll goal reads. enter/leave roll the stream back, so tickChunk consumes nothing.
  static java.lang.reflect.Field F_WRAND, F_RSEED;
  static final ThreadLocal<long[]> CHUNKSEED = ThreadLocal.withInitial(() -> new long[1]);
  static java.util.concurrent.atomic.AtomicLong worldSeed(Object world) throws Exception {
    if (F_WRAND == null) { F_RSEED = Random.class.getDeclaredField("seed"); F_RSEED.setAccessible(true); F_WRAND = world.getClass().getSuperclass().getDeclaredField("v"); F_WRAND.setAccessible(true); }
    return (java.util.concurrent.atomic.AtomicLong) F_RSEED.get(F_WRAND.get(world));
  }
  public static void chunkEnter(Object world) { try { CHUNKSEED.get()[0] = worldSeed(world).get(); } catch (Throwable t) { t.printStackTrace(); } }
  public static void chunkLeave(Object world) { try { worldSeed(world).set(CHUNKSEED.get()[0]); } catch (Throwable t) { t.printStackTrace(); } }
  static byte[] hookChunkRng(byte[] b) {
    ClassReader cr = new ClassReader(b);
    ClassWriter cw = new ClassWriter(cr, ClassWriter.COMPUTE_MAXS | ClassWriter.COMPUTE_FRAMES) { protected String getCommonSuperClass(String a, String b2) { return "java/lang/Object"; } };
    cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
      public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
        MethodVisitor out = super.visitMethod(acc, n, d, s, e);
        if (!n.equals("a") || !d.equals("(Lcra;I)V")) return out;
        return new MethodVisitor(Opcodes.ASM8, out) {
          public void visitCode() { super.visitCode(); super.visitVarInsn(Opcodes.ALOAD, 0); super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "chunkEnter", "(Ljava/lang/Object;)V", false); }
          public void visitInsn(int op) { if (op == Opcodes.RETURN) { super.visitVarInsn(Opcodes.ALOAD, 0); super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "chunkLeave", "(Ljava/lang/Object;)V", false); } super.visitInsn(op); }
        };
      }
    }, 0);
    return cw.toByteArray();
  }
  // END LANE
  public static void premain(String args, Instrumentation inst) throws Exception {
    inst.addTransformer(new ClassFileTransformer() {
      public byte[] transform(Module m, ClassLoader l, String name, Class<?> c, ProtectionDomain pd, byte[] b) {
        // LANE:golemwander #9260
        if (POIOCC && "bht".equals(name)) try { return hookPoi(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        if (POIOCC && "bhv".equals(name) && !Boolean.getBoolean("mclite.lockstep.nopoitypehash")) try { return hookPoiType(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        // LANE:golemwander #9440
        if (POIOCC && "bgf".equals(name) && PATHLOG == null && !Boolean.getBoolean("mclite.lockstep.nonavclock")) try { return hookNavClock(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        // LANE:golemwander #9440
        if (POIOCC && "adw".equals(name) && !Boolean.getBoolean("mclite.lockstep.nochunkrng")) try { return hookChunkRng(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        // LANE:golemwander #9440
        if (POIOCC && ENTXLOG == null && "axk".equals(name)) try { return hookEntx(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        // LANE:goat #10219
        if (GOATREB && ENTXLOG == null && "axk".equals(name)) try { return hookEntx(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        // LANE:villager #10219
        if (VILREB && ENTXLOG == null && "axk".equals(name)) try { return hookEntx(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        if (ENTXLOG != null && "axk".equals(name)) try { return hookEntx(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // LANE:wither #10615
        if (PATHLOG != null && !POIOCC && !GOATREB && !VILREB && "axk".equals(name)) try { return hookEntx(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        // END LANE
        if (PATHLOG != null && "bgf".equals(name)) try { return hookNav(b); } catch (Throwable t) { t.printStackTrace(); return null; }
        if ("java/util/UUID".equals(name)) {
          ClassReader ur = new ClassReader(b);
          ClassWriter uw = new ClassWriter(ur, 0);
          ur.accept(new ClassVisitor(Opcodes.ASM8, uw) {
            public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
              if (!n.equals("randomUUID") || !d.equals("()Ljava/util/UUID;")) return super.visitMethod(acc, n, d, s, e);
              MethodVisitor mv = super.visitMethod(acc, n, d, s, e);
              mv.visitCode();
              mv.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "uuid", "()Ljava/util/UUID;", false);
              mv.visitInsn(Opcodes.ARETURN);
              mv.visitMaxs(1, 0);
              mv.visitEnd();
              return null;
            }
          }, 0);
          return uw.toByteArray();
        }
        if (!Boolean.getBoolean("mclite.lockstep.nohook")) {
          if ("java/lang/Math".equals(name)) try { return swap(b, "random", "()D", "mathRandom", "()D", Opcodes.DRETURN, null); } catch (Throwable t) { t.printStackTrace(); return null; }
          if ("java/util/concurrent/ThreadLocalRandom".equals(name)) return swap(b, "nextSeed", "()J", "tlrSeed", "()J", Opcodes.LRETURN, null);
        }
        if (RNGDBG && ("bcw".equals(name) || "bgf".equals(name) || "djn".equals(name))) {   // #10618 debug: log who calls MoveControl.moveTo
          ClassReader mr = new ClassReader(b); ClassWriter mw = new ClassWriter(mr, ClassWriter.COMPUTE_MAXS);
          mr.accept(new ClassVisitor(Opcodes.ASM8, mw) {
            public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
              MethodVisitor mv = super.visitMethod(acc, n, d, s, e);
              if (!(acc == (acc & ~Opcodes.ACC_ABSTRACT)) || (acc & Opcodes.ACC_STATIC) != 0 || (n.startsWith("<") && !name.equals("djn")) || (name.equals("djn") && !n.equals("<init>")) || (name.equals("bcw") && !n.equals("a"))) return mv;
              return new MethodVisitor(Opcodes.ASM8, mv) { public void visitCode() { super.visitCode(); super.visitLdcInsn(name + "." + n + d); super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "mvDbg", "(Ljava/lang/String;)V", false); } };
            }
          }, 0);
          return mw.toByteArray();
        }
        if (!"java/util/Random".equals(name)) return null;
        ClassReader cr = new ClassReader(b);
        ClassWriter cw = new ClassWriter(cr, 0);
        cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
          public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
            MethodVisitor mv = super.visitMethod(acc, n, d, s, e);
            // LANE:golemwander #9440 debug
            if (RNGDBG && n.equals("next") && d.equals("(I)I")) return new MethodVisitor(Opcodes.ASM8, mv) {   // #9440 debug
              public void visitCode() { super.visitCode(); super.visitVarInsn(Opcodes.ALOAD, 0); super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "onNext", "(Ljava/lang/Object;)V", false); }
            };
            // END LANE
            if (!n.equals("<init>") || !d.equals("()V")) return mv;
            return new MethodVisitor(Opcodes.ASM8, mv) {
              public void visitMethodInsn(int op, String o, String mn, String md, boolean itf) {
                if (o.equals("java/lang/System") && mn.equals("nanoTime")) { visitLdcInsn(Long.valueOf(0L)); return; }
                if (o.equals("java/util/Random") && mn.equals("seedUniquifier")) { super.visitMethodInsn(Opcodes.INVOKESTATIC, "SeedAgent", "seed", "()J", false); return; }
                super.visitMethodInsn(op, o, mn, md, itf);
              }
            };
          }
        }, 0);
        return cw.toByteArray();
      }
    }, true);
    // #7541: entity ids come from one global counter (Entity.CURRENT_ID = axk.c) that worldgen/chunk-load entities advance at
    // wall-clock-random moments; MobEntity.tickNewAi uses (ticks + id) % 2, so the id's parity moved a mob's AI by a tick between
    // two fresh runs. Every change of the reset file (runchase writes one just before the arm) re-bases the counter.
    if (RESET != null) {
      Thread t = new Thread(() -> {
        String last = "";
        while (true) {
          try {
            Thread.sleep(2);
            String g = new String(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(RESET)));
            if (g.equals(last)) continue;
            Class<?> k = Class.forName("axk", false, ClassLoader.getSystemClassLoader());
            java.lang.reflect.Field f = k.getDeclaredField("c"); f.setAccessible(true);
            ((java.util.concurrent.atomic.AtomicInteger) f.get(null)).set(1000000);
            last = g;
          } catch (Throwable e) { }
        }
      }, "lockstep-idpin");
      t.setDaemon(true); t.start();
    }
    inst.retransformClasses(Random.class, java.util.UUID.class);
    if (!Boolean.getBoolean("mclite.lockstep.nohook")) inst.retransformClasses(Math.class, java.util.concurrent.ThreadLocalRandom.class);
  }
}
