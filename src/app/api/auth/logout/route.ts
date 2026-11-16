import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { authEnvironment } from "@/lib/auth";
import { apiError } from "@/lib/errors";
import { SESSION_COOKIE, sessionCookieOptions, verifySession } from "@/lib/session";
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return apiError(403, "forbidden", "このリクエストは受け付けられません。");
  const jar = await cookies();
  const id = await verifySession(jar.get(SESSION_COOKIE)?.value, (await authEnvironment()).secret);
  if (id) await (await getDb()).delete(sessions).where(eq(sessions.id, id));
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } });
}
