CREATE TABLE `entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`story_count` integer DEFAULT 0 NOT NULL,
	`momentum_24h` real,
	`momentum_7d` real,
	`merged_into` integer,
	FOREIGN KEY (`merged_into`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_key_unique` ON `entities` (`key`);--> statement-breakpoint
CREATE INDEX `entities_last_seen_idx` ON `entities` (`last_seen`);--> statement-breakpoint
CREATE TABLE `hourly_runs` (
	`step` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL,
	`detail_json` text
);
--> statement-breakpoint
CREATE TABLE `story_entities` (
	`story_id` integer NOT NULL,
	`entity_id` integer NOT NULL,
	`first_seen` integer NOT NULL,
	PRIMARY KEY(`story_id`, `entity_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_entities_entity_idx` ON `story_entities` (`entity_id`);