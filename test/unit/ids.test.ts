import { describe, expect, it } from "vitest";
import { idToKey, isValidCosmosId, keyToId } from "../../src/ids.js";

describe("key <-> id encoding", () => {
  const keys = [
    "overview.md",
    "query/functions/array-length.md",
    "query/keywords/where.md",
    "request-units.md",
    // pathological: contains every forbidden id char plus a space and backslash
    "weird a/b#c?d\\e.md",
  ];

  it("round-trips every key", () => {
    for (const k of keys) {
      expect(idToKey(keyToId(k))).toBe(k);
    }
  });

  it("produces ids with no forbidden characters", () => {
    for (const k of keys) {
      expect(isValidCosmosId(keyToId(k))).toBe(true);
    }
  });

  it("produces ids with no '%' (percent in an item id breaks point reads)", () => {
    for (const k of keys) {
      expect(keyToId(k)).not.toContain("%");
    }
  });

  it("rejects raw keys that contain '/'", () => {
    expect(isValidCosmosId("query/functions/array-length.md")).toBe(false);
  });
});
