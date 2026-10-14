// Prints 5 seeds x 300 draws of every java.util.Random method. javac JRandomGolden.java && java JRandomGolden > jrandom.golden.txt
import java.util.Random;
public class JRandomGolden {
  public static void main(String[] a) {
    long[] seeds = {0L, 1L, 42L, -7046029254386353131L, 123456789012345L};
    int[] bounds = {1, 2, 3, 10, 16, 100, 1000, 65536, 1 << 30, 1431655765, 2147483647};
    for (long seed : seeds) {
      String[] names = {"nextInt", "nextIntB", "nextLong", "nextFloat", "nextDouble", "nextBoolean", "nextGaussian"};
      for (String n : names) {
        Random r = new Random(seed);
        StringBuilder sb = new StringBuilder(n + " " + seed);
        for (int i = 0; i < 300; i++) {
          sb.append(' ');
          switch (n) {
            case "nextInt": sb.append(r.nextInt()); break;
            case "nextIntB": sb.append(r.nextInt(bounds[i % bounds.length])); break;
            case "nextLong": sb.append(r.nextLong()); break;
            case "nextFloat": sb.append(Float.floatToIntBits(r.nextFloat())); break;
            case "nextDouble": sb.append(Double.doubleToLongBits(r.nextDouble())); break;
            case "nextBoolean": sb.append(r.nextBoolean() ? 1 : 0); break;
            default: sb.append(Double.doubleToLongBits(r.nextGaussian()));
          }
        }
        System.out.println(sb);
      }
    }
  }
}
