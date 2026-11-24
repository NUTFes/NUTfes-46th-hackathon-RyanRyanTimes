import { connection } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { Masthead } from "@/components/newspaper";
import { getDb } from "@/db";
import { members } from "@/db/schema";
import { authEnvironment } from "@/lib/auth";
import { safeReturnTo } from "@/lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  await connection();
  const { devLogin, demoMode } = await authEnvironment();
  const returnTo = safeReturnTo((await searchParams).return_to);
  const roster = devLogin || demoMode ? await (await getDb()).select({ id: members.id, display_name: members.display_name, is_editor: members.is_editor }).from(members).where(and(eq(members.is_active, true), demoMode ? sql`${members.slack_user_id} GLOB 'FAKE_USER_[1-8]'` : undefined)) : [];
  return <><Masthead/><main id="main" className="login-panel"><p className="eyebrow">局員の入口</p><h1>いい話を、届けよう。</h1><p>タレコミを送るにはログインしてください。</p><a className="button" href={`/api/auth/slack/login?return_to=${encodeURIComponent(returnTo)}`}>Slack でログイン</a>{(devLogin || demoMode) && <form className={demoMode ? "demo-login" : undefined} method="post" action="/api/auth/dev-login"><h2>{demoMode ? "デモ用ログイン" : "開発用ユーザー切替"}</h2><p>{demoMode ? "動作確認用のデモです。データはすべて架空です" : "架空の局員を選び、動作を確認できます。"}</p>{demoMode && <label>パスコード<input type="password" name="passcode" autoComplete="current-password" required/></label>}<input type="hidden" name="return_to" value={returnTo}/><label htmlFor="member_id">局員</label><select id="member_id" name="member_id" required>{roster.map(m => <option key={m.id} value={m.id}>{m.display_name}{m.is_editor ? "（編集部）" : ""}</option>)}</select><button className="button" type="submit">この局員でログイン</button></form>}</main></>;
}
