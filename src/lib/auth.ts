import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { members, sessions } from "@/db/schema";
import { canUseDevLogin, roleStatus, safeReturnTo, SESSION_COOKIE, sessionIsValid, verifySession } from "./session";
import { apiError } from "./errors";

export async function authEnvironment() {
  const { env } = await getCloudflareContext({ async: true });
  return {
    secret: env.SESSION_SECRET ?? process.env.SESSION_SECRET ?? "",
    devLogin: canUseDevLogin(process.env.NODE_ENV, process.env.APP_ENV ?? env.APP_ENV, process.env.DEV_LOGIN ?? env.DEV_LOGIN),
  };
}
export async function getCurrentMember() {
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, (await authEnvironment()).secret);
  if (!id) return null;
  const db = await getDb();
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, id) });
  if (!sessionIsValid(session)) return null;
  const member = await db.query.members.findFirst({ where: eq(members.id, session!.member_id) });
  return member?.is_active ? member : null;
}
export async function requireMember(returnTo = "/tips/new") {
  const member = await getCurrentMember();
  if (!member) redirect(`/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
  return member;
}
export async function guardRole(role: "member" | "editor") {
  const member = await getCurrentMember();
  const status = roleStatus(member, role);
  return status === 200 ? { member: member!, error: null } : {
    member: null,
    error: apiError(status, status === 401 ? "unauthorized" : "forbidden", status === 401 ? "ログインしてください。" : "編集部の権限が必要です。"),
  };
}
