CREATE TABLE `edition_item_events` (
	`item_id` integer NOT NULL,
	`event_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `event_id`),
	FOREIGN KEY (`item_id`) REFERENCES `edition_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `edition_item_events_event_idx` ON `edition_item_events` (`event_id`);--> statement-breakpoint
CREATE TABLE `edition_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`edition_key` text NOT NULL,
	`mode` text NOT NULL,
	`rank` integer NOT NULL,
	`story_id` integer,
	`thread_id` integer,
	`lead_event_id` integer NOT NULL,
	`headline` text NOT NULL,
	`summary` text NOT NULL,
	`text` text NOT NULL,
	`is_update` integer DEFAULT false NOT NULL,
	`gate` integer NOT NULL,
	`score` real NOT NULL,
	`as_of` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `edition_items_story_idx` ON `edition_items` (`story_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `edition_items_lead_idx` ON `edition_items` (`lead_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `edition_items_key_mode_rank_uq` ON `edition_items` (`edition_key`,`mode`,`rank`);--> statement-breakpoint
CREATE TABLE `edition_judgments` (
	`edition_key` text NOT NULL,
	`mode` text NOT NULL,
	`event_id` integer NOT NULL,
	`story_id` integer,
	`thread_id` integer,
	`significance` integer,
	`material` integer,
	`act` text,
	`interest` integer,
	`gate` integer,
	`change` text,
	`outcome` text NOT NULL,
	`reason` text,
	`as_of` integer NOT NULL,
	PRIMARY KEY(`edition_key`, `mode`, `event_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `deliveries` ADD `edition_item_id` integer REFERENCES edition_items(id);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `story_id` integer REFERENCES stories(id);