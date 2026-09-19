import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getRedirectUri } from "./_core/oauth";

describe("OAuth redirect URI", () => {
  it("preserves the browser host for local development", () => {
    const request = {
      hostname: "localhost",
      protocol: "http",
      get: (header: string) => header.toLowerCase() === "host" ? "localhost:3000" : undefined,
    } as Pick<Request, "hostname" | "protocol" | "get">;

    expect(getRedirectUri(request, "google")).toBe("http://localhost:3000/api/auth/google/callback");
  });
});
