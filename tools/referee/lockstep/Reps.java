// Reps: 3 "reps" in one process; args[0] = reset file or "-" (omit the reset). Prints one line of Randoms per rep.
import java.util.Random;
public class Reps {
  public static void main(String[] a) throws Exception {
    StringBuilder sb = new StringBuilder();
    for (int rep = 0; rep < 3; rep++) {
      if (!a[0].equals("-")) java.nio.file.Files.writeString(java.nio.file.Path.of(a[0]), "rep" + rep);
      sb.append(new Random().nextLong()).append(' ').append(new Random().nextLong()).append('\n');
    }
    System.out.print(sb);
  }
}
