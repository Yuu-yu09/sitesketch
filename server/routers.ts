import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
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

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
