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
  static java.lang.reflect.Method M_PATH, M_LEN, M_NODE; static java.lang.reflect.Field F_TICK, F_X, F_Y, F_Z;
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
      synchronized (LOGSEEN) { try (java.io.FileWriter w = new java.io.FileWriter(PATHLOG, true)) { w.write(sb + "\n"); } }
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
  public static void premain(String args, Instrumentation inst) throws Exception {
    inst.addTransformer(new ClassFileTransformer() {
      public byte[] transform(Module m, ClassLoader l, String name, Class<?> c, ProtectionDomain pd, byte[] b) {
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
        if (!"java/util/Random".equals(name)) return null;
        ClassReader cr = new ClassReader(b);
        ClassWriter cw = new ClassWriter(cr, 0);
        cr.accept(new ClassVisitor(Opcodes.ASM8, cw) {
          public MethodVisitor visitMethod(int acc, String n, String d, String s, String[] e) {
            MethodVisitor mv = super.visitMethod(acc, n, d, s, e);
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
    inst.retransformClasses(Random.class, java.util.UUID.class);
    if (!Boolean.getBoolean("mclite.lockstep.nohook")) inst.retransformClasses(Math.class, java.util.concurrent.ThreadLocalRandom.class);
  }
}
