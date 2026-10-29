-- Hand-written: drizzle-kit does not model FTS5. External-content table over
-- themes.name and themes.description, kept in sync by triggers. A drizzle-kit
-- rebuild of themes drops these triggers; follow it with a custom migration
-- that recreates them.

CREATE VIRTUAL TABLE `themes_fts` USING fts5(
	name,
	description,
	content='themes',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER `themes_fts_ai` AFTER INSERT ON `themes` BEGIN
	INSERT INTO themes_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER `themes_fts_ad` AFTER DELETE ON `themes` BEGIN
	INSERT INTO themes_fts(themes_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
END;
--> statement-breakpoint
-- Only name and description: status, count and momentum updates must not churn the index.
CREATE TRIGGER `themes_fts_au` AFTER UPDATE OF name, description ON `themes` BEGIN
	INSERT INTO themes_fts(themes_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
	INSERT INTO themes_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
END;
--> statement-breakpoint
-- No-op on an empty table; covers themes written before this migration applied.
INSERT INTO themes_fts(themes_fts) VALUES ('rebuild');
