import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, lt } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { aggregate, eligible } from "../src/lib/pipeline/aggregate";
import { detectSeeds } from "../src/lib/pipeline/seeds";
import { buildPrompt, lintDraft } from "../src/lib/pipeline/drafts";
import { flatten, monthBounds, slackDate, validateChannels, validateGitHub, validateSlack } from "../src/lib/pipeline/validation";
import type { ChannelIndex, GitHubEvent, SlackChannel } from "../src/lib/pipeline/types";
import { generateDraft } from "./gemini";

const [command, ...args] = process.argv.slice(2);
if (args.includes("--remote")) throw new Error("--remote は予約済みです。この作業ではローカル D1/R2 だけを操作します");
const month = args[0];
if (["import:slack", "import:github", "aggregate", "seeds", "drafts", "monthly"].includes(command)) monthBounds(month ?? "");
const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const { env, dispose } = await getPlatformProxy<CloudflareEnv>({ persist: { path: ".wrangler/state/v3" } });
const db = drizzle(env.DB, { schema });
const now = () => new Date().toISOString();

async function store(source: "slack" | "github", target: string, key: string, data: unknown, count: number, channel?: string) {
  const imported = new Date(); const expiry = new Date(imported); expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  await env.RAW.put(key, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
  const row = { id: `pipeline:${key}`, source, month: target, r2_key: key, channel_id: channel ?? null, item_count: count, imported_at: imported.toISOString(), expires_at: expiry.toISOString() };
  // 以前の取り込み実装の行があっても、同じキーは1記録にそろえる。
  await db.batch([db.delete(schema.activity_imports).where(eq(schema.activity_imports.r2_key, key)), db.insert(schema.activity_imports).values(row)]);
}
async function importSlack(target: string, directory: string) {
  if (!directory) throw new Error("Slack JSON のディレクトリが必要です");
  const index = validateChannels(await json(resolve(directory, "_channels.json")));
  const files = (await readdir(directory)).filter(f => f.endsWith(".json") && f !== "_channels.json");
  const entries: SlackChannel[] = [];
  for (const file of files) {
    const id = basename(file, ".json");
    if (!index.channels.some(c => c.id === id)) throw new Error("一覧にないチャンネルのファイルです");
    const channel = validateSlack(await json(resolve(directory, file)), id);
    channel.workspace_url = index.workspace_url;
    entries.push(channel);
  }
  if (index.channels.some(c => !entries.some(e => e.channel_id === c.id))) throw new Error("チャンネルの JSON が不足しています");
  // 検証が全部終わってから書き込む。
  for (const channel of entries) await store("slack", target, `raw/slack/${target}/${channel.channel_id}.json`, channel, channel.messages.length, channel.channel_id);
  await store("slack", target, `raw/slack/${target}/_channels.json`, index, index.channels.length);
}
async function importGitHub(target: string) {
  const fixtureIndex = args.indexOf("--fixture");
  if (fixtureIndex >= 0 && !args[fixtureIndex + 1]) throw new Error("--fixture にファイルを指定してください");
  const data = fixtureIndex >= 0 ? validateGitHub(await json(args[fixtureIndex + 1])) : validateGitHub(await (await import("./github")).fetchGitHub(target));
  await store("github", target, `raw/github/${target}.json`, data, data.length);
}
async function loadRaw(target?: string) {
  const imports = await db.select().from(schema.activity_imports);
  const channels: SlackChannel[] = []; const events: GitHubEvent[] = []; const indexes: ChannelIndex[] = [];
  for (const record of imports.sort((a, b) => a.month.localeCompare(b.month))) {
    // 過去のデータは初挑戦の検出に必要。未来のデータは混ぜない。
    if (target && record.month > target) continue;
    const object = await env.RAW.get(record.r2_key);
    if (!object) throw new Error(`取り込み済みの生データが見つかりません: ${record.r2_key}`);
    const data: unknown = await object.json();
    if (record.source === "github") events.push(...validateGitHub(data));
    else if (record.r2_key.endsWith("/_channels.json")) indexes.push(validateChannels(data));
    else channels.push(validateSlack(data, record.channel_id ?? basename(record.r2_key, ".json")));
  }
  // 月をまたいで同じスレッドを取り込んでも二重計上しない。
  const merged = new Map<string, SlackChannel>();
  for (const c of channels) {
    const previous = merged.get(c.channel_id);
    merged.set(c.channel_id, { ...c, messages: flatten([...(previous?.messages ?? []), ...c.messages]), workspace_url: c.workspace_url ?? previous?.workspace_url });
  }
  return { channels: [...merged.values()], events: [...new Map(events.map(e => [e.id, e])).values()], indexes };
}
async function syncMembers() {
  const { channels, indexes } = await loadRaw();
  const bots = new Set(indexes.flatMap(i => (i.users ?? []).filter(u => u.is_bot).map(u => u.id)));
  const users = new Map(indexes.flatMap(i => i.users ?? []).map(u => [u.id, u]));
  const joins = new Map<string, string>();
  const seen = new Set<string>();
  function join(user: string, ts: string) { const date = slackDate(ts); if (!joins.has(user) || date < joins.get(user)!) joins.set(user, date); seen.add(user); }
  for (const index of indexes) for (const j of index.channel_joins) join(j.user, j.ts);
  for (const channel of channels) for (const m of flatten(channel.messages)) {
    if (m.bot_id || m.subtype === "bot_message") { if (m.user) bots.add(m.user); continue; }
    if (m.user) { seen.add(m.user); if (m.subtype === "channel_join") join(m.user, m.ts); }
    for (const r of m.reactions ?? []) r.users.forEach(u => seen.add(u));
  }
  const existing = await db.select().from(schema.members);
  for (const user of seen) {
    const previous = existing.find(m => m.slack_user_id === user);
    if (previous?.opted_out_at || bots.has(user)) continue;
    const metadata = users.get(user);
    const inferred = joins.get(user) ?? null;
    const joined = previous?.joined_at_source === "manual" ? previous.joined_at : [previous?.joined_at, inferred].filter((v): v is string => !!v).sort()[0] ?? null;
    const values = { display_name: metadata?.display_name || previous?.display_name || user, real_name: metadata?.real_name ?? previous?.real_name ?? null, avatar_url: metadata?.avatar_url ?? previous?.avatar_url ?? null, joined_at: joined, updated_at: now() };
    await db.insert(schema.members).values({ id: previous?.id ?? randomUUID(), slack_user_id: user, created_at: now(), ...values }).onConflictDoUpdate({ target: schema.members.slack_user_id, set: values });
  }
}
async function calculate(target: string) {
  const [raw, members, history] = await Promise.all([loadRaw(target), db.select().from(schema.members), db.select().from(schema.monthly_stats)]);
  const botIds = new Set(raw.indexes.flatMap(i => (i.users ?? []).filter(u => u.is_bot).map(u => u.id)));
  const participants = members.filter(m => !botIds.has(m.slack_user_id));
  return { members: participants, history, aggregation: aggregate(target, participants, raw.channels, raw.events, history) };
}
async function aggregateMonth(target: string) {
  const { aggregation } = await calculate(target);
  for (const row of aggregation.stats) await db.insert(schema.monthly_stats).values(row).onConflictDoUpdate({ target: [schema.monthly_stats.member_id, schema.monthly_stats.month], set: row });
}
async function seedMonth(target: string) {
  const { members, history, aggregation } = await calculate(target);
  const tips = await db.select().from(schema.tips);
  const publications = await db.select({ member_id: schema.articles.member_id, issue_id: schema.articles.issue_id }).from(schema.articles).innerJoin(schema.issues, eq(schema.articles.issue_id, schema.issues.id)).where(and(eq(schema.articles.status, "published"), eq(schema.issues.status, "published"), lt(schema.issues.target, target)));
  const publishedIssues = (await db.select().from(schema.issues).where(eq(schema.issues.status, "published"))).filter(i => i.target < target).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 3).map(i => i.id);
  const detected = detectSeeds(target, members, aggregation, history, tips, publications.filter((p): p is { member_id: string; issue_id: string } => p.issue_id !== null), publishedIssues);
  for (const { seed, evidences } of detected) {
    // 記事に使われた根拠は再実行でも保つ。安定IDで種と根拠の重複を防ぐ。
    await db.insert(schema.seeds).values({ ...seed, created_at: now() }).onConflictDoUpdate({ target: schema.seeds.id, set: { score: seed.score, summary: seed.summary, metrics: seed.metrics } });
    for (const [i, evidence] of evidences.entries()) await db.insert(schema.evidences).values({ ...evidence, id: `${seed.id}:evidence:${i}`, seed_id: seed.id }).onConflictDoNothing();
  }
}
async function draftMember(memberId: string, target: string, articleId?: string, note = "") {
  const members = await db.select().from(schema.members); const member = members.find(m => m.id === memberId);
  if (!member || !eligible(member)) return false;
  const seeds = (await db.select().from(schema.seeds).where(and(eq(schema.seeds.member_id, memberId), eq(schema.seeds.month, target)))).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (!seeds.length) return false;
  const evidences = await db.select().from(schema.evidences).where(inArray(schema.evidences.seed_id, seeds.map(s => s.id)));
  const validIds = new Set(members.filter(eligible).map(m => m.id));
  const safeEvidence = evidences.filter(e => !e.author_member_id || validIds.has(e.author_member_id));
  const tipIds = safeEvidence.map(e => e.tip_id).filter((id): id is string => !!id);
  const tips = tipIds.length ? (await db.select().from(schema.tips).where(inArray(schema.tips.id, tipIds))).filter(t => validIds.has(t.sender_member_id)) : [];
  const stats = await db.select().from(schema.monthly_stats).where(and(eq(schema.monthly_stats.member_id, memberId), eq(schema.monthly_stats.month, target)));
  const prompt = buildPrompt(member, seeds, safeEvidence, tips, members, stats[0], note);
  const draft = await generateDraft(prompt, { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
  if (!draft) { console.error("下書き生成に失敗しました。候補を残します。"); return false; }
  const values = { ...draft, main_seed_id: seeds[0].id, seed_ids: seeds.slice(1).map(s => s.id), tip_ids: tips.map(t => t.id), lint_warnings: lintDraft(draft), generated_at: now(), updated_at: now() };
  if (articleId) await db.update(schema.articles).set(values).where(and(eq(schema.articles.id, articleId), eq(schema.articles.status, "draft")));
  else await db.insert(schema.articles).values({ id: randomUUID(), slug: randomUUID().replaceAll("-", "").slice(0, 12), member_id: memberId, ...values });
  return true;
}
async function draftsMonth(target: string) {
  const seeds = await db.select().from(schema.seeds).where(eq(schema.seeds.month, target));
  const articles = await db.select().from(schema.articles);
  for (const memberId of new Set(seeds.map(s => s.member_id))) {
    // 手で編集した記事と取り下げ済みの記事を再生成しない。
    if (articles.some(a => a.member_id === memberId && seeds.some(s => s.id === a.main_seed_id))) continue;
    await draftMember(memberId, target);
  }
}
async function regenerate() {
  const requests = await db.select().from(schema.regeneration_requests).where(eq(schema.regeneration_requests.status, "pending"));
  for (const request of requests) {
    const claim = await db.update(schema.regeneration_requests).set({ status: "processing" }).where(and(eq(schema.regeneration_requests.id, request.id), eq(schema.regeneration_requests.status, "pending"))).returning();
    if (!claim.length) continue;
    let success = false;
    try {
      const [article] = await db.select().from(schema.articles).where(eq(schema.articles.id, request.article_id));
      if (article?.status === "draft") {
        const [seed] = await db.select().from(schema.seeds).where(eq(schema.seeds.id, article.main_seed_id));
        if (seed) success = await draftMember(article.member_id, seed.month, article.id, request.note);
      }
    } catch { console.error("再生成に失敗しました。"); }
    await db.update(schema.regeneration_requests).set({ status: success ? "completed" : "failed" }).where(eq(schema.regeneration_requests.id, request.id));
  }
}
async function cleanup() {
  const expired = await db.select().from(schema.activity_imports).where(lt(schema.activity_imports.expires_at, now()));
  for (const row of expired) {
    const current = await db.select().from(schema.activity_imports).where(eq(schema.activity_imports.r2_key, row.r2_key));
    if (current.every(r => r.expires_at < now())) await env.RAW.delete(row.r2_key);
    await db.delete(schema.activity_imports).where(eq(schema.activity_imports.id, row.id));
  }
}
try {
  switch (command) {
    case "import:slack": await importSlack(month, args[1]); break;
    case "import:github": await importGitHub(month); break;
    case "members:sync": await syncMembers(); break;
    case "aggregate": await aggregateMonth(month); break;
    case "seeds": await seedMonth(month); break;
    case "drafts": await draftsMonth(month); break;
    case "drafts:regenerate": await regenerate(); break;
    case "cleanup": await cleanup(); break;
    case "monthly": await importGitHub(month); await syncMembers(); await aggregateMonth(month); await seedMonth(month); await draftsMonth(month); break;
    default: throw new Error("未対応のコマンドです");
  }
  console.log(`${command}${month ? ` ${month}` : ""}: 完了`);
} finally { await dispose(); }
