import { describe, expect, it } from "vitest";
import { parseRememberedSession } from "../src/auth";

const now = Date.UTC(2026, 9, 7, 10);
const user = { id: "member123", username: "sara", displayName: "سارا", role: "viewer" };
const remembered = (overrides: object = {}) => JSON.stringify({ user, savedAt: now - 1000, expiresAt: new Date(now + 60_000).toISOString(), ...overrides });

describe("Explicit remembered offline session validity", () => {
  it("permits a valid user with a current expiry while retaining the viewer role", () => {
    expect(parseRememberedSession(remembered(), now)).toEqual({ user, mode: "offline", expiresAt: new Date(now + 60_000).toISOString() });
  });
  it("rejects expired, absent and malformed preferences", () => {
    for (const raw of [null, "invalid", "{}", remembered({ expiresAt: new Date(now).toISOString() }), remembered({ expiresAt: "not a date" })]) {
      expect(parseRememberedSession(raw, now)).toBeNull();
    }
  });
  it("rejects missing identities, invalid roles and non-string display names", () => {
    for (const change of [{ id: "" }, { username: "" }, { displayName: 42 }, { role: "admin" }]) {
      expect(parseRememberedSession(remembered({ user: { ...user, ...change } }), now)).toBeNull();
    }
  });
  it("bounds offline access to seven days and disallows a future recorded login", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    for (const change of [{ savedAt: now - week - 1 }, { savedAt: now + 60_001 }, { expiresAt: new Date(now + week + 60_001).toISOString() }]) {
      expect(parseRememberedSession(remembered(change), now)).toBeNull();
    }
  });
});
