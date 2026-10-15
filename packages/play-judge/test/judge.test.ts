import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { JudgeRuntime, judgeArtifact, type JudgeVerdict } from "@ledring/play-judge";

function browserInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const installed = browserInstalled();

const blank = "<!doctype html><html><body></body></html>";
const throwsOnClick = `<!doctype html><html><body>
<button type="button" id="go">Go</button>
<script>document.getElementById("go").addEventListener("click", function () { throw new Error("boom"); });</script>
</body></html>`;
const fakeTests = `<!doctype html><html><body>
<h1>Ready</h1>
<script>window.__ledringTests = [{ name: "green", pass: true }];</script>
</body></html>`;
const canvasGame = `<!doctype html><html><body>
<canvas id="c" width="200" height="80"></canvas>
<script>
const canvas = document.getElementById("c");
const pen = canvas.getContext("2d");
function paint(x) { pen.fillStyle = "#1188ff"; pen.fillRect(x, 8, 24, 24); }
paint(4);
canvas.addEventListener("click", function () { paint(60); });
addEventListener("keydown", function (event) { if (event.key === "ArrowRight") paint(100); });
</script>
</body></html>`;
const blockedFetch = `<!doctype html><html><body>
<p>ready</p>
<script>fetch("https://example.com/secret").catch(function () {});</script>
</body></html>`;

describe.skipIf(!installed && !process.env.CI)("headless judge", () => {
  const runtime = new JudgeRuntime();

  afterAll(async () => {
    await runtime.close();
  });

  async function judge(html: string, flags?: { wantTests?: boolean; wantPolish?: boolean }): Promise<JudgeVerdict> {
    if (!installed) throw new Error("chromium is not installed");
    return judgeArtifact({ html, wantTests: flags?.wantTests ?? false, wantPolish: flags?.wantPolish ?? false }, { runtime });
  }

  it("maps a blank page to BROKEN and keeps axe from gating", async () => {
    const verdict = await judge(blank);
    expect(verdict.ending).toBe("BROKEN");
    expect(verdict.blankScreen).toBe(true);
    expect(verdict.validPage).toBe(false);
    expect(verdict.interactive).toBe(false);
    expect(verdict.a11y.gating).toBe(false);
    expect(verdict.a11y.violations).toBeGreaterThan(0);
    expect(verdict.screenshots.map((shot) => shot.name)).toEqual(["desktop", "mobile"]);
    for (const shot of verdict.screenshots) {
      expect(Buffer.from(shot.png.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    }
  }, 20_000);

  it("maps a click that throws to BUGGY", async () => {
    const verdict = await judge(throwsOnClick);
    expect(verdict.ending).toBe("BUGGY");
    expect(verdict.runtimeErrors).toBeGreaterThan(0);
    expect(verdict.errors.some((error) => error.includes("boom"))).toBe(true);
  }, 20_000);

  it("maps literal self-tests to FAKE", async () => {
    const verdict = await judge(fakeTests, { wantTests: true });
    expect(verdict.fakeTests).toBe(true);
    expect(verdict.ending).toBe("FAKE");
    expect(verdict.selfTests?.fake).toBe(true);
  }, 20_000);

  it("treats a canvas that changes on click as interactive", async () => {
    const verdict = await judge(canvasGame);
    expect(verdict.interactive).toBe(true);
    expect(verdict.responsiveActions).toBeGreaterThan(0);
    expect(verdict.blankScreen).toBe(false);
    expect(verdict.errors).toEqual([]);
    expect(verdict.ending).toBe("SHIPPED");
  }, 20_000);

  it("logs a fetch that the offline route aborted", async () => {
    const verdict = await judge(blockedFetch);
    expect(verdict.networkAttempts.some((attempt) => attempt.url.includes("example.com/secret"))).toBe(true);
    expect(verdict.risksLeft).toContain("network");
    expect(verdict.ending).toBe("COMPROMISED");
  }, 20_000);

  it("reuses one browser and finishes an artifact in under 8s", async () => {
    await runtime.browser();
    const started = Date.now();
    const verdict = await judge("<!doctype html><html><body><p>ready</p></body></html>");
    expect(Date.now() - started).toBeLessThan(8000);
    expect(runtime.launches).toBe(1);
    expect(verdict.engine).toBe("playwright");
    expect(verdict.ending).toBe("SHIPPED");
  }, 20_000);
});
