CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`pipeline_version` text NOT NULL,
	`provider` text NOT NULL,
	`owner_session_id` text DEFAULT '' NOT NULL,
	`guide_json` text NOT NULL,
	`schema_version` integer NOT NULL,
	`model` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analyses_key` ON `analyses` (`content_hash`,`pipeline_version`,`provider`,`owner_session_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`kind` text NOT NULL,
	`original_path` text NOT NULL,
	`page_count` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_session_idx` ON `documents` (`session_id`);--> statement-breakpoint
CREATE INDEX `documents_hash_idx` ON `documents` (`content_hash`);--> statement-breakpoint
CREATE TABLE `guides` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`analysis_id` text NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `guides_session_idx` ON `guides` (`session_id`);--> statement-breakpoint
CREATE TABLE `job_artifacts` (
	`job_id` text NOT NULL,
	`key` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `key`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
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
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`lease_until`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`analysis_id` text NOT NULL,
	`step_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_guide_idx` ON `messages` (`guide_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`index` integer NOT NULL,
	`image_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_doc_index` ON `pages` (`document_id`,`index`);--> statement-breakpoint
CREATE TABLE `progress` (
	`guide_id` text PRIMARY KEY NOT NULL,
	`analysis_id` text NOT NULL,
	`current_step_id` text,
	`completed_steps_json` text DEFAULT '[]' NOT NULL,
	`checklist_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `simplifications` (
	`analysis_id` text NOT NULL,
	`step_id` text NOT NULL,
	`level` integer NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`analysis_id`, `step_id`, `level`),
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `step_notes` (
	`guide_id` text NOT NULL,
	`analysis_id` text NOT NULL,
	`step_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`bookmarked` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`guide_id`, `step_id`),
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_id`) REFERENCES `analyses`(`id`) ON UPDATE no action ON DELETE no action
);
