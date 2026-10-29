CREATE TABLE `llm_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`text` text NOT NULL,
	`refs_json` text NOT NULL,
	`llm_call_id` integer,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_answers_key_uq` ON `llm_answers` (`purpose`,`subject_kind`,`subject_id`,`input_hash`);--> statement-breakpoint
ALTER TABLE `themes` ADD `explained_momentum_24h` real;