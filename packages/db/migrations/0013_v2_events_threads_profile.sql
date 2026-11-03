CREATE TABLE `digests_shadow` (
	`edition_key` text NOT NULL,
	`mode` text NOT NULL,
	`rank` integer NOT NULL,
	`event_id` integer NOT NULL,
	`thread_id` integer,
	`score` real NOT NULL,
	`relevance` integer NOT NULL,
	`text` text NOT NULL,
	`as_of` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`edition_key`, `mode`, `rank`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `article_facets` (
	`article_id` integer PRIMARY KEY NOT NULL,
	`title_en` text NOT NULL,
	`gist` text NOT NULL,
	`entities_json` text NOT NULL,
	`countries_json` text NOT NULL,
	`event_type` text NOT NULL,
	`advisory` integer DEFAULT false NOT NULL,
	`opinion` integer DEFAULT false NOT NULL,
	`roundup` integer DEFAULT false NOT NULL,
	`promotional` integer DEFAULT false NOT NULL,
	`model` text NOT NULL,
	`faceted_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`embedded_at` integer,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `article_facets_embedded_idx` ON `article_facets` (`embedded_at`);--> statement-breakpoint
CREATE TABLE `event_articles` (
	`article_id` integer PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`origin_article_id` integer,
	`how` text NOT NULL,
	`cosine` real,
	`candidate_event_id` integer,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_articles_event_idx` ON `event_articles` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_articles_origin_idx` ON `event_articles` (`origin_article_id`);--> statement-breakpoint
CREATE TABLE `event_entities` (
	`event_id` integer NOT NULL,
	`entity_id` integer NOT NULL,
	`mentions` integer DEFAULT 1 NOT NULL,
	`first_seen` integer NOT NULL,
	PRIMARY KEY(`event_id`, `entity_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_entities_entity_idx` ON `event_entities` (`entity_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into` integer,
	`title` text NOT NULL,
	`gist` text NOT NULL,
	`centroid` blob NOT NULL,
	`first_seen` integer NOT NULL,
	`last_article_at` integer NOT NULL,
	`article_count` integer DEFAULT 0 NOT NULL,
	`independent_origins` integer DEFAULT 0 NOT NULL,
	`unique_sources` integer DEFAULT 0 NOT NULL,
	`official_count` integer DEFAULT 0 NOT NULL,
	`origins_6h` integer DEFAULT 0 NOT NULL,
	`advisory_only` integer DEFAULT false NOT NULL,
	`countries_json` text NOT NULL,
	`event_type` text NOT NULL,
	`headline` text,
	`summary` text,
	`why_for_you` text,
	`copy_hash` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`merged_into`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_status_last_article_idx` ON `events` (`status`,`last_article_at`);--> statement-breakpoint
CREATE INDEX `events_first_seen_idx` ON `events` (`first_seen`);--> statement-breakpoint
CREATE INDEX `events_merged_into_idx` ON `events` (`merged_into`);--> statement-breakpoint
CREATE TABLE `pair_decisions` (
	`a_event_id` integer NOT NULL,
	`b_event_id` integer NOT NULL,
	`same` integer NOT NULL,
	`cosine` real,
	`by` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`a_event_id`, `b_event_id`),
	FOREIGN KEY (`a_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`b_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `profile_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`based_on_version` integer NOT NULL,
	`edits_json` text NOT NULL,
	`rationale` text NOT NULL,
	`feedback_ids_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`llm_call_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_proposals_status_idx` ON `profile_proposals` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `profile_versions` (
	`version` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`topics_json` text NOT NULL,
	`follows_json` text NOT NULL,
	`regions_json` text NOT NULL,
	`mutes_json` text NOT NULL,
	`note` text,
	`proposal_id` integer,
	`by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relevance` (
	`event_id` integer NOT NULL,
	`profile_version` integer NOT NULL,
	`score` integer NOT NULL,
	`reason` text NOT NULL,
	`origins_at_score` integer NOT NULL,
	`llm_call_id` integer,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`event_id`, `profile_version`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `relevance_at_idx` ON `relevance` (`at`);--> statement-breakpoint
CREATE TABLE `event_threads` (
	`event_id` integer NOT NULL,
	`thread_id` integer NOT NULL,
	`confidence` real NOT NULL,
	`by` text NOT NULL,
	`assigned_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`event_id`, `thread_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_threads_thread_idx` ON `event_threads` (`thread_id`);--> statement-breakpoint
CREATE TABLE `movers` (
	`bucket` integer NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`articles_24h` integer NOT NULL,
	`change_24h` real,
	`change_7d` real,
	`rank` integer NOT NULL,
	`reason` text,
	`llm_call_id` integer,
	PRIMARY KEY(`bucket`, `kind`, `key`),
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `movers_bucket_rank_idx` ON `movers` (`bucket`,`rank`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'provisional' NOT NULL,
	`merged_into` integer,
	`centroid` blob NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`momentum_24h` real,
	`momentum_7d` real,
	FOREIGN KEY (`merged_into`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `threads_status_last_seen_idx` ON `threads` (`status`,`last_seen`);--> statement-breakpoint
CREATE INDEX `threads_merged_into_idx` ON `threads` (`merged_into`);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `event_id` integer REFERENCES events(id);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `thread_id` integer REFERENCES threads(id);--> statement-breakpoint
CREATE INDEX `deliveries_event_idx` ON `deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `deliveries_thread_idx` ON `deliveries` (`thread_id`);--> statement-breakpoint
ALTER TABLE `entities` ADD `event_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `event_id` integer REFERENCES events(id);