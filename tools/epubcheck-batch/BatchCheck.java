import com.adobe.epubcheck.api.*;
import com.adobe.epubcheck.messages.*;
import com.adobe.epubcheck.util.FeatureEnum;
import java.io.*;
import java.util.*;

/**
 * Runs EPUBCheck over many files in one JVM (the CLI spends ~6s per file on
 * startup). Reads EPUB paths from stdin, writes one JSON line per file:
 * {"file": ..., "messages": [{"id","severity","path","line","message"}]}
 */
public class BatchCheck {
  static String q(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }

  static class Collect extends MasterReport {
    final List<String> out = new ArrayList<>();
    @Override public void message(Message m, EPUBLocation loc, Object... args) {
      Severity s = m.getSeverity();
      if (s == Severity.SUPPRESSED || s == Severity.USAGE || s == Severity.INFO) return;
      out.add("{\"id\":" + q(m.getID().name().replace('_', '-')) + ",\"severity\":" + q(s.name())
          + ",\"path\":" + q(loc == null ? null : loc.getPath()) + ",\"line\":" + (loc == null ? -1 : loc.getLine())
          + ",\"message\":" + q(m.getMessage(args)) + "}");
    }
    @Override public void info(String r, FeatureEnum f, String v) {}
    @Override public int generate() { return 0; }
    @Override public void initialize() {}
  }

  public static void main(String[] a) throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
    PrintStream stdout = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    System.setOut(new PrintStream(OutputStream.nullOutputStream()));
    System.setErr(new PrintStream(OutputStream.nullOutputStream()));
    String line;
    while ((line = in.readLine()) != null) {
      if (line.isBlank()) continue;
      Collect r = new Collect();
      String crash = null;
      try { new EpubCheck(new File(line), r).doValidate(); }
      catch (Throwable t) { crash = t.toString(); }
      stdout.println("{\"file\":" + q(line) + ",\"crash\":" + q(crash) + ",\"messages\":[" + String.join(",", r.out) + "]}");
    }
  }
}
