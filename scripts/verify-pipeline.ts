import assert from "node:assert/strict";
import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, like } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { validateDraft } from "../src/lib/pipeline/drafts";

// 架空データ専用のローカル結合検証。実在のデータを削除・変更しない。
if (process.argv.includes("--remote")) throw new Error("ローカル専用です");
const { env, dispose } = await getPlatformProxy<CloudflareEnv>({ persist: { path: ".wrangler/state/v3" } });
const db = drizzle(env.DB);
const expiredKey = "raw/slack/fixture-expired/_channels.json";
try {
  const stats = await db.select().from(schema.monthly_stats).where(and(like(schema.monthly_stats.member_id, "fixture-member-%"), eq(schema.monthly_stats.month, "2026-11")));
  assert.equal(stats.length, 6);
  const hero = stats.find(s => s.member_id === "fixture-member-1")!;
  assert.equal(hero.commits, 6); assert.equal(hero.reactions_given, 30); assert.equal(hero.first_greetings, 3);
  const seeds = await db.select().from(schema.seeds).where(like(schema.seeds.id, "pipeline:2026-11:fixture-member-%"));
  assert.equal(new Set(seeds.map(s => s.kind)).size, 14);
  assert.equal(new Set(seeds.map(s => `${s.member_id}:${s.kind}`)).size, seeds.length);
  const drafts = await db.select().from(schema.articles).where(like(schema.articles.member_id, "fixture-member-%"));
  assert.equal(drafts.length, new Set(seeds.map(s => s.member_id)).size);
  for (const draft of drafts) { validateDraft(draft); assert.equal(draft.status, "draft"); assert.deepEqual(draft.lint_warnings, []); }
  const [optedOut] = await db.select().from(schema.members).where(eq(schema.members.id, "fixture-member-7"));
  assert.equal(optedOut.display_name, ""); assert.equal(optedOut.github_login, null);
  const [manual] = await db.select().from(schema.members).where(eq(schema.members.id, "fixture-member-2"));
  assert.equal(manual.joined_at, "2026-04-01"); assert.equal(manual.joined_at_source, "manual");
  const imports = await db.select().from(schema.activity_imports).where(eq(schema.activity_imports.month, "2026-11"));
  assert.equal(imports.filter(i => i.r2_key.includes("FIXTURE_C1") || i.r2_key.endsWith("_channels.json") || i.source === "github").length, 3);
  if (process.argv.includes("--prepare-maintenance")) {
    const article = drafts.find(a => a.member_id === "fixture-member-1")!;
    await db.insert(schema.regeneration_requests).values({ id: "fixture-regeneration", article_id: article.id, note: "根拠に沿って読みやすく。", status: "pending", created_at: new Date().toISOString() }).onConflictDoUpdate({ target: schema.regeneration_requests.id, set: { status: "pending" } });
    await env.RAW.put(expiredKey, "{}");
    await db.insert(schema.activity_imports).values({ id: "fixture-expired-import", source: "slack", month: "2020-01", r2_key: expiredKey, item_count: 0, imported_at: "2020-01-01T00:00:00Z", expires_at: "2021-01-01T00:00:00Z" }).onConflictDoNothing();
  }
  if (process.argv.includes("--after-maintenance")) {
    assert.equal(await env.RAW.get(expiredKey), null);
    assert.equal((await db.select().from(schema.activity_imports).where(eq(schema.activity_imports.id, "fixture-expired-import"))).length, 0);
    const [request] = await db.select().from(schema.regeneration_requests).where(eq(schema.regeneration_requests.id, "fixture-regeneration"));
    assert.equal(request.status, "completed");
  }
  console.log(`ローカル結合検証: ${stats.length}名の集計、${seeds.length}種（全14種類）、${drafts.length}下書き。除外・重複・字数・状態を確認しました。`);
} finally { await dispose(); }
