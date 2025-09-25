CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`port` integer NOT NULL,
	`unit_id` integer NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`text` text NOT NULL,
	`ts` integer NOT NULL
);
