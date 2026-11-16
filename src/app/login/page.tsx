import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { Masthead } from "@/components/newspaper";
import { getDb } from "@/db";
import { members } from "@/db/schema";
import { authEnvironment } from "@/lib/auth";
import { safeReturnTo } from "@/lib/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  await connection();
  const { devLogin } = await authEnvironment();
  const returnTo = safeReturnTo((await searchParams).return_to);
  const roster = devLogin ? await (await getDb()).select({ id: members.id, display_name: members.display_name, is_editor: members.is_editor }).from(members).where(eq(members.is_active, true)) : [];
  return <><Masthead/><main id="main" className="login-panel"><p className="eyebrow">局員の入口</p><h1>いい話を、届けよう。</h1><p>タレコミを送るにはログインしてください。</p><a className="button" href={`/api/auth/slack/login?return_to=${encodeURIComponent(returnTo)}`}>Slack でログイン</a>{devLogin && <form method="post" action="/api/auth/dev-login"><h2>開発用ユーザー切替</h2><p>架空の局員を選び、動作を確認できます。</p><input type="hidden" name="return_to" value={returnTo}/><label htmlFor="member_id">局員</label><select id="member_id" name="member_id" required>{roster.map(m => <option key={m.id} value={m.id}>{m.display_name}{m.is_editor ? "（編集部）" : ""}</option>)}</select><button className="button" type="submit">この局員でログイン</button></form>}</main></>;
}
