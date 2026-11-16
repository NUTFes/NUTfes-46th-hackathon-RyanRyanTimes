import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Masthead, TipLink } from "@/components/newspaper";
import { getIssue } from "@/lib/reader";

export default async function IssuePage({ params }: { params: Promise<{ kind: string; target: string }> }) {
  await connection();
  const { kind, target } = await params;
  const issue = await getIssue(kind, target);
  if (!issue) notFound();
  const [top, ...rest] = issue.articles;
  return <><Masthead number={issue.number} published_at={issue.published_at} target={issue.kind === "monthly" ? issue.target : undefined}/><main id="main"><nav className="breadcrumb"><Link href="/">号の一覧</Link><span>／ {issue.title}</span></nav><h1 className="issue-heading">{issue.title}</h1>
    {top ? <article className="lead"><div><p className="eyebrow">今月の一面 ／ {top.display_name}さん</p><h2><Link href={`/articles/${top.slug}`}>{top.headline}</Link></h2><p className="lead-excerpt">{top.body.slice(0, 180)}…</p><Link className="text-link" href={`/articles/${top.slug}`}>記事のつづきを読む →</Link></div><div className="mascot-panel"><img src="/ryanryan.svg" alt="良良記者" width="220" height="220"/><p>一歩ずつ、足跡になってるよ。</p></div></article> : <p className="empty">現在公開中の記事はありません。</p>}
    <section className="article-grid" aria-label="この号の記事">{rest.map((article, i) => <article className="article-card" key={article.slug}><p className="eyebrow">{String(i + 2).padStart(2, "0")} ／ {article.display_name}さん</p><h2><Link href={`/articles/${article.slug}`}>{article.headline}</Link></h2><p>{article.body.slice(0, 60)}…</p><Link className="text-link" href={`/articles/${article.slug}`}>続きを読む →</Link></article>)}</section>
    {issue.editor_note && <aside className="editor-note"><h2>良良の編集後記</h2><p>{issue.editor_note}</p><span>取材・文　良良記者</span></aside>}<TipLink/></main></>;
}
