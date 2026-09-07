import { z } from "zod";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createUserProject,
  deleteUserProject,
  generateWebsiteSpec,
  listUserProjects,
  loadEditorData,
  projectStateSchema,
  renameUserProject,
  saveEditorData,
  updateUserProject,
} from "./sitesketch";

const projectIdInput = z.object({ id: z.number().int().positive() });
const scrypt = promisify(scryptCallback);
const credentialsInput = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
});

function toPublicUser(user: NonNullable<import("./_core/context").TrpcContext["user"]>) {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const expectedKey = Buffer.from(key, "hex");
  return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => (opts.ctx.user ? toPublicUser(opts.ctx.user) : null)),
    register: publicProcedure
      .input(credentialsInput.extend({ name: z.string().trim().min(1).max(120) }))
      .mutation(async ({ ctx, input }) => {
        const email = input.email.toLowerCase();
        if (await db.getUserByEmail(email)) {
          throw new TRPCError({ code: "CONFLICT", message: "An account with that email already exists" });
        }
        const user = await db.createLocalUser({
          openId: `local_${randomUUID()}`,
          name: input.name,
          email,
          passwordHash: await hashPassword(input.password),
        });
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account could not be created" });
        const token = await sdk.createLocalSession(user);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: 1000 * 60 * 60 * 24 * 365,
        });
        return { success: true } as const;
      }),
    login: publicProcedure.input(credentialsInput).mutation(async ({ ctx, input }) => {
      const user = await db.getUserByEmail(input.email.toLowerCase());
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });
      }
      const token = await sdk.createLocalSession(user);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: 1000 * 60 * 60 * 24 * 365,
      });
      return { success: true } as const;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  projects: router({
    list: protectedProcedure.query(({ ctx }) => listUserProjects(ctx.user.id)),
    create: protectedProcedure.input(projectStateSchema).mutation(({ ctx, input }) => createUserProject(ctx.user.id, input)),
    update: protectedProcedure.input(z.object({ id: z.number().int().positive(), state: projectStateSchema })).mutation(({ ctx, input }) => updateUserProject(ctx.user.id, input.id, input.state)),
    rename: protectedProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(180) })).mutation(({ ctx, input }) => renameUserProject(ctx.user.id, input.id, input.name)),
    delete: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => deleteUserProject(ctx.user.id, input.id)),
    editor: router({
      load: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => loadEditorData(ctx.user.id, input.id)),
      save: protectedProcedure.input(z.object({ id: z.number().int().positive(), data: z.record(z.string(), z.unknown()) })).mutation(({ ctx, input }) => saveEditorData(ctx.user.id, input.id, input.data)),
    }),
  }),
  ai: router({
    generate: protectedProcedure.input(z.object({ prompt: z.string().min(10).max(4000) })).mutation(({ input }) => generateWebsiteSpec(input.prompt)),
  }),
});

export type AppRouter = typeof appRouter;
