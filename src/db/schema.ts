import { sqliteTable, text, integer, real, uniqueIndex, primaryKey, index } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text().primaryKey(), slack_user_id: text().notNull().unique(), display_name: text().notNull(),
  real_name: text(), avatar_url: text(), github_login: text().unique(), joined_at: text(),
  joined_at_source: text({ enum: ["estimated", "manual"] }).notNull().default("estimated"),
  is_editor: integer({ mode: "boolean" }).notNull().default(false),
  is_active: integer({ mode: "boolean" }).notNull().default(true), opted_out_at: text(),
  created_at: text().notNull(), updated_at: text().notNull(),
});
export const sessions = sqliteTable("sessions", {
  id: text().primaryKey(), member_id: text().notNull().references(() => members.id, { onDelete: "cascade" }),
  expires_at: text().notNull(), created_at: text().notNull(),
}, t => [index("sessions_member_idx").on(t.member_id)]);
export const activity_imports = sqliteTable("activity_imports", {
  id: text().primaryKey(), source: text({ enum: ["slack", "github"] }).notNull(), month: text().notNull(),
  r2_key: text().notNull(), channel_id: text(), item_count: integer().notNull(),
  imported_at: text().notNull(), expires_at: text().notNull(),
});
export const monthly_stats = sqliteTable("monthly_stats", {
  member_id: text().notNull().references(() => members.id), month: text().notNull(),
  commits: integer().notNull().default(0), prs_opened: integer().notNull().default(0),
  prs_merged: integer().notNull().default(0), reviews: integer().notNull().default(0),
  review_comments: integer().notNull().default(0), issues_opened: integer().notNull().default(0),
  doc_changes: integer().notNull().default(0), posts: integer().notNull().default(0),
  thread_replies: integer().notNull().default(0), question_replies: integer().notNull().default(0),
  reactions_given: integer().notNull().default(0), reactions_given_people: integer().notNull().default(0),
  reactions_received: integer().notNull().default(0), thanks_received: integer().notNull().default(0),
  first_greetings: integer().notNull().default(0), active_weeks: integer().notNull().default(0),
  weeks_in_month: integer().notNull(), peak_hour: integer(), top_emoji: text(),
  firsts: text({ mode: "json" }).$type<string[]>().notNull().default([]),
}, t => [primaryKey({ columns: [t.member_id, t.month] })]);
export const seeds = sqliteTable("seeds", {
  id: text().primaryKey(), member_id: text().notNull().references(() => members.id), month: text().notNull(),
  kind: text().notNull(), score: real().notNull(), summary: text().notNull(),
  metrics: text({ mode: "json" }).$type<Record<string, number>>().notNull(), created_at: text().notNull(),
});
export const tips = sqliteTable("tips", {
  id: text().primaryKey(), target_member_id: text().notNull().references(() => members.id),
  sender_member_id: text().notNull().references(() => members.id), is_anonymous: integer({ mode: "boolean" }).notNull(),
  body: text().notNull(), links: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  status: text({ enum: ["received", "adopted", "declined", "withdrawn"] }).notNull().default("received"),
  decided_by: text().references(() => members.id), created_at: text().notNull(), decided_at: text(),
});
export const evidences = sqliteTable("evidences", {
  id: text().primaryKey(), seed_id: text().references(() => seeds.id), tip_id: text().references(() => tips.id),
  source: text({ enum: ["slack", "github", "tip"] }).notNull(), author_member_id: text().references(() => members.id),
  url: text(), excerpt: text({ length: 200 }), occurred_at: text().notNull(),
});
export const issues = sqliteTable("issues", {
  id: text().primaryKey(), kind: text({ enum: ["monthly", "annual"] }).notNull(), target: text().notNull(),
  number: integer().notNull().unique(), title: text().notNull(), editor_note: text(),
  status: text({ enum: ["editing", "published"] }).notNull().default("editing"), published_at: text(),
}, t => [uniqueIndex("issues_kind_target_unique").on(t.kind, t.target)]);
export const articles = sqliteTable("articles", {
  id: text().primaryKey(), slug: text({ length: 12 }).notNull().unique(), member_id: text().notNull().references(() => members.id),
  issue_id: text().references(() => issues.id),
  status: text({ enum: ["draft", "selected", "unselected", "published", "retracted", "hidden"] }).notNull().default("draft"),
  headline: text().notNull(), body: text().notNull(), reporter_comment: text().notNull(),
  main_seed_id: text().notNull().references(() => seeds.id), seed_ids: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  tip_ids: text({ mode: "json" }).$type<string[]>().notNull().default([]), sort_order: integer().notNull().default(0),
  is_top: integer({ mode: "boolean" }).notNull().default(false),
  lint_warnings: text({ mode: "json" }).$type<string[]>().notNull().default([]), generated_at: text().notNull(),
  edited_by: text().references(() => members.id), published_at: text(), retracted_at: text(), hidden_at: text(), updated_at: text(),
}, t => [index("articles_issue_status_idx").on(t.issue_id, t.status)]);
export const notices = sqliteTable("notices", {
  id: text().primaryKey(), issue_id: text().notNull().references(() => issues.id),
  article_id: text().notNull().references(() => articles.id), member_id: text().notNull().references(() => members.id),
  message: text().notNull(), sent_at: text(),
});
export const regeneration_requests = sqliteTable("regeneration_requests", {
  id: text().primaryKey(), article_id: text().notNull().references(() => articles.id), note: text().notNull(),
  status: text({ enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"), created_at: text().notNull(),
});
