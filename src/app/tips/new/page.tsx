import { Masthead } from "@/components/newspaper";
import { requireMember } from "@/lib/auth";
export default async function TipPage() {
  const member = await requireMember("/tips/new");
  return <><Masthead/><main id="main" className="login-panel"><p className="eyebrow">タレコミ受付</p><h1>あなたのまわりのいい話を教えて</h1><p>{member.display_name}さん、ようこそ。</p><p>タレコミの投稿フォームは準備中です。次の紙面につながる小さな足跡を、楽しみに待っているよ。</p><form action="/api/auth/logout" method="post"><button className="text-link" type="submit">ログアウト</button></form></main></>;
}
