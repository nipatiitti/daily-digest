CREATE TABLE `event_actors` (
	`event_id` integer NOT NULL,
	`actor` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`event_id`, `actor`, `role`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_actors_actor_idx` ON `event_actors` (`actor`);--> statement-breakpoint
CREATE TABLE `event_codes` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`material` integer DEFAULT false NOT NULL,
	`significance` integer NOT NULL,
	`act` text NOT NULL,
	`valence` integer NOT NULL,
	`stance` integer,
	`reason` text NOT NULL,
	`origins_at_code` integer NOT NULL,
	`coded_at` integer NOT NULL,
	`llm_call_id` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_codes_coded_at_idx` ON `event_codes` (`coded_at`);