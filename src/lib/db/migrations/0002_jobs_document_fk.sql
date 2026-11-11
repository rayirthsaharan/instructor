-- Table rebuild (SQLite cannot add CHECK/FK in place). Needs foreign_keys=OFF, which is a no-op inside the
-- migration transaction: runMigrations() switches it off on the connection first and runs foreign_key_check after.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`error` text,
	`lease_until` integer,
	`heartbeat_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "document_id", "type", "payload_json", "status", "stage", "progress", "attempts", "max_attempts", "error", "lease_until", "heartbeat_at", "created_at", "updated_at") SELECT "id", CASE WHEN "document_id" IN (SELECT "id" FROM `documents`) THEN "document_id" ELSE NULL END, "type", "payload_json", "status", "stage", "progress", "attempts", "max_attempts", "error", "lease_until", "heartbeat_at", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`lease_until`);