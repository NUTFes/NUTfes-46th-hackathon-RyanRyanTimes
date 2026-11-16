// 実在のアカウントやURLを含まない、再生成可能な検証用データ。
import { mkdir, writeFile } from "node:fs/promises";
const write = (name, value) => writeFile(`tests/fixtures/${name}`, JSON.stringify(value, null, 2) + "\n");
await mkdir("tests/fixtures/slack-2026-11", { recursive: true });
const ts = (date) => String(Date.parse(date) / 1000) + ".000000";
const members = Array.from({ length: 8 }, (_, i) => ({
  id: `fixture-member-${i + 1}`, slack_user_id: `FIXTURE_U${i + 1}`, display_name: `架空・局員${i + 1}`,
  real_name: null, avatar_url: null, github_login: i === 7 || i === 6 ? null : `fixture-user-${i + 1}`,
  joined_at: i === 1 ? "2026-04-01" : "2023-04-01", joined_at_source: "manual", is_editor: false, is_active: true,
  opted_out_at: i === 6 ? "2026-10-01T00:00:00Z" : null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
}));
members[6].display_name = "";
await write("members.json", members);
const channels = { channels: [{ id: "FIXTURE_C1", name: "架空の公開チャンネル" }],
  channel_joins: members.map((m, i) => ({ user: m.slack_user_id, ts: ts(i === 1 ? "2026-04-01T00:00:00Z" : "2023-04-01T00:00:00Z"), channel_id: "FIXTURE_C1" })),
  users: members.map((m, i) => ({ id: m.slack_user_id, display_name: `架空・局員${i + 1}`, is_bot: i === 7 })),
};
await write("slack-2026-11/_channels.json", channels);
const messages = [];
for (const d of [1, 2, 9, 16, 23, 30]) messages.push({ user: "FIXTURE_U1", ts: ts(`2026-11-${String(d).padStart(2, "0")}T03:00:00Z`), text: "架空の活動記録を共有した。" });
messages[0].reactions = [{ name: "heart", users: ["FIXTURE_U1", "FIXTURE_U2", "FIXTURE_U3", "FIXTURE_U4", "FIXTURE_U5", "FIXTURE_U6", "FIXTURE_U7", "FIXTURE_U8"] }];
for (let i = 0; i < 3; i++) {
  const root = ts(`2026-11-0${i + 3}T03:00:00Z`);
  messages.push({ user: "FIXTURE_U2", ts: root, text: "架空の手順を教えて？", replies: [
    { user: "FIXTURE_U1", ts: ts(`2026-11-0${i + 3}T03:01:00Z`), text: "架空の手順はこちらです。" },
    { user: "FIXTURE_U2", ts: ts(`2026-11-0${i + 3}T03:02:00Z`), text: "ありがとう、助かる！" },
  ] });
}
for (let u = 2; u <= 6; u++) for (let n = 0; n < 6; n++) messages.push({ user: `FIXTURE_U${u}`, ts: ts(`2026-11-${10 + n}T0${u}:00:00Z`), text: "架空の共有メモ。", reactions: [{ name: n === 0 ? "pray" : "heart", users: ["FIXTURE_U1"] }] });
messages.push({ user: "FIXTURE_U7", ts: ts("2026-11-20T01:00:00Z"), text: "除外対象の投稿", reactions: [{ name: "pray", users: ["FIXTURE_U1"] }] });
messages.push({ user: "FIXTURE_U8", bot_id: "FIXTURE_BOT", subtype: "bot_message", ts: ts("2026-11-20T02:00:00Z"), text: "ボットの投稿" });
await write("slack-2026-11/FIXTURE_C1.json", { ok: true, messages });
const events = [];
const event = (kind, i, extra = {}) => ({ id: `fixture:${kind}:${i}`, kind, actor: "fixture-user-1", occurred_at: `2026-11-${String(i + 2).padStart(2, "0")}T04:00:00Z`, repository: "fictional/example", text: "架空の開発活動", ...extra });
for (let i = 0; i < 6; i++) events.push(event("commit", i, { files: i === 0 ? ["docs/guide.md"] : ["src/example.ts"] }));
for (let i = 0; i < 5; i++) events.push(event("review", i, { target_author: "fixture-user-2" }));
events.push(event("review_comment", 0, { target_author: "fixture-user-2" }));
for (let i = 0; i < 3; i++) events.push(event("issue_opened", i));
events.push(event("pr_opened", 0, { files: ["README.md"] }), event("pr_merged", 0));
events.push(event("commit", 20, { actor: "fixture-bot[bot]", is_bot: true }), event("review", 21, { target_author: "fixture-user-1" }));
await write("github-2026-11.json", events);
const metricNames = ["commits", "prs_opened", "prs_merged", "reviews", "review_comments", "issues_opened", "doc_changes", "posts", "thread_replies", "question_replies", "reactions_given", "reactions_given_people", "reactions_received", "thanks_received", "first_greetings"];
await write("history.json", [{ member_id: members[0].id, month: "2026-10", ...Object.fromEntries(metricNames.map(k => [k, k === "commits" ? 2 : 0])), active_weeks: 1, weeks_in_month: 5, peak_hour: 12, top_emoji: null, firsts: ["metric:commits", "repository:fictional/previous"] }]);
await write("tips.json", [{ id: "fixture-tip-1", target_member_id: members[0].id, sender_member_id: members[2].id, is_anonymous: true, body: "架空の資料を読みやすくまとめてくれた。", links: [], status: "adopted", decided_by: null, created_at: "2026-11-15T00:00:00Z", decided_at: "2026-11-16T00:00:00Z" }]);
