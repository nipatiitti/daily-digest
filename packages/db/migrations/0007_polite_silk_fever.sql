CREATE TABLE `story_themes` (
	`story_id` integer NOT NULL,
	`theme_id` integer NOT NULL,
	`confidence` real NOT NULL,
	`assigned_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`by` text NOT NULL,
	PRIMARY KEY(`story_id`, `theme_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_themes_theme_idx` ON `story_themes` (`theme_id`);--> statement-breakpoint
CREATE TABLE `theme_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`theme_id` integer NOT NULL,
	`kind` text NOT NULL,
	`detail_json` text,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`theme_id`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `theme_events_theme_at_idx` ON `theme_events` (`theme_id`,`at`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'provisional' NOT NULL,
	`merged_into` integer,
	`embedding` blob NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`story_count` integer DEFAULT 0 NOT NULL,
	`momentum_24h` real,
	`momentum_7d` real,
	`explanation` text,
	`explained_at` integer,
	FOREIGN KEY (`merged_into`) REFERENCES `themes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `themes_status_last_seen_idx` ON `themes` (`status`,`last_seen`);--> statement-breakpoint
CREATE INDEX `themes_last_seen_idx` ON `themes` (`last_seen`);