import { getPlatformProxy } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { demoSeed } from "./demo-seed";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

// 実在の局員・投稿・リポジトリには接続しない。再実行時はサンプルだけ更新する。
const demo = process.argv.includes("--demo-sql") ? demoSeed() : undefined;
const platform = demo ? undefined : await getPlatformProxy<CloudflareEnv>({ persist: { path: ".wrangler/state/v3" } });
// In export mode Drizzle builds SQL without issuing database calls.
const db = drizzle(platform?.env.DB ?? {} as D1Database, { schema });
async function save(query: { toSQL(): { sql: string; params: unknown[] } }, local: () => PromiseLike<unknown>) {
  if (!demo) return await local();
  const {sql, params} = query.toSQL();
  demo.add(sql.replace(/^insert into /i, "INSERT OR IGNORE INTO "), params);
}
const now = "2026-11-16T09:00:00+09:00";
const memberIds = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const names = ["架空・笹野パンダ", "架空・若葉ぽこ", "架空・芽吹もち", "架空・紙野しおり", "架空・灯野あかり", "架空・糸井つむぎ", "架空・星野こむぎ", "架空・森野ふわ"];
const stories = [
  { headline: "はじめての一歩、仲間と形に", kind: "K-08", summary: "はじめてのサンプルPRを1件完成", metric: "prs_merged", count: 1,
    action: "初めての画面づくりに挑戦した。使う人が迷わず進めるよう、ボタンの言葉や配置を一つずつ確かめ、サンプル画面を完成させた", member: 1 },
  { headline: "わかる喜びを、返信にのせて", kind: "K-04", summary: "質問への返信を4件実施", metric: "question_replies", count: 4,
    action: "仲間から寄せられた質問に、実際の手順を添えて返信した。相手がどこまで理解できたかを確かめながら、順を追って説明した", member: 4 },
  { headline: "読む人の道しるべ、育つ手引き", kind: "K-14", summary: "サンプル手引きを3件更新", metric: "doc_changes", count: 3,
    action: "作業の手順をまとめた手引きを整えた。初めて読む人にも伝わるよう、準備するものと確認の方法を分け、図の説明も書き添えた", member: 3 },
  { headline: "レビューに宿る、やさしい視点", kind: "K-03", summary: "仲間のサンプルPRを6件レビュー", metric: "reviews", count: 6,
    action: "仲間のサンプルPRに目を通し、使いやすさの視点から提案を寄せた。工夫されている点を言葉にして伝え、相談しながら画面を磨いた", member: 5 },
  { headline: "ようこその一言、輪をひろげる", kind: "K-05", summary: "新入生への最初の挨拶を3件実施", metric: "first_greetings", count: 3,
    action: "新しい仲間の自己紹介に、歓迎の言葉を届けた。関心を持った話題に触れて声をかけ、次の会話につながるきっかけをつくった", member: 6 },
  { headline: "毎週の小さな工夫、一冊の記録に", kind: "K-11", summary: "対象月の全5週にサンプル活動を記録", metric: "active_weeks", count: 5,
    action: "毎週の活動で見つけた工夫を記録した。試したことと気づいたことを短くまとめ、仲間が読み返せる形で共有した", member: 2 },
];
try {
  for (let i = 0; i < names.length; i++) {
    const member = db.insert(schema.members).values({ id: memberIds[i], slack_user_id: `FAKE_USER_${i + 1}`, display_name: names[i],
      joined_at: i === 1 || i === 2 ? "2026-04-01" : "2023-04-01", joined_at_source: "manual", is_editor: i === 0,
      created_at: now, updated_at: now });
    await save(member, () => member.onConflictDoUpdate({ target: schema.members.id, set: { display_name: names[i], is_editor: i === 0 } }));
  }
  for (const [monthIndex, month] of ["2026-10", "2026-11"].entries()) {
    const issueId = `sample-issue-${month}`;
    const publishedAt = `${monthIndex === 0 ? "2026-11-01" : "2026-12-01"}T09:00:00+09:00`;
    const issue = { id: issueId, kind: "monthly" as const, target: month, number: monthIndex + 1,
      title: `良良タイムズ ${month.replace("-", "年")}月号`, status: "published" as const, published_at: publishedAt,
      editor_note: "りゃんりゃん、今月もすてきな足跡を見つけたよ。誰かを支える一言も、はじめての挑戦も、みんなの大事なニュースだよ。次の号でも、いい話を届けるよ〜。" };
    const issueInsert = db.insert(schema.issues).values(issue);
    await save(issueInsert, () => issueInsert.onConflictDoUpdate({ target: schema.issues.id, set: issue }));
    for (let i = 0; i < stories.length + 2; i++) {
      const story = stories[i % stories.length];
      const id = `sample-${month}-${i}`;
      const seedId = `sample-seed-${month}-${i}`;
      const memberId = memberIds[story.member];
      const state = i < 6 ? "published" : i === 6 ? "retracted" : "hidden";
      const seed = db.insert(schema.seeds).values({ id: seedId, member_id: memberId, month, kind: story.kind, score: 10 + i,
        summary: story.summary, metrics: { [story.metric]: story.count }, created_at: now });
      await save(seed, () => seed.onConflictDoNothing());
      const article = { id, slug: `${monthIndex === 0 ? "oct" : "nov"}sample${String(i + 1).padStart(3, "0")}`, member_id: memberId, issue_id: issueId,
        status: state as "published" | "retracted" | "hidden", headline: story.headline,
        body: `${names[story.member]}さんは${Number(month.slice(-2))}月、${story.action}。一つひとつのやり取りには、仲間とともに前に進もうとする姿勢が表れていた。\n今回の記録には、${story.summary}したことが残る。取り組みの過程を共有することで、同じテーマに向き合う仲間が手順をたどれるようになった。成果だけでなく、そこに至る工夫も確かめられる形となった。\n身近な活動の中で生まれた小さな足跡を、今月の紙面に記す。なお、この記事の人物と活動はすべて動作確認用の架空のサンプルである。`,
        reporter_comment: "りゃんりゃん、小さな工夫が仲間に届くところを見つけたよ。一歩ずつの足跡が、ちゃんと形になっているよ〜。",
        main_seed_id: seedId, seed_ids: [], tip_ids: [], sort_order: i, is_top: i === 0, lint_warnings: [],
        generated_at: now, published_at: publishedAt, updated_at: now,
        retracted_at: state === "retracted" ? now : null, hidden_at: state === "hidden" ? now : null };
      const articleInsert = db.insert(schema.articles).values(article);
      await save(articleInsert, () => articleInsert.onConflictDoUpdate({ target: schema.articles.id, set: article }));
      const evidence = db.insert(schema.evidences).values({ id: `sample-evidence-${month}-${i}`, seed_id: seedId,
        source: "github", author_member_id: memberId, url: `https://example.invalid/sample/${month}/${i + 1}`,
        excerpt: `架空のサンプル記録：${story.summary}。`, occurred_at: now });
      await save(evidence, () => evidence.onConflictDoNothing());
      const stats = db.insert(schema.monthly_stats).values({ member_id: memberId, month, weeks_in_month: 5,
        [story.metric]: story.count });
      await save(stats, () => stats.onConflictDoNothing());
    }
    if (demo) continue;
    const count = await db.select().from(schema.articles).where(eq(schema.articles.issue_id, issueId));
    console.log(`${month}：公開${count.filter(a => a.status === "published").length}件、取り下げ・非公開各1件`);
  }
  if (demo) await demo.write();
  console.log("架空の局員8名（編集部1名・新入生2名）を用意しました。実データは使用していません。");
} finally { await platform?.dispose(); }
