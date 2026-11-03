import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCassette, playCassette } from "@ledring/play-core";
import { startBridge } from "@ledring/play-bridge";
import { readSessionIndex, writePlayLog, writeSessionIndex, type SessionSummary } from "../src/store.js";

const TOKEN = "launch-token-0123456789abcdef";
const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("session library", () => {
  it("lists 100 sessions from the index in under 100ms and does not read the play logs", async () => {
    const home = mkdtempSync(join(tmpdir(), "ledring-library-"));
    const dir = join(home, "sessions");
    const marker = "NOT-IN-THE-INDEX";
    const pad = "x".repeat(256 * 1024);
    const rows: SessionSummary[] = [];
    for (let i = 0; i < 100; i += 1) {
      const id = `sess-${String(i).padStart(3, "0")}`;
      writePlayLog(dir, id, [{ id: 1, event: { type: "start", idea: marker, pad } }]);
      rows.push({
        id,
        idea: `idea-${i}`,
        ending: i % 2 === 0 ? "POLISHED" : "SHIPPED",
        date: new Date(Date.UTC(2026, 9, 15, 0, i, 0)).toISOString(),
      });
    }
    writeSessionIndex(dir, rows);
    const bridge = await startBridge({ token: TOKEN, home });
    try {
      const started = performance.now();
      const listed = await fetch(new URL("/api/sessions", bridge.url), { headers: { "x-ledring-token": TOKEN } });
      const elapsed = performance.now() - started;
      const body = (await listed.json()) as { sessions: SessionSummary[] };
      expect(listed.status).toBe(200);
      expect(elapsed).toBeLessThan(100);
      expect(body.sessions).toHaveLength(100);
      expect(body.sessions[0]).toMatchObject({ id: "sess-099", idea: "idea-99", ending: "SHIPPED" });
      expect(JSON.stringify(body)).not.toContain(marker);
      expect(readSessionIndex(dir)).toHaveLength(100);
    } finally {
      await bridge.close();
    }
  }, 20_000);

  it("saves a cassette run and replays the same ending and event ids after restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "ledring-library-"));
    const cassette = loadCassette(readFileSync(join(root, "fixtures/play/snake-polished.json"), "utf8"));
    const played = playCassette(cassette);
    const events = JSON.parse(JSON.stringify(played.events)) as unknown[];
    const first = await startBridge({ token: TOKEN, home });
    try {
      const created = await fetch(new URL("/api/sessions", first.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN },
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const saved = await fetch(new URL(`/api/sessions/${id}/library`, first.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ events }),
      });
      expect(saved.status).toBe(200);
      const summary = (await saved.json()) as { id: string; idea: string; ending: string; date: string };
      expect(summary).toMatchObject({ id, idea: played.idea, ending: "POLISHED" });
      expect(summary.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const replay = await fetch(new URL(`/api/sessions/${id}/replay`, first.url), {
        headers: { "x-ledring-token": TOKEN },
      });
      const body = (await replay.json()) as { ending: string; events: { id: number; event: { type: string; id?: string } }[] };
      expect(body.ending).toBe("POLISHED");
      expect(body.events.map((entry) => entry.id)).toEqual(events.map((_, index) => index + 1));
      expect(body.events.map((entry) => entry.event)).toEqual(events);
      expect(body.events.filter((entry) => entry.event.type === "choose").map((entry) => entry.event.id)).toEqual(["tests", "polish"]);

      const missing = await fetch(new URL("/api/sessions", first.url), { headers: { "x-ledring-token": "nope" } });
      expect(missing.status).toBe(403);
    } finally {
      await first.close();
    }

    const second = await startBridge({ token: TOKEN, home });
    try {
      const listed = await fetch(new URL("/api/sessions", second.url), { headers: { "x-ledring-token": TOKEN } });
      const index = (await listed.json()) as { sessions: SessionSummary[] };
      expect(index.sessions).toEqual([expect.objectContaining({ idea: played.idea, ending: "POLISHED" })]);
      const row = index.sessions[0];
      if (!row) throw new Error("missing session");
      const id = row.id;
      const replay = await fetch(new URL(`/api/sessions/${id}/replay`, second.url), {
        headers: { "x-ledring-token": TOKEN },
      });
      const body = (await replay.json()) as { ending: string; events: { id: number; event: unknown }[] };
      expect(body.ending).toBe("POLISHED");
      expect(body.events.map((entry) => entry.id)).toEqual(events.map((_, index) => index + 1));
      expect(body.events.map((entry) => entry.event)).toEqual(events);
    } finally {
      await second.close();
    }
  });

  it("rejects a play log that is not a session and writes no index row", async () => {
    const home = mkdtempSync(join(tmpdir(), "ledring-library-"));
    const bridge = await startBridge({ token: TOKEN, home });
    try {
      const created = await fetch(new URL("/api/sessions", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN },
      });
      const { id } = (await created.json()) as { id: string };
      const saved = await fetch(new URL(`/api/sessions/${id}/library`, bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ events: [{ type: "nope" }] }),
      });
      expect(saved.status).toBe(400);
      expect(readSessionIndex(join(home, "sessions"))).toEqual([]);
      const replay = await fetch(new URL(`/api/sessions/${id}/replay`, bridge.url), {
        headers: { "x-ledring-token": TOKEN },
      });
      expect(replay.status).toBe(404);
    } finally {
      await bridge.close();
    }
  });
});
