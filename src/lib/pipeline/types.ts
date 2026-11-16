import type * as schema from "../../db/schema";

export type Member = typeof schema.members.$inferSelect;
export type Stats = typeof schema.monthly_stats.$inferSelect;
export type Tip = typeof schema.tips.$inferSelect;
export type Seed = Omit<typeof schema.seeds.$inferSelect, "created_at">;
export type Evidence = Omit<typeof schema.evidences.$inferSelect, "id" | "seed_id">;
export type Kind = `K-${string}`;
export interface Reaction { name: string; users: string[]; count?: number; timestamps?: Record<string, string> }
export interface Message {
  ts: string; user?: string; text?: string; thread_ts?: string; subtype?: string; bot_id?: string;
  username?: string; reactions?: Reaction[]; replies?: Message[];
}
export interface SlackChannel { channel_id: string; messages: Message[]; workspace_url?: string }
export interface ChannelIndex {
  channels: { id: string; name?: string; is_private?: boolean; is_im?: boolean; is_mpim?: boolean }[];
  channel_joins: { user: string; ts: string; channel_id?: string }[];
  users?: { id: string; display_name?: string; real_name?: string; avatar_url?: string; is_bot?: boolean }[];
  workspace_url?: string;
}
export type EventKind = "commit" | "pr_opened" | "pr_merged" | "review" | "review_comment" | "issue_opened";
export interface GitHubEvent {
  id: string; kind: EventKind; actor: string; occurred_at: string; repository: string;
  url?: string; text?: string; files?: string[]; target_author?: string; is_bot?: boolean;
}
export interface Signal { member_id: string; kind: Kind; evidence: Evidence; value?: number }
export interface Aggregation { stats: Stats[]; signals: Signal[] }
export interface Draft { headline: string; body: string; reporter_comment: string }
