import { apiError } from "@/lib/errors";
export async function GET() {
  // TODO: Slack OIDC と team_id の検証は次の作業票で実装する。
  return apiError(501, "not_implemented", "Slack ログインは準備中です。");
}
