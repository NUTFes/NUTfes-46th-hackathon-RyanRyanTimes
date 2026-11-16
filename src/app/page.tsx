import Link from "next/link";
import { connection } from "next/server";
import { Masthead, TipLink } from "@/components/newspaper";
import { formatDate, getIssue, getIssues, issueHref } from "@/lib/reader";

export default async function Home() {
  await connection();
  const issues = await getIssues();
  const latest = issues[0] ? await getIssue(issues[0].kind, issues[0].target) : null;
  const top = latest?.articles[0];
  return <><Masthead number={latest?.number} published_at={latest?.published_at}/><main id="main">
    <div className="section-title"><h1>今月の良い知らせ</h1><span>最新号</span></div>
    {latest ? <section className="lead home-lead"><div><p className="eyebrow">第{latest.number}号 ／ {latest.target}</p><h2><Link href={issueHref(latest)}>{top?.headline ?? latest.title}</Link></h2><p className="lead-excerpt">{top?.body.slice(0, 150) ?? "今月の紙面をお楽しみください。"}</p><Link className="button" href={issueHref(latest)}>最新号をひらく →</Link></div><div className="mascot-panel"><img src="/ryanryan.svg" alt="手帳を持って取材する良良記者" width="240" height="240"/><p>いい話、見つけちゃったよ。</p><small>記者・りゃんりゃん</small></div></section> : <p className="empty">最初の号を準備しています。発行をお楽しみに。</p>}
    <section className="backnumbers"><div className="section-title"><h2>バックナンバー</h2><span>紙面のあしあと</span></div><div className="issue-list">{issues.map(issue => <Link className="issue-card" key={issue.id} href={issueHref(issue)}><span className="eyebrow">第{issue.number}号 · {issue.kind === "monthly" ? "月刊" : "年間特大号"}</span><h3>{issue.title}</h3><p>{formatDate(issue.published_at)} 発行</p><span className="red">紙面を読む →</span></Link>)}</div></section><TipLink/>
  </main></>;
}
