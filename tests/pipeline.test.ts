import { describe, expect, it } from "vitest";
import membersJson from "./fixtures/members.json";
import slackJson from "./fixtures/slack-2026-11/FIXTURE_C1.json";
import indexJson from "./fixtures/slack-2026-11/_channels.json";
import githubJson from "./fixtures/github-2026-11.json";
import historyJson from "./fixtures/history.json";
import tipsJson from "./fixtures/tips.json";
import type { Member, Stats, Tip } from "../src/lib/pipeline/types";
import { aggregate, isNewcomer, metrics } from "../src/lib/pipeline/aggregate";
import { detectSeeds, scoreSeed } from "../src/lib/pipeline/seeds";
import { buildPrompt, lintDraft, lintRules, templateDraft, validateDraft } from "../src/lib/pipeline/drafts";
import { flatten, monthBounds, validateChannels, validateGitHub, validateSlack } from "../src/lib/pipeline/validation";
import { generateDraft } from "../scripts/gemini";

const members = membersJson as Member[];
const slack = validateSlack(slackJson, "FIXTURE_C1");
const events = validateGitHub(githubJson);
const history = historyJson as Stats[];
const tips = tipsJson as Tip[];
const result = () => aggregate("2026-11", members, [slack], events, history);
const candidates = () => detectSeeds("2026-11", members, result(), history, tips);
const ts = (date: string) => String(Date.parse(date) / 1000);

