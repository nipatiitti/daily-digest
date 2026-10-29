-- Hand-written: drizzle-kit does not model FTS5. External-content table over
-- entities.name, kept in sync by triggers. A drizzle-kit rebuild of entities
-- drops these triggers; follow it with a custom migration that recreates them.

CREATE VIRTUAL TABLE `entities_fts` USING fts5(
	name,
	content='entities',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER `entities_fts_ai` AFTER INSERT ON `entities` BEGIN
	INSERT INTO entities_fts(rowid, name) VALUES (new.id, new.name);
END;
--> statement-breakpoint
CREATE TRIGGER `entities_fts_ad` AFTER DELETE ON `entities` BEGIN
	INSERT INTO entities_fts(entities_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;
--> statement-breakpoint
-- Only name: count and momentum updates must not churn the index.
CREATE TRIGGER `entities_fts_au` AFTER UPDATE OF name ON `entities` BEGIN
	INSERT INTO entities_fts(entities_fts, rowid, name) VALUES ('delete', old.id, old.name);
	INSERT INTO entities_fts(rowid, name) VALUES (new.id, new.name);
END;
--> statement-breakpoint
-- No-op on an empty table; covers entities written before this migration applied.
INSERT INTO entities_fts(entities_fts) VALUES ('rebuild');
