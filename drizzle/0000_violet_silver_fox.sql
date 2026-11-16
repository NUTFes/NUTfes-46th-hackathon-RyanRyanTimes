CREATE TABLE `activity_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`month` text NOT NULL,
	`r2_key` text NOT NULL,
	`channel_id` text,
	`item_count` integer NOT NULL,
	`imported_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text(12) NOT NULL,
	`member_id` text NOT NULL,
	`issue_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`headline` text NOT NULL,
	`body` text NOT NULL,
	`reporter_comment` text NOT NULL,
	`main_seed_id` text NOT NULL,
	`seed_ids` text DEFAULT '[]' NOT NULL,
	`tip_ids` text DEFAULT '[]' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_top` integer DEFAULT false NOT NULL,
	`lint_warnings` text DEFAULT '[]' NOT NULL,
	`generated_at` text NOT NULL,
	`edited_by` text,
	`published_at` text,
	`retracted_at` text,
	`hidden_at` text,
	`updated_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`main_seed_id`) REFERENCES `seeds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edited_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_slug_unique` ON `articles` (`slug`);--> statement-breakpoint
CREATE INDEX `articles_issue_status_idx` ON `articles` (`issue_id`,`status`);--> statement-breakpoint
CREATE TABLE `evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`seed_id` text,
	`tip_id` text,
	`source` text NOT NULL,
	`author_member_id` text,
	`url` text,
	`excerpt` text(200),
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`seed_id`) REFERENCES `seeds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tip_id`) REFERENCES `tips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`editor_note` text,
	`status` text DEFAULT 'editing' NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_number_unique` ON `issues` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_kind_target_unique` ON `issues` (`kind`,`target`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`slack_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`real_name` text,
	`avatar_url` text,
	`github_login` text,
	`joined_at` text,
	`joined_at_source` text DEFAULT 'estimated' NOT NULL,
	`is_editor` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`opted_out_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_slack_user_id_unique` ON `members` (`slack_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_github_login_unique` ON `members` (`github_login`);--> statement-breakpoint
CREATE TABLE `monthly_stats` (
	`member_id` text NOT NULL,
	`month` text NOT NULL,
	`commits` integer DEFAULT 0 NOT NULL,
	`prs_opened` integer DEFAULT 0 NOT NULL,
	`prs_merged` integer DEFAULT 0 NOT NULL,
	`reviews` integer DEFAULT 0 NOT NULL,
	`review_comments` integer DEFAULT 0 NOT NULL,
	`issues_opened` integer DEFAULT 0 NOT NULL,
	`doc_changes` integer DEFAULT 0 NOT NULL,
	`posts` integer DEFAULT 0 NOT NULL,
	`thread_replies` integer DEFAULT 0 NOT NULL,
	`question_replies` integer DEFAULT 0 NOT NULL,
	`reactions_given` integer DEFAULT 0 NOT NULL,
	`reactions_given_people` integer DEFAULT 0 NOT NULL,
	`reactions_received` integer DEFAULT 0 NOT NULL,
	`thanks_received` integer DEFAULT 0 NOT NULL,
	`first_greetings` integer DEFAULT 0 NOT NULL,
	`active_weeks` integer DEFAULT 0 NOT NULL,
	`weeks_in_month` integer NOT NULL,
	`peak_hour` integer,
	`top_emoji` text,
	`firsts` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`member_id`, `month`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`article_id` text NOT NULL,
	`member_id` text NOT NULL,
	`message` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `regeneration_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `seeds` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`score` real NOT NULL,
	`summary` text NOT NULL,
	`metrics` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_member_idx` ON `sessions` (`member_id`);--> statement-breakpoint
CREATE TABLE `tips` (
	`id` text PRIMARY KEY NOT NULL,
	`target_member_id` text NOT NULL,
	`sender_member_id` text NOT NULL,
	`is_anonymous` integer NOT NULL,
	`body` text NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`decided_by` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`target_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
