"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main" className="login-panel"><h1>紙面を読み込めませんでした</h1><p>時間をおいて、もう一度お試しください。</p><button className="button" onClick={reset}>再読み込み</button></main>;
}
