CREATE TABLE `stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into` integer,
	`centroid` blob NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`thread_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`merged_into`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stories_status_last_seen_idx` ON `stories` (`status`,`last_seen`);--> statement-breakpoint
ALTER TABLE `threads` ADD `story_id` integer REFERENCES stories(id);--> statement-breakpoint
ALTER TABLE `threads` ADD `story_checked_at` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `story_checked_events` integer;--> statement-breakpoint
CREATE INDEX `threads_story_idx` ON `threads` (`story_id`);