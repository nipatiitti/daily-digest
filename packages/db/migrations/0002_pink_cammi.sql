CREATE TABLE `rollups` (
	`bucket` integer NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`articles` integer DEFAULT 0 NOT NULL,
	`origins` integer DEFAULT 0 NOT NULL,
	`new_stories` integer DEFAULT 0 NOT NULL,
	`score_sum` real DEFAULT 0 NOT NULL,
	`score_n` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket`, `kind`, `key`)
);
--> statement-breakpoint
CREATE INDEX `rollups_kind_key_bucket_idx` ON `rollups` (`kind`,`key`,`bucket`);--> statement-breakpoint
ALTER TABLE `sources` ADD `items_24h` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `stories` ADD `momentum_24h` real;--> statement-breakpoint
ALTER TABLE `stories` ADD `momentum_7d` real;--> statement-breakpoint
ALTER TABLE `stories` ADD `origins_30m` integer DEFAULT 0 NOT NULL;