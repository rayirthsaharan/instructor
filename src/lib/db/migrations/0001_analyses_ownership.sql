-- Table rebuild (SQLite cannot add CHECK/FK in place). Needs foreign_keys=OFF, which is a no-op inside the
-- migration transaction: runMigrations() switches it off on the connection first and runs foreign_key_check after.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Ownerless mock analyses are unshareable by policy and would violate the new CHECK: remove them and their dependants.
DELETE FROM `step_notes` WHERE `analysis_id` IN (SELECT `id` FROM `analyses` WHERE `provider` = 'mock' AND `owner_session_id` = '');--> statement-breakpoint
DELETE FROM `messages` WHERE `analysis_id` IN (SELECT `id` FROM `analyses` WHERE `provider` = 'mock' AND `owner_session_id` = '');--> statement-breakpoint
DELETE FROM `progress` WHERE `analysis_id` IN (SELECT `id` FROM `analyses` WHERE `provider` = 'mock' AND `owner_session_id` = '');--> statement-breakpoint
DELETE FROM `simplifications` WHERE `analysis_id` IN (SELECT `id` FROM `analyses` WHERE `provider` = 'mock' AND `owner_session_id` = '');--> statement-breakpoint
DELETE FROM `guides` WHERE `analysis_id` IN (SELECT `id` FROM `analyses` WHERE `provider` = 'mock' AND `owner_session_id` = '');--> statement-breakpoint
DELETE FROM `analyses` WHERE `provider` = 'mock' AND `owner_session_id` = '';--> statement-breakpoint
CREATE TABLE `__new_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`pipeline_version` text NOT NULL,
	`provider` text NOT NULL,
	`source_kind` text DEFAULT 'pdf' NOT NULL,
	`owner_session_id` text DEFAULT '' NOT NULL,
	`guide_json` text NOT NULL,
	`schema_version` integer NOT NULL,
	`model` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "analyses_owner_required" CHECK("owner_session_id" <> '' OR ("provider" <> 'mock' AND "source_kind" <> 'images'))
);
--> statement-breakpoint
INSERT INTO `__new_analyses`("id", "content_hash", "pipeline_version", "provider", "source_kind", "owner_session_id", "guide_json", "schema_version", "model", "created_at") SELECT "id", "content_hash", "pipeline_version", "provider", 'pdf', "owner_session_id", "guide_json", "schema_version", "model", "created_at" FROM `analyses`;--> statement-breakpoint
DROP TABLE `analyses`;--> statement-breakpoint
ALTER TABLE `__new_analyses` RENAME TO `analyses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_key` ON `analyses` (`content_hash`,`pipeline_version`,`provider`,`owner_session_id`);