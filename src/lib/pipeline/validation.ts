import type { ChannelIndex, GitHubEvent, Message, SlackChannel } from "./types";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`入力が不正です: ${message}`);
}
export function monthBounds(month: string) {
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), "対象月は YYYY-MM");
  const [year, m] = month.split("-").map(Number);
  const start = Date.UTC(year, m - 1, 1) - 9 * 3600000;
  const end = Date.UTC(year, m, 1) - 9 * 3600000;
  return { start, end };
}
export function slackDate(ts: string) { return new Date(Number(ts) * 1000).toISOString(); }
export function flatten(messages: Message[]): Message[] {
  const result = new Map<string, Message>();
  function visit(message: Message, parent?: string) {
    const normalized = { ...message, thread_ts: message.thread_ts ?? parent };
    const existing = result.get(message.ts);
    result.set(message.ts, { ...existing, ...normalized, thread_ts: normalized.thread_ts ?? existing?.thread_ts });
    for (const reply of message.replies ?? []) visit(reply, message.ts);
  }
  for (const message of messages) visit(message);
  return [...result.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
}
export function validateSlack(value: unknown, channelId: string): SlackChannel {
  check(value && typeof value === "object", channelId);
  const data = value as SlackChannel & { ok?: boolean; has_more?: boolean; response_metadata?: { next_cursor?: string } };
  check(data.ok !== false && !data.has_more && !data.response_metadata?.next_cursor, "全ページをまとめてください");
  check(Array.isArray(data.messages), "messages 配列が必要です");
  function message(m: Message) {
    check(m && /^\d+(\.\d+)?$/.test(m.ts) && Number.isFinite(Number(m.ts)) && Number.isFinite(new Date(Number(m.ts) * 1000).getTime()), "投稿の ts");
    check(m.user === undefined || typeof m.user === "string", "投稿の user");
    check(m.text === undefined || typeof m.text === "string", "投稿の text");
    check(!m.thread_ts || /^\d+(\.\d+)?$/.test(m.thread_ts), "thread_ts");
    check(!m.reactions || Array.isArray(m.reactions), "reactions");
    for (const r of m.reactions ?? []) {
      check(typeof r.name === "string" && Array.isArray(r.users) && r.users.every(u => typeof u === "string"), "reaction.users");
      for (const ts of Object.values(r.timestamps ?? {})) check(/^\d+(\.\d+)?$/.test(ts), "reaction.timestamps");
    }
    check(!m.replies || Array.isArray(m.replies), "replies");
    for (const r of m.replies ?? []) { check(typeof r.text === "string", "replies は本文を含む完全な投稿が必要です"); message(r); }
  }
  data.messages.forEach(message);
  check(!data.channel_id || data.channel_id === channelId, "ファイル名と channel_id が一致しません");
  return { channel_id: channelId, messages: flatten(data.messages), workspace_url: data.workspace_url };
}
export function validateChannels(value: unknown): ChannelIndex {
  check(value && typeof value === "object", "_channels.json");
  const data = value as ChannelIndex;
  check(Array.isArray(data.channels) && Array.isArray(data.channel_joins), "channels と channel_joins が必要です");
  for (const c of data.channels) check(typeof c.id === "string" && /^[A-Za-z0-9_-]+$/.test(c.id) && !c.is_private && !c.is_im && !c.is_mpim, "公開チャンネルだけ指定できます");
  check(new Set(data.channels.map(c => c.id)).size === data.channels.length, "チャンネルIDの重複");
  for (const j of data.channel_joins) check(typeof j.user === "string" && /^\d+(\.\d+)?$/.test(j.ts) && Number.isFinite(new Date(Number(j.ts) * 1000).getTime()) && (!j.channel_id || data.channels.some(c => c.id === j.channel_id)), "channel_join");
  check(!data.users || (Array.isArray(data.users) && data.users.every(u => typeof u.id === "string" && (!u.display_name || typeof u.display_name === "string"))), "users");
  if (data.workspace_url) check(/^https:\/\/[a-z0-9-]+\.slack\.com\/?$/.test(data.workspace_url), "workspace_url");
  return data;
}
export function validateGitHub(value: unknown): GitHubEvent[] {
  check(Array.isArray(value), "GitHub は正規化イベントの配列です");
  const kinds = ["commit", "pr_opened", "pr_merged", "review", "review_comment", "issue_opened"];
  const ids = new Set<string>();
  for (const e of value as GitHubEvent[]) {
    check(e && typeof e.id === "string" && !ids.has(e.id), "GitHub イベントIDの重複または欠落"); ids.add(e.id);
    check(kinds.includes(e.kind) && typeof e.actor === "string" && typeof e.repository === "string" && typeof e.occurred_at === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(e.occurred_at) && Number.isFinite(Date.parse(e.occurred_at)), "GitHub イベント");
    check(!e.files || (Array.isArray(e.files) && e.files.every(f => typeof f === "string")), "変更ファイル");
    check(e.text === undefined || typeof e.text === "string", "GitHub text");
    if (["review", "review_comment"].includes(e.kind)) check(typeof e.target_author === "string" && e.target_author.length > 0, "レビュー対象の作者が必要です");
    check(e.url === undefined || (typeof e.url === "string" && /^https:\/\//.test(e.url)), "GitHub URL");
  }
  return value as GitHubEvent[];
}
