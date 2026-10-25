-- Hand-written: drizzle-kit does not model FTS5. External-content tables, kept in
-- sync by triggers. A drizzle-kit rebuild of articles or stories drops these
-- triggers; follow it with a custom migration that recreates them.

CREATE VIRTUAL TABLE `articles_fts` USING fts5(
	title,
	snippet,
	content='articles',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER `articles_fts_ai` AFTER INSERT ON `articles` BEGIN
	INSERT INTO articles_fts(rowid, title, snippet) VALUES (new.id, new.title, new.snippet);
END;
--> statement-breakpoint
CREATE TRIGGER `articles_fts_ad` AFTER DELETE ON `articles` BEGIN
	INSERT INTO articles_fts(articles_fts, rowid, title, snippet) VALUES ('delete', old.id, old.title, old.snippet);
END;
--> statement-breakpoint
CREATE TRIGGER `articles_fts_au` AFTER UPDATE OF title, snippet ON `articles` BEGIN
	INSERT INTO articles_fts(articles_fts, rowid, title, snippet) VALUES ('delete', old.id, old.title, old.snippet);
	INSERT INTO articles_fts(rowid, title, snippet) VALUES (new.id, new.title, new.snippet);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `stories_fts` USING fts5(
	title,
	primary_entity,
	summary,
	why_matters,
	content='stories',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER `stories_fts_ai` AFTER INSERT ON `stories` BEGIN
	INSERT INTO stories_fts(rowid, title, primary_entity, summary, why_matters)
	VALUES (new.id, new.title, new.primary_entity, new.summary, new.why_matters);
END;
--> statement-breakpoint
CREATE TRIGGER `stories_fts_ad` AFTER DELETE ON `stories` BEGIN
	INSERT INTO stories_fts(stories_fts, rowid, title, primary_entity, summary, why_matters)
	VALUES ('delete', old.id, old.title, old.primary_entity, old.summary, old.why_matters);
END;
--> statement-breakpoint
-- Only the indexed columns: counter and score updates must not churn the index.
CREATE TRIGGER `stories_fts_au` AFTER UPDATE OF title, primary_entity, summary, why_matters ON `stories` BEGIN
	INSERT INTO stories_fts(stories_fts, rowid, title, primary_entity, summary, why_matters)
	VALUES ('delete', old.id, old.title, old.primary_entity, old.summary, old.why_matters);
	INSERT INTO stories_fts(rowid, title, primary_entity, summary, why_matters)
	VALUES (new.id, new.title, new.primary_entity, new.summary, new.why_matters);
END;
