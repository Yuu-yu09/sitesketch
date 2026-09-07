import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: text("passwordHash"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  projectType: varchar("projectType", { length: 120 }).notNull().default("Creative agency"),
  purpose: varchar("purpose", { length: 240 }).notNull().default("Turn interest into qualified conversations"),
  prompt: text("prompt"),
  sectionsJson: text("sectionsJson").notNull(),
  checklistJson: text("checklistJson").notNull(),
  selectedBlock: varchar("selectedBlock", { length: 80 }).notNull().default("hero"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const pages = mysqlTable("pages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  position: int("position").notNull().default(0),
});

export const projectEditorData = mysqlTable("projectEditorData", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull().unique(),
  dataJson: text("dataJson").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const contentItems = mysqlTable("contentItems", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  pageId: int("pageId"),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  isCompleted: int("isCompleted").notNull().default(0),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type ProjectEditorData = typeof projectEditorData.$inferSelect;
export type InsertProjectEditorData = typeof projectEditorData.$inferInsert;
