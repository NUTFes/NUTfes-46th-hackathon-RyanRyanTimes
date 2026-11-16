import { apiError } from "@/lib/errors";
export async function GET() {
  // TODO: state・nonce・ID トークン・team_id を検証する。
  return apiError(501, "not_implemented", "Slack ログインは準備中です。");
}
