import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_EXPIRED_EVENT, AuthApiError, authRequest } from "../src/auth";

afterEach(() => vi.unstubAllGlobals());

describe("API failure classification and gate revocation", () => {
  it("classifies malformed and non-object server JSON as API failures instead of offline network failures", async () => {
    for (const body of ["{broken", "null", "[]", "true", '"unexpected"']) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "application/json" } })));
      await expect(authRequest("status")).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
    }
  });

  it("revokes a session on any unauthorized response, even when its error body is invalid", async () => {
    const events = new EventTarget(), listener = vi.fn();
    events.addEventListener(AUTH_EXPIRED_EVENT, listener);
    vi.stubGlobal("window", events);
    for (const [body, contentType] of [["{broken", "application/json"], ["not JSON", "text/html"], ["null", "application/json"]]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 401, headers: { "Content-Type": contentType } })));
      await expect(authRequest("state")).rejects.toBeInstanceOf(AuthApiError);
    }
    expect(listener).toHaveBeenCalledTimes(3);
    await expect(authRequest("status", { notifyUnauthorized: false })).rejects.toBeInstanceOf(AuthApiError);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps actual network failures available for an explicitly remembered offline session", async () => {
    const network = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn(async () => { throw network; }));
    await expect(authRequest("status")).rejects.toBe(network);
  });
});
