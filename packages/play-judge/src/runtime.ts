import { chromium, type Browser } from "playwright";

/** Chromium did not launch. Callers should say the judge is unavailable, not invent a verdict. */
export class JudgeUnavailableError extends Error {
  constructor(message = "judge browser is unavailable") {
    super(message);
    this.name = "JudgeUnavailableError";
  }
}

/**
 * One Chromium for many artifacts. Each {@link judgeArtifact} call opens a fresh context
 * and closes it. Call {@link JudgeRuntime.close} when the process is done.
 */
export class JudgeRuntime {
  launches = 0;
  private current: Browser | undefined;
  private opening: Promise<Browser> | undefined;

  async browser(): Promise<Browser> {
    if (this.current?.isConnected()) return this.current;
    if (this.opening) return this.opening;
    this.opening = chromium
      .launch({ headless: true, args: ["--disable-dev-shm-usage"] })
      .then((browser) => {
        this.current = browser;
        this.launches += 1;
        this.opening = undefined;
        return browser;
      })
      .catch((error: unknown) => {
        this.opening = undefined;
        const message = error instanceof Error ? error.message : "chromium failed to launch";
        throw new JudgeUnavailableError(message);
      });
    return this.opening;
  }

  async close(): Promise<void> {
    const pending = this.opening;
    this.opening = undefined;
    const current = this.current ?? (pending ? await pending.catch(() => undefined) : undefined);
    this.current = undefined;
    if (current) await current.close();
  }
}
