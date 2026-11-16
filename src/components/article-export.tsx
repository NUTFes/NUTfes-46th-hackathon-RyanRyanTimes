"use client";
import { useRef, useState } from "react";
import { toPng } from "html-to-image";

export function ArticleExport({ article }: { article: { slug: string; headline: string; body: string; reporter_comment: string; display_name: string } }) {
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function saveImage() {
    if (!card.current || busy) return;
    setBusy(true); setMessage("");
    try {
      await document.fonts.ready;
      const url = await toPng(card.current, { width: 1080, height: 1350, pixelRatio: 1, backgroundColor: "#f6f2e8", cacheBust: true });
      const link = document.createElement("a");
      link.download = `良良タイムズ-${article.slug}.png`; link.href = url; link.click();
      setMessage("画像を保存しました。");
    } catch { setMessage("画像を保存できませんでした。時間をおいて、もう一度お試しください。"); }
    finally { setBusy(false); }
  }
  return <div className="export-controls"><button className="button" onClick={saveImage} disabled={busy}>{busy ? "画像を作成中…" : "画像で保存"}<span aria-hidden> ↓</span></button><small>1080 × 1350 px・PNG</small><p role="status">{message}</p>
    <div className="export-stage" aria-hidden="true"><div ref={card} className="export-card"><div className="export-masthead">良良タイムズ</div><p className="export-kicker">小さな足跡を、みんなのニュースに。</p><p className="eyebrow">{article.display_name}さんのいい話</p><h2>{article.headline}</h2><p className="export-body">{article.body.slice(0, 260)}{article.body.length > 260 ? "…" : ""}</p><div className="export-comment"><img src="/ryanryan.svg" width="180" height="180" alt=""/><p>{article.reporter_comment}</p></div><div className="export-footer">良良記者より ／ 架空のサンプル紙面<br/>全文は良良タイムズで</div></div></div>
  </div>;
}
