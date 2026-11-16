import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { articles, evidences, issues, members, seeds } from "@/db/schema";

const publicTag = "public-newspaper";
// 後続の発行・訂正・取り下げ・非公開・オプトアウト処理から必ず呼ぶ。
export function invalidatePublicCache() { revalidateTag(publicTag, { expire: 0 }); }

export const getIssues = cache(async () => {
  const db = await getDb();
  return db.select().from(issues).where(eq(issues.status, "published")).orderBy(desc(issues.published_at), desc(issues.number));
});
const publicColumns = {
  slug: articles.slug, headline: articles.headline, body: articles.body, reporter_comment: articles.reporter_comment,
  sort_order: articles.sort_order, is_top: articles.is_top, published_at: articles.published_at,
  updated_at: articles.updated_at, display_name: members.display_name,
};
// 状態は毎リクエスト検証する。キャッシュに取り下げ済みの記事を残さない。
const publicCondition = and(eq(articles.status, "published"), eq(issues.status, "published"), isNull(members.opted_out_at));
export const getIssue = cache(async (kind: string, target: string) => {
  if (!validIssuePath(kind, target)) return null;
  const db = await getDb();
  const issue = await db.query.issues.findFirst({ where: and(eq(issues.kind, kind as "monthly" | "annual"), eq(issues.target, target), eq(issues.status, "published")) });
  if (!issue) return null;
  const rows = await db.select(publicColumns).from(articles)
    .innerJoin(members, eq(members.id, articles.member_id)).innerJoin(issues, eq(issues.id, articles.issue_id))
    .where(and(publicCondition, eq(articles.issue_id, issue.id))).orderBy(desc(articles.is_top), asc(articles.sort_order), asc(articles.slug));
  return { ...issue, articles: rows };
});
export const getArticle = cache(async (slug: string) => {
  if (!/^[a-zA-Z0-9_-]{12}$/.test(slug)) return null;
  const db = await getDb();
  const [row] = await db.select({ ...publicColumns, issue: issues, main_seed_id: articles.main_seed_id, seed_ids: articles.seed_ids, tip_ids: articles.tip_ids })
    .from(articles).innerJoin(members, eq(members.id, articles.member_id)).innerJoin(issues, eq(issues.id, articles.issue_id))
    .where(and(publicCondition, eq(articles.slug, slug))).limit(1);
  if (!row) return null;
  // 公開確認後、本文の版をキーにした根拠要約だけを持続キャッシュする。
  const detail = await unstable_cache(async () => {
    const db = await getDb();
    const seedIds = [...new Set([row.main_seed_id, ...row.seed_ids])];
    const summaries = await db.select({ summary: seeds.summary, metrics: seeds.metrics }).from(seeds).where(inArray(seeds.id, seedIds));
    return { summaries };
  }, ["article-evidence", slug, row.updated_at ?? row.published_at ?? ""], { tags: [publicTag], revalidate: 60 })();
  // 他人の記事でもオプトアウトした作者の投稿を直ちに外すため、根拠は毎回検証する。
  const evidenceRows = await db.select({ source: evidences.source, url: evidences.url, excerpt: evidences.excerpt })
    .from(evidences).leftJoin(members, eq(members.id, evidences.author_member_id))
    .where(and(or(inArray(evidences.seed_id, [row.main_seed_id, ...row.seed_ids]), row.tip_ids.length ? inArray(evidences.tip_id, row.tip_ids) : undefined), isNull(members.opted_out_at)));
  const { main_seed_id: _main, seed_ids: _seeds, tip_ids: _tips, ...article } = row;
  // 匿名タレコミは公開根拠に本文・送り主を含めない。
  return { ...article, ...detail, evidences: evidenceRows.filter(e => e.source !== "tip") };
});
export function validIssuePath(kind: string, target: string) {
  return (kind === "monthly" && /^\d{4}-(0[1-9]|1[0-2])$/.test(target)) || (kind === "annual" && /^\d{4}$/.test(target));
}
export function issueHref(issue: { kind: string; target: string }) { return `/issues/${issue.kind}/${issue.target}`; }
export function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(new Date(value)) : "発行日未定";
}
