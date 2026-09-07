CREATE TABLE `contentItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`pageId` int,
	`name` varchar(160) NOT NULL,
	`description` text,
	`isCompleted` int NOT NULL DEFAULT 0,
	CONSTRAINT `contentItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `pages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projectEditorData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`dataJson` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectEditorData_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectEditorData_projectId_unique` UNIQUE(`projectId`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`projectType` varchar(120) NOT NULL DEFAULT 'Creative agency',
	`purpose` varchar(240) NOT NULL DEFAULT 'Turn interest into qualified conversations',
	`prompt` text,
	`sectionsJson` text NOT NULL,
	`checklistJson` text NOT NULL,
	`selectedBlock` varchar(80) NOT NULL DEFAULT 'hero',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
