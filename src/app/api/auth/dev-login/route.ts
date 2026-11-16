import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { members, sessions } from "@/db/schema";
import { authEnvironment } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { safeReturnTo, SESSION_COOKIE, SESSION_SECONDS, sessionCookieOptions, signSession, verifySession } from "@/lib/session";

export async function POST(request: Request) {
  // 本番ビルドと Worker の双方で開発ログインを拒否する。
  if (process.env.NODE_ENV !== "development" || !(await authEnvironment()).devLogin) return apiError(404, "not_found", "ページが見つかりません。");
  if (request.headers.get("origin") !== new URL(request.url).origin) return apiError(403, "forbidden", "このリクエストは受け付けられません。");
  let memberId: unknown, returnTo: unknown;
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = (await request.json()) as { member_id?: unknown; return_to?: unknown }; memberId = body.member_id; returnTo = body.return_to;
    } else { const form = await request.formData(); memberId = form.get("member_id"); returnTo = form.get("return_to"); }
  } catch { return apiError(400, "validation_error", "入力内容を確認してください。"); }
  if (typeof memberId !== "string") return apiError(400, "validation_error", "局員を選んでください。");
  const db = await getDb();
  const member = await db.query.members.findFirst({ where: eq(members.id, memberId) });
  if (!member?.is_active) return apiError(400, "validation_error", "在籍中の局員を選んでください。");
  const { secret } = await authEnvironment();
  if (secret.length < 32) return apiError(400, "validation_error", "SESSION_SECRET を32文字以上で設定してください。");
  const jar = await cookies();
  const previous = await verifySession(jar.get(SESSION_COOKIE)?.value, secret);
  if (previous) await db.delete(sessions).where(eq(sessions.id, previous));
  const id = crypto.randomUUID(); const now = new Date();
  await db.insert(sessions).values({ id, member_id: member.id, created_at: now.toISOString(), expires_at: new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString() });
  jar.set(SESSION_COOKIE, await signSession(id, secret), sessionCookieOptions());
  return new Response(null, { status: 303, headers: { Location: safeReturnTo(returnTo), "Cache-Control": "no-store" } });
}
