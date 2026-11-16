import type { Aggregation, GitHubEvent, Kind, Member, Message, SlackChannel, Stats } from "./types";
import { flatten, monthBounds, slackDate } from "./validation";

export const questionWords = /[？?]|教えて|わから|どうすれば|詰まって|エラー/;
export const thanksWords = /ありがとう|ありがと|助かり|助かる|感謝/;
export const metrics = ["commits", "prs_opened", "prs_merged", "reviews", "review_comments", "issues_opened", "doc_changes", "posts", "thread_replies", "question_replies", "reactions_given", "reactions_given_people", "reactions_received", "thanks_received", "first_greetings"] as const;
type Metric = typeof metrics[number];
const day = 86400000;
// 月曜始まり。月初・月末の端数週もその月の週として数える。
export function weekKey(time: number) {
  const date = new Date(time + 9 * 3600000);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return midnight - ((date.getUTCDay() + 6) % 7) * day;
}
export function isNewcomer(member: Pick<Member, "joined_at">, month: string) {
  const { end } = monthBounds(month);
  const cutoff = new Date(end + 9 * 3600000); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return !!member.joined_at && Date.parse(member.joined_at) >= cutoff.getTime() - 9 * 3600000 && Date.parse(member.joined_at) < end;
}
export function eligible(member: Member) { return !member.opted_out_at && member.is_active; }
export function aggregate(month: string, members: Member[], channels: SlackChannel[], events: GitHubEvent[], history: Stats[] = []): Aggregation {
  const { start, end } = monthBounds(month);
  const within = (time: number) => time >= start && time < end;
  const weeksInMonth = new Set(Array.from({ length: Math.ceil((end - start) / day) }, (_, i) => weekKey(start + i * day))).size;
  const botIds = new Set(channels.flatMap(c => flatten(c.messages).filter(m => m.bot_id || m.subtype === "bot_message").map(m => m.user)));
  const people = members.filter(m => eligible(m) && !botIds.has(m.slack_user_id));
  const bySlack = new Map(people.map(m => [m.slack_user_id, m]));
  const byGitHub = new Map(people.filter(m => m.github_login).map(m => [m.github_login!.toLowerCase(), m]));
  const excludedGitHub = new Set([...members.filter(m => !eligible(m)).flatMap(m => m.github_login ? [m.github_login.toLowerCase()] : []), ...events.filter(e => e.is_bot).map(e => e.actor.toLowerCase())]);
  const result: Aggregation = { stats: [], signals: [] };
  const state = new Map(people.map(m => {
    const zero = Object.fromEntries(metrics.map(k => [k, 0])) as Record<Metric, number>;
    const stats: Stats = { member_id: m.id, month, ...zero, active_weeks: 0, weeks_in_month: weeksInMonth, peak_hour: null, top_emoji: null, firsts: [] };
    result.stats.push(stats);
    return [m.id, { stats, weeks: new Set<number>(), hours: new Map<number, number>(), emoji: new Map<string, number>(), recipients: new Set<string>() }];
  }));
  function activity(id: string, time: number) {
    const s = state.get(id)!;
    s.weeks.add(weekKey(time));
    const hour = new Date(time + 9 * 3600000).getUTCHours();
    s.hours.set(hour, (s.hours.get(hour) ?? 0) + 1);
  }
  function signal(id: string, kinds: Kind[], source: "slack" | "github", author: string, text: string, time: number, url?: string) {
    for (const kind of kinds) result.signals.push({ member_id: id, kind, evidence: { source, author_member_id: author, excerpt: [...text].slice(0, 200).join(""), occurred_at: new Date(time).toISOString(), url: url ?? null, tip_id: null } });
  }
  for (const channel of channels) {
    const messages = flatten(channel.messages).filter(m => m.user && bySlack.has(m.user) && !m.bot_id && m.subtype !== "bot_message" && (!m.subtype || ["thread_broadcast", "me_message"].includes(m.subtype)));
    const byTs = new Map(messages.map(m => [m.ts, m]));
    const threads = new Map<string, Message[]>();
    for (const m of messages) if (m.thread_ts && m.thread_ts !== m.ts) threads.set(m.thread_ts, [...(threads.get(m.thread_ts) ?? []), m]);
    const url = (m: Message) => channel.workspace_url ? `${channel.workspace_url.replace(/\/$/, "")}/archives/${channel.channel_id}/p${m.ts.replace(".", "").padEnd(16, "0")}` : undefined;
    const ev = (id: string, kinds: Kind[], m: Message) => signal(id, kinds, "slack", bySlack.get(m.user!)!.id, m.text ?? "", Number(m.ts) * 1000, url(m));
    for (const m of messages) {
      const time = Number(m.ts) * 1000;
      if (!within(time)) continue;
      // 除外された親投稿から返信本文や指標が漏れないよう、親が読めるスレッドだけ使う。
      const reply = !!m.thread_ts && m.thread_ts !== m.ts;
      const parent = reply ? byTs.get(m.thread_ts!) : undefined;
      if (reply && !parent) continue;
      const member = bySlack.get(m.user!)!; const s = state.get(member.id)!;
      s.stats[reply ? "thread_replies" : "posts"]++;
      activity(member.id, time); ev(member.id, ["K-02", "K-07", "K-11"], m);
      if (parent && parent.user !== m.user && questionWords.test(parent.text ?? "")) { s.stats.question_replies++; ev(member.id, ["K-04"], m); }
      const reactions = (m.reactions ?? []).flatMap(r => [...new Set(r.users)].filter(u => u !== m.user && bySlack.has(u) && (!r.timestamps?.[u] || within(Number(r.timestamps[u]) * 1000))).map(u => ({ reaction: r, user: u })));
      s.stats.reactions_received += reactions.length;
      if (reactions.length) { ev(member.id, ["K-09"], m); result.signals[result.signals.length - 1].value = reactions.length; }
      for (const { reaction: r, user } of reactions) {
        const giver = state.get(bySlack.get(user)!.id)!;
        giver.stats.reactions_given++; giver.recipients.add(member.id);
        giver.emoji.set(r.name, (giver.emoji.get(r.name) ?? 0) + 1);
        if (r.timestamps?.[user]) activity(giver.stats.member_id, Number(r.timestamps[user]) * 1000);
        // Slack history の通常のリアクションには日時がない。週の継続判定には使わない。
        ev(giver.stats.member_id, ["K-06", "K-07"], m);
        if (/pray|arigatou|ありがとう/i.test(r.name)) { s.stats.thanks_received++; ev(member.id, ["K-10"], m); }
      }
    }
    for (const [parentTs, replies] of threads) {
      const root = byTs.get(parentTs); if (!root) continue;
      const sequence = [root, ...replies].sort((a, b) => Number(a.ts) - Number(b.ts));
      for (let i = 1; i < sequence.length; i++) {
        const current = sequence[i]; const previous = sequence[i - 1];
        if (current.user !== previous.user && within(Number(current.ts) * 1000) && thanksWords.test(current.text ?? "")) {
          const id = bySlack.get(previous.user!)!.id;
          state.get(id)!.stats.thanks_received++; ev(id, ["K-10"], current);
        }
      }
    }
    for (const root of messages.filter(m => !m.thread_ts || m.thread_ts === m.ts)) {
      if (!isNewcomer(bySlack.get(root.user!)!, month) || !within(Number(root.ts) * 1000)) continue;
      const candidates = (threads.get(root.ts) ?? []).filter(m => m.user !== root.user).map(m => ({ user: m.user!, ts: m.ts, message: m }));
      for (const r of root.reactions ?? []) for (const u of new Set(r.users)) {
        if (u !== root.user && bySlack.has(u) && r.timestamps?.[u]) candidates.push({ user: u, ts: r.timestamps[u], message: root });
      }
      candidates.sort((a, b) => Number(a.ts) - Number(b.ts) || a.user.localeCompare(b.user));
      const first = candidates[0];
      if (first && within(Number(first.ts) * 1000)) { const id = bySlack.get(first.user)!.id; state.get(id)!.stats.first_greetings++; ev(id, ["K-05"], first.message); }
    }
  }
  const eventMetric: Record<GitHubEvent["kind"], Metric> = { commit: "commits", pr_opened: "prs_opened", pr_merged: "prs_merged", review: "reviews", review_comment: "review_comments", issue_opened: "issues_opened" };
  const sorted = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id.localeCompare(b.id));
  const seenEvents = new Set<string>();
  const seen = new Map(people.map(m => [m.id, new Set(history.filter(s => s.member_id === m.id && s.month < month).flatMap(s => [
    ...s.firsts, ...(["commits", "prs_opened", "prs_merged", "reviews"] as const).filter(k => s[k] > 0).map(k => `metric:${k}`),
  ]))]));
  for (const event of sorted) {
    if (seenEvents.has(event.id) || event.is_bot || /\[bot\]$/i.test(event.actor)) continue; seenEvents.add(event.id);
    const member = byGitHub.get(event.actor.toLowerCase()); const time = Date.parse(event.occurred_at);
    if (!member || time >= end) continue;
    const reviewing = ["review", "review_comment"].includes(event.kind);
    const selfReview = reviewing && event.target_author?.toLowerCase() === event.actor.toLowerCase();
    if (selfReview || (reviewing && event.target_author && (excludedGitHub.has(event.target_author.toLowerCase()) || /\[bot\]$/i.test(event.target_author)))) continue;
    const metric = eventMetric[event.kind]; const past = seen.get(member.id)!;
    const markers = [...(["commit", "pr_opened", "pr_merged", "review"].includes(event.kind) ? [`metric:${metric}`] : []), `repository:${event.repository}`];
    const firsts = markers.filter(k => !past.has(k)); markers.forEach(k => past.add(k));
    if (!within(time)) continue;
    const s = state.get(member.id)!; const kinds: Kind[] = ["K-01", "K-07", "K-11"];
    if (!selfReview) s.stats[metric]++;
    if (!selfReview && ["review", "review_comment"].includes(event.kind)) kinds.push("K-03");
    if (event.kind === "issue_opened") kinds.push("K-13");
    if (["commit", "pr_opened"].includes(event.kind) && event.files?.some(f => /(^|\/)readme(?:\.|$)|(^|\/)docs\/|\.md$/i.test(f))) { s.stats.doc_changes++; kinds.push("K-14"); }
    if (firsts.length && !selfReview) { s.stats.firsts.push(...firsts); kinds.push("K-08"); }
    activity(member.id, time);
    signal(member.id, kinds, "github", member.id, event.text ?? `${event.kind}: ${event.repository}`, time, event.url);
  }
  for (const s of state.values()) {
    s.stats.active_weeks = s.weeks.size; s.stats.reactions_given_people = s.recipients.size;
    const top = <T extends string | number>(map: Map<T, number>) => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
    s.stats.peak_hour = top(s.hours); s.stats.top_emoji = top(s.emoji);
  }
  return result;
}
