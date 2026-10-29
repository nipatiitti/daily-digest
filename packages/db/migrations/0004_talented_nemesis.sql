CREATE TABLE `actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`detail_json` text,
	`by` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `actions_at_idx` ON `actions` (`at`);--> statement-breakpoint
CREATE INDEX `actions_subject_idx` ON `actions` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `llm_calls_purpose_at_idx` ON `llm_calls` (`purpose`,`at`);