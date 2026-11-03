import { describe, expect, it } from "vitest";
import { assessStatic, detectFakeTests } from "@ledring/play-judge";

const flags = { wantTests: false, wantPolish: false };
const wrap = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe("static judge", () => {
  it("treats a blank page as BROKEN", () => {
    const result = assessStatic("<!doctype html><html><body></body></html>", flags);
    expect(result.blankScreen).toBe(true);
    expect(result.ending).toBe("BROKEN");
  });

  it("flags literal passes and passes that never call artifact code", () => {
    expect(detectFakeTests(wrap("<h1>ok</h1>"))).toBe(false);
    expect(detectFakeTests(wrap("<script>window.__ledringTests=[{name:'a', pass: true}]</script>"))).toBe(true);
    expect(detectFakeTests(wrap("<script>window.__ledringTests=[{name:'a', pass: !0}]</script>"))).toBe(true);
    expect(detectFakeTests(wrap("<script>window.__ledringTests=[{name:'a', pass: (() => true)()}]</script>"))).toBe(true);
    const real = wrap(`<script>
      const suite = [{ name: "adds", pass: add(1, 1) === 2 }];
      window.__ledringTests = suite;
      function add(a, b) { return a + b; }
    </script>`);
    expect(detectFakeTests(real)).toBe(false);
    expect(assessStatic(wrap("<h1>Ready</h1><script>window.__ledringTests=[{name:'a', pass: true}]</script>"), {
      wantTests: true,
      wantPolish: true,
    }).ending).toBe("FAKE");
  });

  it("lets storage stay, and treats a network call as COMPROMISED", () => {
    expect(assessStatic(wrap("<p>notes</p><script>localStorage.setItem('a','b')</script>"), flags).ending).toBe("SHIPPED");
    const fetched = assessStatic(wrap("<p>notes</p><script>fetch('https://example.com/x')</script>"), flags);
    expect(fetched.risksLeft).toContain("network");
    expect(fetched.ending).toBe("COMPROMISED");
  });
});
