public class Probe {
  public static void main(String[] a) throws Exception {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 3; i++) sb.append(new java.util.Random().nextLong()).append(" ");
    Thread t = new Thread(() -> { synchronized (sb) { sb.append(new java.util.Random().nextLong()); } }, "probe-worker");
    t.start(); t.join();
    if (a.length > 0 && a[0].equals("uuid")) { StringBuilder u = new StringBuilder(); for (int i = 0; i < 5; i++) u.append(java.util.UUID.randomUUID()).append(" "); System.out.println(u.toString().trim()); return; }
    System.out.println(sb);
    // #6223: Math.random / ThreadLocalRandom, 20 draws in main and 20 in a named thread, run twice per thread (second pass continues the count)
    StringBuilder m = new StringBuilder(), t2 = new StringBuilder();
    Runnable draw = () -> { StringBuilder o = Thread.currentThread().getName().equals("main") ? m : t2;
      synchronized (sb) { for (int i = 0; i < 20; i++) o.append(Math.random()).append(' ').append(java.util.concurrent.ThreadLocalRandom.current().nextLong()).append(' '); } };
    draw.run(); draw.run();
    for (int k = 0; k < 2; k++) { Thread w = new Thread(draw, "probe-named"); w.start(); w.join(); }
    System.out.println(m); System.out.println(t2);
  }
}
