CREATE TABLE `match_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`story_id` integer,
	`how` text NOT NULL,
	`cosine` real,
	`candidate_story_id` integer,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_log_article_idx` ON `match_log` (`article_id`);--> statement-breakpoint
CREATE INDEX `match_log_story_idx` ON `match_log` (`story_id`);