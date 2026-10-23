import { describe, expect, it } from "vitest";
import { bearerToken, handle, HttpError } from "./http.ts";

const req = (auth?: string) =>
  new Request("https://example.test/api", auth ? { headers: { authorization: auth } } : undefined);

describe("bearerToken", () => {
  it("extracts a bearer token", () => expect(bearerToken(req("Bearer abc.def-ghi"))).toBe("abc.def-ghi"));
  it("rejects missing or malformed headers", () => {
    expect(bearerToken(req())).toBeNull();
    expect(bearerToken(req("Basic abc"))).toBeNull();
    expect(bearerToken(req("Bearer a b"))).toBeNull();
  });
});

describe("handle", () => {
  it("maps HttpError to a safe status and body", async () => {
    const res = await handle(async () => {
      throw new HttpError("not_a_member", "nope");
    })(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "not_a_member", message: "nope" } });
  });
  it("hides unexpected error details", async () => {
    const res = await handle(async () => {
      throw new Error("secret detail sk-123");
    })(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("sk-123");
  });
});
