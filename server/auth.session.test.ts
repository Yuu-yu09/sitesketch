import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("auth.me", () => {
  it("returns the authenticated session user", async () => {
    const user = {
      id: 7,
      openId: "session-user",
      email: "session@example.com",
      name: "Session User",
      loginMethod: "oauth",
      role: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    const ctx = { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
    await expect(appRouter.createCaller(ctx).auth.me()).resolves.toEqual(user);
  });

  it("returns null when no session is present", async () => {
    const ctx = { user: null, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
    await expect(appRouter.createCaller(ctx).auth.me()).resolves.toBeNull();
  });
});
