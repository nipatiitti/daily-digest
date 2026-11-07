CREATE TABLE `interest` (
	`event_id` integer NOT NULL,
	`profile_version` integer NOT NULL,
	`level` integer NOT NULL,
	`muted` integer DEFAULT false NOT NULL,
	`reason` text NOT NULL,
	`origins_at_score` integer NOT NULL,
	`llm_call_id` integer,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`event_id`, `profile_version`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `interest_at_idx` ON `interest` (`at`);