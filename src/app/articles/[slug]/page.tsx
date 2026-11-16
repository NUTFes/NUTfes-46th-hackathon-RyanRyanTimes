import { stamps } from "@/lib/stamps";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Masthead, TipLink } from "@/components/newspaper";
import { ArticleExport } from "@/components/article-export";
import { getArticle, issueHref } from "@/lib/reader";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const article = await getArticle((await params).slug);
  if (!article) return { title: "記事が見つかりません", robots: { index: false, follow: false } };
  return { title: article.headline, description: article.body.slice(0, 100), robots: { index: false, follow: false },
    openGraph: { title: `${article.headline}｜良良タイムズ`, description: article.body.slice(0, 100), type: "article", locale: "ja_JP", siteName: "良良タイムズ" } };
}
export default async function ArticlePage({ params }: Props) {
  await connection();
  const article = await getArticle((await params).slug);
  if (!article) notFound();
  return <><Masthead number={article.issue.number} published_at={article.issue.published_at}/><main id="main"><nav className="breadcrumb"><Link href={issueHref(article.issue)}>{article.issue.title}</Link><span>／ 記事</span></nav><article className="article-full"><p className="eyebrow">今月の足跡 ／ {article.display_name}さん</p><div className="actions">{article.summaries.map((s,i)=><span className="stamp" key={i}>{stamps[s.kind]??s.kind}</span>)}</div><h1>{article.headline}</h1><div className="article-body">{article.body.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div><aside className="reporter"><img src="/ryanryan.svg" alt="記者の良良" width="110" height="110"/><div className="bubble"><h2>良良の取材メモ</h2><p>{article.reporter_comment}</p></div></aside><section className="evidence"><h2>この足跡の根拠</h2><ul>{article.summaries.map((s, i) => <li key={i}>{s.summary}{Object.entries(s.metrics).length > 0 && <span>（{Object.values(s.metrics).join("・")}件）</span>}</li>)}</ul>{article.evidences.map((e, i) => <p key={i}>{e.excerpt}{e.url && <a href={e.url} target="_blank" rel="noopener noreferrer">元の{e.source === "github" ? "PR・活動" : "投稿"}を確認 ↗</a>}</p>)}<small>元の投稿・PRはアクセス権のある局員のみ閲覧できます。サンプルのリンクは架空の参照先です。</small></section><ArticleExport article={article}/><Link className="text-link" href={issueHref(article.issue)}>← この号の紙面に戻る</Link></article><TipLink/></main></>;
}
