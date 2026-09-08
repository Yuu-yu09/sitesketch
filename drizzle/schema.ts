import { integer, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  projectType: varchar("projectType", { length: 120 }).notNull().default("Creative agency"),
  purpose: varchar("purpose", { length: 240 }).notNull().default("Turn interest into qualified conversations"),
  prompt: text("prompt"),
  sectionsJson: text("sectionsJson").notNull(),
  checklistJson: text("checklistJson").notNull(),
  selectedBlock: varchar("selectedBlock", { length: 80 }).notNull().default("hero"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const pages = pgTable("pages", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  position: integer("position").notNull().default(0),
});

export const projectEditorData = pgTable("projectEditorData", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull().unique(),
  dataJson: text("dataJson").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const contentItems = pgTable("contentItems", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  pageId: integer("pageId"),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  isCompleted: integer("isCompleted").notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type ProjectEditorData = typeof projectEditorData.$inferSelect;
export type InsertProjectEditorData = typeof projectEditorData.$inferInsert;
