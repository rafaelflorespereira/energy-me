import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyValues } from "./domain/feelings";
import { loadCheckIns, saveCheckIns } from "./storage";

describe("account storage", () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("isolates check-ins between accounts and preserves them after switching back", () => {
    const checkins = [{ date: "2026-10-07", values: emptyValues() }];
    saveCheckIns("alice", checkins);
    expect(loadCheckIns("bob")).toEqual([]);
    saveCheckIns("bob", []);
    expect(loadCheckIns("alice")).toEqual(checkins);
  });

  it("does not assign anonymous records to a signed-in account", () => {
    localStorage.setItem(
      "energy-me:checkins:v1",
      JSON.stringify([{ date: "2026-10-07", values: emptyValues() }]),
    );
    expect(loadCheckIns("alice")).toEqual([]);
  });

  it("handles unavailable storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadCheckIns("alice")).toEqual([]);
    expect(() => saveCheckIns("alice", [])).not.toThrow();
  });
});
