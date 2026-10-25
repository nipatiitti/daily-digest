CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`guid` text NOT NULL,
	`canonical_url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text NOT NULL,
	`snippet` text,
	`lang` text,
	`published_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`origin_id` integer,
	`story_id` integer,
	`embedded_at` integer,
	`fulltext_r2_key` text,
	`cve_ids_json` text,
	`entities_json` text,
	`is_promotional` integer DEFAULT false NOT NULL,
	`is_aggregator` integer DEFAULT false NOT NULL,
	`injection_suspect` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_canonicalUrl_unique` ON `articles` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `articles_story_idx` ON `articles` (`story_id`);--> statement-breakpoint
CREATE INDEX `articles_published_idx` ON `articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `articles_origin_idx` ON `articles` (`origin_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `articles_source_guid_uq` ON `articles` (`source_id`,`guid`);--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer,
	`kind` text NOT NULL,
	`digest_date` text,
	`chat_id` integer NOT NULL,
	`message_id` integer,
	`reply_to_delivery_id` integer,
	`fact_ids_json` text,
	`score_at_send` real,
	`sent_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`silent` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`digest_date`) REFERENCES `digests`(`digest_date`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deliveries_story_idx` ON `deliveries` (`story_id`);--> statement-breakpoint
CREATE INDEX `deliveries_digest_date_idx` ON `deliveries` (`digest_date`);--> statement-breakpoint
CREATE INDEX `deliveries_sent_at_idx` ON `deliveries` (`sent_at`);--> statement-breakpoint
CREATE TABLE `digests` (
	`digest_date` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	`item_count` integer
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`delivery_id` integer NOT NULL,
	`story_id` integer,
	`tg_user_id` integer NOT NULL,
	`vote` text NOT NULL,
	`rubric_snapshot_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`delivery_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `feedback_story_idx` ON `feedback` (`story_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_delivery_user_uq` ON `feedback` (`delivery_id`,`tg_user_id`);--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `db_stats` (
	`day` text PRIMARY KEY NOT NULL,
	`size_bytes` integer NOT NULL,
	`rows_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gate_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer NOT NULL,
	`gate` text NOT NULL,
	`decision` text NOT NULL,
	`reasons_json` text NOT NULL,
	`shadow` integer NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `gate_log_story_idx` ON `gate_log` (`story_id`);--> statement-breakpoint
CREATE INDEX `gate_log_at_idx` ON `gate_log` (`at`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`story_id` integer,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`est_cost_usd` real NOT NULL,
	`validation_error` text,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `llm_calls_at_idx` ON `llm_calls` (`at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`kind` text DEFAULT 'rss' NOT NULL,
	`parser` text,
	`filter_json` text,
	`tier` text NOT NULL,
	`category` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`authoritative` integer DEFAULT false NOT NULL,
	`poll_seconds` integer NOT NULL,
	`stale_after_days` integer DEFAULT 3 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_poll_at` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_status` integer,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_new_item_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_slug_unique` ON `sources` (`slug`);--> statement-breakpoint
CREATE INDEX `sources_due_idx` ON `sources` (`enabled`,`next_poll_at`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer NOT NULL,
	`text` text NOT NULL,
	`type` text NOT NULL,
	`salience` integer NOT NULL,
	`first_seen` integer NOT NULL,
	`supporting_article_ids_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `facts_story_first_seen_idx` ON `facts` (`story_id`,`first_seen`);--> statement-breakpoint
CREATE TABLE `follows` (
	`story_id` integer PRIMARY KEY NOT NULL,
	`followed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_reported_fact_at` integer,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`story_id` integer,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`ref` text,
	`observed_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `signals_story_idx` ON `signals` (`story_id`);--> statement-breakpoint
CREATE INDEX `signals_kind_observed_idx` ON `signals` (`kind`,`observed_at`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into` integer,
	`previous_story_id` integer,
	`title` text NOT NULL,
	`primary_entity` text,
	`first_seen` integer NOT NULL,
	`last_article_at` integer NOT NULL,
	`unique_domains` integer DEFAULT 0 NOT NULL,
	`independent_origins` integer DEFAULT 0 NOT NULL,
	`authoritative_count` integer DEFAULT 0 NOT NULL,
	`origins_6h` integer DEFAULT 0 NOT NULL,
	`rubric_json` text,
	`score` real,
	`tier` integer,
	`fi_relevance` integer DEFAULT 0 NOT NULL,
	`extraction_hash` text,
	`summary` text,
	`why_matters` text,
	FOREIGN KEY (`merged_into`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stories_status_last_article_idx` ON `stories` (`status`,`last_article_at`);--> statement-breakpoint
CREATE INDEX `stories_merged_into_idx` ON `stories` (`merged_into`);--> statement-breakpoint
CREATE TABLE `story_vulns` (
	`story_id` integer NOT NULL,
	`cve_id` text NOT NULL,
	PRIMARY KEY(`story_id`, `cve_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cve_id`) REFERENCES `vulns`(`cve_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `story_vulns_cve_idx` ON `story_vulns` (`cve_id`);--> statement-breakpoint
CREATE TABLE `vulns` (
	`cve_id` text PRIMARY KEY NOT NULL,
	`vendor` text,
	`product` text,
	`cna_cvss` real,
	`kev_date_added` integer,
	`euvd_exploited_since` integer,
	`epss` real,
	`updated_at` integer NOT NULL
);
