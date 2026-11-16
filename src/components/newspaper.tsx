import Link from "next/link";
import { formatDate } from "@/lib/reader";

export function Masthead({ number, published_at, target }: { number?: number; published_at?: string | null; target?: string }) {
  return <header className="masthead">
    <div className="edition-line"><span>小さな足跡を、みんなのニュースに。</span><Link href="/me">マイページ ↗</Link></div>
    <Link className="nameplate" href="/" aria-label="良良タイムズ トップ"><img src="/ryanryan.svg" width="48" height="48" alt=""/>良良タイムズ<span className="seal">良い話、あります。</span></Link>
    <div className="edition-line bottom"><span>{number ? `第${number}号` : "局内のいい話を届ける新聞"}{target ? ` ／ ${target.replace("-", "年")}月号` : ""}</span><span>{published_at ? `${formatDate(published_at)} 発行` : "月刊・良良記者編集室"}</span></div>
  </header>;
}
export function TipLink() {
  return <aside className="tip-box"><img src="/ryanryan.svg" alt="良良記者のパンダ" width="88" height="88"/><div><p className="eyebrow">次のニュースは、あなたのそばに。</p><Link href="/tips/new">あなたのまわりのいい話を教えて <span aria-hidden>→</span></Link><p>気づいた優しさ、小さな挑戦。良良記者がお待ちしています。</p></div></aside>;
}
export function Footer() {
  return <footer className="footer"><Link href="/">良良タイムズ</Link><span>誰かの「ありがとう」が、今日の一面。</span><small>この紙面の人物・活動はすべて架空のサンプルです。</small></footer>;
}
