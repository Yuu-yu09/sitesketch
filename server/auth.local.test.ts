import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const users = new Map<string, any>();

vi.mock("./db", () => ({
  getUserByEmail: vi.fn(async (email: string) => users.get(email)),
  getUserByOpenId: vi.fn(async (openId: string) => [...users.values()].find(user => user.openId === openId)),
  createLocalUser: vi.fn(async (input: any) => {
    const user = { id: users.size + 1, ...input, loginMethod: "email", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    users.set(input.email, user);
    return user;
  }),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    createLocalSession: vi.fn(async (user: { openId: string }) => `session:${user.openId}`),
  },
}));

function createContext() {
  const cookies: Array<{ name: string; value: string }> = [];
  return {
    cookies,
    ctx: {
      user: null,
      req: { protocol: "http", headers: {} } as TrpcContext["req"],
      res: { cookie: (name: string, value: string) => cookies.push({ name, value }) } as TrpcContext["res"],
    },
  };
}

describe("local authentication", () => {
  beforeEach(() => users.clear());

  it("registers an account and sets a session cookie without exposing the password", async () => {
    const { ctx, cookies } = createContext();
    const result = await appRouter.createCaller(ctx).auth.register({
      name: "Ada Lovelace",
      email: "Ada@Example.com",
      password: "correct horse battery staple",
    });

    expect(result).toEqual({ success: true });
    expect(cookies[0]?.value).toMatch(/^session:local_/);
    expect(users.get("ada@example.com")?.passwordHash).toMatch(/^[^:]+:[a-f0-9]+$/);
  });

  it("rejects duplicate email addresses", async () => {
    users.set("ada@example.com", { id: 1, email: "ada@example.com", openId: "local_existing", passwordHash: "hash" });
    const { ctx } = createContext();

    await expect(appRouter.createCaller(ctx).auth.register({
      name: "Ada Lovelace",
      email: "ADA@example.com",
      password: "correct horse battery staple",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("logs in with the correct password and rejects a wrong password", async () => {
    const { ctx: registerContext } = createContext();
    await appRouter.createCaller(registerContext).auth.register({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery staple",
    });

    const { ctx: loginContext, cookies } = createContext();
    await expect(appRouter.createCaller(loginContext).auth.login({
      email: "ADA@example.com",
      password: "correct horse battery staple",
    })).resolves.toEqual({ success: true });
    expect(cookies[0]?.value).toMatch(/^session:local_/);
    await expect(appRouter.createCaller(createContext().ctx).auth.login({
      email: "ada@example.com",
      password: "wrong password",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
