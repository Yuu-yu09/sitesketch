CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "contentItems" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"pageId" integer,
	"name" varchar(160) NOT NULL,
	"description" text,
	"isCompleted" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projectEditorData" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"dataJson" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projectEditorData_projectId_unique" UNIQUE("projectId")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(180) NOT NULL,
	"projectType" varchar(120) DEFAULT 'Creative agency' NOT NULL,
	"purpose" varchar(240) DEFAULT 'Turn interest into qualified conversations' NOT NULL,
	"prompt" text,
	"sectionsJson" text NOT NULL,
	"checklistJson" text NOT NULL,
	"selectedBlock" varchar(80) DEFAULT 'hero' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"passwordHash" text,
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