describe("月次集計", () => {
  it("全指標と K-01〜K-14 の根拠を架空データから作る", () => {
    const data = result(); const hero = data.stats.find(s => s.member_id === members[0].id)!;
    expect(hero).toMatchObject({ commits: 6, prs_opened: 1, prs_merged: 1, reviews: 5, review_comments: 1, issues_opened: 3, doc_changes: 2, posts: 6, thread_replies: 3, question_replies: 3, reactions_given: 30, reactions_given_people: 5, reactions_received: 5, thanks_received: 3, first_greetings: 3, active_weeks: 6, weeks_in_month: 6, peak_hour: 13, top_emoji: "heart" });
    expect(hero.firsts).toContain("metric:reviews"); expect(hero.firsts).not.toContain("metric:commits");
    expect(data.stats.some(s => [members[6].id, members[7].id].includes(s.member_id))).toBe(false);
    expect(candidates().map(s => s.seed.kind)).toEqual(expect.arrayContaining(Array.from({ length: 14 }, (_, i) => `K-${String(i + 1).padStart(2, "0")}`)));
    expect(candidates().every(s => s.evidences.length > 0 && s.evidences.every(e => [...(e.excerpt ?? "")].length <= 200))).toBe(true);
  });
  it("JST の月境界と端数週を数える", () => {
    const boundary = validateSlack({ messages: [
      { ts: ts("2026-10-31T14:59:59Z"), user: members[0].slack_user_id },
      { ts: ts("2026-10-31T15:00:00Z"), user: members[0].slack_user_id },
      { ts: ts("2026-11-30T14:59:59Z"), user: members[0].slack_user_id },
      { ts: ts("2026-11-30T15:00:00Z"), user: members[0].slack_user_id },
    ] }, "FAKE");
    expect(aggregate("2026-11", members, [boundary], []).stats[0]).toMatchObject({ posts: 2, active_weeks: 2, weeks_in_month: 6 });
    expect(monthBounds("2026-11").start).toBe(Date.parse("2026-11-01T00:00:00+09:00"));
  });
  it("自分へのリアクションと除外された親への返信を数えない", () => {
    const c = validateSlack({ messages: [
      { ts: ts("2026-11-01T03:00:00Z"), user: members[0].slack_user_id, reactions: [{ name: "pray", users: [members[0].slack_user_id, members[6].slack_user_id] }] },
      { ts: ts("2026-11-02T03:00:00Z"), user: members[6].slack_user_id, text: "教えて", replies: [{ user: members[0].slack_user_id, ts: ts("2026-11-02T04:00:00Z"), text: "回答" }] },
    ] }, "FAKE");
    expect(aggregate("2026-11", members, [c], []).stats[0]).toMatchObject({ posts: 1, reactions_given: 0, reactions_received: 0, thanks_received: 0, question_replies: 0, thread_replies: 0 });
  });
  it("感謝は直後の他人の返信だけで判定する", () => {
    const root = ts("2026-11-01T03:00:00Z");
    const c = validateSlack({ messages: [{ ts: root, user: members[0].slack_user_id, text: "投稿", replies: [
      { ts: ts("2026-11-01T03:01:00Z"), user: members[1].slack_user_id, text: "別の返信" },
      { ts: ts("2026-11-01T03:02:00Z"), user: members[2].slack_user_id, text: "ありがとう" },
    ] }] }, "FAKE");
    const r = aggregate("2026-11", members, [c], []).stats;
    expect(r[0].thanks_received).toBe(0); expect(r[1].thanks_received).toBe(1);
  });
  it("初挑戦は以前のイベント・集計履歴を参照し、イベント重複を除く", () => {
    const previous = { ...events[0], id: "older", repository: "fictional/example", occurred_at: "2026-10-01T00:00:00Z" };
    const r = aggregate("2026-11", members, [], [previous, ...events, ...events], history).stats[0];
    expect(r.commits).toBe(6); expect(r.firsts).not.toContain("repository:fictional/example");
  });
  it("新入生は対象月末から1年以内", () => {
    expect(isNewcomer(members[1], "2026-11")).toBe(true);
    expect(isNewcomer({ joined_at: "2025-11-30" }, "2026-11")).toBe(false);
    expect(isNewcomer({ joined_at: "2025-12-01" }, "2026-11")).toBe(true);
    expect(isNewcomer({ joined_at: "2026-12-01" }, "2026-11")).toBe(false);
  });
});
describe("種・スコア", () => {
  it("直近3か月の実データだけで成長判定し、履歴がなければ作らない", () => {
    expect(detectSeeds("2026-11", members, result(), [], tips).some(s => s.seed.kind === "K-07")).toBe(false);
    expect(detectSeeds("2026-11", members, result(), [{ ...history[0], month: "2026-07" }], tips).some(s => s.seed.kind === "K-07")).toBe(false);
  });
  it("しきい値未満は拾わず、ゼロ件の順位種を作らない", () => {
    const aggregation = result();
    aggregation.stats = aggregation.stats.map(s => ({ ...s, ...Object.fromEntries(metrics.map(k => [k, 0])), active_weeks: 0, firsts: [] }));
    expect(detectSeeds("2026-11", members, { ...aggregation, signals: [] }, history, [])).toEqual([]);
  });
  it("推薦を最優先にし、最近未掲載・未掲載の人に加点する", () => {
    const publications = [{ member_id: "a", issue_id: "recent" }, { member_id: "b", issue_id: "old" }];
    expect(scoreSeed("K-01", 1, publications, ["recent"], "a")).toBe(10);
    expect(scoreSeed("K-01", 1, publications, ["recent"], "b")).toBe(15);
    expect(scoreSeed("K-01", 1, publications, ["recent"], "c")).toBe(20);
    expect(scoreSeed("K-03", 2, [], [], "a")).toBe(21);
    expect(candidates()[0].seed.kind).toBe("K-12");
  });
  it("採用月とオプトアウトを尊重する", () => {
    const t = { ...tips[0], decided_at: "2026-10-01T00:00:00Z" };
    expect(detectSeeds("2026-11", members, result(), history, [t]).some(s => s.seed.kind === "K-12")).toBe(false);
    expect(detectSeeds("2026-11", members.map(m => ({ ...m, opted_out_at: "2026-11-01" })), result(), history, tips)).toEqual([]);
  });
  it("採用日時はJSTで判定し、しきい値直前の支援指標は拾わない", () => {
    const t = { ...tips[0], decided_at: "2026-10-31T15:00:00Z" };
    expect(detectSeeds("2026-11", members, result(), history, [t]).some(s => s.seed.kind === "K-12")).toBe(true);
    const below = result(); below.stats = [{ ...below.stats[0], reviews: 3, review_comments: 1, question_replies: 2, first_greetings: 2, reactions_given: 29, thanks_received: 2, issues_opened: 2, doc_changes: 0 }];
    const kinds = detectSeeds("2026-11", members, below, [], []).map(s => s.seed.kind);
    for (const kind of ["K-03", "K-04", "K-05", "K-06", "K-07", "K-10", "K-13", "K-14"]) expect(kinds).not.toContain(kind);
  });
  it("投稿の上位5件とパーマリンク・抜粋の上限を守る", () => {
    const c = { ...slack, workspace_url: "https://example.slack.com", messages: slack.messages.map(m => ({ ...m, text: "あ".repeat(250) })) };
    const r = aggregate("2026-11", members, [c], events, history);
    const selected = detectSeeds("2026-11", members, r, history, tips).filter(s => s.seed.kind === "K-09");
    expect(selected.reduce((n, s) => n + s.seed.metrics.popular_posts, 0)).toBe(5);
    const evidence = r.signals.find(s => s.kind === "K-09")!.evidence;
    expect(evidence.excerpt).toHaveLength(200);
    expect(evidence.url).toMatch(/^https:\/\/example.slack.com\/archives\/FIXTURE_C1\/p\d{16}$/);
  });
});
describe("入力検証", () => {
  it("private・不完全なページ・不正な月やイベントを拒否する", () => {
    expect(() => monthBounds("2026-13")).toThrow();
    expect(() => validateChannels({ ...indexJson, channels: [{ id: "PRIVATE", is_private: true }] })).toThrow();
    expect(() => validateSlack({ ...slackJson, has_more: true }, "FIXTURE_C1")).toThrow();
    expect(() => validateSlack({ messages: [{ ts: "bad" }] }, "C")).toThrow();
    expect(() => validateGitHub([{ ...events[0], files: [1] }])).toThrow();
    expect(() => validateGitHub([events[0], events[0]])).toThrow();
    expect(() => validateSlack({ messages: [{ ts: "100", replies: [{ ts: "101", user: "U" }] }] }, "C")).toThrow();
  });
  it("同じスレッド返信の重複を除く", () => {
    expect(flatten([{ ts: "1", replies: [{ ts: "2", text: "返信" }] }, { ts: "2", text: "返信", thread_ts: "1" }])).toHaveLength(2);
  });
});
describe("下書き", () => {
  const prompt = () => {
    const seeds = candidates().filter(s => s.seed.member_id === members[0].id);
    return buildPrompt(members[0], seeds.map(s => s.seed), seeds.flatMap(s => s.evidences), tips, members, { ...result().stats[0], peak_hour: 2 });
  };
  it("根拠最大5件、匿名の送り主を含めず、深夜時刻を渡さない", () => {
    const p = prompt();
    expect(p.input.evidences).toHaveLength(5);
    expect(p.input.tips).toEqual([{ body: tips[0].body }]);
    expect(p.input.flavor.peak_hour).toBeNull();
    expect(p.input.display_name).toBe("架空・局員1さん");
    expect(p.input.main_seed.kind).toBe("K-12");
  });
  it("全キーワードを検査し、日本語の字数を検証する", () => {
    for (const keyword of Object.values(lintRules).flat()) expect(lintDraft({ headline: keyword, body: "", reporter_comment: "" })).not.toEqual([]);
    expect(() => validateDraft({ headline: "a", body: "短い", reporter_comment: "a" })).toThrow();
    const d = templateDraft(prompt()); expect(validateDraft(d)).toEqual(d); expect(lintDraft(d)).toEqual([]);
  });
  it("キーなしならネットワークなしで決定的な下書きを返す", async () => {
    const fetcher = (() => { throw new Error("通信禁止"); }) as typeof fetch;
    expect(await generateDraft(prompt(), { fetcher })).toEqual(templateDraft(prompt()));
  });
  it("JSONモードで送信し、失敗は3回再試行して候補を残す", async () => {
    let calls = 0;
    const fetcher = (async (_url, init) => {
      calls++; expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("fake-key");
      expect(JSON.parse(init!.body as string).generationConfig.responseMimeType).toBe("application/json");
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    expect(await generateDraft(prompt(), { apiKey: "fake-key", fetcher, wait: async () => {} })).toBeNull();
    expect(calls).toBe(4);
  });
  it("不正なJSONや字数も再試行し、正しいJSONを返す", async () => {
    let calls = 0;
    const d = templateDraft(prompt());
    const fetcher = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: ++calls === 1 ? "bad-json" : JSON.stringify(d) }] } }] }))) as typeof fetch;
    expect(await generateDraft(prompt(), { apiKey: "fake", fetcher, wait: async () => {} })).toEqual(d);
    expect(calls).toBe(2);
  });
});
