CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `original_files_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `text_content` text;