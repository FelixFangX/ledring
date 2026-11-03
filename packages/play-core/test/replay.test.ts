import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCassette, playCassette, replayEvents } from "@ledring/play-core";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("replayEvents", () => {
  it("replays a cassette with the same ending and the same event ids", () => {
    const cassette = loadCassette(readFileSync(`${root}fixtures/play/snake-polished.json`, "utf8"));
    const first = playCassette(cassette);
    const second = replayEvents(first.events);
    expect(second.ending).toBe(first.ending);
    expect(second.ending).toBe("POLISHED");
    expect(second.id).toBe(first.id);
    expect(second.events).toEqual(first.events);
    expect(second.events.filter((event) => event.type === "choose").map((event) => event.id)).toEqual(["tests", "polish"]);
  });
});
