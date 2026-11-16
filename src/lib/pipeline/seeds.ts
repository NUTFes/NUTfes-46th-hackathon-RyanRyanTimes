import type { Aggregation, Evidence, Kind, Member, Seed, Stats, Tip } from "./types";
import { eligible, metrics } from "./aggregate";
import { monthBounds } from "./validation";

export const thresholds = { development_fraction: 0.1, development_min_people: 3, posts_fraction: 0.1, reviews: 5, questions: 3, greetings: 3, reactions: 30, reaction_people: 5, growth_ratio: 2, growth_min: 5, popular_posts: 5, thanks: 3, issues: 3, docs: 1 };
export const metricLabels: Record<string, string> = { commits: "コミット", prs_opened: "PR作成", prs_merged: "PRマージ", reviews: "レビュー", review_comments: "レビューコメント", issues_opened: "課題の起票", doc_changes: "文書の更新", posts: "投稿", thread_replies: "スレッド返信", question_replies: "質問への返信", reactions_given: "贈ったリアクション", reactions_given_people: "応援した相手の人数", reactions_received: "届いたリアクション", thanks_received: "届いた感謝", first_greetings: "最初の歓迎", firsts: "初挑戦", popular_posts: "反応を集めた投稿", reactions: "投稿へのリアクション", active_weeks: "活動した週数", weeks_in_month: "対象月の週数", adopted_tips: "採用タレコミ", previous_average: "直近の平均" };
export const labels: Record<Kind, string> = { "K-01": "開発を重ねた", "K-02": "活動を発信した", "K-03": "レビューで支えた", "K-04": "質問に答えた", "K-05": "一番乗りで迎えた", "K-06": "リアクションで応援した", "K-07": "活動の幅が伸びた", "K-08": "はじめての一歩を刻んだ", "K-09": "投稿に反応が届いた", "K-10": "感謝の言葉が届いた", "K-11": "毎週の足跡を残した", "K-12": "仲間から推薦された", "K-13": "課題を見つけた", "K-14": "ドキュメントを書いた" };
export interface Publication { member_id: string; issue_id: string }
export function scoreSeed(kind: Kind, ratio: number, publications: Publication[], recentIssues: string[], memberId: string) {
  const published = publications.filter(p => p.member_id === memberId);
  return (kind === "K-12" ? 1000 : 10) + Math.min(Math.max(ratio - 1, 0), 100) + (published.some(p => recentIssues.includes(p.issue_id)) ? 0 : 5) + (published.length ? 0 : 5);
}
export function detectSeeds(month: string, members: Member[], aggregation: Aggregation, history: Stats[], tips: Tip[], publications: Publication[] = [], recentIssues: string[] = [], config = thresholds): { seed: Seed; evidences: Evidence[] }[] {
  const people = new Set(members.filter(eligible).map(m => m.id));
  const stats = aggregation.stats.filter(s => people.has(s.member_id));
  const active = stats.filter(s => metrics.some(k => s[k] > 0));
  function leaders(metric: "commits" | "prs_opened" | "reviews" | "posts", fraction: number, minimum = 1) {
    const sorted = [...active].sort((a, b) => b[metric] - a[metric] || a.member_id.localeCompare(b.member_id));
    // 同数は同じ判定にする。ゼロ件は種にしない。
    const cutoff = sorted[Math.min(sorted.length, Math.max(minimum, Math.ceil(active.length * fraction))) - 1]?.[metric] ?? Infinity;
    return { ids: new Set(sorted.filter(s => s[metric] > 0 && s[metric] >= cutoff).map(s => s.member_id)), cutoff };
  }
  const developmentMetrics = ["commits", "prs_opened", "reviews"] as const;
  const development = developmentMetrics.map(k => leaders(k, config.development_fraction, config.development_min_people));
  const posts = leaders("posts", config.posts_fraction);
  const popular = [...aggregation.signals].filter(s => s.kind === "K-09" && people.has(s.member_id)).sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.evidence.occurred_at.localeCompare(b.evidence.occurred_at)).slice(0, config.popular_posts);
  const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5));
  const { start, end } = monthBounds(month);
  const output: { seed: Seed; evidences: Evidence[] }[] = [];
  for (const s of stats) {
    const prior = history.filter(p => p.member_id === s.member_id && monthIndex(month) - monthIndex(p.month) >= 1 && monthIndex(month) - monthIndex(p.month) <= 3);
    const adopted = tips.filter(t => t.target_member_id === s.member_id && t.status === "adopted" && Date.parse(t.decided_at ?? t.created_at) >= start && Date.parse(t.decided_at ?? t.created_at) < end && people.has(t.sender_member_id));
    function add(kind: Kind, values: Record<string, number>, ratio: number) {
      const candidates = (kind === "K-09" ? popular : aggregation.signals).filter(e => e.member_id === s.member_id && e.kind === kind).map(e => e.evidence);
      if (kind === "K-12") candidates.push(...adopted.map(t => ({ source: "tip" as const, tip_id: t.id, author_member_id: t.is_anonymous ? null : t.sender_member_id, url: t.links[0] ?? null, excerpt: [...t.body].slice(0, 200).join(""), occurred_at: t.created_at })));
      const evidences = [...new Map(candidates.map(e => [`${e.source}:${e.url}:${e.occurred_at}:${e.excerpt}`, e])).values()];
      if (!evidences.length) return;
      const summary = `${labels[kind]}（${Object.entries(values).map(([k, v]) => `${metricLabels[k] ?? k}: ${Number(v.toFixed(2))}`).join("、")}）`;
      output.push({ seed: { id: `pipeline:${month}:${s.member_id}:${kind}`, member_id: s.member_id, month, kind, score: scoreSeed(kind, ratio, publications, recentIssues, s.member_id), summary, metrics: values }, evidences });
    }
    if (development.some(rank => rank.ids.has(s.member_id))) add("K-01", { commits: s.commits, prs_opened: s.prs_opened, reviews: s.reviews }, Math.max(...development.map((rank, i) => s[developmentMetrics[i]] / Math.max(rank.cutoff, 1))));
    if (posts.ids.has(s.member_id)) add("K-02", { posts: s.posts }, s.posts / Math.max(posts.cutoff, 1));
    if (s.reviews + s.review_comments >= config.reviews) add("K-03", { reviews: s.reviews, review_comments: s.review_comments }, (s.reviews + s.review_comments) / config.reviews);
    if (s.question_replies >= config.questions) add("K-04", { question_replies: s.question_replies }, s.question_replies / config.questions);
    if (s.first_greetings >= config.greetings) add("K-05", { first_greetings: s.first_greetings }, s.first_greetings / config.greetings);
    if (s.reactions_given >= config.reactions && s.reactions_given_people >= config.reaction_people) add("K-06", { reactions_given: s.reactions_given, reactions_given_people: s.reactions_given_people }, s.reactions_given / config.reactions);
    if (prior.length) for (const metric of metrics) {
      const average = prior.reduce((n, p) => n + p[metric], 0) / prior.length;
      if (s[metric] >= config.growth_min && s[metric] >= average * config.growth_ratio) { add("K-07", { [metric]: s[metric], previous_average: average }, average ? s[metric] / average : s[metric]); break; }
    }
    if (s.firsts.length) add("K-08", { firsts: s.firsts.length }, s.firsts.length);
    const popularCount = popular.filter(p => p.member_id === s.member_id).length;
    if (popularCount) add("K-09", { popular_posts: popularCount, reactions: Math.max(...popular.filter(p => p.member_id === s.member_id).map(p => p.value ?? 0)) }, popularCount);
    if (s.thanks_received >= config.thanks) add("K-10", { thanks_received: s.thanks_received }, s.thanks_received / config.thanks);
    if (s.active_weeks === s.weeks_in_month) add("K-11", { active_weeks: s.active_weeks, weeks_in_month: s.weeks_in_month }, 1);
    if (adopted.length) add("K-12", { adopted_tips: adopted.length }, adopted.length);
    if (s.issues_opened >= config.issues) add("K-13", { issues_opened: s.issues_opened }, s.issues_opened / config.issues);
    if (s.doc_changes >= config.docs) add("K-14", { doc_changes: s.doc_changes }, s.doc_changes / config.docs);
  }
  return output.sort((a, b) => b.seed.score - a.seed.score || a.seed.id.localeCompare(b.seed.id));
}
