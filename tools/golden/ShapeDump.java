// ShapeDump.java — run the real 1.18.2 client bytecode and print, for EVERY block state (in registry state-id order),
// its four shapes: outline (getShape), collision (getCollisionShape), visual (getVisualShape = camera collision) and
// interaction (getInteractionShape = Yarn getRaycastShape), against EmptyBlockGetter / BlockPos.ZERO / CollisionContext.empty().
// Obf names are the CLIENT jar's, taken from .decomp/names.tsv (Yarn). Nothing here reimplements a shape.
// IN A NAMED PACKAGE ON PURPOSE (signed obf classes live in the default package).
package shapedump;

import java.lang.reflect.*;
import java.util.*;

public class ShapeDump {
  static Method m(Class<?> c, String n, Class<?>... p) throws Exception {
    for (Class<?> k = c; k != null; k = k.getSuperclass())
      try { Method x = k.getDeclaredMethod(n, p); x.setAccessible(true); return x; } catch (NoSuchMethodException e) { }
    throw new NoSuchMethodException(n);
  }
  static Object sf(String c, String n) throws Exception {
    Field f = Class.forName(c).getDeclaredField(n); f.setAccessible(true); return f.get(null);
  }
  static double fd(Object box, String n) throws Exception {
    Field f = box.getClass().getDeclaredField(n); f.setAccessible(true); return f.getDouble(box);
  }
  static String q(double v) { return Long.toString(Math.round(v * 1024)); }

  public static void main(String[] a) throws Exception {
    java.io.PrintStream out = System.out;                      // Bootstrap re-routes System.out into the logger
    Class.forName("ab").getMethod("a").invoke(null);          // SharedConstants.createGameVersion
    Class.forName("yv").getMethod("a").invoke(null);          // Bootstrap.initialize
    Iterable<?> ids = (Iterable<?>) sf("cdq", "o");           // Block.STATE_IDS
    Object world = sf("cak", "a"), pos = sf("gj", "b");       // EmptyBlockView.INSTANCE, BlockPos.ORIGIN
    Class<?> W = Class.forName("cab"), P = Class.forName("gj"), X = Class.forName("dpt");
    Object ctx = X.getMethod("a").invoke(null);               // ShapeContext.absent()
    Class<?> S = Class.forName("cou$a");
    Method[] ms = { m(S, "a", W, P, X), m(S, "b", W, P, X), m(S, "c", W, P, X), m(S, "m", W, P) };
    Method boxes = m(Class.forName("dqh"), "d");
    Map<String, Integer> dict = new LinkedHashMap<>();
    StringBuilder rows = new StringBuilder();
    int id = 0;
    for (Object st : ids) {
      rows.append(id++).append('\t').append(st.toString().replace("Block{", "").replace("}", ""));
      for (Method mm : ms) {
        String s;
        try {
          Object sh = mm.getParameterCount() == 3 ? mm.invoke(st, world, pos, ctx) : mm.invoke(st, world, pos);
          List<String> bs = new ArrayList<>();
          for (Object b : (List<?>) boxes.invoke(sh))
            bs.add(q(fd(b, "a")) + "," + q(fd(b, "b")) + "," + q(fd(b, "c")) + "," + q(fd(b, "d")) + "," + q(fd(b, "e")) + "," + q(fd(b, "f")));
          Collections.sort(bs);
          s = String.join(";", bs);
        } catch (InvocationTargetException e) { s = "ERR"; }
        Integer ix = dict.get(s);
        if (ix == null) { ix = dict.size(); dict.put(s, ix); }
        rows.append('\t').append(ix);
      }
      rows.append('\n');
    }
    out.println("# blockshapes-1.18.2.tsv — outline, collision, visual, interaction shape per state (boxes x1024). Written by tools/extract-shapes.mjs");
    for (Map.Entry<String, Integer> e : dict.entrySet()) out.println("S\t" + e.getValue() + "\t" + e.getKey());
    out.print(rows); out.flush();
  }
}
